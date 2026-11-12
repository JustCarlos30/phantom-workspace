import React, { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import EmptyState from './EmptyState.jsx';
import { Button, Field, ErrorNotice, DataView, OperationState, ResourceState, useOperation, useResource } from './PluginPrimitives';

const configOf = plugin => ({ ...Object.fromEntries(Object.entries(plugin.configuration || {}).map(([key, field]) => [key, field.default])), ...plugin.config });
const labels = { phantomPath: 'CLI Phantom (ruta absoluta)', phantomData: 'Datos Phantom (fuera del proyecto)', model: 'Modelo OpenCode' };

function PluginCard({ plugin, workspace, api, refresh, notify, onOpenPanel }) {
  const [saved, setSaved] = useState(plugin);
  const [draft, setDraft] = useState(() => configOf(plugin));
  const [manual, setManual] = useState(false);
  useEffect(() => { setSaved(plugin); }, [plugin]);
  const op = useOperation(notify);
  const payload = { workspaceId: workspace.id, id: plugin.id };
  const status = useResource(api, 'plugins.status', payload, { enabled: false });
  const models = useResource(api, 'plugins.models', payload, { enabled: false });
  const baseline = configOf(saved);
  const videoLog = plugin.id === 'video-log';
  const fieldLabels = videoLog ? { sourcePath: 'Archivo Markdown (ruta absoluta)' } : labels;
  const changed = Object.keys(fieldLabels).filter(key => draft[key] !== baseline[key]);

  const update = patch => op.run(async () => {
    const value = await api('plugins.update', { ...payload, patch });
    setSaved(value);
    await refresh?.();
  }, 'Preferencias del plugin guardadas');

  const saveConfig = () => update({ config: { ...draft } });
  return <article className="plugin-card tw-section" data-plugin-id={plugin.id}>
    <header className="plugin-heading tw-heading"><h3>{saved.name}</h3><span className="plugin-state tw-badge">{saved.enabled ? 'Activado' : 'Desactivado'}</span></header>
    <p>{saved.description}</p>
    <dl className="plugin-identity"><dt>Identidad</dt><dd>{saved.id}</dd><dt>Versión</dt><dd>{saved.version}</dd><dt>Origen</dt><dd>{saved.source === 'builtin' ? 'Integrado · builtin' : saved.source || 'No declarado'}</dd></dl>
    <Button disabled={op.busy} aria-pressed={saved.enabled} onClick={() => update({ enabled: !saved.enabled })}>{saved.enabled ? 'Desactivar' : 'Activar'} {saved.name}</Button>

    <section className="plugin-configuration tw-item" aria-label={`Configuración de ${saved.name}`}>
      <h4>Preferencias de este proyecto</h4>
      <p className="tw-muted">{videoLog ? 'Elige una única fuente UTF-8 de hasta 512 KiB. La ruta se guarda solo para este proyecto. Vacío: sin fuente configurada. Guarda y abre el panel para leerla; Actualizar relee el disco.' : 'Un campo vacío hereda el ajuste global. Guarda los cambios antes de probar la conexión o consultar modelos: esas consultas usan la configuración guardada.'}</p>
      <form className="plugin-form tw-form" onSubmit={event => { event.preventDefault(); saveConfig(); }}>
        {(videoLog ? ['sourcePath'] : ['phantomPath', 'phantomData']).map(key => <Field key={key} label={fieldLabels[key]} hint={videoLog ? 'Ruta absoluta del archivo elegido. No se exploran carpetas ni archivos enlazados en su contenido.' : key === 'phantomPath' ? 'Vacío: descubrimiento de Phantom o ruta global.' : 'Ruta absoluta externa al proyecto. Vacío: datos globales o nativos.'}><input value={draft[key] || ''} disabled={op.busy} onChange={event => setDraft(old => ({ ...old, [key]: event.target.value }))} placeholder={videoLog ? 'Sin fuente configurada' : 'Heredar'} /></Field>)}
        {!videoLog && <>
        <div className="plugin-models tw-row"><Button disabled={models.loading || op.busy} onClick={models.reload}>{models.loading ? 'Cargando modelos…' : 'Cargar catálogo real de modelos'}</Button><Button aria-pressed={manual} disabled={op.busy} onClick={() => setManual(value => !value)}>{manual ? 'Usar selector de catálogo' : 'Introducir modelo manualmente'}</Button></div>
        <ErrorNotice error={models.error} retry={models.reload} />
        {models.data?.available === false && <div className="plugin-unavailable tw-warning" role="status">{models.data.reason || 'Catálogo de modelos no disponible.'}<Button onClick={models.reload} disabled={models.loading}>Reintentar catálogo</Button></div>}
        {manual ? <Field label="Modelo manual (proveedor/modelo)" hint="Identificador explícito. Vacío hereda el modelo global."><input value={draft.model} disabled={op.busy} onChange={event => setDraft(old => ({ ...old, model: event.target.value }))} placeholder="proveedor/modelo" /></Field> : <Field label="Modelo del catálogo" hint="Seleccionar no ejecuta el modelo. Vacío hereda el modelo global."><select value={draft.model} disabled={op.busy} onChange={event => setDraft(old => ({ ...old, model: event.target.value }))}><option value="">Heredar modelo global</option>{draft.model && !models.data?.models?.includes(draft.model) && <option value={draft.model}>{draft.model} · fuera del catálogo cargado</option>}{models.data?.available && models.data.models.map(model => <option key={model} value={model}>{model}</option>)}</select></Field>}
        </>}
        <p className="plugin-save-state tw-muted" role="status">{changed.length ? `Cambios sin guardar: ${changed.map(key => fieldLabels[key]).join(', ')}.` : 'Sin cambios pendientes. Se muestran las preferencias guardadas.'}</p>
        {changed.length > 0 && <DataView label="Comparar borrador con valores guardados" value={Object.fromEntries(changed.map(key => [key, { guardado: baseline[key], borrador: draft[key] }]))} />}
        <div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy || !changed.length}>Guardar preferencias</Button><Button disabled={op.busy || !changed.length} onClick={() => setDraft(configOf(saved))}>Restaurar valores guardados</Button></div>
      </form>
    </section>
    <OperationState op={op} />

    {!videoLog && <section className="plugin-connection tw-item" aria-label="Conexión con Phantom"><h4>Conexión</h4><Button disabled={status.loading || op.busy} onClick={status.reload}>Probar conexión</Button>
      <ResourceState resource={status} empty={false} />
      {status.data && <><p className="plugin-status" role="status">{status.data.available ? 'Conexión disponible' : 'Conexión no disponible'}{status.data.cli ? ` · ${status.data.cli}` : ''}{status.data.version ? ` · ${status.data.version}` : ''}</p><DataView value={status.data} label="Resultado observado de conexión" /></>}
    </section>}
    <section className="plugin-panels tw-item" aria-label="Paneles del plugin"><h4>Paneles</h4>{!saved.enabled && <p className="tw-muted">Activa el plugin para abrir sus paneles.</p>}<div className="tw-row">{!videoLog && <Button disabled={!saved.enabled || op.busy || !onOpenPanel} onClick={() => onOpenPanel('command-center')}>Abrir Centro de mando</Button>}{saved.panels?.map(panel => <Button key={panel.id} icon={ArrowUpRight} disabled={!saved.enabled || op.busy || !onOpenPanel} onClick={() => onOpenPanel(panel.nodeType, { pluginId: saved.id, panelId: panel.id }, panel.name)}>Abrir {panel.name}</Button>)}</div></section>
  </article>;
}

export function PluginCenter({ workspace, api, refresh, notify, onOpenPanel }) {
  const registry = useResource(api, 'plugins.list', { workspaceId: workspace?.id }, { enabled: Boolean(workspace?.id) });
  const valid = registry.data == null || Array.isArray(registry.data.items);
  return <div className="plugin-center tw-content">
    <header className="plugin-header tw-heading"><h2>Plugins</h2><Button icon={RefreshCw} disabled={registry.loading || !workspace?.id} onClick={registry.reload}>Actualizar registro</Button></header>
    {!workspace?.id ? <EmptyState className="plugin-empty tw-empty" description="Selecciona un proyecto para configurar sus plugins." /> : <>
      <ResourceState resource={registry} empty="No hay plugins registrados para este proyecto." />
      {!valid && <ErrorNotice error="El registro devolvió un listado inválido." retry={registry.reload} />}
      {valid && registry.data?.items.map(plugin => <PluginCard key={`${workspace.id}:${plugin.id}`} plugin={plugin} workspace={workspace} api={api} refresh={refresh} notify={notify} onOpenPanel={onOpenPanel} />)}
    </>}
  </div>;
}
