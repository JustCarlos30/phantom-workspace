import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, FileCode2, FileDiff, FolderOpen, GitCommitHorizontal, GitMerge, Pencil, RefreshCw, RotateCcw, Save, Search, SquareTerminal } from 'lucide-react';
import { ErrorNotice, useResource } from '../PluginPrimitives';
import { commitsText, filesText, plural } from '../../hooks/branches-model.mjs';
import { buildFileTree, pruneToChanged, visibleRows } from '../../hooks/file-tree.mjs';
import { diffStats, parseDiff, parseRefs } from '../../hooks/repo-graph.mjs';
import EmptyState from '../EmptyState.jsx';
import { FileRow, GroupedFiles, MixBar, fileDir, fileName, statusLetter } from './RepositoryParts.jsx';

const MOD = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '') ? '⌘' : 'Ctrl';
const fullDate = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }); };

// ---------------------------------------------------------------- Diff & editor tabs

export function DiffView({ tab, api, workspace, onEdit }) {
  const payload = tab.oid ? { workspaceId: workspace.id, oid: tab.oid, path: tab.path, ...(tab.originalPath ? { originalPath: tab.originalPath } : {}) } : { workspaceId: workspace.id, tree: tab.tree, path: tab.path, ...(tab.against ? { against: tab.against } : {}), ...(tab.against && tab.originalPath ? { originalPath: tab.originalPath } : {}) };
  const resource = useResource(api, 'repo.diff', payload);
  const rows = useMemo(() => parseDiff(resource.data?.text || ''), [resource.data]);
  const stats = useMemo(() => diffStats(rows), [rows]);
  const body = rows.filter(row => row.kind !== 'meta');
  return <div className="rp-file">
    <div className="rp-file-bar">
      <FileDiff size={14} aria-hidden="true" /><span className="rp-file-path" title={tab.path}>{fileDir(tab.path) && <span className="rp-quiet">{fileDir(tab.path)}/</span>}{fileName(tab.path)}</span>
      {tab.originalPath && <span className="rp-quiet">desde {tab.originalPath}</span>}
      <span className="rp-stat is-add">+{stats.added}</span><span className="rp-stat is-del">−{stats.removed}</span>
      <span className="rp-spacer" />
      <span className="rp-quiet">{tab.oid ? `Commit ${tab.oid.slice(0, 7)}` : tab.against ? `Todo contra ${tab.baseName || 'la base'}` : 'Contra lo último guardado'}</span>
      <button type="button" className="rp-icon" title="Releer" aria-label="Releer diff" onClick={resource.reload}><RefreshCw size={13} className={resource.loading ? 'spinning' : ''} /></button>
      {tab.tree && tab.status !== 'D' && <button type="button" className="rp-button" onClick={onEdit}><Pencil size={13} aria-hidden="true" />Editar</button>}
    </div>
    {resource.error && <ErrorNotice error={resource.error} retry={resource.reload} />}
    {resource.data?.truncated && <p className="rp-warning rp-pad-x">Diff recortado: es demasiado grande para mostrarlo entero.</p>}
    {!resource.loading && resource.data && !body.length && <EmptyState className="rp-quiet rp-pad" description={rows.some(row => /Binary files/.test(row.text)) ? 'Archivo binario: no hay diff de texto.' : 'Sin diferencias de contenido (puede ser un cambio de modo o un archivo vacío).'} />}
    <div className="rp-diff" role="table" aria-label={`Diff de ${tab.path}`}>
      {body.map((row, index) => <div role="row" key={index} className={`rp-diff-row is-${row.kind}`}>
        <span className="rp-ln" role="cell">{row.old ?? ''}</span><span className="rp-ln" role="cell">{row.new ?? ''}</span>
        <span className="rp-mark" role="cell">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
        <span className="rp-code" role="cell">{row.text || ' '}</span>
      </div>)}
    </div>
  </div>;
}

export function EditorView({ tab, api, workspace, notify, onDirty, onSaved }) {
  const [file, setFile] = useState(null), [content, setContent] = useState(''), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const area = useRef(null), gutter = useRef(null);
  const load = useCallback(async () => {
    setError(null); setBusy(true);
    try { const value = await api('repo.file.read', { workspaceId: workspace.id, tree: tab.tree, path: tab.path }); setFile(value); setContent(value.content ?? ''); onDirty(false); }
    catch (failure) { setError(failure); } finally { setBusy(false); }
  }, [api, workspace.id, tab.tree, tab.path, onDirty]);
  useEffect(() => { load(); }, [load]);
  const dirty = Boolean(file?.editable) && content !== file.content;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true); setError(null);
    try {
      const saved = await api('repo.file.write', { workspaceId: workspace.id, tree: tab.tree, path: tab.path, content, hash: file.hash });
      setFile(old => ({ ...old, content, hash: saved.hash, size: saved.size })); notify?.(`${fileName(tab.path)} guardado`, 'success'); onSaved?.();
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  const lines = useMemo(() => content.split('\n').length, [content]);
  const indent = useMemo(() => /^\t/m.test(file?.content || '') ? '\t' : '  ', [file]);
  const keydown = event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const el = event.currentTarget, start = el.selectionStart, end = el.selectionEnd;
      const next = content.slice(0, start) + indent + content.slice(end);
      setContent(next); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + indent.length; });
    }
  };
  return <div className="rp-file">
    <div className="rp-file-bar">
      <FileCode2 size={14} aria-hidden="true" /><span className="rp-file-path" title={tab.path}>{fileDir(tab.path) && <span className="rp-quiet">{fileDir(tab.path)}/</span>}{fileName(tab.path)}</span>
      {dirty && <span className="rp-dirty-dot" title="Cambios sin guardar en el editor" />}
      <span className="rp-spacer" />
      <span className="rp-quiet" title={tab.tree}>{tab.treeTitle}</span>
      <button type="button" className="rp-icon" title="Recargar desde disco" aria-label="Recargar desde disco" disabled={busy} onClick={() => { if (!dirty || window.confirm('Se descartarán los cambios del editor. ¿Recargar desde disco?')) load(); }}><RotateCcw size={13} /></button>
      <button type="button" className="rp-button is-primary" disabled={!dirty || busy} onClick={save}><Save size={13} aria-hidden="true" />Guardar <kbd>{MOD} S</kbd></button>
    </div>
    {error && <ErrorNotice error={error} clear={() => setError(null)} />}
    {file && !file.editable && <p className="rp-warning rp-pad">{file.reason}</p>}
    {!file && busy && <p className="rp-quiet rp-pad" role="status">Abriendo {tab.path}…</p>}
    {file?.editable && <div className="rp-editor">
      <pre className="rp-gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
      <textarea ref={area} className="rp-textarea" value={content} spellCheck={false} wrap="off" aria-label={`Editar ${tab.path}`}
        onChange={event => setContent(event.target.value)} onKeyDown={keydown}
        onScroll={event => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }} />
    </div>}
  </div>;
}

// ---------------------------------------------------------------- Detail pane

export function CommitDetail({ oid, api, workspace, graph, onOpenTab, onSelectCommit }) {
  const resource = useResource(api, 'repo.commit', { workspaceId: workspace.id, oid });
  const commit = resource.data;
  const summary = graph?.commits?.find(item => item.oid === oid);
  const [copied, setCopied] = useState(false);
  if (resource.error) return <div className="rp-pad"><ErrorNotice error={resource.error} retry={resource.reload} /></div>;
  if (!commit) return <p className="rp-quiet rp-pad" role="status">Leyendo commit…</p>;
  const [subject, ...rest] = commit.message.split('\n');
  const added = commit.files.reduce((sum, file) => sum + (file.added || 0), 0), removed = commit.files.reduce((sum, file) => sum + (file.removed || 0), 0);
  return <div className="rp-detail-body">
    <div className="rp-detail-head">
      <p className="rp-kicker"><GitCommitHorizontal size={13} aria-hidden="true" />Commit <code>{commit.oid.slice(0, 10)}</code>
        <button type="button" className="rp-icon is-small" title="Copiar SHA" aria-label="Copiar SHA" onClick={async () => { await navigator.clipboard?.writeText(commit.oid); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check size={12} /> : <Copy size={12} />}</button></p>
      <h3 className="rp-detail-title">{subject}</h3>
      {rest.join('\n').trim() && <pre className="rp-commit-body">{rest.join('\n').trim()}</pre>}
      <p className="rp-quiet">{commit.author} · {fullDate(commit.at)}{commit.committer && commit.committer !== commit.author ? ` · aplicado por ${commit.committer}` : ''}</p>
      {summary?.refs?.length > 0 && <p className="rp-quiet">En: {parseRefs(summary.refs).map(ref => ref.name).join(', ')}</p>}
      {commit.parents.length > 0 && <p className="rp-parents">{commit.parents.length > 1 ? 'Padres' : 'Padre'}: {commit.parents.map(parent => <button key={parent} type="button" className="rp-link" onClick={() => onSelectCommit(parent)}><code>{parent.slice(0, 7)}</code></button>)}{commit.parents.length > 1 && <span className="rp-quiet"> · cambios contra el primero</span>}</p>}
    </div>
    <div className="rp-detail-section">
      <h4>{filesText(commit.files.length)} <span className="rp-stat is-add">+{added}</span> <span className="rp-stat is-del">−{removed}</span></h4>
      <MixBar changes={commit.files} total={commit.files.length} />
      <GroupedFiles items={commit.files} render={(file, hideDir) => <FileRow key={`${file.status}:${file.path}`} status={file.status} path={file.path} hideDir={hideDir} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
        extra={file.added !== undefined && <span className="rp-filestat">{file.added === null ? 'bin' : <><span className="is-add">+{file.added}</span> <span className="is-del">−{file.removed}</span></>}</span>}
        onOpen={() => onOpenTab({ kind: 'diff', oid: commit.oid, path: file.path, originalPath: file.originalPath, status: file.status })} />} />
    </div>
  </div>;
}

const MAX_ROWS = 400;

// Folder explorer: a navigable tree of the worktree (repo.files) marked with what
// changed. With text in the search box it falls back to the flat filtered list.
export function FileExplorer({ tree, api, workspace, changes, expansion, onOpen }) {
  const resource = useResource(api, 'repo.files', { workspaceId: workspace.id, tree: tree.worktree.path });
  const [query, setQuery] = useState(''), [onlyChanged, setOnlyChanged] = useState(false);
  const [expanded, setExpanded] = useState(() => expansion?.get(tree.worktree.path) || new Set());
  const [active, setActive] = useState(null);
  const list = useRef(null), refocus = useRef(false);
  const toggle = useCallback(dir => setExpanded(old => {
    const next = new Set(old); if (!next.delete(dir)) next.add(dir);
    expansion?.set(tree.worktree.path, next);
    return next;
  }), [expansion, tree.worktree.path]);
  const model = useMemo(() => {
    const built = buildFileTree(resource.data?.files || [], changes || []);
    return onlyChanged ? pruneToChanged(built) : built;
  }, [resource.data, changes, onlyChanged]);
  const allRows = useMemo(() => visibleRows(model, onlyChanged ? new Set(collectDirs(model)) : expanded), [model, expanded, onlyChanged]);
  const rows = allRows.slice(0, MAX_ROWS);
  const flat = query.trim() !== '';
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    list.current?.querySelector('[tabindex="0"]')?.focus();
  });
  const activeIndex = Math.max(0, rows.findIndex(row => row.node.path === active));
  const move = index => { const row = rows[Math.min(rows.length - 1, Math.max(0, index))]; if (row) { refocus.current = true; setActive(row.node.path); } };
  const keydown = event => {
    const row = rows[activeIndex];
    if (!row) return;
    const { node } = row, isDir = node.type === 'dir';
    const open = !onlyChanged && row.expanded;
    if (event.key === 'ArrowDown') move(activeIndex + 1);
    else if (event.key === 'ArrowUp') move(activeIndex - 1);
    else if (event.key === 'ArrowRight' && isDir) { if (!open && !onlyChanged) { refocus.current = true; toggle(node.path); } else move(activeIndex + 1); }
    else if (event.key === 'ArrowLeft') {
      if (isDir && open && !onlyChanged) { refocus.current = true; toggle(node.path); }
      else { const parent = rows.findLastIndex((item, index) => index < activeIndex && item.depth < row.depth); if (parent >= 0) move(parent); }
    }
    else if (event.key === 'Enter' || event.key === ' ') { if (isDir) { if (!onlyChanged) { refocus.current = true; toggle(node.path); } } else onOpen(node.path); }
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(rows.length - 1);
    else return;
    event.preventDefault();
  };
  const results = useMemo(() => {
    const files = resource.data?.files || [], text = query.trim().toLowerCase();
    if (!text) return files.slice(0, 60);
    const parts = text.split(/\s+/);
    return files.filter(file => { const lower = file.toLowerCase(); return parts.every(part => lower.includes(part)); }).sort((a, b) => a.length - b.length).slice(0, 60);
  }, [resource.data, query]);
  return <div className="rp-finder">
    <div className="rp-explorer-bar">
      <label className="rp-search"><Search size={12} aria-hidden="true" /><input autoFocus type="search" placeholder="Buscar archivo" aria-label="Buscar archivo en esta sesión" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && flat && results[0]) onOpen(results[0]); }} /></label>
      <button type="button" className="rp-button" aria-pressed={onlyChanged} onClick={() => setOnlyChanged(value => !value)}>Solo cambiados</button>
    </div>
    {resource.error && <ErrorNotice error={resource.error} retry={resource.reload} />}
    {!resource.data && resource.loading && <p className="rp-quiet" role="status">Leyendo archivos…</p>}
    {flat
      ? <ul className="rp-filelist">{results.map(file => <li key={file} className="rp-filerow"><button type="button" className="rp-filerow-main" onClick={() => onOpen(file)} title={file}><FileCode2 size={12} aria-hidden="true" className="rp-quiet" /><span className="rp-filename">{fileName(file)}</span><span className="rp-filedir">{fileDir(file)}</span></button></li>)}</ul>
      : <ul className="rp-tree" role="tree" aria-label="Archivos de la sesión" ref={list} onKeyDown={keydown}>{rows.map(({ node, depth, expanded: open }, index) => {
        const isDir = node.type === 'dir', isOpen = isDir && (onlyChanged || open), letter = node.status ? statusLetter(node.status) : null;
        return <li key={node.path} role="treeitem" aria-level={depth + 1} aria-expanded={isDir ? isOpen : undefined} aria-selected={index === activeIndex} tabIndex={index === activeIndex ? 0 : -1} className="rp-tree-row" style={{ paddingLeft: 6 + depth * 14 }}
          onFocus={() => setActive(node.path)} onClick={() => { setActive(node.path); if (!isDir) onOpen(node.path); else if (!onlyChanged) toggle(node.path); }} title={node.path}>
          {isDir ? (isOpen ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />) : <FileCode2 size={12} aria-hidden="true" className="rp-quiet" />}
          <span className="rp-filename">{node.name}</span>
          {isDir && node.changed > 0 && <span className="rp-count" title={`${plural(node.changed, 'archivo cambiado', 'archivos cambiados')}`}>{node.changed}</span>}
          {letter && <span className={`rp-status is-${letter === 'N' ? 'added' : letter === 'D' ? 'removed' : letter === 'A' ? 'added' : letter === 'U' ? 'conflict' : 'modified'}`} aria-label={`Estado ${letter}`}>{letter}</span>}
        </li>;
      })}</ul>}
    {!flat && !resource.loading && !rows.length && resource.data && <p className="rp-quiet">{onlyChanged ? 'Nada cambiado.' : 'Sin archivos.'}</p>}
    {!flat && allRows.length > rows.length && <p className="rp-quiet">Mostrando {rows.length} de {allRows.length}: pliega carpetas o busca por nombre.</p>}
    {resource.data?.truncated && <p className="rp-quiet">Lista recortada: afina la búsqueda.</p>}
  </div>;
}

function collectDirs(node, out = []) {
  for (const child of node.children) if (child.type === 'dir') { out.push(child.path); collectDirs(child, out); }
  return out;
}

export function TreeDetail({ tree, cards, base, api, workspace, busy, act, pulse, expansion, notice, onOpenTab, onOpenPanel, onSelectCommit }) {
  const [message, setMessage] = useState(''), [finder, setFinder] = useState(false), [armed, setArmed] = useState(false);
  const all = useResource(api, 'repo.changes', { workspaceId: workspace.id, tree: tree.worktree?.path }, { enabled: Boolean(tree.exists && tree.worktree?.path) });
  const reloadAll = all.reload, firstPulse = useRef(pulse);
  useEffect(() => { if (pulse !== firstPulse.current && tree.exists) reloadAll(); }, [pulse]);
  const allFiles = all.data?.files || [];
  const allAdded = allFiles.reduce((sum, file) => sum + (file.added || 0), 0), allRemoved = allFiles.reduce((sum, file) => sum + (file.removed || 0), 0);
  useEffect(() => { setMessage(''); setFinder(false); setArmed(false); }, [tree.id]);
  useEffect(() => { if (!armed) return undefined; const timer = setTimeout(() => setArmed(false), 6000); return () => clearTimeout(timer); }, [armed]);
  const path = tree.worktree?.path;
  const open = (change, kind) => onOpenTab({ kind, tree: path, treeTitle: tree.title, path: change.path, status: statusLetter(change.status) });
  const others = [...new Set((tree.overlaps || []).flatMap(item => item.with))];
  return <div className="rp-detail-body">
    <div className="rp-detail-head">
      <h3 className="rp-detail-title">{tree.title}</h3>
      <p className="rp-kicker">{!(tree.isBase && tree.state === 'merged') && <span className="rp-pill" data-tone={tree.tone}>{tree.stateLabel}</span>}<span>{tree.detail}</span></p>
      <div className="rp-actions">
        {tree.terminal && onOpenPanel && <button type="button" className="rp-button" onClick={() => onOpenPanel('terminal', { focusNodeId: tree.terminal.nodeId })}><SquareTerminal size={13} aria-hidden="true" />Ir a la sesión</button>}
        {tree.exists && <button type="button" className="rp-button" aria-expanded={finder} onClick={() => setFinder(value => !value)}><FolderOpen size={13} aria-hidden="true" />Explorar archivos</button>}
        {onOpenPanel && cards.slice(0, 1).map(card => <button key={card.id} type="button" className="rp-link" title={card.title} onClick={() => onOpenPanel('phantom-cards', { cardId: card.id })}>Ver tarea</button>)}
      </div>
      {finder && tree.exists && <FileExplorer tree={tree} api={api} workspace={workspace} changes={allFiles} expansion={expansion} onOpen={file => { setFinder(false); onOpenTab({ kind: 'edit', tree: path, treeTitle: tree.title, path: file }); }} />}
      {notice && <p className={`rp-notice is-${notice.tone}`} role="status">{notice.text}</p>}
    </div>

    <div className="rp-detail-section">
      <h4>Sin guardar <span className="rp-count">{tree.changeCount}</span></h4>
      {!tree.changeCount && <p className="rp-clean"><Check size={12} aria-hidden="true" />Nada sin guardar.</p>}
      {tree.changeCount > 0 && <MixBar changes={tree.changes} total={tree.changeCount} summary={tree.changeSummary} />}
      <GroupedFiles items={tree.changes} render={(change, hideDir) => <FileRow key={`${change.status}:${change.path}`} status={change.status} path={change.path} hideDir={hideDir}
        title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path} extra={change.inBase && <span className="rp-same">ya en {base}</span>}
        onOpen={() => open(change, 'diff')} onEdit={statusLetter(change.status) !== 'D' && tree.exists ? () => open(change, 'edit') : undefined} />} />
      {tree.changeCount > tree.changes.length && <p className="rp-quiet">y {tree.changeCount - tree.changes.length} más</p>}
    </div>

    {tree.exists && !tree.isBase && <div className="rp-detail-section">
      <h4>Todo contra {base} {all.data && <><span className="rp-count">{allFiles.length}</span> <span className="rp-stat is-add">+{allAdded}</span> <span className="rp-stat is-del">−{allRemoved}</span></>}</h4>
      {all.error && <ErrorNotice error={all.error} retry={all.reload} />}
      {!all.data && all.loading && <p className="rp-quiet" role="status">Leyendo cambios…</p>}
      {all.data && !allFiles.length && <p className="rp-clean"><Check size={12} aria-hidden="true" />Sin diferencias con {base}.</p>}
      {allFiles.length > 0 && <MixBar changes={allFiles} total={allFiles.length} />}
      <GroupedFiles items={allFiles} render={(file, hideDir) => <FileRow key={`${file.status}:${file.path}`} status={file.status} path={file.path} hideDir={hideDir}
        title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
        extra={<>
          {file.uncommitted && <span className="rp-same">sin guardar</span>}{file.committed && <span className="rp-same">guardado</span>}
          <span className="rp-filestat">{file.added === null || file.added === undefined ? 'bin' : <><span className="is-add">+{file.added}</span> <span className="is-del">−{file.removed}</span></>}</span>
        </>}
        onOpen={() => onOpenTab({ kind: 'diff', tree: path, treeTitle: tree.title, path: file.path, originalPath: file.originalPath, status: statusLetter(file.status), against: 'base', baseName: base })} />} />
      {all.data?.truncated && <p className="rp-quiet">Lista recortada.</p>}
    </div>}

    {(tree.can.commit || tree.can.integrate || tree.can.update) && <form className="rp-commit" onSubmit={event => { event.preventDefault(); act(tree, 'save', { message: message.trim() || `Guardar trabajo de ${tree.title}` }).then(result => { if (result?.ok) setMessage(''); }); }}>
      {tree.can.commit && <>
        <label className="rp-field"><span>Mensaje</span><input value={message} maxLength={500} placeholder={`Guardar trabajo de ${tree.title}`} onChange={event => setMessage(event.target.value)} /></label>
        <button type="submit" className="rp-button is-primary is-wide" disabled={busy}><Save size={13} aria-hidden="true" />Guardar {filesText(tree.changeCount)}</button>
      </>}
      <div className="rp-actions">
        {tree.can.integrate && <button type="button" className={`rp-button${tree.can.commit ? '' : ' is-primary'}`} disabled={busy} onBlur={() => setArmed(false)} onClick={() => { if (armed) { setArmed(false); act(tree, 'integrate'); } else setArmed(true); }}><GitMerge size={13} aria-hidden="true" />{armed ? 'Confirmar integrar' : `Integrar en ${base}`}</button>}
        {tree.can.update && <button type="button" className="rp-button" disabled={busy} onClick={() => act(tree, 'update')}>Poner al día con {base}</button>}
      </div>
    </form>}

    <details className="rp-facts">
      <summary>Detalles</summary>
      <dl>
        <dt>Rama</dt><dd>{tree.name ? <code>{tree.name}</code> : 'Sin rama'}{tree.oid && <> · <button type="button" className="rp-link" onClick={() => onSelectCommit(tree.oid)}><code>{tree.oid.slice(0, 7)}</code></button></>}</dd>
        {path && <><dt>Carpeta</dt><dd><code>{path}</code></dd></>}
        {(tree.ahead > 0 || tree.behind > 0) && <><dt>Respecto a {base}</dt><dd>{[tree.ahead > 0 && `${commitsText(tree.ahead)} propios`, tree.behind > 0 && `le faltan ${tree.behind}`].filter(Boolean).join(' · ')}</dd></>}
        {tree.conflicts.length > 0 && <><dt>Chocan con {base}</dt><dd>{tree.conflicts.join(', ')}</dd></>}
        {others.length > 0 && <><dt>También los tocan</dt><dd>{others.join(', ')}</dd></>}
        {tree.error && <><dt>Error de Git</dt><dd>{tree.error}</dd></>}
      </dl>
    </details>
  </div>;
}
