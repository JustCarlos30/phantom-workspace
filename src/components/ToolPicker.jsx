import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import EmptyState from './EmptyState.jsx';

export const TOOL_GROUPS = [['space', 'En el mapa'], ['project', 'Proyecto'], ['automation', 'Automatización'], ['phantom', 'Phantom'], ['plugins', 'Plugins']];

// The launcher behind the dock's "Herramientas": every panel type, grouped by
// what it is for and filtered as you type. Neutral icons keep the labels first.
export default function ToolPicker({ types, disabled, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = types.filter(([, name, , description]) => !needle || `${name} ${description}`.toLowerCase().includes(needle));
  const groups = TOOL_GROUPS.map(([id, title]) => ({ id, title, items: matches.filter(type => (type[4] || 'project') === id) })).filter(group => group.items.length);
  return <div className="tool-picker" role="dialog" aria-label="Añadir a la mesa">
    <div className="popover-heading"><strong>Añadir a la mesa</strong><button className="icon-button" aria-label="Cerrar herramientas" onClick={onClose}><X size={15} /></button></div>
    <label className="tool-search"><Search size={15} aria-hidden="true" /><input autoFocus type="text" value={query} spellCheck={false} aria-label="Buscar herramienta" placeholder="Buscar terminal, git, notas…" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && matches.length && !disabled) { e.preventDefault(); onPick(matches[0][0]); } }} /></label>
    <div className="tool-picker-list">
      {groups.map(group => <section key={group.id} className="tool-group" aria-label={group.title}>
        <h3>{group.title}</h3>
        <div className="tool-grid">{group.items.map(([type, name, Icon, description]) => <button key={type} type="button" className="tool-item" data-group={group.id} disabled={disabled} onClick={() => onPick(type)}><span className="tool-tile" aria-hidden="true"><Icon size={17} /></span><span><strong>{name}</strong><small>{description}</small></span></button>)}</div>
      </section>)}
      {!groups.length && <EmptyState className="small-empty" size="compact" description={<>Ninguna herramienta coincide con «{query.trim()}».</>} />}
    </div>
  </div>;
}
