import React, { useState } from 'react';
import { Folder } from 'lucide-react';
import TerminalPanel from '../components/TerminalPanel';
import TerminalCard from '../components/TerminalCard';
import ChatCard from '../components/ChatCard';
import PhantomChatPanel from '../components/PhantomChat';
import PhantomOrchestrator from '../components/PhantomOrchestrator';
import { VoiceActivity, VoiceTranscript, dictationPreview } from '../components/VoiceActivity';
import { ClaudeGlyph, PhantomGlyph } from '../components/Glyphs';
import { demo, Panel } from './decorators';
import { terminalNode, chatNode, noop } from './fixtures';
import { BeforeAfter, Page, Session, Composer, materialArg } from './proposals-kit';
import './proposals-sessions.css';

export default {
  title: 'Propuestas/Sesiones',
  args: { material: 'cenital' },
  argTypes: { material: materialArg },
  parameters: { docs: { description: { component: 'Laboratorio exploratorio: componentes reales de hoy frente a la propuesta (material cenital, compositor isla, columna de 720 px). No cambia producción. Datos SYNTHETIC.' } } },
};

const H = 640;
const chat = () => <Panel><ChatCard {...demo} node={chatNode} /></Panel>;
const Fill = ({ children }) => <div className="px-sessions-fill">{children}</div>;
const orchestratorStatus = { tone: 'working', orchestrator: { id: chatNode.id, title: 'Orquestador sintético', agent: 'working', step: 'Revisando el catálogo', chat: true } };

function NewSessionMock() {
  const [who, setWho] = useState('claude');
  const [mode, setMode] = useState('chat');
  const options = [['claude', 'Claude Code', ClaudeGlyph, 'Opus 5.5'], ['phantom', 'Phantom', PhantomGlyph, 'Orquesta']];
  return <div className="px-object px-newsession" aria-label="Sesión nueva propuesta">
    <div className="px-newsession-col">
      <section className="px-newsession-group" role="radiogroup" aria-label="Quién responde">
        <h4>Quién responde</h4>
        {options.map(([key, label, Icon, meta]) => <button key={key} type="button" role="radio" aria-checked={who === key} aria-label={label} className="px-newsession-row" onClick={() => setWho(key)}><Icon size={16} aria-hidden="true" /><span>{label}</span><small>{meta}</small></button>)}
      </section>
      <section className="px-newsession-group">
        <h4>Interfaz</h4>
        <div className="px-newsession-seg" role="group" aria-label="Interfaz">
          {[['chat', 'Chat'], ['terminal', 'Terminal']].map(([key, label]) => <button key={key} type="button" aria-label={label} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}
        </div>
      </section>
      <section className="px-newsession-group">
        <h4>Contexto</h4>
        <button type="button" className="px-newsession-row" aria-label="Carpeta: taller-fantasma"><Folder size={16} aria-hidden="true" /><span>taller-fantasma</span><small>SYNTHETIC</small></button>
      </section>
    </div>
    <Composer state="reposo" />
  </div>;
}

function DictationToday() {
  const voice = { status: 'recording', level: 0.4, mode: 'live', live: { confirmed: 'Transcripción sintética.', partial: 'Texto en curso…' }, cancel: noop };
  return <section className="catalog-sample pc" aria-label="Fixture sintético de dictado"><div className="pc-composer" data-dictating><div className="pc-field"><div className="pc-input" data-preview><VoiceTranscript voice={voice} draft="Borrador." /><textarea aria-label="Transcripción sintética" readOnly value={dictationPreview(voice, 'Borrador.')} /></div><div className="pc-controls"><VoiceActivity voice={voice} onFinish={noop} hint="Esc descarta · Enter envía" /></div></div></div></section>;
}

export const SesionNueva = {
  parameters: { host: { scenario: 'empty' } },
  render: ({ material }) => <Page title="Sesión nueva" problem="Elegir quién responde, la interfaz y el contexto exige recorrer tres bloques apilados y el compositor queda separado por un divisor.">
    <BeforeAfter height={H} material={material} before={chat()} after={<NewSessionMock />} changes={[
      'Filas con realce tonal de radio 12, sin anillos alrededor de cada opción.',
      'Chat/Terminal pasa a un segmento compacto en vez de filas.',
      'Columna centrada de 720 px y compositor isla con el contexto como chip.',
      'Maqueta con piezas del kit: la estructura cambia y no se alcanza con CSS.',
    ]} />
  </Page>,
};

export const ChatReposo = {
  render: ({ material }) => <Page title="Chat en reposo" problem="El compositor ocupa una franja con divisor y fila «Contexto de la sesión»; la lectura usa 780 px.">
    <BeforeAfter height={H} material={material} before={chat()} after={<Session material={material} state="reposo" />} changes={[
      'Compositor isla: texto y controles dentro del mismo campo redondeado.',
      'El contexto pasa a un chip dentro de la isla; desaparece la fila plegable.',
      'Columna de lectura centrada de 720 px.',
      'Controles circulares planos de 36 px con primaria marfil.',
    ]} />
  </Page>,
};

export const ChatTrabajando = {
  parameters: { host: { scenario: 'working' } },
  render: ({ material }) => <Page title="Chat trabajando" problem="El estado de trabajo se reparte entre el hilo, el placeholder y el botón de detener.">
    <BeforeAfter height={H} material={material} before={chat()} after={<Session material={material} state="trabajando" />} changes={[
      'Una sola línea viva encima de la isla con spinner y subagentes.',
      'Lima solo para «Trabajando»; el resto del panel no cambia de tono.',
      'Detener ocupa el lugar de enviar dentro de la isla.',
    ]} />
  </Page>,
};

export const ChatAtencion = {
  parameters: { host: { scenario: 'attention' } },
  render: ({ material }) => <Page title="Chat que te necesita" problem="La petición de permiso es una caja más sobre el compositor con tres botones del mismo peso.">
    <BeforeAfter height={H} material={material} before={chat()} after={<Fill>{chat()}</Fill>} changes={[
      'El permiso se resuelve encima de la isla con el mismo radio y aro de 1 px.',
      'Primaria marfil «Aprobar» y secundaria plana «Rechazar»; «Siempre» se oculta en la propuesta.',
      'Ámbar solo como color del icono; las reglas de tokens prohíben ámbar en aros, así que el objeto no lleva aro ámbar.',
    ]} />
  </Page>,
};

export const ChatError = {
  parameters: { host: { scenario: 'error' } },
  render: ({ material }) => <Page title="Chat con error" problem="El error se apila entre el hilo y el compositor como otra franja.">
    <BeforeAfter height={H} material={material} before={chat()} after={<Fill>{chat()}</Fill>} changes={[
      'El error queda alineado con la columna de 720 px, sin caja propia.',
      'Compositor isla bajo el error, sin divisor superior.',
    ]} />
  </Page>,
};

export const ChatVacio = {
  parameters: { host: { scenario: 'empty' } },
  render: ({ material }) => <Page title="Chat vacío" problem="Sin mensajes, el panel muestra los bloques de configuración y el compositor con divisor.">
    <BeforeAfter height={H} material={material} before={chat()} after={<Fill>{chat()}</Fill>} changes={[
      'Mismo ChatCard real con compositor isla y columna de 720 px.',
      'Filas de configuración sin anillos, con realce tonal.',
    ]} />
  </Page>,
};

export const Dictado = {
  render: ({ material }) => <Page title="Dictado" problem="El dictado sustituye los controles del campo y cambia el divisor del compositor.">
    <BeforeAfter height={H} material={material} before={<DictationToday />} after={<Session material={material} state="dictando" />} changes={[
      'El dictado vive dentro de la isla con medidor de barras y tiempo.',
      'Descartar y terminar como controles circulares de 36 px; terminar en marfil.',
      'La pista «Esc descarta · Enter envía» ocupa la línea viva.',
    ]} />
  </Page>,
};

export const Terminal = {
  render: ({ material }) => <Page title="Terminal" problem="El xterm toca los bordes del panel y la cabecera no se alinea con la del chat.">
    <BeforeAfter height={H} material={material}
      before={<Panel><TerminalPanel {...demo} node={terminalNode} active /></Panel>}
      after={<Fill><Panel><TerminalPanel {...demo} node={terminalNode} active /></Panel></Fill>} changes={[
        'El mismo xterm real con 16 px de aire alrededor.',
        'Sin borde ni anillo en el panel.',
        'Cabecera y contexto con el mismo margen de 16 px que el chat.',
      ]} />
  </Page>,
};

export const TarjetaTerminal = {
  render: ({ material }) => <Page title="Tarjeta de terminal" problem="La tarjeta ya es compacta; solo necesita el material propuesto.">
    <BeforeAfter height={H} material={material}
      before={<Panel><TerminalCard {...demo} node={terminalNode} onOpen={noop} /></Panel>}
      after={<Fill><Panel><TerminalCard {...demo} node={terminalNode} onOpen={noop} /></Panel></Fill>} changes={[]} />
  </Page>,
};

export const PhantomChat = {
  render: ({ material }) => <Page title="Phantom Chat" problem="El compositor del dock de Phantom repite la franja con divisor del chat.">
    <BeforeAfter height={H} material={material}
      before={<Panel><PhantomChatPanel {...demo} status={{ tone: 'idle', orchestrator: null }} /></Panel>}
      after={<Fill><Panel><PhantomChatPanel {...demo} status={{ tone: 'idle', orchestrator: null }} /></Panel></Fill>} changes={[
        'Compositor isla con aro de 1 px que se aclara al enfocar.',
        'Columna de 720 px para sugerencias y mensajes.',
      ]} />
  </Page>,
};

export const Orquestador = {
  render: ({ material }) => <Page title="Orquestador" problem="Sesión, delegaciones y compositor se apilan como bloques con su propio contorno.">
    <BeforeAfter height={H} material={material}
      before={<Panel><PhantomOrchestrator {...demo} status={orchestratorStatus} /></Panel>}
      after={<Fill><Panel><PhantomOrchestrator {...demo} status={orchestratorStatus} /></Panel></Fill>} changes={[
        'Bloques de sesión y delegación sin contorno, con radio de grupo.',
        'Compositor isla en el campo del orquestador.',
      ]} />
  </Page>,
};
