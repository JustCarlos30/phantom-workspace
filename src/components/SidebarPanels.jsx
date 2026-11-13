import React from 'react';
import { Bot, Code2, Layers, Maximize2, Search, Sparkles, SquareTerminal } from 'lucide-react';
import { buildSessionRows } from '../hooks/sidebarModel.mjs';
import EmptyState from './EmptyState.jsx';

const agentIcons = { claude: Sparkles, opencode: Code2, codex: Bot, terminal: SquareTerminal };

export default function SidebarPanels({ nodes = [], types, selected, focused, sessions, onJump, onFocus, onSearch, onMap }) {
  const { rows, resources } = buildSessionRows(nodes, sessions);
  const focusButton = node => <button className="rail-panel-focus" title={`Enfocar ${node.title}`} aria-label={`Enfocar ${node.title}`} aria-pressed={focused === node.id} onClick={() => onFocus(node.id)}><Maximize2 size={12} /></button>;
  const resourceRow = node => {
    const Icon = types.find(t => t[0] === node.type)?.[2] || Layers;
    const active = selected.includes(node.id);
    return <div key={node.id} className={`rail-panel-row rail-resource-row ${active ? 'selected' : ''}`}>
      <button onClick={() => onJump(node.id)} title={`${node.title} · Ver en el mapa`} aria-label={`Ver ${node.title} en el mapa`} aria-current={active ? 'true' : undefined}><Icon size={15} /><span>{node.title}</span></button>
      {focusButton(node)}
    </div>;
  };
  return <section className="rail-panels" aria-label="Paneles del proyecto">
    <div className="rail-panel-scroll">
      <section className="rail-panel-group">
        <div className="rail-heading"><span>Sesiones <span className="rail-count">{rows.length}</span></span><button aria-label="Buscar en paneles" title="Buscar paneles · Ctrl Mayús F" onClick={onSearch}><Search size={14} /></button></div>
        <nav aria-label="Sesiones">{rows.map(row => {
          const Icon = agentIcons[row.provider];
          const active = selected.includes(row.id);
          return <div key={row.id} className="rail-session">
            <div className={`rail-panel-row rail-session-row ${active ? 'selected' : ''} ${row.needsYou ? 'needs-you' : ''}`}>
              <button onClick={() => onJump(row.id)} aria-label={`Ver ${row.fullTitle} en el mapa`} aria-current={active ? 'true' : undefined}>
                <span className="rail-agent-mark" aria-hidden="true"><Icon size={18} /><span className={`rail-session-dot ${row.tone}`} /></span>
                <span className="rail-panel-label"><span title={row.fullTitle}>{row.title}</span><span className="rail-session-meta">{[row.statusLabel, row.providerLabel, row.model].filter(Boolean).join(' · ')}</span></span>
              </button>
              {focusButton(row.node)}
            </div>
            {row.resources.length > 0 && <div className="rail-session-resources">{row.resources.map(resourceRow)}</div>}
          </div>;
        })}{!rows.length && <EmptyState className="rail-empty" size="compact" description="Sin terminales en este espacio." />}</nav>
      </section>
      <section className="rail-panel-group">
        <div className="rail-heading"><span>Recursos <span className="rail-count">{resources.length}</span></span></div>
        <nav aria-label="Recursos">{resources.map(resourceRow)}{!resources.length && <EmptyState className="rail-empty" size="compact" description="Sin recursos en este espacio." />}</nav>
      </section>
    </div>
    <button className="rail-map-action" onClick={onMap}><Layers size={15} /> Ver todo el mapa <kbd>0</kbd></button>
  </section>;
}
