import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Maximize2, MoreHorizontal, Plus, TerminalSquare, Globe, StickyNote, Layers, Minus, LocateFixed, MousePointer2, Hand, HelpCircle, ChevronDown, X } from 'lucide-react';
import TerminalPanelContent from './TerminalPanel';
import BrowserPanelContent from './BrowserPanel';
import { ToolPanel as ToolPanelContent } from './ToolPanels';
import { useInlineName } from '../hooks/useInlineName';
import { isEditingTarget } from '../hooks/inputOwnership';
import { Presence, PresenceGroup } from './Presence';
import { cameraTier, useCanvasCamera } from '../hooks/useCanvasCamera';
import { TerminalActivityStatus } from './ActivityNotch';

const icons = { terminal: TerminalSquare, browser: Globe, note: StickyNote, plugins: Layers, 'phantom-cards': Layers, 'phantom-skills': Layers };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const editable = isEditingTarget;
const defaultCamera = { x: 64, y: 64, zoom: 1 };
const sameIds = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);
const TerminalPanel = React.memo(TerminalPanelContent);
const BrowserPanel = React.memo(BrowserPanelContent);
const ToolPanel = React.memo(ToolPanelContent);

// One panel on the map. Memoized: camera movement, other panels' edits and
// selection changes elsewhere must not re-render this panel or its terminal.
const CanvasNode = React.memo(function CanvasNode({ node, preview, focusSize, anyFocused, selected, small, compact, magnified, missionTitle, activity, editing, anyEditing, workspace, handlers, api, refresh, flush, notify, onOpenPanel, onChange, onRelaunch, connected, active, inputBlocked, obscured }) {
  const Icon = icons[node.type] || Layers, isFocused = !!focusSize;
  const geometry = isFocused ? { x: 24, y: 55, width: Math.max(320, focusSize.width - 48), height: Math.max(240, focusSize.height - 145) } : preview ? { ...node, ...preview } : node;
  const titleRef = useCallback(element => handlers.titleButton(node.id, element), [handlers, node.id]);
  const enlarge = useCallback(() => handlers.focus(node.id), [handlers, node.id]);
  return <article className={`canvas-node ${selected ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${small ? 'overview' : ''}`} style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height, display: anyFocused && !isFocused ? 'none' : undefined }} onPointerDown={() => { if (!selected) handlers.select([node.id]); }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); handlers.menu(node.id, e.clientX, e.clientY); }}>
    <header className="node-header" onPointerDown={e => { if (!e.target.closest('button,input') && !anyFocused) handlers.begin(e, 'move', node); }} onDoubleClick={e => { if (!e.target.closest('button,input')) handlers.focus(isFocused ? null : node.id); }}>
      <Icon size={15} /><div className="node-title">{editing ? <><input ref={handlers.renameInput} className="inline-name-input" aria-label="Nombre del panel" aria-invalid={!!editing.error} aria-describedby={editing.error ? `name-error-${node.id}` : undefined} value={editing.value} readOnly={editing.saving} onChange={e => handlers.renameChange(e.target.value)} onPointerDown={e => e.stopPropagation()} onBlur={() => handlers.renameCommit(false)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); handlers.renameCommit(true); } if (e.key === 'Escape') { e.preventDefault(); handlers.renameCancel(); } }} />{editing.error && <span className="inline-name-error" id={`name-error-${node.id}`} role="alert">{editing.error}</span>}</> : <button ref={titleRef} className="title-button" title="Renombrar panel" onClick={() => handlers.renameStart(node)}>{node.title}</button>}</div>
      {node.groupId && <span className="mission-chip" title={missionTitle}>{missionTitle || 'Misión'}</span>}
      {node.type === 'terminal' && <TerminalActivityStatus session={activity} />}
      <button className="icon-button" aria-label={isFocused ? 'Volver al mapa' : 'Enfocar panel'} title={isFocused ? 'Volver al mapa' : 'Enfocar panel'} onClick={() => handlers.focus(isFocused ? null : node.id)}>{isFocused ? <ArrowLeft size={14} /> : <Maximize2 size={14} />}</button>
      <button className="icon-button" aria-label="Opciones del panel" title="Opciones del panel" onClick={e => handlers.menu(node.id, e.clientX, e.clientY)}><MoreHorizontal size={16} /></button>
      {node.type === 'terminal' && <button className="icon-button" aria-label="Cerrar terminal" title="Cerrar terminal y terminar sesión" onClick={() => handlers.closeTerminal(node)}><X size={14} /></button>}
    </header>
    <div className="node-body">
      {node.type === 'terminal' ? <TerminalPanel node={node} workspace={workspace} api={api} refresh={refresh} flush={flush} onOpenPanel={onOpenPanel} onEnlarge={enlarge} connected={connected} active={active} inputBlocked={inputBlocked} focusRequested={isFocused} overview={small} compact={compact} magnified={magnified} onRelaunch={onRelaunch} onChange={onChange} notify={notify} /> : node.type === 'browser' ? <BrowserPanel node={node} workspace={workspace} api={api} active={isFocused} obscured={obscured || anyEditing} onFocus={handlers.focus} onChange={onChange} /> : node.type === 'note' ? <textarea className="note-editor" aria-label={`Nota: ${node.title}`} value={node.data?.text || ''} placeholder="Escribe el contexto que quieres recuperar…" onChange={e => onChange(node.id, { data: { ...node.data, text: e.target.value } })} spellCheck /> : <ToolPanel node={node} workspace={workspace} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} />}
    </div>
    {!anyFocused && <button className="resize-handle" aria-label="Cambiar tamaño del panel" title="Arrastra para cambiar tamaño" onPointerDown={e => handlers.begin(e, 'resize', node)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); onChange(node.id, { width: Math.max(400, node.width + (e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : 0)), height: Math.max(240, node.height + (e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0)) }); } }} />}
  </article>;
});

export default function Canvas({ workspace, api, refresh, notify, onOpenPanel, onChange, onCamera, focused, onFocus, selected, onSelect, obscured, inputBlocked, onMenu, onRelaunch, onCloseTerminal, fitRequest, jumpRequest, connection, renameRequest, flush, registerBeforeFlush, terminalActivity = {} }) {
  const root = useRef(null);
  const world = useRef(null);
  const zoomLabel = useRef(null);
  const gesture = useRef(null);
  const gestureFrame = useRef(null);
  const finishRef = useRef(null);
  const handledJump = useRef(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [preview, setPreview] = useState({});
  const titleButtons = useRef(new Map());
  const rename = useInlineName({ stage: (id, title) => onChange(id, { title }), flush, registerBeforeFlush });
  const [panning, setPanning] = useState(false);
  const [tool, setTool] = useState('select');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const space = useRef(false);
  const [marquee, setMarquee] = useState(null);
  const [navigationMenu, setNavigationMenu] = useState(null);
  const previewRef = useRef({});
  const nodes = useMemo(() => (workspace.nodes || []).filter(n => !n.data?.hidden), [workspace.nodes]);
  // Terminals and browsers only read these fields; a stable object keeps
  // edits to other panels from re-rendering every terminal.
  const panelWorkspace = useMemo(() => ({ id: workspace.id, path: workspace.path, canonicalPath: workspace.canonicalPath, missions: workspace.missions }), [workspace.id, workspace.path, workspace.canonicalPath, workspace.missions]);
  const focusedRef = useRef(focused); focusedRef.current = focused;
  // Camera frames are painted straight to the DOM. React re-renders the map
  // only when the zoom tier changes or navigation settles.
  const paintCamera = useCallback(c => {
    const el = world.current;
    if (el) {
      const unfocused = !focusedRef.current;
      el.style.transform = unfocused ? `translate(${c.x}px, ${c.y}px) scale(${c.zoom})` : 'none';
      el.style.setProperty('--map-label-scale', unfocused ? String(Math.min(2.4, Math.max(1, 1 / c.zoom))) : '1');
      el.style.setProperty('--overview-scale', unfocused ? String(1 / c.zoom) : '1');
    }
    if (zoomLabel.current) {
      zoomLabel.current.textContent = `${Math.round(c.zoom * 100)}`;
      zoomLabel.current.parentElement?.setAttribute('aria-label', `Zoom ${Math.round(c.zoom * 100)}%. Opciones de zoom`);
    }
  }, []);
  const commitCamera = useCallback(next => onCamera(next, workspace.id), [onCamera, workspace.id]);
  const { camera, cameraRef, updateCamera, navigate, flushCamera } = useCanvasCamera(workspace.camera || defaultCamera, commitCamera, paintCamera);
  useLayoutEffect(() => { paintCamera(cameraRef.current); });
  useEffect(() => registerBeforeFlush?.(flushCamera), [registerBeforeFlush, flushCamera]);
  const live = useRef({ camera, nodes, selected, focused }); live.current = { camera, nodes, selected, focused };
  useEffect(() => {
    if (!navigationMenu) return;
    const outside = e => { if (!e.target.closest('.canvas-navigation,.canvas-popover,.agent-editor')) setNavigationMenu(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [navigationMenu]);
  useEffect(() => {
    const node = live.current.nodes.find(n => n.id === renameRequest?.id);
    if (node) rename.start(node.id, node.title, () => titleButtons.current.get(node.id));
  }, [renameRequest]);
  useEffect(() => { const obs = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height })); if (root.current) obs.observe(root.current); return () => obs.disconnect(); }, []);
  const fit = useCallback((selectionOnly = false) => {
    const targets = selectionOnly === true ? nodes.filter(n => selected.includes(n.id)) : nodes;
    if (!targets.length) { if (!selectionOnly) navigate(defaultCamera); return; }
    const left = Math.min(...targets.map(n => n.x)), top = Math.min(...targets.map(n => n.y));
    const right = Math.max(...targets.map(n => n.x + n.width)), bottom = Math.max(...targets.map(n => n.y + n.height));
    const zoom = clamp(Math.min((size.width - 112) / (right - left), (size.height - 180) / (bottom - top)), .15, 1);
    navigate({ x: (size.width - (right - left) * zoom) / 2 - left * zoom, y: (size.height - 40 - (bottom - top) * zoom) / 2 - top * zoom, zoom });
  }, [nodes, selected, size, navigate]);
  const fitRef = useRef(fit); fitRef.current = fit;
  useEffect(() => { if (fitRequest) fitRef.current(); }, [fitRequest]);
  useEffect(() => {
    if (!jumpRequest?.id || handledJump.current === jumpRequest) return;
    const n = live.current.nodes.find(n => n.id === jumpRequest.id); if (!n) return;
    handledJump.current = jumpRequest;
    const navigation = root.current?.querySelector('.canvas-navigation');
    const topInset = Math.max(70, navigation ? navigation.offsetTop + navigation.offsetHeight + 12 : 70);
    const availableHeight = Math.max(80, size.height - topInset - 90);
    const zoom = Math.min(1, (size.width - 112) / n.width, availableHeight / n.height);
    navigate({ x: (size.width - n.width * zoom) / 2 - n.x * zoom, y: topInset + (availableHeight - n.height * zoom) / 2 - n.y * zoom, zoom });
  }, [jumpRequest, size.width, size.height, navigate]);
  const zoomAt = useCallback((zoom, x = size.width / 2, y = size.height / 2, smooth = true) => {
    const old = cameraRef.current, next = clamp(zoom, .15, 1.8);
    (smooth ? navigate : updateCamera)({ x: x - (x - old.x) * next / old.zoom, y: y - (y - old.y) * next / old.zoom, zoom: next });
  }, [navigate, updateCamera, size, cameraRef]);
  useEffect(() => {
    const el = root.current;
    const wheel = e => {
      if (inputBlocked || live.current.focused || e.target.closest('.canvas-navigation,.canvas-popover,.agent-editor')) return;
      // xterm owns wheel gestures, including modified wheel mouse reports.
      if (e.target.closest('.terminal-host')) return;
      const zooming = e.ctrlKey || e.metaKey || e.altKey;
      if (!zooming && e.target.closest('.node-body')) return;
      e.preventDefault();
      if (zooming) e.stopPropagation();
      const r = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.height : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (zooming) zoomAt(cameraRef.current.zoom * Math.exp(-clamp(dy, -120, 120) * (e.ctrlKey ? .008 : .003)), e.clientX - r.left, e.clientY - r.top, false);
      else updateCamera({ ...cameraRef.current, x: cameraRef.current.x - (e.shiftKey && !dx ? dy : dx), y: cameraRef.current.y - (e.shiftKey && !dx ? 0 : dy) });
    };
    el?.addEventListener('wheel', wheel, { passive: false, capture: true }); return () => el?.removeEventListener('wheel', wheel, true);
  }, [updateCamera, zoomAt, inputBlocked, size.height]);
  useEffect(() => {
    const key = e => {
      if (inputBlocked || !root.current?.contains(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter' && !e.target.closest('.inline-name-input')) { e.preventDefault(); onFocus(focused ? null : selected[0] || nodes[0]?.id); return; }
      if (editable(e.target)) return;
      if (e.key === 'Escape' && navigationMenu) { e.preventDefault(); setNavigationMenu(null); return; }
      if (e.target.closest('button,.canvas-popover')) return;
      if (e.key === 'Escape') { setNavigationMenu(null); onFocus(null); onSelect([]); }
      if (focused || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); space.current = true; setSpaceHeld(true); }
      if (e.key.toLowerCase() === 'h') setTool('hand');
      if (e.key.toLowerCase() === 'v') setTool('select');
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(cameraRef.current.zoom * 1.2); }
      if (e.key === '-') { e.preventDefault(); zoomAt(cameraRef.current.zoom / 1.2); }
      if (e.key === '1') { e.preventDefault(); zoomAt(1); }
      if (e.key === '2') { e.preventDefault(); fitRef.current(true); }
      if (e.key === '?') setNavigationMenu(menu => menu === 'help' ? null : 'help');
      if (e.key === 'Enter' && selected[0]) { e.preventDefault(); onFocus(selected[0]); }
      if (e.key === '0' && !e.ctrlKey && !e.metaKey) fitRef.current();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected[0]) { e.preventDefault(); const r = root.current.getBoundingClientRect(); onMenu(selected[0], r.x + size.width / 2, r.y + 100); }
      if (e.key === 'Tab' && e.target === root.current && nodes.length) { e.preventDefault(); const index = nodes.findIndex(n => n.id === selected[0]); const n = nodes[(index + (e.shiftKey ? nodes.length - 1 : 1)) % nodes.length]; onSelect([n.id]); }
    };
    const release = e => { if (!e || e.type === 'blur' || e.code === 'Space') { space.current = false; setSpaceHeld(false); } if (e?.type === 'blur') finishRef.current?.(); };
    window.addEventListener('keydown', key); window.addEventListener('keyup', release); window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', release); window.removeEventListener('blur', release); };
  }, [focused, selected, nodes, onFocus, onSelect, inputBlocked, onMenu, size, zoomAt, navigationMenu]);
  const begin = (e, kind, node) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (inputBlocked || focused || e.target.closest('.agent-editor')) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const ids = node && selected.includes(node.id) ? selected : node ? [node.id] : [];
    if (node) onSelect(e.shiftKey ? [...new Set([...selected, node.id])] : ids);
    else if (kind !== 'pan' && !e.shiftKey) onSelect([]);
    root.current.focus({ preventScroll: true });
    setNavigationMenu(null);
    gesture.current = { kind, startX: e.clientX, startY: e.clientY, camera: { ...cameraRef.current }, originals: nodes.filter(n => ids.includes(n.id)).map(n => ({ ...n })), node, selection: e.shiftKey ? selected : [], pointerId: e.pointerId, last: null };
    if (kind === 'pan') setPanning(true);
  };
  // Pointer events can outpace the display; apply at most one gesture step per frame.
  const step = () => {
    gestureFrame.current = null;
    const g = gesture.current; if (!g?.last) return;
    const { clientX, clientY } = g.last;
    const dx = clientX - g.startX, dy = clientY - g.startY;
    if (g.kind === 'select') {
      const r = root.current.getBoundingClientRect();
      const box = { x: Math.min(g.startX, clientX) - r.left, y: Math.min(g.startY, clientY) - r.top, width: Math.abs(dx), height: Math.abs(dy) };
      setMarquee(box);
      const c = g.camera;
      const next = [...new Set([...g.selection, ...live.current.nodes.filter(n => n.x * c.zoom + c.x < box.x + box.width && (n.x + n.width) * c.zoom + c.x > box.x && n.y * c.zoom + c.y < box.y + box.height && (n.y + n.height) * c.zoom + c.y > box.y).map(n => n.id)])];
      if (!sameIds(next, live.current.selected)) onSelect(next);
    } else {
      previewRef.current = g.kind === 'move' ? Object.fromEntries(g.originals.map(n => [n.id, { x: Math.round(n.x + dx / g.camera.zoom), y: Math.round(n.y + dy / g.camera.zoom) }])) : { [g.node.id]: { width: Math.round(Math.max(g.node.type === 'terminal' ? 400 : 320, g.node.width + dx / g.camera.zoom)), height: Math.round(Math.max(240, g.node.height + dy / g.camera.zoom)) } };
      setPreview(previewRef.current);
    }
  };
  const move = e => {
    const g = gesture.current; if (!g) return;
    // Panning already coalesces per frame inside the camera hook.
    if (g.kind === 'pan') { updateCamera({ ...g.camera, x: g.camera.x + e.clientX - g.startX, y: g.camera.y + e.clientY - g.startY }); return; }
    g.last = { clientX: e.clientX, clientY: e.clientY };
    if (gestureFrame.current === null) gestureFrame.current = requestAnimationFrame(step);
  };
  const finish = e => {
    if (!gesture.current) return;
    if (gestureFrame.current !== null) { cancelAnimationFrame(gestureFrame.current); step(); }
    Object.entries(previewRef.current).forEach(([id, patch]) => onChange(id, patch)); previewRef.current = {}; setPreview({}); gesture.current = null; setPanning(false); setMarquee(null); flushCamera();
    if (e?.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  finishRef.current = finish;
  useEffect(() => () => cancelAnimationFrame(gestureFrame.current), []);
  // Stable callbacks for memoized nodes; they always call the latest closure.
  const latest = useRef({}); latest.current = { begin, onMenu, onFocus, onSelect, onCloseTerminal, rename };
  const handlers = useMemo(() => ({
    begin: (...args) => latest.current.begin(...args),
    menu: (...args) => latest.current.onMenu(...args),
    focus: id => latest.current.onFocus(id),
    select: ids => latest.current.onSelect(ids),
    closeTerminal: node => latest.current.onCloseTerminal(node),
    titleButton: (id, element) => { if (element) titleButtons.current.set(id, element); else titleButtons.current.delete(id); },
    renameStart: node => latest.current.rename.start(node.id, node.title, () => titleButtons.current.get(node.id)),
    renameChange: value => latest.current.rename.change(value),
    renameCommit: returnFocus => latest.current.rename.commit(returnFocus),
    renameCancel: () => latest.current.rename.cancel(),
    renameInput: element => { latest.current.rename.inputRef.current = element; },
  }), []);
  const focusedNode = nodes.find(n => n.id === focused);
  const tier = focused ? 0 : cameraTier(camera.zoom);
  const connected = !connection || connection.status === 'connected';
  return <section ref={root} tabIndex={0} className={`canvas ${focused ? 'focus-mode' : ''} ${panning ? 'is-panning' : ''} ${tool === 'hand' || spaceHeld ? 'hand-tool' : ''}`} aria-label="Lienzo espacial del proyecto" onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onPointerDownCapture={e => { if (!e.target.closest('.canvas-navigation,.canvas-popover,.focus-return') && (e.button === 1 || tool === 'hand' || space.current)) begin(e, 'pan'); }} onPointerDown={e => { if (e.target === e.currentTarget || e.target.closest('.canvas-world') === e.target || (e.target.closest('.canvas-empty') && !e.target.closest('button'))) begin(e, 'select'); }} onContextMenu={e => { if (!e.target.closest('.canvas-node')) { e.preventDefault(); onMenu(null, e.clientX, e.clientY); } }}>
    <Presence>{focusedNode && <div className="focus-return"><button onClick={() => onFocus(null)}><ArrowLeft size={15} /> Volver al mapa</button><span>{focusedNode.title}</span><kbd>Ctrl ⇧ ↵</kbd></div>}</Presence>
    {!nodes.length && <div className="canvas-empty"><div className="empty-symbol"><Layers size={30} strokeWidth={1.4} /></div><h2>Tu mesa de trabajo, en un lugar</h2><p>Abre una terminal, toma una nota o conecta una herramienta.<br />Cada panel conserva su lugar en este proyecto.</p><div className="empty-actions"><button className="button primary" onClick={() => onOpenPanel('terminal')}><TerminalSquare size={16} /> Crear terminal</button><button className="button" onClick={() => onOpenPanel('note')}><StickyNote size={16} /> Escribir nota</button></div><span className="empty-hint">Arrastra una cabecera para organizar · Ctrl + rueda para acercar</span></div>}
    <div ref={world} className="canvas-world">
      <PresenceGroup>{nodes.map(node => {
        const isFocused = focused === node.id;
        const editing = rename.editing?.id === node.id ? rename.editing : null;
        const sharedWorkspace = node.type === 'terminal' || node.type === 'browser' || node.type === 'note' ? panelWorkspace : workspace;
        return <CanvasNode key={node.id} node={node} preview={preview[node.id]} focusSize={isFocused ? size : null} anyFocused={!!focused} selected={selected.includes(node.id)} small={tier > 0} compact={tier > 1} magnified={tier < 0} missionTitle={node.groupId ? workspace.missions?.find(m => m.id === node.groupId)?.title : undefined} activity={node.type === 'terminal' ? terminalActivity[node.id] : undefined} editing={editing} anyEditing={!!rename.editing} workspace={sharedWorkspace} handlers={handlers} api={api} refresh={refresh} flush={flush} notify={notify} onOpenPanel={onOpenPanel} onChange={onChange} onRelaunch={onRelaunch} connected={connected} active={!inputBlocked && (isFocused || (!focused && selected.length === 1 && selected[0] === node.id))} inputBlocked={inputBlocked} obscured={obscured} />;
      })}</PresenceGroup>
    </div>
    {marquee && <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
    {!focused && <><div className="canvas-navigation" role="toolbar" aria-label="Navegación del canvas">
      <button aria-label="Herramienta de selección" title="Seleccionar · V" aria-pressed={tool === 'select'} onClick={() => { setTool('select'); root.current.focus(); }}><MousePointer2 size={16} /></button>
      <button aria-label="Herramienta de mano" title="Mover mapa · H · Mantén Espacio" aria-pressed={tool === 'hand'} onClick={() => { setTool('hand'); root.current.focus(); }}><Hand size={16} /></button><i />
      <button title="Alejar (−)" aria-label="Alejar" disabled={camera.zoom <= .15} onClick={() => zoomAt(cameraRef.current.zoom / 1.2)}><Minus size={15} /></button>
      <button className="zoom-value" aria-label={`Zoom ${Math.round(camera.zoom * 100)}%. Opciones de zoom`} aria-expanded={navigationMenu === 'zoom'} aria-controls="canvas-zoom-options" onClick={() => setNavigationMenu(menu => menu === 'zoom' ? null : 'zoom')}><span ref={zoomLabel}>{Math.round(camera.zoom * 100)}</span>%<ChevronDown size={12} /></button>
      <button title="Acercar (+)" aria-label="Acercar" disabled={camera.zoom >= 1.8} onClick={() => zoomAt(cameraRef.current.zoom * 1.2)}><Plus size={15} /></button><i />
      <button title="Ajustar todos los paneles · 0" aria-label="Ajustar todos los paneles" onClick={() => fit()}><LocateFixed size={17} /></button>
      <button title="Gestos y atajos · ?" aria-label="Gestos y atajos del canvas" aria-expanded={navigationMenu === 'help'} aria-controls="canvas-gesture-help" onClick={() => setNavigationMenu(menu => menu === 'help' ? null : 'help')}><HelpCircle size={16} /></button>
    </div>
    {navigationMenu && <div className="canvas-popover" id={navigationMenu === 'zoom' ? 'canvas-zoom-options' : 'canvas-gesture-help'} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNavigationMenu(null); root.current.querySelector(`[aria-controls="${e.currentTarget.id}"]`)?.focus(); } }}>
      <div className="canvas-popover-heading"><strong>{navigationMenu === 'zoom' ? 'Vista del canvas' : 'Muévete por tu espacio'}</strong><button aria-label="Cerrar controles del canvas" onClick={() => setNavigationMenu(null)}><X size={14} /></button></div>
      {navigationMenu === 'zoom' ? <><button onClick={() => { fit(); setNavigationMenu(null); }}>Ajustar todos los paneles<kbd>0</kbd></button><button disabled={!selected.length} onClick={() => { fit(true); setNavigationMenu(null); }}>Acercar a la selección<kbd>2</kbd></button><div className="canvas-zoom-presets">{[.25, .5, 1, 1.5].map(zoom => <button key={zoom} onClick={() => { zoomAt(zoom); setNavigationMenu(null); }}>{zoom * 100}%</button>)}</div></> : <dl><div><dt>Mover mapa</dt><dd><kbd>Espacio</kbd> + arrastrar</dd></div><div><dt>Desplazar</dt><dd>Trackpad / rueda central</dd></div><div><dt>Zoom al cursor</dt><dd><kbd>Ctrl</kbd> + rueda / pellizco</dd></div><div><dt>Seleccionar varios</dt><dd>Arrastrar en el fondo</dd></div><div><dt>Sumar selección</dt><dd><kbd>Shift</kbd> + arrastrar</dd></div><div><dt>Zoom real / ajustar</dt><dd><kbd>1</kbd> / <kbd>0</kbd></dd></div></dl>}
    </div>}</>}
  </section>;
}
