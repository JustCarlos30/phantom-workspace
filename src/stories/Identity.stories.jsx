import React from 'react';
import AgentIdentity, { CardAgents } from '../components/AgentIdentity';
import GengarMascot from '../components/GengarMascot';
import * as Glyphs from '../components/Glyphs';
import { SHELL_ICONS } from '../components/ShellIcons';
import { ProjectMark } from '../components/ProjectSwitcher';
import { demo } from './decorators';
import { terminalNode, workspace } from './fixtures';

export default { title: 'Identidad' };
export const Agente = { render: () => <div className="catalog-page"><AgentIdentity {...demo} node={terminalNode} /><CardAgents cardId="task-demo" workspace={{ ...workspace, nodes: [terminalNode] }} onOpenPanel={demo.onOpenPanel} /></div> };
export const Marcas = { render: () => <div className="catalog-grid">{['PhantomGlyph', 'PhantomFace', 'ClaudeGlyph', 'OpenCodeGlyph', 'CodexGlyph', 'ShellGlyph', 'AgentGlyph'].map(name => { const Icon = Glyphs[name]; return <div className="catalog-sample" key={name}><Icon size={32} /><p>{name}</p></div>; })}{['claude', 'opencode', 'codex', 'shell'].map(provider => <div className="catalog-sample" key={provider}><Glyphs.ProviderTile provider={provider} /><Glyphs.ProviderGlyph provider={provider} /><p>{provider}</p></div>)}<ProjectMark project={workspace} /></div> };
export const Iconos = { render: () => <div className="catalog-grid">{Object.entries(SHELL_ICONS).map(([name, Icon]) => <div className="catalog-sample" key={name}><Icon size={24} variant="line" /><Icon size={24} variant="solid" /><p>{name}</p></div>)}</div> };
export const Mascota = { render: () => <div className="catalog-background" data-gengar="true"><GengarMascot /><p>Asset local original · Gengar</p></div> };
