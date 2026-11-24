import React, { useLayoutEffect, useRef, useState } from 'react';
import { Check, CircleAlert, CircleCheck, CircleX, Loader, SquareTerminal, StickyNote, Bot, Wrench } from 'lucide-react';
import ChatCard, { ContextMeter } from '../components/ChatCard';
import { demo, Panel } from './decorators';
import { chatNode, noop } from './fixtures';
import { BeforeAfter, Composer, Page, Section, Tag } from './proposals-kit';
import './proposals-feel.css';

export default {
  title: 'Propuestas/Feel',
  parameters: { docs: { description: { component: 'Laboratorio exploratorio del «feel»: foco de la isla, uso del acento, contador de contexto y movimiento. No cambia producción. Datos SYNTHETIC.' } } },
};

const Why = ({ items }) => <Section label="Qué cambia / por qué"><ul className="pf-why">{items.map(item => <li key={item}>{item}</li>)}</ul></Section>;

/* ---------- 1. Foco de la isla ---------- */
const RINGS = [
  ['blanco', 'Blanco', 'Aro de 1 px de 8 % a 22 % blanco. Se siente «marcada» y frío sobre el material cálido.', true],
  ['luz', 'Luz', 'El aro no cambia de color: su mitad superior gana luz como el aro de los objetos y el relleno sube de 3 % a 5 %. Se siente «encendida».', false, true],
  ['marfil', 'Marfil', 'Aro de 1 px en marfil al 38 %: cálido en vez de blanco frío.'],
  ['acento', 'Acento', 'Aro de 1 px en el acento al 55 % y cursor del texto en el acento: el foco eres tú.'],
  ['sin-aro', 'Sin aro', 'Ningún cambio de aro; solo el paso tonal del relleno y el cursor en el acento.'],
];

export const FocoIsla = {
  args: { aro: 'luz' },
  argTypes: { aro: { control: 'inline-radio', options: RINGS.map(([key]) => key), name: 'Aro al enfocar' } },
  render: ({ aro }) => <Page title="Foco de la isla" problem="Al enfocar el campo aparece un borde blanco que se lee como marca, no como luz.">
    <div className="pf-scope">
      <Section label="Pruébalo: haz clic y escribe">
        <Tag />
        <div className="pf-card"><header><strong>{RINGS.find(([key]) => key === aro)?.[1]}</strong></header><Composer focus={aro} /></div>
      </Section>
      <Section label="Las cinco variantes enfocadas (foco forzado)">
        <div className="pf-grid pf-forced">
          {RINGS.map(([key, label, why, today, rec]) => <article key={key} className="pf-card">
            <header><strong>{label}</strong>{today && <Tag today historical />}{rec && <span className="pf-chip" data-kind="rec">RECOMENDADA</span>}</header>
            <p>{why}</p>
            <Composer focus={key} />
          </article>)}
        </div>
      </Section>
      <p className="pf-note">El foco de teclado de los botones (adjuntar, modelo, enviar…) conserva su contorno de 2 px en el acento: es accesibilidad y no se toca. Esta propuesta solo cambia el foco del campo de texto, que ya se ve por el cursor.</p>
      <Why items={[
        'Luz (recomendada): el aro hereda la luz cenital del material; no aparece un color nuevo al enfocar.',
        'Transición de 120 ms lineal solo en opacidad y color del aro y del relleno; la altura nunca se anima.',
        'Blanco queda como referencia de hoy; marfil, acento y sin aro como alternativas.',
      ]} />
    </div>
  </Page>,
};

/* ---------- 2. Acento ---------- */
const ACCENTS = { marfil: '#ece6d8', azul: '#6ea8ff', naranja: '#f0a05a', verde: '#65ba83', rojo: '#f27670' };
const CLASH = { verde: 'terminó', rojo: 'error' };

function StateList() {
  return <div className="pf-states">
    <span className="pf-state" data-tone="working"><Loader size={14} aria-hidden="true" />Trabajando</span>
    <span className="pf-state" data-tone="attention"><CircleAlert size={14} aria-hidden="true" />Te necesita</span>
    <span className="pf-state" data-tone="danger"><CircleX size={14} aria-hidden="true" />Error</span>
    <span className="pf-state" data-tone="success"><CircleCheck size={14} aria-hidden="true" />Terminó</span>
  </div>;
}
const YES = [
  [<button key="b" type="button" className="px-btn is-primary" aria-label="Nueva sesión">Nueva sesión</button>, 'Acción primaria única', 'Una por superficie: es «tu acción».'],
  [<div key="f" className="pf-mini-field" aria-hidden="true" />, 'Foco y selección', 'Marca dónde estás tú: aro, cursor y texto seleccionado.'],
  [<span key="m" className="pf-mono">TF</span>, 'Identidad del proyecto', 'El monograma es tuyo, no del agente.'],
];
const NO = [
  [<StateList key="s" />, 'Estados', 'Lima, ámbar, rojo y verde son la voz del agente; no se tiñen de acento.'],
  [<div key="t" className="pf-tile" aria-hidden="true" />, 'Superficies y rellenos', 'El material es neutro para que el acento destaque donde importa.'],
  [<span key="r" className="pf-prose">Texto de lectura</span>, 'Texto de lectura', 'La prosa se lee en tinta; solo los enlaces llevan acento.'],
  [<Wrench key="w" size={18} aria-hidden="true" />, 'Iconos de herramientas', 'Las herramientas son del agente y van en tinta secundaria.'],
];
const Rules = ({ items }) => <ul>{items.map(([demo, title, why]) => <li key={title} className="pf-rule"><span>{demo}</span><div><strong>{title}</strong><p>{why}</p></div></li>)}</ul>;

export const Acento = {
  args: { acento: 'marfil' },
  argTypes: { acento: { control: 'inline-radio', options: Object.keys(ACCENTS), name: 'Acento' } },
  render: ({ acento }) => <Page title="Color de acento" problem="El acento elegido en Apariencia no tiene una regla: puede acabar en estados o superficies y competir con los colores del agente.">
    <div className="pf-scope pf-accent" style={{ '--accent': ACCENTS[acento], '--accent-ink': '#141414' }}>
      {CLASH[acento] && <div className="pf-warn" role="note"><CircleAlert size={16} aria-hidden="true" /><p>{`Este acento se parece al color de «${CLASH[acento]}». Las primarias siguen con acento, pero cada estado añade su palabra y su glifo: nunca dependen solo del color.`}</p></div>}
      <Section label="Sesión propuesta (el acento solo en enviar, foco, rail, monograma, enlace y selección)">
        <Tag />
        <div className="pf-accent-layout">
          <nav className="pf-rail" aria-label="Rail de muestra">
            <button type="button" className="px-rail-row"><span className="pf-mono">TF</span><span>taller-fantasma</span></button>
            <button type="button" className="px-rail-row" aria-current="true"><Bot size={16} aria-hidden="true" /><span>Refactor del dock</span></button>
            <button type="button" className="px-rail-row"><SquareTerminal size={16} aria-hidden="true" /><span>Terminal de pruebas</span></button>
            <button type="button" className="px-rail-row"><StickyNote size={16} aria-hidden="true" /><span>Notas del sprint</span></button>
          </nav>
          <div className="pf-scope">
            <p className="pf-prose">SYNTHETIC · Selecciona este texto o abre la <a href="#guia" onClick={event => event.preventDefault()}>guía del dock</a> para ver el acento en enlace y selección.</p>
            <Panel><ChatCard {...demo} node={chatNode} /></Panel>
          </div>
        </div>
      </Section>
      <div className="pf-rules">
        <Section label="SÍ lleva acento"><Rules items={YES} /></Section>
        <Section label="NUNCA lleva acento"><Rules items={NO} /></Section>
      </div>
      <Why items={[
        'El acento significa «tú / tu acción»; el estado significa «el agente».',
        'Una sola primaria con acento por superficie; el resto de botones queda en tinta.',
        'Los estados siempre llevan palabra y glifo, así no chocan con ningún acento.',
      ]} />
    </div>
  </Page>,
};

/* ---------- 3. Contador de contexto ---------- */
const WINDOW = 200000;
const USES = [20, 60, 75, 90, 98];
const k = n => `${Math.round(n / 1000)}k`;

function Meter({ uso }) {
  const tokens = uso / 100 * WINDOW, r = 8, c = 2 * Math.PI * r;
  const level = uso >= 90 ? 'high' : uso >= 70 ? 'mid' : 'low';
  return <span className="pf-meter" data-level={level} data-danger={uso >= 95 ? '' : undefined}>
    <button type="button" className="pf-meter-btn" aria-label={`Contexto: ${k(tokens)} de ${k(WINDOW)} tokens (${uso} %)`}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle className="pf-track" cx="10" cy="10" r={r} />
        <circle className="pf-arc" cx="10" cy="10" r={r} strokeDasharray={`${c * uso / 100} ${c}`} transform="rotate(-90 10 10)" />
      </svg>
      {level !== 'low' && <span>{uso} %</span>}
    </button>
    {level === 'high' && <><span className="pf-meter-low">Queda poco contexto</span><button type="button" className="pf-flat" aria-label="Compactar">Compactar</button></>}
    <span className="pf-meter-pop" role="group" aria-label="Detalle del contexto">
      <span>{`${k(tokens)} de ${k(WINDOW)} tokens`}</span>
      <div><button type="button" className="pf-flat" aria-label="Compactar">Compactar</button><button type="button" className="pf-flat" aria-label="Nueva sesión">Nueva sesión</button></div>
    </span>
  </span>;
}

export const ContadorContexto = {
  args: { uso: 75 },
  argTypes: { uso: { control: 'inline-radio', options: USES, name: 'Uso (%)' } },
  render: ({ uso }) => <Page title="Contador de contexto" problem="El contador vive fuera de la isla, desalineado de los controles y con una presencia constante aunque quede mucho contexto.">
    <div className="pf-scope">
      <BeforeAfter historical height={360}
        before={<div className="pf-before-meter"><ContextMeter meta={{ contextSource: 'claude:request-v1', contextTokens: uso / 100 * WINDOW, contextWindow: WINDOW }} onCompact={noop} onNew={noop} /><Composer /></div>}
        after={<div className="pf-before-meter"><Composer meter={<Meter uso={uso} />} /></div>}
        changes={[
          'Anillo de 20 px dentro de la isla, a la izquierda del modelo y en su misma línea base.',
          'Por debajo del 70 % solo el anillo; del 70 % al 89 % aparece el número; desde el 90 % avisa y ofrece «Compactar».',
          'Tinta neutra hasta el 89 %; rojo solo desde el 95 %. Nunca ámbar ni lima: son estados del agente.',
        ]} />
      <Section label="Los cinco estados">
        <div className="pf-states-row">{USES.map(value => <div key={value} className="pf-card"><header><strong>{`${value} %`}</strong></header><Composer meter={<Meter uso={value} />} /></div>)}</div>
      </Section>
      <Why items={['Al pasar el cursor o enfocar se ven los tokens exactos y las acciones «Compactar» y «Nueva sesión».', 'El contador habla bajito hasta que importa.']} />
    </div>
  </Page>,
};

/* ---------- 4. Movimiento ---------- */
const reducedNow = scope => scope?.dataset.motion === 'reducido' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function SwitchDemo() {
  const [on, setOn] = useState(false);
  return <button type="button" role="switch" aria-checked={on} aria-label="Interruptor de muestra" className="pf-switch" onClick={() => setOn(v => !v)}><i /></button>;
}
function MenuDemo() {
  const [open, setOpen] = useState(false);
  return <span className="pf-menu-wrap">
    <button type="button" className="px-btn" aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? 'Cerrar menú' : 'Abrir menú'}</button>
    <span className="pf-menu" data-open={open ? '' : undefined} role="menu" aria-label="Menú de muestra">
      {['Renombrar', 'Duplicar', 'Cerrar'].map(item => <button key={item} type="button" role="menuitem" className="pf-row" aria-label={item} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>{item}</button>)}
    </span>
  </span>;
}
function FlipDemo() {
  const [max, setMax] = useState(false), ref = useRef(null), first = useRef(null);
  const toggle = () => { first.current = ref.current.getBoundingClientRect(); setMax(v => !v); };
  useLayoutEffect(() => {
    const el = ref.current, a = first.current;
    if (!el || !a) return;
    first.current = null;
    if (reducedNow(el.closest('.pf-scope'))) return;
    const b = el.getBoundingClientRect();
    el.animate([{ transformOrigin: '0 0', transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` }, { transformOrigin: '0 0', transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
  }, [max]);
  return <div className="pf-flip"><button ref={ref} type="button" className="pf-flip-panel" data-max={max ? '' : undefined} aria-label={max ? 'Restaurar panel' : 'Maximizar panel'} onClick={toggle}>{max ? 'Restaurar' : 'Maximizar'}</button></div>;
}
function MessageDemo() {
  const [list, setList] = useState(['Hola, ¿revisas el dock?']);
  return <div className="pf-thread">
    {list.map((text, index) => <p key={index} data-new={index === list.length - 1 && index > 0 ? '' : undefined}>{text}</p>)}
    <button type="button" className="px-btn" aria-label="Añadir mensaje" onClick={() => setList(v => [...v.slice(-2), `Mensaje SYNTHETIC ${v.length + 1}`])}>Añadir mensaje</button>
  </div>;
}
function FlashDemo() {
  const [n, setN] = useState(0);
  return <div className="pf-states"><div key={n} className="pf-flash" data-flash={n ? '' : undefined} /><button type="button" className="px-btn" aria-label="Saltar al panel" onClick={() => setN(v => v + 1)}>Saltar al panel</button></div>;
}
const Comet = () => <div className="pf-comet"><span className="pf-comet-ring" aria-hidden="true"><i /></span>Trabajando</div>;

const TOKENS = [
  ['--dur-fast', '120ms', 'linear', 'Realce tonal de hover y pulsado en filas y controles; nunca escala ni desplazamiento.', <button key="r" type="button" className="pf-row" aria-label="Fila de muestra">Pasa el cursor o pulsa</button>],
  ['160ms', '160ms', 'linear', 'Fondo del interruptor y aro de foco.', <SwitchDemo key="s" />],
  ['--dur-open', '320ms', '--ease-settle', 'Abrir y cerrar menú, bandeja y paleta: opacidad + 8 px de recorrido.', <MenuDemo key="m" />],
  ['--dur-open (FLIP)', '320ms', '--ease-settle', 'Maximizar un panel desde su rectángulo real.', <FlipDemo key="f" />],
  ['200ms settle', '200ms', '--ease-settle', 'Thumb del interruptor y mensaje nuevo en el hilo: opacidad + 4 px.', <MessageDemo key="n" />],
  ['sin animación', '0ms', '—', 'La isla crece al escribir sin animar la altura. Escribe varias líneas.', <Composer key="c" />],
  ['--map-flash-duration', '900ms', '--ease-settle', 'Destello del aro al saltar a un panel desde el rail.', <FlashDemo key="x" />],
  ['cometa', '5.6s', 'linear infinita', 'Cometa «Trabajando» sobre el aro: único bucle junto con el spinner.', <Comet key="k" />],
];

export const Movimiento = {
  args: { movimiento: 'normal' },
  argTypes: { movimiento: { control: 'inline-radio', options: ['normal', 'reducido'], name: 'Movimiento' } },
  render: ({ movimiento }) => <Page title="Movimiento" problem="Cada pieza anima con su propio tiempo y curva; falta un catálogo de qué se mueve, cuánto y qué nunca se anima.">
    <div className="pf-scope" data-motion={movimiento}>
      <Section label="Tokens de movimiento (juega con cada demo)">
        <Tag />
        <table className="pf-motion">
          <caption className="px-sr">Tokens de movimiento</caption>
          <thead><tr><th scope="col">Nombre</th><th scope="col">Duración</th><th scope="col">Curva</th><th scope="col">Dónde se usa</th><th scope="col">Demo</th></tr></thead>
          <tbody>{TOKENS.map(([name, dur, ease, where, demo]) => <tr key={name}><td>{name}</td><td>{dur}</td><td>{ease}</td><td>{where}</td><td className="pf-demo">{demo}</td></tr>)}</tbody>
        </table>
      </Section>
      <Section label="Qué NO se anima">
        <ul className="pf-dont">
          <li>La altura del compositor.</li>
          <li>El color de estado (trabajando, te necesita, error, terminó).</li>
          <li>Rebotes o escala en botones.</li>
          <li>Bucles decorativos: solo la cometa y el spinner, y se detienen con movimiento reducido.</li>
        </ul>
      </Section>
      <p className="pf-note"><Check size={14} aria-hidden="true" /> «Reducido» simula prefers-reduced-motion: duración 0 y cometa quieta. La preferencia real del sistema también se respeta.</p>
      <Why items={['Pocas duraciones con nombre: rápido para realces, apertura para lo que aparece, settle para lo que se asienta.', 'El movimiento explica de dónde viene algo; nunca decora.']} />
    </div>
  </Page>,
};
