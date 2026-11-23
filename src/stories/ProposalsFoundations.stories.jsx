import React, { useRef, useState } from 'react';
import { Copy, Inbox, Pencil, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import AsciiField from '../components/AsciiField';
import PixelField from '../components/PixelField';
import EmptyState from '../components/EmptyState.jsx';
import ActivityNotch from '../components/ActivityNotch';
import * as Glyphs from '../components/Glyphs';
import { ProjectMark } from '../components/ProjectSwitcher';
import * as P from '../components/PluginPrimitives';
import { Button as ToolButton, Field as ToolField } from '../components/ToolPanels';
import { activity, workspace, noop } from './fixtures';
import { BeforeAfter, Page, Section, Stage, After, Specimen, MATERIALS, materialArg } from './proposals-kit';
import './proposals-foundations.css';

export default {
  title: 'Propuestas/Fundamentos',
  args: { material: 'cenital' },
  argTypes: { material: materialArg },
  parameters: { docs: { description: { component: 'Laboratorio exploratorio: fundamentos reales de hoy (fondos, material, tinta, insignias, botones, campos, selectores, menús y estados vacíos) frente a la propuesta. No cambia producción. Datos SYNTHETIC.' } } },
};

/* ---------- Fondos ---------- */
function Ambient() {
  return <div className="px-fd-ambient">
    <div className="px-fd-canvas"><span className="px-fd-cap">Lienzo y retícula</span><Specimen /></div>
  </div>;
}
function Ascii() {
  return <div className="px-fd-bg"><div className="catalog-background"><AsciiField paused /><p>Campo ASCII de producción</p></div></div>;
}
function Pixels() {
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 }), paintRef = useRef(null);
  return <div className="px-fd-bg"><div className="catalog-background"><PixelField cameraRef={cameraRef} paintRef={paintRef} targets={[{ id: 'pixel-demo', x: 150, y: 150, width: 300, height: 200, kind: 'work' }]} /><p>Pulso de trabajo SYNTHETIC</p></div></div>;
}

export const Fondos = {
  render: ({ material }) => <Page title="Fondos" problem="El lienzo, la retícula y los objetos tienen luminancias muy próximas: en pantallas oscuras el objeto se funde con el fondo y los campos ASCII y de píxeles compiten con el contenido.">
    <Section label="Lienzo, retícula y ambiente">
      <BeforeAfter height={420} material={material} before={<Ambient />} after={<Ambient />} changes={[
        'Lienzo casi negro (#070709) y retícula de puntos un poco más tenue.',
        'El objeto usa el material cenital: más claro arriba y brillo del 6 %, con más separación del lienzo.',
        'Misma caja y mismos datos SYNTHETIC en ambas columnas.',
      ]} />
    </Section>
    <Section label="Campo ASCII real">
      <BeforeAfter height={360} material={material} before={<Ascii />} after={<Ascii />} changes={[
        'AsciiField real, sin cambios de lógica: se atenúa al 55 % para quedar detrás de los objetos.',
      ]} />
    </Section>
    <Section label="Campo de píxeles real">
      <BeforeAfter height={360} material={material} before={<Pixels />} after={<Pixels />} changes={[
        'PixelField real atenuado al 55 %; el pulso de trabajo sigue visible pero no compite con el texto.',
      ]} />
    </Section>
  </Page>,
};

/* ---------- Material ---------- */
const notch = () => <div className="px-fd-dock"><div className="create-dock activity-dock"><ActivityNotch activity={activity} open={false} onToggle={noop} /></div></div>;

export const Material = {
  render: ({ material }) => <Page title="Material" problem="Los objetos de hoy usan un relleno plano casi igual al lienzo; cada componente resuelve su contorno por su cuenta.">
    <Section label="Caja-objeto">
      <BeforeAfter height={340} material={material} before={<Specimen />} after={<Specimen />} changes={[
        'Una sola receta de material por custom properties (--object-top, --object-bottom, --object-fill, --object-ring).',
        'Cenital por defecto; el control «Material» permite ver hoy, grafito y borde.',
      ]} />
    </Section>
    <Section label="Componente real: muesca de actividad">
      <BeforeAfter height={240} material={material} before={notch()} after={notch()} changes={[
        'ActivityNotch real con el material del objeto en vez del vidrio grueso.',
        'Sin contorno propio: el aro lo pone el material (solo visible en la variante «borde»).',
      ]} />
    </Section>
    <Section label="Las cuatro variantes">
      <div className="px-fd-variants">
        {MATERIALS.map(([key, name, note]) => <figure key={key}>
          <Stage height={320}><After material={key}><Specimen /></After></Stage>
          <figcaption><strong>{name}</strong><span>{note}</span></figcaption>
        </figure>)}
      </div>
    </Section>
  </Page>,
};

/* ---------- Tinta ---------- */
const ROLES = [['display', 'Display', 'Sesiones'], ['title', 'Título', 'Refactor del dock'], ['body', 'Cuerpo', 'Propón el orden de las acciones de crear.'], ['support', 'Apoyo', 'Trabajando · 2 min'], ['micro', 'Micro', 'SYNTHETIC'], ['mono', 'Mono', 'src/shell.css']];
function InkSet({ surface }) {
  return <div className="px-fd-inkset" data-surface={surface}>
    <span className="px-fd-cap">{surface === 'lienzo' ? 'Sobre lienzo' : surface === 'objeto' ? 'Sobre objeto' : 'Sobre pozo'}</span>
    <div className="px-fd-scale"><span data-ink="ink">--ink</span><span data-ink="muted">--muted</span><span data-ink="ink-3">--ink-3</span></div>
    {ROLES.map(([role, name, sample]) => <p key={role} className="px-fd-role" data-role={role}><small>{name}</small><span>{sample}</span></p>)}
  </div>;
}
const inks = () => <div className="px-fd-inks"><InkSet surface="lienzo" /><InkSet surface="objeto" /><InkSet surface="pozo" /></div>;

export const Tinta = {
  render: ({ material }) => <Page title="Tinta" problem="--ink-3 se usa para metadatos que hay que leer y sobre el pozo del terminal queda por debajo del contraste cómodo; los roles tipográficos se mezclan con pesos intermedios.">
    <BeforeAfter stacked height={460} material={material} before={inks()} after={inks()} changes={[
      'Escala de tres tintas sin cambios de valor: --ink para contenido, --muted para apoyo, --ink-3 solo para decoración (etiquetas SYNTHETIC, separadores).',
      'Los textos de apoyo pasan de --ink-3 a --muted en objeto y pozo.',
      'Pesos limitados a 400/500/600: título en 600, controles en 500.',
      'El objeto hereda el material propuesto; el pozo no cambia.',
    ]} />
  </Page>,
};

/* ---------- Insignias ---------- */
const PROVIDERS = ['claude', 'opencode', 'codex', 'shell'];
const MARKS = ['PhantomGlyph', 'ClaudeGlyph', 'OpenCodeGlyph', 'CodexGlyph', 'ShellGlyph', 'AgentGlyph'];
function Badges() {
  return <div className="px-fd-badges">
    <div className="px-fd-row">{PROVIDERS.map(provider => <figure key={provider}><Glyphs.ProviderTile provider={provider} /><figcaption>{provider}</figcaption></figure>)}<figure><ProjectMark project={workspace} /><figcaption>proyecto</figcaption></figure></div>
    <div className="px-fd-row">{MARKS.map(name => { const Icon = Glyphs[name]; return <figure key={name}><span className="px-fd-glyph"><Icon size={16} aria-hidden="true" /></span><figcaption>{name.replace('Glyph', '')}</figcaption></figure>; })}</div>
  </div>;
}

export const Insignias = {
  render: ({ material }) => <Page title="Insignias" problem="Cada proveedor trae su propio fondo y tamaño de mosaico; la marca de proyecto es cuadrada y los glifos sueltos no tienen soporte común.">
    <BeforeAfter height={300} material={material} before={<Badges />} after={<Badges />} changes={[
      'Insignias circulares de 32 px con un único fondo tonal estable (--control-fill) y glifo de 16 px.',
      'La identidad del proveedor la lleva el glifo, no el color de fondo.',
      'La marca de proyecto adopta el mismo círculo de 32 px.',
    ]} />
  </Page>,
};

/* ---------- Botones ---------- */
function Buttons() {
  return <div className="px-fd-stack">
    <div className="px-fd-group"><span className="px-fd-cap">PluginPrimitives</span><div className="px-fd-row"><P.Button tone="primary">Guardar</P.Button><P.Button>Cancelar</P.Button><P.Button disabled>Deshabilitado</P.Button></div></div>
    <div className="px-fd-group"><span className="px-fd-cap">ToolPanels</span><div className="px-fd-row"><ToolButton tone="primary">Guardar</ToolButton><ToolButton>Cancelar</ToolButton><ToolButton disabled>Deshabilitado</ToolButton></div></div>
    <div className="px-fd-group"><span className="px-fd-cap">Iconos y fantasma</span><div className="px-fd-row">
      <button type="button" className="icon-button" aria-label="Añadir"><Plus size={16} /></button>
      <button type="button" className="icon-button" aria-label="Configuración"><Settings2 size={16} /></button>
      <button type="button" className="icon-button" aria-label="Cerrar" disabled><X size={16} /></button>
      <button type="button" className="button" aria-label="Editar">Editar</button>
    </div></div>
    <p className="px-fd-hint">Pulsa Tab para ver el foco.</p>
  </div>;
}

export const Botones = {
  render: ({ material }) => <Page title="Botones" problem="PluginPrimitives y ToolPanels pintan botones distintos con el mismo nombre; radios, alturas y pesos cambian según el panel.">
    <BeforeAfter height={420} material={material} before={<Buttons />} after={<Buttons />} changes={[
      'Un solo botón: píldora de 36 px, peso 500, sin borde; primaria marfil var(--on).',
      'Secundaria tonal (--control-fill); iconos en círculo plano de 36 px sin fondo en reposo.',
      'Deshabilitado sin relleno y en --ink-3; foco con contorno marfil de 2 px.',
      'Propone unificar Button de PluginPrimitives y ToolPanels en una primitiva compartida.',
    ]} />
  </Page>,
};

/* ---------- Campos ---------- */
function Fields() {
  return <div className="px-fd-stack px-fd-fields">
    <P.Field label="Nombre de la sesión"><input defaultValue="Refactor del dock (SYNTHETIC)" /></P.Field>
    <P.Field label="Con error" hint="El nombre ya existe."><input defaultValue="Duplicado (SYNTHETIC)" aria-invalid="true" /></P.Field>
    <ToolField label="Instrucciones"><textarea rows={3} defaultValue="Revisa el dock unificado. SYNTHETIC" /></ToolField>
    <P.Field label="Búsqueda"><input type="search" placeholder="Buscar en el proyecto…" /></P.Field>
    <p className="px-fd-hint">Pulsa Tab para ver el foco.</p>
  </div>;
}

export const Campos = {
  render: ({ material }) => <Page title="Campos" problem="Los campos de hoy dibujan un borde completo y, al enfocar, un anillo grueso; el error solo cambia el color del borde.">
    <BeforeAfter height={520} material={material} before={<Fields />} after={<Fields />} changes={[
      'Campo de 40 px con relleno 3 % y aro de 1 px que solo se aclara al enfocar; sin anillo grueso.',
      'Error: aro de 1 px en color de peligro y la pista debajo en el mismo tono.',
      'Etiqueta en apoyo --muted encima; textarea y búsqueda comparten la misma receta.',
    ]} />
  </Page>,
};

/* ---------- Selectores ---------- */
function Selectors() {
  const [on, setOn] = useState(true), [mode, setMode] = useState('uno'), [pick, setPick] = useState('a');
  return <div className="px-fd-stack">
    <P.Group title="Controles de plugins">
      <P.Row label="Activar ejemplo"><P.Switch label="Activar ejemplo" checked={on} onChange={setOn} /></P.Row>
      <P.Row label="Desactivado"><P.Switch label="Desactivado" checked={false} onChange={noop} disabled /></P.Row>
      <P.Row label="Modo"><P.Segmented label="Modo de ejemplo" value={mode} options={[['uno', 'Uno'], ['dos', 'Dos'], ['tres', 'Tres']]} onChange={setMode} /></P.Row>
    </P.Group>
    <fieldset className="px-fd-radios"><legend>Esfuerzo (radio nativo)</legend>
      {[['a', 'Bajo'], ['b', 'Medio'], ['c', 'Alto']].map(([id, name]) => <label key={id}><input type="radio" name="px-fd-effort" checked={pick === id} onChange={() => setPick(id)} />{name}</label>)}
    </fieldset>
  </div>;
}

export const Selectores = {
  render: ({ material }) => <Page title="Selectores" problem="Switch, segmentado y radio usan rellenos y contornos distintos; el radio es el nativo del navegador.">
    <BeforeAfter height={420} material={material} before={<Selectors />} after={<Selectors />} changes={[
      'Switch de 40×24 sin contorno: tonal apagado, marfil encendido.',
      'Segmentado en píldora de 36 px con la opción activa en marfil.',
      'Radio de 20 px dibujado con aros (inset) en vez del control nativo.',
      'Mismos componentes reales P.Switch y P.Segmented.',
    ]} />
  </Page>,
};

/* ---------- Menús ---------- */
function Menu() {
  return <div className="px-fd-menu">
    <div className="context-menu" role="menu" aria-label="Acciones del panel">
      <button type="button" role="menuitem"><Pencil size={15} />Renombrar</button>
      <button type="button" role="menuitem"><Copy size={15} />Duplicar</button>
      <button type="button" role="menuitem"><Search size={15} />Buscar en el panel</button>
      <div className="px-fd-sep" role="separator" />
      <button type="button" role="menuitem" className="danger"><Trash2 size={15} />Eliminar</button>
    </div>
  </div>;
}

export const Menus = {
  render: ({ material }) => <Page title="Menús" problem="El menú contextual usa vidrio grueso distinto del material de los objetos y filas de 30 px con radio de control.">
    <BeforeAfter height={320} material={material} before={<Menu />} after={<Menu />} changes={[
      'El menú usa el material del objeto y la sombra de cromo.',
      'Filas de 36 px con realce tonal de radio 12, sin anillos.',
      'Divisor de 1 px como fondo, no como borde.',
      'Maqueta con las clases reales de .context-menu: el menú solo se monta desde App.',
    ]} />
  </Page>,
};

/* ---------- Estados vacíos ---------- */
const empty = () => <div className="px-fd-empty"><EmptyState icon={Inbox} title="Sin sesiones" description="Crea una sesión para empezar a trabajar en este espacio." actions={<P.Button tone="primary">Nueva sesión</P.Button>} hint="SYNTHETIC" /></div>;

export const EstadosVacios = {
  render: ({ material }) => <Page title="Estados vacíos" problem="El estado vacío apila icono con contorno, título, descripción y acción con pesos parecidos.">
    <BeforeAfter height={380} material={material} before={empty()} after={empty()} changes={[
      'EmptyState real: icono en círculo tonal de 48 px sin contorno.',
      'Título en rol title y descripción en --muted, columna de 360 px.',
      'La acción usa el botón unificado (primaria marfil de 36 px).',
    ]} />
  </Page>,
};
