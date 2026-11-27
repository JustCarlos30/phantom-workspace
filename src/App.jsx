import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bell, Blocks, Braces, ChevronDown, ChevronRight, Command, ExternalLink, Folder, FolderOpen, GitBranch, Globe, Layers, List, LoaderCircle, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Square, StickyNote, TerminalSquare, Trash2, Workflow, X, Check, AlertCircle, Box, FileText, Play, Target, EyeOff, Pencil, RotateCcw } from 'lucide-react';
import Canvas from './components/Canvas';
import AsciiField from './components/AsciiField.jsx';
import { PresenceGroup } from './components/Presence';
import { Inspector } from './components/Inspector';
import { CommandPalette } from './components/CommandPalette';
import ProjectPicker from './components/ProjectPicker.jsx';
import ShortcutSettings from './components/ShortcutSettings.jsx';
import { useWorkspaceShortcuts } from './hooks/useWorkspaceShortcuts';
import { formatBinding } from './hooks/workspace-commands.mjs';
import { directionalNeighbor, cycleSession } from './hooks/panel-navigation.mjs';
import { nextAttentionId } from './hooks/attention-navigation.mjs';
import { buildSessionRows, groupPanelIndex, projectStatus } from './hooks/sidebarModel.mjs';
import { VoiceCapture } from './components/VoiceCapture';
import { VoiceProvider, VoiceLauncher, useVoiceWorkspace } from './components/VoiceProvider';
import { cancelVoiceRecording } from './hooks/useVoiceRecorder';
import { api, subscribe, useWorkspace } from './hooks/useWorkspace';
import { findPanelPlacement } from './hooks/panelPlacement';
import { useInlineName } from './hooks/useInlineName';
import { overlayPolicy, dispatchWorkspaceKey, isEditingTarget } from './hooks/inputOwnership';
import { useAppearance } from './hooks/useAppearance';
import { useInterfaceScale } from './hooks/useInterfaceScale';
import { useFitDensity } from './hooks/useFitDensity';
import ActivityNotch, { ActivityTray } from './components/ActivityNotch';
import { useActivity } from './hooks/useActivity';
import { useReadyBranches } from './hooks/useReadyBranches';
import { createNavigation, useDesktopAlerts } from './hooks/useDesktopAlerts';
import OrchestratorHub, { OrchestratorHubButton, OrchestratorRailEntry } from './components/OrchestratorHub';
import { useOrchestratorInbox } from './hooks/useOrchestratorInbox';
import { useSpaces } from './hooks/useSpaces';
import Spaces from './components/Spaces';
import ProjectSwitcher, { ProjectMark } from './components/ProjectSwitcher';
import { Image as ImageIcon, Maximize2, Frame, GitMerge, LayoutGrid, ListChecks, Server, Film, MoreHorizontal } from 'lucide-react';
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
const MOD = IS_MAC ? '⌘' : 'Ctrl';
import { PhantomGlyph as Ghost } from './components/Glyphs';
import { ActivityIcon, PluginsIcon, CommandsIcon, SiteIcon } from './components/ShellIcons.jsx';
import { PANEL_ICONS } from './components/PanelIcons';
import { structuralShare } from './hooks/structuralShare';
import TitiMascot from './components/GengarMascot.jsx';
import './styles.css';
import './studio.css';
import { PLUGIN_PANELS } from './components/PluginPanels';
import './activity.css';
import './canvas-ui.css';
import './terminal.css';
import './chat.css';
import { preferredCardMode } from './components/ChatCard';
import ToolPicker from './components/ToolPicker';
import { localStorageOrNull, updateUsage, recordOpen } from './hooks/tool-usage.mjs';
import { HUBS, HUB_DOCK, HUB_MORE, resolveHub } from './hooks/hubs.mjs';
import SidebarPanels from './components/SidebarPanels';
import './sidebar.css';
import './limits.css';
import RailUsage from './components/RailUsage.jsx';
import './shell.css';
import PhantomChat from './components/PhantomChat';
import { DOCK_TABS, dockStatus } from './hooks/phantom-dock.mjs';
import { AgentOpenContext, useAgentOpener } from './hooks/useAgentTraces';
import './phantom-chat.css';
import './panels.css';
import './menus.css';
import GlobalSites from './components/GlobalSites';

const TYPES = [
  // [type, name, icon, description, launcher group]
  ['terminal', 'Terminal', TerminalSquare, 'Una sesión con un agente o una terminal', 'space'], ['browser', 'Navegador', Globe, 'Una página web dentro del proyecto', 'space'], ['note', 'Nota', StickyNote, 'Texto libre que se queda en el mapa', 'space'],
  ['zone', 'Zona', Frame, 'Un área con nombre para agrupar paneles', 'space'], ['mission', 'Misión', Target, 'Agrupa trabajo con un propósito', 'space'],
  ['tasks', 'Trabajo', ListChecks, HUBS.tasks.hint, 'project'], ['context', 'Contexto', FileText, HUBS.context.hint, 'project'], ['repo', 'Git', GitBranch, HUBS.repo.hint, 'project'], ['git', 'Git', GitBranch, 'Cambios, ramas y worktrees', 'project'], ['branches', 'Ramas', GitBranch, 'Todas las ramas y worktrees: guardar, integrar y limpiar', 'project'], ['incorporaciones', 'Incorporaciones', GitMerge, 'Qué se incorpora, en qué orden y qué se planea', 'project'], ['services', HUBS.services.name, Server, HUBS.services.hint, 'project'], ['docker', 'Docker', Box, 'Contenedores de esta carpeta', 'project'],
  ['review', 'Revisión de video', Film, 'Comenta cuadros de tus renders', 'project'],
  ['workflows', 'Automatizar', Workflow, HUBS.workflows.hint, 'project'], ['playwright', 'Playwright', Play, 'Automatización y trazas reales', 'automation'], ['playground', 'Playground', Braces, 'Ejecuta un fragmento explícitamente', 'automation'],
  ['command-center', 'Centro de mando', Activity, 'Plugin Phantom · tareas y controladores reales', 'phantom'],
  ['skills-catalog', 'Skills', PANEL_ICONS['phantom-skills'], 'Todas las Skills: carpeta, Phantom e instalaciones', 'phantom'],
  ['plugins', 'Configuración', Blocks, 'Ajustes del proyecto y de la app', 'phantom'],
  ...PLUGIN_PANELS.map(panel => [panel.nodeType, panel.name, PANEL_ICONS[panel.nodeType] || Layers, panel.pluginId === 'convencions' ? 'Convenciones del proyecto' : panel.pluginId === 'video-log' ? 'Lo aprendido en tus videos' : panel.name, 'plugins']),
].map(([type, name, icon, description, group]) => [type, name, PANEL_ICONS[type] || icon, description, group]);
const QUICK_TYPES = ['terminal', 'browser', 'note', 'zone'].map(id => TYPES.find(t => t[0] === id));
// What the launchers offer: things you place on the map and the five hubs.
// Everything a hub hosts as a tab stays a valid node type (saved canvases keep
// rendering) but is no longer offered on its own.
const LAUNCH_TYPES = TYPES.filter(([type]) => ['terminal', 'browser', 'note', 'zone', 'review', 'video-log'].includes(type) || HUBS[type]);
const HUB_ACTIONS = HUB_DOCK.map(id => TYPES.find(t => t[0] === id));
// The creation dock: one weight for every action, the icon names the panel and
// a short word under it says it. Hints are the launcher's own descriptions.
const DOCK_ACTIONS = QUICK_TYPES.map(([type, name, , hint]) => [type, name, hint]);
const DOCK_FIT = ['full', 'compact', 'tight'];
const label = type => TYPES.find(t => t[0] === type)?.[1] || (type === 'reference' ? 'Referencia' : type);

// Move within a continuous navigation list without activating another project
// or panel. Tab and Enter keep their native button behavior.
function navigateRailList(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const projects = event.target.closest('.project-list');
  const rail = !projects && event.target.closest('.rail-attention,.rail-panels nav') && event.currentTarget;
  if (!projects && !rail) return;
  const steps = { ArrowDown: 1, ArrowUp: -1, Home: 0, End: 0 };
  if (!(event.key in steps)) return;
  // The attention row heads the rail list, so arrows walk it with the sessions.
  const buttons = [...(projects || rail).querySelectorAll(projects ? 'button:not(:disabled)' : '.rail-attention:not(:disabled), .rail-panels nav button:not(:disabled)')];
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
  return <VoiceProvider workspaceId={model.state?.activeWorkspaceId} api={api} connected={model.connection.status === 'connected'}><WorkspaceErrorBoundary onRetry={model.refresh}><WorkspaceUI model={model} toasts={toasts} setToasts={setToasts} notify={notify} /></WorkspaceErrorBoundary></VoiceProvider>;
}

function WorkspaceUI({ model, toasts, setToasts, notify }) {
  const dockFit = useFitDensity(DOCK_FIT);
  const dictation = useVoiceWorkspace();
  const { state, error, saveError, connection, saving, refresh, patch, flush, registerBeforeFlush, closeRequest, retryClose } = model;
  const [focused, setFocused] = useState(null);
  const [selected, setSelected] = useState([]);
  const [keyboardMode, setKeyboardMode] = useState('navigation');
  const [canvasFocusRequest, setCanvasFocusRequest] = useState(0);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { bindings, setBinding, resetBindings, conflicts } = useWorkspaceShortcuts();
  const navigationMemory = useRef(new Map());
  const lastWorkFocus = useRef(new Map());
  const previousNavigation = useRef(null);
  const [inspector, setInspector] = useState(null);
  const settingsOpen = ['settings', 'appearance', 'plugins'].includes(inspector);
  const [palette, setPalette] = useState(false);
  const [sitesOpen, setSitesOpen] = useState(false);
  const [voice, setVoice] = useState(false);
  const [tray, setTray] = useState(false);
  const [tools, setTools] = useState(false);
  const [dockMore, setDockMore] = useState(false);
  const dockMoreButton = useRef(null);
  const dockMoreMenu = useRef(null);
  useEffect(() => {
    if (!dockMore) return;
    const outside = event => {
      if (!dockMoreButton.current?.contains(event.target) && !dockMoreMenu.current?.contains(event.target)) setDockMore(false);
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setDockMore(false);
      dockMoreButton.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [dockMore]);
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
  const activeWorkspaceId = state?.activeWorkspaceId;
  const chooseDockTab = useCallback(tab => { setDockTab(tab); try { localStorage.setItem('phantom.dock.tab', tab); } catch { /* per-viewer preference only */ } }, []);
  const openPhantomChat = useCallback((value = true, tab) => {
    if (!value) cancelVoiceRecording(`phantom:${activeWorkspaceId}:`);
    setPhantomChat(value); if (value) setChatFocus(n => n + 1); else setChatOwnsFocus(false);
    if (value && tab) chooseDockTab(tab);
    try { localStorage.setItem('phantom.chat', value ? 'open' : 'closed'); } catch { /* per-viewer preference only */ }
  }, [chooseDockTab, activeWorkspaceId]);
  // A sub-agent clicked in any canvas card opens its detail in the dock's Orquestador tab. The request names the
  // workspace, the card (node) and the agent explicitly; one for another project than the active one is dropped.
  // ChatCard reaches this through AgentOpenContext (Canvas and CanvasNode pass no such prop).
  const openOrchestrator = useCallback(() => openPhantomChat(true, 'orchestrator'), [openPhantomChat]);
  // The global Orquestador section lives here, outside PhantomChat and its per-workspace key, so switching
  // project neither remounts it nor loses its draft or reading.
  const [hubOpen, setHubOpen] = useState(false);
  const toggleHub = useCallback((value) => setHubOpen(open => typeof value === 'boolean' ? value : !open), []);
  const { agentRequest, openAgent, consumeAgentRequest } = useAgentOpener(activeWorkspaceId, openOrchestrator);
  // A dictation turned into a task opens the voice capture with that text.
  const [voiceText, setVoiceText] = useState('');
  const [compactRail, setCompactRail] = useState(() => window.matchMedia('(max-width: 850px)').matches);
  const closeSites = useCallback(() => {
    const restore = !!document.activeElement?.closest('.global-sites');
    setSitesOpen(false);
    if (restore) requestAnimationFrame(() => {
      const target = document.querySelector(compactRail ? '.rail-toggle' : '.rail-bottom button[aria-pressed]');
      target?.focus({ preventScroll: true });
    });
  }, [compactRail]);
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
  useLayoutEffect(() => {
    const previous = previousNavigation.current;
    if (previous?.id !== workspace?.id) {
      if (previous?.id) navigationMemory.current.set(previous.id, previous);
      const saved = navigationMemory.current.get(workspace?.id);
      const exists = id => workspace?.nodes?.some(n => n.id === id && !n.data?.hidden && !n.hidden);
      const nextFocused = exists(saved?.focused) ? saved.focused : null;
      const nextSelected = (saved?.selected || []).filter(exists);
      const mode = nextFocused ? saved.keyboardMode : 'navigation';
      setFocused(nextFocused); setSelected(nextSelected); setKeyboardMode(mode);
      setJumpRequest(null);
      previousNavigation.current = { id: workspace?.id, focused: nextFocused, selected: nextSelected, keyboardMode: mode };
      return;
    }
    previousNavigation.current = { id: workspace?.id, focused, selected, keyboardMode };
  }, [workspace?.id, focused, selected, keyboardMode]);
  useEffect(() => { setContextMenu(null); }, [workspace?.id, railCollapsed, sidebar]);
  useEffect(() => { setVoice(false); setVoiceText(''); }, [workspace?.id]);
  useReadyBranches(api, workspace, connection, notify);
  useDesktopAlerts(subscribe, state, notify);
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
  // Cross-project navigation (hub rows, desktop notification clicks): switch project first, then run the target there.
  const navTargets = useRef({});
  const navigation = useMemo(() => createNavigation({ getActiveId: () => current.current?.id, select: id => navTargets.current.select(id), run: nav => navTargets.current.run(nav) }), []);
  const onKeyboardMode = useCallback((mode, id) => {
    setKeyboardMode(mode);
    if (mode === 'interaction' && id && current.current) {
      lastWorkFocus.current.set(current.current.id, id);
      setSelected(ids => ids.length === 1 && ids[0] === id ? ids : [id]);
    }
  }, []);
  const workspaceState = useRef(state); workspaceState.current = state;
  const selectionRef = useRef(selected); selectionRef.current = selected;
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const returnSelection = useRef(new Map());
  const focusOrigin = useRef(null), focusAnimation = useRef(null), returnFocus = useRef(null);
  const [focusMoving, setFocusMoving] = useState(false);
  const operation = useCallback(async fn => { try { return await fn(); } catch (e) { notify(e.message, 'error'); return null; } }, [notify]);
  const onChange = useCallback((id, change) => { if (current.current) patch(current.current.id, id, change); }, [patch]);
  const onCamera = useCallback((camera, workspaceId, spaceId) => {
    const w = workspaceState.current?.workspaces?.find(w => w.id === workspaceId);
    if (!w) return;
    if (spaceId) patch(w.id, null, { spaces: (w.spaces || []).map(space => space.id === spaceId ? { ...space, camera } : space) });
    else patch(w.id, null, { camera });
  }, [patch]);
  const spaces = useSpaces({ workspace, patch, onChange });
  const spacesRef = useRef(spaces); spacesRef.current = spaces;
  const [closingIds, setClosingIds] = useState(() => new Set());
  const view = useMemo(() => closingIds.size && spaces.view?.nodes ? { ...spaces.view, nodes: spaces.view.nodes.filter(n => !closingIds.has(n.id)) } : spaces.view, [spaces.view, closingIds]);
  const focusPanel = useCallback(id => {
    if (id && current.current) lastWorkFocus.current.set(current.current.id, id);
    setKeyboardMode(id ? 'interaction' : 'navigation');
    setCanvasFocusRequest(n => n + 1);
    const target = id || focusedRef.current;
    if (target && id !== focusedRef.current) {
      const element = document.querySelector(`.canvas-node[data-node-id="${CSS.escape(target)}"]`);
      const rect = element?.getBoundingClientRect();
      focusOrigin.current = rect?.width && rect?.height ? { id: target, rect } : null;
      focusAnimation.current?.cancel();
      if (id && !focusedRef.current) returnFocus.current = document.activeElement;
      setFocusMoving(!!focusOrigin.current);
    }
    if (id) spacesRef.current.reveal(id);
    const node = current.current?.nodes?.find(n => n.id === id);
    if (node?.data?.hidden) onChange(id, { data: { ...node.data, hidden: false } });
    if (id && !focusedRef.current) returnSelection.current.set(current.current.id, [...selectionRef.current]);
    if (!id && focusedRef.current) setSelected((returnSelection.current.get(current.current?.id) || [focusedRef.current]).filter(id => current.current?.nodes?.some(n => n.id === id && !n.data?.hidden && !n.hidden)));
    setFocused(id || null); if (id) setSelected([id]);
  }, [onChange]);
  useLayoutEffect(() => {
    const origin = focusOrigin.current;
    if (!origin) { setFocusMoving(false); return; }
    focusOrigin.current = null;
    let animation, observer;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => { observer?.disconnect(); motion.removeEventListener('change', finish); animation?.cancel(); setFocusMoving(false); };
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector(`.canvas-node[data-node-id="${CSS.escape(origin.id)}"]`);
      if (!element) { finish(); return; }
      const destination = element.getBoundingClientRect();
      if (!focused) {
        const previous = returnFocus.current;
        (previous?.isConnected && !previous.closest('[inert]') ? previous : element.querySelector('[aria-label="Enfocar panel"]'))?.focus({ preventScroll: true });
      }
      if (motion.matches || !destination.width || !destination.height) { finish(); return; }
      const css = getComputedStyle(element), scale = destination.width / element.offsetWidth;
      const duration = css.getPropertyValue('--dur-open').trim();
      animation = element.animate([
        { transform: `translate(${(origin.rect.x - destination.x) / scale}px, ${(origin.rect.y - destination.y) / scale}px) scale(${origin.rect.width / destination.width}, ${origin.rect.height / destination.height})` },
        { transform: 'none' },
      ], { duration: parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000), easing: css.getPropertyValue('--ease-settle').trim(), id: 'focus-flip' });
      focusAnimation.current = animation;
      motion.addEventListener('change', finish);
      animation.finished.then(finish, () => {});
      observer = new ResizeObserver(() => {
        if (element.offsetWidth !== width || element.offsetHeight !== height) finish();
      });
      const width = element.offsetWidth, height = element.offsetHeight;
      observer.observe(element);
    });
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); motion.removeEventListener('change', finish); animation?.cancel(); };
  }, [focused]);
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
  const onOpenPanel = useCallback(async (type, data = {}, title, meta) => {
    const w = current.current; if (!w) { notify('Abre una carpeta para crear un panel.'); return null; }
    if (!TYPES.some(t => t[0] === type)) { notify(`Tipo de panel desconocido: ${type}`, 'error'); return null; }
    const requestedType = type;
    const recordUse = () => { try { updateUsage(localStorageOrNull(), w.id, usage => recordOpen(usage, requestedType, { fromFrequent: meta?.source === 'frequent' })); } catch {} };
    const hub = resolveHub(type, data);
    if (hub.tab) { data = { ...data, hubTab: hub.tab }; window.dispatchEvent(new CustomEvent('phantom:hub-tab', { detail: hub })); }
    type = hub.type;
    setTools(false); setMenu(null); setList(false); setTray(false); setInspector(null);
    const panel = PLUGIN_PANELS.find(item => item.nodeType === type);
    if (panel) data = { ...data, pluginId: panel.pluginId, panelId: panel.id };
    const existing = w.nodes?.find(n => data.focusNodeId ? n.id === data.focusNodeId : n.type === type && (HUBS[type] && !data.cardId || type === 'plugins' || type === 'command-center' || type === 'incorporaciones' || type === 'branches' || type === 'repo' || type === 'skills-catalog' || panel && (data.cardId ? n.data?.cardId === data.cardId : data.ref ? JSON.stringify(n.data?.ref) === JSON.stringify(data.ref) : !n.data?.cardId && !n.data?.ref) || type === 'tasks' && data.cardId && n.data?.cardId === data.cardId));
    if (existing) { focusPanel(existing.id); recordUse(); return existing; }
    setBusy(type);
    let reservationId, created = false;
    try {
      const region = document.querySelector('.canvas-stage')?.getBoundingClientRect();
      const camera = spacesRef.current.view?.camera || w.camera || { x: 64, y: 64, zoom: 1 };
      const width = panel?.pluginId === 'convencions' ? 880 : type === 'browser' ? 800 : type === 'note' ? 420 : type === 'zone' ? 720 : type === 'skills-catalog' ? 920 : type === 'branches' ? 820 : type === 'repo' ? 1320 : type === 'terminal' ? 960 : HUBS[type] ? 920 : 640;
      const height = panel?.pluginId === 'convencions' ? 640 : type === 'terminal' ? 720 : type === 'browser' ? 520 : type === 'note' ? 340 : type === 'zone' ? 440 : type === 'skills-catalog' || type === 'branches' ? 600 : type === 'repo' ? 800 : HUBS[type] ? 640 : 400;
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
      recordUse();
      return node;
    } catch (e) { notify(`No se pudo crear ${label(type).toLowerCase()}: ${e.message}`, 'error'); await refresh().catch(() => {}); return null; }
    finally { if (!created && reservationId) placements.current.delete(reservationId); setBusy(''); }
  }, [notify, refresh, launchTerminal, focusPanel]);
  useEffect(() => subscribe(event => {
    if (event.type === 'desktop.notification') {
      if (event.target === 'branches') navigation.go({ workspaceId: event.workspaceId, panel: ['branches'] });
      else if (event.target === 'session') navigation.go({ workspaceId: event.workspaceId, nodeId: event.nodeId });
      return;
    }
    if (event.type !== 'browser.agentFocus' || event.workspaceId !== current.current?.id) return;
    // The desktop repeats this request until the real native view is attached;
    // refresh may still be delivering the newly created node on the first event.
    if (!current.current.nodes?.some(node => node.id === event.id && node.type === 'browser')) { refresh().catch(() => {}); return; }
    setPalette(false); setVoice(false); setTray(false); setTools(false); setList(false); setMenu(null); setInspector(null); setSidebar(false);
    focusPanel(event.id);
  }), [focusPanel, refresh, navigation]);
  const relaunch = useCallback(node => operation(async () => { setBusy(node.id); try { await launchTerminal(node); await refresh(); } finally { setBusy(''); } }), [operation, launchTerminal, refresh]);
  const openFolder = useCallback(() => operation(async () => {
    setBusy('folder');
    try {
      await flush();
      const path = await api('dialog.openFolder'); if (!path) return;
      await api('workspace.open', { path }); await refresh();
      setSidebar(false); setInspector(null);
      setCanvasFocusRequest(n => n + 1);
    } finally { setBusy(''); }
  }), [operation, refresh, flush]);
  const selectWorkspace = id => operation(async () => {
    if (id === workspace?.id) return;
    await flush(); await api('workspace.select', { id });
    setInspector(null); setMenu(null); setList(false); setSidebar(false); await refresh();
    setCanvasFocusRequest(n => n + 1);
  });
  navTargets.current = { select: selectWorkspace, run: nav => { if (nav.nodeId) focusPanel(nav.nodeId); if (nav.panel) onOpenPanel(...nav.panel); } };
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
    const region = document.querySelector('.canvas-stage')?.getBoundingClientRect(), camera = spacesRef.current.view?.camera || w.camera || { x: 0, y: 0, zoom: 1 };
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
  const jump = id => { spaces.reveal(id); reveal(id); setKeyboardMode('navigation'); setFocused(null); setSelected([id]); setJumpRequest({ id, nonce: crypto.randomUUID() }); setCanvasFocusRequest(n => n + 1); setList(false); setSidebar(false); };
  const workspaceCommand = id => {
    if (id === 'palette') { setPalette(value => !value); return; }
    if (id === 'projects') { setProjectsOpen(true); return; }
    if (id === 'shortcuts') { setShortcutsOpen(true); return; }
    if (!workspace) return;
    if (id === 'panels') { setQuery(''); setList(true); return; }
    const panels = (view?.nodes || []).filter(n => !n.data?.hidden && !n.hidden && n.type !== 'zone');
    const currentId = [focused, ...selected].find(id => panels.some(n => n.id === id));
    if (['left', 'right', 'up', 'down'].includes(id)) {
      const next = currentId ? directionalNeighbor(panels, currentId, id) : panels[0]?.id;
      if (next) jump(next);
      return;
    }
    if (id === 'next-session' || id === 'previous-session') {
      const next = cycleSession(panels, currentId, id === 'next-session' ? 1 : -1);
      if (next) jump(next);
      return;
    }
    if (id === 'next-attention') {
      const next = nextAttentionId(buildSessionRows(view.nodes, terminalActivity).rows, currentId);
      if (next) jump(next); else notify('Ninguna sesión necesita tu atención.');
      return;
    }
    if (id === 'enter-panel' || id === 'return-focus') {
      const last = lastWorkFocus.current.get(workspace.id);
      const available = workspace.nodes.some(n => n.id === last && !n.data?.hidden && !n.hidden && n.type !== 'zone');
      const target = id === 'return-focus' && available ? last : currentId || panels[0]?.id;
      if (target && workspace.nodes.some(n => n.id === target && !n.data?.hidden && !n.hidden && n.type !== 'zone')) focusPanel(target);
      return;
    }
    if (id === 'leave-panel') {
      const target = focused || selected[0];
      setFocused(null); setKeyboardMode('navigation');
      if (target) { setSelected([target]); setJumpRequest({ id: target, nonce: crypto.randomUUID() }); }
      setCanvasFocusRequest(n => n + 1);
      return;
    }
    if (id === 'fit-all') {
      setFocused(null); setKeyboardMode('navigation'); setFitRequest(n => n + 1); setCanvasFocusRequest(n => n + 1);
      return;
    }
    if (id.startsWith('create-')) return onOpenPanel(id.slice(7));
  };
  const workspaceCommandRef = useRef(workspaceCommand); workspaceCommandRef.current = workspaceCommand;
  const commandAction = useCallback((action, data) => {
    setPalette(false);
    const key = typeof action === 'string' ? action : action?.action || action?.type || action?.id;
    if (Object.hasOwn(bindings, key)) return workspaceCommandRef.current(key);
    if (key === 'sites') { setSitesOpen(true); setInspector(null); return; }
    if (key === 'open-folder' || key === 'openFolder' || key === 'workspace.open') return openFolder();
    if (key === 'fit') return workspaceCommandRef.current('fit-all');
    if (key === 'voice') { setVoiceText(''); setVoice(true); return; }
    if (key === 'dictation') { requestAnimationFrame(() => dictation.openDictation()); return; }
    if (key === 'phantom-chat') { openPhantomChat(true); return; }
    if (key === 'openOrchestrator') { toggleHub(); return; }
    if (key === 'settings') { setInspector('settings'); return; }
    if (key === 'appearance') { setInspector('appearance'); return; }
    if (key === 'tool') { setInspector(action.tab); return; }
    if (key === 'panel') { jump(action.id); return; }
    if (key === 'create') return onOpenPanel(action.panelType, action.data || {});
    if (key === 'search' || key === 'panels') { setList(true); return; }
    if (key === 'focus' || key === 'jump') { const id = action.nodeId || action.id || data?.id; if (id) focusPanel(id); return; }
    if (key === 'inspector') { setInspector(action.tab || data?.tab || 'tasks'); return; }
    const type = key?.replace(/^(create:|new:|panel:|create-|new-)/, '');
    if (TYPES.some(t => t[0] === type)) return onOpenPanel(type, action?.data || data || {});
    notify('Esta acción no está disponible en el proyecto actual.');
  }, [openFolder, onOpenPanel, notify, focusPanel, openPhantomChat, toggleHub, dictation.openDictation, bindings, spaces, reveal]);
  useEffect(() => {
    const handler = e => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.getModifierState?.('AltGraph')) return;
      // Ctrl ⇧ Space: from inside Phantom's chat, close it (unchanged); anywhere else, open or close the global Orquestador.
      if ((e.ctrlKey || (IS_MAC && e.metaKey)) && e.shiftKey && e.code === 'Space') { e.preventDefault(); if (phantomChat && e.target.closest?.('.phantom-chat')) openPhantomChat(false); else toggleHub(); return; }
      if (e.key === 'Escape') {
        if (edit) { e.preventDefault(); setEdit(null); }
        else if (palette) setPalette(false);
        else if (voice) setVoice(false);
        else if (sitesOpen && !contextMenu) { e.preventDefault(); e.stopPropagation(); closeSites(); }
        else if (menu) setMenu(null);
        else if (tools) setTools(false);
        else if (tray) setTray(false);
        else if (list) { setList(false); setCanvasFocusRequest(n => n + 1); }
         else if (inspector && !e.target.closest('.xterm')) setInspector(null);
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [palette, voice, menu, tools, tray, list, inspector, edit, phantomChat, openPhantomChat, toggleHub, sitesOpen, contextMenu, closeSites]);
  useEffect(() => {
    if (!workspace || previousNavigation.current?.focused !== focused) return;
    const visible = new Set((view?.nodes || []).filter(n => !n.data?.hidden && !n.hidden).map(n => n.id));
    if (focused && !visible.has(focused)) { setFocused(null); setKeyboardMode('navigation'); setCanvasFocusRequest(n => n + 1); }
    setSelected(ids => ids.every(id => visible.has(id)) ? ids : ids.filter(id => visible.has(id)));
  }, [workspace, view, focused]);
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
  // The badge counts come from the same inbox the section shows, read for every project.
  const hubConnected = connection.status === 'connected';
  const { inbox: hubInbox } = useOrchestratorInbox({ workspaces: state?.workspaces, api, connected: hubConnected });
  const hubPending = hubInbox.projects.reduce((n, p) => n + p.needsYou.length, 0);
  const hubBroken = hubInbox.broken;
  // A row of the section may point at another project: switch first, then focus its node or open its panel there.
  const hubSelect = useCallback((id, opts) => { setHubOpen(false); navigation.go({ workspaceId: id, nodeId: opts?.nodeId }); }, [navigation]);
  const hubPanel = useCallback((type, data, title, workspaceId) => { setHubOpen(false); navigation.go({ workspaceId: workspaceId || current.current?.id, panel: [type, data, title] }); }, [navigation]);
  useEffect(() => { navigation.settle(workspace?.id); }, [navigation, workspace?.id]);
  const phantomStatus = useMemo(() => dockStatus(workspace), [workspace?.nodes, workspace?.integration]);
  const togglePhantom = useCallback(() => openPhantomChat(!chatOpen), [openPhantomChat, chatOpen]);   const { inputBlocked: overlayInputBlocked, navigationBlocked: overlayNavigationBlocked, browserObscured } = overlayPolicy({ inspector, palette, projectsOpen, shortcutsOpen, voice: voice || dictation.open, tray, list, menu, tools, edit, sidebar, phantomDrawer: chatOpen && compactRail, folder: busy === 'folder', closing: closeRequest?.status === 'saving', disconnected: connection.status !== 'connected' });
  // Selecting a terminal from navigation must not let its activation effect
  // steal focus before Tab can reach the row's secondary action. Clicking back
  // into the working region releases this ownership through the rail's blur.
  const inputBlocked = overlayInputBlocked || railOwnsFocus || (chatOpen && chatOwnsFocus);
  useEffect(() => {
    if (!list) return;
    const frame = requestAnimationFrame(() => document.querySelector('.index-search input')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [list]);
  useEffect(() => {
    const capture = event => {
      dispatchWorkspaceKey(event, bindings, {
        blocked: overlayNavigationBlocked || sitesOpen || !!contextMenu || dockMore || !!event.target?.closest?.('[role="dialog"],[role="menu"],.canvas-popover'),
        navigationMode: keyboardMode === 'navigation' && !!event.target?.matches?.('.canvas') && !event.target.closest('[inert]'),
        inPanel: keyboardMode === 'interaction' && !!event.target?.closest?.('.canvas-node'),
        editable: isEditingTarget(event.target),
      }, id => workspaceCommandRef.current(id));
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [bindings, overlayNavigationBlocked, sitesOpen, contextMenu, dockMore, keyboardMode]);
  const connectionLabel = ({ connected: 'Host local conectado', connecting: 'Conectando con el host…', reconnecting: 'Reconectando con el host…', disconnected: 'Host desconectado', error: 'Error de conexión' })[connection.status] || 'Conexión no disponible';
  const saveLabel = saving ? 'Guardando' : saveError ? 'Sin guardar' : connection.status !== 'connected' ? 'Sin conexión' : error ? 'Revisar estado' : 'Guardado';
  const menuNode = workspace?.nodes?.find(n => n.id === menu?.id);
  const filteredNodes = (workspace?.nodes || []).filter(n => `${n.title} ${label(n.type)} ${n.data?.agent?.cardTitle || ''} ${n.data?.agent?.step || ''} ${workspace?.missions?.find(m => m.id === n.groupId)?.title || ''}`.toLowerCase().includes(query.toLowerCase()));
  const indexGroups = useMemo(() => groupPanelIndex(filteredNodes, terminalActivity), [filteredNodes, terminalActivity]);
  const indexOrder = indexGroups.flatMap(g => g.items.map(i => i.node));
  const navigatePanelIndex = event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const search = event.target.matches('.index-search input');
    if (search && event.key === 'Enter' && indexOrder[0]) { event.preventDefault(); jump(indexOrder[0].id); return; }
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('.index-item > button:first-child')];
    const index = buttons.indexOf(event.target);
    if (!buttons.length || (!search && index < 0)) return;
    event.preventDefault();
    buttons[search ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus({ preventScroll: true });
    document.activeElement?.scrollIntoView({ block: 'nearest' });
  };
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
  return <div data-keyboard-mode={keyboardMode} data-focus-moving={focusMoving || undefined} className={`app-shell studio-${appearance.background} ${appearance.image ? 'studio-personal' : ''} ${appearance.gengar ? 'studio-character' : ''} ${appearance.pulse ? 'studio-pulse' : ''} ${appearance.concentration ? 'studio-concentration' : ''} ${focused ? 'studio-focused' : ''} ${inspector ? 'studio-inspector-open' : ''} ${settingsOpen ? 'studio-settings-open' : ''} ${appearance.grid ? '' : 'studio-no-grid'} ${railCollapsed ? 'rail-collapsed' : ''} ${chatOpen ? 'phantom-chat-open' : ''}`} style={{ '--identity-opacity': appearance.gengarIntensity / 100, '--background-intensity': appearance.intensity / 100, '--personal-background': appearance.image ? `url("${appearance.image}")` : 'none' }}>
    <PresenceGroup>
    {sidebar && <button key="rail-scrim" className="rail-scrim" aria-label="Cerrar proyectos" onClick={() => setSidebar(false)} />}
    <aside key="project-rail" id="project-rail" ref={railRef} aria-label="Navegación del espacio" role={compactRail && sidebar ? 'dialog' : undefined} aria-modal={compactRail && sidebar ? true : undefined} inert={compactRail && !sidebar} onKeyDown={navigateRailList} onFocusCapture={() => setRailOwnsFocus(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setRailOwnsFocus(false); }} className={`project-rail ${sidebar ? 'rail-open' : ''}`}>
      <div className="brand rail-head">
        <ProjectSwitcher projects={state.workspaces} active={workspace} open={contextMenu === 'project'} onOpenChange={value => setContextMenu(value ? 'project' : null)} onSelect={id => { setSidebar(false); selectWorkspace(id); }} onOpenFolder={openFolder} busy={busy === 'folder'} />
        {workspace && <><Spaces key={workspace.id} spaces={spaces.spaces} active={spaces.active} nodes={workspace.nodes || []} open={contextMenu === 'space'} onOpenChange={value => setContextMenu(value ? 'space' : null)} onSelect={id => { setFocused(null); setSelected([]); spaces.select(id); }} onCreate={spaces.create} onRename={spaces.rename} onRemove={spaces.remove} /></>}
        <button className="rail-collapse icon-button" aria-label={railCollapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'} title={railCollapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'} aria-expanded={!railCollapsed} onClick={toggleRail}>{railCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button><button className="rail-close icon-button" aria-label="Cerrar proyectos" onClick={() => setSidebar(false)}><X size={17} /></button></div>{railCollapsed && workspace && <button className="rail-collapsed-project" onClick={toggleRail} title={workspace.path}><ProjectMark project={workspace} small /><span>{workspace.name}{spaces.activeSpace && <em> / {spaces.activeSpace.name}</em>}</span></button>}
      <OrchestratorRailEntry pending={hubPending} broken={hubBroken} active={hubOpen} onClick={() => { setSidebar(false); toggleHub(); }} />
      {workspace && <button className={`rail-attention ${activity.needs.length ? 'needs-you' : ''}`} aria-expanded={!!tray} aria-controls="activity-tray" onClick={() => { setSidebar(false); setTray(v => !v); setTools(false); setList(false); setMenu(null); }}><ActivityIcon size={20} /><span>{activity.needs.length ? 'Te necesitan' : 'Todo en orden'}</span>{activity.needs.length > 0 ? <b>{activity.needs.length}</b> : <ChevronRight size={13} />}</button>}
      {workspace && <SidebarPanels nodes={view.nodes} types={TYPES} selected={selected} focused={focused} sessions={terminalActivity} onJump={id => { setSitesOpen(false); jump(id); }} onFocus={id => { setSitesOpen(false); setSidebar(false); focusPanel(id); }} onSearch={() => { setSitesOpen(false); setSidebar(false); setList(v => !v); }} onMap={() => { setSitesOpen(false); setSidebar(false); focusPanel(null); setFitRequest(n => n + 1); }} />}
      <RailUsage data={activity.sources.limits?.data} loading={activity.sources.limits?.loading} error={activity.sources.limits?.error} onRefresh={async () => { await api('limits.read', { workspaceId: workspace?.id, force: true }); activity.retry(); }} />
      <div className="rail-bottom">
        <div className="rail-system"><span className={`host-indicator ${connection.status}`} title={connection.message || connectionLabel} role="status"><i />{connectionLabel}</span><VoiceLauncher disabled={!workspace || connection.status !== 'connected'} /><button className={`icon-button ${['settings', 'appearance'].includes(inspector) ? 'active' : ''}`} title="Configuración" aria-label="Configuración" onClick={() => { setSidebar(false); setInspector(['settings', 'appearance'].includes(inspector) ? null : 'settings'); }}><Settings2 size={15} /></button></div>
      </div>
    </aside>
    <main key="main-workspace" className="main-workspace" inert={compactRail && sidebar}>
      <header className="workspace-header"><button className="icon-button rail-toggle" title="Ver proyectos" aria-label="Ver proyectos" aria-expanded={sidebar} aria-controls="project-rail" onClick={() => setSidebar(true)}><PanelLeftOpen size={18} /></button>
        <div className="workspace-identity" title={workspace ? `Carpeta elegida: ${workspace.path}\nRuta canónica: ${workspace.canonicalPath || workspace.path}\nEl nombre visible no mueve la carpeta.` : 'Abre una carpeta para comenzar'}><div className="breadcrumb"><Ghost size={18} aria-hidden="true" /><div className="project-name-editor">{projectRename.editing ? <><input ref={projectRename.inputRef} className="inline-name-input" aria-label="Nombre del proyecto" aria-invalid={!!projectRename.editing.error} aria-describedby={projectRename.editing.error ? 'project-name-error' : undefined} value={projectRename.editing.value} readOnly={projectRename.editing.saving} onChange={e => projectRename.change(e.target.value)} onBlur={() => projectRename.commit(false)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); projectRename.commit(true); } if (e.key === 'Escape') { e.preventDefault(); projectRename.cancel(); } }} />{projectRename.editing.error && <span className="inline-name-error" id="project-name-error" role="alert">{projectRename.editing.error}</span>}</> : <button ref={projectNameButton} disabled={!workspace} title="Renombrar proyecto · no mueve la carpeta" onClick={() => workspace && projectRename.start(workspace.id, workspace.name, () => projectNameButton.current)}>{workspace?.name || 'Tu espacio'}{workspace && <Pencil size={11} />}</button>}</div>{workspace && <><span className="identity-separator" aria-hidden="true">/</span><span className="identity-space">{spaces.activeSpace?.name || 'Principal'}</span></>}</div></div>
        <div className="header-controls">
          <span className={`save-state ${error || connection.status !== 'connected' ? 'has-error' : ''} ${saveLabel === 'Guardado' ? 'is-quiet' : ''}`} title={error || (saving ? 'Guardando cambios de disposición' : connectionLabel)}>{saving ? <LoaderCircle size={12} className="spinning" /> : error || connection.status !== 'connected' ? <AlertCircle size={12} /> : <Check size={12} />}<span className={saveLabel === 'Guardado' ? 'sr-only' : undefined}>{saveLabel}</span></span>
          <span className="keyboard-mode keyboard-mode-indicator" role="status">{keyboardMode === 'navigation' ? 'Navegación' : 'Interacción'}</span>
          <button className="icon-button" aria-label="Cambiar proyecto" title={`Cambiar proyecto · ${formatBinding(bindings.projects)}`} onClick={() => setProjectsOpen(true)}><FolderOpen size={17} /></button>
          <button className="icon-button" aria-label="Configurar atajos" title={`Configurar atajos · ${formatBinding(bindings.shortcuts)}`} onClick={() => setShortcutsOpen(true)}><Command size={17} /></button>
          <button className="search-command" onClick={() => setPalette(true)}><Search size={15} /><span>Buscar o ejecutar</span><kbd>{formatBinding(bindings.palette)}</kbd></button><OrchestratorHubButton pending={hubPending} broken={hubBroken} active={hubOpen} onClick={() => toggleHub()} /><button className={`icon-button phantom-chat-toggle ${chatOpen ? 'active' : ''}`} data-tone={phantomStatus.tone} title={`Phantom: chat y orquestador (${MOD} ⇧ Espacio) · ${phantomStatus.label}`} aria-label={chatOpen ? 'Cerrar Phantom' : 'Abrir Phantom'} aria-pressed={chatOpen} disabled={!workspace} onClick={togglePhantom}><Ghost size={17} /></button>{(railCollapsed || compactRail) && <button className={`icon-button attention-button ${tray ? 'active' : ''}`} title={activity.needs.length ? 'Te necesitan' : 'Todo en orden'} aria-label={activity.needs.length ? `Te necesitan, ${activity.needs.length} ${activity.needs.length === 1 ? 'pendiente' : 'pendientes'}` : 'Todo en orden'} aria-expanded={tray} aria-controls="activity-tray" disabled={!workspace} onClick={() => { setTray(v => !v); setTools(false); setList(false); setMenu(null); }}><Bell size={17} />{activity.needs.length > 0 && <i />}</button>}<button className={`icon-button ${inspector ? 'active' : ''}`} title="Herramientas del proyecto" aria-label="Herramientas del proyecto" disabled={!workspace} onClick={() => setInspector(inspector ? null : 'context')}><PanelLeftClose size={18} /></button></div>
      </header>
      {error && <div className="connection-error" role="status"><AlertCircle size={14} /><span>{error}</span><button onClick={() => operation(async () => { await flush(); await refresh(); })}>Reintentar</button></div>}
      {closeRequest?.status === 'failed' && <div className="connection-error" role="alert"><AlertCircle size={14} /><span>No se cerró la ventana: {closeRequest.error}. Puedes reintentar o descartar explícitamente desde el diálogo del escritorio.</span><button onClick={retryClose}>Guardar y cerrar</button></div>}
      <div className="workspace-body"><PresenceGroup>
        <div key="canvas-region" className="canvas-region">
          {appearance.background === 'ascii' && !appearance.image && <AsciiField paused={!!focused || appearance.concentration} />}
          <PresenceGroup>
          <div key="canvas-content" className="sites-canvas-content" inert={sitesOpen}>
           {workspace ? <AgentOpenContext.Provider value={openAgent}><Canvas key={`${workspace.id}:${spaces.active || 'main'}`} workspace={view} terminalActivity={terminalActivity} connection={connection} api={api} refresh={refresh} flush={flush} registerBeforeFlush={registerBeforeFlush} notify={notify} onOpenPanel={onOpenPanel} onChange={onChange} onCamera={onCamera} focused={focused} onFocus={focusPanel} selected={selected} onSelect={setSelected} keyboardMode={keyboardMode} onKeyboardMode={onKeyboardMode} focusRequest={canvasFocusRequest} bindings={bindings} inputBlocked={inputBlocked || sitesOpen} navigationBlocked={overlayNavigationBlocked || railOwnsFocus || (chatOpen && chatOwnsFocus) || sitesOpen} obscured={focusMoving || sitesOpen || browserObscured || !!projectRename.editing} spaceId={spaces.active} renameRequest={renameRequest} onMenu={openMenu} onRelaunch={relaunch} onCloseTerminal={onCloseTerminal} fitRequest={fitRequest} jumpRequest={jumpRequest} onShortcuts={() => setShortcutsOpen(true)} showCharacter={appearance.gengar} /></AgentOpenContext.Provider> : <section className="canvas welcome-canvas"><EmptyState className="canvas-empty" size="hero" icon={appearance.gengar ? <TitiMascot /> : FolderOpen} heading="h1" title="Un espacio para cada proyecto" description="Elige una carpeta de tu equipo. Terminales, páginas y contexto quedan vinculados a ella, listos para volver." actions={<button className="button primary" onClick={openFolder} disabled={busy === 'folder'}>{busy === 'folder' ? <LoaderCircle size={16} className="spinning" /> : <FolderOpen size={16} />} Abrir carpeta</button>} hint="El trabajo vive en tu equipo · No se crean archivos en la carpeta" /></section>}
          {!!busy && busy !== 'folder' && <div key="canvas-busy" className="canvas-busy" role="status"><LoaderCircle size={14} className="spinning" />Preparando {TYPES.some(t => t[0] === busy) ? label(busy).toLowerCase() : 'sesión'}…</div>}
          {workspace && <div key="create-dock" ref={dockFit} className={`create-dock activity-dock ${tray ? 'activity-open' : ''}`}>
            <ActivityNotch activity={activity} open={tray} buttonRef={activityButton} onToggle={toggleActivity} identity={appearance.gengar && view.nodes.some(node => !node.data?.hidden)} />
            <div className="dock-main" role="toolbar" aria-label="Crear panel" onFocusCapture={event => event.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })}>{DOCK_ACTIONS.map(([type, name, hint]) => { const Icon = PANEL_ICONS[type], around = type === 'zone' && selected.length > 1; return <button key={type} className={`dock-action${type === 'terminal' ? ' dock-primary' : ''}`} data-type={type} disabled={!!busy} title={`${around ? 'Crear zona alrededor de la selección' : hint}${bindings[`create-${type}`] ? ` · ${formatBinding(bindings[`create-${type}`])}` : ''}`} onClick={() => around ? zoneFromSelection() : onOpenPanel(type)}><Icon size={18} aria-hidden="true" /><span>{type === 'terminal' ? 'Nueva sesión' : name}</span>{type === 'terminal' && bindings['create-terminal'] && <kbd className="dock-kbd">{formatBinding(bindings['create-terminal'])}</kbd>}</button>; })}<i aria-hidden="true" />{HUB_ACTIONS.map(([type, name, Icon, hint]) => <button key={type} className="dock-action dock-hub" data-hub={type} disabled={!!busy} title={hint} onClick={() => onOpenPanel(type)}><Icon size={18} aria-hidden="true" /><span>{name}</span></button>)}<button ref={dockMoreButton} className="dock-action dock-hub dock-more" disabled={!!busy} aria-label="Más" aria-haspopup="menu" aria-expanded={dockMore} onClick={() => setDockMore(value => !value)}><MoreHorizontal size={18} aria-hidden="true" /><span>Más</span></button></div>
            {dockMore && <div ref={dockMoreMenu} className="dock-more-menu" role="menu" aria-label="Más hubs">{HUB_MORE.map(type => { const Icon = TYPES.find(item => item[0] === type)[2]; return <button key={type} role="menuitem" disabled={!!busy} title={HUBS[type].hint} onClick={() => { onOpenPanel(type); setDockMore(false); }}><Icon size={18} aria-hidden="true" /><span>{HUBS[type].name}</span></button>; })}<button role="menuitem" disabled={!!busy} onClick={() => { setDockMore(false); setTools(true); }}><Layers size={18} aria-hidden="true" /><span>Todas las herramientas</span></button></div>}
          </div>}
          {workspace && !focused && <button key="panel-index-button" className={`panel-index-button ${list ? 'active' : ''}`} title={`Buscar paneles · ${formatBinding(bindings.panels)}`} onClick={() => { setList(v => !v); setTools(false); }}><List size={15} /><span>{workspace.nodes?.length || 0} paneles</span>{selected.length > 1 && <b>{selected.length} seleccionados</b>}</button>}
          {selected.length > 1 && !focused && <button key="zone-selection" className="zone-selection button" onClick={zoneFromSelection}><Frame size={15} /> Crear zona</button>}
          {selected.length > 1 && !focused && <button key="group-selection" className="group-selection button" onClick={groupSelection}><Target size={15} /> Agrupar en misión</button>}
          {tools && <><button className="popover-dismiss" aria-label="Cerrar herramientas" onClick={() => setTools(false)} /><ToolPicker key={workspace.id} workspaceId={workspace.id} types={LAUNCH_TYPES} disabled={!!busy} onPick={(type, source) => onOpenPanel(type, {}, undefined, { source })} onClose={() => setTools(false)} /></>}
          {list && <><button className="popover-dismiss panel-index-scrim" aria-label="Cerrar lista" tabIndex={-1} onClick={() => { setList(false); setCanvasFocusRequest(n => n + 1); }} /><div className="panel-index" onKeyDown={navigatePanelIndex}><div className="popover-heading"><strong>Paneles del proyecto</strong><button className="icon-button" aria-label="Cerrar lista" onClick={() => { setList(false); setCanvasFocusRequest(n => n + 1); }}><X size={15} /></button></div><label className="index-search"><Search size={15} /><input autoFocus aria-label="Buscar panel por nombre, tipo o misión" placeholder="Buscar nombre, tipo o misión…" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="panel-index-items">{indexGroups.map(group => <section className="index-group" key={group.key} data-state={group.key}><h3 className="index-group-title"><span>{group.label}</span><b>{group.items.length}</b></h3>{group.items.map(({ node: n, status, state, time, provider }) => <div className="index-item" key={n.id} data-state={state}><button onClick={() => jump(n.id)}><span className="index-type">{state !== 'other' && <i className={`index-dot is-${state}`} aria-hidden="true" />}{state === 'other' ? label(n.type) : [provider, status, time].filter(Boolean).join(' · ')}{n.data?.hidden ? ' · Vista oculta · clic para recuperar' : ''}</span><strong>{n.title}</strong>{n.groupId && <small>{workspace.missions?.find(m => m.id === n.groupId)?.title}</small>}</button><button className="icon-button" title="Enfocar" aria-label={`Enfocar ${n.title}`} onClick={() => { focusPanel(n.id); setList(false); }}><ExternalLink size={14} /></button></div>)}</section>)}{!filteredNodes.length && <EmptyState className="small-empty" size="compact" description={query ? 'No hay paneles con ese nombre, tipo o misión.' : 'Aún no hay paneles. Crea uno desde la barra inferior.'} />}</div><div className="index-footer"><button onClick={() => { workspaceCommandRef.current('fit-all'); setList(false); }}>Ver todo el mapa</button><kbd>{formatBinding(bindings.panels)}</kbd></div></div></>}
          </div>
          {sitesOpen && <GlobalSites key="global-sites" api={api} onClose={closeSites} />}
        </PresenceGroup></div>
        {inspector && <div key="inspector-host" className={`inspector-host${settingsOpen ? ' settings-sheet' : ''}`}><Inspector tab={inspector} workspace={workspace} state={state} api={api} refresh={refresh} onClose={() => setInspector(null)} onOpenPanel={onOpenPanel} notify={notify} appearance={{ appearance, update: updateAppearance, reset: resetAppearance, interfaceScale }} /></div>}
      </PresenceGroup></div>
    </main>
    {chatOpen && <PhantomChat key={`phantom-chat:${workspace.id}`} workspace={workspace} api={api} notify={notify} connected={connection.status === 'connected'} focusRequest={chatFocus} onFocusOwnership={setChatOwnsFocus} onClose={() => openPhantomChat(false)} tab={dockTab} onTab={chooseDockTab} status={phantomStatus} onOpenPanel={onOpenPanel} agentRequest={agentRequest} onAgentRequestConsumed={consumeAgentRequest} onOpenOrchestrator={() => toggleHub(true)} onTask={text => { closeTransient(); setVoiceText(text); setVoice(true); }} />}
    {hubOpen && <div className="oh-surface" role="dialog" aria-label="Orquestador global"><OrchestratorHub workspaces={state.workspaces} selectedWorkspaceId={workspace?.id} api={api} connected={hubConnected} notify={notify} onOpenPanel={hubPanel} onSelectWorkspace={hubSelect} onClose={() => setHubOpen(false)} /></div>}
    {tray && workspace && <ActivityTray key={workspace.id} activity={activity} workspace={workspace} api={api} notify={notify} filter={typeof tray === 'string' ? tray : 'needs'} onFilter={setTray} onClose={() => setTray(false)} onTerminal={id => { focusPanel(id); requestAnimationFrame(() => document.querySelector('.canvas-node.focused .xterm-helper-textarea')?.focus()); }} onCard={id => onOpenPanel('phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId: id }, 'Card')} onPanel={(type, data) => onOpenPanel(type, data)} onInspector={setInspector} onRead={async id => { await api('attention.ack', { workspaceId: workspace.id, id }); await refresh(); }} onOrchestrator={() => openPhantomChat(true, 'orchestrator')} onPhantom={() => openPhantomChat(true, 'chat')} />}
    {menu && <><button className="popover-dismiss top-dismiss" aria-label="Cerrar opciones" onClick={() => setMenu(null)} /><div className="context-menu" role="menu" style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 252)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 330)) }}>{menuNode ? <><div className="context-title">{menuNode.title}</div><button role="menuitem" onClick={() => { focusPanel(menuNode.id); setMenu(null); }}><ExternalLink size={15} /> Enfocar panel</button><button role="menuitem" onClick={() => { setRenameRequest({ id: menuNode.id, nonce: crypto.randomUUID() }); setMenu(null); }}><Pencil size={15} /> Renombrar</button><button role="menuitem" onClick={groupSelection}><Target size={15} /> Agrupar selección en misión</button>{selected.length > 1 && <button role="menuitem" onClick={zoneFromSelection}><Frame size={15} /> Crear zona con la selección</button>}{[{ id: null, name: 'Principal' }, ...spaces.spaces].filter(sp => sp.id !== spaces.active).map(sp => <button key={sp.id || 'main'} role="menuitem" onClick={() => { const ids = selected.includes(menuNode.id) ? selected : [menuNode.id]; spaces.moveNodes(ids, sp.id); setSelected([]); setMenu(null); notify(`${ids.length === 1 ? 'Panel movido' : `${ids.length} paneles movidos`} a ${sp.name}.`); }}><Layers size={15} /> Mover a {sp.name}</button>)}{menuNode.groupId && <button role="menuitem" onClick={() => { onChange(menuNode.id, { groupId: null }); setMenu(null); }}><Layers size={15} /> Quitar de la misión</button>}<hr /><button role="menuitem" onClick={() => operation(() => removeView(menuNode))}>{menuNode.type === 'terminal' ? <EyeOff size={15} /> : <Trash2 size={15} />}{menuNode.type === 'terminal' ? 'Ocultar vista · conservar sesión' : 'Eliminar panel'}</button>{menuNode.type === 'terminal' && menuNode.data?.sessionId && <button className="danger" role="menuitem" onClick={() => operation(async () => { await api('terminal.stop', { sessionId: menuNode.data.sessionId }); setMenu(null); await refresh(); notify('Proceso terminado. El historial se conserva.'); })}><Square size={14} /> Terminar proceso</button>}</> : <>{QUICK_TYPES.map(([type, name, Icon]) => <button key={type} role="menuitem" onClick={() => onOpenPanel(type)}><Icon size={15} /> <span className="menu-label">Crear {name.toLowerCase()}</span>{bindings[`create-${type}`] && <kbd className="menu-kbd">{formatBinding(bindings[`create-${type}`])}</kbd>}</button>)}<button role="menuitem" onClick={addReferenceFile}><ImageIcon size={15} /> Añadir imagen o video…</button><hr /><button onClick={() => { setTools(true); setMenu(null); }}> <Plus size={15} /> Todas las herramientas</button><button onClick={() => { setFitRequest(n => n + 1); setMenu(null); }}>Ajustar mapa</button></>}</div></>}
    <CommandPalette key="command-palette" open={palette} onClose={() => setPalette(false)} workspace={workspace} onAction={commandAction} bindings={bindings} />
    <ProjectPicker key="project-picker" open={projectsOpen} onClose={() => setProjectsOpen(false)} projects={state.workspaces} active={workspace} statusOf={project => projectStatus(project, project.id === workspace?.id ? terminalActivity : null)} onSelect={id => { setProjectsOpen(false); selectWorkspace(id); }} onOpenFolder={() => { setProjectsOpen(false); openFolder(); }} busy={busy === 'folder'} />
    <ShortcutSettings key="shortcut-settings" open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} bindings={bindings} onSetBinding={setBinding} onReset={resetBindings} conflicts={conflicts} />
    {closeRequest?.status === 'saving' && <div className="app-modal-backdrop close-progress"><div className="app-dialog close-status" role="status" aria-live="polite"><LoaderCircle size={21} className="spinning" /><h2>Guardando antes de cerrar…</h2><p>Esperando a que se guarden todos los cambios pendientes.</p></div></div>}
    <VoiceCapture key="voice-capture" open={voice} initialText={voiceText} workspace={workspace} connected={connection.status === 'connected'} api={api} refresh={refresh} notify={notify} onClose={() => setVoice(false)} />
    {edit && <div className="app-modal-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setEdit(null); }}><form className="app-dialog" onSubmit={saveEdit} role="dialog" aria-modal="true" aria-label={edit.title}><div className="popover-heading"><h2>{edit.title}</h2><button type="button" className="icon-button" aria-label="Cancelar" onClick={() => setEdit(null)}><X size={17} /></button></div><label>Nombre<input autoFocus value={edit.value} onChange={e => setEdit({ ...edit, value: e.target.value })} placeholder="¿Qué quieres conseguir?" /></label><div className="dialog-actions"><button type="button" className="button" onClick={() => setEdit(null)}>Cancelar</button><button className="button primary" disabled={!edit.value.trim()}>Crear misión</button></div></form></div>}
    <div key="toast-stack" className="toast-stack" aria-live="polite"><PresenceGroup>{toasts.map(t => <div className={`toast ${t.kind}`} key={t.id}>{t.kind === 'error' ? <AlertCircle size={17} /> : <Check size={17} />}<span>{t.message}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setToasts(v => v.filter(item => item.id !== t.id))}><X size={14} /></button></div>)}</PresenceGroup></div>
    </PresenceGroup>
  </div>;
}
import EmptyState from './components/EmptyState.jsx';
