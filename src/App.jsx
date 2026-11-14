import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bell, Blocks, Braces, ChevronDown, ChevronRight, Command, ExternalLink, Folder, FolderOpen, GitBranch, Globe, Layers, List, LoaderCircle, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Square, StickyNote, TerminalSquare, Trash2, Workflow, X, Check, AlertCircle, Box, FileText, Play, Target, EyeOff, Pencil, RotateCcw } from 'lucide-react';
import Canvas from './components/Canvas';
import { PresenceGroup } from './components/Presence';
import { Inspector } from './components/Inspector';
import { CommandPalette } from './components/CommandPalette';
import { VoiceCapture } from './components/VoiceCapture';
import { api, subscribe, useWorkspace } from './hooks/useWorkspace';
import { findPanelPlacement } from './hooks/panelPlacement';
import { useInlineName } from './hooks/useInlineName';
import { overlayPolicy } from './hooks/inputOwnership';
import { useAppearance } from './hooks/useAppearance';
import { useInterfaceScale } from './hooks/useInterfaceScale';
import { Appearance } from './components/Appearance';
import ActivityNotch, { ActivityTray } from './components/ActivityNotch';
import { useActivity } from './hooks/useActivity';
import { useReadyBranches } from './hooks/useReadyBranches';
import { useSpaces } from './hooks/useSpaces';
import Spaces from './components/Spaces';
import ProjectSwitcher from './components/ProjectSwitcher';
import { Image as ImageIcon, Palette, Maximize2, Frame, GitMerge, LayoutGrid, ListChecks, Server, Film } from 'lucide-react';
import { PhantomGlyph as Ghost } from './components/Glyphs';
import { PANEL_ICONS } from './components/PanelIcons';
import { structuralShare } from './hooks/structuralShare';
import gengarArtwork from '../assets/gengar.png';
import './styles.css';
import './studio.css';
import { PLUGIN_PANELS } from './components/PluginPanels';
import './activity.css';
import './canvas-ui.css';
import './terminal.css';
import './chat.css';
import { preferredCardMode } from './components/ChatCard';
import ToolPicker from './components/ToolPicker';
import SidebarPanels from './components/SidebarPanels';
import './sidebar.css';
import PhantomChat from './components/PhantomChat';
import { DOCK_TABS, dockStatus } from './hooks/phantom-dock.mjs';
import './phantom-chat.css';
import GlobalSites from './components/GlobalSites';

const TYPES = [
  // [type, name, icon, description, launcher group]
  ['terminal', 'Terminal', TerminalSquare, 'Una sesión real en esta carpeta', 'space'], ['browser', 'Navegador', Globe, 'Una página junto al trabajo', 'space'], ['note', 'Nota', StickyNote, 'Contexto que permanece', 'space'],
  ['zone', 'Zona', Frame, 'Área con nombre que agrupa paneles', 'space'], ['mission', 'Misión', Target, 'Agrupa trabajo con un propósito', 'space'],
  ['tasks', 'Tareas', ListChecks, 'Borradores, checklists y Phantom', 'project'], ['context', 'Contexto', FileText, 'Archivos, memorias y skills', 'project'], ['repo', 'Repositorio', GitBranch, 'Grafo, worktrees, cambios, editor e integraciones en una vista', 'project'], ['git', 'Git', GitBranch, 'Cambios, ramas y worktrees', 'project'], ['branches', 'Ramas', GitBranch, 'Todas las ramas y worktrees: guardar, integrar y limpiar', 'project'], ['incorporaciones', 'Incorporaciones', GitMerge, 'Qué se incorpora, en qué orden y qué se planea', 'project'], ['services', 'Servicios', Server, 'Sitios y procesos del proyecto', 'project'], ['docker', 'Docker', Box, 'Contenedores de esta carpeta', 'project'],
  ['review', 'Revisión de video', Film, 'Frames, zonas y comentarios del taller de videos', 'project'],
  ['workflows', 'Workflows', Workflow, 'Secuencias de trabajo reutilizables', 'automation'], ['playwright', 'Playwright', Play, 'Automatización y trazas reales', 'automation'], ['playground', 'Playground', Braces, 'Ejecuta un fragmento explícitamente', 'automation'],
  ['command-center', 'Centro de mando', Activity, 'Plugin Phantom · tareas y controladores reales', 'phantom'],
  ['skills-catalog', 'Skills', PANEL_ICONS['phantom-skills'], 'Todas las Skills: carpeta, Phantom e instalaciones', 'phantom'],
  ['plugins', 'Centro de Plugins', Blocks, 'Activación y preferencias por proyecto', 'phantom'],
  ...PLUGIN_PANELS.map(panel => [panel.nodeType, panel.name, PANEL_ICONS[panel.nodeType] || Layers, panel.pluginId === 'convencions' ? 'Base versionada e integración explícita · lectura MCP pendiente' : panel.pluginId === 'video-log' ? 'Aprendizajes, evidencia y contexto de tu bitácora local' : `Panel nativo de ${panel.pluginId}`, 'plugins']),
].map(([type, name, icon, description, group]) => [type, name, PANEL_ICONS[type] || icon, description, group]);
const QUICK_TYPES = ['terminal', 'browser', 'note', 'zone'].map(id => TYPES.find(t => t[0] === id));
// The creation dock: one weight for every action, the icon names the panel and
// a short word under it says it. Hints are the launcher's own descriptions.
const DOCK_ACTIONS = QUICK_TYPES.map(([type, name, , hint]) => [type, name, hint]);
const initials = name => name?.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || 'P';
const label = type => TYPES.find(t => t[0] === type)?.[1] || (type === 'reference' ? 'Referencia' : type);

// Move within a continuous navigation list without activating another project
// or panel. Tab and Enter keep their native button behavior.
function navigateRailList(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const list = event.target.closest('.project-list,.rail-panels nav');
  if (!list) return;
  const steps = { ArrowDown: 1, ArrowUp: -1, Home: 0, End: 0 };
  if (!(event.key in steps)) return;
  const buttons = [...list.querySelectorAll('button:not(:disabled)')];
  const index = buttons.indexOf(event.target);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + steps[event.key]));
  buttons[next]?.focus({ preventScroll: true });
  buttons[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

class WorkspaceErrorBoundary extends React.Component {
  state = { error: null, retrying: false, retryError: '' };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, details) { console.error('Phantom Workspace: fallo de interfaz', error, details.componentStack); }
  retry = async () => {
    this.setState({ retrying: true, retryError: '' });
    try { await this.props.onRetry(); this.setState({ error: null, retrying: false }); }
    catch (error) { this.setState({ retrying: false, retryError: error.message }); }
  };
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="desktop-required recovery-screen" role="alert"><div className="app-mark"><AlertCircle size={25} /></div><h1>No se pudo mostrar el espacio</h1><p>La conexión y los cambios pendientes se conservan en esta ventana.<br />Reintenta cargar la interfaz para continuar con tu trabajo.</p>{this.state.retryError && <p className="recovery-error">{this.state.retryError}</p>}<button className="button primary" disabled={this.state.retrying} onClick={this.retry}>{this.state.retrying ? <LoaderCircle size={16} className="spinning" /> : <RotateCcw size={16} />} {this.state.retrying ? 'Recuperando…' : 'Reintentar interfaz'}</button><details><summary>Detalles del error</summary><pre>{this.state.error.message || String(this.state.error)}</pre></details></div>;
  }
}

export default function App() {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, kind = 'info') => {
    const id = crypto.randomUUID(); setToasts(t => [...t.slice(-3), { id, message, kind }]);
    setTimeout(() => setToasts(t => t.filter(t => t.id !== id)), 6500);
  }, []);
  // Keep the model and durable queue above the boundary. Retrying the UI never
  // discards local edits or restarts a PTY, even if a panel threw during render.
  const model = useWorkspace(notify);
  return <WorkspaceErrorBoundary onRetry={model.refresh}><WorkspaceUI model={model} toasts={toasts} setToasts={setToasts} notify={notify} /></WorkspaceErrorBoundary>;
}

function WorkspaceUI({ model, toasts, setToasts, notify }) {
  const { state, error, saveError, connection, saving, refresh, patch, flush, registerBeforeFlush, closeRequest, retryClose } = model;
  const [focused, setFocused] = useState(null);
  const [selected, setSelected] = useState([]);
  const [inspector, setInspector] = useState(null);
  const [palette, setPalette] = useState(false);
  const [sitesOpen, setSitesOpen] = useState(false);
  const [voice, setVoice] = useState(false);
  const [tray, setTray] = useState(false);
  const [tools, setTools] = useState(false);
  const [list, setList] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [railCollapsed, setRailCollapsed] = useState(() => { try { return localStorage.getItem('phantom.rail') === 'collapsed'; } catch { return false; } });
  const toggleRail = () => setRailCollapsed(v => { try { localStorage.setItem('phantom.rail', v ? 'open' : 'collapsed'); } catch { /* per-viewer preference only */ } return !v; });
  const [railOwnsFocus, setRailOwnsFocus] = useState(false);
  // Phantom's chat stays docked until closed; the choice is per viewer.
  const [phantomChat, setPhantomChat] = useState(() => { try { return localStorage.getItem('phantom.chat') === 'open'; } catch { return false; } });
  const [chatOwnsFocus, setChatOwnsFocus] = useState(false);
  const [chatFocus, setChatFocus] = useState(0);
  const [dockTab, setDockTab] = useState(() => { try { const saved = localStorage.getItem('phantom.dock.tab'); return DOCK_TABS.includes(saved) ? saved : 'chat'; } catch { return 'chat'; } });
  const chooseDockTab = useCallback(tab => { setDockTab(tab); try { localStorage.setItem('phantom.dock.tab', tab); } catch { /* per-viewer preference only */ } }, []);
  const openPhantomChat = useCallback((value = true, tab) => {
    setPhantomChat(value); if (value) setChatFocus(n => n + 1); else setChatOwnsFocus(false);
    if (value && tab) chooseDockTab(tab);
    try { localStorage.setItem('phantom.chat', value ? 'open' : 'closed'); } catch { /* per-viewer preference only */ }
  }, [chooseDockTab]);
  // A dictation turned into a task opens the voice capture with that text.
  const [voiceText, setVoiceText] = useState('');
  const [compactRail, setCompactRail] = useState(() => window.matchMedia('(max-width: 850px)').matches);
  const [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState('');
  const [fitRequest, setFitRequest] = useState(0);
  const [jumpRequest, setJumpRequest] = useState(null);
  const [query, setQuery] = useState('');
  const [edit, setEdit] = useState(null);
  const [renameRequest, setRenameRequest] = useState(null);
  const projectNameButton = useRef(null);
  const railRef = useRef(null);
  const projectRename = useInlineName({ stage: (id, name) => patch(id, null, { name }), flush, registerBeforeFlush });
  const workspace = state?.workspaces?.find(w => w.id === state.activeWorkspaceId);
  useEffect(() => { setContextMenu(null); }, [workspace?.id, railCollapsed, sidebar]);
  useReadyBranches(api, workspace, connection, notify);
  const activity = useActivity(workspace, connection, model.stateReadAt);
  const activityButton = useRef(null);
  const terminalActivityRef = useRef({});
  // Keep per-terminal identities stable so memoized canvas nodes skip renders.
  const terminalActivity = useMemo(() => terminalActivityRef.current = structuralShare(terminalActivityRef.current, Object.fromEntries(activity.sessions.filter(s => s.nodeId).map(s => [s.nodeId, s]))), [activity.sessions]);
  const toggleActivity = filter => { setSidebar(false); setTray(value => value === filter ? false : filter); setTools(false); setList(false); setMenu(null); };
  useEffect(() => { setTray(false); }, [workspace?.id]);
  const { appearance, update: updateAppearance, reset: resetAppearance } = useAppearance(workspace?.id, notify);
  const interfaceScale = useInterfaceScale();
  const current = useRef(workspace); current.current = workspace;
  const selectionRef = useRef(selected); selectionRef.current = selected;
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const returnSelection = useRef([]);
  const operation = useCallback(async fn => { try { return await fn(); } catch (e) { notify(e.message, 'error'); return null; } }, [notify]);
  const onChange = useCallback((id, change) => { if (current.current) patch(current.current.id, id, change); }, [patch]);
  const onCamera = useCallback((camera, workspaceId) => { if (workspaceId || current.current) patch(workspaceId || current.current.id, null, { camera }); }, [patch]);
  const spaces = useSpaces({ workspace, patch, onChange });
  const spacesRef = useRef(spaces); spacesRef.current = spaces;
  const [closingIds, setClosingIds] = useState(() => new Set());
  const view = useMemo(() => closingIds.size && spaces.view?.nodes ? { ...spaces.view, nodes: spaces.view.nodes.filter(n => !closingIds.has(n.id)) } : spaces.view, [spaces.view, closingIds]);
  const focusPanel = useCallback(id => {
    if (id) spacesRef.current.reveal(id);
    const node = current.current?.nodes?.find(n => n.id === id);
    if (node?.data?.hidden) onChange(id, { data: { ...node.data, hidden: false } });
    if (id && !focusedRef.current) returnSelection.current = [...selectionRef.current];
    if (!id && focusedRef.current) setSelected(returnSelection.current.filter(id => current.current?.nodes?.some(n => n.id === id && !n.data?.hidden)));
    setFocused(id || null); if (id) setSelected([id]);
  }, [onChange]);
  const openMenu = useCallback((id, x, y) => { if (id && !selectionRef.current.includes(id)) setSelected([id]); setMenu({ id, x, y }); }, []);
  const launching = useRef(new Map());
  const placements = useRef(new Map());
  const launchTerminal = useCallback(async node => {
    const w = current.current; if (!w) return null;
    const key = `${w.id}:${node.id}`;
    if (launching.current.has(key)) return launching.current.get(key);
    const promise = (async () => {
      const result = await api('terminal.create', { workspaceId: w.id, nodeId: node.id, cols: 80, rows: 24 });
      if (!result?.session?.id) throw new Error('El host no devolvió una sesión de terminal.');
      return result.node;
    })();
    launching.current.set(key, promise);
    try { return await promise; } finally { launching.current.delete(key); }
  }, []);
  const onOpenPanel = useCallback(async (type, data = {}, title) => {
    const w = current.current; if (!w) { notify('Abre una carpeta para crear un panel.'); return null; }
    if (!TYPES.some(t => t[0] === type)) { notify(`Tipo de panel desconocido: ${type}`, 'error'); return null; }
    setTools(false); setMenu(null); setList(false); setTray(false); setInspector(null);
    const panel = PLUGIN_PANELS.find(item => item.nodeType === type);
    if (panel) data = { ...data, pluginId: panel.pluginId, panelId: panel.id };
    const existing = w.nodes?.find(n => data.focusNodeId ? n.id === data.focusNodeId : n.type === type && (type === 'plugins' || type === 'command-center' || type === 'incorporaciones' || type === 'branches' || type === 'repo' || type === 'skills-catalog' || panel && (data.cardId ? n.data?.cardId === data.cardId : data.ref ? JSON.stringify(n.data?.ref) === JSON.stringify(data.ref) : !n.data?.cardId && !n.data?.ref) || type === 'tasks' && data.cardId && n.data?.cardId === data.cardId));
    if (existing) { focusPanel(existing.id); return existing; }
    setBusy(type);
    let reservationId, created = false;
    try {
      const region = document.querySelector('.canvas')?.getBoundingClientRect();
      const camera = spacesRef.current.view?.camera || w.camera || { x: 64, y: 64, zoom: 1 };
      const width = panel?.pluginId === 'convencions' ? 880 : type === 'browser' ? 800 : type === 'note' ? 420 : type === 'zone' ? 720 : type === 'skills-catalog' ? 920 : type === 'branches' ? 820 : type === 'repo' ? 1320 : 640;
      const height = panel?.pluginId === 'convencions' ? 640 : type === 'terminal' ? 640 : type === 'browser' ? 520 : type === 'note' ? 340 : type === 'zone' ? 440 : type === 'skills-catalog' || type === 'branches' ? 600 : type === 'repo' ? 800 : 400;
      // Reserve before the RPC so rapid/concurrent creations cannot reuse the
      // same slot while state.get or PTY creation is still in flight.
      for (const [key, item] of placements.current) if (item.workspaceId === w.id && w.nodes?.some(n => n.id === item.nodeId)) placements.current.delete(key);
      const reserved = [...placements.current.values()].filter(item => item.workspaceId === w.id);
      const position = findPanelPlacement({ nodes: [...spacesRef.current.view.nodes.filter(n => type === 'zone' || n.type !== 'zone'), ...reserved], width, height, camera, viewport: { width: region?.width || 1000, height: region?.height || 700 } });
      reservationId = crypto.randomUUID();
      placements.current.set(reservationId, { workspaceId: w.id, ...position, width, height });
      let node = await api('node.create', { workspaceId: w.id, type, title: title || label(type), width, height, ...position, data: spacesRef.current.withSpace(type === 'terminal' ? { ...(Object.keys(data).length ? {} : { chat: { provider: preferredCardMode() } }), ...data, launchState: 'creating' } : type === 'zone' ? { color: 'iris', ...data } : data) });
      created = true; placements.current.get(reservationId).nodeId = node.id;
      if (type === 'terminal' && !data.sessionId) { await refresh(); node = await launchTerminal(node); }
      await refresh();
      if (current.current?.id === w.id) {
        if (type === 'terminal') {
          focusPanel(null);
          setSelected([node.id]);
          setJumpRequest({ id: node.id, nonce: crypto.randomUUID() });
        } else focusPanel(node.id);
      }
      return node;
    } catch (e) { notify(`No se pudo crear ${label(type).toLowerCase()}: ${e.message}`, 'error'); await refresh().catch(() => {}); return null; }
    finally { if (!created && reservationId) placements.current.delete(reservationId); setBusy(''); }
  }, [notify, refresh, launchTerminal, focusPanel]);
  useEffect(() => subscribe(event => {
    if (event.type === 'desktop.notification' && event.target === 'branches') { onOpenPanel('branches'); return; }
    if (event.type !== 'browser.agentFocus' || event.workspaceId !== current.current?.id) return;
    // The desktop repeats this request until the real native view is attached;
    // refresh may still be delivering the newly created node on the first event.
    if (!current.current.nodes?.some(node => node.id === event.id && node.type === 'browser')) { refresh().catch(() => {}); return; }
    setPalette(false); setVoice(false); setTray(false); setTools(false); setList(false); setMenu(null); setInspector(null); setSidebar(false);
    focusPanel(event.id);
  }), [focusPanel, refresh, onOpenPanel]);
  const relaunch = useCallback(node => operation(async () => { setBusy(node.id); try { await launchTerminal(node); await refresh(); } finally { setBusy(''); } }), [operation, launchTerminal, refresh]);
  const openFolder = useCallback(() => operation(async () => {
    setBusy('folder');
    try {
      await flush();
      const path = await api('dialog.openFolder'); if (!path) return;
      await api('workspace.open', { path }); await refresh();
      setFocused(null); setSelected([]); setSidebar(false); setInspector(null);
    } finally { setBusy(''); }
  }), [operation, refresh, flush]);
  const selectWorkspace = id => operation(async () => {
    if (id === workspace?.id) return;
    await flush(); await api('workspace.select', { id });
    setFocused(null); setSelected([]); setInspector(null); setMenu(null); setList(false); setSidebar(false); await refresh();
  });
  // A zone drawn around the selection, with room for its label.
  const zoneFromSelection = () => operation(async () => {
    const w = current.current, picked = (spaces.view?.nodes || []).filter(n => selected.includes(n.id) && n.type !== 'zone');
    if (!w || !picked.length) { notify('Selecciona paneles para agruparlos en una zona.'); return; }
    const pad = 40, left = Math.min(...picked.map(n => n.x)) - pad, top = Math.min(...picked.map(n => n.y)) - pad - 24;
    const right = Math.max(...picked.map(n => n.x + n.width)) + pad, bottom = Math.max(...picked.map(n => n.y + n.height)) + pad;
    const zone = await api('node.create', { workspaceId: w.id, type: 'zone', title: 'Zona', x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top), data: spaces.withSpace({ color: 'iris' }) });
    await refresh(); setMenu(null); setSelected([zone.id]); setRenameRequest({ id: zone.id, nonce: crypto.randomUUID() });
  });
  // The file picker's way into the board; pasting and dropping live in the canvas.
  const addReferenceFile = () => operation(async () => {
    const w = current.current, at = menu; setMenu(null); if (!w) return;
    const file = await api('dialog.openFile'); if (!file) return;
    const region = document.querySelector('.canvas')?.getBoundingClientRect(), camera = spacesRef.current.view?.camera || w.camera || { x: 0, y: 0, zoom: 1 };
    const x = ((at?.x ?? (region?.left || 0) + (region?.width || 1000) / 2) - (region?.left || 0) - camera.x) / camera.zoom, y = ((at?.y ?? (region?.top || 0) + (region?.height || 700) / 2) - (region?.top || 0) - camera.y) / camera.zoom;
    const node = await api('reference.add', { workspaceId: w.id, path: file, center: true, x, y, ...(spaces.active ? { spaceId: spaces.active } : {}) });
    await refresh(); setSelected([node.id]);
  });
  const groupSelection = () => {
    if (!selected.length) { notify('Selecciona paneles con Mayús + clic en sus cabeceras.'); return; }
    setEdit({ kind: 'mission', title: 'Agrupar en una misión', value: '', ids: [...selected] }); setMenu(null);
  };
  const saveEdit = e => {
    e.preventDefault(); if (!edit?.value.trim()) return;
    operation(async () => {
      const w = current.current;
      const mission = await api('mission.create', { workspaceId: w.id, title: edit.value.trim(), notes: '', nextAction: '', refs: [] });
      await Promise.all(edit.ids.map(id => api('node.update', { workspaceId: w.id, id, patch: { groupId: mission.id } })));
      await refresh(); setEdit(null);
    });
  };
  const reveal = useCallback(id => {
    const node = current.current?.nodes?.find(n => n.id === id);
    if (node?.data?.hidden) onChange(id, { data: { ...node.data, hidden: false } });
  }, [onChange]);
  const jump = id => { spaces.reveal(id); reveal(id); setFocused(null); setSelected([id]); setJumpRequest({ id, nonce: Date.now() }); setList(false); setSidebar(false); };
  const commandAction = useCallback((action, data) => {
    setPalette(false);
    const key = typeof action === 'string' ? action : action?.action || action?.type || action?.id;
    if (key === 'sites') { setSitesOpen(true); setInspector(null); return; }
    if (key === 'open-folder' || key === 'openFolder' || key === 'workspace.open') return openFolder();
    if (key === 'fit' || key === 'fit-all') { setFocused(null); setFitRequest(n => n + 1); return; }
    if (key === 'voice') { setVoiceText(''); setVoice(true); return; }
    if (key === 'phantom-chat') { openPhantomChat(true); return; }
    if (key === 'settings') { setInspector('settings'); return; }
    if (key === 'appearance') { setInspector('appearance'); return; }
    if (key === 'tool') { setInspector(action.tab); return; }
    if (key === 'panel') { focusPanel(action.id); return; }
    if (key === 'create') return onOpenPanel(action.panelType, action.data || {});
    if (key === 'search' || key === 'panels') { setList(true); return; }
    if (key === 'focus' || key === 'jump') { const id = action.nodeId || action.id || data?.id; if (id) focusPanel(id); return; }
    if (key === 'inspector') { setInspector(action.tab || data?.tab || 'tasks'); return; }
    const type = key?.replace(/^(create:|new:|panel:|create-|new-)/, '');
    if (TYPES.some(t => t[0] === type)) return onOpenPanel(type, action?.data || data || {});
    notify('Esta acción no está disponible en el proyecto actual.');
  }, [openFolder, onOpenPanel, notify, focusPanel, openPhantomChat]);
  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(v => !v); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setList(v => !v); return; }
      // Ctrl ⇧ Space: open Phantom and type; from inside the chat, close it.
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') { e.preventDefault(); if (phantomChat && e.target.closest?.('.phantom-chat')) openPhantomChat(false); else openPhantomChat(true); return; }
      if (e.key === 'Escape') {
        if (edit) { e.preventDefault(); setEdit(null); }
        else if (palette) setPalette(false);
        else if (voice) setVoice(false);
        else if (menu) setMenu(null);
        else if (tools) setTools(false);
        else if (tray) setTray(false);
        else if (list) setList(false);
        else if (inspector && !e.target.closest('.xterm')) setInspector(null);
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [palette, voice, menu, tools, tray, list, inspector, edit, phantomChat, openPhantomChat]);
  useEffect(() => { if (workspace && focused && !workspace.nodes?.some(n => n.id === focused)) setFocused(null); }, [workspace, focused]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 850px)');
    const resize = () => { setCompactRail(media.matches); setSidebar(false); };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (!sidebar) return;
    const previous = document.activeElement;
    // PresenceGroup commits the new inert state in a follow-up render. Wait
    // until that commit before moving focus into (or back out of) the drawer.
    const openingFrame = requestAnimationFrame(() => railRef.current?.querySelector('.rail-close')?.focus({ preventScroll: true }));
    const handleKey = e => {
      if (!window.matchMedia('(max-width: 850px)').matches) return;
      if (e.key === 'Escape') {
        if (e.target.closest('.context-switcher') && (e.target.closest('.project-switcher[open]') || e.target.closest('.rail-spaces')?.querySelector('[aria-expanded="true"]'))) return;
        e.preventDefault(); e.stopPropagation(); setSidebar(false);
      }
      if (e.key !== 'Tab') return;
      const controls = [...railRef.current.querySelectorAll('button:not(:disabled),summary,input:not(:disabled)')].filter(el => el.getClientRects().length && (!el.closest('details:not([open])') || el.tagName === 'SUMMARY'));
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      cancelAnimationFrame(openingFrame);
      document.removeEventListener('keydown', handleKey, true);
      requestAnimationFrame(() => {
        if (previous?.isConnected && (document.activeElement === document.body || railRef.current?.contains(document.activeElement))) previous.focus({ preventScroll: true });
      });
    };
  }, [sidebar]);
  useEffect(() => {
    if (!edit) return;
    const previous = document.activeElement;
    const trap = e => {
      if (e.key !== 'Tab') return;
      const controls = [...(document.querySelector('.app-dialog')?.querySelectorAll('button:not(:disabled),input') || [])];
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, [edit?.kind]);
  const chatOpen = phantomChat && !!workspace;
  const phantomStatus = useMemo(() => dockStatus(workspace), [workspace?.nodes, workspace?.integration]);
  const togglePhantom = useCallback(() => openPhantomChat(!chatOpen), [openPhantomChat, chatOpen]);
  const phantomLauncher = useMemo(() => ({ open: chatOpen, status: phantomStatus, onToggle: togglePhantom }), [chatOpen, phantomStatus, togglePhantom]);
  const { inputBlocked: overlayInputBlocked, browserObscured } = overlayPolicy({ inspector, palette, voice, tray, list, menu, tools, edit, sidebar, phantomDrawer: chatOpen && compactRail, folder: busy === 'folder', closing: closeRequest?.status === 'saving', disconnected: connection.status !== 'connected' });
  // Selecting a terminal from navigation must not let its activation effect
  // steal focus before Tab can reach the row's secondary action. Clicking back
  // into the working region releases this ownership through the rail's blur.
  const inputBlocked = overlayInputBlocked || railOwnsFocus || (chatOpen && chatOwnsFocus);
  const connectionLabel = ({ connected: 'Host local conectado', connecting: 'Conectando con el host…', reconnecting: 'Reconectando con el host…', disconnected: 'Host desconectado', error: 'Error de conexión' })[connection.status] || 'Conexión no disponible';
  const saveLabel = saving ? 'Guardando' : saveError ? 'Sin guardar' : connection.status !== 'connected' ? 'Sin conexión' : error ? 'Revisar estado' : 'Guardado';
  const menuNode = workspace?.nodes?.find(n => n.id === menu?.id);
  const filteredNodes = (workspace?.nodes || []).filter(n => `${n.title} ${label(n.type)} ${n.data?.agent?.cardTitle || ''} ${n.data?.agent?.step || ''} ${workspace?.missions?.find(m => m.id === n.groupId)?.title || ''}`.toLowerCase().includes(query.toLowerCase()));
  const attention = (workspace?.attention || []).filter(a => !a.acknowledgedAt && !a.acknowledged && !a.acked);
  const closeTransient = () => { setTools(false); setTray(false); setList(false); setMenu(null); };
  const removeView = async node => {
    if (node.type === 'terminal') {
      onChange(node.id, { data: { ...node.data, hidden: true } });
      await flush();
    } else await api('node.remove', { workspaceId: workspace.id, id: node.id });
    setMenu(null); setSelected(s => s.filter(id => id !== node.id));
    if (focused === node.id) setFocused(null);
    await refresh();
    notify(node.type === 'terminal' ? 'Vista ocultada. Recupérala desde la lista de paneles o Sesiones.' : 'Panel eliminado.');
  };
  // The card leaves the canvas at once; the host ends the session behind it.
  // If closing fails, the card comes back and the error says why.
  const closeTerminal = async node => {
    const workspaceId = current.current?.id;
    setClosingIds(ids => new Set(ids).add(node.id));
    setMenu(null); setSelected(s => s.filter(id => id !== node.id));
    if (focusedRef.current === node.id) setFocused(null);
    try {
      await flush();
      await api('terminal.close', { workspaceId, nodeId: node.id });
      await refresh();
      notify('Terminal cerrada y sesión terminada.');
    } finally {
      setClosingIds(ids => { const next = new Set(ids); next.delete(node.id); return next; });
    }
  };
  const closeTerminalRef = useRef(closeTerminal); closeTerminalRef.current = closeTerminal;
  const onCloseTerminal = useCallback(node => operation(() => closeTerminalRef.current(node)), [operation]);

  if (!window.phantom?.invoke) return <div className="desktop-required"><div className="app-mark"><Blocks size={23} /></div><h1>Abre la aplicación de escritorio</h1><p>Phantom Workspace necesita su host local para abrir carpetas,<br />recuperar terminales y navegar dentro del proyecto.</p><div className="desktop-required-note"><TerminalSquare size={16} /> Esta vista web no está conectada al escritorio.</div></div>;
  if (!state) return <div className="desktop-required"><div className="app-mark"><Blocks size={23} /></div>{error ? <><h1>No pudimos conectar con el host</h1><p>{error}</p><button className="button primary" onClick={() => refresh().catch(() => {})}>Reintentar conexión</button></> : <><LoaderCircle className="spinning" size={23} /><h1>Recuperando tu espacio…</h1><p>Conectando con el host local.</p></>}</div>;
  return <div className={`app-shell studio-${appearance.background} ${appearance.image ? 'studio-personal' : ''} ${appearance.gengar ? 'studio-character' : ''} ${appearance.pulse ? 'studio-pulse' : ''} ${appearance.concentration ? 'studio-concentration' : ''} ${focused ? 'studio-focused' : ''} ${inspector ? 'studio-inspector-open' : ''} ${appearance.grid ? '' : 'studio-no-grid'} ${railCollapsed ? 'rail-collapsed' : ''} ${chatOpen ? 'phantom-chat-open' : ''}`} style={{ '--gengar-art': `url("${gengarArtwork}")`, '--gengar-intensity': appearance.gengarIntensity / 100, '--background-intensity': appearance.intensity / 100, '--personal-background': appearance.image ? `url("${appearance.image}")` : 'none' }}>
    <PresenceGroup>
    {sidebar && <button key="rail-scrim" className="rail-scrim" aria-label="Cerrar proyectos" onClick={() => setSidebar(false)} />}
    <aside key="project-rail" id="project-rail" ref={railRef} aria-label="Navegación del espacio" role={compactRail && sidebar ? 'dialog' : undefined} aria-modal={compactRail && sidebar ? true : undefined} inert={compactRail && !sidebar} onKeyDown={navigateRailList} onFocusCapture={() => setRailOwnsFocus(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setRailOwnsFocus(false); }} className={`project-rail ${sidebar ? 'rail-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Ghost size={17} /></span><span>Phantom<span>Workspace</span></span><button className="rail-collapse icon-button" aria-label={railCollapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'} title={railCollapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'} aria-expanded={!railCollapsed} onClick={toggleRail}>{railCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button><button className="rail-close icon-button" aria-label="Cerrar proyectos" onClick={() => setSidebar(false)}><X size={17} /></button></div>{railCollapsed && workspace && <button className="rail-collapsed-project" onClick={toggleRail} title={workspace.path}><span className="project-initials">{initials(workspace.name)}</span><span>{workspace.name}{spaces.activeSpace && <em> / {spaces.activeSpace.name}</em>}</span></button>}
      <ProjectSwitcher projects={state.workspaces} active={workspace} open={contextMenu === 'project'} onOpenChange={value => setContextMenu(value ? 'project' : null)} onSelect={id => { setSidebar(false); selectWorkspace(id); }} onOpenFolder={openFolder} busy={busy === 'folder'} />
      {workspace && <Spaces key={workspace.id} spaces={spaces.spaces} active={spaces.active} nodes={workspace.nodes || []} open={contextMenu === 'space'} onOpenChange={value => setContextMenu(value ? 'space' : null)} onSelect={id => { setFocused(null); setSelected([]); spaces.select(id); }} onCreate={spaces.create} onRename={spaces.rename} onRemove={spaces.remove} />}
      {workspace && <button className={`rail-attention ${activity.needs.length ? 'needs-you' : ''}`} aria-expanded={tray} aria-controls="activity-tray" onClick={() => { setSidebar(false); setTray(v => !v); setTools(false); setList(false); setMenu(null); }}><Bell size={15} /><span>{activity.needs.length ? 'Necesitan de ti' : 'Actividad del proyecto'}</span>{activity.needs.length > 0 ? <b>{activity.needs.length}</b> : <ChevronRight size={13} />}</button>}
      {workspace && <SidebarPanels nodes={view.nodes} types={TYPES} selected={selected} focused={focused} sessions={terminalActivity} onJump={id => { setSitesOpen(false); jump(id); }} onFocus={id => { setSitesOpen(false); setSidebar(false); focusPanel(id); }} onSearch={() => { setSitesOpen(false); setSidebar(false); setList(v => !v); }} onMap={() => { setSitesOpen(false); setSidebar(false); focusPanel(null); setFitRequest(n => n + 1); }} />}
      <div className="rail-bottom">
        <button aria-pressed={sitesOpen} onClick={() => { setSidebar(false); setSitesOpen(v => !v); setInspector(null); }}><Globe size={15} /> Sitios</button>
        {workspace && <button onClick={() => { setSidebar(false); onOpenPanel('plugins'); }}><Blocks size={15} /> Centro de Plugins</button>}
        <button onClick={() => { setSidebar(false); setPalette(true); }}><Command size={15} /> Comandos <kbd>Ctrl K</kbd></button>
        <div className="rail-system"><span className={`host-indicator ${connection.status}`} title={connection.message || connectionLabel} role="status"><i />{connectionLabel}</span><button className={`icon-button ${inspector === 'appearance' ? 'active' : ''}`} title="Personalizar espacio" aria-label="Personalizar espacio" onClick={() => { setSidebar(false); setInspector(inspector === 'appearance' ? null : 'appearance'); }}><Palette size={15} /></button><button className={`icon-button ${inspector === 'settings' ? 'active' : ''}`} title="Configuración" aria-label="Configuración" onClick={() => { setSidebar(false); setInspector(inspector === 'settings' ? null : 'settings'); }}><Settings2 size={15} /></button></div>
      </div>
    </aside>
    <main key="main-workspace" className="main-workspace" inert={compactRail && sidebar}>
      <header className="workspace-header"><button className="icon-button rail-toggle" title="Ver proyectos" aria-label="Ver proyectos" aria-expanded={sidebar} aria-controls="project-rail" onClick={() => setSidebar(true)}><PanelLeftOpen size={18} /></button>
        <div className="workspace-identity"><div className="breadcrumb"><Folder size={15} /><span>Proyectos</span><ChevronRight size={13} /><div className="project-name-editor">{projectRename.editing ? <><input ref={projectRename.inputRef} className="inline-name-input" aria-label="Nombre del proyecto" aria-invalid={!!projectRename.editing.error} aria-describedby={projectRename.editing.error ? 'project-name-error' : undefined} value={projectRename.editing.value} readOnly={projectRename.editing.saving} onChange={e => projectRename.change(e.target.value)} onBlur={() => projectRename.commit(false)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); projectRename.commit(true); } if (e.key === 'Escape') { e.preventDefault(); projectRename.cancel(); } }} />{projectRename.editing.error && <span className="inline-name-error" id="project-name-error" role="alert">{projectRename.editing.error}</span>}</> : <button ref={projectNameButton} disabled={!workspace} title="Renombrar proyecto · no mueve la carpeta" onClick={() => workspace && projectRename.start(workspace.id, workspace.name, () => projectNameButton.current)}>{workspace?.name || 'Tu espacio'}{workspace && <Pencil size={11} />}</button>}</div></div><div className="workspace-path" title={workspace ? `Carpeta elegida: ${workspace.path}\nRuta canónica: ${workspace.canonicalPath || workspace.path}\nEl nombre visible no mueve la carpeta.` : ''}>{workspace ? workspace.canonicalPath || workspace.path : 'Abre una carpeta para comenzar'}{workspace && workspace.path !== workspace.canonicalPath && workspace.canonicalPath && <span className="path-badge">Ruta canónica</span>}</div></div>
        <div className="header-controls"><span className={`save-state ${error || connection.status !== 'connected' ? 'has-error' : ''}`} title={error || (saving ? 'Guardando cambios de disposición' : connectionLabel)}>{saving ? <LoaderCircle size={12} className="spinning" /> : error || connection.status !== 'connected' ? <AlertCircle size={12} /> : <Check size={12} />}{saveLabel}</span><button className="search-command" onClick={() => setPalette(true)}><Search size={15} /><span>Buscar o ejecutar</span><kbd>Ctrl K</kbd></button><button className={`icon-button phantom-chat-toggle ${chatOpen ? 'active' : ''}`} data-tone={phantomStatus.tone} title={`Phantom: chat y orquestador (Ctrl ⇧ Espacio) · ${phantomStatus.label}`} aria-label={chatOpen ? 'Cerrar Phantom' : 'Abrir Phantom'} aria-pressed={chatOpen} disabled={!workspace} onClick={togglePhantom}><Ghost size={17} /></button><button className={`icon-button attention-button ${tray ? 'active' : ''}`} title="Bandeja de actividad" aria-label={`Abrir bandeja de actividad, ${activity.unread} avisos sin leer`} aria-expanded={tray} aria-controls="activity-tray" disabled={!workspace} onClick={() => { setTray(v => !v); setTools(false); setList(false); setMenu(null); }}><Bell size={17} />{(activity.unread > 0 || activity.needs.length > 0) && <i />}</button><button className={`icon-button ${inspector ? 'active' : ''}`} title="Herramientas del proyecto" aria-label="Herramientas del proyecto" disabled={!workspace} onClick={() => setInspector(inspector ? null : 'context')}><PanelLeftClose size={18} /></button></div>
      </header>
      {error && <div className="connection-error" role="status"><AlertCircle size={14} /><span>{error}</span><button onClick={() => operation(async () => { await flush(); await refresh(); })}>Reintentar</button></div>}
      {closeRequest?.status === 'failed' && <div className="connection-error" role="alert"><AlertCircle size={14} /><span>No se cerró la ventana: {closeRequest.error}. Puedes reintentar o descartar explícitamente desde el diálogo del escritorio.</span><button onClick={retryClose}>Guardar y cerrar</button></div>}
      <div className="workspace-body"><PresenceGroup>
        <div key="canvas-region" className="canvas-region"><PresenceGroup>
          {workspace ? <Canvas key={`${workspace.id}:${spaces.active || 'main'}`} workspace={view} terminalActivity={terminalActivity} connection={connection} api={api} refresh={refresh} flush={flush} registerBeforeFlush={registerBeforeFlush} notify={notify} onOpenPanel={onOpenPanel} onChange={onChange} onCamera={spaces.onCamera} focused={focused} onFocus={focusPanel} selected={selected} onSelect={setSelected} inputBlocked={inputBlocked || sitesOpen} obscured={sitesOpen || browserObscured || !!projectRename.editing} spaceId={spaces.active} renameRequest={renameRequest} onMenu={openMenu} onRelaunch={relaunch} onCloseTerminal={onCloseTerminal} fitRequest={fitRequest} jumpRequest={jumpRequest} phantomLauncher={phantomLauncher} /> : <section className="canvas welcome-canvas"><EmptyState className="canvas-empty" size="hero" icon={FolderOpen} heading="h1" title="Un espacio para cada proyecto" description="Elige una carpeta de tu equipo. Terminales, páginas y contexto quedan vinculados a ella, listos para volver." actions={<button className="button primary" onClick={openFolder} disabled={busy === 'folder'}>{busy === 'folder' ? <LoaderCircle size={16} className="spinning" /> : <FolderOpen size={16} />} Abrir carpeta</button>} hint="El trabajo vive en tu equipo · No se crean archivos en la carpeta" /></section>}
          {sitesOpen && <GlobalSites key="global-sites" api={api} onClose={() => setSitesOpen(false)} />}
          {!!busy && busy !== 'folder' && <div key="canvas-busy" className="canvas-busy" role="status"><LoaderCircle size={14} className="spinning" />Preparando {TYPES.some(t => t[0] === busy) ? label(busy).toLowerCase() : 'sesión'}…</div>}
          {workspace && <div key="create-dock" className={`create-dock activity-dock ${tray ? 'activity-open' : ''}`}>
            <ActivityNotch activity={activity} open={tray} buttonRef={activityButton} onToggle={toggleActivity} />
            <div className="dock-main" role="toolbar" aria-label="Crear panel">{DOCK_ACTIONS.map(([type, name, hint]) => { const Icon = PANEL_ICONS[type], around = type === 'zone' && selected.length > 1; return <button key={type} className="dock-action" data-type={type} disabled={!!busy} title={around ? 'Crear zona alrededor de la selección' : hint} onClick={() => around ? zoneFromSelection() : onOpenPanel(type)}><Icon size={18} aria-hidden="true" /><span>{name}</span></button>; })}<i aria-hidden="true" /><button className={`dock-action dock-more ${tools ? 'active' : ''}`} title="Tareas, Git, servicios, Docker y más" onClick={() => { setTools(v => !v); setTray(false); }} aria-expanded={tools} aria-haspopup="dialog"><LayoutGrid size={18} aria-hidden="true" /><span>Herramientas</span></button></div>
          </div>}
          {workspace && !focused && <button key="panel-index-button" className={`panel-index-button ${list ? 'active' : ''}`} title="Buscar paneles (Ctrl Mayús F)" onClick={() => { setList(v => !v); setTools(false); }}><List size={15} /><span>{workspace.nodes?.length || 0} paneles</span>{selected.length > 1 && <b>{selected.length} seleccionados</b>}</button>}
          {selected.length > 1 && !focused && <button key="zone-selection" className="zone-selection button" onClick={zoneFromSelection}><Frame size={15} /> Crear zona</button>}
          {selected.length > 1 && !focused && <button key="group-selection" className="group-selection button" onClick={groupSelection}><Target size={15} /> Agrupar en misión</button>}
          {tools && <><button className="popover-dismiss" aria-label="Cerrar herramientas" onClick={() => setTools(false)} /><ToolPicker types={TYPES} disabled={!!busy} onPick={onOpenPanel} onClose={() => setTools(false)} /></>}
          {list && <div className="panel-index"><div className="popover-heading"><strong>Paneles del proyecto</strong><button className="icon-button" aria-label="Cerrar lista" onClick={() => setList(false)}><X size={15} /></button></div><label className="index-search"><Search size={15} /><input autoFocus aria-label="Buscar panel por nombre, tipo o misión" placeholder="Buscar nombre, tipo o misión…" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="panel-index-items">{filteredNodes.map(n => <div className="index-item" key={n.id}><button onClick={() => jump(n.id)}><span className="index-type">{label(n.type)}{n.data?.hidden ? ' · Vista oculta · clic para recuperar' : ''}</span><strong>{n.title}</strong>{n.groupId && <small>{workspace.missions?.find(m => m.id === n.groupId)?.title}</small>}</button><button className="icon-button" title="Enfocar" aria-label={`Enfocar ${n.title}`} onClick={() => { focusPanel(n.id); setList(false); }}><ExternalLink size={14} /></button></div>)}{!filteredNodes.length && <EmptyState className="small-empty" size="compact" description={query ? 'No hay paneles con ese nombre, tipo o misión.' : 'Aún no hay paneles. Crea uno desde la barra inferior.'} />}</div><div className="index-footer"><button onClick={() => { setFocused(null); setFitRequest(n => n + 1); setList(false); }}>Ver todo el mapa</button><kbd>Ctrl ⇧ F</kbd></div></div>}
        </PresenceGroup></div>
        {inspector && <div key="inspector-host" className="inspector-host"><div className="inspector-switcher"><select aria-label="Herramienta contextual" value={inspector} onChange={e => setInspector(e.target.value)}>{TYPES.filter(t => !['terminal', 'browser', 'note', 'mission', 'zone'].includes(t[0])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}<option value="sessions">Sesiones</option><option value="settings">Configuración</option><option value="appearance">Apariencia</option></select><button className="icon-button" aria-label="Cerrar inspector" onClick={() => setInspector(null)}><X size={16} /></button></div>{inspector === 'appearance' ? <Appearance key={workspace?.id || 'default'} appearance={appearance} update={updateAppearance} reset={resetAppearance} workspace={workspace} interfaceScale={interfaceScale} /> : <Inspector tab={inspector} workspace={workspace} state={state} api={api} refresh={refresh} onClose={() => setInspector(null)} onOpenPanel={onOpenPanel} notify={notify} />}</div>}
      </PresenceGroup></div>
    </main>
    {chatOpen && <PhantomChat key={`phantom-chat:${workspace.id}`} workspace={workspace} api={api} notify={notify} connected={connection.status === 'connected'} focusRequest={chatFocus} onFocusOwnership={setChatOwnsFocus} onClose={() => openPhantomChat(false)} tab={dockTab} onTab={chooseDockTab} status={phantomStatus} onOpenPanel={onOpenPanel} onTask={text => { closeTransient(); setVoiceText(text); setVoice(true); }} />}
    {tray && workspace && <ActivityTray key={workspace.id} activity={activity} workspace={workspace} api={api} notify={notify} filter={typeof tray === 'string' ? tray : 'needs'} onFilter={setTray} onClose={() => setTray(false)} onTerminal={id => { focusPanel(id); requestAnimationFrame(() => document.querySelector('.canvas-node.focused .xterm-helper-textarea')?.focus()); }} onCard={id => onOpenPanel('phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId: id }, 'Card')} onPanel={(type, data) => onOpenPanel(type, data)} onInspector={tab => { setInspector(tab); requestAnimationFrame(() => document.querySelector('.inspector-switcher select')?.focus()); }} onRead={async id => { await api('attention.ack', { workspaceId: workspace.id, id }); await refresh(); }} />}
    {menu && <><button className="popover-dismiss top-dismiss" aria-label="Cerrar opciones" onClick={() => setMenu(null)} /><div className="context-menu" role="menu" style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 252)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 330)) }}>{menuNode ? <><div className="context-title">{menuNode.title}</div><button role="menuitem" onClick={() => { focusPanel(menuNode.id); setMenu(null); }}><ExternalLink size={15} /> Enfocar panel</button><button role="menuitem" onClick={() => { setRenameRequest({ id: menuNode.id, nonce: crypto.randomUUID() }); setMenu(null); }}><Pencil size={15} /> Renombrar</button><button role="menuitem" onClick={groupSelection}><Target size={15} /> Agrupar selección en misión</button>{selected.length > 1 && <button role="menuitem" onClick={zoneFromSelection}><Frame size={15} /> Crear zona con la selección</button>}{[{ id: null, name: 'Principal' }, ...spaces.spaces].filter(sp => sp.id !== spaces.active).map(sp => <button key={sp.id || 'main'} role="menuitem" onClick={() => { const ids = selected.includes(menuNode.id) ? selected : [menuNode.id]; spaces.moveNodes(ids, sp.id); setSelected([]); setMenu(null); notify(`${ids.length === 1 ? 'Panel movido' : `${ids.length} paneles movidos`} a ${sp.name}.`); }}><Layers size={15} /> Mover a {sp.name}</button>)}{menuNode.groupId && <button role="menuitem" onClick={() => { onChange(menuNode.id, { groupId: null }); setMenu(null); }}><Layers size={15} /> Quitar de la misión</button>}<hr /><button role="menuitem" onClick={() => operation(() => removeView(menuNode))}>{menuNode.type === 'terminal' ? <EyeOff size={15} /> : <Trash2 size={15} />}{menuNode.type === 'terminal' ? 'Ocultar vista · conservar sesión' : 'Eliminar panel'}</button>{menuNode.type === 'terminal' && menuNode.data?.sessionId && <button className="danger" role="menuitem" onClick={() => operation(async () => { await api('terminal.stop', { sessionId: menuNode.data.sessionId }); setMenu(null); await refresh(); notify('Proceso terminado. El historial se conserva.'); })}><Square size={14} /> Terminar proceso</button>}</> : <>{QUICK_TYPES.map(([type, name, Icon]) => <button key={type} role="menuitem" onClick={() => onOpenPanel(type)}><Icon size={15} /> Crear {name.toLowerCase()}</button>)}<button role="menuitem" onClick={addReferenceFile}><ImageIcon size={15} /> Añadir imagen o video…</button><hr /><button onClick={() => { setTools(true); setMenu(null); }}> <Plus size={15} /> Todas las herramientas</button><button onClick={() => { setFitRequest(n => n + 1); setMenu(null); }}>Ajustar mapa</button></>}</div></>}
    <CommandPalette key="command-palette" open={palette} onClose={() => setPalette(false)} workspace={workspace} onAction={commandAction} />
    {closeRequest?.status === 'saving' && <div className="app-modal-backdrop close-progress"><div className="app-dialog close-status" role="status" aria-live="polite"><LoaderCircle size={21} className="spinning" /><h2>Guardando antes de cerrar…</h2><p>Esperando a que se guarden todos los cambios pendientes.</p></div></div>}
    <VoiceCapture key="voice-capture" open={voice} initialText={voiceText} workspace={workspace} api={api} refresh={refresh} notify={notify} onClose={() => setVoice(false)} />
    {edit && <div className="app-modal-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setEdit(null); }}><form className="app-dialog" onSubmit={saveEdit} role="dialog" aria-modal="true" aria-label={edit.title}><div className="popover-heading"><h2>{edit.title}</h2><button type="button" className="icon-button" aria-label="Cancelar" onClick={() => setEdit(null)}><X size={17} /></button></div><label>Nombre<input autoFocus value={edit.value} onChange={e => setEdit({ ...edit, value: e.target.value })} placeholder="¿Qué quieres conseguir?" /></label><div className="dialog-actions"><button type="button" className="button" onClick={() => setEdit(null)}>Cancelar</button><button className="button primary" disabled={!edit.value.trim()}>Crear misión</button></div></form></div>}
    <div key="toast-stack" className="toast-stack" aria-live="polite"><PresenceGroup>{toasts.map(t => <div className={`toast ${t.kind}`} key={t.id}>{t.kind === 'error' ? <AlertCircle size={17} /> : <Check size={17} />}<span>{t.message}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setToasts(v => v.filter(item => item.id !== t.id))}><X size={14} /></button></div>)}</PresenceGroup></div>
    </PresenceGroup>
  </div>;
}
import EmptyState from './components/EmptyState.jsx';
