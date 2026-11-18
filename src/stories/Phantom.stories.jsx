import React from 'react';
import { PhantomCards } from '../components/PhantomCards';
import { PhantomSkills } from '../components/PhantomSkills';
import { PhantomConvencions } from '../components/PhantomConvencions';
import SkillsCatalog from '../components/SkillsCatalog';
import MemoryCard, { MemoryForm } from '../components/MemoryCard';
import { Markdown } from '../components/SkillsMarkdown';
import { demo, Panel } from './decorators';
import { markdown, date, skill } from './fixtures';
import { within, userEvent } from 'storybook/test';

function PhantomPanel({ host, children }) {
  if (host === 'canvas') return <section className="canvas-node" style={{ position: 'relative', width: '100%', height: 720 }}><div className="node-body"><div className="tw-tool-panel"><div className="plugin-surface">{children}</div></div></div></section>;
  if (host === 'inspector') return <aside className="tw-inspector" style={{ width: '100%', height: 720 }}><div className="plugin-surface">{children}</div></aside>;
  return <Panel>{children}</Panel>;
}
export default { title: 'Phantom', args: { host: 'catalog' }, argTypes: { host: { control: 'select', options: ['catalog', 'canvas', 'inspector'] } }, decorators: [Story => <div className="plugin-surface"><Story /></div>] };
export const Cards = { render: args => <PhantomPanel {...args}><PhantomCards {...demo} /></PhantomPanel> };
export const ContratoCard = { render: args => <PhantomPanel {...args}><PhantomCards {...demo} node={{ data: { cardId: 'task-1' } }} /></PhantomPanel> };
export const NuevaCard = { ...Cards, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Nueva Card' })); } };
export const Tablero = { ...Cards, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Tablero' })); } };
export const Skills = { render: args => <PhantomPanel {...args}><PhantomSkills {...demo} /></PhantomPanel> };
export const DetalleSkill = {
  render: args => <PhantomPanel {...args}><PhantomSkills {...demo} node={{ data: { skillId: 'skill-demo' } }} /></PhantomPanel>,
  parameters: { host: { overrides: { 'phantom.detail': () => ({ ...skill, available: true, manifest: { ...skill.manifest, id: skill.ref.id, version: skill.ref.version } }) } } },
};
export const NuevaSkill = { ...Skills, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Nueva Skill' })); } };
export const CatalogoSkills = { render: args => <PhantomPanel {...args}><SkillsCatalog {...demo} /></PhantomPanel> };
export const Convenciones = { render: () => <Panel><PhantomConvencions {...demo} type="convencions-base" /></Panel> };
export const DetalleConvencion = { ...Convenciones, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: /Patrón observado/ })); } };
export const Memoria = { render: () => <MemoryCard {...demo} item={{ id: 'memory-demo', kind: 'decision', title: 'Decisión sintética', body: markdown, scope: '.', space: 'project', revision: 1, state: 'active', updatedAt: date, evidence: [] }} /> };
export const FormularioMemoria = { render: () => <MemoryForm {...demo} /> };
export const MarkdownSkills = { render: () => <Markdown source={markdown} /> };
