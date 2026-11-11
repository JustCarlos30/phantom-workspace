import React, { useEffect, useState } from 'react';
import { plugins, pluginEnabled, pluginPreferences } from '../plugins/registry';
import { pluginCall } from '../plugins/phantom';
import { Button, ErrorNotice, Field, useOperation, usePluginResource, ResourceNotice } from './pluginPrimitives';

function PhantomConnection({ workspace, api, refresh }) {
  const config = usePluginResource(() => api('plugins.get', { workspaceId: workspace.id, pluginId: 'phantom' }), workspace.id);
  const status = usePluginResource(() => pluginCall(api, workspace.id, 'list', { topic: 'tasks' }), `${workspace.id}:connection`);
  const [form, setForm] = useState({ phantomPath: '', phantomData: '' }), [dirty, setDirty] = useState([]);
  const [model, setModel] = useState(pluginPreferences(workspace).model);
  const op = useOperation();
  useEffect(() => { if (config.data) setForm(config.data.connection); }, [config.data]);
  return <><h4>Conexión real</h4><ResourceNotice resource={status} />{!status.loading && !status.error && status.data?.available && <p className="plugin-connected" role="status">Phantom disponible · {status.data.observedAt || 'Lectura completada'}</p>}<ResourceNotice resource={config} /><p className="tw-muted">Las rutas son configuración global del host y afectan a todos los proyectos, también a Tareas y Contexto. Vacío conserva el valor existente o la detección automática. La activación, el modelo y la vista se guardan solo para este proyecto.</p>
    <form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => {
      const patch = Object.fromEntries(dirty.filter(k => form[k]?.trim()).map(k => [k, form[k].trim()]));
      if (Object.keys(patch).length) await api('plugins.configure', { workspaceId: workspace.id, pluginId: 'phantom', patch });
      await api('plugins.update', { workspaceId: workspace.id, pluginId: 'phantom', patch: { preferences: { model } } });
      setDirty([]); await refresh(); await config.reload(); await status.reload();
    }); }}>
      {[['phantomPath', 'Ejecutable Phantom · ruta absoluta del CLI'], ['phantomData', 'Datos nativos Phantom · ruta absoluta']].map(([key, label]) => <Field key={key} label={label}><input value={form[key] || ''} onChange={e => { setForm({ ...form, [key]: e.target.value }); setDirty(old => [...new Set([...old, key])]); }} /></Field>)}
      <Field label="Modelo para ejecutar cards en este proyecto"><input value={model} onChange={e => setModel(e.target.value)} maxLength={200} placeholder="Proveedor/modelo explícito" /></Field><ErrorNotice error={op.error} /><Button type="submit" disabled={op.busy || config.loading} tone="primary">Guardar conexión y preferencias</Button>{op.busy && <p role="status">Guardando…</p>}
    </form></>;
}
export default function Plugins({ workspace, api, refresh, onOpenPanel }) {
  const op = useOperation();
   return <section className="plugins-center"><h3>Plugins propios</h3><p className="tw-muted">Activa herramientas y configura cómo trabajan en este proyecto.</p>{plugins.map(plugin => {
    const enabled = pluginEnabled(workspace, plugin.id);
    return <article className="plugin-entry" key={plugin.id}><header><h3>{plugin.name}</h3><span>v{plugin.version} · {enabled ? 'Activo' : 'Desactivado'}</span></header><p>{plugin.description}</p><Button disabled={op.busy} onClick={() => op.run(async () => { await api('plugins.update', { workspaceId: workspace.id, pluginId: plugin.id, patch: { enabled: !enabled } }); await refresh(); })}>{enabled ? 'Desactivar Phantom' : 'Activar Phantom'}</Button><ErrorNotice error={op.error} />{enabled ? <><div className="tw-row">{plugin.panels.map(panel => <Button key={panel.type} onClick={() => onOpenPanel(panel.type)}>{panel.name}</Button>)}</div><PhantomConnection key={workspace.id} workspace={workspace} api={api} refresh={refresh} /></> : <p>Desactivado por defecto. Al desactivar se conservan objetos, referencias y paneles guardados.</p>}</article>;
  })}</section>;
}
