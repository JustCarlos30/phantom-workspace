import React from 'react';
import { X } from 'lucide-react';
import { Button, TOOL_TITLES, ToolContent } from './ToolPanels.jsx';
import '../tools.css';
import { PLUGIN_TITLES } from './PluginPanels';

export function Inspector({ tab, workspace, state, api, refresh, onClose, onOpenPanel, notify }) {
  if (PLUGIN_TITLES[tab]) return <aside className="tw-inspector" aria-label={PLUGIN_TITLES[tab]}><header className="tw-inspector-header"><h2>{PLUGIN_TITLES[tab]}</h2><Button icon={X} aria-label="Cerrar inspector" onClick={onClose} /></header><ToolContent type={tab} workspace={workspace} state={state} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} /></aside>;
  return <aside className="tw-inspector" aria-label={TOOL_TITLES[tab] || 'Herramientas'}><header className="tw-inspector-header"><div><h2>{TOOL_TITLES[tab] || 'Herramientas'}</h2><p title={workspace?.path}>{workspace?.name || 'Sin carpeta seleccionada'}</p></div><Button icon={X} aria-label="Cerrar inspector" onClick={onClose} /></header><ToolContent type={tab} workspace={workspace} state={state} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} /></aside>;
}
