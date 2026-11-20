import React, { useState } from 'react';
import { CircleDot } from 'lucide-react';
import AgentIdentity, { CardAgents } from '../components/AgentIdentity';
import GengarMascot from '../components/GengarMascot';
import * as Glyphs from '../components/Glyphs';
import TitiGhost from '../components/TitiGhost';
import { SHELL_ICONS } from '../components/ShellIcons';
import { ProjectMark } from '../components/ProjectSwitcher';
import { demo } from './decorators';
import { terminalNode, workspace } from './fixtures';

export default { title: 'Identidad' };
export const Agente = { render: () => <div className="catalog-page"><AgentIdentity {...demo} node={terminalNode} /><CardAgents cardId="task-demo" workspace={{ ...workspace, nodes: [terminalNode] }} onOpenPanel={demo.onOpenPanel} /></div> };
export const Marcas = { render: () => <div className="catalog-grid">{['PhantomGlyph', 'PhantomFace', 'ClaudeGlyph', 'OpenCodeGlyph', 'CodexGlyph', 'ShellGlyph', 'AgentGlyph'].map(name => { const Icon = Glyphs[name]; return <div className="catalog-sample" key={name}><Icon size={32} /><p>{name}</p></div>; })}{['claude', 'opencode', 'codex', 'shell'].map(provider => <div className="catalog-sample" key={provider}><Glyphs.ProviderTile provider={provider} /><Glyphs.ProviderGlyph provider={provider} /><p>{provider}</p></div>)}<ProjectMark project={workspace} /></div> };
export const Iconos = { render: () => <div className="catalog-grid">{Object.entries(SHELL_ICONS).map(([name, Icon]) => <div className="catalog-sample" key={name}><Icon size={24} variant="line" /><Icon size={24} variant="solid" /><p>{name}</p></div>)}</div> };
const TITI_MOODS = ['calm', 'working', 'grin', 'unsure', 'asleep'];
const TITI_LABELS = { calm: 'Calma', working: 'Trabajando', grin: 'Necesita', unsure: 'Falló', asleep: 'Dormido' };

// Harness: un solo canvas que cambia de mood con botones, para verificar la transición estando parado.
function TitiLive() {
  const [mood, setMood] = useState('calm');
  return <div className="catalog-sample" data-titi-live>
    <TitiGhost className="titi-ghost titi-live" mood={mood} size={32} />
    <div role="group" aria-label="Mood de Titi">{TITI_MOODS.map(key => <button key={key} type="button" aria-pressed={mood === key} onClick={() => setMood(key)}>{TITI_LABELS[key]}</button>)}</div>
  </div>;
}

export const Titi = { render: () => <div className="catalog-page" data-titi-shell><div className="catalog-grid">{TITI_MOODS.map(mood => <div className="catalog-sample" key={mood}><TitiGhost className="titi-ghost" mood={mood} size={32} data-mood-sample={mood} /><p>{mood}</p></div>)}<TitiLive /><div className="catalog-sample" data-titi-slot="marca"><span className="brand-mark"><Glyphs.PhantomFace mood="calm" /><Glyphs.PhantomGlyph className="brand-state-fallback" size={17} /></span><p>marca</p></div><div className="catalog-sample" data-titi-slot="notch"><button className="activity-notch" type="button" aria-expanded="false"><Glyphs.PhantomFace mood="working" /><CircleDot className="notch-state-fallback" size={14} aria-hidden="true" /></button><p>notch</p></div><div className="catalog-sample" data-titi-slot="chat"><button className="icon-button phantom-chat-toggle" type="button" aria-label="Abrir Phantom"><Glyphs.PhantomGlyph mood="calm" size={17} /></button><p>chat</p></div></div></div> };
export const Mascota ={ render: () => <div className="catalog-background" data-gengar="true"><GengarMascot /><p>Asset local original · Gengar</p></div> };
