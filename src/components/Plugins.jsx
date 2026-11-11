import React, { useEffect, useRef, useState } from 'react';
import { Blocks, ExternalLink, LoaderCircle, Power } from 'lucide-react';
import { getPluginDescriptors, pluginSettings } from '../plugins/registry.js';
import '../plugins.css';

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
  const { workspace, onOpenPanel } = props;
  const { settings, busy, error, update } = usePluginSettings(props);
  return <section className="plugin-manager" aria-label="Plugins del proyecto">
    <p>Plugins propios, activados por proyecto. La conexión usa el host local y su configuración de Phantom.</p>
    {getPluginDescriptors().map(descriptor => <section key={descriptor.id} className="plugin-entry">
      <header><Blocks size={22} aria-hidden="true" /><h3>{descriptor.title}</h3><span>v{descriptor.version}</span></header>
      <p>{descriptor.description}</p>
      <p className="plugin-muted">{settings.enabled ? 'Activo en este proyecto' : 'Desactivado en este proyecto'} · {workspace.name}</p>
      <div className="plugin-actions"><button className="tw-button" disabled={busy} onClick={() => update({ enabled: !settings.enabled })}>{busy ? <LoaderCircle size={15} className="spinning" /> : <Power size={15} />}{settings.enabled ? 'Desactivar Phantom' : 'Activar Phantom'}</button>
        <button className="tw-button" disabled={!settings.enabled || busy} onClick={() => onOpenPanel('command-center', {}, 'Centro de mando')}><ExternalLink size={15} />Abrir Centro de mando</button></div>
      <label className="plugin-preference">Frecuencia de actualización<select aria-label="Frecuencia de actualización" value={settings.refreshMs} disabled={busy} onChange={event => update({ refreshMs: Number(event.target.value) })}>{[3000, 4000, 5000].map(ms => <option key={ms} value={ms}>Cada {ms / 1000} segundos</option>)}</select></label>
      <p className="plugin-muted">Conexión: CLI nativa mediante el host. Configura sus rutas en Configuración. Desactivar conserva paneles y datos; detiene las consultas del Centro de mando.</p>
    </section>)}
    {error && <p role="alert" className="plugin-error">{error} <button className="tw-button" disabled={busy} onClick={() => update({})}>Reintentar guardado</button></p>}
  </section>;
}
