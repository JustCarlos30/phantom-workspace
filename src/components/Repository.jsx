import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileCode2, FileDiff, Network, RefreshCw, Search, X } from 'lucide-react';
import { ErrorNotice, useOperation, useResource } from './PluginPrimitives';
import { buildBranches, cardsOf, contentByBranch, plural } from '../hooks/branches-model.mjs';
import Graph from './RepoGraph.jsx';
import '../repository.css';
import EmptyState from './EmptyState.jsx';
import { CommitDetail, DiffView, EditorView, TreeDetail } from './repository/RepositoryViews.jsx';
import { Sidebar, fileName } from './repository/RepositoryParts.jsx';

// Historial: the commit graph with its detail, laid out like a Git client.
// Left: sessions and other branches, each with its state. Center: the graph,
// plus diff and editor tabs. Right: what is selected (a commit, or a session's
// unsaved work). Git is the source; writes go through the host, which refuses
// anything that would lose work or overwrite a newer file.
const POLL_MS = 8000;
const tabId = tab => `${tab.kind}:${tab.oid || tab.tree}:${tab.path}`;

function usePolling(reload, active, paused) {
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !paused.current) reload(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, reload, paused]);
}

// ---------------------------------------------------------------- Panel

export default function Repository({ workspace, api, notify, onOpenPanel, active = true }) {
  const enabled = Boolean(workspace?.id);
  const [limit, setLimit] = useState(400);
  const overview = useResource(api, 'branch.overview', { workspaceId: workspace?.id }, { enabled });
  const graph = useResource(api, 'repo.graph', { workspaceId: workspace?.id, limit }, { enabled });
  // Phantom tasks are optional context: which task each session works for. Never blocks Git.
  const cards = useResource(api, 'phantom.list', { workspaceId: workspace?.id, topic: 'tasks' }, { enabled });
  const op = useOperation(notify);
  const paused = useRef(false); paused.current = op.busy;
  const reloadAll = useCallback(() => Promise.all([overview.reload(), graph.reload(), cards.reload()]), [overview.reload, graph.reload, cards.reload]);
  usePolling(reloadAll, enabled && active, paused);
  const catalog = cards.data?.available !== false ? cards.data?.items || [] : [];
  const content = useMemo(() => contentByBranch({ cards: catalog, baseBranch: overview.data?.base?.branch }), [cards.data, overview.data?.base?.branch]);
  const cardsFor = useCallback(row => cardsOf(row, content.get(row.name || row.worktree?.path), catalog), [content, cards.data]);

  const lastOverview = useRef(null); if (overview.data) lastOverview.current = overview.data;
  const lastGraph = useRef(null); if (graph.data) lastGraph.current = graph.data;
  const shown = overview.data || lastOverview.current, history = graph.data || lastGraph.current;
  const model = useMemo(() => buildBranches(shown), [shown]);
  const rows = useMemo(() => [model.baseRow, ...model.rows].filter(Boolean), [model]);

  const [selected, setSelected] = useState(null), [query, setQuery] = useState(''), [filter, setFilter] = useState(''), [notices, setNotices] = useState({});
  const [tabs, setTabs] = useState([]), [current, setCurrent] = useState('graph'), [dirtyTabs, setDirtyTabs] = useState({});
  const selectedTree = selected?.kind === 'tree' ? rows.find(row => row.id === selected.id) : null;
  // First view: main, like a Git client opening on the current branch.
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
    if (result.status === 'conflict') { note(row, 'warn', `No se integró: ${result.conflicts.slice(0, 3).map(fileName).join(', ')}${result.conflicts.length > 3 ? '…' : ''} ${result.conflicts.length > 1 ? 'chocan' : 'choca'} con ${model.base}.`); return; }
    if (result.status === 'checks-failed') { note(row, 'warn', 'No se integró: los tests fallaron.'); return; }
    note(row, 'ok', result.status === 'merged' ? `Integrada en ${model.base}.` : result.status === 'updated' ? `Al día con ${model.base}.` : 'Hecho.');
  };
  const act = (row, kind, options = {}) => op.run(async () => {
    try {
      if (kind === 'save') { const saved = await call('branch.commit', row, { message: options.message }); note(row, 'ok', `${plural(saved.files, 'archivo guardado', 'archivos guardados')}.`); }
      else if (kind === 'integrate') settle(row, await call('branch.integrate', row));
      else if (kind === 'update') settle(row, await call('branch.update', row));
    } finally { await reloadAll(); }
  });

  if (!enabled) return <EmptyState className="tw-empty" description="Abre una carpeta para ver su historial." />;
  if (!shown) return <div className="rp-root">{overview.error ? <div className="rp-pad"><ErrorNotice error={overview.error} retry={reloadAll} /></div> : <p className="rp-quiet rp-pad" role="status">Leyendo el historial…</p>}</div>;
  if (!shown.available) return <div className="rp-root"><div className="rp-pad"><p className="rp-warning">{shown.reason || 'Git no está disponible en esta carpeta.'}</p><button type="button" className="rp-button" onClick={reloadAll}><RefreshCw size={13} aria-hidden="true" />Reintentar</button></div></div>;

  const loading = overview.loading || graph.loading;
  const tab = tabs.find(item => item.id === current);
  return <div className="rp-root">
    <header className="rp-bar">
      <label className="rp-search"><Search size={12} aria-hidden="true" /><input type="search" placeholder="Buscar commit, autor, SHA o rama" aria-label="Buscar en el historial" value={query} onChange={event => { setQuery(event.target.value); setCurrent('graph'); }} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} /></label>
      <span className="rp-spacer" />
      <button type="button" className="rp-icon" aria-label="Actualizar" title="Actualizar" disabled={loading} onClick={reloadAll}><RefreshCw size={14} className={loading ? 'spinning' : ''} /></button>
    </header>
    {(overview.error || graph.error) && <div className="rp-pad-x"><ErrorNotice error={`No se pudo leer Git: ${(overview.error || graph.error).message}`} retry={reloadAll} /></div>}
    {op.error && <div className="rp-pad-x"><ErrorNotice error={op.error} clear={op.clear} /></div>}
    <div className="rp-main">
      <Sidebar model={model} selected={selected} filter={filter} setFilter={setFilter} onSelectTree={selectTree} onSelectCommit={selectCommit} />
      <section className="rp-center">
        {tabs.length > 0 && <nav className="rp-tabs" role="tablist" aria-label="Vistas">
          <button type="button" role="tab" aria-selected={current === 'graph'} className="rp-tab" onClick={() => setCurrent('graph')}><Network size={13} aria-hidden="true" />Commits</button>
          {tabs.map(item => <span key={item.id} role="tab" aria-selected={current === item.id} className="rp-tab is-file" title={`${item.path}${item.oid ? ` @ ${item.oid.slice(0, 7)}` : item.treeTitle ? ` · ${item.treeTitle}` : ''}`}>
            <button type="button" className="rp-tab-open" onClick={() => setCurrent(item.id)}>{item.kind === 'edit' ? <FileCode2 size={12} aria-hidden="true" /> : <FileDiff size={12} aria-hidden="true" />}{fileName(item.path)}<span className="rp-tab-where">{item.oid ? item.oid.slice(0, 7) : item.treeTitle}</span>{dirtyTabs[item.id] && <span className="rp-dirty-dot" aria-label="sin guardar" />}</button>
            <button type="button" className="rp-tab-close" aria-label={`Cerrar ${item.path}`} onClick={() => closeTab(item.id)}><X size={11} /></button>
          </span>)}
        </nav>}
        <div className="rp-center-body">
          {current === 'graph' && <Graph graph={history} trees={rows} base={model.base} query={query} selected={selected} onSelectCommit={selectCommit} onSelectTree={selectTree} onMore={() => setLimit(value => Math.min(2000, value + 400))} />}
          {tabs.map(item => <div key={item.id} className="rp-tab-panel" hidden={current !== item.id}>
            {item.kind === 'diff'
              ? <DiffView tab={item} api={api} workspace={workspace} onEdit={() => openTab({ kind: 'edit', tree: item.tree, treeTitle: item.treeTitle, path: item.path })} />
              : <EditorView tab={item} api={api} workspace={workspace} notify={notify} onDirty={markDirty(item.id)} onSaved={overview.reload} />}
          </div>)}
          {tab === undefined && current !== 'graph' && <p className="rp-quiet rp-pad">Pestaña cerrada.</p>}
        </div>
      </section>
      <aside className="rp-detail" aria-label="Detalle">
        {selected?.kind === 'commit' && <CommitDetail key={selected.oid} oid={selected.oid} api={api} workspace={workspace} graph={history} onOpenTab={openTab} onSelectCommit={selectCommit} />}
        {selectedTree && <TreeDetail tree={selectedTree} cards={cardsFor(selectedTree)} base={model.base} api={api} workspace={workspace} busy={op.busy} act={act} notice={notices[selectedTree.id]} onOpenTab={openTab} onOpenPanel={onOpenPanel} onSelectCommit={selectCommit} />}
        {!selected && <EmptyState className="rp-quiet rp-pad" description="Selecciona un commit o una sesión." />}
        {selected?.kind === 'tree' && !selectedTree && <p className="rp-quiet rp-pad">Esa sesión ya no existe.</p>}
      </aside>
    </div>
  </div>;
}
