import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Maximize2, MoreHorizontal, Plus, TerminalSquare, Globe, StickyNote, Layers, Minus, LocateFixed, MousePointer2, X } from 'lucide-react';
import TerminalPanel from './TerminalPanel';
import BrowserPanel from './BrowserPanel';
import { ToolPanel } from './ToolPanels';
import { useInlineName } from '../hooks/useInlineName';
import { isEditingTarget } from '../hooks/inputOwnership';
import { Presence, PresenceGroup } from './Presence';
import { TerminalActivity } from './ActivityNotch';

const icons = { terminal: TerminalSquare, browser: Globe, note: StickyNote };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const editable = isEditingTarget;

export default function Canvas({ workspace, activity, api, refresh, notify, onOpenPanel, onChange, onCamera, focused, onFocus, selected, onSelect, obscured, inputBlocked, onMenu, onRelaunch, onCloseTerminal, fitRequest, jumpRequest, connection, renameRequest, flush, registerBeforeFlush }) {
  const root = useRef(null);
  const gesture = useRef(null);
  const handledJump = useRef(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [preview, setPreview] = useState({});
  const titleButtons = useRef(new Map());
  const rename = useInlineName({ stage: (id, title) => onChange(id, { title }), flush, registerBeforeFlush });
  const [panning, setPanning] = useState(false);
  const nodes = (workspace.nodes || []).filter(n => !n.data?.hidden);
  const camera = workspace.camera || { x: 64, y: 64, zoom: 1 };
  const live = useRef({ camera, nodes, selected, focused }); live.current = { camera, nodes, selected, focused };
  useEffect(() => {
    const node = live.current.nodes.find(n => n.id === renameRequest?.id);
    if (node) rename.start(node.id, node.title, () => titleButtons.current.get(node.id));
  }, [renameRequest]);
  useEffect(() => { const obs = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height })); if (root.current) obs.observe(root.current); return () => obs.disconnect(); }, []);
  const fit = useCallback(() => {
    if (!nodes.length) { onCamera({ x: 64, y: 64, zoom: 1 }); return; }
    const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
    const right = Math.max(...nodes.map(n => n.x + n.width)), bottom = Math.max(...nodes.map(n => n.y + n.height));
    const zoom = clamp(Math.min((size.width - 112) / (right - left), (size.height - 160) / (bottom - top)), .15, 1);
    onCamera({ x: (size.width - (right - left) * zoom) / 2 - left * zoom, y: (size.height - 70 - (bottom - top) * zoom) / 2 - top * zoom, zoom });
  }, [nodes, size, onCamera]);
  const fitRef = useRef(fit); fitRef.current = fit;
  useEffect(() => { if (fitRequest) fitRef.current(); }, [fitRequest]);
  useEffect(() => {
    if (!jumpRequest?.id || handledJump.current === jumpRequest) return;
    const n = live.current.nodes.find(n => n.id === jumpRequest.id); if (!n) return;
    handledJump.current = jumpRequest;
    const zoom = Math.min(1, (size.width - 100) / n.width, (size.height - 140) / n.height);
    onCamera({ x: (size.width - n.width * zoom) / 2 - n.x * zoom, y: (size.height - 80 - n.height * zoom) / 2 - n.y * zoom, zoom });
  }, [jumpRequest, size.width, size.height, onCamera]);
  const zoomAt = useCallback((zoom, x = size.width / 2, y = size.height / 2) => {
    const old = live.current.camera, next = clamp(zoom, .15, 1.8);
    onCamera({ x: x - (x - old.x) * next / old.zoom, y: y - (y - old.y) * next / old.zoom, zoom: next });
  }, [onCamera, size]);
  useEffect(() => {
    const el = root.current;
    const wheel = e => {
      if (live.current.focused || e.target.closest('.canvas-node')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(live.current.camera.zoom * Math.exp(-e.deltaY * .004), e.clientX - r.left, e.clientY - r.top);
      else if (e.altKey) zoomAt(live.current.camera.zoom * Math.exp(-e.deltaY * .002), e.clientX - r.left, e.clientY - r.top);
      else onCamera({ ...live.current.camera, x: live.current.camera.x - e.deltaX, y: live.current.camera.y - e.deltaY });
    };
    el?.addEventListener('wheel', wheel, { passive: false }); return () => el?.removeEventListener('wheel', wheel);
  }, [onCamera, zoomAt]);
  useEffect(() => {
    const key = e => {
      if (inputBlocked || !root.current?.contains(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter' && !e.target.closest('.inline-name-input')) { e.preventDefault(); onFocus(focused ? null : selected[0] || nodes[0]?.id); return; }
      if (editable(e.target)) return;
      if (e.key === 'Escape') { onFocus(null); onSelect([]); }
      if (e.key === 'Enter' && selected[0]) { e.preventDefault(); onFocus(selected[0]); }
      if (e.key === '0' && !e.ctrlKey && !e.metaKey) fitRef.current();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected[0]) { e.preventDefault(); const r = root.current.getBoundingClientRect(); onMenu(selected[0], r.x + size.width / 2, r.y + 100); }
      if (e.key === 'Tab' && e.target === root.current && nodes.length) { e.preventDefault(); const index = nodes.findIndex(n => n.id === selected[0]); const n = nodes[(index + (e.shiftKey ? nodes.length - 1 : 1)) % nodes.length]; onSelect([n.id]); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [focused, selected, nodes, onFocus, onSelect, inputBlocked, onMenu, size]);
  const begin = (e, kind, node) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (kind === 'pan' && focused) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const ids = node && selected.includes(node.id) ? selected : node ? [node.id] : [];
    if (node) onSelect(e.shiftKey ? [...new Set([...selected, node.id])] : ids);
    else if (!e.altKey && e.button !== 1) onSelect([]);
    gesture.current = { kind, startX: e.clientX, startY: e.clientY, camera: { ...camera }, originals: nodes.filter(n => ids.includes(n.id)).map(n => ({ ...n })), node, pointerId: e.pointerId };
    if (kind === 'pan') setPanning(true);
  };
  const move = e => {
    const g = gesture.current; if (!g) return;
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    if (g.kind === 'pan') onCamera({ ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy });
    else if (g.kind === 'move') setPreview(Object.fromEntries(g.originals.map(n => [n.id, { x: Math.round(n.x + dx / camera.zoom), y: Math.round(n.y + dy / camera.zoom) }])));
    else setPreview({ [g.node.id]: { width: Math.round(Math.max(g.node.type === 'terminal' ? 400 : 320, g.node.width + dx / camera.zoom)), height: Math.round(Math.max(240, g.node.height + dy / camera.zoom)) } });
  };
  const finish = () => { Object.entries(preview).forEach(([id, patch]) => onChange(id, patch)); setPreview({}); gesture.current = null; setPanning(false); };
  const focusedNode = nodes.find(n => n.id === focused);
  return <section ref={root} tabIndex={0} className={`canvas ${focused ? 'focus-mode' : ''} ${panning ? 'is-panning' : ''}`} aria-label="Lienzo espacial del proyecto" onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onPointerDown={e => { if (e.target === e.currentTarget || e.target.closest('.canvas-world') === e.target) begin(e, 'pan'); }} onContextMenu={e => { if (!e.target.closest('.canvas-node')) { e.preventDefault(); onMenu(null, e.clientX, e.clientY); } }}>
    <Presence>{focusedNode && <div className="focus-return"><button onClick={() => onFocus(null)}><ArrowLeft size={15} /> Volver al mapa</button><span>{focusedNode.title}</span><kbd>Ctrl ⇧ ↵</kbd></div>}</Presence>
    {!nodes.length && <div className="canvas-empty"><div className="empty-symbol"><Layers size={30} strokeWidth={1.4} /></div><h2>Tu mesa de trabajo, en un lugar</h2><p>Abre una terminal, toma una nota o conecta una herramienta.<br />Cada panel conserva su lugar en este proyecto.</p><div className="empty-actions"><button className="button primary" onClick={() => onOpenPanel('terminal')}><TerminalSquare size={16} /> Crear terminal</button><button className="button" onClick={() => onOpenPanel('note')}><StickyNote size={16} /> Escribir nota</button></div><span className="empty-hint">Arrastra una cabecera para organizar · Ctrl + rueda para acercar</span></div>}
    <div className="canvas-world" style={focused ? { transform: 'none' } : { transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
      <PresenceGroup>{nodes.map(node => {
        const Icon = icons[node.type] || Layers, isFocused = focused === node.id, small = !focused && camera.zoom < .45;
        const geometry = isFocused ? { x: 24, y: 55, width: Math.max(320, size.width - 48), height: Math.max(240, size.height - 145) } : { ...node, ...preview[node.id] };
        return <article key={node.id} className={`canvas-node ${selected.includes(node.id) ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${small ? 'overview' : ''}`} style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height, '--map-label-scale': focused ? 1 : Math.min(2.4, Math.max(1, 1 / camera.zoom)), display: focused && !isFocused ? 'none' : undefined }} onPointerDown={() => { if (!selected.includes(node.id)) onSelect([node.id]); }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onMenu(node.id, e.clientX, e.clientY); }}>
          <header className="node-header" onPointerDown={e => { if (!e.target.closest('button,input') && !focused) begin(e, 'move', node); }} onDoubleClick={e => { if (!e.target.closest('button,input')) onFocus(isFocused ? null : node.id); }}>
            <Icon size={15} /><div className="node-title">{rename.editing?.id === node.id ? <><input ref={rename.inputRef} className="inline-name-input" aria-label="Nombre del panel" aria-invalid={!!rename.editing.error} aria-describedby={rename.editing.error ? `name-error-${node.id}` : undefined} value={rename.editing.value} readOnly={rename.editing.saving} onChange={e => rename.change(e.target.value)} onPointerDown={e => e.stopPropagation()} onBlur={() => rename.commit(false)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); rename.commit(true); } if (e.key === 'Escape') { e.preventDefault(); rename.cancel(); } }} />{rename.editing.error && <span className="inline-name-error" id={`name-error-${node.id}`} role="alert">{rename.editing.error}</span>}</> : <button ref={element => { if (element) titleButtons.current.set(node.id, element); else titleButtons.current.delete(node.id); }} className="title-button" title="Renombrar panel" onClick={() => rename.start(node.id, node.title, () => titleButtons.current.get(node.id))}>{node.title}</button>}</div>
            {node.type === 'terminal' && <TerminalActivity compact session={activity?.sessions.find(s => s.nodeId === node.id)} />}
            {node.groupId && <span className="mission-chip" title={workspace.missions?.find(m => m.id === node.groupId)?.title}>{workspace.missions?.find(m => m.id === node.groupId)?.title || 'Misión'}</span>}
            <button className="icon-button" aria-label={isFocused ? 'Volver al mapa' : 'Enfocar panel'} title={isFocused ? 'Volver al mapa' : 'Enfocar panel'} onClick={() => onFocus(isFocused ? null : node.id)}>{isFocused ? <ArrowLeft size={14} /> : <Maximize2 size={14} />}</button>
            <button className="icon-button" aria-label="Opciones del panel" title="Opciones del panel" onClick={e => onMenu(node.id, e.clientX, e.clientY)}><MoreHorizontal size={16} /></button>
            {node.type === 'terminal' && <button className="icon-button" aria-label="Cerrar terminal" title="Cerrar terminal y terminar sesión" onClick={() => onCloseTerminal(node)}><X size={14} /></button>}
          </header>
          <div className="node-body">
            {node.type === 'terminal' ? <TerminalPanel node={node} workspace={workspace} api={api} connected={!connection || connection.status === 'connected'} active={!inputBlocked && (isFocused || (!focused && selected.length === 1 && selected[0] === node.id))} focusRequested={isFocused} overview={small} onRelaunch={onRelaunch} notify={notify} /> : node.type === 'browser' ? <BrowserPanel node={node} workspace={workspace} api={api} active={isFocused} obscured={obscured || !!rename.editing} onFocus={onFocus} onChange={onChange} /> : node.type === 'note' ? <textarea className="note-editor" aria-label={`Nota: ${node.title}`} value={node.data?.text || ''} placeholder="Escribe el contexto que quieres recuperar…" onChange={e => onChange(node.id, { data: { ...node.data, text: e.target.value } })} spellCheck /> : <ToolPanel node={node} workspace={workspace} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} />}
          </div>
          {!focused && <button className="resize-handle" aria-label="Cambiar tamaño del panel" title="Arrastra para cambiar tamaño" onPointerDown={e => begin(e, 'resize', node)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); onChange(node.id, { width: Math.max(400, node.width + (e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : 0)), height: Math.max(240, node.height + (e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0)) }); } }} />}
        </article>;
      })}</PresenceGroup>
    </div>
    {!focused && <div className="canvas-navigation"><span><MousePointer2 size={13} /> Mapa</span><button title="Alejar" aria-label="Alejar" onClick={() => zoomAt(camera.zoom / 1.2)}><Minus size={15} /></button><button className="zoom-value" title="Restablecer zoom" onClick={() => zoomAt(1)}>{Math.round(camera.zoom * 100)}%</button><button title="Acercar" aria-label="Acercar" onClick={() => zoomAt(camera.zoom * 1.2)}><Plus size={15} /></button><i /><button title="Ajustar todos los paneles (0)" aria-label="Ajustar todos los paneles" onClick={fit}><LocateFixed size={16} /></button></div>}
  </section>;
}
