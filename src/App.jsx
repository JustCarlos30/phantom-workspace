import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Bell, Blocks, Braces, ChevronDown, ChevronRight, Command, ExternalLink, Folder, FolderOpen, GitBranch, Globe, Layers, List, LoaderCircle, Mic, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Square, StickyNote, TerminalSquare, Trash2, Workflow, X, Check, AlertCircle, Box, FileText, Play, Target, EyeOff, Pencil, RotateCcw } from 'lucide-react';
import Canvas from './components/Canvas';
import { PresenceGroup } from './components/Presence';
import { Inspector } from './components/Inspector';
import { CommandPalette } from './components/CommandPalette';
import { VoiceCapture } from './components/VoiceCapture';
import { api, useWorkspace } from './hooks/useWorkspace';
import { findPanelPlacement } from './hooks/panelPlacement';
import { useInlineName } from './hooks/useInlineName';
import { overlayPolicy } from './hooks/inputOwnership';
import { useAppearance } from './hooks/useAppearance';
import { Appearance } from './components/Appearance';
import { Palette, Maximize2 } from 'lucide-react';
import './styles.css';
import './studio.css';

const TYPES = [
  ['terminal', 'Terminal', TerminalSquare, 'Una sesión real en esta carpeta'], ['browser', 'Navegador', Globe, 'Una página junto al trabajo'], ['note', 'Nota', StickyNote, 'Contexto que permanece'],
  ['tasks', 'Tareas', Check, 'Borradores, checklists y Phantom'], ['context', 'Contexto', FileText, 'Archivos, memorias y skills'], ['git', 'Git', GitBranch, 'Cambios, ramas y worktrees'], ['services', 'Servicios', Activity, 'Sitios y procesos del proyecto'], ['docker', 'Docker', Box, 'Contenedores de esta carpeta'], ['mission', 'Misión', Target, 'Agrupa trabajo con un propósito'], ['workflows', 'Workflows', Workflow, 'Secuencias de trabajo reutilizables'], ['playwright', 'Playwright', Play, 'Automatización y trazas reales'], ['playground', 'Playground', Braces, 'Ejecuta un fragmento explícitamente'],
];
const label = type => TYPES.find(t => t[0] === type)?.[1] || type;
const initials = name => name?.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || 'P';

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
  const [voice, setVoice] = useState(false);
  const [tray, setTray] = useState(false);
  const [tools, setTools] = useState(false);
  const [list, setList] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState('');
  const [fitRequest, setFitRequest] = useState(0);
  const [jumpRequest, setJumpRequest] = useState(null);
  const [query, setQuery] = useState('');
  const [edit, setEdit] = useState(null);
  const [renameRequest, setRenameRequest] = useState(null);
  const projectNameButton = useRef(null);
  const projectRename = useInlineName({ stage: (id, name) => patch(id, null, { name }), flush, registerBeforeFlush });
  const workspace = state?.workspaces?.find(w => w.id === state.activeWorkspaceId);
  const { appearance, update: updateAppearance, reset: resetAppearance } = useAppearance(workspace?.id, notify);
  const current = useRef(workspace); current.current = workspace;
  const selectionRef = useRef(selected); selectionRef.current = selected;
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const returnSelection = useRef([]);
  const operation = useCallback(async fn => { try { return await fn(); } catch (e) { notify(e.message, 'error'); return null; } }, [notify]);
  const onChange = useCallback((id, change) => { if (current.current) patch(current.current.id, id, change); }, [patch]);
  const onCamera = useCallback((camera, workspaceId) => { if (workspaceId || current.current) patch(workspaceId || current.current.id, null, { camera }); }, [patch]);
  const focusPanel = useCallback(id => {
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
      const data = { ...node.data, ...result.node?.data, sessionId: result.session.id };
      const updated = await api('node.update', { workspaceId: w.id, id: node.id, patch: { data } });
      return updated || { ...node, data };
    })();
    launching.current.set(key, promise);
    try { return await promise; } finally { launching.current.delete(key); }
  }, []);
  const onOpenPanel = useCallback(async (type, data = {}, title) => {
    const w = current.current; if (!w) { notify('Abre una carpeta para crear un panel.'); return null; }
    if (!TYPES.some(t => t[0] === type)) { notify(`Tipo de panel desconocido: ${type}`, 'error'); return null; }
    setTools(false); setMenu(null); setList(false); setTray(false); setInspector(null);
    const existing = w.nodes?.find(n => data.focusNodeId ? n.id === data.focusNodeId : type === 'tasks' && data.cardId && n.type === type && n.data?.cardId === data.cardId);
    if (existing) { focusPanel(existing.id); return existing; }
    setBusy(type);
    let reservationId, created = false;
    try {
      const region = document.querySelector('.canvas')?.getBoundingClientRect();
      const camera = w.camera || { x: 64, y: 64, zoom: 1 };
      const width = type === 'browser' ? 800 : type === 'note' ? 420 : 640;
      const height = type === 'terminal' ? 640 : type === 'browser' ? 520 : type === 'note' ? 340 : 400;
      // Reserve before the RPC so rapid/concurrent creations cannot reuse the
      // same slot while state.get or PTY creation is still in flight.
      for (const [key, item] of placements.current) if (item.workspaceId === w.id && w.nodes?.some(n => n.id === item.nodeId)) placements.current.delete(key);
      const reserved = [...placements.current.values()].filter(item => item.workspaceId === w.id);
      const position = findPanelPlacement({ nodes: [...(w.nodes || []), ...reserved], width, height, camera, viewport: { width: region?.width || 1000, height: region?.height || 700 } });
      reservationId = crypto.randomUUID();
      placements.current.set(reservationId, { workspaceId: w.id, ...position, width, height });
      let node = await api('node.create', { workspaceId: w.id, type, title: title || label(type), width, height, ...position, data });
      created = true; placements.current.get(reservationId).nodeId = node.id;
      if (type === 'terminal' && !data.sessionId) node = await launchTerminal(node);
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
  const jump = id => { reveal(id); setFocused(null); setSelected([id]); setJumpRequest({ id, nonce: Date.now() }); setList(false); };
  const commandAction = useCallback((action, data) => {
    setPalette(false);
    const key = typeof action === 'string' ? action : action?.action || action?.type || action?.id;
    if (key === 'open-folder' || key === 'openFolder' || key === 'workspace.open') return openFolder();
    if (key === 'fit' || key === 'fit-all') { setFocused(null); setFitRequest(n => n + 1); return; }
    if (key === 'voice') { setVoice(true); return; }
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
  }, [openFolder, onOpenPanel, notify, focusPanel]);
  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(v => !v); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setList(v => !v); return; }
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
  }, [palette, voice, menu, tools, tray, list, inspector, edit]);
  useEffect(() => { if (workspace && focused && !workspace.nodes?.some(n => n.id === focused)) setFocused(null); }, [workspace, focused]);
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
  const { inputBlocked, browserObscured } = overlayPolicy({ inspector, palette, voice, tray, list, menu, tools, edit, sidebar, folder: busy === 'folder', closing: closeRequest?.status === 'saving', disconnected: connection.status !== 'connected' });
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
  const closeTerminal = async node => {
    const workspaceId = current.current?.id;
    await flush();
    await api('terminal.close', { workspaceId, nodeId: node.id });
    setMenu(null); setSelected(s => s.filter(id => id !== node.id));
    if (focusedRef.current === node.id) setFocused(null);
    await refresh();
    notify('Terminal cerrada y sesión terminada.');
  };

  if (!window.phantom?.invoke) return <div className="desktop-required"><div className="app-mark"><Blocks size={23} /></div><h1>Abre la aplicación de escritorio</h1><p>Phantom Workspace necesita su host local para abrir carpetas,<br />recuperar terminales y navegar dentro del proyecto.</p><div className="desktop-required-note"><TerminalSquare size={16} /> Esta vista web no está conectada al escritorio.</div></div>;
  if (!state) return <div className="desktop-required"><div className="app-mark"><Blocks size={23} /></div>{error ? <><h1>No pudimos conectar con el host</h1><p>{error}</p><button className="button primary" onClick={() => refresh().catch(() => {})}>Reintentar conexión</button></> : <><LoaderCircle className="spinning" size={23} /><h1>Recuperando tu espacio…</h1><p>Conectando con el host local.</p></>}</div>;
  return <div className={`app-shell studio-${appearance.background} ${focused ? 'studio-focused' : ''} ${inspector ? 'studio-inspector-open' : ''} ${appearance.grid ? '' : 'studio-no-grid'}`} style={{ '--background-intensity': appearance.intensity / 100, '--personal-background': appearance.image ? `url("${appearance.image}")` : 'none' }}>
    <PresenceGroup>
    {sidebar && <button className="rail-scrim" aria-label="Cerrar proyectos" onClick={() => setSidebar(false)} />}
    <aside className={`project-rail ${sidebar ? 'rail-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Blocks size={19} /></span><span>Phantom<span>Workspace</span></span><button className="rail-close icon-button" aria-label="Cerrar proyectos" onClick={() => setSidebar(false)}><X size={17} /></button></div>
      <div className="rail-heading"><span>Proyectos</span><button title="Abrir carpeta" aria-label="Abrir carpeta" onClick={openFolder}><Plus size={16} /></button></div>
      <nav className="project-list" aria-label="Proyectos recientes">{state.workspaces.map(w => <button key={w.id} className={`project-item ${w.id === workspace?.id ? 'active' : ''}`} onClick={() => selectWorkspace(w.id)} title={`${w.name}\nCarpeta: ${w.path}\nRuta canónica: ${w.canonicalPath || w.path}`}><span className="project-initials">{initials(w.name)}</span><span><strong>{w.name}</strong><small>{w.path}</small></span>{w.id === workspace?.id && <span className="project-active-dot" />}</button>)}{!state.workspaces.length && <p className="rail-empty">Tus carpetas abiertas aparecerán aquí.</p>}</nav>
      <button className="open-folder" onClick={openFolder} disabled={busy === 'folder'}><FolderOpen size={16} /> Abrir carpeta</button>
      {workspace && <section className="rail-panels" aria-label="Paneles del proyecto"><div className="rail-heading"><span>Paneles <span className="rail-count">{workspace.nodes?.filter(n => !n.data?.hidden).length || 0}</span></span><button aria-label="Buscar en paneles" title="Buscar paneles · Ctrl Mayús F" onClick={() => setList(v => !v)}><Search size={14} /></button></div><nav aria-label="Acceso directo a paneles">{workspace.nodes?.filter(n => !n.data?.hidden).map(n => { const Icon = TYPES.find(t => t[0] === n.type)?.[2] || Layers; return <div key={n.id} className={`rail-panel-row ${selected.includes(n.id) ? 'selected' : ''}`}><button onClick={() => jump(n.id)} title={`${n.title} · Ver en el mapa`} aria-current={selected.includes(n.id) ? 'true' : undefined}><Icon size={14} /><span>{n.title}</span></button><button className="rail-panel-focus" title={`Enfocar ${n.title}`} aria-label={`Enfocar ${n.title}`} onClick={() => focusPanel(n.id)}><Maximize2 size={12} /></button></div>; })}{!workspace.nodes?.some(n => !n.data?.hidden) && <p className="rail-empty">Crea tu primer panel desde la barra inferior.</p>}</nav><button className="rail-map-action" onClick={() => { setFocused(null); setFitRequest(n => n + 1); }}><Layers size={14} /> Ver todo el mapa <kbd>0</kbd></button></section>}
      <button className={`studio-appearance-button ${inspector === 'appearance' ? 'active' : ''}`} onClick={() => setInspector(inspector === 'appearance' ? null : 'appearance')}><Palette size={16} /><span>Personalizar espacio<small>Fondo, acento y retícula</small></span></button>
      <div className="rail-bottom"><span className={`host-indicator ${connection.status}`} title={connection.message} role="status"><i />{connectionLabel}</span><button onClick={() => setInspector('settings')}><Settings2 size={16} /> Configuración</button><button onClick={() => setPalette(true)}><Command size={16} /> Comandos <kbd>Ctrl K</kbd></button></div>
    </aside>
    <main className="main-workspace">
      <header className="workspace-header"><button className="icon-button rail-toggle" title="Ver proyectos" aria-label="Ver proyectos" onClick={() => setSidebar(true)}><PanelLeftOpen size={18} /></button>
        <div className="workspace-identity"><div className="breadcrumb"><Folder size={15} /><span>Proyectos</span><ChevronRight size={13} /><div className="project-name-editor">{projectRename.editing ? <><input ref={projectRename.inputRef} className="inline-name-input" aria-label="Nombre del proyecto" aria-invalid={!!projectRename.editing.error} aria-describedby={projectRename.editing.error ? 'project-name-error' : undefined} value={projectRename.editing.value} readOnly={projectRename.editing.saving} onChange={e => projectRename.change(e.target.value)} onBlur={() => projectRename.commit(false)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); projectRename.commit(true); } if (e.key === 'Escape') { e.preventDefault(); projectRename.cancel(); } }} />{projectRename.editing.error && <span className="inline-name-error" id="project-name-error" role="alert">{projectRename.editing.error}</span>}</> : <button ref={projectNameButton} disabled={!workspace} title="Renombrar proyecto · no mueve la carpeta" onClick={() => workspace && projectRename.start(workspace.id, workspace.name, () => projectNameButton.current)}>{workspace?.name || 'Tu espacio'}{workspace && <Pencil size={11} />}</button>}</div></div><div className="workspace-path" title={workspace ? `Carpeta elegida: ${workspace.path}\nRuta canónica: ${workspace.canonicalPath || workspace.path}\nEl nombre visible no mueve la carpeta.` : ''}>{workspace ? workspace.canonicalPath || workspace.path : 'Abre una carpeta para comenzar'}{workspace && workspace.path !== workspace.canonicalPath && workspace.canonicalPath && <span className="path-badge">Ruta canónica</span>}</div></div>
        <div className="header-controls"><span className={`save-state ${error || connection.status !== 'connected' ? 'has-error' : ''}`} title={error || (saving ? 'Guardando cambios de disposición' : connectionLabel)}>{saving ? <LoaderCircle size={12} className="spinning" /> : error || connection.status !== 'connected' ? <AlertCircle size={12} /> : <Check size={12} />}{saveLabel}</span><button className="search-command" onClick={() => setPalette(true)}><Search size={15} /><span>Buscar o ejecutar</span><kbd>Ctrl K</kbd></button><button className="icon-button" title="Capturar por voz" aria-label="Capturar por voz" disabled={!workspace} onClick={() => { closeTransient(); setVoice(true); }}><Mic size={17} /></button><button className={`icon-button attention-button ${tray ? 'active' : ''}`} title="Atención del proyecto" aria-label={`Atención del proyecto${attention.length ? `, ${attention.length} pendientes` : ''}`} disabled={!workspace} onClick={() => { setTray(v => !v); setTools(false); }}><Bell size={17} />{attention.length > 0 && <i />}</button><button className={`icon-button ${inspector ? 'active' : ''}`} title="Herramientas del proyecto" aria-label="Herramientas del proyecto" disabled={!workspace} onClick={() => setInspector(inspector ? null : 'context')}><PanelLeftClose size={18} /></button></div>
      </header>
      {error && <div className="connection-error" role="status"><AlertCircle size={14} /><span>{error}</span><button onClick={() => operation(async () => { await flush(); await refresh(); })}>Reintentar</button></div>}
      {closeRequest?.status === 'failed' && <div className="connection-error" role="alert"><AlertCircle size={14} /><span>No se cerró la ventana: {closeRequest.error}. Puedes reintentar o descartar explícitamente desde el diálogo del escritorio.</span><button onClick={retryClose}>Guardar y cerrar</button></div>}
      <div className="workspace-body"><PresenceGroup>
        <div className="canvas-region"><PresenceGroup>
          {workspace ? <Canvas key={workspace.id} workspace={workspace} connection={connection} api={api} refresh={refresh} flush={flush} registerBeforeFlush={registerBeforeFlush} notify={notify} onOpenPanel={onOpenPanel} onChange={onChange} onCamera={onCamera} focused={focused} onFocus={focusPanel} selected={selected} onSelect={setSelected} inputBlocked={inputBlocked} obscured={browserObscured || !!projectRename.editing} renameRequest={renameRequest} onMenu={openMenu} onRelaunch={relaunch} onCloseTerminal={node => operation(() => closeTerminal(node))} fitRequest={fitRequest} jumpRequest={jumpRequest} /> : <section className="canvas welcome-canvas"><div className="canvas-empty"><div className="empty-symbol"><FolderOpen size={31} strokeWidth={1.4} /></div><h1>Un espacio para cada proyecto</h1><p>Elige una carpeta de tu equipo. Terminales, páginas y contexto<br />quedan vinculados a ella, listos para volver.</p><button className="button primary" onClick={openFolder} disabled={busy === 'folder'}>{busy === 'folder' ? <LoaderCircle size={16} className="spinning" /> : <FolderOpen size={16} />} Abrir carpeta</button><span className="empty-hint">El trabajo vive en tu equipo · No se crean archivos en la carpeta</span></div></section>}
          {busy && busy !== 'folder' && <div className="canvas-busy" role="status"><LoaderCircle size={14} className="spinning" />Preparando {TYPES.some(t => t[0] === busy) ? label(busy).toLowerCase() : 'sesión'}…</div>}
          {workspace && <div className="create-dock"><div className="dock-main"><span className="dock-label">Crear panel</span><button disabled={!!busy} onClick={() => onOpenPanel('terminal')}><TerminalSquare size={17} /><span>Terminal</span></button><button disabled={!!busy} onClick={() => onOpenPanel('browser')}><Globe size={17} /><span>Navegador</span></button><button disabled={!!busy} onClick={() => onOpenPanel('note')}><StickyNote size={17} /><span>Nota</span></button><i /><button className={tools ? 'active' : ''} onClick={() => { setTools(v => !v); setTray(false); }} aria-expanded={tools}><Plus size={17} /><span>Herramientas</span><ChevronDown size={12} /></button></div></div>}
          {workspace && !focused && <button className={`panel-index-button ${list ? 'active' : ''}`} title="Buscar paneles (Ctrl Mayús F)" onClick={() => { setList(v => !v); setTools(false); }}><List size={15} /><span>{workspace.nodes?.length || 0} paneles</span>{selected.length > 1 && <b>{selected.length} seleccionados</b>}</button>}
          {selected.length > 1 && !focused && <button className="group-selection button" onClick={groupSelection}><Target size={15} /> Agrupar en misión</button>}
          {tools && <><button className="popover-dismiss" aria-label="Cerrar herramientas" onClick={() => setTools(false)} /><div className="tool-picker"><div className="popover-heading"><strong>Añadir a la mesa</strong><button className="icon-button" aria-label="Cerrar herramientas" onClick={() => setTools(false)}><X size={15} /></button></div><div className="tool-picker-list">{TYPES.map(([type, name, Icon, description]) => <button key={type} disabled={!!busy} onClick={() => onOpenPanel(type)}><Icon size={18} /><span><strong>{name}</strong><small>{description}</small></span><Plus size={13} /></button>)}</div></div></>}
          {list && <div className="panel-index"><div className="popover-heading"><strong>Paneles del proyecto</strong><button className="icon-button" aria-label="Cerrar lista" onClick={() => setList(false)}><X size={15} /></button></div><label className="index-search"><Search size={15} /><input autoFocus aria-label="Buscar panel por nombre, tipo o misión" placeholder="Buscar nombre, tipo o misión…" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="panel-index-items">{filteredNodes.map(n => <div className="index-item" key={n.id}><button onClick={() => jump(n.id)}><span className="index-type">{label(n.type)}{n.data?.hidden ? ' · Vista oculta · clic para recuperar' : ''}</span><strong>{n.title}</strong>{n.groupId && <small>{workspace.missions?.find(m => m.id === n.groupId)?.title}</small>}</button><button className="icon-button" title="Enfocar" aria-label={`Enfocar ${n.title}`} onClick={() => { focusPanel(n.id); setList(false); }}><ExternalLink size={14} /></button></div>)}{!filteredNodes.length && <p className="small-empty">{query ? 'No hay paneles con ese nombre, tipo o misión.' : 'Aún no hay paneles. Crea uno desde la barra inferior.'}</p>}</div><div className="index-footer"><button onClick={() => { setFocused(null); setFitRequest(n => n + 1); setList(false); }}>Ver todo el mapa</button><kbd>Ctrl ⇧ F</kbd></div></div>}
        </PresenceGroup></div>
        {inspector && <div className="inspector-host"><div className="inspector-switcher"><select aria-label="Herramienta contextual" value={inspector} onChange={e => setInspector(e.target.value)}>{TYPES.filter(t => !['terminal', 'browser', 'note', 'mission'].includes(t[0])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}<option value="sessions">Sesiones</option><option value="settings">Configuración</option><option value="appearance">Apariencia</option></select><button className="icon-button" aria-label="Cerrar inspector" onClick={() => setInspector(null)}><X size={16} /></button></div>{inspector === 'appearance' ? <Appearance key={workspace?.id || 'default'} appearance={appearance} update={updateAppearance} reset={resetAppearance} workspace={workspace} /> : <Inspector tab={inspector} workspace={workspace} state={state} api={api} refresh={refresh} onClose={() => setInspector(null)} onOpenPanel={onOpenPanel} notify={notify} />}</div>}
      </PresenceGroup></div>
    </main>
    {tray && <><button className="popover-dismiss top-dismiss" aria-label="Cerrar atención" onClick={() => setTray(false)} /><section className="attention-tray"><div className="popover-heading"><strong>Atención del proyecto</strong><button className="icon-button" aria-label="Cerrar atención" onClick={() => setTray(false)}><X size={16} /></button></div>{attention.length ? attention.map(item => <div className="attention-item" key={item.id}><Bell size={15} /><div><strong>{item.title}</strong><small>{item.source}</small></div><button className="icon-button" aria-label="Marcar como atendido" onClick={() => operation(async () => { await api('attention.ack', { workspaceId: workspace.id, id: item.id }); await refresh(); })}><Check size={16} /></button></div>) : <div className="small-empty"><Check size={22} /><strong>Todo al día</strong><p>Los avisos reales de sesiones y herramientas aparecerán aquí.</p></div>}</section></>}
    {menu && <><button className="popover-dismiss top-dismiss" aria-label="Cerrar opciones" onClick={() => setMenu(null)} /><div className="context-menu" role="menu" style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 252)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 330)) }}>{menuNode ? <><div className="context-title">{menuNode.title}</div><button role="menuitem" onClick={() => { focusPanel(menuNode.id); setMenu(null); }}><ExternalLink size={15} /> Enfocar panel</button><button role="menuitem" onClick={() => { setRenameRequest({ id: menuNode.id, nonce: crypto.randomUUID() }); setMenu(null); }}><Pencil size={15} /> Renombrar</button><button role="menuitem" onClick={groupSelection}><Target size={15} /> Agrupar selección en misión</button>{menuNode.groupId && <button role="menuitem" onClick={() => { onChange(menuNode.id, { groupId: null }); setMenu(null); }}><Layers size={15} /> Quitar de la misión</button>}<hr /><button role="menuitem" onClick={() => operation(() => removeView(menuNode))}>{menuNode.type === 'terminal' ? <EyeOff size={15} /> : <Trash2 size={15} />}{menuNode.type === 'terminal' ? 'Ocultar vista · conservar sesión' : 'Eliminar panel'}</button>{menuNode.type === 'terminal' && menuNode.data?.sessionId && <button className="danger" role="menuitem" onClick={() => operation(async () => { await api('terminal.stop', { sessionId: menuNode.data.sessionId }); setMenu(null); await refresh(); notify('Proceso terminado. El historial se conserva.'); })}><Square size={14} /> Terminar proceso</button>}</> : <>{TYPES.slice(0, 4).map(([type, name, Icon]) => <button key={type} role="menuitem" onClick={() => onOpenPanel(type)}><Icon size={15} /> Crear {name.toLowerCase()}</button>)}<hr /><button onClick={() => { setTools(true); setMenu(null); }}> <Plus size={15} /> Todas las herramientas</button><button onClick={() => { setFitRequest(n => n + 1); setMenu(null); }}>Ajustar mapa</button></>}</div></>}
    <CommandPalette open={palette} onClose={() => setPalette(false)} workspace={workspace} onAction={commandAction} />
    {closeRequest?.status === 'saving' && <div className="app-modal-backdrop close-progress"><div className="app-dialog close-status" role="status" aria-live="polite"><LoaderCircle size={21} className="spinning" /><h2>Guardando antes de cerrar…</h2><p>Esperando a que se guarden todos los cambios pendientes.</p></div></div>}
    <VoiceCapture open={voice} workspace={workspace} api={api} refresh={refresh} notify={notify} onClose={() => setVoice(false)} />
    {edit && <div className="app-modal-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setEdit(null); }}><form className="app-dialog" onSubmit={saveEdit} role="dialog" aria-modal="true" aria-label={edit.title}><div className="popover-heading"><h2>{edit.title}</h2><button type="button" className="icon-button" aria-label="Cancelar" onClick={() => setEdit(null)}><X size={17} /></button></div><label>Nombre<input autoFocus value={edit.value} onChange={e => setEdit({ ...edit, value: e.target.value })} placeholder="¿Qué quieres conseguir?" /></label><div className="dialog-actions"><button type="button" className="button" onClick={() => setEdit(null)}>Cancelar</button><button className="button primary" disabled={!edit.value.trim()}>Crear misión</button></div></form></div>}
    <div className="toast-stack" aria-live="polite"><PresenceGroup>{toasts.map(t => <div className={`toast ${t.kind}`} key={t.id}>{t.kind === 'error' ? <AlertCircle size={17} /> : <Check size={17} />}<span>{t.message}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setToasts(v => v.filter(item => item.id !== t.id))}><X size={14} /></button></div>)}</PresenceGroup></div>
    </PresenceGroup>
  </div>;
}
