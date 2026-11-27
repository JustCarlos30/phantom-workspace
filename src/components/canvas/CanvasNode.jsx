import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bell, Maximize2, MoreHorizontal, X } from 'lucide-react';
import { LayersIcon as Layers } from '../ShellIcons.jsx';
import ActivityTrace from '../ActivityTrace.jsx';
import TerminalPanelContent from '../TerminalPanel';
import TerminalCardContent from '../TerminalCard';
import ChatCardContent from '../ChatCard';
import BrowserPanelContent from '../BrowserPanel';
import { ToolPanel as ToolPanelContent } from '../ToolPanels';
import { TerminalActivityStatus } from '../ActivityNotch';
import { PANEL_ICONS } from '../PanelIcons';
import { pulseState } from '../../hooks/terminalBorderState.mjs';
import { useSessionAlerts } from '../../hooks/useSessionAlerts';
import { useChat } from '../../hooks/useChat';
import ReferencePanelContent from '../References';

const icons = { ...PANEL_ICONS, 'skills-catalog': PANEL_ICONS['phantom-skills'] };
const TerminalPanel = React.memo(function CanvasTerminal({ node, onFocus, ...props }) {
  return <TerminalPanelContent {...props} node={node} onEnlarge={() => onFocus(node.id)} />;
});
// Map shows Phantom's own card; the xterm engine mounts only in focus.
const TerminalCard = React.memo(function CanvasTerminalCard({ node, onFocus, ...props }) {
  return <TerminalCardContent {...props} node={node} onOpen={() => onFocus(node.id)} />;
});
// A card whose agent is chosen talks as a chat, on the map and in focus alike.
const ChatCard = React.memo(ChatCardContent);
const BrowserPanel = React.memo(BrowserPanelContent);
const ToolPanel = React.memo(ToolPanelContent);
const ReferencePanel = React.memo(function ReviewReference(props) {
  const review = React.useContext(ReviewContext);
  return <ReferencePanelContent {...props} {...review} />;
});
export const ReviewContext = React.createContext(null);
const NO_ACTIVITY = {};

export function ChatAlertWatcher({ node, workspaceId, api, connected, notify }) {
  const { chat } = useChat({ workspaceId, nodeId: node.id, provider: node.data.chat.provider, api, connected });
  const nodes = useMemo(() => [node], [node]);
  useSessionAlerts(nodes, NO_ACTIVITY, connected, notify, chat);
  return null;
}

// One panel on the map. Memoized: camera movement, other panels' edits and
// selection changes elsewhere must not re-render this panel or its terminal.
const CanvasNode = React.memo(function CanvasNode({ node, preview, changesActive, focusSize, anyFocused, selected, flash, onFlashEnd, small, compact, magnified, missionTitle, activity, chatPulse, editing, anyEditing, workspace, handlers, api, refresh, flush, notify, onOpenPanel, onChange, onRelaunch, connected, active, keyboardMode, inputBlocked, obscured, comments, commenting, commentCount }) {
  const panel = useRef(null);
  const [entering, setEntering] = useState(true);
  useEffect(() => { const timer = setTimeout(() => setEntering(false), 400); return () => clearTimeout(timer); }, []);
  useLayoutEffect(() => {
    if (!flash) return;
    panel.current.classList.remove('map-flash');
    void panel.current.offsetWidth;
    panel.current.classList.add('map-flash');
    const animation = panel.current.getAnimations({ subtree: true }).find(animation => animation.animationName === 'map-flash');
    let cancelled = false;
    const finish = () => { if (!cancelled) onFlashEnd(current => current === flash ? null : current); };
    if (animation) animation.finished.then(finish, finish);
    else finish();
    return () => { cancelled = true; };
  }, [flash, onFlashEnd]);
  const Icon = icons[node.type] || Layers, isFocused = !!focusSize;
  const geometry = isFocused ? { x: 12, y: 72, width: Math.max(320, focusSize.width - 24), height: Math.max(240, focusSize.height - 88) } : preview ? { ...node, ...preview } : node;
  const titleRef = useCallback(element => handlers.titleButton(node.id, element), [handlers, node.id]);
  const enlarge = useCallback(() => handlers.focus(node.id), [handlers, node.id]);
  const pulse = pulseState(node, activity, chatPulse?.pulse);
  const state = node.data?.chat?.provider ? chatPulse?.state || 'rest' : ({ 'pulse-attention': 'attention', 'pulse-turn': 'attention', 'pulse-working': 'working', 'pulse-success': 'finished', 'pulse-error': 'error' }[pulse] || 'rest');
  return <article ref={panel} data-node-id={node.id} data-type={node.type} data-panel-state={state} aria-current={selected || undefined} data-role={node.data?.role || undefined} className={`canvas-node ${selected ? 'selected' : ''} ${flash ? 'map-flash' : ''} ${entering ? 'is-entering' : ''} ${isFocused ? 'focused' : ''} ${small ? 'overview' : ''} ${compact ? 'compact' : ''} ${preview ? 'is-dragging' : ''} ${pulse}`} style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height, display: anyFocused && !isFocused ? 'none' : undefined }} onPointerDownCapture={e => handlers.press(e, node.id)} onClick={e => handlers.click(e, node.id)} onContextMenu={e => { if (e.target.closest('.changes-canvas-world,.changes-canvas-expanded')) return; e.preventDefault(); e.stopPropagation(); handlers.menu(node.id, e.clientX, e.clientY); }}>
    {state === 'working' && <ActivityTrace state="pulse-working" />}
    <header className="node-header" onPointerDown={e => { if (!e.target.closest('button,input') && !anyFocused) handlers.begin(e, 'move', node); }} onDoubleClick={e => { if (!e.target.closest('button,input')) handlers.focus(isFocused ? null : node.id); }}>
      <span className="node-glyph" data-type={node.type} aria-hidden="true"><Icon size={14} /></span><div className="node-title">{editing ? <><input ref={handlers.renameInput} className="inline-name-input" aria-label="Nombre del panel" aria-invalid={!!editing.error} aria-describedby={editing.error ? `name-error-${node.id}` : undefined} value={editing.value} readOnly={editing.saving} onChange={e => handlers.renameChange(e.target.value)} onPointerDown={e => e.stopPropagation()} onBlur={() => handlers.renameCommit(false)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); handlers.renameCommit(true); } if (e.key === 'Escape') { e.preventDefault(); handlers.renameCancel(); } }} />{editing.error && <span className="inline-name-error" id={`name-error-${node.id}`} role="alert">{editing.error}</span>}</> : <button ref={titleRef} className="title-button" title="Renombrar panel" onClick={() => handlers.renameStart(node)}>{node.title}</button>}{node.data?.role === 'orchestrator' && !editing && <span className="node-role" title="Sesión orquestadora: ordena e incorpora el trabajo de las terminales">Orquestador</span>}</div>
      {node.groupId && <span className="mission-chip" title={missionTitle}>{missionTitle || 'Misión'}</span>}
      <TerminalActivityStatus session={activity} panelState={state} />
      {node.type === 'terminal' && <button type="button" className="icon-button session-watch" aria-label="Vigilar sesión" aria-pressed={!!node.data?.watchAlerts} title={node.data?.watchAlerts ? 'Desactivar avisos de esta sesión' : 'Activar avisos de esta sesión'} onClick={() => { handlers.watchAudio(node); onChange(node.id, { data: { ...node.data, watchAlerts: !node.data?.watchAlerts } }); }}><Bell size={14} aria-hidden="true" /></button>}
      <button className="icon-button" aria-label={isFocused ? 'Volver al mapa' : 'Enfocar panel'} title={isFocused ? 'Volver al mapa' : 'Enfocar panel'} onClick={() => handlers.focus(isFocused ? null : node.id)}>{isFocused ? <ArrowLeft size={14} /> : <Maximize2 size={14} />}</button>
      <button className="icon-button" aria-label="Opciones del panel" title="Opciones del panel" onClick={e => handlers.menu(node.id, e.clientX, e.clientY)}><MoreHorizontal size={16} /></button>
      {node.type === 'terminal' && <button className="icon-button" aria-label="Cerrar terminal" title="Cerrar terminal y terminar sesión" data-panel-close onPointerDown={e => e.preventDefault()} onClick={() => handlers.closeTerminal(node)}><X size={14} /></button>}
    </header>
    <div className="node-body">
      {node.type === 'terminal' && node.data?.chat?.provider ? <ChatCard node={node} workspace={workspace} api={api} notify={notify} overview={small && !changesActive} focused={isFocused} connected={connected} seen={selected || isFocused} onPulse={handlers.chatPulse} /> : node.type === 'terminal' ? <>
        {(!isFocused || changesActive) && <TerminalCard node={node} workspace={workspace} api={api} notify={notify} reviewOnly={isFocused} onFocus={handlers.focus} onRelaunch={onRelaunch} overview={small && !changesActive} connected={connected} enabled={!anyFocused} />}
        {isFocused && <TerminalPanel node={node} workspace={workspace} api={api} refresh={refresh} flush={flush} onOpenPanel={onOpenPanel} onEnlarge={enlarge} onFocus={handlers.focus} connected={connected} active={active && keyboardMode === 'interaction'} inputBlocked={inputBlocked || keyboardMode !== 'interaction'} focusRequested={isFocused} overview={small} compact={compact} magnified={magnified} onRelaunch={onRelaunch} onChange={onChange} notify={notify} />}
      </> : node.type === 'browser' ? <BrowserPanel node={node} workspace={workspace} api={api} active={isFocused && keyboardMode === 'interaction'} obscured={obscured || anyEditing || keyboardMode !== 'interaction'} commenting={commenting} commentCount={commentCount} onComment={handlers.toggleComment} onFocus={handlers.focus} onChange={onChange} /> : node.type === 'reference' ? <ReferencePanel node={node} workspace={workspace} comments={comments} onChange={onChange} onOpenPanel={onOpenPanel} onOpenComment={handlers.openComment} /> : node.type === 'note' ? <textarea className="note-editor" aria-label={`Nota: ${node.title}`} value={node.data?.text || ''} placeholder="Escribe el contexto que quieres recuperar…" onChange={e => onChange(node.id, { data: { ...node.data, text: e.target.value } })} spellCheck /> : <ToolPanel node={node} workspace={workspace} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} />}
    </div>
    {!anyFocused && <button className="resize-handle" aria-label="Cambiar tamaño del panel" title="Arrastra para cambiar tamaño" onPointerDown={e => handlers.begin(e, 'resize', node)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); onChange(node.id, { width: Math.max(400, node.width + (e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : 0)), height: Math.max(240, node.height + (e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0)) }); } }} />}
  </article>;
});

export default CanvasNode;
