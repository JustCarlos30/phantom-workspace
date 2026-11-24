import React from 'react';
import { expect, userEvent, within } from 'storybook/test';
import BrowserPanel from '../components/BrowserPanel';
import { PhantomCards } from '../components/PhantomCards';
import { PhantomSkills } from '../components/PhantomSkills';
import MemoryCard from '../components/MemoryCard';
import { Markdown as SkillsMarkdown } from '../components/SkillsMarkdown';
import { ToolPanel } from '../components/ToolPanels';
import { demo, Panel } from './decorators';
import { markdown, date } from './fixtures';
import { BeforeAfter, Page, materialArg } from './proposals-kit';
import './proposals-panels.css';

export default {
  title: 'Propuestas/Paneles',
  args: { material: 'cenital' },
  argTypes: { material: materialArg },
  parameters: { docs: { description: { component: 'Laboratorio exploratorio: paneles de contenido reales de hoy frente a la propuesta (material y limpieza). No cambia producción. Datos SYNTHETIC.' } } },
};

const H = 720;
const Host = ({ children }) => <div className="px-panels-host">{children}</div>;
const browser = { id: 'browser-demo', type: 'browser', data: { url: 'https://example.invalid', reader: true } };
const memory = { id: 'memory-demo', kind: 'decision', title: 'Decisión sintética', body: markdown, scope: '.', space: 'project', revision: 1, state: 'active', updatedAt: date, evidence: [] };
const Tool = ({ type }) => <ToolPanel {...demo} node={{ id: `story-${type}`, type, data: {} }} />;
const pluginPanel =node => <Host><div className="plugin-surface"><Panel>{node}</Panel></div></Host>;

const navegador = () => <Host><Panel><BrowserPanel {...demo} node={browser} active={false} /></Panel></Host>;
export const Navegador = {
  render: ({ material }) => <Page title="Navegador" problem="La barra del navegador suma contorno, campo de dirección con aro y botones con borde; la cabecera no se parece a la de sesión.">
    <BeforeAfter height={H} material={material} before={navegador()} after={navegador()} changes={[
      'Mismo BrowserPanel real con material cenital, sin borde exterior.',
      'Dirección como campo isla: aro de 1 px que solo se aclara al enfocar.',
      'Botones de la barra circulares planos de 36 px.',
    ]} />
  </Page>,
};

const repositorio = () => <Host><Panel><Tool type="repo" /></Panel></Host>;
export const Repositorio = {
  render: ({ material }) => <Page title="Repositorio" problem="Archivos, grupos por carpeta y diff van en cajas con contorno dentro del panel; cada nivel añade un borde.">
    <BeforeAfter height={H} material={material} before={repositorio()} after={repositorio()} changes={[
      'Mismo Repository real: grupos de carpeta y archivos sin contorno.',
      'Filas de archivo con realce tonal de radio 12.',
      'Barra de archivo y diff sin caja anidada; radio por token.',
    ]} />
  </Page>,
};

const ramas = () => <Host><Panel><Tool type="branches" /></Panel></Host>;
export const Ramas = {
  render: ({ material }) => <Page title="Ramas" problem="Búsqueda, filtros, grupos y filas de rama llevan cada uno su borde; los filtros parecen botones secundarios.">
    <BeforeAfter height={H} material={material} before={ramas()} after={ramas()} changes={[
      'Mismo Branches real con grupos planos, sin contorno.',
      'Filas de rama tonales de radio 12.',
      'Búsqueda con aro de 1 px; filtros como segmento plano con el activo en realce tonal.',
    ]} />
  </Page>,
};

/* ---------- Incorporaciones ---------- */
const incorporaciones = () => <Host><Panel><Tool type="incorporaciones" /></Panel></Host>;
export const Incorporaciones = {
  render: ({ material }) => <Page title="Incorporaciones" problem="La cola de integración apila secciones y elementos con contorno; el aviso de desactivado es otra caja dentro del panel.">
    <BeforeAfter height={H} material={material} before={incorporaciones()} after={incorporaciones()} changes={[
      'Mismo Incorporaciones real con material cenital.',
      'Grupos y elementos sin contorno; filas tonales de radio 12.',
      'Botones planos en píldora; sin cambios de estructura.',
    ]} />
  </Page>,
};

/* ---------- Cards ---------- */
const cards = () => pluginPanel(<PhantomCards {...demo} />);
export const Cards = {
  render: ({ material }) => <Page title="Cards" problem="Cada card es una tarjeta con borde dentro de un panel con borde; pestañas y cabecera añaden más fondos y metadatos.">
    <BeforeAfter height={H} material={material} before={cards()} after={cards()} changes={[
      'Mismo PhantomCards real: cards como filas tonales de radio 12, sin contorno.',
      'Pestañas como segmento plano; la activa con realce tonal.',
      'Cabecera alineada al margen de 16 px, como la de sesión.',
    ]} />
  </Page>,
};

/* ---------- Skills ---------- */
const skills = () => pluginPanel(<PhantomSkills {...demo} />);
export const Skills = {
  render: ({ material }) => <Page title="Skills" problem="La biblioteca de skills repite filas con contorno y una barra de herramientas con su propio fondo.">
    <BeforeAfter height={H} material={material} before={skills()} after={skills()} changes={[
      'Mismo PhantomSkills real: filas tonales de radio 12, sin contorno.',
      'Barra de herramientas sin fondo propio.',
      'Cabecera coherente con la de sesión.',
    ]} />
  </Page>,
};

/* ---------- Memoria ---------- */
const memoria = () => <Host><MemoryCard {...demo} item={memory} /></Host>;
export const Memoria = {
  render: ({ material }) => <Page title="Memoria" problem="La ficha de memoria es legible; hereda el material de objeto actual y sus chips llevan contorno.">
    <BeforeAfter height={H} material={material} before={memoria()} after={memoria()} changes={[
      'Casi solo material: mismo MemoryCard real con material cenital.',
      'Chips de ámbito sin contorno, en tinta tenue.',
    ]} />
  </Page>,
};

/* ---------- Markdown ---------- */
const md = () => <Host><div className="px-panels-read"><SkillsMarkdown source={markdown} /></div></Host>;
export const Markdown = {
  render: ({ material }) => <Page title="Markdown" problem="El texto ya funciona; la comparación confirma que el material propuesto no altera la lectura.">
    <BeforeAfter height={H} material={material} before={md()} after={md()} changes={[]} />
  </Page>,
};

/* ---------- Centro de mando ---------- */
const centro = () => <Host><Panel><Tool type="command-center" /></Panel></Host>;
export const CentroDeMando = {
  render: ({ material }) => <Page title="Centro de mando" problem="Cabecera, avisos, barra de herramientas, filtros y secciones son cajas apiladas; la frescura de datos compite como metadato ruidoso.">
    <BeforeAfter height={H} material={material} before={centro()} after={centro()} changes={[
      'Ambas columnas dentro del envoltorio real (.tw-tool-panel > .tw-content); la propuesta sube el margen interior de 16 a 20 px.',
      'Título en tipo de título; barra Pausar/Actualizar/Desactivar alineada al margen, 8 px entre botones y 16 px bajo el título; botones planos en píldora.',
      '«Frecuencia de actualización» y su selector en una sola fila etiqueta–valor.',
      'Frescura en una línea de apoyo en tinta terciaria; el aviso de desactualizado conserva su color sin peso de título.',
      'Buscador y filtro alineados al margen, 12 px entre ellos y 20 px arriba.',
      'Encargos como filas tonales (12×16 px, radio de fila, 4 px entre filas): título completo, metadatos en apoyo, ruta e ID en mono terciaria.',
      'Secciones y avisos sin contorno.',
    ]} />
  </Page>,
  play: async ({ canvasElement }) => {
    const stage = canvasElement.querySelector('.px-after .px-panels-host');
    stage.style.maxWidth = '320px';
    try {
      const panel = within(stage);
      const search = await panel.findByRole('textbox', { name: 'Buscar tareas' });
      await userEvent.click(search);
      await userEvent.type(search, 'sintético');
      await expect(search).toHaveFocus();
      await expect(search).toHaveValue('sintético');
      await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Filtrar tareas' }), 'blocked');
      await expect(panel.getByRole('combobox', { name: 'Filtrar tareas' })).toHaveValue('blocked');
    } finally { stage.style.maxWidth = ''; }
  },
};
