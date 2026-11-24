import React, { useState } from 'react';
import { ArrowUpRight, Check, Play, Square, Trash2 } from 'lucide-react';
import EmptyState from '../EmptyState.jsx';
import { envView } from '../../hooks/env-view.mjs';
import { Button, Field, useOperation, useResource, ErrorNotice, DataView, ResourceState, Section, OperationState, Refresh, itemsOf, textValue, statusLabel, hostOf, json, useToolEvents } from '../ToolPanels.jsx';

const active = status => ['running', 'starting', 'queued', 'stopping'].includes(status);

export function ComposeServices({ workspace, api, notify, onOpenPanel }) {
  const env = useResource(api, 'env.list', { workspaceId: workspace.id });
  const op = useOperation(notify);
  const view = envView({ data: env.data, loading: env.loading, error: env.error, nodes: workspace.nodes || [] });
  return <Section title="Servicios del compose" action={<Refresh resource={env} />}>
    {view.state !== 'ready' && <p className={view.state === 'error' ? 'tw-error' : 'tw-muted'} role={view.state === 'error' ? 'alert' : 'status'}>{view.message}</p>}
    {view.groups.map(group => <div key={group.key}><h4 className="tw-muted">{group.title}</h4>{group.rows.map(row => <article className="tw-item" key={row.key}>
      <div className="tw-heading"><strong>{row.name}</strong><span className="tw-badge">{row.lifecycleLabel}</span><span className="tw-badge">{row.status}</span></div>
      <small>Dueño: {row.owner}{row.age ? ` · ${row.age}` : ''}</small>
      {row.root && <small>{row.root}{row.project ? ` · ${row.project}` : ''}</small>}
      {(row.purpose || row.card) && <small>{[row.purpose, row.card && `Card: ${row.card}`].filter(Boolean).join(' · ')}</small>}
      {row.url && <small>{row.url}</small>}
      <div className="tw-row">
        <Button icon={ArrowUpRight} disabled={op.busy || !row.canOpen || !onOpenPanel} onClick={() => op.run(() => onOpenPanel('browser', { url: row.url }, row.name))}>Abrir</Button>
        <Button icon={Trash2} disabled={op.busy || !row.canDown} onClick={() => op.run(async () => { await api('env.down', { workspaceId: workspace.id, service: row.name, ...(row.environmentId ? { environmentId: row.environmentId } : {}) }); env.reload(); }, `${row.name}: eliminado`)}>Detener y eliminar</Button>
      </div>
    </article>)}</div>)}
    <OperationState op={op} />
  </Section>;
}

export function Docker({ workspace, api, notify, onOpenPanel }) {
  const resource = useResource(api, 'docker.list', { workspaceId: workspace.id });
  const [logs, setLogs] = useState(null); const op = useOperation(notify);
  return <><ComposeServices workspace={workspace} api={api} notify={notify} onOpenPanel={onOpenPanel} /><Section title="Contenedores" action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="No hay contenedores de este proyecto." />{itemsOf(resource.data).map(container => { const name = textValue(container.name || container.names, 'Contenedor'); return <article className="tw-item" key={container.id}><div className="tw-heading"><strong>{name}</strong><span className="tw-badge">{statusLabel(container.status || container.state)}</span></div><div className="tw-row">{[['start', 'Iniciar'], ['stop', 'Detener'], ['restart', 'Reiniciar']].map(([action, label]) => <Button key={action} disabled={op.busy} onClick={() => op.run(async () => { await api('docker.action', { workspaceId: workspace.id, id: container.id, action }); resource.reload(); }, `${name}: ${label.toLowerCase()}`)}>{label}</Button>)}<Button disabled={op.busy} onClick={() => op.run(async () => { const value = await api('docker.logs', { workspaceId: workspace.id, id: container.id, tail: 200 }); setLogs({ name, text: String(value.text || '').slice(-64000) }); })}>Ver registro</Button></div><DataView value={container} /></article>; })}</Section>{logs && <Section title={`Registro · ${logs.name}`}><pre className="tw-code" aria-live="polite">{logs.text || 'Sin salida.'}</pre></Section>}<OperationState op={op} /></>;
}

const simpleStep = step => typeof step === 'string' || (step && step.type === 'task' && typeof step.title === 'string' && Object.keys(step).every(key => ['type', 'title'].includes(key)));
export function Workflows(props) {
  const { workspace, api, refresh, notify, onOpenPanel } = props;
  const [edit, setEdit] = useState(null), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [stepsText, setStepsText] = useState(''), [format, setFormat] = useState('text');
  const op = useOperation(notify);
  const reset = () => { setEdit(null); setTitle(''); setDescription(''); setStepsText(''); setFormat('text'); };
  const parseSteps = () => { let steps; if (format === 'json') { try { steps = JSON.parse(stepsText); } catch { throw new Error('Los pasos no son JSON válido.'); } } else steps = stepsText.split('\n').map(text => text.trim()).filter(Boolean).map(text => ({ type: 'task', title: text })); if (!Array.isArray(steps) || !steps.length) throw new Error('Añade al menos un paso.'); return steps; };
  const load = workflow => { const simple = (workflow.steps || []).every(simpleStep); setEdit(workflow.id); setTitle(workflow.title); setDescription(workflow.description || ''); setFormat(simple ? 'text' : 'json'); setStepsText(simple ? (workflow.steps || []).map(step => typeof step === 'string' ? step : step.title).join('\n') : json(workflow.steps)); };
  return <><Section title={edit ? 'Editar secuencia' : 'Nueva secuencia'}><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!title.trim()) throw new Error('Escribe un título.'); const steps = parseSteps(); const previous = workspace.workflows?.find(w => w.id === edit); await api('workflow.save', { workspaceId: workspace.id, ...(edit ? { id: edit } : {}), title: title.trim(), description, steps, version: previous ? previous.version + 1 : 1 }); await refresh(); reset(); }, 'Secuencia guardada'); }}><Field label="Título"><input required value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="Pasos" hint={format === 'json' ? undefined : 'Uno por línea'}><textarea rows={6} className={format === 'json' ? 'tw-code-input' : undefined} spellCheck={format !== 'json'} value={stepsText} onChange={e => setStepsText(e.target.value)} required /></Field>
      <details className="tw-details" open={format === 'json' || undefined}><summary>Detalles</summary><Field label="Descripción"><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field><label className="tw-check"><input type="checkbox" checked={format === 'json'} onChange={e => setFormat(e.target.checked ? 'json' : 'text')} />Escribir los pasos en JSON</label>{format === 'json' && <pre className="tw-code">{'[{ "type": "task", "title": "…" },\n { "type": "playground", "runtime": "node | python | shell", "code": "…" }]'}</pre>}</details>
      <div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy}>Guardar</Button>{edit && <Button onClick={reset}>Cancelar</Button>}</div></form><OperationState op={op} /></Section>
    <Section title="Secuencias">{!workspace.workflows?.length && <EmptyState className="tw-empty" title="Aún no hay secuencias" description="Una secuencia es una lista de pasos que repites: cada paso crea un borrador en Trabajo o ejecuta código." />}{workspace.workflows?.map(workflow => <article className="tw-item" key={workflow.id}><div className="tw-heading"><strong>{workflow.title}</strong><span className="tw-badge">v{workflow.version}</span></div>{workflow.description && <p>{workflow.description}</p>}<div className="tw-row"><Button onClick={() => load(workflow)}>Editar</Button><Button disabled={op.busy} onClick={() => op.run(async () => { await api('workflow.remove', { workspaceId: workspace.id, id: workflow.id }); await refresh(); })}>Eliminar</Button></div>{workflow.steps?.map((step, index) => { const value = typeof step === 'string' ? { type: 'task', title: step } : step; const executable = value.type === 'playground' && ['node', 'python', 'shell'].includes(value.runtime) && typeof value.code === 'string'; return <div className="tw-step tw-row" key={index}><strong>{index + 1}. {value.title || (executable ? 'Ejecutar código' : 'Paso')}</strong>{!simpleStep(step) && <DataView value={value} />}<Button disabled={op.busy} icon={executable ? Play : Check} onClick={() => op.run(async () => { if (executable) { const run = await api('playground.run', { workspaceId: workspace.id, runtime: value.runtime, code: value.code }); onOpenPanel?.('playground', { runId: run.id }, workflow.title); } else { await api('task.create', { workspaceId: workspace.id, kind: 'draft', title: value.title || `${workflow.title}: paso ${index + 1}`, description: typeof value.description === 'string' ? value.description : simpleStep(step) ? '' : json(value), refs: [{ kind: 'workflow', id: workflow.id, version: workflow.version, step: index }] }); await refresh(); } }, executable ? 'En marcha' : 'Borrador creado')}>{executable ? 'Ejecutar' : 'Crear borrador'}</Button></div>; })}</article>)}</Section></>;
}

const RUNTIMES = { node: 'Node', python: 'Python', shell: 'Shell' };
export function Runs({ resource, events, api, workspace, family, op, onOpenPanel }) {
  const [selected, setSelected] = useState(null);
  const [tracePaths, setTracePaths] = useState({});
  const items = itemsOf(resource.data);
  return <Section title="Ejecuciones" action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="Aún no hay ejecuciones." />{items.map(run => {
    const event = events[run.id] || {}, status = event.status || run.status;
    const tracePath = tracePaths[run.id] || event.result?.tracePath || run.tracePath;
    const name = family === 'automation' ? hostOf(run.url) : RUNTIMES[run.runtime] || 'Código';
    return <article className="tw-item" key={run.id}>
      <div className="tw-heading"><strong>{name}</strong><span className="tw-badge">{statusLabel(status)}</span></div>
      {family === 'automation' && <small>{run.mode === 'integrated' ? 'En un panel' : 'Sin ventana'}</small>}
      <div className="tw-row"><Button aria-expanded={selected === run.id} onClick={() => setSelected(selected === run.id ? null : run.id)}>Ver salida</Button>
        {(active(status) || run.browserOpen || run.viewer?.status === 'running') && <Button icon={Square} disabled={op.busy} onClick={() => op.run(async () => { await api(`${family}.stop`, { workspaceId: workspace.id, id: run.id }); resource.reload(); }, 'Detenida')}>Detener</Button>}
        {family === 'automation' && run.mode !== 'integrated' && <Button disabled={op.busy} onClick={() => op.run(async () => {
          const trace = await api('automation.trace', { workspaceId: workspace.id, id: run.id, openViewer: true });
          if (typeof trace.path === 'string' && trace.path) setTracePaths(previous => ({ ...previous, [run.id]: trace.path }));
          if (typeof trace.url !== 'string' || !trace.url) throw new Error('La grabación aún no está lista. Inténtalo cuando termine.');
          const url = new URL(trace.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('No se pudo abrir la grabación.');
          if (!onOpenPanel) throw new Error('No se pudo abrir un panel de navegador.');
          await onOpenPanel('browser', { url: url.href }, `Grabación · ${name}`);
          resource.reload();
        })}>Ver grabación</Button>}
      </div>
      {(event.error || run.error) && <ErrorNotice error={event.error || run.error} />}{selected === run.id && <><pre className="tw-code" aria-live="polite">{event.text || run.output || run.text || 'Sin salida.'}</pre>{typeof tracePath === 'string' && tracePath && <Button disabled={op.busy} onClick={() => op.run(() => api('desktop.openPath', { path: tracePath }))}>Abrir archivo de la grabación</Button>}<DataView value={{ ...run, ...(event.result !== undefined ? { result: event.result } : {}) }} /></>}
    </article>;
  })}</Section>;
}

export function Playground({ workspace, api, notify, node }) {
  const resource = useResource(api, 'playground.list', { workspaceId: workspace.id });
  const events = useToolEvents(workspace.id, resource.reload), op = useOperation(notify);
  const [runtime, setRuntime] = useState(node?.data?.runtime || 'node');
  const [code, setCode] = useState(node?.data?.code || 'console.log("Hola, workspace");');
  return <><Section title="Ejecutar código"><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!code.trim()) throw new Error('Escribe código antes de ejecutar.'); await api('playground.run', { workspaceId: workspace.id, runtime, code }); resource.reload(); }, 'En marcha'); }}><Field label="Lenguaje"><select value={runtime} onChange={e => setRuntime(e.target.value)}><option value="node">Node</option><option value="python">Python</option><option value="shell">Shell</option></select></Field><Field label="Código"><textarea rows={12} spellCheck={false} className="tw-code-input" value={code} onChange={e => setCode(e.target.value)} required /></Field><Button type="submit" tone="primary" icon={Play} disabled={op.busy}>Ejecutar</Button></form><OperationState op={op} /></Section><Runs resource={resource} events={events} api={api} workspace={workspace} family="playground" op={op} /></>;
}

const ACTIONS = [['goto', 'Ir a'], ['click', 'Clic'], ['fill', 'Escribir'], ['screenshot', 'Captura'], ['wait', 'Esperar']];
export function Playwright({ workspace, api, notify, node, onOpenPanel }) {
  const resource = useResource(api, 'automation.list', { workspaceId: workspace.id });
  const events = useToolEvents(workspace.id, resource.reload), op = useOperation(notify);
  const [url, setUrl] = useState(node?.data?.url || ''), [mode, setMode] = useState('integrated'), [actions, setActions] = useState([]);
  const update = (index, patch) => setActions(previous => previous.map((action, i) => i === index ? { ...action, ...patch } : action));
  return <><Section title="Navegador automático">
    <form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => {
      const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('La URL debe ser http o https.');
      await api('automation.start', { workspaceId: workspace.id, url: parsed.href, mode, actions }); resource.reload();
    }, 'En marcha'); }}>
      <Field label="URL"><input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></Field>
      <Field label="Dónde se ejecuta"><select value={mode} onChange={e => setMode(e.target.value)}><option value="integrated">En un panel</option><option value="isolated">Sin ventana (se graba)</option></select></Field>
      {actions.map((action, index) => <fieldset className="tw-action-editor" key={index}><legend>Acción {index + 1}</legend>
        <Field label="Tipo"><select value={action.type} onChange={e => { const type = e.target.value; setActions(old => old.map((a, i) => i === index ? { type, ...(type === 'fill' ? { value: '' } : type === 'wait' ? { milliseconds: 500 } : {}) } : a)); }}>{ACTIONS.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></Field>
        {action.type === 'goto' && <Field label="URL"><input type="url" value={action.url || ''} required onChange={e => update(index, { url: e.target.value })} /></Field>}
        {['click', 'fill'].includes(action.type) && <Field label="Selector"><input required value={action.selector || ''} onChange={e => update(index, { selector: e.target.value })} /></Field>}
        {action.type === 'fill' && <Field label="Texto"><input value={action.value || ''} onChange={e => update(index, { value: e.target.value })} /></Field>}
        {action.type === 'wait' && <Field label="Milisegundos"><input type="number" min="0" max="10000" value={action.milliseconds ?? 500} onChange={e => update(index, { milliseconds: Number(e.target.value) })} /></Field>}
        <Button icon={Trash2} onClick={() => setActions(actions.filter((_, i) => i !== index))}>Quitar</Button>
      </fieldset>)}
      <div className="tw-row"><Button disabled={actions.length >= 50} onClick={() => setActions([...actions, { type: 'screenshot' }])}>Añadir acción</Button><Button type="submit" tone="primary" icon={Play} disabled={op.busy}>Ejecutar</Button></div>
    </form>
    <OperationState op={op} />
  </Section><Runs resource={resource} events={events} api={api} workspace={workspace} family="automation" op={op} onOpenPanel={onOpenPanel} /></>;
}
