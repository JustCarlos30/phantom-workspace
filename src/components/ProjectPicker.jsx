import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderOpen, Search, X } from 'lucide-react';
import { sortProjects } from '../../shared/project-usage.mjs';
import { Button } from './ToolPanels.jsx';
import { Presence } from './Presence';
import EmptyState from './EmptyState.jsx';
import '../tools.css';
import '../keyboard-navigation.css';

export default function ProjectPicker({ open, onClose, projects = [], active, onSelect, onOpenFolder, busy = false, statusOf }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
  const input = useRef(null), dialog = useRef(null), id = useId();
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const sorted = useMemo(() => {
    const rank = { attention: 0, working: 1, rest: 2 };
    const list = sortProjects(projects, active?.id).map(project => ({ project, status: statusOf?.(project) || null }));
    return list.sort((a, b) => (b.project.id === active?.id) - (a.project.id === active?.id) || (rank[a.status?.state] ?? 2) - (rank[b.status?.state] ?? 2)).map(i => i.project);
  }, [projects, active?.id, statusOf]);
  const results = sorted.filter(project => normalize(`${project.name} ${project.path} ${project.canonicalPath || ''}`).includes(normalize(query.trim())));
  const activeIndex = Math.min(selected, Math.max(0, results.length - 1));
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement, surface = dialog.current;
    setQuery(''); setSelected(0);
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      if (previous?.isConnected && !previous.closest?.('[inert], [hidden]') && (document.activeElement === document.body || surface?.contains(document.activeElement))) previous.focus?.({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => { dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [activeIndex, query]);
  const choose = project => { if (project && !busy) { onClose(); onSelect(project.id); } };
  return createPortal(<Presence show={open}>{open && <div className="tw-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialog} className="tw-palette tw-project-picker" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onKeyDown={e => {
      e.stopPropagation();
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.target === input.current && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setSelected(results.length ? (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0); }
      if (e.key === 'Enter' && e.target === input.current) { e.preventDefault(); choose(results[activeIndex]); }
      if (e.key === 'Tab') {
        const focusable = [...dialog.current.querySelectorAll('input,button:not(:disabled):not([tabindex="-1"])')];
        const first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="tw-inspector-header"><div><h2 id={`${id}-title`}>Cambiar proyecto</h2><p>Busca por nombre o ruta</p></div><Button icon={X} aria-label="Cerrar selector de proyectos" onClick={onClose} /></header>
      <div className="tw-palette-search"><Search size={19} aria-hidden="true" /><input ref={input} role="combobox" aria-label="Buscar proyectos por nombre o ruta" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={results[activeIndex] ? `${id}-${activeIndex}` : undefined} value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} placeholder="Nombre o ruta…" /></div>
      <p id={`${id}-help`} className="tw-palette-context">Flechas para elegir · Enter para cambiar · Esc para cerrar</p>
      <ul id={`${id}-list`} className="tw-palette-results" role="listbox" aria-label="Proyectos" aria-busy={busy}>{results.map((project, index) => <li key={project.id} id={`${id}-${index}`} role="option" aria-selected={activeIndex === index} aria-disabled={busy || undefined}><button type="button" tabIndex={-1} disabled={busy} aria-current={project.id === active?.id ? 'true' : undefined} onMouseMove={() => setSelected(index)} onClick={() => choose(project)}><span className="tw-project-label"><strong>{project.name}</strong><small>{project.path || project.canonicalPath}</small></span>{(status => status && <span className={`tw-project-status is-${status.state}`}><i aria-hidden="true" />{status.label}</span>)(statusOf?.(project))}{project.id === active?.id && <span className="tw-project-current"><Check size={15} aria-hidden="true" /> Actual</span>}</button></li>)}</ul>
      {!results.length && <EmptyState className="tw-empty" size="compact" description={projects.length ? 'No hay proyectos que coincidan con la búsqueda.' : 'Todavía no hay proyectos. Abre una carpeta para empezar.'} />}
      <footer className="tw-keyboard-footer"><span role="status">{busy ? 'Abriendo proyecto…' : `${results.length} ${results.length === 1 ? 'proyecto' : 'proyectos'}`}</span><Button icon={FolderOpen} disabled={busy} onClick={() => { onClose(); onOpenFolder(); }}>Abrir carpeta</Button></footer>
    </div>
  </div>}</Presence>, document.body);
}
