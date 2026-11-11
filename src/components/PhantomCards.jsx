import React, { useEffect, useId, useState } from 'react';
import { Button, Field, ErrorNotice, DataView, ResourceState, useResource, useOperation } from './PluginPrimitives';
import { itemsOf, contractOf, stateOf, refOf, goalOf, emptyCardForm, cardFormOf, buildCardInput, filterCards, cardActions } from '../hooks/plugin-model.mjs';

function CardForm({ existing, workspace, api, notify, onSaved, onClose }) {
  const [form, setForm] = useState(() => existing ? cardFormOf(existing) : emptyCardForm());
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(null);
  const op = useOperation(notify);
  const patch = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const submit = event => {
    event.preventDefault();
    op.run(async () => {
      if (existing && !confirmed) throw new Error('Confirma explícitamente el reemplazo.');
      const input = buildCardInput(form, existing);
      const value = await api(existing ? 'phantom.update' : 'phantom.create', { workspaceId: workspace.id, pluginId: 'phantom', kind: 'card', ...(existing ? { id: existing.id, replace: true } : {}), input });
      setResult(value);
      onSaved?.(value);
    }, existing ? 'Reemplazo creado; original conservado' : 'Card creada');
  };
  return <section className="plugin-card-form tw-section"><h3>{existing ? 'Crear reemplazo explícito' : 'Nueva Card'}</h3>
    {existing && <><p>La Card {existing.id} es inmutable. Guardar crea un reemplazo y conserva el original.</p><DataView value={refOf(existing) || { id: existing.id, revision: existing.revision ?? 'desconocida' }} label="Referencia original" /></>}
    <form className="plugin-form tw-form" onSubmit={submit}><fieldset disabled={op.busy || Boolean(result)}>
      <Field label="Objetivo"><textarea rows={3} required value={form.goal} onChange={e => patch('goal', e.target.value)} /></Field>
      <Field label="Scope · una ruta por línea" hint="Rutas relativas reales. Phantom valida el contrato; no se comprueba aquí la existencia de archivos."><textarea rows={4} required value={form.scope} onChange={e => patch('scope', e.target.value)} /></Field>
      <h4>Checks de aceptación</h4><p className="tw-muted">Declara comandos reales. argv es un array JSON por comando; no se ejecutan al guardar.</p>
      {form.checks.map((check, index) => <div className="plugin-check tw-item" key={index}><Field label={`Nombre del check ${index + 1}`}><input required value={check.name} onChange={e => patch('checks', form.checks.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} /></Field><Field label="argv JSON"><textarea required rows={2} value={check.argv} placeholder={'["node", "--version"]'} onChange={e => patch('checks', form.checks.map((item, i) => i === index ? { ...item, argv: e.target.value } : item))} /></Field><Button onClick={() => patch('checks', form.checks.filter((_, i) => i !== index))}>Quitar check {index + 1}</Button></div>)}
      <Button onClick={() => patch('checks', [...form.checks, { name: '', argv: '' }])}>Añadir check</Button>
      <Field label="Dependencias · un ID por línea"><textarea rows={2} value={form.deps} onChange={e => patch('deps', e.target.value)} /></Field>
      <Field label="Budget opcional · objeto JSON" hint="Límites nativos, por ejemplo timeoutMs, maxTurns, maxTools o maxRepairs. Vacío: valores nativos."><textarea rows={3} value={form.budget} onChange={e => patch('budget', e.target.value)} /></Field>
      <p>Lane: coordinated</p><details className="plugin-advanced tw-details"><summary>Coordinación avanzada opcional</summary><Field label="Coordinación nativa JSON" hint="Solo si necesitas children u otras opciones de coordinación del contrato nativo."><textarea rows={6} value={form.coordination} onChange={e => patch('coordination', e.target.value)} /></Field></details>
      {existing && <label className="plugin-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Confirmo crear un reemplazo conservando el original.</label>}
      <Button type="submit" tone="primary" disabled={existing && !confirmed}>{existing ? 'Crear reemplazo' : 'Guardar Card'}</Button>
    </fieldset></form>
    <ErrorNotice error={op.error} clear={op.clear} />{op.busy && <p role="status">Guardando…</p>}
    {result && <><p role="status">Guardado en Phantom. No se ha iniciado una ejecución.</p><DataView value={result} label="Resultado y referencias (replaces / relatedRef)" /></>}
    <Button disabled={op.busy} onClick={onClose}>Cerrar formulario</Button>
  </section>;
}

function CardDetail({ id, workspace, api, refresh, notify, plugin, onOpenPanel, onChanged }) {
  const payload = { workspaceId: workspace.id, pluginId: 'phantom' };
  const detail = useResource(api, 'phantom.detail', { workspaceId: workspace.id, topic: 'tasks', id });
  const events = useResource(api, 'phantom.events', { workspaceId: workspace.id, id });
  const controllers = useResource(api, 'phantom.controllers', { workspaceId: workspace.id });
  const models = useResource(api, 'plugins.models', { workspaceId: workspace.id, id: 'phantom' }, { enabled: false });
  const [model, setModel] = useState(''), [editing, setEditing] = useState(null), [output, setOutput] = useState(null);
  const modelList = useId();
  const op = useOperation(notify);
  const value = detail.data;
  const native = value?.task || value;
  const contract = contractOf(native);
  const allControllers = itemsOf(controllers.data);
  const related = allControllers.filter(item => item.taskId === id);
  const actions = cardActions({ ...native, id }, allControllers);
  const effectiveModel = model.trim() || plugin?.config?.model?.trim();
  const reload = () => { detail.reload(); events.reload(); controllers.reload(); onChanged?.(); };
  const control = action => op.run(async () => {
    if (action === 'run' && !effectiveModel) throw new Error('Indica un modelo explícito o guarda un modelo en la configuración del plugin.');
    const result = await api('phantom.control', { ...payload, id, action, ...(action === 'run' && model.trim() ? { model: model.trim() } : {}) });
    setOutput(result); reload(); await refresh?.();
  }, 'Acción enviada a Phantom');
  return <section className="plugin-detail tw-section" aria-label={`Detalle ${id}`}><header className="plugin-heading tw-heading"><h3>Detalle · {id}</h3><Button onClick={reload}>Actualizar detalle, eventos y controladores</Button></header>
    <p className="tw-muted">Actualización manual. El estado de la tarea procede de Phantom; el fin del controlador no completa la Card.</p><ResourceState resource={detail} empty={false} />
    {native && native.available !== false && !detail.loading && <><h4>{goalOf(native)}</h4><p>Tipo: {native.kind || 'desconocido'} · Estado nativo: {stateOf(native)}</p><p>Fuente: {typeof native.source === 'object' ? JSON.stringify(native.source) : native.source || 'desconocida'} · Revisión: {native.revision ?? refOf(native)?.version ?? 'desconocida'}</p>
      <DataView value={refOf(native) || { id, revision: 'desconocida' }} label="Referencia de la fuente" />
      <DataView value={contract.scope ?? 'No declarado'} label="Scope" /><DataView value={contract.dependencies ?? 'No declaradas'} label="Dependencias" /><DataView value={contract.checks ?? 'No declarados'} label="Checks" />
      <DataView value={{ run: native.run ?? native.runs ?? null, status: native.status ?? native.state ?? 'desconocido', evidence: native.evidence ?? native.evidences ?? null }} label="Run, estado y evidencia nativa" /><DataView value={value} label="Fuente nativa completa" />
      <div className="plugin-controls tw-item"><h4>Control explícito</h4><Field label="Modelo para ejecutar" hint={plugin?.config?.model ? `Vacío: configuración guardada (${plugin.config.model}).` : 'Indica un modelo o configúralo en el Centro. No hay un modelo global observado.'}><input list={modelList} value={model} onChange={e => setModel(e.target.value)} placeholder="proveedor/modelo" /></Field><datalist id={modelList}>{models.data?.models?.map(item => <option key={item} value={item} />)}</datalist><Button disabled={models.loading} onClick={models.reload}>Consultar catálogo real</Button><ResourceState resource={models} empty={false} />
        <div className="tw-row">{Object.entries({ run: 'Ejecutar', stop: 'Detener', cancel: 'Cancelar', recover: 'Recuperar', verify: 'Verificar' }).map(([action, label]) => <Button key={action} disabled={op.busy || !actions[action] || (action === 'run' && !effectiveModel) || detail.loading || Boolean(detail.error) || controllers.loading || Boolean(controllers.error)} onClick={() => control(action)}>{label}</Button>)}</div><p className="tw-muted">Los controles dependen del estado nativo conocido y de los controladores observados. Estado desconocido: actualiza la fuente.</p>
      </div>
      <Button disabled={op.busy} onClick={() => setEditing(old => old ? null : { ...native, id })}>{editing ? 'Ocultar reemplazo' : 'Preparar reemplazo'}</Button>
      {onOpenPanel && <Button onClick={() => onOpenPanel('phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId: id, ref: refOf(native) }, goalOf(native))}>Abrir referencia en otro panel</Button>}
    </>}
    {editing && <CardForm existing={editing} workspace={workspace} api={api} notify={notify} onSaved={reload} onClose={() => setEditing(null)} />}
    <ErrorNotice error={op.error} clear={op.clear} />{op.busy && <p role="status">Enviando acción…</p>}{output && <DataView value={output} label="Respuesta real del control" />}
    <h4>Descriptores de procesos</h4><ResourceState resource={controllers} empty={false} />{!controllers.loading && !controllers.error && !related.length && <p>Sin descriptores observados para esta tarea.</p>}{related.map(item => <DataView key={item.id} value={item} label={`${item.action} · controlador ${item.status || 'desconocido'}`} />)}
    <h4>Eventos nativos</h4><ResourceState resource={events} empty={false} />{events.data && <DataView value={events.data} label="phantom.events · historial observado" />}
  </section>;
}

export function PhantomCards({ workspace, api, refresh, notify, onOpenPanel, node, plugin }) {
  const [selected, setSelected] = useState(node?.data?.cardId || '');
  const [query, setQuery] = useState(''), [state, setState] = useState(''), [view, setView] = useState('list'), [creating, setCreating] = useState(false);
  useEffect(() => { setSelected(node?.data?.cardId || ''); }, [workspace?.id, node?.data?.cardId]);
  const source = useResource(api, 'phantom.list', { workspaceId: workspace?.id, pluginId: 'phantom', topic: 'tasks' }, { enabled: Boolean(workspace?.id) });
  const items = itemsOf(source.data), filtered = filterCards(items, query, state);
  const states = [...new Set(items.map(stateOf))];
  const row = item => <article className="plugin-card tw-item" key={item.id}><Button aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{goalOf(item)}</Button><p className="plugin-identity">{item.id}</p><small>Tipo: {item.kind || 'desconocido'} · Estado: {stateOf(item)}</small></article>;
  if (!workspace?.id) return <p className="plugin-empty">Selecciona un proyecto.</p>;
  return <div className="plugin-cards tw-content"><header className="plugin-header tw-heading"><h2>Cards y tareas · Phantom</h2><div className="tw-row"><Button disabled={source.loading} onClick={source.reload}>Actualizar listado</Button><Button aria-expanded={creating} onClick={() => setCreating(old => !old)}>Nueva Card</Button></div></header>
    {creating && <CardForm workspace={workspace} api={api} notify={notify} onSaved={() => { source.reload(); refresh?.(); }} onClose={() => setCreating(false)} />}
    <div className="plugin-filters tw-row"><Field label="Buscar por objetivo o ID"><input type="search" value={query} onChange={e => setQuery(e.target.value)} /></Field><Field label="Estado nativo"><select value={state} onChange={e => setState(e.target.value)}><option value="">Todos</option>{states.map(item => <option key={item} value={item}>{item}</option>)}</select></Field><Button aria-pressed={view === 'list'} onClick={() => setView('list')}>Lista</Button><Button aria-pressed={view === 'board'} onClick={() => setView('board')}>Tablero</Button></div>
    <ResourceState resource={source} empty="No hay tareas ni Cards nativas para este proyecto." />
    {source.data && !Array.isArray(source.data.items) && source.data.available !== false && <ErrorNotice error="La fuente no devolvió un listado válido." />}
    {!source.loading && items.length > 0 && !filtered.length && <p className="plugin-empty">Sin resultados para estos filtros.</p>}
    {view === 'list' ? <div className="plugin-card-list">{filtered.map(row)}</div> : <div className="plugin-board" style={{ display: 'flex', overflowX: 'auto', gap: 12 }}>{[...new Set(filtered.map(stateOf))].map(column => <section className="plugin-board-column" style={{ minWidth: 240 }} key={column} aria-label={column}><h3>{column}</h3>{filtered.filter(item => stateOf(item) === column).map(row)}</section>)}</div>}
    {selected && <><Button onClick={() => setSelected('')}>Cerrar detalle</Button><CardDetail key={`${workspace.id}:${selected}`} id={selected} workspace={workspace} api={api} refresh={refresh} notify={notify} plugin={plugin} onOpenPanel={onOpenPanel} onChanged={source.reload} /></>}
  </div>;
}
