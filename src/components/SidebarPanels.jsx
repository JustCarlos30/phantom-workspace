import React from 'react';
import { Maximize2, Search } from 'lucide-react';
import { LayersIcon as Layers, SessionsIcon, ResourcesIcon, MapIcon } from './ShellIcons.jsx';
import { buildSessionRows } from '../hooks/sidebarModel.mjs';
import EmptyState from './EmptyState.jsx';
import { ProviderGlyph } from './Glyphs';

export default function SidebarPanels({ nodes = [], types, selected, focused, sessions, onJump, onFocus, onSearch, onMap }) {
  const { rows, resources } = buildSessionRows(nodes, sessions);
  const focusButton = node => <button className="rail-panel-focus" title={`Enfocar ${node.title}`} aria-label={`Enfocar ${node.title}`} aria-pressed={focused === node.id} onClick={() => onFocus(node.id)}><Maximize2 size={16} /></button>;
  const resourceRow = node => {
    const Icon = types.find(t => t[0] === node.type)?.[2] || Layers;
    const active = selected.includes(node.id);
    return <div key={node.id} className={`rail-panel-row rail-resource-row ${active ? 'selected' : ''}`}>
      <button onClick={() => onJump(node.id)} title={`${node.title} · Ver en el mapa`} aria-label={`Ver ${node.title} en el mapa`} aria-current={active ? 'true' : undefined}><span className="rail-agent-mark" aria-hidden="true"><Icon size={18} variant="line" /></span><span>{node.title}</span></button>
      {focusButton(node)}
    </div>;
  };
  return <section className="rail-panels" aria-label="Paneles del proyecto">
    <div className="rail-panel-scroll">
      <section className="rail-panel-group">
        <div className="rail-heading"><span><SessionsIcon size={16} /> Sesiones <span className="rail-count">{rows.length}</span></span><button aria-label="Buscar en paneles" title="Buscar paneles · Ctrl Mayús F" onClick={onSearch}><Search size={14} /></button></div>
        <nav aria-label="Sesiones">{rows.map(row => {
          const active = selected.includes(row.id);
          return <div key={row.id} className="rail-session">
            <div className={`rail-panel-row rail-session-row ${active ? 'selected' : ''} ${row.needsYou ? 'needs-you' : ''}`} data-state={row.needsYou ? 'attention' : row.tone === 'working' ? 'working' : 'rest'}>
              <button onClick={() => onJump(row.id)} title={`${row.fullTitle} · Ver en el mapa`} aria-label={`Ver ${row.fullTitle} en el mapa`} aria-describedby={`rail-meta-${row.id}`} aria-current={active ? 'true' : undefined}>
                <span className="rail-agent-mark" aria-hidden="true"><ProviderGlyph provider={row.provider === 'terminal' ? 'shell' : row.provider} size={18} /></span>
                <span className="rail-panel-label"><span title={row.fullTitle}>{row.title}</span><span id={`rail-meta-${row.id}`} className="rail-session-meta" title={[row.providerLabel, row.statusLabel, row.time].filter(Boolean).join(' · ')}><span className="rail-session-type">{row.providerLabel}</span><span className="rail-session-status">{row.statusLabel}</span>{row.time && <span className="rail-session-time">{row.time}</span>}</span></span>
              </button>
              {focusButton(row.node)}
            </div>
            {row.resources.length > 0 && <div className="rail-session-resources">{row.resources.map(resourceRow)}</div>}
          </div>;
        })}{!rows.length && <EmptyState className="rail-empty" size="compact" description="Sin terminales en este espacio." />}</nav>
      </section>
      <section className="rail-panel-group">
        <div className="rail-heading"><span><ResourcesIcon size={16} /> En el mapa <span className="rail-count">{resources.length}</span></span></div>
        <nav aria-label="En el mapa">{resources.map(resourceRow)}{!resources.length && <EmptyState className="rail-empty" size="compact" description="Aún no hay notas, navegadores ni paneles." />}</nav>
      </section>
    </div>
    <button className="rail-map-action" aria-pressed={!focused && !selected.length} onClick={onMap}><MapIcon size={20} /> Ver todo el mapa <kbd>0</kbd></button>
  </section>;
}
