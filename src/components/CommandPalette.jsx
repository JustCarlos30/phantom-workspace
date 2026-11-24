import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { Button } from './ToolPanels.jsx';
import { HUBS, HUB_ORDER } from '../hooks/hubs.mjs';
import { COMMANDS, formatBinding, resolveBindings } from '../hooks/workspace-commands.mjs';
import { Presence } from './Presence';
import '../tools.css';
import '../keyboard-navigation.css';
import EmptyState from './EmptyState.jsx';

export function CommandPalette({ open, onClose, workspace, bindings, onAction }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
  const input = useRef(null), dialog = useRef(null), listId = useId();
  const shortcuts = resolveBindings(bindings);
  const actions = useMemo(() => [
    { title: 'Abrir carpeta', group: 'Proyecto', action: { type: 'openFolder' } },
    { title: 'Apariencia', group: 'Ir a', action: { type: 'appearance' } },
    ...(workspace ? [
      ...HUB_ORDER.flatMap(id => [{ title: HUBS[id].name, group: 'Ir a', action: { type: 'create', panelType: id } }, ...HUBS[id].tabs.slice(1).map(tab => ({ title: `${HUBS[id].name} · ${tab[1]}`, group: 'Ir a', action: { type: 'create', panelType: tab[2] === 'sites' ? id : tab[2] } }))]),
      { title: 'Configuración', group: 'Ir a', action: { type: 'tool', tab: 'settings' } },
      { title: 'Configuración · Conexiones', group: 'Ir a', action: { type: 'tool', tab: 'plugins' } },
      { title: 'Ver todo el mapa', group: 'Navegación', command: 'fit-all', action: { type: 'fit-all' } },
      { title: 'Buscar paneles del proyecto', group: 'Navegación', command: 'panels', action: { type: 'panels' } },
      { title: 'Preguntar a Phantom', group: workspace.name, action: { type: 'phantom-chat' } },
      { title: 'Capturar voz o escribir intención', group: workspace.name, action: { type: 'voice' } },
      { title: 'Dictado por voz · Ctrl/Cmd + Shift + M', group: workspace.name, action: { type: 'dictation' } },
      ...(workspace.nodes || []).map(node => ({ title: node.title || node.type, group: 'En el mapa', action: { type: 'panel', id: node.id } })),
      ...[['terminal', 'Nueva terminal'], ['browser', 'Nuevo navegador'], ['note', 'Nueva nota'], ['zone', 'Nueva zona']].map(([panelType, title]) => ({ title, group: 'Crear', command: `create-${panelType}`, action: { type: 'create', panelType } })),
    ] : []),
    ...COMMANDS.filter(command => !['palette', 'panels', 'fit-all', 'create-terminal', 'create-browser', 'create-note', 'create-zone'].includes(command.id) && (workspace || ['projects', 'shortcuts'].includes(command.id))).map(command => ({ title: command.title, group: command.group, command: command.id, action: { type: command.id } })),
  ], [workspace]);
  const results = actions.filter(item => `${item.title} ${item.group}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
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
  const choose = item => { if (item) { onAction(item.action); onClose(); } };
  return createPortal(<Presence show={open}>{open && <div className="tw-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={dialog} className="tw-palette" role="dialog" aria-modal="true" aria-label="Paleta del workspace" onKeyDown={e => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.target === input.current && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setSelected(results.length ? (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0); }
    if (e.key === 'Enter' && e.target === input.current) { e.preventDefault(); choose(results[activeIndex]); }
    if (e.key === 'Tab') { const focusable = [...dialog.current.querySelectorAll('input,button:not(:disabled):not([tabindex="-1"])')]; const first = focusable[0], last = focusable.at(-1); if (e.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) { e.preventDefault(); first?.focus(); } }
  }}>
    <div className="tw-palette-search"><Search size={19} aria-hidden="true" /><input ref={input} role="combobox" aria-label="Buscar paneles y herramientas" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={results[activeIndex] ? `${listId}-${activeIndex}` : undefined} value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} placeholder="Buscar panel, herramienta o acción…" /><Button icon={X} aria-label="Cerrar paleta" onClick={onClose} /></div>
    <p className="tw-palette-context">{workspace?.name || 'Sin workspace'} · Flechas para elegir, Enter para abrir</p>
    <ul id={listId} role="listbox" aria-label="Resultados" className="tw-palette-results">{results.map((item, index) => <li role="option" id={`${listId}-${index}`} aria-selected={activeIndex === index} key={`${item.group}:${item.title}:${index}`}><button type="button" tabIndex={-1} onMouseMove={() => setSelected(index)} onClick={() => choose(item)}><span>{item.title}</span><span className="tw-command-meta"><small>{item.group}</small>{item.command && <kbd>{formatBinding(shortcuts[item.command])}</kbd>}</span></button></li>)}</ul>
    {!results.length && <EmptyState className="tw-empty" size="compact" description="No hay coincidencias. Busca por título del panel o nombre de herramienta." />}
  </div></div>}</Presence>, document.body);
}
