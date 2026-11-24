import React from 'react';
import ChatCard from '../components/ChatCard';
import { demo, Panel } from './decorators';
import { chatNode } from './fixtures';
import { BeforeAfter, Page, Section, Status } from './proposals-kit';
import './proposals.css';

export default {
  title: 'Propuestas/Resumen',
  parameters: { docs: { description: { component: 'Laboratorio de diseño exploratorio. Nada de esta familia cambia producción: resume qué cambia en cada área, compara la app de hoy con la propuesta y recoge las decisiones pendientes. Datos SYNTHETIC.' } } },
};

const kebab = name => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const storyId = (area, name) => `propuestas-${area}--${kebab(name)}`;
const storyHref = (area, name) => `?path=/story/${storyId(area, name)}`;

const AREAS = [
  ['feel', 'Feel', 'cambia', [['FocoIsla', 'Foco de la isla'], ['Acento', 'Color de acento'], ['ContadorContexto', 'Contador de contexto'], ['Movimiento', 'Movimiento']]],
  ['fundamentos', 'Fundamentos', 'cambia', [['Fondos', 'Fondos'], ['Material', 'Material'], ['Tinta', 'Tinta'], ['Insignias', 'Insignias'], ['Botones', 'Botones'], ['Campos', 'Campos'], ['Selectores', 'Selectores'], ['Menus', 'Menús'], ['EstadosVacios', 'Estados vacíos']]],
  ['shell', 'Shell', 'cambia', [['Rail', 'Rail'], ['RailFilas', 'Filas del rail'], ['BarraSuperior', 'Barra superior'], ['Dock', 'Dock'], ['Zoom', 'Zoom'], ['Minimapa', 'Minimapa'], ['PanelEnMapa', 'Panel en el mapa']]],
  ['sesiones', 'Sesiones', 'cambia', [['SesionNueva', 'Sesión nueva'], ['ChatReposo', 'Chat en reposo'], ['ChatTrabajando', 'Chat trabajando'], ['ChatAtencion', 'Chat que te necesita'], ['ChatError', 'Chat con error'], ['ChatVacio', 'Chat vacío'], ['Dictado', 'Dictado'], ['Terminal', 'Terminal'], ['TarjetaTerminal', 'Tarjeta de terminal'], ['PhantomChat', 'Phantom Chat'], ['Orquestador', 'Orquestador']]],
  ['derecha', 'Derecha', 'cambia', [['Inspector', 'Inspector'], ['Configuracion', 'Configuración'], ['Apariencia', 'Apariencia'], ['Bandeja', 'Bandeja'], ['Notch', 'Notch'], ['Paleta', 'Paleta de comandos'], ['Herramientas', 'Herramientas'], ['Voz', 'Voz']]],
  ['paneles', 'Paneles', 'material', [['Navegador', 'Navegador'], ['Repositorio', 'Repositorio'], ['Ramas', 'Ramas'], ['Incorporaciones', 'Incorporaciones'], ['Cards', 'Cards'], ['Skills', 'Skills'], ['Memoria', 'Memoria'], ['Markdown', 'Markdown'], ['CentroDeMando', 'Centro de mando']]],
];
const TOTAL = AREAS.reduce((sum, [, , , stories]) => sum + stories.length, 0);

export const Inventario = {
  render: () => <Page title="Inventario" problem={`Una fila por story planificada (${TOTAL}). Cada área compara la app de hoy con la propuesta; el chip indica si cambia la estructura o solo hereda el material.`}>
    {AREAS.map(([area, label, kind, stories]) => <Section key={area} label={`${label} · ${stories.length}`}>
      <table className="px-inventory">
        <caption className="px-sr">{`Stories planificadas de ${label}`}</caption>
        <thead><tr><th scope="col">Story</th><th scope="col">Estado</th><th scope="col">Enlace</th></tr></thead>
        <tbody>{stories.map(([name, title]) => <tr key={name}>
          <th scope="row">{title}</th>
          <td><Status kind={kind} /></td>
          <td><a href={storyHref(area, name)} target="_top">{storyId(area, name)}</a></td>
        </tr>)}</tbody>
      </table>
    </Section>)}
  </Page>,
};

const CHANGES = [
  'Campo isla: el texto y todos los controles viven dentro de un mismo campo.',
  'Sin anillo blanco alrededor del compositor; solo un aro tenue que se aclara con el foco.',
  'Sin la fila «Contexto de la sesión»: el contexto pasa a un chip dentro de la isla.',
  'Una sola línea de estado viva encima del campo.',
  'Conversación en columna centrada de 720 px.',
  'Material vigente: #151518 → #0b0b0d con brillo del 4 % sobre #020203.',
];

export const AntesDespues = {
  parameters: { host: { scenario: 'working' } },
  render: () => <Page title="Antes y después" problem="A la izquierda, el ChatCard real de producción tal como está hoy. A la derecha, el panel de sesión propuesto con material cenital, compositor isla y mensaje en cita.">
    <BeforeAfter height={704} changes={CHANGES}
      before={<Panel><ChatCard {...demo} node={chatNode} /></Panel>}
      after={<Panel><ChatCard {...demo} node={chatNode} /></Panel>} />
  </Page>,
};

const DECIDED = [
  ['Compositor isla', 'Campo redondeado con todos los controles dentro, aro de 1 px que solo se aclara al enfocar y una sola línea viva de estado.', [['sesiones', 'ChatReposo', 'Chat en reposo'], ['sesiones', 'ChatTrabajando', 'Chat trabajando'], ['sesiones', 'Dictado', 'Dictado']]],
  ['Aro de foco: luz', 'Con foco el relleno sube y la luz ilumina el aro desde arriba; el foco de teclado de los botones no cambia.', [['feel', 'FocoIsla', 'Foco de la isla']]],
  ['Uso del acento', 'Solo en tu acción primaria, foco/selección e identidad del proyecto; nunca en estados, superficies, lectura ni herramientas.', [['feel', 'Acento', 'Color de acento']]],
  ['Contador de contexto', 'Anillo dentro de la isla junto al modelo, que solo muestra número y aviso al acercarse al límite.', [['feel', 'ContadorContexto', 'Contador de contexto']]],
  ['Material cenital', 'Material del objeto cenital (6·1), integrado en rail, paneles y flotantes.', [['fundamentos', 'Material', 'Material'], ['shell', 'Rail', 'Rail']]],
  ['Mensaje del usuario como cita', 'Cita con barra marfil de 2 px, sin burbuja.', [['sesiones', 'ChatReposo', 'Chat en reposo'], ['sesiones', 'ChatTrabajando', 'Chat trabajando']]],
  ['Dock unificado', 'Un solo dock centrado; las herramientas del lienzo pasan junto al minimapa (6·3).', [['shell', 'Dock', 'Dock'], ['shell', 'Minimapa', 'Minimapa'], ['shell', 'Zoom', 'Zoom']]],
  ['Cabecera compacta del rail', 'Proyecto y espacio en un solo selector; la atención pasa a ser la primera fila (6·4).', [['shell', 'Rail', 'Rail'], ['shell', 'RailFilas', 'Filas del rail']]],
  ['Bandeja y centro de mando', 'Filas tonales planas y acciones sin caja (6·5).', [['derecha', 'Bandeja', 'Bandeja'], ['paneles', 'CentroDeMando', 'Centro de mando']]],
];
const PENDING = [
  ['Insignias del rail', 'Por estado (integrado hoy, recomendado) o por tipo con la paleta definida; sin confirmar por Carlos.', [['shell', 'RailFilas', 'Filas del rail'], ['fundamentos', 'Insignias', 'Insignias']]],
];
function DecisionList({ items }) {
  return <ul className="px-decisions">{items.map(([title, detail, links]) => <li key={title}>
    <strong>{title}</strong>
    <p>{detail}</p>
    <span className="px-decision-links">{links.map(([area, name, label]) => <a key={storyId(area, name)} href={storyHref(area, name)} target="_top">{label}</a>)}</span>
  </li>)}</ul>;
}

export const Decisiones = {
  render: () => <Page title="Decisiones" problem="Lo que Carlos ya aprobó y lo que queda por elegir, con enlace a las stories donde se ve cada opción.">
    <Section label="Decidido"><DecisionList items={DECIDED} /></Section>
    <Section label="Pendiente de Carlos"><DecisionList items={PENDING} /></Section>
  </Page>,
};
