import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import EmptyState from './EmptyState.jsx';
import { readUsage, usagePersisted, updateUsage, frequentTools, hideTool, setPaused, resetUsage, localStorageOrNull } from '../hooks/tool-usage.mjs';
import '../tool-usage.css';

export const TOOL_GROUPS = [['space', 'En el mapa'], ['project', 'Proyecto'], ['automation', 'Automatización'], ['phantom', 'Phantom'], ['plugins', 'Plugins']];

// The launcher behind the dock's "Herramientas": every panel type, grouped by
// what it is for and filtered as you type. Neutral icons keep the labels first.
export default function ToolPicker({ types, disabled, onPick, onClose, workspaceId = 'default', storage }) {
  const store = storage === undefined ? localStorageOrNull() : storage;
  const [query, setQuery] = useState('');
  const [usage, setUsage] = useState(() => readUsage(store, workspaceId));
  const [persisted, setPersisted] = useState(() => usagePersisted(store, workspaceId));
  const change = fn => { const result = updateUsage(store, workspaceId, fn); setUsage(result.usage); setPersisted(result.persisted); };
  const frequent = frequentTools(usage, types.map(type => type[0])).map(id => types.find(type => type[0] === id));
  const needle = query.trim().toLowerCase();
  const matches = types.filter(([, name, , description]) => !needle || `${name} ${description}`.toLowerCase().includes(needle));
  const groups = TOOL_GROUPS.map(([id, title]) => ({ id, title, items: matches.filter(type => (type[4] || 'project') === id) })).filter(group => group.items.length);
  return <div className="tool-picker" role="dialog" aria-label="Añadir a la mesa">
    <div className="popover-heading"><strong>Añadir a la mesa</strong><button className="icon-button" aria-label="Cerrar herramientas" onClick={onClose}><X size={15} /></button></div>
    <label className="tool-search"><Search size={15} aria-hidden="true" /><input autoFocus type="text" value={query} spellCheck={false} aria-label="Buscar herramienta" placeholder="Buscar terminal, git, notas…" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && matches.length && !disabled) { e.preventDefault(); onPick(matches[0][0]); } }} /></label>
    <div className="tool-picker-list">
      {!needle && <section className="tool-group tool-frequent" aria-label="Frecuentes en este proyecto">
        <h3>Frecuentes en este proyecto</h3>
        {frequent.length ? <div className="tool-grid">{frequent.map(([type, name, Icon, description]) => <div key={type} className="tool-frequent-row">
          <button type="button" className="tool-item" disabled={disabled} onClick={() => onPick(type, 'frequent')}><span className="tool-tile" aria-hidden="true"><Icon size={17} /></span><span><strong>{name}</strong><small>{description}</small></span></button>
          <button type="button" className="tool-frequent-hide" aria-label={`No sugerir ${name}`} title="No sugerir" onClick={() => change(u => hideTool(u, type))}>No sugerir</button>
        </div>)}</div> : <p className="tool-frequent-empty">{usage.paused ? 'Aprendizaje en pausa.' : 'Aquí aparecerán las herramientas que uses más en este proyecto.'}</p>}
        {!persisted && <p className="tool-frequent-note" role="status">No se pudo guardar en este dispositivo; los cambios durarán hasta cerrar.</p>}
        <details className="tool-frequent-details">
          <summary>Preferencias y uso</summary>
          <div className="tool-frequent-controls">
            <button type="button" onClick={() => change(u => setPaused(u, !u.paused))}>{usage.paused ? 'Reanudar aprendizaje' : 'Pausar aprendizaje'}</button>
            <button type="button" onClick={() => change(resetUsage)}>Borrar historial</button>
          </div>
          <dl className="tool-frequent-stats">
            <dt>Aperturas exitosas registradas</dt><dd>{usage.stats.total}</dd>
            <dt>Desde frecuentes</dt><dd>{usage.stats.fromFrequent}</dd>
            <dt>Descartes</dt><dd>{usage.stats.dismissed}</dd>
          </dl>
          <small>Datos locales de este dispositivo.</small>
        </details>
      </section>}
      {groups.map(group => <section key={group.id} className="tool-group" aria-label={group.title}>
        <h3>{group.title}</h3>
        <div className="tool-grid">{group.items.map(([type, name, Icon, description]) => <button key={type} type="button" className="tool-item" data-group={group.id} disabled={disabled} onClick={() => onPick(type)}><span className="tool-tile" aria-hidden="true"><Icon size={17} /></span><span><strong>{name}</strong><small>{description}</small></span></button>)}</div>
      </section>)}
      {!groups.length && <EmptyState className="small-empty" size="compact" description={<>Ninguna herramienta coincide con «{query.trim()}».</>} />}
    </div>
  </div>;
}
