import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckSquare, Columns3, FilePlus2, List, Play, RefreshCw, X } from 'lucide-react';
import { cardDraft, cardInput, cardGroups, filteredCards, pluginCall } from '../plugins/phantom';
import { pluginPreferences } from '../plugins/registry';
import { Button, Field, ErrorNotice, DataView, useOperation, usePluginResource, ResourceNotice, TextList, Arguments } from './pluginPrimitives';
import { CardAgents } from './AgentIdentity';

const stateLabel = status => ({ ready: 'Lista', running: 'En ejecución', completed: 'Completada', blocked: 'Bloqueada', cancelled: 'Cancelada', failed: 'Fallida', queued: 'En cola' })[status] || status || 'Sin estado';
const sourceOf = item => item?.raw || item;

function AttemptEvidence({ detail }) {
  const run = typeof detail.run === 'object' && detail.run ? detail.run : typeof detail.latestRun === 'object' ? detail.latestRun : null;
  const proof = run?.evidence?.findLast(entry => Array.isArray(entry.checks));
  return <section className="plugin-form-section"><h4>Último intento y evidencia</h4>{run ? <><p><strong>{stateLabel(run.status)}</strong>{run.id && <> · <code>{run.id}</code></>}</p>{run.reason && <p className="plugin-prose">{run.reason}</p>}<dl className="plugin-evidence"><dt>Inicio</dt><dd>{run.startedAt || 'No proporcionado'}</dd><dt>Fin</dt><dd>{run.endedAt || 'No proporcionado'}</dd>{(run.artifacts || run.result?.artifacts) && <><dt>Artefactos</dt><dd><code>{run.artifacts || run.result.artifacts}</code></dd></>}</dl>{proof?.checks?.map((check, index) => <div className="plugin-check-summary" key={index}><CheckSquare size={16} /><div><strong>{check.name}</strong><p>{check.passed === true ? 'Aprobada' : check.passed === false ? 'Fallida' : 'Resultado desconocido'}{check.exitCode != null ? ` · Código ${check.exitCode}` : ''}</p>{check.error && <p className="tw-warning">{check.error}</p>}</div></div>)}<DataView value={run} label="Evidencia fuente completa" /></> : <p className="tw-muted">{typeof detail.latestRun === 'string' ? `Intento referenciado: ${detail.latestRun}. La fuente no incluyó su detalle.` : 'La fuente no incluye un intento de ejecución. Guardar una card no la ejecuta.'}</p>}</section>;
}

export function CardEditor({ workspace, api, initial, onSaved, onCancel }) {
  const [draft, setDraft] = useState(() => cardDraft(initial));
  const [replace, setReplace] = useState(false);
  const op = useOperation();
  const request = useRef(crypto.randomUUID());
  const change = patch => { request.current = crypto.randomUUID(); setDraft(old => ({ ...old, ...patch })); };
  const checkChange = (index, patch) => change({ checks: draft.checks.map((check, i) => i === index ? { ...check, ...patch } : check) });
  return <form className="tw-form plugin-editor" aria-label={initial ? 'Reemplazar card' : 'Nueva card'} onSubmit={e => { e.preventDefault(); op.run(async () => {
    if (initial && !replace) throw new Error('Confirma la creación de un reemplazo; la original se conserva.');
    const input = cardInput(draft);
    const result = await pluginCall(api, workspace.id, initial ? 'update' : 'create', { kind: 'card', input, idempotencyKey: request.current, ...(initial ? { id: initial.id, replace: true } : {}) });
    await onSaved(result);
  }); }}>
    <div className="plugin-heading"><div><h3>{initial ? 'Preparar reemplazo' : 'Nueva card'}</h3><p className="tw-muted">Un contrato de trabajo nativo. Guardar no inicia la ejecución.</p></div><Button icon={X} aria-label="Cancelar formulario de card" disabled={op.busy} onClick={onCancel} /></div>
    <fieldset disabled={op.busy}>
      <Field label="Objetivo de la card"><textarea autoFocus rows={3} value={draft.goal} required onChange={e => change({ goal: e.target.value })} placeholder="Describe el resultado que debe quedar verificado." /></Field>
      <TextList label="Archivos editables" values={draft.scope} onChange={scope => change({ scope })} hint="Una ruta relativa exacta por línea. Por ejemplo: src/App.jsx" />
      <section className="plugin-form-section"><h4>Comprobaciones de aceptación</h4><p className="tw-muted">Declara comandos reales. Una card de planificación puede guardarse sin checks; su ejecución requiere un plan verificable.</p>
        {draft.checks.map((check, index) => <fieldset className="plugin-check" key={index}><legend>Comprobación {index + 1}</legend><Field label="Nombre de la comprobación"><input value={check.name} required onChange={e => checkChange(index, { name: e.target.value })} /></Field><Arguments value={check.argv} onChange={argv => checkChange(index, { argv })} /><Field label="Tipo de comprobación"><select value={check.kind || 'acceptance'} onChange={e => checkChange(index, { kind: e.target.value })}><option value="acceptance">Aceptación</option><option value="regression">Regresión existente</option></select></Field><Button tone="danger" onClick={() => change({ checks: draft.checks.filter((_, i) => i !== index) })}>Quitar comprobación</Button></fieldset>)}
        <Button onClick={() => change({ checks: [...draft.checks, { name: '', argv: [''], kind: 'acceptance' }] })}>Añadir comprobación</Button>
      </section>
      {initial && <label className="tw-check"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Crear una card nueva que reemplaza a la original; conservar ambas</label>}
      <details className="tw-details"><summary>Contrato avanzado · vista previa</summary><p className="tw-muted">Los campos adicionales del contrato original se conservan.</p><pre className="tw-code">{JSON.stringify(draft, null, 2)}</pre></details>
    </fieldset>
    <ErrorNotice error={op.error} /><div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy}>{op.busy ? 'Guardando…' : initial ? 'Crear reemplazo explícito' : 'Crear card en Phantom'}</Button><Button disabled={op.busy} onClick={onCancel}>Cancelar</Button></div>
  </form>;
}

function CardDetail({ id, workspace, api, refresh, onBack, onSaved, onOpenPanel }) {
  const resource = usePluginResource(() => pluginCall(api, workspace.id, 'detail', { topic: 'tasks', id }), `${workspace.id}:${id}`, 5000);
  const [editing, setEditing] = useState(false), [model, setModel] = useState(pluginPreferences(workspace).model), [response, setResponse] = useState(null);
  const [live, setLive] = useState({});
  const op = useOperation();
  useEffect(() => window.phantom?.onEvent?.(event => {
    if (event.workspaceId !== workspace.id) return;
    if (event.type === 'tool.status' || event.type === 'tool.output') setLive(old => ({ ...old, [event.id]: { ...old[event.id], ...event.result, ...(event.type === 'tool.output' ? { output: ((old[event.id]?.output || '') + event.data).slice(-65536) } : { status: event.status }) } }));
  }), [workspace.id]);
  const detail = resource.data;
  if (editing && detail) return <CardEditor workspace={workspace} api={api} initial={detail} onCancel={() => setEditing(false)} onSaved={onSaved} />;
  const controller = workspace.phantomControllers?.findLast(run => run.taskId === id);
  const current = live[response?.id || controller?.id] || response || controller;
  return <section className="plugin-detail"><div className="tw-row"><Button icon={ArrowLeft} onClick={onBack}>Todas las cards</Button><Button icon={RefreshCw} disabled={resource.loading} onClick={() => resource.reload()}>Actualizar fuente</Button></div><ResourceNotice resource={resource} />
    {detail && <><header className="plugin-detail-title"><span className="plugin-status">{stateLabel(detail.status)}</span><h3>{detail.contract?.goal || id}</h3><code>{id}</code><p className="tw-muted">Estado de la card leído de Phantom · {detail.updatedAt || 'Fecha no proporcionada'}</p></header>
      <section className="plugin-form-section"><h4>Alcance y aceptación</h4><ul className="plugin-paths">{detail.contract?.scope?.map(file => <li key={file}><code>{file}</code></li>)}</ul>{!detail.contract?.scope?.length && <p className="tw-muted">La fuente no declara archivos editables.</p>}{detail.contract?.checks?.map((check, index) => <div className="plugin-check-summary" key={index}><CheckSquare size={16} /><div><strong>{check.name}</strong><pre className="tw-code">{JSON.stringify(check.argv)}</pre><small>{check.kind || 'acceptance'} · cwd: {check.cwd || '.'}</small></div></div>)}</section>
      <CardAgents cardId={id} workspace={workspace} onOpenPanel={onOpenPanel} />
      <section className="plugin-form-section"><h4>Ejecución</h4><p className="tw-muted">El controlador envía acciones; solo Phantom acredita la finalización de la card.</p><Field label="Modelo explícito para ejecutar"><input value={model} onChange={e => setModel(e.target.value)} placeholder="Proveedor/modelo" /></Field><div className="tw-row">{['run', 'cancel', 'recover', 'verify', 'stop'].map(action => <Button key={action} icon={action === 'run' ? Play : undefined} tone={action === 'run' ? 'primary' : undefined} disabled={op.busy || (action === 'run' && !model.trim())} onClick={() => op.run(async () => { const value = await pluginCall(api, workspace.id, 'control', { id, action, ...(action === 'run' ? { model: model.trim() } : {}) }); setResponse(value); await refresh(); await resource.reload(); })}>{({ run: 'Ejecutar', cancel: 'Cancelar card', recover: 'Recuperar', verify: 'Verificar', stop: 'Detener controlador' })[action]}</Button>)}</div><ErrorNotice error={op.error} />{current && <><p role="status">Controlador: {current.status || 'Respuesta recibida'}</p>{current.error && <ErrorNotice error={current.error} />}<pre className="tw-code plugin-output">{current.output || current.text || 'Sin salida del controlador.'}</pre></>}</section>
      <AttemptEvidence detail={detail} /><section className="plugin-form-section"><h4>Contrato fuente</h4><DataView value={detail} label="Fuente nativa completa" /><div className="tw-row"><Button onClick={() => setEditing(true)}>Preparar reemplazo</Button><Button disabled={op.busy} onClick={() => op.run(async () => { await api('task.create', { workspaceId: workspace.id, kind: 'phantom', title: detail.contract?.goal || id, phantomId: id, refs: [{ source: 'phantom', id, kind: 'card' }] }); await refresh(); })}>Vincular al proyecto</Button></div></section>
    </>}
  </section>;
}

export default function PhantomCards({ workspace, api, refresh, onOpenPanel, node }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [selected, setSelected] = useState(node?.data?.cardId || ''), [creating, setCreating] = useState(false), [saved, setSaved] = useState('');
  const resource = usePluginResource(() => pluginCall(api, workspace.id, 'list', { topic: 'tasks' }), workspace.id, 5000);
  const op = useOperation();
  const view = pluginPreferences(workspace).cardsView;
  const items = resource.error || resource.data?.available === false ? [] : resource.data?.items || [];
  const cards = filteredCards(items, query, status);
  const onSaved = async result => { setCreating(false); setSelected(result.id); setSaved(`Card guardada en Phantom: ${result.id}`); await resource.reload(); await refresh(); };
  if (creating) return <CardEditor workspace={workspace} api={api} onCancel={() => setCreating(false)} onSaved={onSaved} />;
  if (selected) return <><p className="plugin-save-status" role="status">{saved}</p><CardDetail key={selected} id={selected} workspace={workspace} api={api} refresh={refresh} onBack={() => { setSelected(''); setSaved(''); resource.reload(); }} onSaved={result => { setSelected(''); onSaved(result); }} onOpenPanel={onOpenPanel} /></>;
  const entry = item => <button className="plugin-card-row" key={item.id} onClick={() => setSelected(item.id)}><span className="plugin-status">{stateLabel(item.status)}</span><strong>{item.title || sourceOf(item).contract?.goal || item.id}</strong><small>{item.id}</small></button>;
  return <section className="phantom-cards"><div className="plugin-heading"><div><h3>Cards</h3><p className="tw-muted">Contratos y ejecuciones · Fuente Phantom</p></div><Button icon={FilePlus2} tone="primary" onClick={() => setCreating(true)}>Nueva card</Button></div>
    <div className="plugin-toolbar"><Field label="Buscar cards"><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Objetivo o identificador" /></Field><Field label="Estado de la card"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option>{[...new Set(items.filter(i => i.kind === 'card').map(i => i.status).filter(Boolean))].map(s => <option value={s} key={s}>{stateLabel(s)}</option>)}</select></Field><div className="tw-row" aria-label="Vista de cards">{[['list', 'Lista', List], ['board', 'Tablero', Columns3]].map(([value, name, Icon]) => <Button key={value} icon={Icon} aria-pressed={view === value} disabled={op.busy} onClick={() => op.run(async () => { await api('plugins.update', { workspaceId: workspace.id, pluginId: 'phantom', patch: { preferences: { cardsView: value } } }); await refresh(); })}>{name}</Button>)}<Button icon={RefreshCw} aria-label="Actualizar cards" disabled={resource.loading} onClick={() => resource.reload()} /></div></div>
    <ErrorNotice error={op.error} /><ResourceNotice resource={resource} />{!resource.loading && !resource.error && resource.data?.available !== false && !cards.length && <div className="plugin-empty"><CheckSquare size={26} /><h4>{items.some(i => i.kind === 'card') ? 'Sin coincidencias' : 'Tu próximo trabajo empieza aquí'}</h4><p>{query || status ? 'Cambia la búsqueda o el estado para ver otras cards.' : 'Crea una card con objetivo, archivos y comprobaciones para preparar trabajo verificable.'}</p></div>}
    {view === 'board' ? <div className="plugin-board">{cardGroups(cards).map(group => <section key={group.status} className="plugin-board-column"><h4>{stateLabel(group.status)} <span>{group.items.length}</span></h4>{group.items.map(entry)}</section>)}</div> : <div className="plugin-card-list">{cards.map(entry)}</div>}
  </section>;
}
