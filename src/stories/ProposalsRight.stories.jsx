import React, { useEffect, useRef, useState } from 'react';
import Settings from '../components/Settings';
import { Appearance } from '../components/Appearance';
import ActivityNotch, { ActivityTray } from '../components/ActivityNotch';
import ToolPicker from '../components/ToolPicker';
import { CommandPalette } from '../components/CommandPalette';
import { Inspector as InspectorPanel } from '../components/Inspector';
import { VoiceActivity, VoiceTranscript, dictationPreview } from '../components/VoiceActivity';
import { VoiceDictation } from '../components/VoiceDictation';
import { NoteIcon, TerminalIcon } from '../components/ShellIcons';
import { demo, Panel } from './decorators';
import { workspace, noop, activity, appearance } from './fixtures';
import { BeforeAfter, Page, Section, materialArg } from './proposals-kit';
import './proposals-right.css';

export default {
  title: 'Propuestas/Derecha',
  args: { material: 'cenital' },
  argTypes: { material: materialArg },
  parameters: { docs: { description: { component: 'Laboratorio exploratorio: lado derecho y superposiciones reales de hoy (inspector, ajustes, bandeja, muesca, paleta, herramientas y voz) frente a la propuesta. No cambia producción. Datos SYNTHETIC.' } } },
};

const H = 720;
const types = [['note', 'Nota', NoteIcon, 'Contexto de texto', 'space'], ['terminal', 'Terminal', TerminalIcon, 'Sesión local', 'space']];
/* Contenedor con transform: ancla dentro del escenario los overlays fijos. */
const Host = ({ children }) => <div className="px-right-host">{children}</div>;
/* Los modales reales se montan con createPortal en <body>: se copia su DOM (inerte) dentro del escenario y se oculta el original, para ver dos copias. */
function Contained({ selector, children }) {
  const ref = useRef(null);
  useEffect(() => {
    let clone = null, original = null;
    const frame = requestAnimationFrame(() => {
      original = [...document.body.querySelectorAll(`:scope > ${selector}`)].find(node => !node.dataset.pxTaken) || null;
      if (!original || !ref.current) return;
      original.dataset.pxTaken = 'true';
      clone = original.cloneNode(true);
      delete clone.dataset.pxTaken;
      clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      clone.setAttribute('inert', '');
      clone.setAttribute('aria-hidden', 'true');
      ref.current.appendChild(clone);
      original.style.display = 'none';
    });
    return () => { cancelAnimationFrame(frame); clone?.remove(); if (original) { original.style.display = ''; delete original.dataset.pxTaken; } };
  }, [selector]);
  return <div ref={ref} className="px-right-host">{children}</div>;
}

/* ---------- Inspector ---------- */
const inspector = () => <Host><InspectorPanel {...demo} tab="playground" /></Host>;
export const Inspector = {
  render: ({ material }) => <Page title="Inspector" problem="El inspector lateral apila cabecera, pestañas y grupos con contorno propio; cada nivel suma un borde y compite con el contenido.">
    <BeforeAfter height={H} material={material} before={inspector()} after={inspector()} changes={[
      'Mismo Inspector real con material cenital y radio de isla; sin borde exterior.',
      'Grupos planos: se quitan contornos y sombras internas; las filas usan realce tonal de radio 12.',
      'Cabecera alineada al mismo margen de 16 px que el contenido.',
      'Controles de cabecera circulares de 36 px.',
    ]} />
  </Page>,
};

/* ---------- Configuración ---------- */
const settings = () => <Host><Panel><Settings {...demo} /></Panel></Host>;
export const Configuracion = {
  render: ({ material }) => <Page title="Configuración" problem="Ajustes encadena navegación, bloques con contorno, campos con aro y botones secundarios con el mismo peso que la acción de guardar.">
    <BeforeAfter height={H} material={material} before={settings()} after={settings()} changes={[
      'Mismo Settings real: bloques como grupos planos sin borde ni sombra.',
      'Campos y selectores con aro de 1 px que solo se aclara al enfocar.',
      'Guardar como única primaria marfil; el resto de botones planos.',
      'Navegación de categorías con filas tonales de radio 12.',
    ]} />
  </Page>,
};

/* ---------- Apariencia ---------- */
function AppearanceLive() {
  const [value, setValue] = useState(appearance), [scale, setScale] = useState(115);
  return <Host><Panel><Appearance appearance={value} update={patch => { setValue(v => ({ ...v, ...patch })); return true; }} reset={() => setValue(appearance)} interfaceScale={{ scale, update: setScale }} /></Panel></Host>;
}
export const Apariencia = {
  render: ({ material }) => <Page title="Apariencia" problem="Las miniaturas de fondo y las muestras de acento llevan contorno y aro de selección grueso; los deslizadores compiten con el contenido.">
    <BeforeAfter height={H} material={material} before={<AppearanceLive />} after={<AppearanceLive />} changes={[
      'Mismo Appearance real con material cenital y bloques planos.',
      'Miniaturas con radio de fila; la selección es un aro de 1 px marfil, sin anillo blanco grueso.',
      'Botones secundarios planos; restablecer queda como acción silenciosa.',
    ]} />
  </Page>,
};

/* ---------- Bandeja ---------- */
function Tray() {
  const [filter, setFilter] = useState('needs');
  return <Host><ActivityTray {...demo} activity={activity} filter={filter} onFilter={setFilter} onTerminal={noop} onInspector={noop} onPanel={noop} onCard={noop} onRead={noop} /></Host>;
}
export const Bandeja = {
  render: ({ material }) => <Page title="Bandeja «Te necesitan»" problem="La bandeja suma contorno de popover, pestañas Pendientes / En curso / Hoy con fondo propio y filas con borde; el ámbar compite con el contenido.">
    <BeforeAfter stacked contain height={H} material={material} before={<Tray />} after={<Tray />} changes={[
      'Misma ActivityTray real con material cenital y radio de isla, sin borde.',
      'Pestañas Pendientes / En curso / Hoy como segmento plano; la activa con realce tonal.',
      'Filas tonales de radio 12 sin contorno; ámbar solo en el texto de «te necesita».',
      'Acción primaria de cada fila en marfil; el resto planas.',
    ]} />
  </Page>,
};

/* ---------- Muesca ---------- */
const notch = () => <Host><div className="px-right-notch"><ActivityNotch activity={activity} open={false} onToggle={noop} /></div></Host>;
export const Notch = {
  render: ({ material }) => <Page title="Muesca de actividad" problem="La muesca es una segunda píldora sobre el dock, con contorno propio y contador que compite con el texto.">
    <BeforeAfter height={240} material={material} before={notch()} after={notch()} changes={[
      'Misma ActivityNotch real con material cenital y sin contorno.',
      'Contador en texto ámbar, sin relleno ni aro; el punto de datos viejos en tinta tenue.',
      'En la propuesta completa la muesca se integra en el dock único (ver Propuestas/Shell › Dock).',
    ]} />
  </Page>,
};

/* ---------- Paleta ---------- */
const palette = () => <Contained selector=".tw-overlay"><CommandPalette open workspace={workspace} onClose={noop} onAction={noop} /></Contained>;
export const Paleta = {
  render: ({ material }) => <Page title="Paleta de comandos" problem="La paleta superpone velo, contorno, campo de búsqueda con aro y resultados con borde de selección.">
    <BeforeAfter stacked contain height={H} material={material} before={palette()} after={palette()} changes={[
      'Misma CommandPalette real con material cenital y radio de isla, sin borde.',
      'Búsqueda como campo isla: aro de 1 px que solo se aclara al enfocar.',
      'Resultado activo con realce tonal de radio 12, sin contorno.',
    ]} />
  </Page>,
};

/* ---------- Herramientas ---------- */
const tools = () => <Host><ToolPicker types={types} onPick={noop} onClose={noop} /></Host>;
export const Herramientas = {
  render: ({ material }) => <Page title="Selector de herramientas" problem="Cada herramienta es una tarjeta con contorno dentro de un popover con contorno; la cabecera y la búsqueda no comparten margen.">
    <BeforeAfter height={H} material={material} before={tools()} after={tools()} changes={[
      'Mismo ToolPicker real con material cenital, sin borde de popover.',
      'Herramientas como filas tonales de radio 12 en vez de tarjetas con contorno.',
      'Cabecera, búsqueda y grupos alineados al mismo margen.',
      'Cerrar como control circular plano de 36 px.',
    ]} />
  </Page>,
};

/* ---------- Voz ---------- */
function Indicator() {
  const voice = { status: 'recording', level: 0.4, mode: 'live', live: { confirmed: 'Transcripción sintética.', partial: 'Texto en curso…' }, cancel: noop };
  return <Host><section className="catalog-sample pc" aria-label="Fixture sintético de dictado (SYNTHETIC)"><div className="pc-composer" data-dictating><div className="pc-field"><div className="pc-input" data-preview><VoiceTranscript voice={voice} draft="Borrador." /><textarea aria-label="Transcripción sintética" readOnly value={dictationPreview(voice, 'Borrador.')} /></div><div className="pc-controls"><VoiceActivity voice={voice} onFinish={noop} hint="Esc descarta · Enter envía" /></div></div></div></section></Host>;
}
const dictation = () => <Contained selector=".voice-backdrop"><VoiceDictation {...demo} target={{ workspaceId: workspace.id, label: 'Sin campo seleccionado', kind: 'none' }} /></Contained>;
export const Voz = {
  render: ({ material }) => <Page title="Voz" problem="El indicador de dictado y la ventana de dictado suman contornos, medidor con fondo y dos botones de distinto peso.">
    <Section label="Indicador en el compositor">
      <BeforeAfter height={280} material={material} before={<Indicator />} after={<Indicator />} changes={[
        'Mismo VoiceActivity real dentro del compositor isla: aro de 1 px, sin anillo grueso.',
        'Descartar plano y terminar como primaria marfil, ambos circulares de 36 px.',
        'Medidor sin fondo propio; barras en tinta.',
      ]} />
    </Section>
    <Section label="Dictado">
      <BeforeAfter stacked contain height={H} material={material} before={dictation()} after={dictation()} changes={[
        'Mismo VoiceDictation real con material cenital, sin borde.',
        'Controles circulares planos y primaria marfil.',
      ]} />
    </Section>
  </Page>,
};
