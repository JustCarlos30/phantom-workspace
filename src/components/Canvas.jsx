import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Maximize2, MoreHorizontal, Plus, TerminalSquare, Globe, StickyNote, Layers, Minus, LocateFixed, MousePointer2, Hand, HelpCircle, ChevronDown, X, Map as MapIcon, Frame, Sparkles, MessageCircle, LoaderCircle } from 'lucide-react';
import Minimap from './Minimap';
import TerminalPanelContent from './TerminalPanel';
import TerminalCardContent from './TerminalCard';
import ChatCardContent from './ChatCard';
import BrowserPanelContent from './BrowserPanel';
import { ToolPanel as ToolPanelContent } from './ToolPanels';
import { useInlineName } from '../hooks/useInlineName';
import { isEditingTarget } from '../hooks/inputOwnership';
import { Presence, PresenceGroup } from './Presence';
import { cameraTier, useCanvasCamera } from '../hooks/useCanvasCamera';
import { TerminalActivityStatus } from './ActivityNotch';
import { PANEL_ICONS } from './PanelIcons';
import PixelField from './PixelField';
import ReferencePanelContent, { CommentLayer } from './References';
import { INLINE_LIMIT, readTransfer, toBase64, visibleComments } from '../hooks/references.mjs';
import '../references.css';

const icons = { ...PANEL_ICONS, 'skills-catalog': Sparkles };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const editable = isEditingTarget;
const defaultCamera = { x: 300, y: 84, zoom: 1 };
const GRID = 24;
// Text only stays sharp when the world lands on whole device pixels.
const snap = value => { const ratio = window.devicePixelRatio || 1; return Math.round(value * ratio) / ratio; };
export const ZONE_COLORS = ['iris', 'mint', 'amber', 'rose', 'slate'];
const inside = (n, z) => n.x >= z.x && n.y >= z.y && n.x + n.width <= z.x + z.width && n.y + n.height <= z.y + z.height;
// Border pulse encodes real state only: working breathes, attention calls, failure flashes then holds.
// Chat cards have no PTY session: they report their own state (chatPulse).
function pulseState(node, session, chatPulse) {
  if (node.type === 'terminal' && node.data?.chat?.provider) return chatPulse || '';
  if (node.type !== 'terminal' || !session) return '';
  if (session.status === 'lost' || (session.status === 'exited' && session.exitCode && session.exitCode !== 0)) return 'pulse-error';
  const agent = String(session.agentState || session.agent?.status || node.data?.agent?.status || '').toLowerCase();
  // Approval calls (pulses); a finished turn waits steadily. Both mean: your move.
  if (session.screen === 'awaiting_approval' || ['blocked', 'needs_input', 'awaiting_approval'].includes(agent)) return 'pulse-attention';
  if (session.needsYou || ['review', 'waiting'].includes(agent)) return 'pulse-turn';
  if (session.screen === 'working' || ['working', 'running', 'in_progress', 'busy', 'thinking'].includes(agent)) return 'pulse-working';
  return '';
}
// The background field echoes the states that ask for you, never 'working'.
const PIXEL_KIND = { 'pulse-attention': 'call', 'pulse-turn': 'turn', 'pulse-error': 'error', 'pulse-working': 'work' };
// A brand-new workspace starts at the host origin, which now sits under the floating rail.
const initialCamera = camera => !camera || (camera.x === 0 && camera.y === 0 && camera.zoom === 1) ? defaultCamera : camera;
const readMinimap = () => { try { return localStorage.getItem('phantom.minimap') !== 'off'; } catch { return true; } };
// The dot grid lives in world space: it pans and scales with the camera and
// doubles its spacing when dots would get too dense, like Figma or Miro.
function gridStyle(camera) {
  let step = GRID * camera.zoom;
  while (step < 14) step *= 2;
  return { '--grid-size': `${step}px`, '--grid-x': `${camera.x}px`, '--grid-y': `${camera.y}px`, '--grid-major': `${step * 4}px` };
}
const TerminalPanel = React.memo(function CanvasTerminal({ node, onFocus, ...props }) {
  return <TerminalPanelContent {...props} node={node} onEnlarge={() => onFocus(node.id)} />;
});
// Map shows Phantom's own card; the xterm engine mounts only in focus.
const TerminalCard = React.memo(function CanvasTerminalCard({ node, onFocus, ...props }) {
  return <TerminalCardContent {...props} node={node} onOpen={() => onFocus(node.id)} />;
});
// A card whose agent is chosen talks as a chat, on the map and in focus alike.
const ChatCard = React.memo(ChatCardContent);
const sameIds = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);
const BrowserPanel = React.memo(BrowserPanelContent);
const ToolPanel = React.memo(ToolPanelContent);
const ReferencePanel = React.memo(ReferencePanelContent);
// A reference hugs its media: header and caption around the picture's own ratio.
const REFERENCE_CHROME = 70;
const NO_COMMENTS = [];

// One panel on the map. Memoized: camera movement, other panels' edits and
// selection changes elsewhere must not re-render this panel or its terminal.
const CanvasNode = React.memo(function CanvasNode({ node, preview, focusSize, anyFocused, selected, small, compact, magnified, missionTitle, activity, chatPulse, editing, anyEditing, workspace, handlers, api, refresh, flush, notify, onOpenPanel, onChange, onRelaunch, connected, active, inputBlocked, obscured, comments }) {
  const Icon = icons[node.type] || Layers, isFocused = !!focusSize;
  const geometry = isFocused ? { x: 12, y: 72, width: Math.max(320, focusSize.width - 24), height: Math.max(240, focusSize.height - 160) } : preview ? { ...node, ...preview } : node;
  const titleRef = useCallback(element => handlers.titleButton(node.id, element), [handlers, node.id]);
  const enlarge = useCallback(() => handlers.focus(node.id), [handlers, node.id]);
  return <article data-node-id={node.id} data-type={node.type} className={`canvas-node ${selected ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${small ? 'overview' : ''} ${compact ? 'compact' : ''} ${preview ? 'is-dragging' : ''} ${pulseState(node, activity, chatPulse)}`} style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height, display: anyFocused && !isFocused ? 'none' : undefined }} onPointerDown={() => { if (!selected) handlers.select([node.id]); }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); handlers.menu(node.id, e.clientX, e.clientY); }}>
    <header className="node-header" onPointerDown={e => { if (!e.target.closest('button,input') && !anyFocused) handlers.begin(e, 'move', node); }} onDoubleClick={e => { if (!e.target.closest('button,input')) handlers.focus(isFocused ? null : node.id); }}>
      <span className="node-glyph" data-type={node.type} aria-hidden="true"><Icon size={14} /></span><div className="node-title">{editing ? <><input ref={handlers.renameInput} className="inline-name-input" aria-label="Nombre del panel" aria-invalid={!!editing.error} aria-describedby={editing.error ? `name-error-${node.id}` : undefined} value={editing.value} readOnly={editing.saving} onChange={e => handlers.renameChange(e.target.value)} onPointerDown={e => e.stopPropagation()} onBlur={() => handlers.renameCommit(false)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); handlers.renameCommit(true); } if (e.key === 'Escape') { e.preventDefault(); handlers.renameCancel(); } }} />{editing.error && <span className="inline-name-error" id={`name-error-${node.id}`} role="alert">{editing.error}</span>}</> : <button ref={titleRef} className="title-button" title="Renombrar panel" onClick={() => handlers.renameStart(node)}>{node.title}</button>}</div>
      {node.groupId && <span className="mission-chip" title={missionTitle}>{missionTitle || 'Misión'}</span>}
      {node.type === 'terminal' && <TerminalActivityStatus session={activity} />}
      <button className="icon-button" aria-label={isFocused ? 'Volver al mapa' : 'Enfocar panel'} title={isFocused ? 'Volver al mapa' : 'Enfocar panel'} onClick={() => handlers.focus(isFocused ? null : node.id)}>{isFocused ? <ArrowLeft size={14} /> : <Maximize2 size={14} />}</button>
      <button className="icon-button" aria-label="Opciones del panel" title="Opciones del panel" onClick={e => handlers.menu(node.id, e.clientX, e.clientY)}><MoreHorizontal size={16} /></button>
      {node.type === 'terminal' && <button className="icon-button" aria-label="Cerrar terminal" title="Cerrar terminal y terminar sesión" onClick={() => handlers.closeTerminal(node)}><X size={14} /></button>}
    </header>
    <div className="node-body">
      {node.type === 'terminal' && node.data?.chat?.provider ? <ChatCard node={node} workspace={workspace} api={api} notify={notify} overview={small} focused={isFocused} connected={connected} seen={selected || isFocused} onPulse={handlers.chatPulse} /> : node.type === 'terminal' && !isFocused ? <TerminalCard node={node} workspace={workspace} api={api} notify={notify} onFocus={handlers.focus} onRelaunch={onRelaunch} overview={small} connected={connected} /> : node.type === 'terminal' ? <TerminalPanel node={node} workspace={workspace} api={api} refresh={refresh} flush={flush} onOpenPanel={onOpenPanel} onEnlarge={enlarge} onFocus={handlers.focus} connected={connected} active={active} inputBlocked={inputBlocked} focusRequested={isFocused} overview={small} compact={compact} magnified={magnified} onRelaunch={onRelaunch} onChange={onChange} notify={notify} /> : node.type === 'browser' ? <BrowserPanel node={node} workspace={workspace} api={api} active={isFocused} obscured={obscured || anyEditing} onFocus={handlers.focus} onChange={onChange} /> : node.type === 'reference' ? <ReferencePanel node={node} workspace={workspace} comments={comments} onChange={onChange} onOpenPanel={onOpenPanel} onOpenComment={handlers.openComment} /> : node.type === 'note' ? <textarea className="note-editor" aria-label={`Nota: ${node.title}`} value={node.data?.text || ''} placeholder="Escribe el contexto que quieres recuperar…" onChange={e => onChange(node.id, { data: { ...node.data, text: e.target.value } })} spellCheck /> : <ToolPanel node={node} workspace={workspace} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} />}
    </div>
    {!anyFocused && <button className="resize-handle" aria-label="Cambiar tamaño del panel" title="Arrastra para cambiar tamaño" onPointerDown={e => handlers.begin(e, 'resize', node)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); onChange(node.id, { width: Math.max(400, node.width + (e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : 0)), height: Math.max(240, node.height + (e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0)) }); } }} />}
  </article>;
});

export default function Canvas({ workspace, api, refresh, notify, onOpenPanel, onChange, onCamera, focused, onFocus, selected, onSelect, obscured, inputBlocked, onMenu, onRelaunch, onCloseTerminal, fitRequest, jumpRequest, connection, renameRequest, flush, registerBeforeFlush, terminalActivity = {}, spaceId = null }) {
  const root = useRef(null);
  const world = useRef(null);
  const zoomLabel = useRef(null);
  const gesture = useRef(null);
  const gestureFrame = useRef(null);
  const finishRef = useRef(null);
  const handledJump = useRef(null);
  const [frameRequest, setFrameRequest] = useState(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [preview, setPreview] = useState({});
  const [chatPulses, setChatPulses] = useState({});
  const titleButtons = useRef(new Map());
  const rename = useInlineName({ stage: (id, title) => onChange(id, { title }), flush, registerBeforeFlush });
  const [panning, setPanning] = useState(false);
  const [tool, setTool] = useState('select');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const space = useRef(false);
  const [marquee, setMarquee] = useState(null);
  const [navigationMenu, setNavigationMenu] = useState(null);
  const previewRef = useRef({});
  // Board: where the pointer last was (a paste lands there), the comment being
  // written, the open thread and how many references are still arriving.
  const pointer = useRef(null);
  const [draft, setDraft] = useState(null);
  const [openComment, setOpenComment] = useState(null);
  const [importing, setImporting] = useState(0);
  const [dataDir, setDataDir] = useState('');
  useEffect(() => { let alive = true; api('desktop.info').then(info => { if (alive) setDataDir(info?.dataDir || ''); }, () => {}); return () => { alive = false; }; }, [api]);
  const inertia = useRef(null);
  const [minimap, setMinimap] = useState(readMinimap);
  const toggleMinimap = () => setMinimap(on => { try { localStorage.setItem('phantom.minimap', on ? 'off' : 'on'); } catch { /* per-viewer preference only */ } return !on; });
  const stopInertia = useCallback(() => { cancelAnimationFrame(inertia.current); inertia.current = null; }, []);
  useEffect(() => stopInertia, [stopInertia]);
  const nodes = useMemo(() => (workspace.nodes || []).filter(n => !n.data?.hidden).sort((a, b) => Number(b.type === 'zone') - Number(a.type === 'zone')), [workspace.nodes]);
  // Terminals and browsers only read these fields; a stable object keeps
  // edits to other panels from re-rendering every terminal.
  const panelWorkspace = useMemo(() => ({ id: workspace.id, path: workspace.path, canonicalPath: workspace.canonicalPath, missions: workspace.missions }), [workspace.id, workspace.path, workspace.canonicalPath, workspace.missions]);
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const fieldPaint = useRef(null);
  // Camera frames are painted straight to the DOM. React re-renders the map
  // only when the zoom tier changes or navigation settles.
  const minimapFrame = useRef(null);
  const paintCamera = useCallback(c => {
    minimapFrame.current?.(c);
    const el = world.current;
    if (el) {
      const unfocused = !focusedRef.current;
      el.style.transform = unfocused ? `translate(${snap(c.x)}px, ${snap(c.y)}px) scale(${c.zoom})` : 'none';
      el.style.setProperty('--map-label-scale', unfocused ? String(Math.min(2.4, Math.max(1, 1 / c.zoom))) : '1');
      el.style.setProperty('--overview-scale', unfocused ? String(1 / c.zoom) : '1');
    }
    if (root.current) for (const [key, value] of Object.entries(gridStyle(c))) root.current.style.setProperty(key, value);
    fieldPaint.current?.();
    if (zoomLabel.current) {
      zoomLabel.current.textContent = `${Math.round(c.zoom * 100)}`;
      zoomLabel.current.parentElement?.setAttribute('aria-label', `Zoom ${Math.round(c.zoom * 100)}%. Opciones de zoom`);
    }
  }, []);
  const commitCamera = useCallback(next => onCamera(next, workspace.id), [onCamera, workspace.id]);
  const { camera, cameraRef, updateCamera, navigate, flushCamera } = useCanvasCamera(initialCamera(workspace.camera), commitCamera, paintCamera);
  useLayoutEffect(() => { paintCamera(cameraRef.current); });
  useEffect(() => registerBeforeFlush?.(flushCamera), [registerBeforeFlush, flushCamera]);
  // See studio.css: a layer while panning, never across a zoom change. An
  // attribute, not a class, so React's className updates cannot drop it.
  const settle = useRef(null), seenCamera = useRef(camera);
  useEffect(() => {
    const previous = seenCamera.current; seenCamera.current = camera;
    const el = root.current; if (!el || previous === camera) return;
    clearTimeout(settle.current);
    if (previous.zoom !== camera.zoom) { delete el.dataset.sliding; return; }
    el.dataset.sliding = '';
    settle.current = setTimeout(() => { delete el.dataset.sliding; }, 160);
  }, [camera]);
  useEffect(() => () => clearTimeout(settle.current), []);
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
  // Chrome floats over the canvas, so framing avoids the rail, top bar, dock and inspector.
  const safeArea = useCallback(() => {
    const canvas = root.current?.getBoundingClientRect(), area = { left: 0, right: 0, top: 72, bottom: 88 };
    if (!canvas) return area;
    const rail = document.querySelector('.project-rail')?.getBoundingClientRect();
    if (rail && rail.height > 96) area.left = clamp(rail.right - canvas.left, 0, canvas.width / 2);
    const inspector = document.querySelector('.inspector-host')?.getBoundingClientRect();
    if (inspector) area.right = clamp(canvas.right - inspector.left, 0, canvas.width / 2);
    return area;
  }, []);
  const fit = useCallback((selectionOnly = false) => {
    const targets = selectionOnly === true ? nodes.filter(n => selected.includes(n.id)) : nodes;
    if (!targets.length) { if (!selectionOnly) navigate(defaultCamera); return; }
    const left = Math.min(...targets.map(n => n.x)), top = Math.min(...targets.map(n => n.y - (n.type === 'zone' ? 44 : 0)));
    const right = Math.max(...targets.map(n => n.x + n.width)), bottom = Math.max(...targets.map(n => n.y + n.height));
    const a = safeArea(), w = Math.max(160, size.width - a.left - a.right), h = Math.max(120, size.height - a.top - a.bottom);
    const zoom = clamp(Math.min((w - 64) / (right - left), (h - 32) / (bottom - top)), .15, 1);
    navigate({ x: a.left + (w - (right - left) * zoom) / 2 - left * zoom, y: a.top + (h - (bottom - top) * zoom) / 2 - top * zoom, zoom });
  }, [nodes, selected, size, navigate, safeArea]);
  const fitRef = useRef(fit); fitRef.current = fit;
  useEffect(() => { if (fitRequest) fitRef.current(); }, [fitRequest]);
  const frameTo = useCallback(request => {
    if (!request?.id || handledJump.current === request) return;
    const found = live.current.nodes.find(n => n.id === request.id); if (!found) return;
    const n = found.type === 'zone' ? { ...found, y: found.y - 44, height: found.height + 44 } : found;
    handledJump.current = request;
    const a = safeArea(), w = Math.max(160, size.width - a.left - a.right), h = Math.max(80, size.height - a.top - a.bottom);
    const zoom = Math.min(1, (w - 64) / n.width, (h - 24) / n.height);
    navigate({ x: a.left + (w - n.width * zoom) / 2 - n.x * zoom, y: a.top + (h - n.height * zoom) / 2 - n.y * zoom, zoom });
  }, [size.width, size.height, navigate, safeArea]);
  useEffect(() => frameTo(jumpRequest), [jumpRequest, frameTo]);
  useEffect(() => frameTo(frameRequest), [frameRequest, frameTo]);
  const zoomAt = useCallback((zoom, x = size.width / 2, y = size.height / 2, smooth = true) => {
    const old = cameraRef.current, next = clamp(zoom, .15, 1.8);
    (smooth ? navigate : updateCamera)({ x: x - (x - old.x) * next / old.zoom, y: y - (y - old.y) * next / old.zoom, zoom: next });
  }, [navigate, updateCamera, size, cameraRef]);
  useEffect(() => {
    const el = root.current;
    const wheel = e => {
      if (inputBlocked || live.current.focused || e.target.closest('.canvas-navigation,.canvas-popover,.agent-editor')) return;
      // xterm owns wheel gestures, including modified wheel mouse reports.
      if (e.target.closest('.terminal-host,.canvas-minimap')) return;
      stopInertia();
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
  }, [updateCamera, zoomAt, inputBlocked, size.height, stopInertia]);
  useEffect(() => {
    const key = e => {
      if (inputBlocked || !root.current?.contains(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter' && !e.target.closest('.inline-name-input')) { e.preventDefault(); onFocus(focused ? null : selected[0] || nodes[0]?.id); return; }
      if (editable(e.target)) return;
      if (e.key === 'Escape' && navigationMenu) { e.preventDefault(); setNavigationMenu(null); return; }
      if (e.target.closest('button,.canvas-popover')) return;
      if (e.key === 'Escape' && (draft || openComment || tool === 'comment')) { e.preventDefault(); setDraft(null); setOpenComment(null); setTool('select'); return; }
      if (e.key === 'Escape') { setNavigationMenu(null); onFocus(null); onSelect([]); }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'c') { setTool(current => current === 'comment' ? 'select' : 'comment'); return; }
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
  }, [focused, selected, nodes, onFocus, onSelect, inputBlocked, onMenu, size, zoomAt, navigationMenu, draft, openComment, tool]);
  // Moving a zone carries every panel that lies fully inside it.
  const moving = ids => {
    const set = new Set(ids);
    for (const z of nodes) if (set.has(z.id) && z.type === 'zone') for (const n of nodes) if (n.id !== z.id && inside(n, z)) set.add(n.id);
    return set;
  };
  const begin = (e, kind, node) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (inputBlocked || focused || e.target.closest('.agent-editor')) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    stopInertia();
    const ids = node && selected.includes(node.id) ? selected : node ? [node.id] : [];
    if (node) onSelect(e.shiftKey ? [...new Set([...selected, node.id])] : ids);
    else if (kind !== 'pan' && !e.shiftKey) onSelect([]);
    root.current.focus({ preventScroll: true });
    setNavigationMenu(null);
    gesture.current = { kind, startX: e.clientX, startY: e.clientY, camera: { ...cameraRef.current }, originals: nodes.filter(n => moving(ids).has(n.id)).map(n => ({ ...n })), node, selection: e.shiftKey ? selected : [], pointerId: e.pointerId, last: null, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    if (kind === 'pan') setPanning(true);
  };
  // Images and videos keep their ratio while resizing (Shift frees it), like a design tool.
  const resized = (node, width, height, free) => {
    const media = node.type === 'reference' && node.data?.aspect && node.data.kind !== 'link' && !free;
    const w = Math.round(Math.max(node.type === 'terminal' ? 400 : node.type === 'zone' ? 240 : node.type === 'reference' ? 180 : 320, width));
    return { width: w, height: media ? Math.round(REFERENCE_CHROME + w / node.data.aspect) : Math.round(Math.max(node.type === 'zone' ? 160 : node.type === 'reference' ? 150 : 240, height)) };
  };
  const worldPoint = (clientX, clientY) => { const r = root.current.getBoundingClientRect(), c = cameraRef.current; return { x: (clientX - r.left - c.x) / c.zoom, y: (clientY - r.top - c.y) / c.zoom }; };
  // A paste or drop becomes panels: files and image URLs as references, links
  // as link cards, anything else as a note. Each lands where the pointer is.
  const addItems = async (items, point) => {
    const made = [], place = { center: true, ...(spaceId ? { spaceId } : {}) };
    setImporting(n => n + items.length);
    for (const [index, item] of items.entries()) {
      const at = { ...place, x: Math.round(point.x + index * 32), y: Math.round(point.y + index * 32) };
      try {
        let node;
        if (item.kind === 'file') {
          const image = item.file.type.startsWith('image/'), filePath = window.phantom?.pathForFile?.(item.file) || '';
          if (!filePath && !(image && item.file.size <= INLINE_LIMIT)) throw new Error(image ? 'La imagen supera el límite de 12 MB' : 'Arrastra el video desde tus archivos para añadirlo');
          const named = item.file.name && !/^image\.\w+$/i.test(item.file.name) ? { title: item.file.name.replace(/\.[^.]+$/, '').slice(0, 200) } : {};
          node = await api('reference.add', { workspaceId: workspace.id, ...(filePath ? { path: filePath } : { data: await toBase64(item.file) }), ...named, ...at });
        } else if (item.kind === 'link') node = await api('reference.link', { workspaceId: workspace.id, url: item.url, ...at });
        else node = await api('node.create', { workspaceId: workspace.id, type: 'note', title: 'Nota', x: at.x - 210, y: at.y - 170, width: 420, height: 340, data: { text: item.text.slice(0, 60000), ...(spaceId ? { spaceId } : {}) } });
        made.push(node.id);
      } catch (error) { notify(`No se pudo añadir la referencia: ${error.message}`, 'error'); }
      finally { setImporting(n => n - 1); }
    }
    if (made.length) { await refresh(); onSelect(made); }
  };
  const addItemsRef = useRef(addItems); addItemsRef.current = addItems;
  useEffect(() => {
    const paste = e => {
      if (inputBlocked || live.current.focused || (e.target instanceof Element && editable(e.target))) return;
      const owner = document.activeElement;
      if (owner && owner !== document.body && !root.current?.contains(owner)) return;
      const items = readTransfer(e.clipboardData); if (!items.length) return;
      e.preventDefault();
      const r = root.current.getBoundingClientRect(), p = pointer.current && pointer.current.x >= r.left && pointer.current.x <= r.right && pointer.current.y >= r.top && pointer.current.y <= r.bottom ? pointer.current : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      addItemsRef.current(items, worldPoint(p.x, p.y));
    };
    window.addEventListener('paste', paste); return () => window.removeEventListener('paste', paste);
  }, [inputBlocked]);
  const droppable = e => !inputBlocked && !focused && ['Files', 'text/uri-list'].some(type => e.dataTransfer?.types?.includes(type));
  const drop = e => { if (!droppable(e)) return; e.preventDefault(); const items = readTransfer(e.dataTransfer); if (items.length) addItems(items, worldPoint(e.clientX, e.clientY)); else notify('Suelta imágenes, videos o enlaces para añadirlos como referencias.'); };
  // Comment tool: a click drops a pin on the panel under it (as a fraction of
  // its box, so the pin follows the panel) or on the canvas itself.
  const placeComment = e => {
    e.preventDefault(); e.stopPropagation();
    const element = e.target.closest('[data-node-id]');
    if (element) {
      const r = element.getBoundingClientRect(), media = element.querySelector('[data-reference-video]');
      media?.pause();
      setDraft({ nodeId: element.dataset.nodeId, x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1), ...(media && media.currentTime > 0 ? { time: Math.round(media.currentTime * 10) / 10 } : {}) });
    } else if (!focused) { const p = worldPoint(e.clientX, e.clientY); setDraft({ nodeId: null, x: Math.round(p.x), y: Math.round(p.y), ...(spaceId ? { spaceId } : {}) }); }
    setOpenComment(null);
  };
  const seek = (nodeId, time) => { const media = root.current?.querySelector(`[data-node-id="${nodeId}"] [data-reference-video]`); if (media) { media.pause(); media.currentTime = time; } };
  const comments = useMemo(() => visibleComments(workspace.comments, nodes, spaceId).filter(c => !focused || c.nodeId === focused), [workspace.comments, nodes, spaceId, focused]);
  const commentsByNode = useMemo(() => { const map = new Map(); for (const c of comments) if (c.nodeId) map.set(c.nodeId, [...(map.get(c.nodeId) || []), c]); return map; }, [comments]);
  const geometryOf = id => { const n = nodes.find(node => node.id === id); if (!n) return null; if (focused) return focused === id ? { x: 12, y: 72, width: Math.max(320, size.width - 24), height: Math.max(240, size.height - 160) } : null; return { ...n, ...preview[id] }; };
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
      const next = [...new Set([...g.selection, ...nodes.filter(n => n.type === 'zone' ? n.x * c.zoom + c.x >= box.x && (n.x + n.width) * c.zoom + c.x <= box.x + box.width && n.y * c.zoom + c.y >= box.y && (n.y + n.height) * c.zoom + c.y <= box.y + box.height : n.x * c.zoom + c.x < box.x + box.width && (n.x + n.width) * c.zoom + c.x > box.x && n.y * c.zoom + c.y < box.y + box.height && (n.y + n.height) * c.zoom + c.y > box.y).map(n => n.id)])];
      if (!sameIds(next, live.current.selected)) onSelect(next);
    } else {
      previewRef.current = g.kind === 'move' ? Object.fromEntries(g.originals.map(n => [n.id, { x: Math.round(n.x + dx / g.camera.zoom), y: Math.round(n.y + dy / g.camera.zoom) }])) : { [g.node.id]: resized(g.node, g.node.width + dx / g.camera.zoom, g.node.height + dy / g.camera.zoom, g.last.shiftKey) };
      setPreview(previewRef.current);
    }
  };
  // Release with momentum: keep gliding with the last pointer velocity and decay smoothly.
  const glide = g => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const first = g.samples[0], last = g.samples[g.samples.length - 1], dt = last.t - first.t;
    if (dt <= 0 || performance.now() - last.t > 60) return;
    let vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
    if (Math.hypot(vx, vy) < .25) return;
    let previous = performance.now();
    const tick = now => {
      const step = Math.min(32, now - previous); previous = now;
      const decay = Math.pow(.9935, step);
      vx *= decay; vy *= decay;
      const c = cameraRef.current;
      updateCamera({ ...c, x: c.x + vx * step, y: c.y + vy * step });
      inertia.current = Math.hypot(vx, vy) > .02 ? requestAnimationFrame(tick) : null;
    };
    inertia.current = requestAnimationFrame(tick);
  };
  const move = e => {
    const g = gesture.current; if (!g) return;
    // Panning already coalesces per frame inside the camera hook.
    if (g.kind === 'pan') {
      updateCamera({ ...g.camera, x: g.camera.x + e.clientX - g.startX, y: g.camera.y + e.clientY - g.startY });
      const now = performance.now();
      g.samples.push({ x: e.clientX, y: e.clientY, t: now });
      while (g.samples.length > 2 && now - g.samples[0].t > 90) g.samples.shift();
      return;
    }
    g.last = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
    if (gestureFrame.current === null) gestureFrame.current = requestAnimationFrame(step);
  };
  const finish = e => {
    if (!gesture.current) return;
    if (gestureFrame.current !== null) { cancelAnimationFrame(gestureFrame.current); step(); }
    if (gesture.current.kind === 'pan' && e?.type === 'pointerup') glide(gesture.current);
    Object.entries(previewRef.current).forEach(([id, patch]) => onChange(id, patch)); previewRef.current = {}; setPreview({}); gesture.current = null; setPanning(false); setMarquee(null); flushCamera();
    if (e?.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  finishRef.current = finish;
  useEffect(() => () => cancelAnimationFrame(gestureFrame.current), []);
  // Stable callbacks for memoized nodes; they always call the latest closure.
  const latest = useRef({}); latest.current = { begin, onMenu, onFocus, onSelect, onCloseTerminal, rename };
  // Closing a thread or a draft hands the keyboard back to the canvas, so Esc, C and V keep working.
  const openThread = useCallback(id => { setDraft(null); setOpenComment(id); if (!id) root.current?.focus({ preventScroll: true }); }, []);
  const writeDraft = useCallback(next => { setDraft(next); if (!next) root.current?.focus({ preventScroll: true }); }, []);
  const handlers = useMemo(() => ({
    begin: (...args) => latest.current.begin(...args),
    menu: (...args) => latest.current.onMenu(...args),
    focus: id => latest.current.onFocus(id),
    chatPulse: (id, kind) => setChatPulses(current => (current[id] || '') === (kind || '') ? current : { ...current, [id]: kind || undefined }),
    select: ids => latest.current.onSelect(ids),
    closeTerminal: node => latest.current.onCloseTerminal(node),
    openComment: id => { setDraft(null); setOpenComment(id); },
    titleButton: (id, element) => { if (element) titleButtons.current.set(id, element); else titleButtons.current.delete(id); },
    renameStart: node => latest.current.rename.start(node.id, node.title, () => titleButtons.current.get(node.id)),
    renameChange: value => latest.current.rename.change(value),
    renameCommit: returnFocus => latest.current.rename.commit(returnFocus),
    renameCancel: () => latest.current.rename.cancel(),
    renameInput: element => { latest.current.rename.inputRef.current = element; },
  }), []);
  const focusedNode = nodes.find(n => n.id === focused);
  const frameNode = useCallback(id => setFrameRequest({ id, nonce: Date.now() }), []);
  useEffect(() => { if (focusedNode?.type === 'zone') { onFocus(null); frameNode(focusedNode.id); } }, [focusedNode, onFocus, frameNode]);
  const tier = focused ? 0 : cameraTier(camera.zoom);
  const pixelTargets = useMemo(() => focused ? [] : nodes.flatMap(n => {
    const kind = PIXEL_KIND[pulseState(n, terminalActivity[n.id], chatPulses[n.id])];
    return kind ? [{ ...n, ...preview[n.id], id: n.id, kind }] : [];
  }), [nodes, preview, terminalActivity, chatPulses, focused]);
  const connected = !connection || connection.status === 'connected';
  return <section ref={root} tabIndex={0} className={`canvas ${focused ? 'focus-mode' : ''} ${panning ? 'is-panning' : ''} ${tool === 'hand' || spaceHeld ? 'hand-tool' : ''} ${tool === 'comment' ? 'comment-tool' : ''}`} style={gridStyle(camera)} aria-label="Lienzo espacial del proyecto" onPointerMove={e => { pointer.current = { x: e.clientX, y: e.clientY }; move(e); }} onDragOver={e => { if (droppable(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={drop} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onPointerDownCapture={e => { if (tool === 'comment' && e.button === 0 && !inputBlocked && !e.target.closest('.canvas-navigation,.canvas-popover,.focus-return,.canvas-minimap,.comment-anchor,.node-header,.zone-label')) { placeComment(e); return; } if (!e.target.closest('.canvas-navigation,.canvas-popover,.focus-return,.canvas-minimap,.comment-anchor') && (e.button === 1 || tool === 'hand' || space.current)) begin(e, 'pan'); }} onPointerDown={e => { if (e.target === e.currentTarget || e.target.closest('.canvas-world') === e.target || (e.target.closest('.canvas-empty') && !e.target.closest('button'))) begin(e, 'select'); }} onContextMenu={e => { if (!e.target.closest('.canvas-node')) { e.preventDefault(); onMenu(null, e.clientX, e.clientY); } }}>
    <Presence>{focusedNode && <div className="focus-return"><button onClick={() => onFocus(null)}><ArrowLeft size={15} /> Volver al mapa</button><span>{focusedNode.title}</span><kbd>Ctrl ⇧ ↵</kbd></div>}</Presence>
    {!nodes.length && <div className="canvas-empty"><div className="empty-symbol"><Layers size={30} strokeWidth={1.4} /></div><h2>Tu mesa de trabajo, en un lugar</h2><p>Abre una terminal, toma una nota o pega una imagen, un video o un enlace.<br />Cada panel conserva su lugar en este proyecto.</p><div className="empty-actions"><button className="button primary" onClick={() => onOpenPanel('terminal')}><TerminalSquare size={16} /> Crear terminal</button><button className="button" onClick={() => onOpenPanel('note')}><StickyNote size={16} /> Escribir nota</button></div><span className="empty-hint">Arrastra una cabecera para organizar · Ctrl + V pega referencias · C comenta</span></div>}
    <PixelField targets={pixelTargets} cameraRef={cameraRef} paintRef={fieldPaint} hidden={!!focused} />
    <div ref={world} className="canvas-world">
      <PresenceGroup>{nodes.map(node => {
        const isFocused = focused === node.id;
        if (node.type === 'zone') {
          if (focused) return null;
          const g = { ...node, ...preview[node.id] }, color = ZONE_COLORS.includes(node.data?.color) ? node.data.color : 'iris';
          return <section key={node.id} className={`canvas-zone zone-${color} ${selected.includes(node.id) ? 'selected' : ''} ${preview[node.id] ? 'is-dragging' : ''}`} aria-label={`Zona: ${node.title}`} style={{ left: g.x, top: g.y, width: g.width, height: g.height, '--map-label-scale': Math.min(3, Math.max(1, 1 / camera.zoom)) }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onMenu(node.id, e.clientX, e.clientY); }}>
            <header className="zone-label" onPointerDown={e => { if (!e.target.closest('button,input')) begin(e, 'move', node); }} onDoubleClick={e => { if (!e.target.closest('button,input')) frameNode(node.id); }}>
              <button className="zone-swatch" aria-label={`Color de la zona: ${color}. Cambiar`} title="Cambiar color" onClick={() => onChange(node.id, { data: { ...node.data, color: ZONE_COLORS[(ZONE_COLORS.indexOf(color) + 1) % ZONE_COLORS.length] } })} />
              {rename.editing?.id === node.id ? <input ref={rename.inputRef} className="inline-name-input" aria-label="Nombre de la zona" value={rename.editing.value} readOnly={rename.editing.saving} onChange={e => rename.change(e.target.value)} onPointerDown={e => e.stopPropagation()} onBlur={() => rename.commit(false)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); rename.commit(true); } if (e.key === 'Escape') { e.preventDefault(); rename.cancel(); } }} /> : <button ref={element => { if (element) titleButtons.current.set(node.id, element); else titleButtons.current.delete(node.id); }} className="zone-title" title="Renombrar zona" onClick={() => rename.start(node.id, node.title, () => titleButtons.current.get(node.id))}>{node.title}</button>}
              <span className="zone-count">{nodes.filter(n => n.id !== node.id && n.type !== 'zone' && inside(n, g)).length}</span>
            </header>
            <button className="resize-handle zone-resize" aria-label="Cambiar tamaño de la zona" title="Arrastra para cambiar tamaño" onPointerDown={e => begin(e, 'resize', node)} />
          </section>;
        }
        const editing = rename.editing?.id === node.id ? rename.editing : null;
        const sharedWorkspace = node.type === 'terminal' || node.type === 'browser' || node.type === 'note' || node.type === 'reference' ? panelWorkspace : workspace;
        return <CanvasNode key={node.id} node={node} preview={preview[node.id]} focusSize={isFocused ? size : null} anyFocused={!!focused} selected={selected.includes(node.id)} small={tier > 0} compact={tier > 1} magnified={tier < 0} missionTitle={node.groupId ? workspace.missions?.find(m => m.id === node.groupId)?.title : undefined} activity={node.type === 'terminal' ? terminalActivity[node.id] : undefined} chatPulse={chatPulses[node.id]} editing={editing} anyEditing={!!rename.editing} workspace={sharedWorkspace} handlers={handlers} api={api} refresh={refresh} flush={flush} notify={notify} onOpenPanel={onOpenPanel} onChange={onChange} onRelaunch={onRelaunch} connected={connected} active={!inputBlocked && (isFocused || (!focused && selected.length === 1 && selected[0] === node.id))} inputBlocked={inputBlocked} obscured={obscured} comments={node.type === 'reference' ? commentsByNode.get(node.id) || NO_COMMENTS : undefined} />;
      })}</PresenceGroup>
      <CommentLayer comments={comments} draft={draft} open={openComment} active={tool === 'comment'} geometryOf={geometryOf} nodeOf={id => nodes.find(n => n.id === id)} pathOf={node => node.data?.file && dataDir ? `${dataDir}/references/${workspace.id}/${node.data.file}` : null} api={api} workspaceId={workspace.id} notify={notify} onOpen={openThread} onDraft={writeDraft} seek={seek} />
    </div>
    {importing > 0 && <div className="reference-importing" role="status"><LoaderCircle size={14} className="spinning" />Añadiendo {importing === 1 ? 'referencia' : `${importing} referencias`}…</div>}
    {tool === 'comment' && <div className="comment-hint" role="status"><MessageCircle size={14} />Haz clic donde quieras comentar<kbd>Esc</kbd></div>}
    {marquee && <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
    {!focused && minimap && <Minimap nodes={nodes} camera={camera} cameraRef={cameraRef} frameRef={minimapFrame} size={size} selected={selected} onUpdate={next => { stopInertia(); updateCamera(next); }} />}
    {!focused && <><div className="canvas-navigation" role="toolbar" aria-label="Navegación del canvas">
      <button aria-label="Herramienta de selección" title="Seleccionar · V" aria-pressed={tool === 'select'} onClick={() => { setTool('select'); root.current.focus(); }}><MousePointer2 size={16} /></button>
      <button aria-label="Herramienta de mano" title="Mover mapa · H · Mantén Espacio" aria-pressed={tool === 'hand'} onClick={() => { setTool('hand'); root.current.focus(); }}><Hand size={16} /></button>
      <button aria-label="Herramienta de comentarios" title="Comentar · C" aria-pressed={tool === 'comment'} onClick={() => { setTool(current => current === 'comment' ? 'select' : 'comment'); root.current.focus(); }}><MessageCircle size={16} />{comments.some(c => !c.resolved) && <b className="comment-count">{comments.filter(c => !c.resolved).length}</b>}</button><i />
      <button title="Alejar (−)" aria-label="Alejar" disabled={camera.zoom <= .15} onClick={() => zoomAt(cameraRef.current.zoom / 1.2)}><Minus size={15} /></button>
      <button className="zoom-value" aria-label={`Zoom ${Math.round(camera.zoom * 100)}%. Opciones de zoom`} aria-expanded={navigationMenu === 'zoom'} aria-controls="canvas-zoom-options" onClick={() => setNavigationMenu(menu => menu === 'zoom' ? null : 'zoom')}><span ref={zoomLabel}>{Math.round(camera.zoom * 100)}</span>%<ChevronDown size={12} /></button>
      <button title="Acercar (+)" aria-label="Acercar" disabled={camera.zoom >= 1.8} onClick={() => zoomAt(cameraRef.current.zoom * 1.2)}><Plus size={15} /></button><i />
      <button title="Ajustar todos los paneles · 0" aria-label="Ajustar todos los paneles" onClick={() => fit()}><LocateFixed size={17} /></button>
      <button title="Minimapa" aria-label="Mostrar minimapa" aria-pressed={minimap} onClick={toggleMinimap}><MapIcon size={16} /></button>
      <button title="Gestos y atajos · ?" aria-label="Gestos y atajos del canvas" aria-expanded={navigationMenu === 'help'} aria-controls="canvas-gesture-help" onClick={() => setNavigationMenu(menu => menu === 'help' ? null : 'help')}><HelpCircle size={16} /></button>
    </div>
    {navigationMenu && <div className="canvas-popover" id={navigationMenu === 'zoom' ? 'canvas-zoom-options' : 'canvas-gesture-help'} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNavigationMenu(null); root.current.querySelector(`[aria-controls="${e.currentTarget.id}"]`)?.focus(); } }}>
      <div className="canvas-popover-heading"><strong>{navigationMenu === 'zoom' ? 'Vista del canvas' : 'Muévete por tu espacio'}</strong><button aria-label="Cerrar controles del canvas" onClick={() => setNavigationMenu(null)}><X size={14} /></button></div>
      {navigationMenu === 'zoom' ? <><button onClick={() => { fit(); setNavigationMenu(null); }}>Ajustar todos los paneles<kbd>0</kbd></button><button disabled={!selected.length} onClick={() => { fit(true); setNavigationMenu(null); }}>Acercar a la selección<kbd>2</kbd></button><div className="canvas-zoom-presets">{[.25, .5, 1, 1.5].map(zoom => <button key={zoom} onClick={() => { zoomAt(zoom); setNavigationMenu(null); }}>{zoom * 100}%</button>)}</div></> : <dl><div><dt>Mover mapa</dt><dd><kbd>Espacio</kbd> + arrastrar</dd></div><div><dt>Desplazar</dt><dd>Trackpad / rueda central</dd></div><div><dt>Zoom al cursor</dt><dd><kbd>Ctrl</kbd> + rueda / pellizco</dd></div><div><dt>Seleccionar varios</dt><dd>Arrastrar en el fondo</dd></div><div><dt>Sumar selección</dt><dd><kbd>Shift</kbd> + arrastrar</dd></div><div><dt>Zoom real / ajustar</dt><dd><kbd>1</kbd> / <kbd>0</kbd></dd></div><div><dt>Pegar imagen, video o enlace</dt><dd><kbd>Ctrl</kbd> + <kbd>V</kbd> / soltar</dd></div><div><dt>Comentar</dt><dd><kbd>C</kbd> + clic</dd></div></dl>}
    </div>}</>}
  </section>;
}
