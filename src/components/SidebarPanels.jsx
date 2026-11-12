import React from 'react';
import { Layers, Maximize2, Search } from 'lucide-react';
import { TerminalActivityStatus } from './ActivityNotch';

export default function SidebarPanels({ nodes = [], types, selected, sessions, onJump, onFocus, onSearch, onMap }) {
  const visible = nodes.filter(n => !n.data?.hidden);
  const groups = [['Sesiones', visible.filter(n => n.type === 'terminal')], ['Recursos', visible.filter(n => n.type !== 'terminal')]];
  return <section className="rail-panels" aria-label="Paneles del proyecto">
    <div className="rail-panel-scroll">{groups.map(([title, items]) => <section className="rail-panel-group" key={title}>
      <div className="rail-heading"><span>{title} <span className="rail-count">{items.length}</span></span>{title === 'Sesiones' && <button aria-label="Buscar en paneles" title="Buscar paneles · Ctrl Mayús F" onClick={onSearch}><Search size={14} /></button>}</div>
      <nav aria-label={title}>{items.map(node => {
        const Icon = types.find(t => t[0] === node.type)?.[2] || Layers;
        const active = selected.includes(node.id);
        return <div key={node.id} className={`rail-panel-row ${active ? 'selected' : ''}`}>
          <button onClick={() => onJump(node.id)} title={`${node.title} · Ver en el mapa`} aria-current={active ? 'true' : undefined}><Icon size={15} /><span className="rail-panel-label"><span>{node.title}</span>{node.type === 'terminal' && <TerminalActivityStatus session={sessions[node.id]} compact />}</span></button>
          <button className="rail-panel-focus" title={`Enfocar ${node.title}`} aria-label={`Enfocar ${node.title}`} onClick={() => onFocus(node.id)}><Maximize2 size={12} /></button>
        </div>;
      })}{!items.length && <p className="rail-empty">{title === 'Sesiones' ? 'Sin terminales en este espacio.' : 'Sin recursos en este espacio.'}</p>}</nav>
    </section>)}</div>
    <button className="rail-map-action" onClick={onMap}><Layers size={15} /> Ver todo el mapa <kbd>0</kbd></button>
  </section>;
}
