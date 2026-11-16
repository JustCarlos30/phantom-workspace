import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, RefreshCw, Save, Search, X } from 'lucide-react';
import { ErrorNotice, useOperation, useResource } from './PluginPrimitives';
import EmptyState from './EmptyState.jsx';
import { MergeSteps } from './MergePath.jsx';
import { branchPath, buildBranches, cardsOf, changeLabel, changeTone, commitsText, contentByBranch, filesText, plural } from '../hooks/branches-model.mjs';
import { relativeTime } from '../hooks/repo-graph.mjs';
import '../branches.css';

// Ramas: main on top, then one row per branch with a single state, a single
// line of detail and at most one action. Selecting a row opens its detail:
// the road to main, the files it changes and what can be done with it.
// The host refuses anything that would lose work.
const POLL_MS = 8000, WIDE = 860, FILES_SHOWN = 6;
const MARK = { added: '+', removed: '−', modified: '~', conflict: '!' };
const list = (files, more = 2) => `${files.slice(0, more).map(file => file.split('/').pop()).join(', ')}${files.length > more ? ` y ${files.length - more} más` : ''}`;
const showHistory = onOpenPanel => { window.dispatchEvent(new CustomEvent('phantom:hub-tab', { detail: { type: 'repo', tab: 'repo' } })); onOpenPanel?.('repo', { hubTab: 'repo' }); };

function Chip({ row }) { return <span className="br-chip" data-tone={row.tone}>{row.stateLabel}</span>; }

// Integrating asks once more on the same button: the second click does it.
function IntegrateButton({ armed, arm, disarm, confirm, busy, label = 'Integrar', wide = false }) {
  useEffect(() => { if (!armed) return undefined; const timer = setTimeout(disarm, 6000); return () => clearTimeout(timer); }, [armed, disarm]);
  return <button type="button" className={`br-button is-primary${wide ? ' is-wide' : ''}${armed ? ' is-armed' : ''}`} disabled={busy} onBlur={disarm}
    onKeyDown={event => { if (event.key === 'Escape' && armed) { event.stopPropagation(); disarm(); } }} onClick={() => armed ? confirm() : arm()}>{armed ? 'Confirmar integrar' : label}</button>;
}

function SaveForm({ row, base, busy, onSubmit, onCancel }) {
  const [message, setMessage] = useState(`Guardar trabajo de ${row.title}`);
  const [integrate, setIntegrate] = useState(false);
  const both = integrate && !row.isBase;
  return <form className="br-form" onSubmit={event => { event.preventDefault(); onSubmit(message.trim(), both); }}>
    <label className="br-field"><span>Mensaje</span><input value={message} onChange={event => setMessage(event.target.value)} maxLength={500} required autoFocus /></label>
    {!row.isBase && <label className="br-check"><input type="checkbox" checked={integrate} onChange={event => setIntegrate(event.target.checked)} />Integrar en {base} al guardar</label>}
    <div className="br-actions"><button type="submit" className="br-button is-primary" disabled={busy || !message.trim()}>{both ? `Guardar e integrar en ${base}` : `Guardar ${filesText(row.changeCount)}`}</button><button type="button" className="br-button" onClick={onCancel}>Cancelar</button></div>
  </form>;
}

function Files({ row }) {
  const [all, setAll] = useState(false);
  const unsaved = new Set(row.changes.map(change => change.path));
  const files = [
    ...row.changes.map(change => ({ path: change.path, tone: changeTone(change.status), label: changeLabel(change.status) })),
    ...row.committed.filter(file => !unsaved.has(file)).map(file => ({ path: file, tone: 'saved', label: 'Guardado' })),
  ];
  const hidden = Math.max(0, row.changeCount - row.changes.length) + Math.max(0, row.committedCount - row.committed.length);
  if (!files.length) return null;
  const shown = all ? files : files.slice(0, FILES_SHOWN), rest = files.length - shown.length;
  return <section className="br-files" aria-label="Archivos cambiados">
    <h4>Cambios</h4>
    <ul>{shown.map(file => <li key={file.path} title={file.path}><code>{file.path}</code>{MARK[file.tone] && <span className={`br-mark is-${file.tone}`} title={file.label} aria-label={file.label}>{MARK[file.tone]}</span>}</li>)}</ul>
    {rest > 0 && <button type="button" className="br-more" onClick={() => setAll(true)}>{filesText(rest + hidden)} más</button>}
    {!rest && hidden > 0 && <p className="br-quiet">y {filesText(hidden)} más</p>}
  </section>;
}

// `skip` is the action the row already offers when the detail opens under it.
function Detail({ row, base, checks, cards, skills, busy, armed, setArmed, act, setMode, onOpenPanel, onClose, skip }) {
  const path = branchPath(row, { base, checks });
  const armKey = `detail:${row.id}`, others = [...new Set((row.overlaps || []).flatMap(item => item.with))];
  const session = row.owned && onOpenPanel ? () => onOpenPanel('terminal', { focusNodeId: row.terminal.nodeId }) : null;
  const sub = [row.owned ? row.running ? 'Sesión activa' : 'Sesión en pausa' : 'Sesión cerrada', row.last?.at && `último guardado ${relativeTime(row.last.at)}`].filter(Boolean).join(' · ');
  return <div className="br-detail-body">
    <header className="br-detail-head">
      <div><h3>{row.title}</h3><p className="br-quiet">{sub}</p></div>
      {onClose && <button type="button" className="br-icon" aria-label="Cerrar detalle" title="Cerrar" onClick={onClose}><X size={14} /></button>}
    </header>
    <MergeSteps path={path} />
    <Files row={row} />
    <div className="br-detail-actions">
      {row.can.integrate && skip !== 'integrate' && <IntegrateButton wide label={`Integrar en ${base}`} busy={busy} armed={armed === armKey} arm={() => setArmed(armKey)} disarm={() => setArmed(null)} confirm={() => act(row, 'integrate')} />}
      {row.can.commit && skip !== 'save' && <button type="button" className={`br-button is-wide${row.can.integrate ? '' : ' is-primary'}`} disabled={busy} onClick={() => setMode({ id: row.id, kind: 'save' })}>Guardar {filesText(row.changeCount)}</button>}
      {(row.changeCount > 0 || row.committedCount > 0) && onOpenPanel && <button type="button" className="br-button is-wide" onClick={() => showHistory(onOpenPanel)}>Ver diferencias</button>}
      {row.can.update && <button type="button" className="br-button is-wide" disabled={busy} onClick={() => act(row, 'update')}>Poner al día con {base}</button>}
      {session && skip !== 'session' && <button type="button" className="br-button is-wide" onClick={session}>Ir a la sesión</button>}
      {row.can.remove && skip !== 'remove' && <button type="button" className="br-button is-wide is-quiet" disabled={busy} onClick={() => setMode({ id: row.id, kind: 'remove' })}>Limpiar</button>}
    </div>
    {cards.length > 0 && onOpenPanel && <p className="br-links">{cards.slice(0, 2).map(card => <button key={card.id} type="button" className="br-link" title={card.title} onClick={() => onOpenPanel('phantom-cards', { cardId: card.id })}>Ver tarea{cards.length > 1 ? ` · ${card.title}` : ''}</button>)}</p>}
    <details className="br-details">
      <summary>Detalles</summary>
      <dl>
        <dt>Rama</dt><dd><code>{row.name || 'Sin rama'}</code></dd>
        {row.worktree?.path && <><dt>Carpeta</dt><dd><code>{row.worktree.path}</code></dd></>}
        {row.last?.subject && <><dt>Último guardado</dt><dd>{row.last.subject}</dd></>}
        {(row.ahead > 0 || row.behind > 0) && <><dt>Respecto a {base}</dt><dd>{[row.ahead > 0 && `${commitsText(row.ahead)} propios`, row.behind > 0 && `le faltan ${row.behind}`].filter(Boolean).join(' · ')}</dd></>}
        {row.conflicts.length > 0 && <><dt>Chocan con {base}</dt><dd>{row.conflicts.join(', ')}</dd></>}
        {others.length > 0 && <><dt>También los tocan</dt><dd>{others.join(', ')} · {list(row.overlaps.map(item => item.path), 3)}</dd></>}
        {skills.length > 0 && <><dt>Skills nuevas</dt><dd>{onOpenPanel ? <button type="button" className="br-link" onClick={() => onOpenPanel('skills-catalog')}>{skills.map(skill => skill.name).join(', ')}</button> : skills.map(skill => skill.name).join(', ')}</dd></>}
        {row.error && <><dt>Error de Git</dt><dd>{row.error}</dd></>}
      </dl>
    </details>
  </div>;
}

function Row({ row, base, selected, wide, busy, notice, dismiss, mode, setMode, armed, setArmed, act, select, onOpenPanel, detail }) {
  const open = mode?.id === row.id ? mode.kind : null, armKey = `row:${row.id}`;
  const action = open ? null
    : row.action === 'save' ? <button type="button" className="br-button" disabled={busy} onClick={() => setMode({ id: row.id, kind: 'save' })}><Save size={14} aria-hidden="true" />Guardar</button>
    : row.action === 'integrate' ? <IntegrateButton busy={busy} armed={armed === armKey} arm={() => setArmed(armKey)} disarm={() => setArmed(null)} confirm={() => act(row, 'integrate')} />
    : row.action === 'session' && onOpenPanel ? <button type="button" className="br-button" onClick={() => onOpenPanel('terminal', { focusNodeId: row.terminal.nodeId })}>Ir a la sesión</button>
    : row.action === 'remove' ? <button type="button" className="br-button is-quiet" disabled={busy} onClick={() => setMode({ id: row.id, kind: 'remove' })}>Limpiar</button>
    : null;
  return <li className={`br-row${selected ? ' is-selected' : ''}`} data-state={row.state}>
    <div className="br-line">
      {row.isBase ? <div className="br-main"><span className="br-title">{row.title}</span><span className="br-sub">{row.detail}</span></div>
        : <button type="button" className="br-main" aria-expanded={selected} aria-label={`${row.title} · ${row.stateLabel} · ${row.detail}`} onClick={() => select(selected ? null : row.id)}><span className="br-title">{row.title}</span><span className="br-sub">{row.detail}</span></button>}
      {!(row.isBase && row.state === 'merged') && <Chip row={row} />}
      <span className="br-slot">{action}</span>
    </div>
    {notice && <p className={`br-notice is-${notice.tone}`} role="status"><span>{notice.text}</span>{notice.tone === 'warn' && <button type="button" className="br-icon" aria-label="Descartar aviso" onClick={() => dismiss(row.id)}><X size={12} aria-hidden="true" /></button>}</p>}
    {open === 'save' && <SaveForm row={row} base={base} busy={busy} onCancel={() => setMode(null)} onSubmit={(message, integrate) => act(row, 'save', { message, integrate })} />}
    {open === 'remove' && <div className="br-form"><p>¿Limpiar «{row.title}»? Ya está en {base}.</p><div className="br-actions"><button type="button" className="br-button is-danger" disabled={busy} onClick={() => act(row, 'remove')}>Limpiar</button><button type="button" className="br-button" onClick={() => setMode(null)}>Cancelar</button></div></div>}
    {selected && !wide && <div className="br-inline">{detail}</div>}
  </li>;
}

export default function Branches({ workspace, api, notify, onOpenPanel, active = true }) {
  const enabled = Boolean(workspace?.id);
  const resource = useResource(api, 'branch.overview', { workspaceId: workspace?.id }, { enabled });
  // Tasks and Skills that live in a branch: optional context, never blocks the Git view.
  const cards = useResource(api, 'phantom.list', { workspaceId: workspace?.id, topic: 'tasks' }, { enabled });
  const skills = useResource(api, 'skills.catalog', { workspaceId: workspace?.id }, { enabled });
  const op = useOperation(notify);
  const [query, setQuery] = useState(''), [mode, setMode] = useState(null), [notices, setNotices] = useState({}), [bulk, setBulk] = useState(null);
  const [selectedId, setSelectedId] = useState(null), [armed, setArmed] = useState(null);
  const [filter, setFilter] = useState(''), [foldOpen, setFoldOpen] = useState(null);
  const timers = useRef(new Map());
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);
  const [root, setRoot] = useState(null), [wide, setWide] = useState(false);
  const { data, reload } = resource;
  const last = useRef(null); if (data) last.current = data;
  const shown = data || last.current;
  useEffect(() => {
    if (!enabled || !active) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !op.busy) { reload(); cards.reload(); } }, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, active, reload, op.busy, cards.reload]);
  // The detail sits beside the list when there is room, and under its row when not.
  useEffect(() => {
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= WIDE));
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);

  const catalog = cards.data?.available !== false ? cards.data?.items || [] : [];
  const content = useMemo(() => contentByBranch({ cards: catalog, skills: skills.data?.items, baseBranch: shown?.base?.branch }), [cards.data, skills.data, shown?.base?.branch]);
  const model = useMemo(() => buildBranches(shown, { query, filter, content, cards: catalog }), [shown, query, filter, content, cards.data]);
  useEffect(() => { if (filter && !model.counts[filter]) setFilter(''); }, [filter, model.counts]);
  const dismiss = id => { clearTimeout(timers.current.get(id)); timers.current.delete(id); setNotices(old => { const next = { ...old }; delete next[id]; return next; }); };
  const note = (row, tone, text) => {
    clearTimeout(timers.current.get(row.id)); timers.current.delete(row.id);
    setNotices(old => ({ ...old, [row.id]: { tone, text } }));
    if (tone === 'ok') timers.current.set(row.id, setTimeout(() => dismiss(row.id), 6000));
  };
  const call = (method, row, extra = {}) => api(method, { workspaceId: workspace.id, branch: row.name, ...extra });
  const settle = (row, result, base, saved = false) => {
    if (result.status === 'conflict') { note(row, 'warn', `${saved ? 'Guardada, pero no integrada' : 'No se integró'}: ${list(result.conflicts)} ${result.conflicts.length > 1 ? 'chocan' : 'choca'} con ${base}.`); return false; }
    if (result.status === 'checks-failed') { note(row, 'warn', `${saved ? 'Guardada, pero no integrada' : 'No se integró'}: los tests fallaron.`); return false; }
    note(row, 'ok', result.status === 'merged' ? `Integrada en ${base}.` : result.status === 'updated' ? `Al día con ${base}.` : 'Hecho.');
    return true;
  };
  const act = (row, kind, options = {}) => op.run(async () => {
    const base = model.base;
    setArmed(null);
    try {
      if (kind === 'save') {
        const saved = await call('branch.commit', row, { message: options.message });
        if (options.integrate) settle(row, await call('branch.integrate', row), base, true);
        else note(row, 'ok', `${plural(saved.files, 'archivo guardado', 'archivos guardados')}.`);
      } else if (kind === 'integrate') settle(row, await call('branch.integrate', row), base);
      else if (kind === 'update') settle(row, await call('branch.update', row), base);
      else if (kind === 'remove') { await call('branch.remove', row); notify?.(`«${row.title}» limpiada`, 'success'); }
      setMode(null);
    } finally { await reload(); if (kind !== 'update') skills.reload(); }
  });
  const runBulk = kind => op.run(async () => {
    const rows = kind === 'remove' ? model.removable : model.updatable; let done = 0;
    try {
      for (const row of rows) {
        try { const result = await call(kind === 'remove' ? 'branch.remove' : 'branch.update', row); if (kind === 'remove' || settle(row, result, model.base)) done++; }
        catch (error) { note(row, 'warn', error.message); }
      }
      notify?.(kind === 'remove' ? `${plural(done, 'rama limpiada', 'ramas limpiadas')} de ${rows.length}` : `${plural(done, 'rama puesta', 'ramas puestas')} al día de ${rows.length}`, done === rows.length ? 'success' : undefined);
      setBulk(null);
    } finally { await reload(); }
  });

  if (!enabled) return <EmptyState className="tw-empty" description="Abre una carpeta para ver sus ramas." />;
  if (!shown) return <div className="br-root">{resource.error ? <ErrorNotice error={resource.error} retry={reload} /> : <p className="br-quiet br-pad" role="status">Leyendo ramas…</p>}</div>;
  if (!shown.available) return <div className="br-root"><div className="br-pad"><p className="br-warning">{shown.reason || 'Git no está disponible en esta carpeta.'}</p><button type="button" className="br-button" onClick={reload}><RefreshCw size={14} aria-hidden="true" />Reintentar</button></div></div>;
  const baseRow = model.baseRow, base = model.base;
  const selected = model.rows.find(row => row.id === selectedId) || null;
  const select = id => { setSelectedId(id); setArmed(null); };
  const shared = { base, wide, busy: op.busy, mode, setMode, armed, setArmed, act, select, onOpenPanel, dismiss };
  const landedOpen = Boolean(query.trim() || filter === 'merged' || model.landed.some(row => row.id === selectedId) || (foldOpen ?? model.landed.length <= 3));
  const bulkOf = kind => bulk === kind && <div className="br-bulk" role="group">
    <span>{kind === 'remove' ? `¿Limpiar ${plural(model.removable.length, 'rama', 'ramas')} ya ${model.removable.length === 1 ? 'integrada' : 'integradas'}?` : `¿Poner al día ${plural(model.updatable.length, 'rama', 'ramas')} con ${base}?`}</span>
    <button type="button" className={`br-button ${kind === 'remove' ? 'is-danger' : 'is-primary'}`} disabled={op.busy} onClick={() => runBulk(kind)}>{kind === 'remove' ? 'Limpiar todas' : 'Poner todas al día'}</button><button type="button" className="br-button" onClick={() => setBulk(null)}>Cancelar</button>
  </div>;
  const rowsOf = rows => <ul className="br-group">{rows.map(row => <Row key={row.id} row={row} {...shared} selected={selected?.id === row.id} notice={notices[row.id]} detail={selected?.id === row.id && !wide ? detailOf(row) : null} />)}</ul>;
  const detailOf = (row, onClose) => <Detail row={row} base={base} checks={shown.checks || ''} cards={cardsOf(row, content.get(row.name || row.worktree?.path), catalog)} skills={content.get(row.name)?.skills || []} busy={op.busy} armed={armed} setArmed={setArmed} act={act} setMode={setMode} onOpenPanel={onOpenPanel} onClose={onClose} skip={onClose ? null : row.action} />;
  return <div className={`br-root${wide && selected ? ' has-detail' : ''}`} ref={setRoot}>
    <div className="br-list">
      <div className="br-tools">
        <label className="br-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label="Buscar rama, tarea o archivo" placeholder="Buscar rama o archivo" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} /></label>
        <button type="button" className="br-icon" aria-label="Actualizar" title="Actualizar" disabled={resource.loading} onClick={() => { reload(); cards.reload(); }}><RefreshCw size={14} className={resource.loading ? 'spinning' : ''} /></button>
      </div>
      {model.filters.length >= 2 && <div className="br-filters" role="group" aria-label="Filtrar por estado">{[{ id: '', label: 'Todas', count: model.matched }, ...model.filters].map(item => <button key={item.id} type="button" className="br-filter" aria-pressed={filter === item.id} onClick={() => setFilter(filter === item.id ? '' : item.id)}>{item.label} <span className="br-filter-count">{item.count}</span></button>)}</div>}
      <ErrorNotice error={op.error} clear={op.clear} />
      {resource.error && <ErrorNotice error={`No se pudo leer Git: ${resource.error.message}`} retry={reload} />}
      {baseRow && <section className="br-section" aria-label={base}>
        <ul className="br-group"><Row row={baseRow} {...shared} selected={false} notice={notices[baseRow.id]} detail={null} /></ul>
        {shown.integration?.enabled && <p className="br-quiet br-under">El orquestador integra las ramas listas</p>}
      </section>}
      {model.total > 0 && <section className="br-section" aria-label={model.title}>
        <div className="br-group-head"><h3 className="br-group-title">{model.title}</h3>{model.updatable.length > 0 && <button type="button" className="br-button is-quiet is-small" aria-label={`Poner al día ${plural(model.updatable.length, 'rama', 'ramas')}`} disabled={op.busy} onClick={() => setBulk('update')}>Poner al día {model.updatable.length}</button>}</div>
        {bulkOf('update')}
        {model.active.length > 0 && rowsOf(model.active)}
        {!model.visible && <EmptyState className="br-quiet" size="compact" description={query.trim() ? <>Ninguna rama coincide con «{query}».</> : 'Ninguna rama en este estado.'} />}
      </section>}
      {model.landed.length > 0 && <section className="br-section" aria-label={`Ya en ${base}`}>
        <div className="br-group-head"><button type="button" className="br-fold" aria-expanded={landedOpen} onClick={() => setFoldOpen(!landedOpen)}><ChevronRight size={14} aria-hidden="true" />Ya en {base} <span className="br-filter-count">{model.landed.length}</span></button>{model.removable.length > 0 && <button type="button" className="br-button is-quiet is-small" aria-label={`Limpiar ${plural(model.removable.length, 'rama', 'ramas')} ya ${model.removable.length === 1 ? 'integrada' : 'integradas'}`} disabled={op.busy} onClick={() => setBulk('remove')}>Limpiar {model.removable.length}</button>}</div>
        {bulkOf('remove')}
        {landedOpen && rowsOf(model.landed)}
      </section>}
      {!model.total && <EmptyState className="br-quiet" size="compact" description="Aún no hay ramas. Cada sesión nueva crea la suya." />}
    </div>
    {wide && selected && <aside className="br-detail" aria-label={`Detalle de ${selected.title}`}>{detailOf(selected, () => select(null))}</aside>}
  </div>;
}
