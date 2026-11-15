import React from 'react';
import { X } from 'lucide-react';
import { Button, TOOL_TITLES, ToolContent } from './ToolPanels.jsx';
import Settings from './Settings.jsx';
import '../tools.css';
import { PLUGIN_TITLES } from './PluginPanels';

// Configuración and its categories open as one wide sheet; every other tab is a tool with a title.
const SETTINGS = { settings: undefined, appearance: 'appearance', plugins: 'connections' };
export function Inspector({ tab, workspace, state, api, refresh, onClose, onOpenPanel, notify, appearance }) {
  if (tab in SETTINGS) return <aside className="tw-inspector is-settings" aria-label="Configuración"><Settings key={tab} category={SETTINGS[tab]} workspace={workspace} state={state} api={api} refresh={refresh} onClose={onClose} onOpenPanel={onOpenPanel} notify={notify} appearance={appearance} /></aside>;
  const title = PLUGIN_TITLES[tab] || TOOL_TITLES[tab] || 'Herramientas';
  return <aside className="tw-inspector" aria-label={title}><header className="tw-inspector-header"><div><h2>{title}</h2>{!PLUGIN_TITLES[tab] && <p title={workspace?.path}>{workspace?.name || 'Sin carpeta seleccionada'}</p>}</div><Button icon={X} aria-label="Cerrar inspector" onClick={onClose} /></header><ToolContent type={tab} workspace={workspace} state={state} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} /></aside>;
}
