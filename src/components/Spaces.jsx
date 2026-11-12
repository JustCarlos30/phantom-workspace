import React, { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { isEditingTarget } from '../hooks/inputOwnership';

// Rail section: the project's spaces, like pages in Figma. Alt + 1…9 switches
// outside editors and terminals; double-click renames.
export default function Spaces({ spaces, active, nodes, onSelect, onCreate, onRename, onRemove }) {
  const [editing, setEditing] = useState(null);
  const input = useRef(null);
  const all = [{ id: null, name: 'Principal' }, ...spaces];
  const count = id => nodes.filter(n => !n.data?.hidden && (id ? n.data?.spaceId === id : !n.data?.spaceId || !spaces.some(s => s.id === n.data.spaceId))).length;
  useEffect(() => { if (editing) input.current?.select(); }, [editing?.id]);
  useEffect(() => {
    const key = e => {
      if (!e.altKey || e.ctrlKey || e.metaKey || isEditingTarget(e.target) || e.target.closest?.('.xterm')) return;
      const index = Number(e.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < all.length && index < 9) { e.preventDefault(); onSelect(all[index].id); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [all.length, spaces, onSelect]);
  const commit = () => {
    if (!editing) return;
    if (editing.id === 'new') { if (editing.value.trim()) onCreate(editing.value); }
    else if (editing.value.trim()) onRename(editing.id, editing.value);
    setEditing(null);
  };
  const field = <input ref={input} className="space-input" aria-label="Nombre del espacio" maxLength={80} value={editing?.value || ''} onChange={e => setEditing({ ...editing, value: e.target.value })} onBlur={commit} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); setEditing(null); } }} autoFocus />;
  return <section className="rail-spaces" aria-label="Espacios del proyecto">
    <div className="rail-heading"><span>Espacios</span><button aria-label="Nuevo espacio" title="Nuevo espacio" onClick={() => setEditing({ id: 'new', value: '' })}><Plus size={14} /></button></div>
    <nav className="space-list">
      {all.map((s, i) => editing?.id === s.id && s.id ? <div key={s.id} className="space-row editing">{field}</div> :
        <div key={s.id || 'main'} className={`space-row ${active === s.id ? 'active' : ''}`}>
          <button className="space-select" aria-current={active === s.id ? 'true' : undefined} title={`${s.name}${i < 9 ? ` · Alt ${i + 1}` : ''}${s.id ? ' · doble clic para renombrar' : ''}`} onClick={() => onSelect(s.id)} onDoubleClick={() => s.id && setEditing({ id: s.id, value: s.name })}>
            <i aria-hidden="true" /><span>{s.name}</span><small>{count(s.id)}</small>
          </button>
          {s.id && <button className="space-remove" aria-label={`Quitar espacio ${s.name}; sus paneles vuelven a Principal`} title="Quitar espacio · los paneles vuelven a Principal" onClick={() => onRemove(s.id)}><X size={12} /></button>}
        </div>)}
      {editing?.id === 'new' && <div className="space-row editing">{field}</div>}
    </nav>
  </section>;
}
