import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDiff, X } from 'lucide-react';
import { groupByFolder, nextSelection, parseDiffLines, placePanel, sameFiles, summarize } from '../hooks/touched-files.mjs';
import '../touched-files.css';

const POLL_MS = 5000;
const STATUS = { A: 'Nuevo', M: 'Modificado', D: 'Eliminado', R: 'Renombrado' };

function plural(count) { return `${count} ${count === 1 ? 'archivo' : 'archivos'}`; }

function Stat({ added, removed }) {
  if (added === null && removed === null) return null;
  return <span className="tf-stat">{added !== null && <span className="tf-add">+{added}</span>}{removed !== null && <span className="tf-del">−{removed}</span>}</span>;
}

const CARD_SELECTORS = ['.canvas-node', '.pt-card', '.pc', '.phantom-chat'];
function findCard(el) {
  for (const selector of CARD_SELECTORS) { const found = el?.closest(selector); if (found) return found; }
  return null;
}

function DiffView({ api, workspaceId, tree, file }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    api('repo.diff', { workspaceId, tree, path: file.path, ...(file.originalPath ? { originalPath: file.originalPath } : {}), against: 'base' })
      .then(value => { if (live) setState({ text: value?.text || '', truncated: !!value?.truncated }); })
      .catch(err => { if (live) setState({ error: err?.message || String(err) }); });
    return () => { live = false; };
  }, [api, workspaceId, tree, file.path, file.originalPath, file.added, file.removed]);
  const lines = useMemo(() => parseDiffLines(state.text), [state.text]);
  if (state.loading) return <p className="tf-note" role="status">Cargando diff…</p>;
  if (state.error) return <p className="tf-note" role="alert">No se pudo leer el diff: {state.error}</p>;
  if (!lines.length) return <p className="tf-note">Sin diff de texto para este archivo.</p>;
  return <>
    <div className="tf-diff" role="group" aria-label={`Diff de ${file.path}`}>
      {lines.map((line, index) => <div key={index} className={`tf-line is-${line.kind}`}><span aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span><code>{line.text || ' '}</code></div>)}
    </div>
    {state.truncated && <p className="tf-note">diff recortado</p>}
  </>;
}

export default function TouchedFiles({ node, workspace, api, enabled = true }) {
  const tree = node.data?.worktree?.path;
  const root = useRef(null), button = useRef(null), pop = useRef(null), list = useRef(null), previous = useRef([]);
  const [visible, setVisible] = useState(true);
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [place, setPlace] = useState(null);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);

  useEffect(() => {
    if (!tree || typeof IntersectionObserver === 'undefined') return;
    const target = root.current?.closest('.pt-card') || root.current?.parentElement;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, [tree]);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const active = !!tree && enabled && visible && !hidden && typeof api === 'function';
  useEffect(() => { setResult(null); setOpen(false); setSelected(null); }, [tree]);
  useEffect(() => {
    if (!active) return;
    let live = true, busy = false, timer = null;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await api('repo.changes', { workspaceId: workspace.id, tree });
        if (live && Array.isArray(value?.files)) setResult(prev => prev && sameFiles(prev.files, value.files) && prev.base === value.base && prev.truncated === value.truncated ? prev : { files: value.files, base: value.base, truncated: !!value.truncated });
      } catch { /* Keeps the last list; the next tick retries. */ }
      finally { busy = false; }
    };
    poll();
    timer = setInterval(poll, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [active, api, workspace.id, tree]);

  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) button.current?.focus({ preventScroll: true });
  }, []);

  const files = result?.files;
  const groups = useMemo(() => groupByFolder(files), [files]);
  const flat = useMemo(() => groups.flatMap(group => group.files), [groups]);
  const total = useMemo(() => summarize(files), [files]);

  // Selection follows the list: first file on open, next available when the selected one disappears.
  useEffect(() => {
    if (!open) { previous.current = []; return; }
    const next = nextSelection(flat, selected, previous.current);
    previous.current = flat;
    if (next !== selected) setSelected(next);
  }, [open, flat, selected]);
  useEffect(() => { if (open && files && !files.length) close(false); }, [open, files, close]);
  useEffect(() => { if (open) pop.current?.focus({ preventScroll: true }); }, [open, !!place]);

  // The panel lives on <body>, docked to the session card's outer edge.
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }
    const card = findCard(root.current);
    const measure = () => {
      const rect = (card || button.current)?.getBoundingClientRect();
      if (rect) setPlace(placePanel(rect, { width: window.innerWidth, height: window.innerHeight }));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const observer = card && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(card);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); observer?.disconnect(); };
  }, [open, node.x, node.y, node.width, node.height, node.w, node.h]);

  const onKeyDown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !list.current?.contains(event.target) || !flat.length) return;
    event.preventDefault();
    const index = Math.max(0, flat.findIndex(item => item.path === selected));
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? flat.length - 1 : Math.max(0, Math.min(flat.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const path = flat[target].path;
    setSelected(path);
    const row = [...list.current.querySelectorAll('[data-path]')].find(el => el.dataset.path === path);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  };

  const file = flat.find(item => item.path === selected);
  if (!tree) return null;
  return <span ref={root} className="tf" onDoubleClick={e => e.stopPropagation()}>
    {files?.length > 0 && <button ref={button} type="button" className="tf-badge" aria-haspopup="dialog" aria-expanded={open} title="Archivos tocados en esta sesión" onClick={() => (open ? close() : setOpen(true))}>
      <FileDiff size={14} aria-hidden="true" />
      <span>{plural(total.count)}</span>
      {(total.added > 0 || total.removed > 0) && <span className="tf-stat"><span className="tf-add">+{total.added}</span><span className="tf-del">−{total.removed}</span></span>}
    </button>}
    {open && place && files?.length > 0 && createPortal(<div ref={pop} className={`tf-panel${place.width < 560 ? ' is-stacked' : ''}`} role="dialog" aria-modal="false" aria-label="Archivos tocados" tabIndex={-1} style={{ left: place.left, top: place.top, width: place.width, height: place.height }} onKeyDown={onKeyDown} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <header className="tf-head">
        <h3>Cambios</h3>
        <span className="tf-count">{plural(total.count)}</span>
        <Stat added={total.added} removed={total.removed} />
        <span className="tf-base">{result.base ? `contra ${result.base}` : 'sin rama base'}{result.truncated ? ' · lista recortada' : ''}</span>
        <button type="button" className="tf-close" aria-label="Cerrar archivos tocados" onClick={() => close()}><X size={14} aria-hidden="true" /></button>
      </header>
      <div className="tf-body">
        <div ref={list} className="tf-list">
          {groups.map(group => <section key={group.folder} className="tf-group">
            <h4>{group.folder || 'Raíz'}</h4>
            <ul>
              {group.files.map(item => {
                const current = item.path === selected;
                return <li key={item.path}>
                  <button type="button" className={`tf-file${current ? ' is-selected' : ''}`} data-path={item.path} aria-current={current ? 'true' : undefined} onClick={() => setSelected(item.path)} title={item.path}>
                    <b className={`tf-letter is-${item.status}`} title={STATUS[item.status] || item.status}>{item.status}</b>
                    <span className="tf-name">{item.name}</span>
                    <Stat added={item.added ?? null} removed={item.removed ?? null} />
                    <em className="tf-saved">{item.uncommitted ? 'sin guardar' : 'guardado'}</em>
                  </button>
                </li>;
              })}
            </ul>
          </section>)}
        </div>
        <div className="tf-view">
          {file && <>
            <div className="tf-view-head">
              <b className={`tf-letter is-${file.status}`}>{file.status}</b>
              <span className="tf-path" title={file.path}>{file.path}</span>
              <span className="tf-status">{STATUS[file.status] || file.status}</span>
              <Stat added={file.added ?? null} removed={file.removed ?? null} />
            </div>
            <div className="tf-scroll"><DiffView api={api} workspaceId={workspace.id} tree={tree} file={file} /></div>
          </>}
        </div>
      </div>
    </div>, document.body)}
  </span>;
}
