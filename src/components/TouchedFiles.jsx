import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, FileDiff, Maximize2, Minimize2, RefreshCw, Search, X } from 'lucide-react';
import { groupByFolder, nextSelection, parseDiffLines, placePanel, sameFiles, summarize } from '../hooks/touched-files.mjs';
import { ChangesCanvasContext } from './ChangesCanvasContext.jsx';
import { Markdown } from './SkillsMarkdown.jsx';
import '../touched-files.css';

const POLL_MS = 5000;
const STATUS = { A: 'Nuevo', M: 'Modificado', D: 'Eliminado', R: 'Renombrado' };

function plural(count) { return `${count} ${count === 1 ? 'archivo' : 'archivos'}`; }

function Stat({ added = null, removed = null }) {
  if (added === null && removed === null) return null;
  return <span className="tf-stat">{added !== null && <span className="tf-add">+{added}</span>}{removed !== null && <span className="tf-del">−{removed}</span>}</span>;
}

const CARD_SELECTORS = ['.canvas-node', '.pt-card', '.pc', '.phantom-chat'];
function findCard(el) {
  for (const selector of CARD_SELECTORS) { const found = el?.closest(selector); if (found) return found; }
  return null;
}

function reveal(scroller, element) {
  if (!scroller || !element) return;
  const box = scroller.getBoundingClientRect(), row = element.getBoundingClientRect();
  const scale = box.height / scroller.clientHeight || 1;
  if (row.top < box.top) scroller.scrollTop += (row.top - box.top) / scale;
  else if (row.bottom > box.bottom) scroller.scrollTop += (row.bottom - box.bottom) / scale;
}

function diffRows(lines, parallel, fullContext) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === 'meta' && !line.text.startsWith('\\')) continue;
    if (line.kind === 'ctx' && !fullContext) {
      let end = i + 1;
      while (lines[end]?.kind === 'ctx') end++;
      if (end - i > 2) {
        rows.push({ line, key: i }, { hidden: end - i - 2, key: `context-${i}` }, { line: lines[end - 1], key: end - 1 });
        i = end - 1;
        continue;
      }
    }
    if (parallel && (line.kind === 'del' || line.kind === 'add')) {
      const removed = [], added = [];
      const start = i;
      while (lines[i]?.kind === 'del') removed.push(lines[i++]);
      while (lines[i]?.kind === 'add') added.push(lines[i++]);
      for (let n = 0; n < Math.max(removed.length, added.length); n++) rows.push({ left: removed[n], right: added[n], key: `${start}-${n}` });
      i--;
    } else rows.push({ line, key: i });
  }
  return rows;
}

function FileReview({ api, workspaceId, tree, file, revision, wide, active, onComment }) {
  const [state, setState] = useState({ loading: true });
  const [retry, setRetry] = useState(0), [mode, setMode] = useState('diff'), [layout, setLayout] = useState('unified');
  const [content, setContent] = useState({}), [readRetry, setReadRetry] = useState(0);
  const [fullContext, setFullContext] = useState(false), [hunk, setHunk] = useState(0);
  const [range, setRange] = useState(null), [comment, setComment] = useState(''), [notice, setNotice] = useState(''), [commenting, setCommenting] = useState(false);
  const scroll = useRef(null), lastText = useRef(null), lastContent = useRef(null), anchor = useRef(null), mounted = useRef(true);
  const reloadDiff = useRef(null), diffTrigger = useRef({ revision, retry });
  const reloadContent = useRef(null), contentTrigger = useRef({ revision, readRetry });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!active) return;
    let live = true, busy = false, queued = false;
    const read = () => {
      if (!live) return;
      if (busy) { queued = true; return; }
      busy = true;
      setState(old => ({ ...old, loading: true, error: null }));
      Promise.resolve().then(() => api('repo.diff', { workspaceId, tree, path: file.path, ...(file.originalPath ? { originalPath: file.originalPath } : {}), against: 'base' }))
      .then(value => {
        if (!live) return;
        if (typeof value?.text !== 'string') throw new Error('Respuesta de diff no válida.');
        if (lastText.current !== null && lastText.current !== value.text) { setRange(null); anchor.current = null; setNotice('El diff cambió; selecciona de nuevo las líneas.'); }
        lastText.current = value.text;
        setState({ text: value.text, truncated: !!value.truncated, loading: false });
      })
      .catch(err => { if (live) setState(old => ({ ...old, loading: false, error: err?.message || String(err) })); })
      .finally(() => { busy = false; if (live && queued) { queued = false; read(); } });
    };
    diffTrigger.current = { revision, retry };
    reloadDiff.current = read;
    read();
    return () => { live = false; reloadDiff.current = null; };
  }, [active, api, workspaceId, tree, file.path, file.originalPath]);
  useEffect(() => {
    if (diffTrigger.current.revision === revision && diffTrigger.current.retry === retry) return;
    diffTrigger.current = { revision, retry };
    reloadDiff.current?.();
  }, [revision, retry]);
  useEffect(() => {
    if (mode === 'diff' || !active) return;
    let live = true, busy = false, queued = false;
    const read = () => {
      if (!live) return;
      if (busy) { queued = true; return; }
      busy = true;
      setContent(old => ({ ...old, loading: true, error: null }));
      Promise.resolve().then(() => api('repo.file.read', { workspaceId, tree, path: file.path }))
      .then(value => {
        if (!live) return;
        if (typeof value?.content !== 'string') throw new Error(value?.reason || 'Contenido de texto no disponible.');
        if (lastContent.current !== null && lastContent.current !== value.content) { setRange(null); anchor.current = null; setNotice('El archivo cambió; selecciona de nuevo las líneas.'); }
        lastContent.current = value.content;
        setContent({ text: value.content });
      }).catch(err => { if (live) setContent(old => ({ ...old, loading: false, error: err?.message || String(err) })); })
      .finally(() => { busy = false; if (live && queued) { queued = false; read(); } });
    };
    contentTrigger.current = { revision, readRetry };
    reloadContent.current = read;
    read();
    return () => { live = false; reloadContent.current = null; };
  }, [active, api, workspaceId, tree, file.path, mode]);
  useEffect(() => {
    if (contentTrigger.current.revision === revision && contentTrigger.current.readRetry === readRetry) return;
    contentTrigger.current = { revision, readRetry };
    reloadContent.current?.();
  }, [revision, readRetry]);
  const lines = useMemo(() => parseDiffLines(state.text), [state.text]);
  const hunks = useMemo(() => lines.filter(line => line.kind === 'hunk'), [lines]);
  const parallel = wide && layout === 'parallel';
  const rows = useMemo(() => diffRows(lines, parallel, fullContext), [lines, parallel, fullContext]);
  const selectLine = (number, extend) => {
    if (!extend || anchor.current === null) anchor.current = number;
    setRange({ startLine: Math.min(anchor.current, number), endLine: Math.max(anchor.current, number) });
    setNotice('');
  };
  const number = line => line?.newLine != null ? <button type="button" className="tf-ln" aria-label={`Seleccionar línea ${line.newLine}`} aria-pressed={!!range && line.newLine >= range.startLine && line.newLine <= range.endLine} onClick={e => selectLine(line.newLine, e.shiftKey)}>{line.newLine}</button> : <span className="tf-ln" />;
  const selected = line => range && line?.newLine != null && line.newLine >= range.startLine && line.newLine <= range.endLine;
  const side = (line, old) => <div className={`tf-side${line ? ` is-${line.kind}` : ' is-empty'}${selected(line) ? ' is-line-selected' : ''}`}>
    {old ? <span className="tf-ln" title="Línea en la base">{line?.oldLine ?? ''}</span> : number(line)}
    <span className="tf-mark" aria-hidden="true">{line?.kind === 'add' ? '+' : line?.kind === 'del' ? '−' : ' '}</span><code>{line?.text || ' '}</code>
  </div>;
  const navigate = delta => {
    const next = Math.max(0, Math.min(hunks.length - 1, hunk + delta));
    setHunk(next);
    const target = scroll.current?.querySelector(`[data-hunk="${next}"]`);
    if (target && scroll.current) {
      const scale = scroll.current.getBoundingClientRect().height / scroll.current.clientHeight || 1;
      scroll.current.scrollTop += (target.getBoundingClientRect().top - scroll.current.getBoundingClientRect().top) / scale;
    }
  };
  const addComment = async event => {
    event.preventDefault();
    if (!range || !onComment || commenting || !active || state.loading || state.error || (mode !== 'diff' && (content.loading || content.error))) return;
    setCommenting(true); setNotice('');
    try {
      await onComment({ path: file.path, ...range, text: comment.trim() });
      if (mounted.current) { setNotice('Referencia añadida al borrador. No se ha enviado.'); setComment(''); }
    } catch (error) { if (mounted.current) setNotice(`No se pudo añadir la referencia: ${error?.message || String(error)}`); }
    finally { if (mounted.current) setCommenting(false); }
  };
  return <>
    <div className="tf-toolbar" aria-label="Opciones de lectura">
      <div className="tf-modes" role="group" aria-label="Contenido">
        <button type="button" aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>Diff</button>
        {file.status !== 'D' && <button type="button" aria-pressed={mode === 'context'} onClick={() => setMode('context')}>Contexto completo</button>}
        {/\.(md|markdown)$/i.test(file.path) && file.status !== 'D' && <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Vista previa</button>}
      </div>
      {mode === 'diff' && <>
        <div className="tf-modes tf-layout" role="group" aria-label="Disposición del diff">
          <button type="button" aria-pressed={!parallel} onClick={() => setLayout('unified')}>Unificada</button>
          {wide && <button type="button" aria-pressed={parallel} onClick={() => setLayout('parallel')}>Paralela</button>}
        </div>
        <button type="button" aria-pressed={fullContext} onClick={() => setFullContext(value => !value)}>{fullContext ? 'Plegar contexto' : 'Expandir contexto'}</button>
        <span className="tf-hunk-count">{hunks.length ? `${Math.min(hunk + 1, hunks.length)}/${hunks.length} bloques` : '0 bloques'}</span>
        <button type="button" className="tf-icon" aria-label="Bloque anterior" disabled={!hunks.length || hunk === 0} onClick={() => navigate(-1)}><ArrowUp size={16} /></button>
        <button type="button" className="tf-icon" aria-label="Bloque siguiente" disabled={hunk >= hunks.length - 1} onClick={() => navigate(1)}><ArrowDown size={16} /></button>
      </>}
      <button type="button" className="tf-icon" aria-label="Releer archivo" disabled={mode === 'diff' ? state.loading : content.loading} onClick={() => mode === 'diff' ? setRetry(n => n + 1) : setReadRetry(n => n + 1)}><RefreshCw size={16} /></button>
    </div>
    <div ref={scroll} className="tf-scroll" data-tf-scroll="detail">
      {mode === 'diff' ? <>
        {state.loading && <p className="tf-note" role="status">{state.text === undefined ? 'Cargando diff…' : 'Actualizando diff…'}</p>}
        {state.error && <p className="tf-note is-error" role="alert">No se pudo leer el diff: {state.error} <button type="button" onClick={() => setRetry(n => n + 1)}>Reintentar</button>{state.text !== undefined && ' · Se muestra la última lectura.'}</p>}
        {!state.loading && !state.error && !hunks.length && <p className="tf-note">{/Binary files|GIT binary patch/.test(state.text) ? 'Archivo binario: no hay diff de texto.' : 'Sin diferencias de texto; puede ser un cambio de nombre, modo o un archivo vacío.'}</p>}
        <div className={`tf-diff${parallel ? ' is-parallel' : ''}`} role="group" aria-label={`Diff de ${file.path}`}>
          {rows.map(row => {
            if (row.hidden) return <button type="button" key={row.key} className="tf-context-toggle" onClick={() => setFullContext(true)}>Mostrar {row.hidden} {row.hidden === 1 ? 'línea' : 'líneas'} de contexto</button>;
            const line = row.line;
            if (line?.kind === 'hunk') return <div key={row.key} className="tf-hunk" data-hunk={line.hunkIndex}>{line.text}</div>;
            if (line?.kind === 'meta') return <div key={row.key} className="tf-diff-meta">{line.text}</div>;
            if (parallel) return <div key={row.key} className="tf-pair">{side(line || row.left, true)}{side(line || row.right, false)}</div>;
            return <div key={row.key} className={`tf-line is-${line.kind}${selected(line) ? ' is-line-selected' : ''}`}><span className="tf-ln" title="Línea en la base">{line.oldLine ?? ''}</span>{number(line)}<span className="tf-mark" aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span><code>{line.text || ' '}</code></div>;
          })}
        </div>
        {lines.some(line => line.kind === 'meta' && !line.text.startsWith('\\')) && <details className="tf-diff-meta"><summary>Metadatos del diff</summary><pre>{lines.filter(line => line.kind === 'meta' && !line.text.startsWith('\\')).map(line => line.text).join('\n')}</pre></details>}
        {state.truncated && <p className="tf-note">Diff recortado: no se muestran todos los cambios.</p>}
      </> : <>
        <p className="tf-note">Versión actual en disco · no es la versión base.</p>
        {content.loading && <p className="tf-note" role="status">Leyendo archivo…</p>}
        {content.error && <p className="tf-note is-error" role="alert">No se pudo leer el archivo: {content.error} <button type="button" onClick={() => setReadRetry(n => n + 1)}>Reintentar</button>{content.text !== undefined && ' · Se muestra la última lectura.'}</p>}
        {content.text !== undefined && (mode === 'preview' ? <div className="tf-preview"><Markdown source={content.text} /></div> : <div className="tf-source">{content.text.split('\n').map((text, index) => <div key={index} className={`tf-source-line${selected({ newLine: index + 1 }) ? ' is-line-selected' : ''}`}>{number({ newLine: index + 1 })}<code>{text || ' '}</code></div>)}</div>)}
      </>}
    </div>
    {range ? <div className="tf-reference">
      <div className="tf-range"><span>Líneas {range.startLine}–{range.endLine} de la versión actual</span><button type="button" onClick={() => { setRange(null); anchor.current = null; }}>Limpiar selección</button></div>
      {typeof onComment === 'function' && <form onSubmit={addComment}>
        <textarea aria-label="Comentario sobre las líneas" placeholder="Comentario opcional para el borrador…" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
        <button type="submit" disabled={commenting || !active || state.loading || !!state.error || (mode !== 'diff' && (content.loading || !!content.error))}>Añadir al borrador</button>
      </form>}
    </div> : <p className="tf-selection-hint">Selecciona números de línea de la versión actual. Mayús amplía el rango.</p>}
    {notice && <p className="tf-note" role="status">{notice}</p>}
  </>;
}

export default function TouchedFiles({ node, workspace, api, enabled = true, onComment }) {
  const canvas = useContext(ChangesCanvasContext);
  const tree = node.data?.worktree?.path;
  const scope = `${workspace.id}:${tree}`;
  const root = useRef(null), button = useRef(null), pop = useRef(null), list = useRef(null), previous = useRef([]);
  const listDrag = useRef(null);
  const scrollPositions = useRef(new WeakMap()), expandedScrollPositions = useRef(new WeakMap());
  const latestCanvas = useRef(canvas); latestCanvas.current = canvas;
  const [portal] = useState(() => typeof document !== 'undefined' ? document.createElement('div') : null);
  const [visible, setVisible] = useState(true);
  const [snapshot, setResult] = useState(null);
  const result = snapshot?.scope === scope ? snapshot : null;
  const [error, setError] = useState(null), [refresh, setRefresh] = useState(0);
  const [localOpen, setLocalOpen] = useState(false), [localExpanded, setLocalExpanded] = useState(false);
  const [selected, setSelected] = useState(null);
  const [place, setPlace] = useState(null);
  const [query, setQuery] = useState(''), [listWidth, setListWidth] = useState(240), [width, setWidth] = useState(760);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);
  const open = canvas ? canvas.activeId === node.id : localOpen;
  const expanded = canvas ? canvas.expandedId === node.id : localExpanded;
  const host = canvas ? (expanded ? canvas.expandedHost : canvas.host) : typeof document !== 'undefined' ? document.body : null;
  const placement = canvas ? canvas.placement : place;
  const ready = open && !!host && (!!placement || expanded);
  const close = useCallback((restoreFocus = true) => {
    if (canvas) canvas.close(node.id);
    else { setLocalOpen(false); setLocalExpanded(false); }
    if (restoreFocus) button.current?.focus({ preventScroll: true });
  }, [canvas, node.id]);

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

  const active = !!tree && enabled && (visible || open) && !hidden && typeof api === 'function';
  useEffect(() => {
    setResult(null); setError(null); setLocalOpen(false); setLocalExpanded(false); setSelected(null); setQuery(''); previous.current = [];
    return () => { const owner = latestCanvas.current; if (owner?.activeId === node.id) owner.close(node.id); };
  }, [tree, workspace.id, node.id]);
  useEffect(() => {
    if (!active) return;
    let live = true, busy = false, timer = null;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await api('repo.changes', { workspaceId: workspace.id, tree });
        if (!Array.isArray(value?.files) || value.files.some(file => typeof file?.path !== 'string')) throw new Error('Lista de cambios no válida.');
        if (live) {
          setError(null);
          setResult(prev => ({ scope, files: prev?.scope === scope && sameFiles(prev.files, value.files) ? prev.files : value.files, base: value.base, truncated: !!value.truncated, revision: (prev?.revision || 0) + 1 }));
        }
      } catch (failure) { if (live) setError(failure?.message || String(failure)); }
      finally { busy = false; }
    };
    poll();
    timer = setInterval(poll, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [active, api, workspace.id, tree, scope, refresh]);

  const files = result?.files;
  const groups = useMemo(() => groupByFolder(files), [files]);
  const flat = useMemo(() => groups.flatMap(group => group.files), [groups]);
  const filteredGroups = useMemo(() => groups.map(group => ({ ...group, files: group.files.filter(file => file.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter(group => group.files.length), [groups, query]);
  const filtered = useMemo(() => filteredGroups.flatMap(group => group.files), [filteredGroups]);
  const total = useMemo(() => summarize(files), [files]);

  // Selection follows the list: first file on open, next available when the selected one disappears.
  useEffect(() => {
    if (!open) return;
    const next = nextSelection(flat, selected, previous.current);
    previous.current = flat;
    if (next !== selected) setSelected(next);
  }, [open, flat, selected]);
  useLayoutEffect(() => {
    if (!open || !host || !portal) return;
    const current = expanded ? expandedScrollPositions.current : scrollPositions.current;
    const prior = expanded ? scrollPositions.current : expandedScrollPositions.current;
    const positions = [...portal.querySelectorAll('[data-tf-scroll]')].map(el => [el, current.get(el) || prior.get(el) || { top: el.scrollTop, left: el.scrollLeft }]);
    const focused = portal.contains(document.activeElement) ? document.activeElement : null;
    portal.className = 'tf-portal';
    host.appendChild(portal);
    for (const [el, position] of positions) { el.scrollTop = position.top; el.scrollLeft = position.left; }
    if (focused) focused.focus({ preventScroll: true });
  }, [open, host, portal, expanded]);
  useLayoutEffect(() => {
    if (!ready) return;
    pop.current?.focus({ preventScroll: true });
  }, [ready]);
  useEffect(() => () => portal?.remove(), [portal]);
  useLayoutEffect(() => {
    if (!ready || !pop.current) return;
    const measure = () => setWidth(pop.current?.clientWidth || 760);
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(pop.current);
    return () => observer?.disconnect();
  }, [ready, host, expanded]);

  useLayoutEffect(() => {
    if (canvas) return;
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
  }, [!!canvas, open, node.x, node.y, node.width, node.height, node.w, node.h]);

  const onKeyDown = event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !list.current?.contains(event.target) || !filtered.length) return;
    event.preventDefault();
    const index = Math.max(0, filtered.findIndex(item => item.path === selected));
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const path = filtered[target].path;
    setSelected(path);
    const row = [...list.current.querySelectorAll('[data-path]')].find(el => el.dataset.path === path);
    row?.focus({ preventScroll: true });
    reveal(list.current, row);
  };

  const file = flat.find(item => item.path === selected);
  const compact = width < 640;
  const resizeList = value => setListWidth(Math.max(220, Math.min(260, value)));
  const moveList = event => {
    const drag = listDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const scale = pop.current.getBoundingClientRect().width / pop.current.offsetWidth || 1;
    resizeList(drag.width + (event.clientX - drag.x) / scale);
  };
  const toggleExpanded = () => {
    const positions = expanded ? expandedScrollPositions.current : scrollPositions.current;
    for (const el of portal.querySelectorAll('[data-tf-scroll]')) positions.set(el, { top: el.scrollTop, left: el.scrollLeft });
    if (canvas) expanded ? canvas.restore(node.id) : canvas.expand(node.id);
    else setLocalExpanded(value => !value);
  };
  const panelStyle = expanded ? { inset: 16 } : placement ? { left: placement.left, top: placement.top, width: placement.width, height: placement.height } : { inset: 16 };
  if (!tree) return null;
  return <span ref={root} className="tf" onDoubleClick={e => e.stopPropagation()}>
    <button ref={button} type="button" className="tf-badge" aria-haspopup="dialog" aria-expanded={open} title="Archivos tocados en esta sesión" onClick={() => open ? close() : canvas ? canvas.open(node.id) : setLocalOpen(true)}>
      <FileDiff size={14} aria-hidden="true" />
      <span>{files ? plural(total.count) : 'Cambios'}{error ? ' · error' : ''}</span>
      {(total.added > 0 || total.removed > 0) && <span className="tf-stat"><span className="tf-add">+{total.added}</span><span className="tf-del">−{total.removed}</span></span>}
    </button>
    {ready && portal && createPortal(<div ref={pop} className={`tf-panel${canvas ? ' is-canvas' : ' is-fallback'}${compact ? ' is-compact' : ''}${expanded ? ' is-expanded' : ''}`} role="dialog" aria-modal="false" aria-label="Archivos tocados" tabIndex={-1} style={{ ...panelStyle, '--tf-list-width': `${listWidth}px` }} onScrollCapture={e => { if (e.target.dataset.tfScroll) (expanded ? expandedScrollPositions.current : scrollPositions.current).set(e.target, { top: e.target.scrollTop, left: e.target.scrollLeft }); }} onKeyDown={onKeyDown} onKeyUp={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <header className="tf-head">
        <FileDiff size={18} aria-hidden="true" />
        <div className="tf-heading"><h3>Cambios <span className="tf-count">{plural(total.count)}</span></h3><button type="button" className="tf-session" title={tree} onClick={() => { if (expanded) toggleExpanded(); button.current?.focus({ preventScroll: true }); }}>Sesión · {node.title || 'Terminal'}{node.data?.worktree?.branch ? ` · ${node.data.worktree.branch}` : ''}</button></div>
        <Stat added={total.added} removed={total.removed} />
        <button type="button" className="tf-icon" aria-label={expanded ? (canvas ? 'Volver al canvas' : 'Restaurar tamaño') : 'Ampliar cambios'} onClick={toggleExpanded}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button type="button" className="tf-icon tf-close" aria-label="Cerrar archivos tocados" onClick={() => close()}><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="tf-summary"><span className="tf-base">{result?.base ? `Contra ${result.base}` : 'Sin rama base'}{result?.truncated ? ' · Lista recortada' : ''}</span><button type="button" onClick={() => setRefresh(n => n + 1)} aria-label="Actualizar lista"><RefreshCw size={14} />Actualizar</button></div>
      {error && <p className="tf-note is-error" role="alert">No se pudieron actualizar los cambios: {error}{result ? ' · Se conserva la última lista.' : ''} <button type="button" onClick={() => setRefresh(n => n + 1)}>Reintentar</button></p>}
      {!result && !error && <p className="tf-note" role="status">{typeof api !== 'function' ? 'API de cambios no disponible.' : !enabled ? 'Conexión no disponible.' : 'Cargando cambios…'}</p>}
      {result && !active && <p className="tf-note" role="status">Actualización suspendida · se conserva la última lectura.</p>}
      <div className="tf-body">
        <div className="tf-browser">
          <label className="tf-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Buscar archivos" placeholder="Buscar archivos…" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <select className="tf-compact-select" aria-label="Archivo seleccionado" value={filtered.some(item => item.path === selected) ? selected : ''} onChange={e => setSelected(e.target.value)}><option value="" disabled>{filtered.length ? 'Seleccionar archivo' : 'Sin resultados'}</option>{filtered.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}</select>
          <div ref={list} className="tf-list" data-tf-scroll="list" aria-label="Archivos cambiados">
          {filteredGroups.map(group => <section key={group.folder} className="tf-group">
            <h4>{group.folder || 'Raíz'}</h4>
            <ul>
              {group.files.map(item => {
                const current = item.path === selected;
                return <li key={item.path}>
                  <button type="button" className={`tf-file${current ? ' is-selected' : ''}`} data-path={item.path} aria-current={current ? 'true' : undefined} onClick={() => setSelected(item.path)} title={item.path}>
                    <b className={`tf-letter is-${item.status}`} title={STATUS[item.status] || item.status}>{item.status}</b>
                    <span className="tf-name">{item.name}</span>
                    <Stat added={item.added ?? null} removed={item.removed ?? null} />
                  </button>
                </li>;
              })}
            </ul>
          </section>)}
          {result && !filtered.length && <p className="tf-note">{files.length ? 'No hay archivos que coincidan.' : 'No hay cambios contra la base.'}</p>}
          </div>
        </div>
        <div className="tf-resize" role="separator" tabIndex={compact ? -1 : 0} aria-label="Ancho de la lista de archivos" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={260} aria-valuenow={listWidth} onKeyDown={e => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation(); resizeList(e.key === 'Home' ? 220 : e.key === 'End' ? 260 : listWidth + (e.key === 'ArrowRight' ? 10 : -10));
        }} onPointerDown={e => {
          if (e.button !== 0) return;
          e.preventDefault();
          listDrag.current = { pointerId: e.pointerId, x: e.clientX, width: listWidth };
          e.currentTarget.setPointerCapture(e.pointerId);
        }} onPointerMove={moveList} onPointerUp={e => {
          moveList(e); listDrag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }} onPointerCancel={() => { listDrag.current = null; }} onLostPointerCapture={() => { listDrag.current = null; }} />
        <div className="tf-view">
          {file && <>
            <div className="tf-view-head">
              <b className={`tf-letter is-${file.status}`}>{file.status}</b>
              <span className="tf-path" title={file.path}>{file.path}</span>
              <span className="tf-status">{STATUS[file.status] || file.status}</span>
              <Stat added={file.added ?? null} removed={file.removed ?? null} />
            </div>
            <p className="tf-file-state">{file.uncommitted ? 'Cambios sin commit · pueden estar guardados en disco.' : file.uncommitted === false ? 'Sin cambios pendientes de commit en este archivo.' : 'Estado de commit no informado.'}{file.originalPath ? ` · Antes: ${file.originalPath}` : ''}</p>
            <FileReview key={`${workspace.id}:${tree}:${file.path}`} api={api} workspaceId={workspace.id} tree={tree} file={file} revision={result.revision} wide={width - listWidth >= 720} active={active} onComment={onComment} />
          </>}
          {!file && result && <p className="tf-note">{files.length ? 'Selecciona un archivo para ver sus cambios.' : 'No hay cambios contra la base.'}</p>}
        </div>
      </div>
    </div>, portal)}
  </span>;
}
