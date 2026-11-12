import React, { useEffect, useRef, useState } from 'react';
import { Blocks, ExternalLink, LoaderCircle, Power } from 'lucide-react';
import { getPluginDescriptors, pluginSettings } from '../plugins/registry.js';
import '../plugins.css';
import { PluginCenter } from './PluginCenter';

// Notify all mounted views after the host acknowledges a preference change,
// including when the subsequent workspace reload is temporarily unavailable.
const settingsListeners = new WeakMap();
function projectListeners(api, id) {
  if (!settingsListeners.has(api)) settingsListeners.set(api, new Map());
  const projects = settingsListeners.get(api);
  if (!projects.has(id)) projects.set(id, new Set());
  return projects.get(id);
}

export function usePluginSettings({ workspace, api, refresh }) {
  const saved = pluginSettings(workspace);
  const [local, setLocal] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef(workspace?.id), mounted = useRef(false), pending = useRef({}), lock = useRef(false);
  current.current = workspace?.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setLocal(null); }, [workspace?.id, saved.enabled, saved.refreshMs]);
  useEffect(() => {
    const listeners = projectListeners(api, workspace?.id);
    const receive = value => setLocal(value);
    listeners.add(receive);
    return () => listeners.delete(receive);
  }, [api, workspace?.id]);
  const settings = local || saved;
  async function update(patch) {
    if (lock.current) return;
    const project = workspace.id;
    const valid = () => mounted.current && current.current === project;
    const change = Object.keys(patch).length ? patch : pending.current;
    pending.current = change; lock.current = true;
     setBusy(true); setError('');
     let acknowledged = false;
    try {
      const value = await api('plugin.update', { workspaceId: project, id: 'phantom', settings: { ...settings, ...change } });
       acknowledged = true;
       for (const receive of projectListeners(api, project)) receive(value);
      if (!valid()) return;
      setLocal(value); pending.current = {};
      await refresh();
     } catch (error) { if (valid()) setError(acknowledged ? `Preferencias guardadas; no se pudo recargar el proyecto: ${error.message}` : `No se pudo guardar el plugin: ${error.message}`); }
    finally { lock.current = false; if (valid()) setBusy(false); }
  }
  return { settings, busy, error, update };
}

export default function Plugins(props) {
  return <PluginCenter {...props} />;
}
