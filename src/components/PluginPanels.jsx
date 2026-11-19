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
export const PLUGIN_TITLES = Object.fromEntries([['plugins', 'Configuración'], ...PLUGIN_PANELS.map(panel => [panel.nodeType, panel.name])]);

// A panel whose source is switched off for this project. One action turns it
// on right here; nothing is lost while it is off.
function PluginGate({ api, workspace, plugin, panel, refresh, reload, notify }) {
  const [busy, setBusy] = React.useState(false);
  const name = plugin?.name || panel?.name || 'esta fuente';
  const connect = async () => {
    setBusy(true);
    try { await api('plugins.update', { workspaceId: workspace.id, id: panel.pluginId, patch: { enabled: true } }); await refresh?.(); await reload(); }
    catch (error) { notify?.(`No se pudo conectar ${name}: ${error.message}`, 'error'); }
    finally { setBusy(false); }
  };
  return <EmptyState className="plugin-gate" title={`${name} no está conectado en este proyecto`} description="Conéctalo para ver su contenido aquí. Puedes desconectarlo después sin perder nada." actions={<Button tone="primary" disabled={busy} onClick={connect}>{busy ? 'Conectando…' : `Conectar ${name}`}</Button>} />;
}

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
    // The inspector hosts this panel for another node (e.g. a terminal): only a node of the panel's own type owns its selection.
    if (method === 'phantom.detail' && current.node?.type === panel?.nodeType && result?.available !== false) {
      const selection = payload.topic === 'tasks' ? { cardId: payload.id } : payload.ref ? { ref: payload.ref } : {};
      const data = { ...current.node.data, pluginId: panel.pluginId, panelId: panel.id, ...selection };
      if (JSON.stringify(data) !== JSON.stringify(current.node.data)) {
        try { await api('node.update', { workspaceId: current.workspace.id, id: current.node.id, patch: { data } }); await current.refresh?.(); }
        catch (error) { current.notify?.(`No se pudo guardar la referencia: ${error.message}`, 'error'); }
      }
    }
    return result;
  }, [api, panel?.id, panel?.pluginId]);
  if (!workspace?.id) return <EmptyState className="tw-empty" description="Selecciona un proyecto." />;
  if (!registry.data && (registry.loading || registry.error)) return <ResourceState resource={registry} />;
  if (!Array.isArray(registry.data?.items)) return <ErrorNotice error="El registro de plugins no es válido." retry={registry.reload} />;
  if (!plugin?.enabled || workspace.plugins?.[panel?.pluginId]?.enabled === false) return <PluginGate api={api} workspace={workspace} plugin={plugin} panel={panel} refresh={refresh} reload={registry.reload} notify={notify} />;
  const Native = panel?.pluginId === 'convencions' ? PhantomConvencions : type === 'phantom-cards' ? PhantomCards : type === 'phantom-skills' ? PhantomSkills : type === 'video-log' ? VideoLog : null;
  return Native ? <Native {...props} type={type} api={nativeApi} plugin={plugin} /> : null;
}

export function PluginPanels(props) {
  if (props.type === 'plugins') return <PluginCenter key={props.workspace?.id || 'none'} {...props} />;
  return <div className="plugin-surface"><Content key={`${props.workspace?.id || 'none'}:${props.type}:${props.node?.id || 'inspector'}`} {...props} /></div>;
}
