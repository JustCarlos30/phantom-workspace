import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Pencil, Plus, Search, X } from 'lucide-react';
import { isEditingTarget } from '../hooks/inputOwnership';
import { useContextSwitcher } from './ProjectSwitcher';

// Rail section: the project's spaces, like pages in Figma. Alt + 1…9 switches
// outside editors and terminals; double-click renames.
export default function Spaces({ spaces, active, nodes, onSelect, onCreate, onRename, onRemove, open, onOpenChange }) {
  const [editing, setEditing] = useState(null);
  const editingRef = useRef(null);
  const [query, setQuery] = useState('');
  const menu = useContextSwitcher(open, onOpenChange);
  const input = useRef(null);
  const selectionTimer = useRef(null);
  useEffect(() => () => clearTimeout(selectionTimer.current), []);
  const all = [{ id: null, name: 'Principal' }, ...spaces];
  const current = all.find(s => s.id === active) || all[0];
  const filtered = all.filter(s => s.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visible = [all[0], ...(current.id ? [current] : []), ...filtered.filter(s => s.id && s.id !== current.id)];
  const changeEditing = value => { clearTimeout(selectionTimer.current); editingRef.current = value; setEditing(value); };
  useEffect(() => { if (!open) { clearTimeout(selectionTimer.current); setQuery(''); editingRef.current = null; setEditing(null); } }, [open]);
  const count = id => nodes.filter(n => !n.data?.hidden && (id ? n.data?.spaceId === id : !n.data?.spaceId || !spaces.some(s => s.id === n.data.spaceId))).length;
  useEffect(() => { if (editing) input.current?.select(); }, [editing?.id]);
  useEffect(() => {
    const key = e => {
      if (!e.altKey || e.ctrlKey || e.metaKey || isEditingTarget(e.target) || e.target.closest?.('.xterm')) return;
      const index = Number(e.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < all.length && index < 9) { e.preventDefault(); menu.close(open); onSelect(all[index].id); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [all.length, spaces, onSelect, open, onOpenChange]);
  const commit = () => {
    const draft = editingRef.current;
    if (!draft) return;
    changeEditing(null); // Clear synchronously before Enter causes blur.
    if (draft.value.trim()) {
      if (draft.id === 'new') onCreate(draft.value.trim());
      else onRename(draft.id, draft.value.trim());
    }
  };
  const field = <input ref={input} className="space-input" aria-label="Nombre del espacio" maxLength={80} value={editing?.value || ''} onChange={e => changeEditing({ ...editingRef.current, value: e.target.value })} onBlur={commit} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(); menu.search.current?.focus(); } if (e.key === 'Escape') { e.preventDefault(); changeEditing(null); menu.search.current?.focus(); } }} autoFocus />;
  return <section ref={menu.root} className="rail-spaces context-switcher" aria-label="Espacios del proyecto" onKeyDown={menu.onKeyDown} onBlur={menu.onBlur}>
    <button ref={menu.trigger} className="space-switcher-trigger" aria-expanded={open} aria-controls="space-context-menu" title={`Espacio: ${current.name}`} onClick={() => onOpenChange(!open)}><span className="project-switcher-label"><small>Espacio</small><strong>{current.name}</strong></span><ChevronDown size={14} /></button>
    {open && <div id="space-context-menu" className="context-menu-panel" style={menu.style}>
      <label className="context-search"><Search size={14} /><input ref={menu.search} aria-label="Buscar espacios" placeholder="Buscar espacio…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {query && !filtered.length && <p className="context-empty" role="status">Sin espacios que coincidan.</p>}
      <nav className="space-list" aria-label="Espacios">
      {visible.map(s => editing?.id === s.id && s.id ? <div key={s.id} className="space-row editing">{field}</div> :
        <div key={s.id || 'main'} className={`space-row ${active === s.id ? 'active' : ''}`}>
          <button className="space-select" aria-current={active === s.id ? 'true' : undefined} title={`${s.name}${all.indexOf(s) < 9 ? ` · Alt ${all.indexOf(s) + 1}` : ''}${s.id ? ' · doble clic para renombrar' : ''}`} onClick={e => {
            clearTimeout(selectionTimer.current);
            const select = () => { onSelect(s.id); menu.close(true); };
            if (!e.detail || !s.id) select();
            else if (e.detail === 1) selectionTimer.current = setTimeout(select, 250);
          }} onDoubleClick={() => { clearTimeout(selectionTimer.current); if (s.id) changeEditing({ id: s.id, value: s.name }); }}>
            <i aria-hidden="true" /><span>{s.name}</span><small>{count(s.id)}</small>
          </button>
          {s.id && <><button className="space-rename" aria-label={`Renombrar espacio ${s.name}`} title="Renombrar espacio" onClick={() => changeEditing({ id: s.id, value: s.name })}><Pencil size={12} /></button><button className="space-remove" aria-label={`Quitar espacio ${s.name}; sus paneles vuelven a Principal`} title="Quitar espacio · los paneles vuelven a Principal" onClick={() => { onRemove(s.id); menu.search.current?.focus(); }}><X size={12} /></button></>}
        </div>)}
      {editing?.id === 'new' && <div className="space-row editing">{field}</div>}
      </nav>
      <button className="space-create open-folder" onClick={() => changeEditing({ id: 'new', value: '' })}><Plus size={14} /> Nuevo espacio</button>
    </div>}
  </section>;
}
