import React, { useState } from 'react';
import { Bell, Check, ChevronRight, ChevronsUpDown, Folder, Ghost, Globe, Hand, LocateFixed, Map as MapLucide, MessageCircle, Mic, MoreHorizontal, MousePointer2, PanelLeftClose, Pencil, Search, Settings2, StickyNote } from 'lucide-react';
import Canvas from '../components/Canvas';
import Minimap from '../components/Minimap';
import Spaces from '../components/Spaces';
import ProjectSwitcher from '../components/ProjectSwitcher';
import SidebarPanels from '../components/SidebarPanels';
import ActivityNotch from '../components/ActivityNotch';
import ActivityTrace from '../components/ActivityTrace';
import { ActivityIcon, NoteIcon, TerminalIcon, ZoneIcon, TasksIcon } from '../components/ShellIcons';
import { PhantomGlyph, ClaudeGlyph } from '../components/Glyphs';
import { demo, Panel } from './decorators';
import { workspace, noteNode, noop, done, activity } from './fixtures';
import { BeforeAfter, Page, Section, IconButton, DockUnified, CanvasTools, materialArg } from './proposals-kit';
import './proposals-shell.css';

export default {
  title: 'Propuestas/Shell',
  args: { material: 'cenital' },
  argTypes: { material: materialArg },
  parameters: { docs: { description: { component: 'Laboratorio exploratorio: el shell real de hoy (rail, barra superior, dock, zoom, minimapa y paneles en el mapa) frente a la propuesta. No cambia producción. Datos SYNTHETIC.' } } },
};

const H = 640;
const types = [['note', 'Nota', NoteIcon, 'Contexto de texto', 'space'], ['terminal', 'Terminal', TerminalIcon, 'Sesión local', 'space']];
const term = (id, title, y) => ({ id, type: 'terminal', title, x: 520, y, width: 620, height: 460, data: { sessionId: `session-${id}`, cwd: '/synthetic/project' } });

/* Filas SYNTHETIC: una por estado. */
const ROWS = [
  ['s-rest', 'En reposo (SYNTHETIC)', { tone: 'unknown', label: 'En reposo' }],
  ['s-hover', 'Fila en hover (SYNTHETIC)', { tone: 'unknown', label: 'En reposo' }],
  ['s-sel', 'Seleccionada (SYNTHETIC)', { tone: 'unknown', label: 'En reposo' }],
  ['s-work', 'Refactor del dock (SYNTHETIC)', { tone: 'working', label: 'Trabajando' }],
  ['s-attn', 'Pide permiso (SYNTHETIC)', { tone: 'attention', label: 'Pide permiso', needsYou: true }],
  ['s-done', 'Revisión de estilos (SYNTHETIC)', { tone: 'success', label: 'Terminó' }],
  ['s-err', 'Pruebas del rail (SYNTHETIC)', { tone: 'danger', label: 'Falló' }],
];
const rowNodes = ROWS.map(([id, title], index) => term(id, title, 40 + index * 480));
const rowSessions = Object.fromEntries(ROWS.map(([id, , session]) => [id, session]));
const railNodes = [...rowNodes.filter(node => ['s-work', 's-attn', 's-done'].includes(node.id)), noteNode];
const spaces = [{ id: 'space-demo', name: 'Investigación' }];

/* ---------- Rail ---------- */
function RailToday() {
  return <div className="project-rail px-shell-rail">
    <div className="brand"><span>Phantom<span>Workspace</span></span><button className="rail-collapse icon-button" aria-label="Contraer barra lateral" title="Contraer barra lateral" aria-expanded="true"><PanelLeftClose size={16} /></button></div>
    <ProjectSwitcher projects={[workspace]} active={workspace} open={false} onOpenChange={noop} onSelect={noop} onOpenFolder={noop} />
    <Spaces spaces={spaces} nodes={railNodes} active={null} open={false} onOpenChange={noop} onSelect={noop} onCreate={noop} onRename={noop} onRemove={noop} />
    <button className="rail-attention needs-you" aria-label="Te necesitan, 1 pendiente" aria-expanded="false"><ActivityIcon size={20} /><span>Te necesitan</span><b>1</b></button>
    <SidebarPanels nodes={railNodes} types={types} selected={['s-work']} sessions={rowSessions} onJump={noop} onFocus={noop} onSearch={noop} onMap={noop} />
    <div className="rail-bottom"><div className="rail-system"><span className="host-indicator connected" role="status"><i />Conectado</span><button className="icon-button" aria-label="Dictar" title="Dictar"><Mic size={15} /></button><button className="icon-button" title="Configuración" aria-label="Configuración"><Settings2 size={15} /></button></div></div>
  </div>;
}

const COMPACT = [['s-attn', 'Pide permiso', 'Te necesita', 'attention'], ['s-work', 'Refactor del dock', 'Trabajando', 'working'], ['s-done', 'Revisión de estilos', 'Terminó']];
function RailFull() {
  return <nav className="px-object px-rail px-shell-railfull" aria-label="Rail propuesto">
    <button type="button" className="px-rail-row is-select" aria-label="Proyecto y espacio: Proyecto de ejemplo / Investigación"><span className="px-initials">PE</span><span>Proyecto de ejemplo <span className="px-crumb-sep">/</span> Investigación</span><ChevronsUpDown size={16} aria-hidden="true" /></button>
    <button type="button" className="px-rail-row px-shell-attn" aria-label="Te necesita: 1 pendiente"><ActivityIcon size={16} aria-hidden="true" /><span>Te necesita</span><b>1</b></button>
    <div className="px-rail-group"><h4 className="px-shell-railhead">Sesiones</h4><ul>
      {COMPACT.map(([id, title, meta, tone]) => <li key={id}><button type="button" className="px-rail-row is-detail" aria-current={id === 's-work' || undefined} aria-label={`Ver ${title} en el mapa`}><span className="px-mark"><ClaudeGlyph size={16} aria-hidden="true" /></span><span><strong>{title}</strong><small data-tone={tone}>{meta}</small></span></button></li>)}
    </ul></div>
    <div className="px-rail-group"><h4 className="px-shell-railhead">En el mapa</h4><ul>
      <li><button type="button" className="px-rail-row" aria-label="Ver Contexto del catálogo en el mapa"><span className="px-mark"><NoteIcon size={16} variant="line" aria-hidden="true" /></span><span>Contexto del catálogo</span></button></li>
    </ul></div>
    <footer className="px-shell-railfoot"><span className="px-shell-host" role="status"><i aria-hidden="true" />Conectado</span><IconButton label="Dictar" icon={Mic} /><IconButton label="Configuración" icon={Settings2} /></footer>
  </nav>;
}

export const Rail = {
  render: ({ material }) => <Page title="Rail" problem="La barra lateral apila marca, selector de proyecto, selector de espacio, fila de atención, dos grupos con cabecera y un pie: seis niveles antes de llegar a las sesiones.">
    <BeforeAfter height={H} material={material} before={<RailToday />} after={<RailFull />} changes={[
      'Proyecto y espacio se funden en un solo selector «proyecto / espacio».',
      'La atención pasa a ser la primera fila, con ámbar solo en el texto y el contador.',
      'Desaparece la marca «Phantom Workspace» del rail; el pie queda con host, voz y configuración en controles circulares de 36 px.',
      'Maqueta con piezas del kit (RailCompact ampliado): la estructura cambia y no se alcanza con CSS.',
    ]} />
  </Page>,
};

/* ---------- Filas ---------- */
const railRows = () => <div className="project-rail px-shell-rail px-shell-forcehover"><SidebarPanels nodes={[...rowNodes, noteNode]} types={types} selected={['s-sel']} sessions={rowSessions} onJump={noop} onFocus={noop} onSearch={noop} onMap={noop} /></div>;

export const RailFilas = {
  render: ({ material }) => <Page title="Filas del rail" problem="Cada fila repite proveedor, estado y tiempo con el mismo peso; seleccionada y hover se distinguen poco de los estados de trabajo. El hover está simulado para poder compararlo.">
    <BeforeAfter height={H} material={material} before={railRows()} after={railRows()} changes={[
      'Filas con realce tonal de radio 12 y sin anillos; seleccionada y hover comparten el mismo realce.',
      'Se oculta el tipo de proveedor en la meta: queda estado y tiempo.',
      'Lima solo en «Trabajando» y ámbar solo como texto en «Te necesita».',
      'Botón de enfocar circular de 36 px, visible solo al pasar o seleccionar.',
    ]} />
  </Page>,
};

/* ---------- Barra superior ---------- */
function TopToday() {
  return <div className="px-shell-top">
    <header className="workspace-header">
      <div className="workspace-identity"><div className="breadcrumb"><Folder size={15} /><span>Proyectos</span><ChevronRight size={13} /><div className="project-name-editor"><button title="Renombrar proyecto · no mueve la carpeta">{workspace.name}<Pencil size={11} /></button></div></div><div className="workspace-path">{workspace.canonicalPath}</div></div>
      <div className="header-controls"><span className="save-state"><Check size={12} />Guardado</span><button className="search-command"><Search size={15} /><span>Buscar o ejecutar</span><kbd>Ctrl K</kbd></button><button className="icon-button phantom-chat-toggle" data-tone="idle" aria-label="Abrir Phantom" aria-pressed="false"><Ghost size={17} /></button><button className="icon-button attention-button" aria-label="Te necesitan, 1 pendiente"><Bell size={17} /><i /></button><button className="icon-button" title="Herramientas del proyecto" aria-label="Herramientas del proyecto"><PanelLeftClose size={18} /></button></div>
    </header>
  </div>;
}
function TopProposal() {
  return <div className="px-shell-top">
    <div className="px-object px-shell-topbar" role="toolbar" aria-label="Barra superior propuesta">
      <button type="button" className="px-shell-crumb" title={workspace.canonicalPath} aria-label={`Proyecto: ${workspace.name}. Ruta ${workspace.canonicalPath}`}><strong>{workspace.name}</strong><span>/ Investigación</span></button>
      <span className="px-shell-saved" title="Guardado"><Check size={14} aria-hidden="true" /><span className="px-sr">Guardado</span></span>
      <span className="px-shell-spacer" />
      <button type="button" className="px-shell-search" aria-label="Buscar o ejecutar (Ctrl K)"><Search size={16} aria-hidden="true" /><span>Buscar o ejecutar</span><kbd>Ctrl K</kbd></button>
      <IconButton label="Abrir Phantom" icon={PhantomGlyph} />
      <span className="px-shell-bell"><IconButton label="Te necesitan, 1 pendiente" icon={Bell} /><i aria-hidden="true" /></span>
      <IconButton label="Herramientas del proyecto" icon={PanelLeftClose} />
    </div>
  </div>;
}

export const BarraSuperior = {
  render: ({ material }) => <Page title="Barra superior" problem="Dos píldoras separadas: migas con «Proyectos ›» y la ruta completa en una segunda línea, y otra píldora con «Guardado», buscador y tres iconos.">
    <BeforeAfter height={320} material={material} before={<TopToday />} after={<TopProposal />} changes={[
      'Una sola barra ligera en vez de dos píldoras.',
      'Migas «proyecto / espacio» en una línea; la ruta pasa al tooltip y se quita «Proyectos ›».',
      '«Guardado» queda como un check silencioso con texto accesible.',
      'Controles circulares planos de 36 px; el punto de la campana no usa ámbar de fondo.',
      'Maqueta: no existe componente aislado; se replica el JSX de header.workspace-header.',
    ]} />
  </Page>,
};

/* ---------- Dock ---------- */
const DOCK = [['terminal', 'Nueva sesión', TerminalIcon], ['note', 'Nota', StickyNote], ['site', 'Navegador', Globe], ['zone', 'Zona', ZoneIcon]];
function DockToday() {
  return <div className="px-shell-dock">
    <div className="create-dock activity-dock">
      <ActivityNotch activity={activity} open={false} onToggle={noop} />
      <div className="dock-main" role="toolbar" aria-label="Crear panel">
        {DOCK.map(([type, name, Icon]) => <button key={type} className={`dock-action${type === 'terminal' ? ' dock-primary' : ''}`} data-type={type} aria-label={name}><Icon size={18} aria-hidden="true" /><span>{name}</span></button>)}
        <i aria-hidden="true" />
        <button className="dock-action dock-hub" data-hub="tasks" aria-label="Tareas"><TasksIcon size={18} aria-hidden="true" /><span>Tareas</span></button>
        <button className="dock-action dock-hub dock-more" aria-label="Más" aria-haspopup="menu" aria-expanded="false"><MoreHorizontal size={18} aria-hidden="true" /><span>Más</span></button>
      </div>
    </div>
  </div>;
}

export const Dock = {
  render: ({ material }) => <Page title="Dock" problem="Dos barras apiladas: la muesca «Te necesitan» encima y el dock de crear debajo, cada una con su contorno.">
    <BeforeAfter height={H} material={material} before={<DockToday />} after={<DockUnified />} changes={[
      'Un único dock píldora con el estado (atención y sesiones) dentro.',
      '«Nueva sesión» como única primaria marfil; crear nota, navegador y terminal en círculos de 36 px.',
      'Las herramientas del lienzo se agrupan junto al minimapa, fuera del dock.',
      'Maqueta con DockUnified del kit: cambia la estructura.',
    ]} />
  </Page>,
};

/* ---------- Zoom ---------- */
function ZoomToday() {
  return <div className="px-shell-corner">
    <div className="canvas-navigation" role="toolbar" aria-label="Navegación del canvas">
      <div className="control-segmented" role="group" aria-label="Herramientas del canvas"><button aria-label="Herramienta de selección" aria-pressed="true"><MousePointer2 size={16} /></button><button aria-label="Herramienta de mano" aria-pressed="false"><Hand size={16} /></button><button aria-label="Herramienta de comentarios" aria-pressed="false"><MessageCircle size={16} /></button></div><i />
      <button aria-label="Alejar"><span aria-hidden="true">−</span></button>
      <button className="zoom-value" aria-label="Zoom 79%. Opciones de zoom"><span>79</span>%<span aria-hidden="true">▾</span></button>
      <button aria-label="Acercar"><span aria-hidden="true">+</span></button><i />
      <button aria-label="Ajustar todos los paneles"><LocateFixed size={17} /></button>
      <button className="view-toggle" aria-label="Mostrar minimapa" aria-pressed="true"><MapLucide size={16} /></button>
      <button aria-label="Gestos y atajos del canvas"><span aria-hidden="true">?</span></button>
    </div>
  </div>;
}

export const Zoom = {
  render: ({ material }) => <Page title="Zoom y herramientas del lienzo" problem="Nueve controles en una barra con dos separadores; el modo activo y el zoom compiten con guardar y ayuda.">
    <BeforeAfter height={H} material={material} before={<ZoomToday />} after={<CanvasTools />} changes={[
      'Modo del lienzo en un segmento con pistas de teclado V, H y C.',
      'Zoom y encuadrar en controles circulares de 36 px, junto al minimapa.',
      'El interruptor del minimapa y la ayuda salen de la barra.',
      'Maqueta con CanvasTools del kit: cambia la estructura.',
    ]} />
  </Page>,
};

/* ---------- Minimapa ---------- */
const mapNodes = [noteNode, { ...noteNode, id: 'note-b', x: 560, y: 120, width: 360, height: 260 }, { ...noteNode, id: 'note-c', x: 180, y: 420, width: 300, height: 200 }];
const minimap = () => <div className="px-shell-corner"><Minimap nodes={mapNodes} camera={{ x: 0, y: 0, zoom: 1 }} size={{ width: 900, height: 600 }} selected={[noteNode.id]} onUpdate={noop} /></div>;

export const Minimapa = {
  render: ({ material }) => <Page title="Minimapa" problem="El minimapa usa el acento para la vista y la selección y no comparte material con el resto de objetos.">
    <BeforeAfter height={H} material={material} before={minimap()} after={minimap()} changes={[
      'Mismo Minimap real con el material de objeto propuesto y radio de objeto.',
      'Vista con trazo neutro de 1 px en vez de relleno de acento.',
      'Selección en marfil; el resto de nodos en tinta tenue.',
    ]} />
  </Page>,
};

/* ---------- Panel en el mapa ---------- */
function LiveCanvas({ select }) {
  const [w, setWorkspace] = useState(() => structuredClone(workspace)), [focused, focus] = useState(null), [selected, setSelected] = useState(select ? [noteNode.id] : []);
  return <Panel><Canvas {...demo} workspace={w} selected={selected} onSelect={setSelected} focused={focused} onFocus={focus} onChange={(id, patch) => setWorkspace(old => ({ ...old, nodes: old.nodes.map(n => n.id === id ? { ...n, ...patch } : n) }))} onCamera={noop} connection={{ status: 'connected' }} onMenu={noop} onCloseTerminal={noop} registerBeforeFlush={() => noop} flush={done} /></Panel>;
}
const PULSE = { working: ['pulse-working', 'Trabajando'], attention: ['pulse-attention', 'Te necesita'] };
function MapNode({ state }) {
  const [pulse, label] = PULSE[state];
  return <div className="px-shell-map">
    <article className={`canvas-node ${pulse}`} data-type="terminal" data-panel-state={state} style={{ left: 40, top: 40, width: 440, height: 300 }}>
      {state === 'working' && <ActivityTrace state="pulse-working" />}
      <header className="px-shell-nodehead"><ClaudeGlyph size={16} aria-hidden="true" /><strong>Sesión de ejemplo (SYNTHETIC)</strong><span className="panel-state" data-state={state}>{label}</span></header>
      <p className="px-shell-nodebody">Datos sintéticos del panel.</p>
    </article>
  </div>;
}

export const PanelEnMapa = {
  render: ({ material }) => <Page title="Panel en el mapa" problem="El panel sobre el lienzo suma borde, sombra flotante al seleccionar y aro de estado; en el lienzo casi negro se separa poco.">
    <Section label="Reposo">
      <BeforeAfter height={480} material={material} before={<LiveCanvas />} after={<LiveCanvas />} changes={['Canvas real: el panel hereda el material cenital, sin borde y con radio de objeto.']} />
    </Section>
    <Section label="Seleccionado">
      <BeforeAfter height={480} material={material} before={<LiveCanvas select />} after={<LiveCanvas select />} changes={['Sin sombra flotante al seleccionar: basta el aro de selección.', 'Canvas real con el mismo panel seleccionado.']} />
    </Section>
    <Section label="Trabajando">
      <BeforeAfter height={480} material={material} before={<MapNode state="working" />} after={<MapNode state="working" />} changes={['El cometa lima de ActivityTrace se conserva como única señal de trabajo.', 'Maqueta con las clases reales de .canvas-node: el estado de pulso necesita una sesión de terminal que el catálogo no monta.']} />
    </Section>
    <Section label="Te necesita">
      <BeforeAfter height={480} material={material} before={<MapNode state="attention" />} after={<MapNode state="attention" />} changes={['Ámbar solo en el aro y en el texto «Te necesita»; sin sombra extra.', 'Maqueta con las clases reales de .canvas-node, igual que «Trabajando».']} />
    </Section>
  </Page>,
};
