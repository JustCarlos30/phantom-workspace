import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, Check, ChevronDown, ChevronRight, Copy, FileCode2, FileDiff, FolderGit2, FolderOpen, GitBranch, GitCommitHorizontal, GitMerge, Network, Pencil, RefreshCw, RotateCcw, Save, Search, SquareTerminal, Tag, X } from 'lucide-react';
import { ErrorNotice, useOperation, useResource } from './PluginPrimitives';
import Incorporaciones from './Incorporaciones.jsx';
import { buildBranches, changeLabel, commitsText, filesText, plural, shortBranch } from '../hooks/branches-model.mjs';
import { diffStats, parseDiff, parseRefs } from '../hooks/repo-graph.mjs';
import Graph from './RepoGraph.jsx';
import '../repository.css';

// Repositorio: one place for the whole repository, laid out like a Git client.
// Left: worktrees, branches and integrations. Center: the commit graph, plus
// diff and editor tabs. Right: what is selected (a commit or a worktree's
// uncommitted work). Git is the source; writes go through the host, which
// refuses anything that would lose work or overwrite a newer file.
const POLL_MS = 8000;
const STATUS = { M: 'Modificado', A: 'Añadido', D: 'Borrado', R: 'Renombrado', C: 'Copiado', T: 'Tipo cambiado', U: 'En conflicto' };
const statusTone = code => code === 'D' ? 'removed' : code === 'A' ? 'added' : code === 'U' ? 'conflict' : 'modified';
const statusLetter = status => { const code = (status || '').replace(/ /g, '')[0] || '?'; return code === '?' ? 'N' : code; };
const fileName = file => file.split('/').pop();
const fileDir = file => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
const fullDate = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }); };
const tabId = tab => `${tab.kind}:${tab.oid || tab.tree}:${tab.path}`;

function usePolling(reload, active, paused) {
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !paused.current) reload(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, reload, paused]);
}

// ---------------------------------------------------------------- Diff & editor tabs

function DiffView({ tab, api, workspace, onEdit }) {
  const payload = tab.oid ? { workspaceId: workspace.id, oid: tab.oid, path: tab.path, ...(tab.originalPath ? { originalPath: tab.originalPath } : {}) } : { workspaceId: workspace.id, tree: tab.tree, path: tab.path };
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
      <span className="rp-quiet">{tab.oid ? `Commit ${tab.oid.slice(0, 7)}` : 'Contra el último commit'}</span>
      <button type="button" className="rp-icon" title="Releer" aria-label="Releer diff" onClick={resource.reload}><RefreshCw size={13} className={resource.loading ? 'spinning' : ''} /></button>
      {tab.tree && tab.status !== 'D' && <button type="button" className="rp-button" onClick={onEdit}><Pencil size={13} aria-hidden="true" />Editar</button>}
    </div>
    {resource.error && <ErrorNotice error={resource.error} retry={resource.reload} />}
    {resource.data?.truncated && <p className="rp-warning rp-pad-x">Diff recortado: es demasiado grande para mostrarlo entero.</p>}
    {!resource.loading && resource.data && !body.length && <p className="rp-quiet rp-pad">{rows.some(row => /Binary files/.test(row.text)) ? 'Archivo binario: no hay diff de texto.' : 'Sin diferencias de contenido (puede ser un cambio de modo o un archivo vacío).'}</p>}
    <div className="rp-diff" role="table" aria-label={`Diff de ${tab.path}`}>
      {body.map((row, index) => <div role="row" key={index} className={`rp-diff-row is-${row.kind}`}>
        <span className="rp-ln" role="cell">{row.old ?? ''}</span><span className="rp-ln" role="cell">{row.new ?? ''}</span>
        <span className="rp-mark" role="cell">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
        <span className="rp-code" role="cell">{row.text || ' '}</span>
      </div>)}
    </div>
  </div>;
}

function EditorView({ tab, api, workspace, notify, onDirty, onSaved }) {
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
      <button type="button" className="rp-button is-primary" disabled={!dirty || busy} onClick={save}><Save size={13} aria-hidden="true" />Guardar <kbd>Ctrl S</kbd></button>
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

function FileRow({ status, path, extra, onOpen, onEdit, title }) {
  const letter = statusLetter(status);
  return <li className="rp-filerow">
    <button type="button" className="rp-filerow-main" onClick={onOpen} title={title || path}>
      <span className={`rp-status is-${letter === 'N' ? 'added' : statusTone(letter)}`} aria-label={letter === 'N' ? 'Nuevo' : STATUS[letter] || changeLabel(status)}>{letter}</span>
      <span className="rp-filename">{fileName(path)}</span><span className="rp-filedir">{fileDir(path)}</span>
      {extra}
    </button>
    {onEdit && <button type="button" className="rp-icon is-small" title="Abrir en el editor" aria-label={`Editar ${path}`} onClick={onEdit}><Pencil size={12} /></button>}
  </li>;
}

function CommitDetail({ oid, api, workspace, graph, onOpenTab, onSelectCommit }) {
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
      <ul className="rp-filelist">{commit.files.map(file => <FileRow key={`${file.status}:${file.path}`} status={file.status} path={file.path} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
        extra={file.added !== undefined && <span className="rp-filestat">{file.added === null ? 'bin' : <><span className="is-add">+{file.added}</span> <span className="is-del">−{file.removed}</span></>}</span>}
        onOpen={() => onOpenTab({ kind: 'diff', oid: commit.oid, path: file.path, originalPath: file.originalPath, status: file.status })} />)}</ul>
    </div>
  </div>;
}

function FileFinder({ tree, api, workspace, onOpen }) {
  const resource = useResource(api, 'repo.files', { workspaceId: workspace.id, tree: tree.worktree.path });
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const files = resource.data?.files || [], text = query.trim().toLowerCase();
    if (!text) return files.slice(0, 60);
    const parts = text.split(/\s+/);
    return files.filter(file => { const lower = file.toLowerCase(); return parts.every(part => lower.includes(part)); }).sort((a, b) => a.length - b.length).slice(0, 60);
  }, [resource.data, query]);
  return <div className="rp-finder">
    <label className="rp-search"><Search size={12} aria-hidden="true" /><input autoFocus type="search" placeholder="Buscar archivo en este worktree" aria-label="Buscar archivo en este worktree" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && results[0]) onOpen(results[0]); }} /></label>
    {resource.error && <ErrorNotice error={resource.error} retry={resource.reload} />}
    <ul className="rp-filelist">{results.map(file => <li key={file} className="rp-filerow"><button type="button" className="rp-filerow-main" onClick={() => onOpen(file)} title={file}><FileCode2 size={12} aria-hidden="true" className="rp-quiet" /><span className="rp-filename">{fileName(file)}</span><span className="rp-filedir">{fileDir(file)}</span></button></li>)}</ul>
    {resource.data?.truncated && <p className="rp-quiet">Lista recortada: afina la búsqueda.</p>}
  </div>;
}

function TreeDetail({ tree, base, api, workspace, busy, act, notice, onOpenTab, onOpenPanel, onSelectCommit }) {
  const [message, setMessage] = useState(''), [finder, setFinder] = useState(false), [showCommitted, setShowCommitted] = useState(false);
  useEffect(() => { setMessage(''); setFinder(false); }, [tree.id]);
  const path = tree.worktree?.path;
  const open = (change, kind) => onOpenTab({ kind, tree: path, treeTitle: tree.title, path: change.path, status: statusLetter(change.status) });
  return <div className="rp-detail-body">
    <div className="rp-detail-head">
      <p className="rp-kicker">{tree.isBase ? <GitMerge size={13} aria-hidden="true" /> : tree.terminal ? <SquareTerminal size={13} aria-hidden="true" /> : <FolderGit2 size={13} aria-hidden="true" />}{tree.isBase ? 'Rama de integración' : 'Worktree'} · <span className={tree.running ? 'rp-live' : ''}>{tree.where}</span></p>
      <h3 className="rp-detail-title">{tree.title}</h3>
      <p className="rp-quiet">{tree.name ? <code>{tree.name}</code> : 'HEAD separado'}{tree.oid && <> · <button type="button" className="rp-link" onClick={() => onSelectCommit(tree.oid)}><code>{tree.oid.slice(0, 7)}</code></button></>}</p>
      {path && <p className="rp-quiet rp-path" title={path}>{path}</p>}
      <p className="rp-summary">{tree.summary}</p>
      <div className="rp-actions">
        {tree.terminal && onOpenPanel && <button type="button" className="rp-button" onClick={() => onOpenPanel('terminal', { focusNodeId: tree.terminal.nodeId })}><SquareTerminal size={13} aria-hidden="true" />Ver terminal</button>}
        {tree.exists && <button type="button" className="rp-button" aria-expanded={finder} onClick={() => setFinder(value => !value)}><FolderOpen size={13} aria-hidden="true" />Abrir archivo…</button>}
      </div>
      {finder && tree.exists && <FileFinder tree={tree} api={api} workspace={workspace} onOpen={file => { setFinder(false); onOpenTab({ kind: 'edit', tree: path, treeTitle: tree.title, path: file }); }} />}
      {tree.conflicts.length > 0 && <p className="rp-warning"><AlertTriangle size={12} aria-hidden="true" />Integrarla chocaría en {tree.conflicts.slice(0, 4).join(', ')}{tree.conflicts.length > 4 ? '…' : ''}.</p>}
      {tree.overlaps?.length > 0 && <p className="rp-overlap">Comparte {filesText(tree.overlaps.length)} con {[...new Set(tree.overlaps.flatMap(item => item.with))].map(shortBranch).join(', ')}: el orden de integración importa.</p>}
      {tree.error && <p className="rp-warning">Git no pudo leer esta rama: {tree.error}</p>}
      {notice && <p className={`rp-notice is-${notice.tone}`} role="status">{notice.text}</p>}
    </div>

    <div className="rp-detail-section">
      <h4>Cambios sin guardar <span className="rp-count">{tree.changeCount}</span></h4>
      {!tree.changeCount && <p className="rp-quiet">Árbol limpio.</p>}
      <ul className="rp-filelist">{tree.changes.map(change => <FileRow key={`${change.status}:${change.path}`} status={change.status} path={change.path}
        extra={change.inBase && <span className="rp-same">ya en {base}</span>}
        onOpen={() => open(change, 'diff')} onEdit={statusLetter(change.status) !== 'D' && tree.exists ? () => open(change, 'edit') : undefined} />)}</ul>
      {tree.changeCount > tree.changes.length && <p className="rp-quiet">y {tree.changeCount - tree.changes.length} más</p>}
    </div>

    {tree.committedCount > 0 && <div className="rp-detail-section">
      <button type="button" className="rp-disclosure" aria-expanded={showCommitted} onClick={() => setShowCommitted(value => !value)}>{showCommitted ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<h4>En commits por integrar <span className="rp-count">{tree.committedCount}</span></h4></button>
      {showCommitted && <ul className="rp-filelist">{tree.committed.map(file => <FileRow key={file} status="M" path={file} onOpen={() => onOpenTab({ kind: 'edit', tree: path, treeTitle: tree.title, path: file })} />)}</ul>}
    </div>}

    {(tree.can.commit || tree.can.integrate || tree.can.update) && <form className="rp-commit" onSubmit={event => { event.preventDefault(); act(tree, 'save', { message: message.trim() || `Guardar trabajo de ${tree.title}` }).then(result => { if (result?.ok) setMessage(''); }); }}>
      {tree.can.commit && <>
        <label className="rp-field"><span>Mensaje del commit</span><input value={message} maxLength={500} placeholder={`Guardar trabajo de ${tree.title}`} onChange={event => setMessage(event.target.value)} /></label>
        <button type="submit" className="rp-button is-primary is-wide" disabled={busy}><Save size={13} aria-hidden="true" />Commit de {filesText(tree.changeCount)} en {shortBranch(tree.name)}</button>
      </>}
      <div className="rp-actions">
        {tree.can.integrate && <button type="button" className="rp-button" disabled={busy} onClick={() => act(tree, 'integrate')}><GitMerge size={13} aria-hidden="true" />Integrar {commitsText(tree.ahead)} en {base}</button>}
        {tree.can.update && <button type="button" className="rp-button" disabled={busy} onClick={() => act(tree, 'update')}><ArrowDownToLine size={13} aria-hidden="true" />Traer {base}</button>}
      </div>
    </form>}
  </div>;
}

// ---------------------------------------------------------------- Sidebar

function SideSection({ title, count, open, onToggle, children, action }) {
  return <section className="rp-side-section">
    <div className="rp-side-head"><button type="button" className="rp-disclosure" aria-expanded={open} onClick={onToggle}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span>{title}</span>{count !== undefined && <span className="rp-count">{count}</span>}</button>{action}</div>
    {open && children}
  </section>;
}

function Sidebar({ model, merge, selected, onSelectTree, onSelectCommit, onOpenIntegrations, filter, setFilter }) {
  const [open, setOpen] = useState({ trees: true, branches: true, integrations: true });
  const toggle = key => setOpen(old => ({ ...old, [key]: !old[key] }));
  const all = [model.baseRow, ...model.groups.flatMap(group => group.rows)].filter(Boolean);
  const text = filter.trim().toLowerCase();
  const visible = all.filter(row => !text || `${row.title}\n${row.name || ''}`.toLowerCase().includes(text));
  const trees = visible.filter(row => row.worktree), branches = visible.filter(row => !row.worktree);
  const queue = merge?.queue || [];
  return <aside className="rp-side" aria-label="Worktrees, ramas e integraciones">
    <label className="rp-search rp-side-search"><Search size={12} aria-hidden="true" /><input type="search" placeholder="Filtrar" aria-label="Filtrar worktrees y ramas" value={filter} onChange={event => setFilter(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setFilter(''); }} /></label>
    <div className="rp-side-scroll">
      <SideSection title="Worktrees" count={trees.length} open={open.trees} onToggle={() => toggle('trees')}>
        <ul className="rp-side-list">{trees.map(row => <li key={row.id}>
          <button type="button" className={`rp-side-item${selected?.kind === 'tree' && selected.id === row.id ? ' is-selected' : ''}`} onClick={() => onSelectTree(row.id)} title={`${row.name || 'HEAD separado'}\n${row.worktree.path}`}>
            {row.isBase ? <GitMerge size={13} aria-hidden="true" /> : row.terminal ? <SquareTerminal size={13} aria-hidden="true" className={row.running ? 'rp-live' : ''} /> : <FolderGit2 size={13} aria-hidden="true" />}
            <span className="rp-side-name">{row.title}</span>
            <span className="rp-side-badges">
              {row.changeCount > 0 && <span className="rp-pill is-dirty" title={`${filesText(row.changeCount)} sin guardar`}>✎{row.changeCount}</span>}
              {row.ahead > 0 && <span className="rp-pill is-ahead" title={`${commitsText(row.ahead)} por integrar`}>↑{row.ahead}</span>}
              {row.behind > 0 && <span className="rp-pill is-behind" title={`${commitsText(row.behind)} detrás`}>↓{row.behind}</span>}
              {row.conflicts.length > 0 && <AlertTriangle size={11} className="rp-danger" aria-label="Chocaría al integrar" />}
            </span>
          </button>
        </li>)}</ul>
      </SideSection>
      <SideSection title="Ramas sin worktree" count={branches.length} open={open.branches} onToggle={() => toggle('branches')}>
        {!branches.length && <p className="rp-quiet rp-side-empty">Todas las ramas locales tienen worktree.</p>}
        <ul className="rp-side-list">{branches.map(row => <li key={row.id}>
          <button type="button" className={`rp-side-item${selected?.kind === 'tree' && selected.id === row.id ? ' is-selected' : ''}`} onClick={() => { onSelectTree(row.id); if (row.oid) onSelectCommit(row.oid, true); }} title={row.name}>
            <GitBranch size={13} aria-hidden="true" /><span className="rp-side-name">{row.title}</span>
            <span className="rp-side-badges">{row.ahead > 0 && <span className="rp-pill is-ahead">↑{row.ahead}</span>}{row.behind > 0 && <span className="rp-pill is-behind">↓{row.behind}</span>}</span>
          </button>
        </li>)}</ul>
      </SideSection>
      <SideSection title="Integraciones" count={merge?.enabled ? queue.length : undefined} open={open.integrations} onToggle={() => toggle('integrations')}
        action={<button type="button" className="rp-icon is-small" title="Abrir Incorporaciones" aria-label="Abrir Incorporaciones" onClick={onOpenIntegrations}><Network size={12} /></button>}>
        {!merge ? <p className="rp-quiet rp-side-empty">Consultando…</p> : !merge.available ? <p className="rp-quiet rp-side-empty">{merge.reason || 'No disponible'}</p> : !merge.enabled ? <button type="button" className="rp-side-item" onClick={onOpenIntegrations}><Network size={13} aria-hidden="true" /><span className="rp-side-name">Desactivado · ver cómo funciona</span></button> : <>
          {!queue.length && <p className="rp-quiet rp-side-empty">Nada en cola.</p>}
          <ul className="rp-side-list">{queue.map(item => <li key={item.id}><button type="button" className="rp-side-item" onClick={onOpenIntegrations} title={item.summary || item.branch}>
            <span className={`rp-qpos is-${item.status}`}>{item.position ?? '·'}</span><span className="rp-side-name">{item.title}</span><span className="rp-quiet rp-side-badges">{item.status === 'merging' ? 'incorporando' : item.status === 'conflict' ? 'conflicto' : 'en cola'}</span>
          </button></li>)}</ul>
          {merge.active?.length > 0 && <p className="rp-quiet rp-side-empty">{plural(merge.active.length, 'terminal trabajando', 'terminales trabajando')} sin solicitar</p>}
        </>}
      </SideSection>
    </div>
  </aside>;
}

// ---------------------------------------------------------------- Panel

export default function Repository({ workspace, api, notify, onOpenPanel, active = true }) {
  const enabled = Boolean(workspace?.id);
  const [limit, setLimit] = useState(400);
  const overview = useResource(api, 'branch.overview', { workspaceId: workspace?.id }, { enabled });
  const graph = useResource(api, 'repo.graph', { workspaceId: workspace?.id, limit }, { enabled });
  const merge = useResource(api, 'merge.status', { workspaceId: workspace?.id }, { enabled });
  const op = useOperation(notify);
  const paused = useRef(false); paused.current = op.busy;
  const reloadAll = useCallback(() => Promise.all([overview.reload(), graph.reload(), merge.reload()]), [overview.reload, graph.reload, merge.reload]);
  usePolling(reloadAll, enabled && active, paused);

  const lastOverview = useRef(null); if (overview.data) lastOverview.current = overview.data;
  const lastGraph = useRef(null); if (graph.data) lastGraph.current = graph.data;
  const shown = overview.data || lastOverview.current, history = graph.data || lastGraph.current;
  const model = useMemo(() => buildBranches(shown), [shown]);
  const rows = useMemo(() => [model.baseRow, ...model.groups.flatMap(group => group.rows)].filter(Boolean), [model]);

  const [selected, setSelected] = useState(null), [query, setQuery] = useState(''), [filter, setFilter] = useState(''), [notices, setNotices] = useState({});
  const [tabs, setTabs] = useState([]), [current, setCurrent] = useState('graph'), [dirtyTabs, setDirtyTabs] = useState({});
  const selectedTree = selected?.kind === 'tree' ? rows.find(row => row.id === selected.id) : null;
  // First view: the project checkout, like a Git client opening on the current branch.
  useEffect(() => { if (!selected && model.baseRow) setSelected({ kind: 'tree', id: model.baseRow.id }); }, [selected, model.baseRow]);

  const selectCommit = useCallback((oid, keepTree = false) => { if (!keepTree) setSelected({ kind: 'commit', oid }); setCurrent('graph'); requestAnimationFrame(() => document.querySelector(`.rp-graph-row[data-oid="${oid}"]`)?.scrollIntoView({ block: 'nearest' })); }, []);
  const selectTree = useCallback(id => setSelected({ kind: 'tree', id }), []);
  const openTab = useCallback(tab => {
    const id = tabId(tab);
    setTabs(old => old.some(item => item.id === id) ? old : [...old, { ...tab, id }]);
    setCurrent(id);
  }, []);
  const closeTab = id => {
    if (dirtyTabs[id] && !window.confirm('Este archivo tiene cambios sin guardar en el editor. ¿Cerrarlo y descartarlos?')) return;
    setTabs(old => { const index = old.findIndex(tab => tab.id === id), next = old.filter(tab => tab.id !== id); if (current === id) setCurrent(next[Math.max(0, index - 1)]?.id || 'graph'); return next; });
    setDirtyTabs(old => { const next = { ...old }; delete next[id]; return next; });
  };
  const markDirty = useMemo(() => {
    const cache = new Map();
    return id => { if (!cache.has(id)) cache.set(id, value => setDirtyTabs(old => Boolean(old[id]) === value ? old : { ...old, [id]: value })); return cache.get(id); };
  }, []);

  const note = (row, tone, text) => setNotices(old => ({ ...old, [row.id]: { tone, text } }));
  const call = (method, row, extra = {}) => api(method, { workspaceId: workspace.id, branch: row.name, ...extra });
  const settle = (row, result) => {
    if (result.status === 'conflict') { note(row, 'warn', `No se hizo: choca en ${result.conflicts.slice(0, 4).join(', ')}. El merge se deshizo y nada cambió.`); return; }
    if (result.status === 'checks-failed') { note(row, 'warn', `No se integró: los checks fallaron (${result.checks.command}, código ${result.checks.code}). El merge se deshizo y nada cambió.`); return; }
    note(row, 'ok', result.status === 'merged' ? `Integrada en ${model.base}${result.checks ? ` · checks OK` : ''}.` : result.status === 'updated' ? `Al día con ${model.base}.` : 'Hecho.');
  };
  const act = (row, kind, options = {}) => op.run(async () => {
    try {
      if (kind === 'save') { const saved = await call('branch.commit', row, { message: options.message }); note(row, 'ok', `Commit con ${filesText(saved.files)} en ${shortBranch(row.name)}.`); }
      else if (kind === 'integrate') settle(row, await call('branch.integrate', row));
      else if (kind === 'update') settle(row, await call('branch.update', row));
    } finally { await reloadAll(); }
  });

  if (!enabled) return <p className="tw-empty">Abre una carpeta para ver su repositorio.</p>;
  if (!shown) return <div className="rp-root">{overview.error ? <div className="rp-pad"><ErrorNotice error={overview.error} retry={reloadAll} /></div> : <p className="rp-quiet rp-pad" role="status">Leyendo el repositorio…</p>}</div>;
  if (!shown.available) return <div className="rp-root"><div className="rp-pad"><p className="rp-warning">{shown.reason || 'Git no está disponible en esta carpeta.'}</p><button type="button" className="rp-button" onClick={reloadAll}><RefreshCw size={13} aria-hidden="true" />Reintentar</button></div></div>;

  const loading = overview.loading || graph.loading;
  const tab = tabs.find(item => item.id === current);
  return <div className="rp-root">
    <header className="rp-bar">
      <span className="rp-brand"><FolderGit2 size={15} aria-hidden="true" /><b>{shown.base.path.split('/').pop()}</b></span>
      <span className="rp-ref is-base is-head"><GitMerge size={10} aria-hidden="true" />{model.base}</span>
      <span className="rp-quiet rp-bar-stats">{plural(rows.filter(row => row.worktree).length, 'worktree', 'worktrees')} · {filesText(model.unsaved + (model.baseRow?.changeCount || 0))} sin guardar · {commitsText(model.pending)} por integrar</span>
      <span className="rp-spacer" />
      <label className="rp-search"><Search size={12} aria-hidden="true" /><input type="search" placeholder="Buscar commit, autor, SHA o rama" aria-label="Buscar en la historia" value={query} onChange={event => { setQuery(event.target.value); setCurrent('graph'); }} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} /></label>
      <button type="button" className="rp-icon" aria-label="Actualizar" title="Actualizar" disabled={loading} onClick={reloadAll}><RefreshCw size={14} className={loading ? 'spinning' : ''} /></button>
    </header>
    {(overview.error || graph.error) && <div className="rp-pad-x"><ErrorNotice error={`No se pudo releer Git: ${(overview.error || graph.error).message}. Se muestra la última lectura.`} retry={reloadAll} /></div>}
    {op.error && <div className="rp-pad-x"><ErrorNotice error={op.error} clear={op.clear} /></div>}
    <div className="rp-main">
      <Sidebar model={model} merge={merge.data} selected={selected} filter={filter} setFilter={setFilter} onSelectTree={selectTree} onSelectCommit={selectCommit} onOpenIntegrations={() => setCurrent('integrations')} />
      <section className="rp-center">
        <nav className="rp-tabs" role="tablist" aria-label="Vistas">
          <button type="button" role="tab" aria-selected={current === 'graph'} className="rp-tab" onClick={() => setCurrent('graph')}><Network size={13} aria-hidden="true" />Grafo</button>
          <button type="button" role="tab" aria-selected={current === 'integrations'} className="rp-tab" onClick={() => setCurrent('integrations')}><GitMerge size={13} aria-hidden="true" />Incorporaciones{merge.data?.enabled && merge.data.queue?.length ? <span className="rp-count">{merge.data.queue.length}</span> : null}</button>
          {tabs.map(item => <span key={item.id} role="tab" aria-selected={current === item.id} className="rp-tab is-file" title={`${item.path}${item.oid ? ` @ ${item.oid.slice(0, 7)}` : item.treeTitle ? ` · ${item.treeTitle}` : ''}`}>
            <button type="button" className="rp-tab-open" onClick={() => setCurrent(item.id)}>{item.kind === 'edit' ? <FileCode2 size={12} aria-hidden="true" /> : <FileDiff size={12} aria-hidden="true" />}{fileName(item.path)}<span className="rp-tab-where">{item.oid ? item.oid.slice(0, 7) : item.treeTitle}</span>{dirtyTabs[item.id] && <span className="rp-dirty-dot" aria-label="sin guardar" />}</button>
            <button type="button" className="rp-tab-close" aria-label={`Cerrar ${item.path}`} onClick={() => closeTab(item.id)}><X size={11} /></button>
          </span>)}
        </nav>
        <div className="rp-center-body">
          {current === 'graph' && <Graph graph={history} trees={rows} base={model.base} query={query} selected={selected} onSelectCommit={selectCommit} onSelectTree={selectTree} onMore={() => setLimit(value => Math.min(2000, value + 400))} />}
          {current === 'integrations' && <div className="rp-inc"><Incorporaciones workspace={workspace} api={api} notify={notify} onOpenPanel={onOpenPanel} active={active} /></div>}
          {tabs.map(item => <div key={item.id} className="rp-tab-panel" hidden={current !== item.id}>
            {item.kind === 'diff'
              ? <DiffView tab={item} api={api} workspace={workspace} onEdit={() => openTab({ kind: 'edit', tree: item.tree, treeTitle: item.treeTitle, path: item.path })} />
              : <EditorView tab={item} api={api} workspace={workspace} notify={notify} onDirty={markDirty(item.id)} onSaved={overview.reload} />}
          </div>)}
          {tab === undefined && current !== 'graph' && current !== 'integrations' && <p className="rp-quiet rp-pad">Pestaña cerrada.</p>}
        </div>
      </section>
      <aside className="rp-detail" aria-label="Detalle">
        {selected?.kind === 'commit' && <CommitDetail key={selected.oid} oid={selected.oid} api={api} workspace={workspace} graph={history} onOpenTab={openTab} onSelectCommit={selectCommit} />}
        {selectedTree && <TreeDetail tree={selectedTree} base={model.base} api={api} workspace={workspace} busy={op.busy} act={act} notice={notices[selectedTree.id]} onOpenTab={openTab} onOpenPanel={onOpenPanel} onSelectCommit={selectCommit} />}
        {!selected && <p className="rp-quiet rp-pad">Selecciona un commit o un worktree.</p>}
        {selected?.kind === 'tree' && !selectedTree && <p className="rp-quiet rp-pad">Ese worktree ya no existe.</p>}
      </aside>
    </div>
  </div>;
}
