import React, { useCallback, useEffect, useRef } from 'react';
import EmptyState from './EmptyState.jsx';
import { PLUGIN_MANIFESTS } from '../../shared/plugins.mjs';
import { PluginCenter } from './PluginCenter';
import { PhantomCards } from './PhantomCards';
import { PhantomSkills } from './PhantomSkills';
import { VideoLog } from './VideoLog';
import { PhantomConvencions } from './PhantomConvencions';
import { Button, ErrorNotice, ResourceState, useResource } from './PluginPrimitives';
import '../plugins.css';

export const PLUGIN_PANELS = PLUGIN_MANIFESTS.flatMap(plugin => plugin.panels.map(panel => ({ ...panel, pluginId: plugin.id })));
export const PLUGIN_TITLES = Object.fromEntries([['plugins', 'Centro de Plugins'], ...PLUGIN_PANELS.map(panel => [panel.nodeType, panel.name])]);

function Content({ type, ...props }) {
  const { workspace, api, node, refresh, notify, onOpenPanel } = props;
  const registry = useResource(api, 'plugins.list', { workspaceId: workspace?.id }, { enabled: Boolean(workspace?.id) });
  const panel = PLUGIN_PANELS.find(item => item.nodeType === type);
  const plugin = Array.isArray(registry.data?.items) ? registry.data.items.find(item => item.id === panel?.pluginId) : null;
  const latest = useRef(props); latest.current = props;
  const preferencesKey = JSON.stringify(workspace?.plugins || {});
  useEffect(() => { registry.reload(); }, [preferencesKey]);
  const nativeApi = useCallback(async (method, payload) => {
    const result = await api(method, payload);
    const current = latest.current;
    if (method === 'phantom.detail' && current.node && result?.available !== false) {
      const selection = payload.topic === 'tasks' ? { cardId: payload.id } : payload.ref ? { ref: payload.ref } : {};
      const data = { ...current.node.data, pluginId: panel.pluginId, panelId: panel.id, ...selection };
      if (JSON.stringify(data) !== JSON.stringify(current.node.data)) {
        try { await api('node.update', { workspaceId: current.workspace.id, id: current.node.id, patch: { data } }); await current.refresh?.(); }
        catch (error) { current.notify?.(`No se pudo guardar la referencia: ${error.message}`, 'error'); }
      }
    }
    return result;
  }, [api, panel?.id, panel?.pluginId]);
  if (type === 'plugins') return <PluginCenter {...props} />;
  if (!workspace?.id) return <EmptyState className="tw-empty" description="Selecciona un proyecto." />;
  if (!registry.data && (registry.loading || registry.error)) return <ResourceState resource={registry} />;
  if (!Array.isArray(registry.data?.items)) return <ErrorNotice error="El registro de plugins no es válido." retry={registry.reload} />;
  if (!plugin?.enabled || workspace.plugins?.[panel?.pluginId]?.enabled === false) return <section className="plugin-gate tw-section"><h3>{panel?.name || 'Panel'} · Plugin desactivado</h3><p>Activa {plugin?.name || panel?.pluginId} en el Centro de Plugins. Tus datos nativos, configuración y referencias guardadas se conservan al desactivar.</p><Button onClick={() => onOpenPanel?.('plugins')}>Abrir Centro</Button><Button onClick={registry.reload}>Actualizar estado</Button></section>;
  const Native = panel?.pluginId === 'convencions' ? PhantomConvencions : type === 'phantom-cards' ? PhantomCards : type === 'phantom-skills' ? PhantomSkills : type === 'video-log' ? VideoLog : null;
  return Native ? <Native {...props} type={type} api={nativeApi} plugin={plugin} /> : null;
}

export function PluginPanels(props) {
  return <div className="plugin-surface"><Content key={`${props.workspace?.id || 'none'}:${props.type}:${props.node?.id || 'inspector'}`} {...props} /></div>;
}
