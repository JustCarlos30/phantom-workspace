import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, Check, FolderGit2, GitBranch, GitMerge, Layers, RefreshCw, Save, Search, Sparkles, SquareTerminal, Trash2 } from 'lucide-react';
import { ErrorNotice, useOperation, useResource } from './PluginPrimitives';
import { buildBranches, changeLabel, changeTone, commitsText, contentByBranch, filesText, plural, shortBranch, span } from '../hooks/branches-model.mjs';
import '../branches.css';

// Ramas: every branch of the repository on one rail, with the worktree that
// holds it and the work it still carries. Actions are explicit, one at a time,
// and the host refuses anything that would lose work.
const POLL_MS = 8000;
const REQUEST = { queued: 'En cola de Incorporaciones', merging: 'Incorporándose', conflict: 'Devuelta por conflicto', failed: 'Devuelta: checks fallidos' };
const when = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

function Track({ row }) {
  const label = [row.behind && `${commitsText(row.behind)} detrás`, row.ahead && `${commitsText(row.ahead)} propios`, row.changeCount && `${filesText(row.changeCount)} sin guardar`].filter(Boolean).join(', ') || 'al día';
  return <div className="br-track" role="img" aria-label={`Posición respecto a la base: ${label}`}>
    <span className="br-seg br-behind" style={{ width: span(row.behind) }}>{row.behind > 0 && row.behind}</span>
    <span className="br-point" />
    <span className="br-seg br-ahead" style={{ width: span(row.ahead) }}>{row.ahead > 0 && row.ahead}</span>
    <span className="br-seg br-unsaved" style={{ width: span(row.changeCount) }}>{row.changeCount > 0 && row.changeCount}</span>
  </div>;
}

function FileList({ row, base }) {
  const total = row.changeCount + row.committedCount;
  if (!total) return null;
  return <details className="br-files">
    <summary>Ver {filesText(total)}</summary>
    {row.changes.length > 0 && <><h5>Sin guardar</h5><ul>{row.changes.map(change => <li key={`${change.status}:${change.path}`}><span className={`br-change br-${changeTone(change.status)}`}>{changeLabel(change.status)}</span><code>{change.path}</code>{change.inBase && <span className="br-same">Ya en {base}</span>}</li>)}</ul>{row.changeCount > row.changes.length && <p className="br-quiet">y {row.changeCount - row.changes.length} más</p>}</>}
    {row.committed.length > 0 && <><h5>En commits por integrar</h5><ul>{row.committed.map(file => <li key={file}><span className="br-change br-modified">Commit</span><code>{file}</code></li>)}</ul>{row.committedCount > row.committed.length && <p className="br-quiet">y {row.committedCount - row.committed.length} más</p>}</>}
  </details>;
}

function SaveForm({ row, base, busy, onSubmit, onCancel }) {
  const [message, setMessage] = useState(`Guardar trabajo de ${row.title}`);
  const [integrate, setIntegrate] = useState(!row.isBase);
  return <form className="br-form" onSubmit={event => { event.preventDefault(); onSubmit(message.trim(), integrate && !row.isBase); }}>
    <label className="br-field"><span>Mensaje del commit</span><input value={message} onChange={event => setMessage(event.target.value)} maxLength={500} required autoFocus /></label>
    <p className="br-quiet">Se guardan los {filesText(row.changeCount)} de este worktree en un commit de <code>{shortBranch(row.name)}</code>, incluidos los nuevos.{row.running ? ' La terminal tiene una sesión activa: se guarda lo que haya escrito hasta ahora.' : ''}</p>
    {!row.isBase && <label className="br-check"><input type="checkbox" checked={integrate} onChange={event => setIntegrate(event.target.checked)} />Integrar en {base} al guardar</label>}
    <div className="br-actions"><button type="submit" className="br-button is-primary" disabled={busy || !message.trim()}><Save size={14} aria-hidden="true" />{integrate && !row.isBase ? `Guardar e integrar en ${base}` : 'Guardar'}</button><button type="button" className="br-button" onClick={onCancel}>Cancelar</button></div>
  </form>;
}

function Row({ row, base, content, busy, notice, mode, setMode, act, onOpenPanel }) {
  const open = mode?.id === row.id ? mode.kind : null;
  const toggle = kind => setMode(open === kind ? null : { id: row.id, kind });
  return <article className={`br-row br-${row.group}`} aria-label={`Rama ${row.title}`}>
    <header className="br-row-head">
      {row.owned && onOpenPanel ? <button type="button" className="br-name is-link" title="Ver esta terminal" onClick={() => onOpenPanel('terminal', { focusNodeId: row.terminal.nodeId })}><SquareTerminal size={14} aria-hidden="true" />{row.title}</button> : <span className="br-name">{row.isBase ? <GitMerge size={14} aria-hidden="true" /> : <GitBranch size={14} aria-hidden="true" />}{row.title}</span>}
      <span className={`br-where${row.running ? ' is-live' : ''}`}>{row.where}</span>
      {!row.isBase && <Track row={row} />}
    </header>
    <p className="br-summary">{row.summary}{row.last?.subject ? <span className="br-quiet"> · último commit: {row.last.subject}{row.last.at ? ` (${when(row.last.at)})` : ''}</span> : null}</p>
    <p className="br-meta" title={row.worktree?.path || ''}>{row.name ? <code>{row.name}</code> : 'Sin rama'}{row.worktree?.path && <span> · {row.worktree.path}</span>}</p>
    {(content?.cards.length > 0 || content?.skills.length > 0 || row.request || row.terminal?.step) && <div className="br-chips">
      {content?.cards.length > 0 && <button type="button" className="br-chip is-button" onClick={() => onOpenPanel?.('phantom-cards')} title={content.cards.map(card => card.title).join('\n')}><Layers size={11} aria-hidden="true" />{plural(content.cards.length, 'Card', 'Cards')} en este worktree</button>}
      {content?.skills.length > 0 && <button type="button" className="br-chip is-button" onClick={() => onOpenPanel?.('skills-catalog')} title={content.skills.map(skill => skill.name).join('\n')}><Sparkles size={11} aria-hidden="true" />{plural(content.skills.length, 'Skill', 'Skills')} sin integrar</button>}
      {row.request && <span className="br-chip">{REQUEST[row.request]}</span>}
      {row.terminal?.step && <span className="br-chip" title={row.terminal.step}>{row.terminal.step.slice(0, 80)}</span>}
    </div>}
    {row.conflicts.length > 0 && <p className="br-warning"><AlertTriangle size={13} aria-hidden="true" />Integrarla chocaría en {row.conflicts.slice(0, 4).join(', ')}{row.conflicts.length > 4 ? '…' : ''}. Resuélvelo en su terminal trayendo {base} a la rama; desde aquí no se fuerza.</p>}
    {row.overlaps?.length > 0 && <p className="br-overlap">Toca {filesText(row.overlaps.length)} que también cambia {[...new Set(row.overlaps.flatMap(item => item.with))].map(shortBranch).join(', ')}: {row.overlaps.slice(0, 3).map(item => item.path).join(', ')}{row.overlaps.length > 3 ? '…' : ''}. El orden de integración importa.</p>}
    {row.error && <p className="br-warning">Git no pudo leer esta rama: {row.error}</p>}
    {!row.exists && row.worktree && <p className="br-warning">La carpeta del worktree ya no existe en disco.</p>}
    {notice && <p className={`br-notice is-${notice.tone}`} role="status">{notice.tone === 'ok' ? <Check size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}{notice.text}</p>}
    {row.changeCount > 0 && row.pendingCount === 0 && <p className="br-overlap">Todo lo que tiene sin guardar ya está idéntico en {base}: este worktree solo está desactualizado, no guarda trabajo propio.</p>}
    <FileList row={row} base={base} />
    {open === 'save' && <SaveForm row={row} base={base} busy={busy} onCancel={() => setMode(null)} onSubmit={(message, integrate) => act(row, 'save', { message, integrate })} />}
    {open === 'remove' && <div className="br-form"><p>Se quita el worktree{row.exists ? '' : ' (ya borrado del disco)'} y se borra la rama <code>{row.name}</code>. No se pierde trabajo: no tiene cambios sin guardar y todos sus commits están en {base}.</p><div className="br-actions"><button type="button" className="br-button is-danger" disabled={busy} onClick={() => act(row, 'remove')}><Trash2 size={14} aria-hidden="true" />Limpiar rama y worktree</button><button type="button" className="br-button" onClick={() => setMode(null)}>Cancelar</button></div></div>}
    {!open && (row.can.commit || row.can.integrate || row.can.update || row.can.remove) && <div className="br-actions">
      {row.can.commit && <button type="button" className="br-button is-primary" disabled={busy} onClick={() => toggle('save')}><Save size={14} aria-hidden="true" />Guardar cambios…</button>}
      {row.can.integrate && <button type="button" className={`br-button${row.can.commit ? '' : ' is-primary'}`} disabled={busy} onClick={() => act(row, 'integrate')}><GitMerge size={14} aria-hidden="true" />Integrar {commitsText(row.ahead)} en {base}</button>}
      {row.can.update && <button type="button" className="br-button" disabled={busy} onClick={() => act(row, 'update')}><ArrowDownToLine size={14} aria-hidden="true" />Poner al día desde {base}</button>}
      {row.can.remove && <button type="button" className="br-button" disabled={busy} onClick={() => toggle('remove')}><Trash2 size={14} aria-hidden="true" />Limpiar…</button>}
    </div>}
  </article>;
}

export default function Branches({ workspace, api, notify, onOpenPanel, active = true }) {
  const enabled = Boolean(workspace?.id);
  const resource = useResource(api, 'branch.overview', { workspaceId: workspace?.id }, { enabled });
  // Cards and Skills that live in worktrees: optional context, never blocks the Git view.
  const cards = useResource(api, 'phantom.list', { workspaceId: workspace?.id, topic: 'tasks' }, { enabled });
  const skills = useResource(api, 'skills.catalog', { workspaceId: workspace?.id }, { enabled });
  const op = useOperation(notify);
  const [query, setQuery] = useState(''), [mode, setMode] = useState(null), [notices, setNotices] = useState({}), [bulk, setBulk] = useState(null);
  const { data, reload } = resource;
  const last = useRef(null); if (data) last.current = data;
  const shown = data || last.current;
  useEffect(() => {
    if (!enabled || !active) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !op.busy) reload(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, active, reload, op.busy]);

  const model = useMemo(() => buildBranches(shown, { query }), [shown, query]);
  const content = useMemo(() => contentByBranch({ cards: cards.data?.available !== false ? cards.data?.items : [], skills: skills.data?.items }), [cards.data, skills.data]);
  const note = (row, tone, text) => setNotices(old => ({ ...old, [row.id]: { tone, text } }));
  const call = (method, row, extra = {}) => api(method, { workspaceId: workspace.id, branch: row.name, ...extra });
  const settle = (row, result, base, saved = false) => {
    if (result.status === 'conflict') { note(row, 'warn', `${saved ? 'Guardado en su rama, pero no integrado' : 'No se hizo'}: choca en ${result.conflicts.slice(0, 4).join(', ')}${result.conflicts.length > 4 ? '…' : ''}. El merge se deshizo${saved ? '' : ' y nada cambió'}. Resuélvelo en su terminal trayendo ${base} a la rama.`); return false; }
    if (result.status === 'checks-failed') { note(row, 'warn', `No se integró: los checks fallaron (${result.checks.command}, código ${result.checks.code}${result.checks.timedOut ? ', tiempo agotado' : ''}). El merge se deshizo y ${base} quedó como estaba.`); return false; }
    note(row, 'ok', result.status === 'merged' ? `Integrada en ${base}${result.checks ? ` · checks OK (${result.checks.command})` : ''}.` : result.status === 'updated' ? `Al día con ${base}.` : 'Hecho.');
    return true;
  };
  const act = (row, kind, options = {}) => op.run(async () => {
    const base = model.base;
    try {
      if (kind === 'save') {
        const saved = await call('branch.commit', row, { message: options.message });
        if (options.integrate) settle(row, await call('branch.integrate', row), base, true);
        else note(row, 'ok', `${filesText(saved.files)} guardados en un commit de la rama.`);
      } else if (kind === 'integrate') settle(row, await call('branch.integrate', row), base);
      else if (kind === 'update') settle(row, await call('branch.update', row), base);
      else if (kind === 'remove') { await call('branch.remove', row); notify?.(`Rama ${shortBranch(row.name)} limpiada`, 'success'); }
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
  if (!shown) return <div className="br-root">{resource.error ? <ErrorNotice error={resource.error} retry={reload} /> : <p className="br-quiet br-pad" role="status">Leyendo ramas y worktrees…</p>}</div>;
  if (!shown.available) return <div className="br-root"><div className="br-pad"><p className="br-warning">{shown.reason || 'Git no está disponible en esta carpeta.'}</p><button type="button" className="br-button" onClick={reload}><RefreshCw size={14} aria-hidden="true" />Reintentar</button></div></div>;
  const baseRow = model.baseRow, base = model.base;
  return <div className="br-root">
    <header className="br-head">
      <div className="br-title"><FolderGit2 size={16} aria-hidden="true" /><div><h2>Ramas</h2><p>{model.total ? `${plural(model.total, 'rama', 'ramas')} además de ${base} · ${filesText(model.unsaved)} sin guardar${model.unsavedInBase ? ` (${model.unsavedInBase} ya en ${base})` : ''} · ${commitsText(model.pending)} por integrar` : `Solo existe ${base}`}</p></div></div>
      <label className="br-search"><Search size={13} aria-hidden="true" /><input type="search" aria-label="Buscar rama, terminal o archivo" placeholder="Buscar rama, terminal o archivo" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} /></label>
      <button type="button" className="br-icon" aria-label="Actualizar" title="Actualizar" disabled={resource.loading} onClick={reload}><RefreshCw size={14} className={resource.loading ? 'spinning' : ''} /></button>
    </header>
    <div className="br-body">
      <ErrorNotice error={op.error} clear={op.clear} />
      {resource.error && <ErrorNotice error={`No se pudo releer Git: ${resource.error.message}. Se muestra la última lectura.`} retry={reload} />}
      {baseRow && <section className="br-base" aria-label="Rama de integración">
        <div className="br-base-main"><span className="br-base-name"><GitMerge size={15} aria-hidden="true" />{base}</span><code>{baseRow.oid.slice(0, 8)}</code><span className="br-quiet">Rama de integración · {baseRow.worktree?.path || 'sin checkout'}</span></div>
        <div className="br-legend" aria-hidden="true"><span><i className="br-behind" />commits que le faltan</span><span><i className="br-ahead" />commits propios</span><span><i className="br-unsaved" />archivos sin guardar</span></div>
        {baseRow.changeCount > 0 && <div className="br-base-dirty">
          <p><AlertTriangle size={13} aria-hidden="true" />El checkout del proyecto tiene {filesText(baseRow.changeCount)} sin guardar. Las terminales nuevas parten del último commit y no los ven.</p>
          <FileList row={baseRow} base={base} />
          {notices[baseRow.id] && <p className={`br-notice is-${notices[baseRow.id].tone}`} role="status">{notices[baseRow.id].text}</p>}
          {mode?.id === baseRow.id ? <SaveForm row={baseRow} base={base} busy={op.busy} onCancel={() => setMode(null)} onSubmit={message => act(baseRow, 'save', { message })} /> : <div className="br-actions"><button type="button" className="br-button" disabled={op.busy} onClick={() => setMode({ id: baseRow.id, kind: 'save' })}><Save size={14} aria-hidden="true" />Guardar en {base}…</button></div>}
        </div>}
        {shown.integration?.enabled && <p className="br-quiet">Incorporaciones está activo: lo habitual es que la sesión orquestadora integre. Lo que hagas aquí es una decisión directa tuya sobre Git.</p>}
      </section>}
      {(model.updatable.length > 0 || model.removable.length > 0) && <section className="br-bulk" aria-label="Orden rápido">
        {bulk ? <><p>{bulk === 'remove' ? `Se quitan ${plural(model.removable.length, 'worktree y su rama', 'worktrees y sus ramas')}: ${model.removable.map(row => shortBranch(row.name)).join(', ')}. Ninguna tiene terminal en el canvas, cambios sin guardar ni commits fuera de ${base}.` : `Se avanzan ${plural(model.updatable.length, 'rama', 'ramas')} sin trabajo propio hasta ${base} (fast-forward). No toca archivos editados.`}</p>
          <div className="br-actions"><button type="button" className={`br-button ${bulk === 'remove' ? 'is-danger' : 'is-primary'}`} disabled={op.busy} onClick={() => runBulk(bulk)}>{bulk === 'remove' ? 'Limpiar todas' : 'Poner todas al día'}</button><button type="button" className="br-button" onClick={() => setBulk(null)}>Cancelar</button></div></>
          : <div className="br-actions">
            {model.updatable.length > 0 && <button type="button" className="br-button" disabled={op.busy} onClick={() => setBulk('update')}><ArrowDownToLine size={14} aria-hidden="true" />Poner al día {plural(model.updatable.length, 'rama', 'ramas')} sin trabajo</button>}
            {model.removable.length > 0 && <button type="button" className="br-button" disabled={op.busy} onClick={() => setBulk('remove')}><Trash2 size={14} aria-hidden="true" />Limpiar {plural(model.removable.length, 'rama', 'ramas')} sin terminal</button>}
          </div>}
      </section>}
      {op.busy && <p className="br-quiet" role="status">Trabajando en Git…</p>}
      {model.total > 0 && !model.visible && <EmptyState className="br-quiet" description={<>Ninguna rama coincide con «{query}».</>} />}
      {model.groups.filter(group => group.rows.length).map(group => <section key={group.id} className={`br-group br-${group.id}`} aria-label={group.title}>
        <h3 className="br-group-title" title={group.hint}><i aria-hidden="true" />{group.title}<span>{group.rows.length}</span></h3>
        <p className="br-quiet br-group-hint">{group.hint}</p>
        {group.rows.map(row => <Row key={row.id} row={row} base={base} content={content.get(row.name)} busy={op.busy} notice={notices[row.id]} mode={mode} setMode={setMode} act={act} onOpenPanel={onOpenPanel} />)}
      </section>)}
      {!model.total && <EmptyState className="br-quiet" description="No hay más ramas ni worktrees en este repositorio. Cada terminal nueva crea la suya." />}
    </div>
  </div>;
}
import EmptyState from './EmptyState.jsx';
