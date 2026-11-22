import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Check, ChevronDown, ChevronsUpDown, CircleAlert, Ellipsis, FileText, Folder, Globe, Hand, MessageSquare, Mic, Minus, MousePointer2, Plus, Scan, Square, SquareTerminal, StickyNote, X } from 'lucide-react';
import SidebarPanels from '../components/SidebarPanels';
import ActivityNotch from '../components/ActivityNotch';
import ChatCard from '../components/ChatCard';
import { PhantomGlyph, ClaudeGlyph } from '../components/Glyphs';
import { NoteIcon, TerminalIcon } from '../components/ShellIcons';
import { demo, Panel } from './decorators';
import { activity, chatNode, noteNode, noop } from './fixtures';
import './proposals.css';

export default {
  title: 'Propuestas',
  parameters: { docs: { description: { component: 'Laboratorio de diseño exploratorio. Nada de esta familia cambia producción: compara material, compositor, hilo, dock y cabecera del rail con datos sintéticos.' } } },
};

const MATERIALS = [['hoy', 'Hoy', 'Tokens actuales'], ['cenital', 'Cenital', '#19191d → #0d0d10 y brillo 6 %'], ['grafito', 'Grafito', 'Tinte frío, más claro arriba'], ['borde', 'Borde', 'Aro 34 % → 8 %']];
const COMPOSERS = [['isla', 'Isla · elegida', 'Campo con controles dentro'], ['banda', 'Descartada', 'Banda: lo actual, pulido'], ['pildora', 'Descartada', 'Píldora: la más compacta']];
const STATES = ['reposo', 'escribiendo', 'trabajando', 'dictando'];
const MESSAGES = [['cita', 'Cita', 'Barra marfil, como hoy'], ['burbuja', 'Burbuja', 'A la derecha, relleno 5 %']];
const keys = list => list.map(([key]) => key);
const radio = (options, name) => ({ control: 'inline-radio', options, name });
const types = [['note', 'Nota', NoteIcon, 'Contexto de texto', 'space'], ['terminal', 'Terminal', TerminalIcon, 'Sesión local', 'space']];
const SAMPLE = 'Revisa el dock unificado y propón el orden de las acciones de crear. Mantén el lienzo abajo a la derecha.';
const BARS = [24, 40, 64, 88, 56, 72, 36, 92, 68, 32, 52, 80, 44, 28, 60, 84, 36, 48, 24, 40];

function Page({ title, problem, children }) {
  return <div className="px-page"><header className="px-head"><h2>{title}</h2><p>{problem}</p></header>{children}</div>;
}
function Section({ label, children }) {
  return <section className="px-section"><h3 className="px-label">{label}</h3>{children}</section>;
}
function Tag({ today }) {
  return today ? <span className="px-pilltag" data-kind="hoy">HOY · así está la app</span> : <span className="px-pilltag" data-kind="propuesta">PROPUESTA · nuevo</span>;
}
function Scene({ today, children }) {
  return <div className="px-scene"><Tag today={today} />{children}</div>;
}
function Compare({ items, col, render, isToday = () => false }) {
  return <div className="px-compare" style={col ? { '--px-col': col } : undefined}>{items.map(([key, label, note]) => <figure key={key}><figcaption>{label}{note && <small>{note}</small>}</figcaption><Scene today={isToday(key)}>{render(key)}</Scene></figure>)}</div>;
}
const isHoy = key => key === 'hoy';
function IconButton({ label, icon: Icon, state, disabled }) {
  return <button type="button" className="px-btn px-icon" aria-label={label} data-state={state} disabled={disabled}><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></button>;
}
function Send({ disabled }) {
  return <button type="button" className="px-send" aria-label="Enviar" disabled={disabled}><ArrowUp size={18} strokeWidth={2} aria-hidden="true" /></button>;
}
function ContextChip() {
  return <button type="button" className="px-chip px-ctx" aria-label="Contexto: taller-fantasma"><Folder size={14} aria-hidden="true" /><span className="px-chip-text">taller-fantasma</span></button>;
}
function ModelChip() {
  return <button type="button" className="px-chip has-chevron" aria-label="Modelo y esfuerzo: Opus 5.5 · alto"><span className="px-chip-text">Opus 5.5 · alto</span><ChevronDown size={14} aria-hidden="true" /></button>;
}
function LiveLine() {
  return <p className="px-live" role="status"><span className="px-spinner" aria-hidden="true" /><strong>Trabajando</strong><span>· 1 subagente</span></p>;
}
function Hint() {
  return <p className="px-live">Esc descarta · Enter envía</p>;
}

/* ---------- 0. Antes y después ---------- */
const CHANGES = [
  'Campo isla: el texto y todos los controles viven dentro de un mismo campo.',
  'Sin anillo blanco alrededor del compositor; solo un aro tenue que se aclara con el foco.',
  'Sin la fila «Contexto de la sesión»: el contexto pasa a un chip dentro de la isla.',
  'Una sola línea de estado viva encima del campo.',
  'Conversación en columna centrada de 720 px.',
  'Material más separado del lienzo (cenital: #19191d → #0d0d10 con brillo).',
];

export const AntesDespues = {
  parameters: { host: { scenario: 'working' } },
  render: () => <Page title="Antes y después" problem="A la izquierda, el ChatCard real de producción tal como está hoy. A la derecha, el panel de sesión propuesto con material cenital, compositor isla y mensaje en cita.">
    <div className="px-ad">
      <Scene today><Panel><ChatCard {...demo} node={chatNode} /></Panel></Scene>
      <Scene><div className="px-canvas"><Session material="cenital" message="cita" state="trabajando" /></div></Scene>
    </div>
    <Section label="Qué cambia"><ul className="px-changes">{CHANGES.map(item => <li key={item}>{item}</li>)}</ul></Section>
  </Page>,
};

/* ---------- 1–2. Material ---------- */
function Specimen() {
  return <article className="px-object px-specimen">
    <header><h3>Sesiones activas</h3><span className="px-tag">SYNTHETIC</span></header>
    <ul className="px-rows">
      <li><span className="px-mark"><Bot size={16} aria-hidden="true" /></span><div><strong>Refactor del dock</strong><small>Trabajando · 1 subagente</small></div><time>2 min</time></li>
      <li><span className="px-mark"><SquareTerminal size={16} aria-hidden="true" /></span><div><strong>Terminal de pruebas</strong><small>Terminó</small></div><time>14 min</time></li>
    </ul>
    <button type="button" className="px-btn is-primary">Nueva sesión</button>
  </article>;
}
const OnCanvas = ({ material, children }) => <div className="px-canvas"><div className="px-material" data-variant={material}>{children}</div></div>;

export const Material = {
  args: { material: 'cenital' },
  argTypes: { material: radio(keys(MATERIALS), 'Material') },
  render: ({ material }) => <Page title="Material" problem="Las cards del rail, el dock y la bandeja son tan oscuras que no se separan del lienzo. Cada variante sobreescribe solo las custom properties del objeto, así que la misma receta sirve para componentes reales.">
    <Section label={`Material seleccionado · ${material}`}><Scene today={isHoy(material)}><OnCanvas material={material}><Specimen /></OnCanvas></Scene></Section>
    <Section label="Comparativa"><Compare items={MATERIALS} col="520px" isToday={isHoy} render={key => <OnCanvas material={key}><Specimen /></OnCanvas>} /></Section>
  </Page>,
};

function RealComponents() {
  return <div className="px-real">
    <div className="px-rail-host"><div className="project-rail"><SidebarPanels nodes={[noteNode]} types={types} selected={[noteNode.id]} sessions={{}} onJump={noop} onFocus={noop} onSearch={noop} onMap={noop} /></div></div>
    <div className="px-real-side">
      <ActivityNotch activity={activity} onToggle={noop} />
      <div className="px-object px-chat"><Panel><ChatCard {...demo} node={chatNode} /></Panel></div>
    </div>
  </div>;
}

export const MaterialEnComponentes = {
  args: { material: 'cenital' },
  argTypes: { material: radio(['todas', ...keys(MATERIALS)], 'Material') },
  render: ({ material }) => <Page title="Material en componentes" problem="La misma receta aplicada a SidebarPanels dentro de .project-rail, ActivityNotch y ChatCard, de producción, con sus props del catálogo.">
    {(material === 'todas' ? MATERIALS : MATERIALS.filter(([key]) => key === material)).map(([key, label, note]) => <Section key={key} label={`${label} · ${note}`}><Scene today={isHoy(key)}><OnCanvas material={key}><RealComponents /></OnCanvas></Scene></Section>)}
  </Page>,
};

/* ---------- 3. Controles ---------- */
const BUTTON_STATES = ['reposo', 'hover', 'deshabilitado'];
const FIELD_STATES = ['reposo', 'foco'];
function Field({ state, label = 'Buscar en la sesión' }) {
  const id = useId();
  return <div className="px-field" data-state={state}><label className="px-sr" htmlFor={id}>{label}</label><input id={id} placeholder="Escribe a la sesión…" /></div>;
}

export const Controles = {
  args: { boton: 'reposo', campo: 'reposo' },
  argTypes: { boton: radio(BUTTON_STATES, 'Botón icónico'), campo: radio(FIELD_STATES, 'Campo') },
  render: ({ boton, campo }) => <Page title="Controles" problem="Primitivas del compositor propuesto. El foco del campo solo aclara su aro de 1 px (8 % → 22 %); el foco de teclado de los botones conserva el outline de 2 px.">
    <Section label="Estados seleccionados">
      <Scene><div className="px-cell"><div className="px-row">
        <IconButton label="Adjuntar" icon={Plus} state={boton === 'hover' ? 'hover' : undefined} disabled={boton === 'deshabilitado'} />
        <ContextChip /><ModelChip /><IconButton label="Dictar" icon={Mic} /><Send />
      </div><LiveLine /><Field state={campo === 'foco' ? 'foco' : undefined} /></div></Scene>
    </Section>
    <Section label="Montados en la isla">
      <Scene><div className="px-well"><Composer variant="isla" state="reposo" /></div></Scene>
    </Section>
    <Section label="Comparativa">
      <Scene><div className="px-controls">
        {BUTTON_STATES.map(state => <div className="px-cell" key={state}><span>Icónico 36 px · {state}</span><IconButton label={`Adjuntar (${state})`} icon={Plus} state={state === 'hover' ? 'hover' : undefined} disabled={state === 'deshabilitado'} /></div>)}
        <div className="px-cell"><span>Enviar · con texto / sin texto</span><div className="px-row"><Send /><Send disabled /></div></div>
        <div className="px-cell"><span>Chip de contexto</span><ContextChip /></div>
        <div className="px-cell"><span>Chip modelo · effort</span><ModelChip /></div>
        <div className="px-cell"><span>Línea viva de estado</span><LiveLine /></div>
        {FIELD_STATES.map(state => <div className="px-cell" key={state}><span>Campo · {state}</span><Field state={state === 'foco' ? 'foco' : undefined} label={`Campo de ejemplo (${state})`} /></div>)}
      </div></Scene>
    </Section>
  </Page>,
};

/* ---------- 4. Compositor ---------- */
function Dictation() {
  return <div className="px-dictation">
    <div className="px-meter" role="group" aria-label="Dictando">
      <Mic size={16} aria-hidden="true" />
      <span className="px-bars" aria-hidden="true">{BARS.map((height, index) => <i key={index} style={{ '--h': `${height}%` }} />)}</span>
      <time>00:01</time><span className="px-tag">SYNTHETIC</span>
    </div>
    <IconButton label="Descartar dictado" icon={X} />
    <button type="button" className="px-send" aria-label="Terminar dictado"><Check size={18} strokeWidth={2} aria-hidden="true" /></button>
  </div>;
}

function Composer({ variant, state }) {
  const id = useId(), ref = useRef(null);
  const [text, setText] = useState(state === 'escribiendo' ? SAMPLE : '');
  const [tall, setTall] = useState(false);
  const working = state === 'trabajando', dictating = state === 'dictando', canSend = text.trim().length > 0;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    setTall(el.scrollHeight > 40);
  }, [text, variant, dictating]);
  const onKeyDown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSend) setText(''); } };
  const field = <><label className="px-sr" htmlFor={id}>Mensaje para la sesión</label><textarea id={id} ref={ref} className="px-textarea" rows={1} value={text} placeholder={working ? 'Añade instrucciones para la siguiente vuelta…' : 'Escribe a la sesión…'} onChange={event => setText(event.target.value)} onKeyDown={onKeyDown} /></>;
  const send = working && !canSend
    ? <button type="button" className="px-send" aria-label="Detener"><Square size={12} fill="currentColor" aria-hidden="true" /></button>
    : <Send disabled={!canSend} />;
  const attach = <IconButton label="Adjuntar" icon={Plus} />, mic = <IconButton label="Dictar" icon={Mic} />;
  const above = working ? <LiveLine /> : dictating ? <Hint /> : null;

  if (variant === 'banda') return <div className="px-composer" data-variant="banda">
    {dictating ? <Dictation /> : <div className="px-band-row">{attach}{field}{mic}{send}</div>}
    <div className="px-meta"><ContextChip /><ModelChip /><span className="px-spacer" />{above || <span>Enter envía · Mayús+Enter, salto de línea</span>}</div>
  </div>;
  if (variant === 'pildora') return <div className="px-composer" data-variant="pildora">
    {above}
    {dictating ? <Dictation /> : <div className="px-pill" data-tall={tall || undefined}>{attach}{field}<ModelChip />{mic}{send}</div>}
  </div>;
  return <div className="px-composer" data-variant="isla">
    {above}
    <div className="px-isle">
      {dictating ? <Dictation /> : <>{field}<div className="px-tools">{attach}<ContextChip /><span className="px-spacer" /><ModelChip />{mic}{send}</div></>}
    </div>
  </div>;
}

export const Compositor = {
  args: { compositor: 'isla', estado: 'reposo' },
  argTypes: { compositor: radio(keys(COMPOSERS), 'Compositor'), estado: radio(STATES, 'Estado') },
  render: ({ compositor, estado }) => <Page title="Compositor" problem="Tres propuestas funcionales: el texto crece hasta un máximo, enviar solo se habilita con texto y Enter no envía nada real. Una sola línea viva de estado; sin fila de contexto ni línea de compactación.">
    <Section label={`Seleccionado · ${compositor === 'isla' ? 'Isla · elegida' : `${compositor} · descartada`} · ${estado}`}><Scene><div className="px-well"><Composer key={`${compositor}-${estado}`} variant={compositor} state={estado} /></div></Scene></Section>
    <Section label={`Comparativa · ${estado}`}><Compare items={COMPOSERS} col="360px" render={key => <div className="px-well"><Composer key={`${key}-${estado}`} variant={key} state={estado} /></div>} /></Section>
  </Page>,
};

/* ---------- 5. Hilo ---------- */
function Thread({ message }) {
  return <div className="px-thread">
    <p className="px-user" data-variant={message}>¿Puedes unificar el dock y dejar las herramientas del lienzo abajo a la derecha?</p>
    <div className="px-prose">
      <p>Sí. Propongo un único dock píldora con el estado de Titi, «Nueva sesión» como acción primaria y las acciones de crear en círculos.</p>
      <p>Las herramientas del lienzo pasan a un grupo compacto junto al minimapa, con pistas de teclado <code>V</code>, <code>H</code> y <code>C</code>.</p>
    </div>
    <ol className="px-activity" aria-label="Actividad">
      <li><span className="px-dot"><FileText size={14} aria-hidden="true" /></span><span>Leyó <code>src/shell.css</code></span><time>0,4 s</time></li>
      <li><span className="px-dot"><PhantomGlyph size={14} aria-hidden="true" /></span><span>Phantom · Consultó la memoria del proyecto</span><time>1,2 s</time></li>
      <li><span className="px-dot"><Bot size={14} aria-hidden="true" /></span><span>Subagente · Revisó los estilos del dock</span><time>18 s</time></li>
    </ol>
    <p className="px-msg-meta">Opus 5.5 · 42 s · 0,18 US$ <span className="px-tag">SYNTHETIC</span></p>
  </div>;
}

export const Hilo = {
  args: { mensaje: 'cita' },
  argTypes: { mensaje: radio(keys(MESSAGES), 'Mensaje del usuario') },
  render: ({ mensaje }) => <Page title="Hilo" problem="Conversación en columna centrada de 720 px: mensaje del usuario, prosa, actividad con guía vertical sin anillo y metadatos discretos.">
    <Section label={`Mensaje seleccionado · ${mensaje}`}><Scene><div className="px-well"><Thread message={mensaje} /><Composer variant="isla" state="reposo" /></div></Scene></Section>
    <Section label="Comparativa"><Compare items={MESSAGES} col="480px" render={key => <div className="px-well"><Thread message={key} /></div>} /></Section>
  </Page>,
};

/* ---------- 6. Sesión ---------- */
const STATE_LABEL = { reposo: 'En espera', escribiendo: 'En espera', trabajando: 'Trabajando', dictando: 'Dictando' };
function Session({ material, composer = 'isla', message, state }) {
  return <div className="px-material" data-variant={material}><section className="px-object px-session" aria-label="Sesión propuesta">
    <header className="px-session-head">
      <span className="px-badge"><ClaudeGlyph size={16} aria-hidden="true" /></span>
      <h3>SYNTHETIC · Sesión v2</h3>
      <span className="px-state" data-tone={state === 'trabajando' ? 'working' : undefined}>{STATE_LABEL[state]}</span>
      <IconButton label="Más acciones" icon={Ellipsis} />
    </header>
    <div className="px-session-body">
      <div className="px-scroll"><Thread message={message} /></div>
      <Composer key={`${composer}-${state}`} variant={composer} state={state} />
    </div>
  </section></div>;
}

export const Sesion = {
  args: { material: 'cenital', mensaje: 'cita', estado: 'reposo' },
  argTypes: { material: radio(keys(MATERIALS), 'Material'), mensaje: radio(keys(MESSAGES), 'Mensaje'), estado: radio(STATES, 'Estado') },
  render: ({ material, mensaje, estado }) => <Page title="Sesión" problem="Panel completo a tamaño real con el compositor isla elegido: material, mensaje y estado se combinan desde Controls.">
    <Section label={`${material} · isla · ${mensaje} · ${estado}`}><Scene><div className="px-canvas"><Session material={material} message={mensaje} state={estado} /></div></Scene></Section>
  </Page>,
};

/* ---------- 7. Dock ---------- */
const CREATE = [['Nueva terminal', SquareTerminal], ['Nueva nota', StickyNote], ['Nuevo navegador', Globe]];
const MODES = [['select', 'Seleccionar', MousePointer2, 'V'], ['hand', 'Mano', Hand, 'H'], ['comment', 'Comentario', MessageSquare, 'C']];
function Attention({ short }) {
  return <span className="px-attn"><CircleAlert size={14} aria-hidden="true" />{short ? '2' : '2 piden atención'}</span>;
}
function DockToday() {
  return <div className="px-stage">
    <div className="px-object px-notch"><Attention /></div>
    <div className="px-dockstack">
      <div className="px-object px-bar" role="toolbar" aria-label="Herramientas del lienzo (hoy)">
        {MODES.map(([key, label, icon]) => <IconButton key={key} label={label} icon={icon} />)}
        <span className="px-vsep" /><IconButton label="Alejar" icon={Minus} /><span className="px-zoom">79 %</span><IconButton label="Acercar" icon={Plus} /><IconButton label="Encuadrar" icon={Scan} />
        <span className="px-vsep" /><Attention short />
      </div>
      <div className="px-object px-bar px-dock" role="toolbar" aria-label="Dock (hoy)">
        <span className="px-identity"><PhantomGlyph size={16} aria-hidden="true" /></span><Attention short />
        <button type="button" className="px-btn is-primary"><Plus size={16} aria-hidden="true" />Nueva sesión</button>
        {CREATE.map(([label, icon]) => <IconButton key={label} label={label} icon={icon} />)}
        <IconButton label="Más" icon={Ellipsis} />
      </div>
    </div>
  </div>;
}
function DockUnified() {
  const [mode, setMode] = useState('select');
  return <div className="px-stage" data-layout="unificado">
    <div className="px-dockstack">
      <div className="px-object px-bar px-dock" role="toolbar" aria-label="Dock unificado">
        <span className="px-identity"><PhantomGlyph size={16} aria-hidden="true" /></span>
        <span className="px-status"><strong>2 piden atención</strong><small>Titi · 3 sesiones</small></span>
        <button type="button" className="px-btn is-primary"><Plus size={16} aria-hidden="true" />Nueva sesión</button>
        {CREATE.map(([label, icon]) => <IconButton key={label} label={label} icon={icon} />)}
        <span className="px-vsep" /><IconButton label="Más" icon={Ellipsis} />
      </div>
    </div>
    <div className="px-canvas-group">
      <div className="px-object px-minimap" role="img" aria-label="Minimapa de muestra">
        <i style={{ left: 24, top: 20, width: 48, height: 32 }} /><i style={{ left: 88, top: 40, width: 64, height: 40 }} /><i style={{ left: 40, top: 76, width: 40, height: 28 }} /><i style={{ left: 136, top: 88, width: 40, height: 24 }} /><b />
      </div>
      <div className="px-object px-bar" role="toolbar" aria-label="Lienzo">
        <div className="px-seg" role="group" aria-label="Modo del lienzo">
          {MODES.map(([key, label, Icon, hint]) => <button type="button" key={key} aria-label={`${label} (${hint})`} aria-pressed={mode === key} onClick={() => setMode(key)}><Icon size={16} aria-hidden="true" /><kbd>{hint}</kbd></button>)}
        </div>
        <IconButton label="Alejar" icon={Minus} /><span className="px-zoom">79 %</span><IconButton label="Acercar" icon={Plus} /><IconButton label="Encuadrar" icon={Scan} />
      </div>
    </div>
  </div>;
}
const DOCKS = [['unificado', 'Unificado', 'Un dock centrado y el lienzo junto al minimapa'], ['hoy', 'Hoy', 'Dos barras apiladas; la atención aparece tres veces']];
const dockView = key => key === 'hoy' ? <DockToday /> : <DockUnified />;

export const Dock = {
  render: () => <Page title="Dock" problem="Hoy las herramientas del lienzo se apilan encima del dock y la atención aparece tres veces. La propuesta deja un solo dock y un grupo compacto de lienzo abajo a la derecha.">
    <Section label="Propuesta frente a hoy"><Compare items={DOCKS} col="100%" isToday={isHoy} render={dockView} /></Section>
  </Page>,
};

/* ---------- 8. Cabecera del rail ---------- */
const SESSIONS = [['Refactor del dock', 'Trabajando · 2 min', Bot], ['Revisión de estilos', 'Terminó · 14 min', SquareTerminal], ['Notas del sprint', 'Nota · ayer', StickyNote]];
function SessionRows() {
  return SESSIONS.map(([title, meta, Icon]) => <li key={title}><button type="button" className="px-rail-row is-detail"><span className="px-mark"><Icon size={16} aria-hidden="true" /></span><span><strong>{title}</strong><small>{meta}</small></span></button></li>);
}
function RailToday() {
  return <nav className="px-object px-rail" aria-label="Rail (hoy)">
    <div className="px-rail-brand"><span className="px-identity"><PhantomGlyph size={16} aria-hidden="true" /></span>Phantom</div>
    <button type="button" className="px-rail-row"><span className="px-initials">TF</span><span>taller-fantasma</span><ChevronsUpDown size={16} aria-hidden="true" /></button>
    <button type="button" className="px-rail-row is-select"><span>Principal</span><ChevronDown size={16} aria-hidden="true" /></button>
    <button type="button" className="px-rail-row is-quiet"><Check size={16} aria-hidden="true" /><span>Todo en orden</span></button>
    <div className="px-rail-group"><ul><SessionRows /></ul></div>
  </nav>;
}
function RailCompact() {
  return <nav className="px-object px-rail" aria-label="Rail compacto">
    <button type="button" className="px-rail-row is-select" aria-label="Proyecto y espacio: taller-fantasma / Principal"><span className="px-initials">TF</span><span>taller-fantasma <span className="px-crumb-sep">/</span> Principal</span><ChevronsUpDown size={16} aria-hidden="true" /></button>
    <div className="px-rail-group"><ul>
      <li><button type="button" className="px-rail-row is-quiet"><Check size={16} aria-hidden="true" /><span>Todo en orden</span></button></li>
      <SessionRows />
    </ul></div>
  </nav>;
}
const RAILS = [['compacto', 'Compacto', 'Un selector y la atención como primera fila · SYNTHETIC'], ['hoy', 'Hoy', 'Cuatro niveles antes de la lista · SYNTHETIC']];
const railView = key => <div className="px-canvas">{key === 'hoy' ? <RailToday /> : <RailCompact />}</div>;

export const RailCabecera = {
  render: () => <Page title="Cabecera del rail" problem="Marca, proyecto, espacio y estado ocupan cuatro niveles antes de la primera sesión. La versión compacta los reduce a un selector y una fila.">
    <Section label="Propuesta frente a hoy"><Compare items={RAILS} col="320px" isToday={isHoy} render={railView} /></Section>
  </Page>,
};
