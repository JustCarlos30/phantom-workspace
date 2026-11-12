import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { Button, TOOL_TITLES } from './ToolPanels.jsx';
import { Presence } from './Presence';
import '../tools.css';
import { PLUGIN_MANIFESTS } from '../../shared/plugins.mjs';
import EmptyState from './EmptyState.jsx';

export function CommandPalette({ open, onClose, workspace, onAction }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
  const input = useRef(null), dialog = useRef(null), previousFocus = useRef(null), listId = useId();
  const actions = useMemo(() => [
    { title: 'Abrir carpeta', group: 'Workspace', action: { type: 'openFolder' } },
    { title: 'Personalizar espacio · fondo y apariencia', group: 'Workspace', action: { type: 'appearance' } },
    ...(workspace ? [
      { title: 'Abrir catálogo de Skills', group: 'Herramientas', action: { type: 'create', panelType: 'skills-catalog' } },
      { title: 'Abrir Centro de mando', group: 'Plugins', action: { type: 'create', panelType: 'command-center' } },
      { title: 'Abrir Centro de Plugins', group: 'Plugins', action: { type: 'create', panelType: 'plugins' } },
      ...PLUGIN_MANIFESTS.filter(plugin => workspace.plugins?.[plugin.id]?.enabled).flatMap(plugin => plugin.actions.map(action => ({ title: action.name, group: plugin.name, action: { type: 'create', panelType: plugin.panels.find(panel => panel.id === action.panelId).nodeType, data: { pluginId: plugin.id, panelId: action.panelId } } }))),
      { title: 'Ver todo el mapa', group: 'Navegación', action: { type: 'fit-all' } },
      { title: 'Buscar paneles del proyecto', group: 'Navegación', action: { type: 'panels' } },
      { title: 'Preguntar a Phantom', group: workspace.name, action: { type: 'phantom-chat' } },
      { title: 'Capturar voz o escribir intención', group: workspace.name, action: { type: 'voice' } },
      ...Object.entries(TOOL_TITLES).filter(([tab]) => tab !== 'mission' && tab !== 'skills-catalog' && !PLUGIN_MANIFESTS.some(plugin => plugin.panels.some(panel => panel.nodeType === tab))).map(([tab, title]) => ({ title, group: 'Herramientas', action: { type: 'tool', tab } })),
      ...(workspace.nodes || []).map(node => ({ title: node.title || node.type, group: `Panel · ${node.type}`, action: { type: 'panel', id: node.id } })),
      ...['terminal', 'browser', 'note', 'tasks', 'context', 'repo', 'git', 'branches', 'incorporaciones', 'services', 'docker', 'mission', 'workflows', 'playwright', 'playground'].map(panelType => ({ title: `Crear ${TOOL_TITLES[panelType] || ({ terminal: 'terminal', browser: 'navegador', note: 'nota' })[panelType]}`, group: 'Nuevo panel', action: { type: 'create', panelType } })),
    ] : []),
  ], [workspace]);
  const results = actions.filter(item => `${item.title} ${item.group}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement; setQuery(''); setSelected(0);
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => { cancelAnimationFrame(frame); previousFocus.current?.focus?.(); };
  }, [open]);
  useEffect(() => { dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [selected]);
  const choose = item => { if (item) { onAction(item.action); onClose(); } };
  return createPortal(<Presence show={open}>{open && <div className="tw-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={dialog} className="tw-palette" role="dialog" aria-modal="true" aria-label="Paleta del workspace" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(old => results.length ? (old + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0); }
    if (e.key === 'Enter' && e.target === input.current) { e.preventDefault(); choose(results[selected]); }
    if (e.key === 'Tab') { const focusable = [...dialog.current.querySelectorAll('input,button:not([tabindex="-1"])')]; const first = focusable[0], last = focusable.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  }}><div className="tw-palette-search"><Search size={19} aria-hidden="true" /><input ref={input} role="combobox" aria-label="Buscar paneles y herramientas" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={results[selected] ? `${listId}-${selected}` : undefined} value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} placeholder="Buscar panel, herramienta o acción…" /><Button icon={X} aria-label="Cerrar paleta" onClick={onClose} /></div><p className="tw-palette-context">{workspace?.name || 'Sin workspace'} · Flechas para elegir, Enter para abrir</p><ul id={listId} role="listbox" aria-label="Resultados" className="tw-palette-results">{results.map((item, index) => <li role="option" id={`${listId}-${index}`} aria-selected={selected === index} key={`${item.group}:${item.title}:${index}`}><button type="button" tabIndex={-1} onMouseMove={() => setSelected(index)} onClick={() => choose(item)}><span>{item.title}</span><small>{item.group}</small></button></li>)}</ul>{!results.length && <EmptyState className="tw-empty" size="compact" description="No hay coincidencias. Busca por título del panel o nombre de herramienta." />}</div></div>}</Presence>, document.body);
}
