import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Folder, FolderOpen, Search } from 'lucide-react';
import { accentColor, loadAppearance } from '../hooks/useAppearance';

// Both context menus stay inside the rail, so they never cover native views.
export function useContextSwitcher(open, onOpenChange) {
  const root = useRef(null);
  const trigger = useRef(null);
  const search = useRef(null);
  const [maxHeight, setMaxHeight] = useState(null);
  const change = useRef(onOpenChange); change.current = onOpenChange;
  const close = (restore = false) => {
    onOpenChange(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const rail = root.current?.closest('.project-rail');
      if (!rail) return;
      const bottom = rail.querySelector('.rail-bottom')?.getBoundingClientRect().top || rail.getBoundingClientRect().bottom;
      setMaxHeight(Math.max(100, bottom - root.current.getBoundingClientRect().bottom - 8));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root.current.closest('.project-rail'));
    window.addEventListener('resize', measure);
    search.current?.focus({ preventScroll: true });
    root.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    const outside = e => { if (!root.current?.contains(e.target)) change.current(false); };
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', measure); observer.disconnect(); };
  }, [open]);
  const onKeyDown = e => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const buttons = [...root.current.querySelectorAll('nav button:not(:disabled)')];
    const index = buttons.indexOf(e.target);
    if (e.target === search.current && e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation(); buttons[0]?.focus();
    } else if (index >= 0 && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
      buttons[next]?.focus();
      buttons[next]?.scrollIntoView({ block: 'nearest' });
    }
  };
  const onBlur = e => { if (!e.currentTarget.contains(e.relatedTarget)) onOpenChange(false); };
  return { root, trigger, search, close, onKeyDown, onBlur, style: { '--context-menu-height': maxHeight ? `${maxHeight}px` : undefined } };
}

const initials = name => name?.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || 'P';

export function ProjectMark({ project, small = false }) {
  return <span className="project-initials" style={small ? { '--project-mark-size': '28px' } : undefined}>{project ? initials(project.name) : <Folder size={16} />}</span>;
}

export default function ProjectSwitcher({ projects, active, open, onOpenChange, onSelect, onOpenFolder, busy }) {
  const [query, setQuery] = useState('');
  const menu = useContextSwitcher(open, onOpenChange);
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  const filtered = projects.filter(w => `${w.name} ${w.path} ${w.canonicalPath || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  // Keep the current context reachable even while filtering other projects.
  const visible = active ? [active, ...filtered.filter(w => w.id !== active.id)] : filtered;
  return <details ref={menu.root} className="project-switcher context-switcher" open={open} onKeyDown={menu.onKeyDown} onBlur={menu.onBlur}>
    <summary ref={menu.trigger} aria-expanded={open} aria-controls="project-context-menu" title={active?.path || 'Elegir proyecto'} onClick={e => { e.preventDefault(); onOpenChange(!open); }}>
      <ProjectMark project={active} />
      <span className="project-switcher-label"><small>Proyecto</small><strong>{active?.name || 'Elegir proyecto'}</strong></span><ChevronDown size={14} />
    </summary>
    {open && <div id="project-context-menu" className="context-menu-panel" style={menu.style}>
      <label className="context-search"><Search size={14} /><input ref={menu.search} aria-label="Buscar proyectos por nombre o ruta" placeholder="Nombre o ruta…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {query && !filtered.length && <p className="context-empty" role="status">Sin proyectos que coincidan.</p>}
      <nav className="project-list" aria-label="Proyectos recientes">{visible.map(w => <button key={w.id} className={`project-item ${w.id === active?.id ? 'active' : ''}`} style={{ '--project-accent': accentColor(loadAppearance(w.id).accent) }} aria-current={w.id === active?.id ? 'true' : undefined} aria-describedby={`project-path-${w.id}`} onClick={() => { menu.close(true); onSelect(w.id); }} title={`${w.name}\nCarpeta: ${w.path}\nRuta canónica: ${w.canonicalPath || w.path}`}><ProjectMark project={w} small /><span><strong>{w.name}</strong><small id={`project-path-${w.id}`}>{w.path}</small></span></button>)}</nav>
      <button className="open-folder" onClick={() => { menu.close(true); onOpenFolder(); }} disabled={busy}><FolderOpen size={16} /> Abrir carpeta</button>
    </div>}
  </details>;
}
