import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Check, ChevronDown, ChevronsUpDown, CircleAlert, Ellipsis, FileText, Folder, Globe, Hand, MessageSquare, Mic, Minus, MousePointer2, Plus, Scan, Square, SquareTerminal, StickyNote, X } from 'lucide-react';
import { PhantomGlyph, ClaudeGlyph } from '../components/Glyphs';
import './proposals-kit.css';

/* ---------- Página ---------- */
export function Page({ title, problem, children }) {
  return <div className="px-page"><header className="px-head"><h2>{title}</h2><p>{problem}</p></header>{children}</div>;
}
export function Section({ label, children }) {
  return <section className="px-section"><h3 className="px-label">{label}</h3>{children}</section>;
}
export function Tag({ today }) {
  return today ? <span className="px-pilltag" data-kind="hoy">HOY · así está la app</span> : <span className="px-pilltag" data-kind="propuesta">PROPUESTA · nuevo</span>;
}

const STATUS = { cambia: 'Cambia', material: 'Solo material', igual: 'Sin cambio' };
export function Status({ kind }) {
  return <span className="px-status-chip" data-kind={kind}>{STATUS[kind]}</span>;
}

/* ---------- Material ---------- */
export const MATERIALS = [['hoy', 'Hoy', 'Tokens actuales'], ['cenital', 'Cenital', '#19191d → #0d0d10 y brillo 6 %'], ['grafito', 'Grafito', 'Tinte frío, más claro arriba'], ['borde', 'Borde', 'Aro 34 % → 8 %']];
export const materialArg = { control: 'inline-radio', options: MATERIALS.map(([key]) => key), name: 'Material', table: { defaultValue: { summary: 'cenital' } } };

export function Before({ children }) {
  return <div className="px-before">{children}</div>;
}
export function After({ material = 'cenital', children }) {
  return <div className="px-after px-material" data-variant={material}>{children}</div>;
}
export function Stage({ children, height, canvas = true, contain }) {
  return <div className="px-stage" data-canvas={canvas ? undefined : 'off'} data-contain={contain || undefined} style={height ? { height } : undefined}>{children}</div>;
}
export function BeforeAfter({ before, after, changes = [], stacked, height, material, contain }) {
  return <div className="px-ba" data-stacked={stacked || undefined}>
    <div className="px-ba-cols">
      <div className="px-ba-col"><Tag today /><Stage height={height} contain={contain}><Before>{before}</Before></Stage></div>
      <div className="px-ba-col"><Tag /><Stage height={height} contain={contain}><After material={material}>{after}</After></Stage></div>
    </div>
    <Section label="Qué cambia">
      {changes.length ? <ul className="px-changes">{changes.map(item => <li key={item}>{item}</li>)}</ul> : <p className="px-nochange">Sin cambios de estructura: solo hereda el material</p>}
    </Section>
  </div>;
}

export function Specimen() {
  return <article className="px-object px-specimen">
    <header><h3>Sesiones activas</h3><span className="px-tag">SYNTHETIC</span></header>
    <ul className="px-rows">
      <li><span className="px-mark"><Bot size={16} aria-hidden="true" /></span><div><strong>Refactor del dock</strong><small>Trabajando · 1 subagente</small></div><time>2 min</time></li>
      <li><span className="px-mark"><SquareTerminal size={16} aria-hidden="true" /></span><div><strong>Terminal de pruebas</strong><small>Terminó</small></div><time>14 min</time></li>
    </ul>
    <button type="button" className="px-btn is-primary">Nueva sesión</button>
  </article>;
}

/* ---------- Controles ---------- */
export function IconButton({ label, icon: Icon, state, disabled }) {
  return <button type="button" className="px-btn px-icon" aria-label={label} data-state={state} disabled={disabled}><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></button>;
}
export function Send({ disabled }) {
  return <button type="button" className="px-send" aria-label="Enviar" disabled={disabled}><ArrowUp size={18} strokeWidth={2} aria-hidden="true" /></button>;
}
export function ContextChip() {
  return <button type="button" className="px-chip px-ctx" aria-label="Contexto: taller-fantasma"><Folder size={14} aria-hidden="true" /><span className="px-chip-text">taller-fantasma</span></button>;
}
export function ModelChip() {
  return <button type="button" className="px-chip has-chevron" aria-label="Modelo y esfuerzo: Opus 5.5 · alto"><span className="px-chip-text">Opus 5.5 · alto</span><ChevronDown size={14} aria-hidden="true" /></button>;
}
export function LiveLine() {
  return <p className="px-live" role="status"><span className="px-spinner" aria-hidden="true" /><strong>Trabajando</strong><span>· 1 subagente</span></p>;
}
export function Hint() {
  return <p className="px-live">Esc descarta · Enter envía</p>;
}
export function Field({ state, label = 'Buscar en la sesión' }) {
  const id = useId();
  return <div className="px-field" data-state={state}><label className="px-sr" htmlFor={id}>{label}</label><input id={id} placeholder="Escribe a la sesión…" /></div>;
}

/* ---------- Compositor isla ---------- */
const SAMPLE = 'Revisa el dock unificado y propón el orden de las acciones de crear. Mantén el lienzo abajo a la derecha.';
const BARS = [24, 40, 64, 88, 56, 72, 36, 92, 68, 32, 52, 80, 44, 28, 60, 84, 36, 48, 24, 40];

export function Dictation() {
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

export function Composer({ state = 'reposo' }) {
  const id = useId(), ref = useRef(null);
  const [text, setText] = useState(state === 'escribiendo' ? SAMPLE : '');
  const working = state === 'trabajando', dictating = state === 'dictando', canSend = text.trim().length > 0;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, dictating]);
  const onKeyDown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSend) setText(''); } };
  const send = working && !canSend
    ? <button type="button" className="px-send" aria-label="Detener"><Square size={12} fill="currentColor" aria-hidden="true" /></button>
    : <Send disabled={!canSend} />;
  return <div className="px-composer">
    {working ? <LiveLine /> : dictating ? <Hint /> : null}
    <div className="px-isle">
      {dictating ? <Dictation /> : <>
        <label className="px-sr" htmlFor={id}>Mensaje para la sesión</label>
        <textarea id={id} ref={ref} className="px-textarea" rows={1} value={text} placeholder={working ? 'Añade instrucciones para la siguiente vuelta…' : 'Escribe a la sesión…'} onChange={event => setText(event.target.value)} onKeyDown={onKeyDown} />
        <div className="px-tools"><IconButton label="Adjuntar" icon={Plus} /><ContextChip /><span className="px-spacer" /><ModelChip /><IconButton label="Dictar" icon={Mic} />{send}</div>
      </>}
    </div>
  </div>;
}

/* ---------- Hilo ---------- */
export function Thread({ message = 'cita' }) {
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

/* ---------- Sesión ---------- */
const STATE_LABEL = { reposo: 'En espera', escribiendo: 'En espera', trabajando: 'Trabajando', dictando: 'Dictando' };
export function Session({ material = 'cenital', message = 'cita', state = 'reposo' }) {
  return <div className="px-material" data-variant={material}><section className="px-object px-session" aria-label="Sesión propuesta">
    <header className="px-session-head">
      <span className="px-badge"><ClaudeGlyph size={16} aria-hidden="true" /></span>
      <h3>SYNTHETIC · Sesión v2</h3>
      <span className="px-state" data-tone={state === 'trabajando' ? 'working' : undefined}>{STATE_LABEL[state]}</span>
      <IconButton label="Más acciones" icon={Ellipsis} />
    </header>
    <div className="px-session-body">
      <div className="px-scroll"><Thread message={message} /></div>
      <Composer key={state} state={state} />
    </div>
  </section></div>;
}

/* ---------- Dock y herramientas del lienzo ---------- */
const CREATE = [['Nueva terminal', SquareTerminal], ['Nueva nota', StickyNote], ['Nuevo navegador', Globe]];
const MODES = [['select', 'Seleccionar', MousePointer2, 'V'], ['hand', 'Mano', Hand, 'H'], ['comment', 'Comentario', MessageSquare, 'C']];
function Attention({ short }) {
  return <span className="px-attn"><CircleAlert size={14} aria-hidden="true" />{short ? '2' : '2 piden atención'}</span>;
}
export function DockToday() {
  return <div className="px-dockstage">
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
export function CanvasTools() {
  const [mode, setMode] = useState('select');
  return <div className="px-canvas-group">
    <div className="px-object px-minimap" role="img" aria-label="Minimapa de muestra">
      <i style={{ left: 24, top: 20, width: 48, height: 32 }} /><i style={{ left: 88, top: 40, width: 64, height: 40 }} /><i style={{ left: 40, top: 76, width: 40, height: 28 }} /><i style={{ left: 136, top: 88, width: 40, height: 24 }} /><b />
    </div>
    <div className="px-object px-bar" role="toolbar" aria-label="Lienzo">
      <div className="px-seg" role="group" aria-label="Modo del lienzo">
        {MODES.map(([key, label, Icon, hint]) => <button type="button" key={key} aria-label={`${label} (${hint})`} aria-pressed={mode === key} onClick={() => setMode(key)}><Icon size={16} aria-hidden="true" /><kbd>{hint}</kbd></button>)}
      </div>
      <IconButton label="Alejar" icon={Minus} /><span className="px-zoom">79 %</span><IconButton label="Acercar" icon={Plus} /><IconButton label="Encuadrar" icon={Scan} />
    </div>
  </div>;
}
export function DockUnified() {
  return <div className="px-dockstage" data-layout="unificado">
    <div className="px-dockstack">
      <div className="px-object px-bar px-dock" role="toolbar" aria-label="Dock unificado">
        <span className="px-identity"><PhantomGlyph size={16} aria-hidden="true" /></span>
        <span className="px-status"><strong>2 piden atención</strong><small>Titi · 3 sesiones</small></span>
        <button type="button" className="px-btn is-primary"><Plus size={16} aria-hidden="true" />Nueva sesión</button>
        {CREATE.map(([label, icon]) => <IconButton key={label} label={label} icon={icon} />)}
        <span className="px-vsep" /><IconButton label="Más" icon={Ellipsis} />
      </div>
    </div>
    <CanvasTools />
  </div>;
}

/* ---------- Rail ---------- */
const SESSIONS = [['Refactor del dock', 'Trabajando · 2 min', Bot], ['Revisión de estilos', 'Terminó · 14 min', SquareTerminal], ['Notas del sprint', 'Nota · ayer', StickyNote]];
function SessionRows() {
  return SESSIONS.map(([title, meta, Icon]) => <li key={title}><button type="button" className="px-rail-row is-detail"><span className="px-mark"><Icon size={16} aria-hidden="true" /></span><span><strong>{title}</strong><small>{meta}</small></span></button></li>);
}
export function RailToday() {
  return <nav className="px-object px-rail" aria-label="Rail (hoy)">
    <div className="px-rail-brand"><span className="px-identity"><PhantomGlyph size={16} aria-hidden="true" /></span>Phantom</div>
    <button type="button" className="px-rail-row"><span className="px-initials">TF</span><span>taller-fantasma</span><ChevronsUpDown size={16} aria-hidden="true" /></button>
    <button type="button" className="px-rail-row is-select"><span>Principal</span><ChevronDown size={16} aria-hidden="true" /></button>
    <button type="button" className="px-rail-row is-quiet"><Check size={16} aria-hidden="true" /><span>Todo en orden</span></button>
    <div className="px-rail-group"><ul><SessionRows /></ul></div>
  </nav>;
}
export function RailCompact() {
  return <nav className="px-object px-rail" aria-label="Rail compacto">
    <button type="button" className="px-rail-row is-select" aria-label="Proyecto y espacio: taller-fantasma / Principal"><span className="px-initials">TF</span><span>taller-fantasma <span className="px-crumb-sep">/</span> Principal</span><ChevronsUpDown size={16} aria-hidden="true" /></button>
    <div className="px-rail-group"><ul>
      <li><button type="button" className="px-rail-row is-quiet"><Check size={16} aria-hidden="true" /><span>Todo en orden</span></button></li>
      <SessionRows />
    </ul></div>
  </nav>;
}
