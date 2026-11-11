import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, FileText, Play, RefreshCw, Square, Trash2, X } from 'lucide-react';
import '../tools.css';
import { CardAgents } from './AgentIdentity';
import Plugins from './Plugins';
import PhantomCards from './PhantomCards';
import PhantomSkills from './PhantomSkills';
import { DisabledPlugin } from './pluginPrimitives';
import { panelPlugin, pluginEnabled } from '../plugins/registry';
import '../plugins.css';

export const TOOL_TITLES = { plugins: 'Plugins', 'phantom-cards': 'Cards Phantom', 'phantom-skills': 'Skills Phantom', tasks: 'Tareas', context: 'Contexto', sessions: 'Sesiones y misiones', mission: 'Misiones', git: 'Radar Git', services: 'Servicios', docker: 'Docker', workflows: 'Workflows', playwright: 'Playwright', playground: 'Playground', settings: 'Ajustes' };
const json = value => JSON.stringify(value, null, 2);
const textValue = (value, fallback = 'Desconocido') => typeof value === 'string' && value.trim() ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
const message = error => textValue(error?.message, typeof error === 'string' ? error : 'La fuente devolvió un error sin mensaje válido.');
const itemsOf = data => {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (!Array.isArray(data.items)) throw new Error('La fuente devolvió un listado inválido: se esperaba un array items. Reintenta la lectura de esta herramienta.');
  return data.items;
};
const active = status => ['running', 'starting', 'queued', 'stopping'].includes(status);

export class ToolErrorBoundary extends React.Component {
  state = { error: null, attempt: 0 };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <section className="tw-section" role="alert">
      <h3>No se pudo mostrar {this.props.title || 'esta herramienta'}</h3>
      <p>{message(this.state.error)}</p>
      <p className="tw-muted">El fallo queda limitado a esta herramienta. Restablecer vuelve a consultar la fuente; no inicia ejecuciones.</p>
      <div className="tw-row"><Button icon={RefreshCw} onClick={() => this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 }))}>Restablecer herramienta</Button>{this.props.onClose && <Button onClick={this.props.onClose}>Cerrar herramienta</Button>}</div>
    </section>;
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}

export function Button({ children, icon: Icon, tone, ...props }) {
  return <button type="button" className={`tw-button ${tone ? `tw-${tone}` : ''}`} {...props}>{Icon && <Icon size={15} aria-hidden="true" />}{children}</button>;
}
export function Field({ label, children, hint }) {
  const id = useId();
  return <div className="tw-field"><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function ErrorNotice({ error, retry, clear }) {
  if (!error) return null;
  return <div className="tw-error" role="alert"><span>{message(error)}</span><div className="tw-row">{retry && <Button icon={RefreshCw} onClick={retry}>Reintentar</Button>}{clear && <Button onClick={clear}>Descartar error</Button>}</div></div>;
}
export function useOperation(notify) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (fn, success) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { const value = await fn(); if (success) notify?.(success, 'success'); return { ok: true, value }; }
    catch (e) { if (mounted.current) setError(e); return { ok: false }; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  return { busy, error, run, clear: () => setError(null) };
}
function useResource(api, method, payload) {
  const key = JSON.stringify(payload), sequence = useRef(0);
  const [result, setResult] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    setResult(old => ({ ...old, loading: true, error: null }));
    try {
      const data = await api(method, JSON.parse(key));
      if (seq === sequence.current) setResult({ loading: false, data, error: null });
    } catch (error) { if (seq === sequence.current) setResult({ loading: false, data: null, error }); }
  }, [api, method, key]);
  useEffect(() => { reload(); return () => { sequence.current++; }; }, [reload]);
  return { ...result, reload };
}
function ResourceState({ resource, empty = 'No hay elementos. Usa el formulario para añadir el primero.' }) {
  if (resource.loading) return <p className="tw-muted" role="status">Consultando la fuente…</p>;
  if (resource.error) return <ErrorNotice error={resource.error} retry={resource.reload} />;
  if (resource.data?.available === false) return <p className="tw-warning">{textValue(resource.data.reason, 'La herramienta no está disponible en este host.')} Revisa su instalación o la ruta en Ajustes.</p>;
  return empty && itemsOf(resource.data).length === 0 ? <p className="tw-empty">{empty}</p> : null;
}
export function DataView({ value, label = 'Datos de la fuente' }) {
  return <details className="tw-details"><summary>{label}</summary><pre className="tw-code">{typeof value === 'string' ? value : json(value)}</pre></details>;
}
function Identity({ value }) {
  const [copied, setCopied] = useState(false), op = useOperation();
  if (value == null) return <span className="tw-muted">Desconocido</span>;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return <span className="tw-identity"><span className="tw-truncate" title={text}>{text}</span><Button icon={copied ? Check : Copy} aria-label="Copiar identificador o ruta" onClick={() => op.run(async () => { await navigator.clipboard.writeText(text); setCopied(true); })} /><ErrorNotice error={op.error} clear={op.clear} /></span>;
}
function Section({ title, children, action }) {
  return <section className="tw-section"><div className="tw-heading"><h3>{title}</h3>{action}</div>{children}</section>;
}
function OperationState({ op }) { return <><ErrorNotice error={op.error} clear={op.clear} />{op.busy && <p className="tw-muted" role="status">Procesando…</p>}</>; }
function Refresh({ resource }) { return <Button icon={RefreshCw} disabled={resource.loading} onClick={resource.reload}>Actualizar</Button>; }

// These forms also power voice drafts: canonical objects never pass through local task updates.
export function NativeForm({ kind = 'card', workspace, api, refresh, notify, initialText = '', existing, onSaved }) {
  const rawSource = existing?.raw || existing;
  const source = Array.isArray(rawSource) ? rawSource.at(-1)?.record || {} : rawSource;
  const seed = () => {
    if (existing) {
      if (kind === 'card') return json(source.contract || source.spec || {});
      if (kind === 'skill') return json(source.manifest || source.input || {});
      return json(Object.fromEntries(['key', 'kind', 'title', 'body', 'scope', 'space', 'evidence', 'expiresAt'].filter(k => source[k] !== undefined).map(k => [k, source[k]])));
    }
    if (kind === 'card') return json({ goal: initialText, lane: 'coordinated', workspace: workspace.canonicalPath || workspace.path, scope: [], checks: [] });
    if (kind === 'decision') return json({ key: '', kind: 'decision', title: initialText.slice(0, 200), body: initialText, scope: '.', space: 'workspace', evidence: [] });
    return json({ id: '', version: '1.0.0', description: '', actions: [], body: '', requiresTools: [], resources: [] });
  };
  const [input, setInput] = useState(seed), [revision, setRevision] = useState(String(source?.revision ?? source?.ref?.version ?? existing?.revision ?? ''));
  const [replace, setReplace] = useState(false), [result, setResult] = useState(null);
  const op = useOperation(notify);
  return <form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => {
    const parsed = JSON.parse(input);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('El JSON debe ser un objeto. Corrige el formulario y vuelve a guardar.');
    if (kind === 'card' && (!parsed.goal?.trim() || !Array.isArray(parsed.scope) || !Array.isArray(parsed.checks))) throw new Error('La card requiere goal, scope y checks. Declara los archivos y argumentos reales; si aún no los conoces, guarda un borrador local.');
    if (existing && kind === 'card' && !replace) throw new Error('Confirma explícitamente la creación de una card de reemplazo.');
    if (kind === 'card' && parsed.lane !== 'coordinated') throw new Error('Una card nativa requiere lane: coordinated. Declara el alcance y los checks reales antes de crearla.');
    if (existing && kind !== 'card' && !revision.trim()) throw new Error('Introduce la revisión fuente antes de actualizar.');
    if (existing && (typeof existing.id !== 'string' || !existing.id)) throw new Error('La fuente no devolvió una identidad nativa válida. Vuelve a leer la entrada antes de actualizar.');
    const value = await api(existing ? 'phantom.update' : 'phantom.create', { workspaceId: workspace.id, kind, input: parsed, ...(existing ? { id: existing.id, ...(kind === 'card' ? { replace: true } : { revision: /^\d+$/.test(revision) ? Number(revision) : revision }) } : {}) });
    setResult(value); await refresh?.(); onSaved?.(value);
  }, existing && kind !== 'card' ? 'Actualización enviada a Phantom' : 'Creación enviada a Phantom'); }}>
    <p className="tw-muted">{existing ? 'Edición nativa; la fuente valida la revisión y el esquema.' : 'Plantilla de entrada sin guardar; completa los campos vacíos. No representa datos existentes.'} {kind === 'card' && 'No se ejecutará al guardar. No inventes archivos ni checks.'}{kind === 'skill' && 'Las versiones de skills son inmutables: declara una nueva versión para cambios.'}</p>
    <Field label={kind === 'card' ? 'Contrato JSON (goal, lane, workspace, scope, checks con argv)' : kind === 'decision' ? 'Decisión JSON (key, kind, title, body, scope, space, evidence)' : 'Manifiesto JSON de skill (id, version, description, actions, body)'}><textarea className="tw-code-input" rows={12} value={input} onChange={e => setInput(e.target.value)} required spellCheck={false} /></Field>
    {existing && kind !== 'card' && <Field label="Revisión fuente esperada"><input value={revision} onChange={e => setRevision(e.target.value)} required /></Field>}
    {existing && kind === 'card' && <label className="tw-check"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Crear una card de reemplazo; conservar la original</label>}
    <OperationState op={op} /><Button type="submit" tone="primary" disabled={op.busy}>{existing ? kind === 'card' ? 'Crear reemplazo explícito' : 'Guardar revisión nativa' : `Crear ${kind === 'card' ? 'card' : kind === 'decision' ? 'decisión' : 'skill'} en Phantom`}</Button>
    {result && <DataView value={result} label="Resultado real de Phantom" />}
  </form>;
}

function Attention({ workspace, api, refresh, notify }) {
  const resource = useResource(api, 'attention.list', { workspaceId: workspace.id });
  const op = useOperation(notify);
  return <Section title="Atención" action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="Sin avisos pendientes de lectura." />{itemsOf(resource.data).map(item => <div className="tw-list-row" key={item.id}><div><strong>{item.title}</strong><small>{item.source || 'Fuente desconocida'} · {item.acknowledgedAt || item.ackedAt ? 'Leído' : 'Pendiente'}</small>{item.ref && <DataView value={item.ref} label="Referencia" />}</div><Button disabled={op.busy} onClick={() => op.run(async () => { await api('attention.ack', { workspaceId: workspace.id, id: item.id }); await refresh?.(); resource.reload(); })}>Marcar leído</Button></div>)}<OperationState op={op} /></Section>;
}

function Tasks(props) {
  const { workspace, api, refresh, notify } = props;
  const [mode, setMode] = useState('draft'), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [edit, setEdit] = useState(null);
  const source = useResource(api, 'phantom.list', { workspaceId: workspace.id, topic: 'tasks' });
  const op = useOperation(notify);
  const [cardId, setCardId] = useState(props.node?.data?.cardId || '');
  useEffect(() => { setCardId(props.node?.data?.cardId || ''); }, [props.node?.data?.cardId]);
  if (cardId) return <Section title="Card vinculada" action={<Refresh resource={source} />}><Button onClick={() => setCardId('')}>Ver todas las tareas</Button><ResourceState resource={source} empty="" />{itemsOf(source.data).filter(item => item.id === cardId).map(item => <PhantomItem key={item.id} item={item} topic="tasks" kind="card" {...props} onChange={source.reload} />)}{!source.loading && source.data?.available && !itemsOf(source.data).some(item => item.id === cardId) && <p className="tw-warning">La card vinculada ya no aparece en esta carpeta. Actualiza la fuente o revisa el vínculo desde la terminal.</p>}</Section>;
  return <><Section title="Añadir trabajo"><Field label="Tipo de entrada"><select value={mode} onChange={e => { setMode(e.target.value); setEdit(null); }}><option value="draft">Borrador local</option><option value="checklist">Checklist local</option><option value="card">Card nativa Phantom</option><option value="decision">Decisión nativa Phantom</option></select></Field>
    {['card', 'decision'].includes(mode) ? <NativeForm key={mode} kind={mode} {...props} onSaved={source.reload} /> : <form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!title.trim()) throw new Error('Escribe un título.'); await api(edit ? 'task.update' : 'task.create', { workspaceId: workspace.id, ...(edit ? { id: edit, patch: { title: title.trim(), description, kind: mode } } : { title: title.trim(), description, kind: mode, status: 'todo', refs: [] }) }); await refresh(); setTitle(''); setDescription(''); setEdit(null); }, 'Tarea local guardada'); }}>
      <Field label="Título"><input value={title} onChange={e => setTitle(e.target.value)} required /></Field><Field label="Descripción / checklist"><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} /></Field><div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy}>{edit ? 'Guardar cambios locales' : 'Crear tarea local'}</Button>{edit && <Button onClick={() => { setEdit(null); setTitle(''); setDescription(''); }}>Cancelar edición</Button>}</div>
    </form>}<OperationState op={op} /></Section>
    <Section title="Trabajo local y referencias">{!workspace.tasks?.length && <p className="tw-empty">Crea un borrador para capturar trabajo, o vincula una card desde la lista de Phantom.</p>}{workspace.tasks?.map(task => <article className="tw-item" key={task.id}><div className="tw-heading"><strong>{task.title}</strong><span className="tw-badge">{task.kind === 'phantom' ? 'Referencia Phantom' : task.kind === 'checklist' ? 'Checklist local' : 'Borrador local'}</span></div>{task.description && <p className="tw-prose">{task.description}</p>}<Identity value={task.phantomId || task.id} />{task.kind !== 'phantom' ? <div className="tw-row"><Field label="Estado local"><select value={task.status} disabled={op.busy} onChange={e => op.run(async () => { await api('task.update', { workspaceId: workspace.id, id: task.id, patch: { status: e.target.value } }); await refresh(); })}><option value="todo">Por hacer</option><option value="doing">En curso</option><option value="done">Completada</option></select></Field><Button onClick={() => { setEdit(task.id); setTitle(task.title); setDescription(task.description || ''); setMode(task.kind); }}>Editar</Button><Button icon={Trash2} disabled={op.busy} onClick={() => op.run(async () => { await api('task.remove', { workspaceId: workspace.id, id: task.id }); await refresh(); })}>Eliminar local</Button></div> : <p className="tw-muted">Estado fuente: consulta la card en Phantom abajo. No se completa localmente.</p>}{task.refs?.length > 0 && <DataView value={task.refs} label="Referencias y evidencias" />}</article>)}</Section>
    <Section title="Cards de Phantom" action={<Refresh resource={source} />}><ResourceState resource={source} empty="Phantom no devuelve cards para esta carpeta. Puedes crear un contrato arriba." />{itemsOf(source.data).map(item => <PhantomItem key={item.id} item={item} topic="tasks" kind="card" {...props} onChange={source.reload} />)}</Section><Attention {...props} /></>;
}

function PhantomItem({ item, topic, kind, workspace, api, refresh, notify, onChange, onOpenPanel }) {
  const [detail, setDetail] = useState(null), [editing, setEditing] = useState(false), [output, setOutput] = useState(null);
  const [model, setModel] = useState('');
  const events = useToolEvents(workspace.id, onChange);
  const persistedController = workspace.phantomControllers?.findLast(run => run.taskId === item.id);
  const controller = events[output?.id || persistedController?.id] || persistedController;
  const editable = topic !== 'memories' || item.kind === 'decision';
  const op = useOperation(notify);
  const read = () => op.run(async () => { const ref = item.raw?.ref || item.ref; setDetail(await api('phantom.detail', { workspaceId: workspace.id, topic, id: item.id, ...(ref != null ? { ref } : {}) })); });
  return <article className="tw-item"><div className="tw-heading"><strong>{item.title || item.id}</strong><span className="tw-badge">Fuente: {item.status || 'estado desconocido'}</span></div><Identity value={item.id} /><small>Origen: {typeof item.source === 'object' ? json(item.source) : item.source || 'desconocido'} · revisión: {item.revision ?? item.raw?.ref?.version ?? 'desconocida'}</small>{(item.raw?.ref?.sha256 || item.raw?.sha256) && <Identity value={item.raw.ref?.sha256 || item.raw.sha256} />}
    <div className="tw-row"><Button icon={FileText} disabled={op.busy} onClick={read}>Leer fuente, contrato y evidencia</Button><Button disabled={op.busy} onClick={() => op.run(async () => {
      const source = item.source != null ? { source: item.source } : {};
      if (topic === 'tasks') await api('task.create', { workspaceId: workspace.id, title: item.title || item.id, kind: 'phantom', phantomId: item.id, refs: [{ ...source, id: item.id, kind: 'card' }] });
      else await api('context.pin', { workspaceId: workspace.id, kind, title: item.title || item.id, ...source, ref: item.raw?.ref || item.ref || { id: item.id, ...(item.revision != null ? { revision: item.revision } : {}) } });
      await refresh();
    }, 'Referencia guardada')}>Vincular referencia</Button></div>
    {kind === 'card' && <CardAgents cardId={item.id} workspace={workspace} onOpenPanel={onOpenPanel} />}
    {detail && <><DataView value={detail} label="Fuente nativa completa" />{editable && <Button onClick={() => setEditing(!editing)}>{editing ? 'Cerrar edición nativa' : kind === 'card' ? 'Preparar reemplazo de card' : 'Editar JSON nativo'}</Button>}{editing && <NativeForm kind={kind} workspace={workspace} api={api} refresh={refresh} notify={notify} existing={{ ...item, raw: detail }} onSaved={() => { setEditing(false); setDetail(null); onChange?.(); }} />}</>}
    {kind === 'card' && <details className="tw-details"><summary>Control explícito de Phantom</summary><p className="tw-muted">Las acciones se envían al controlador. El estado mostrado procede siempre de Phantom.</p><Field label="Modelo para ejecutar (proveedor/modelo)"><input value={model} onChange={e => setModel(e.target.value)} placeholder="Modelo real configurado en el host" /></Field><div className="tw-row">{['run', 'cancel', 'recover', 'verify', 'stop'].map(action => <Button key={action} disabled={op.busy || (action === 'run' && !model.trim())} onClick={() => op.run(async () => { const value = await api('phantom.control', { workspaceId: workspace.id, id: item.id, action, ...(action === 'run' ? { model: model.trim() } : {}) }); setOutput(value); onChange?.(); }, 'Acción enviada al controlador')}>{({ run: 'Ejecutar', cancel: 'Cancelar', recover: 'Recuperar', verify: 'Verificar', stop: 'Detener' })[action]}</Button>)}</div></details>}
    {output && <DataView value={output} label="Respuesta del controlador" />}{controller && <><p className="tw-muted">Controlador: {controller.status || output?.status || 'estado desconocido'}</p><pre className="tw-code" aria-live="polite">{controller.text || controller.output || 'Sin salida nueva.'}</pre><ErrorNotice error={controller.error} /></>}<OperationState op={op} />
  </article>;
}

function DocumentItem({ item, workspace, api, refresh, op, onRead }) {
  const path = typeof item.path === 'string' && item.path ? item.path : null;
  const hash = item.hash ?? item.sha256;
  const title = textValue(item.title, path || 'Documento sin ruta');
  return <article className="tw-item"><strong>{title}</strong><Identity value={path} />
    <small>Fuente: {textValue(item.source)} · revisión: {textValue(item.revision)}</small>
    {typeof hash === 'string' && hash ? <><small>Hash fuente</small><Identity value={hash} /></> : <small>Hash: no proporcionado por la fuente</small>}
    <div className="tw-row"><Button disabled={op.busy || !path} onClick={() => op.run(async () => { onRead(await api('context.read', { workspaceId: workspace.id, path })); })}>Leer documento</Button>
      <Button disabled={op.busy || !path} onClick={() => op.run(async () => {
        const ref = { path, ...(typeof hash === 'string' && hash ? { hash } : {}), ...(item.revision != null ? { revision: item.revision } : {}) };
        await api('context.pin', { workspaceId: workspace.id, path, title, kind: textValue(item.kind, 'document'), ...(item.source != null ? { source: item.source } : {}), ref });
        await refresh();
      }, 'Documento fijado')}>Fijar referencia</Button></div>
  </article>;
}

function Context(props) {
  const { workspace, api, refresh, notify } = props;
  const [tab, setTab] = useState('docs'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [detail, setDetail] = useState(null);
  const topic = tab === 'skills' ? 'skills' : 'memories';
  const resource = useResource(api, tab === 'docs' ? 'context.scan' : 'phantom.list', { workspaceId: workspace.id, query: search, ...(tab === 'docs' ? {} : { topic }) });
  const op = useOperation(notify);
  return <><div className="tw-tabs" aria-label="Tipo de contexto">{[['docs', 'Documentos'], ['decisions', 'Decisiones / memorias'], ['skills', 'Skills']].map(([id, title]) => <Button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setDetail(null); }}>{title}</Button>)}</div>
    <form className="tw-search" onSubmit={e => { e.preventDefault(); setSearch(query); if (query === search) resource.reload(); }}><Field label="Buscar en fuentes permitidas"><input type="search" value={query} onChange={e => setQuery(e.target.value)} /></Field><Button type="submit" disabled={resource.loading}>Buscar</Button></form>
    <Section title={tab === 'docs' ? 'Documentos de la carpeta' : tab === 'skills' ? 'Catálogo nativo de skills' : 'Decisiones y memorias nativas'} action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="No hay resultados en esta fuente. Cambia la búsqueda o crea una entrada nativa." />{resource.data?.truncated && <p className="tw-warning">Listado acotado; afina la búsqueda para ver otras fuentes.</p>}
      {itemsOf(resource.data).map((item, index) => tab === 'docs' ? <DocumentItem key={item.path || index} item={item} workspace={workspace} api={api} refresh={refresh} op={op} onRead={setDetail} /> : <PhantomItem key={item.id} item={item} topic={topic} kind={tab === 'skills' ? 'skill' : 'decision'} {...props} onChange={resource.reload} />)}
      {detail && <div className="tw-item"><Identity value={detail.path} />{detail.truncated && <p className="tw-warning">Contenido truncado por el límite de lectura.</p>}<pre className="tw-code">{detail.text}</pre><DataView value={detail} label="Metadatos de lectura" /></div>}
    </Section><OperationState op={op} />
    {tab !== 'docs' && <Section title={tab === 'skills' ? 'Publicar skill' : 'Declarar decisión'}><NativeForm key={tab} kind={tab === 'skills' ? 'skill' : 'decision'} {...props} onSaved={resource.reload} /></Section>}
    <Section title="Referencias fijadas">{!workspace.contextRefs?.length && <p className="tw-empty">Fija un documento o una referencia nativa desde su fuente.</p>}{workspace.contextRefs?.map(ref => <div className="tw-item" key={ref.id}><strong>{ref.title}</strong><Identity value={ref.path || ref.id} /><DataView value={ref} label="Fuente, revisión y hash guardados" /><Button icon={Trash2} disabled={op.busy} onClick={() => op.run(async () => { await api('context.unpin', { workspaceId: workspace.id, id: ref.id }); await refresh(); })}>Quitar referencia</Button></div>)}</Section></>;
}

function Missions(props) {
  const { workspace, api, refresh, notify, onOpenPanel } = props;
  const sessions = useResource(api, 'terminal.list', { workspaceId: workspace.id });
  const runs = useResource(api, 'playground.list', { workspaceId: workspace.id });
  const automation = useResource(api, 'automation.list', { workspaceId: workspace.id });
  const [edit, setEdit] = useState(null), [title, setTitle] = useState(''), [notes, setNotes] = useState(''), [nextAction, setNextAction] = useState(''), [refs, setRefs] = useState([]);
  const op = useOperation(notify);
  const candidates = [...(workspace.nodes || []).map(n => ({ kind: 'node', id: n.id, title: n.title || n.type })), ...(workspace.tasks || []).map(t => ({ kind: 'task', id: t.id, title: t.title })), ...itemsOf(runs.data).map(r => ({ kind: 'run', id: r.id, title: `Playground ${r.id}` })), ...itemsOf(automation.data).map(r => ({ kind: 'run', id: r.id, title: `Playwright ${r.id}` })), ...(workspace.contextRefs || []).map(r => ({ kind: 'context', id: r.id, title: r.title }))];
  const reset = () => { setEdit(null); setTitle(''); setNotes(''); setNextAction(''); setRefs([]); };
  return <><Section title={edit ? 'Editar misión' : 'Crear misión'}><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!title.trim()) throw new Error('Escribe un título para la misión.'); const fields = { title: title.trim(), notes, nextAction, refs }; await api(edit ? 'mission.update' : 'mission.create', { workspaceId: workspace.id, ...(edit ? { id: edit, patch: fields } : fields) }); await refresh(); reset(); }, 'Misión guardada'); }}><Field label="Título"><input required value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="Notas de continuidad"><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></Field><Field label="Próxima acción"><textarea rows={2} value={nextAction} onChange={e => setNextAction(e.target.value)} /></Field><Field label="Vincular panel, tarea, ejecución o marcador existente"><select value="" onChange={e => { const ref = candidates.find(c => `${c.kind}:${c.id}` === e.target.value); if (ref && !refs.some(r => r.id === ref.id && r.kind === ref.kind)) setRefs([...refs, ref]); }}><option value="">Elegir referencia…</option>{candidates.map(c => <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>{c.kind} · {c.title}</option>)}</select></Field>{refs.map((ref, i) => <div className="tw-list-row" key={`${ref.kind}:${ref.id}:${i}`}><Identity value={ref.title || ref.id} /><Button aria-label={`Desvincular ${ref.title || ref.id}`} icon={X} onClick={() => setRefs(refs.filter((_, index) => index !== i))} /></div>)}<div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy}>Guardar misión</Button>{edit && <Button onClick={reset}>Cancelar edición</Button>}</div></form><OperationState op={op} /></Section>
    <Section title="Dossiers de misión">{!workspace.missions?.length && <p className="tw-empty">Guarda notas y la próxima acción para retomar el proyecto con contexto.</p>}{workspace.missions?.map(mission => <article className="tw-item" key={mission.id}><strong>{mission.title}</strong><p className="tw-prose">{mission.notes}</p><p><b>Próxima acción: </b>{mission.nextAction || 'Sin definir'}</p><DataView value={mission.refs} label="Referencias / marcadores fuente" /><div className="tw-row"><Button onClick={() => { setEdit(mission.id); setTitle(mission.title); setNotes(mission.notes || ''); setNextAction(mission.nextAction || ''); setRefs(mission.refs || []); }}>Editar misión</Button><Button onClick={() => onOpenPanel?.('mission', { missionId: mission.id }, mission.title)}>Abrir panel de misión</Button><Button disabled={op.busy} onClick={() => op.run(async () => { await api('mission.remove', { workspaceId: workspace.id, id: mission.id }); await refresh(); })}>Eliminar notas</Button></div></article>)}</Section>
    <Section title="Paneles de esta carpeta">{!workspace.nodes?.length && <p className="tw-empty">Crea un panel desde la barra del workspace.</p>}{workspace.nodes?.map(node => <div className="tw-item" key={node.id}><div className="tw-heading"><strong>{node.title || node.type}</strong><span className="tw-badge">{node.type}</span></div><Identity value={node.id} /><small>Proveedor: {node.data?.provider || 'desconocido'} · identidad: {node.data?.providerSessionId || 'no declarada'}</small><div className="tw-row"><Button icon={ArrowUpRight} onClick={() => onOpenPanel?.(node.type, { ...node.data, nodeId: node.id, focusNodeId: node.id }, node.title)}>Ir al panel</Button><Field label="Grupo de misión"><select value={node.groupId || ''} disabled={op.busy} onChange={e => op.run(async () => { await api('node.update', { workspaceId: workspace.id, id: node.id, patch: { groupId: e.target.value || null } }); await refresh(); })}><option value="">Sin grupo</option>{workspace.missions?.map(m => <option value={m.id} key={m.id}>{m.title}</option>)}</select></Field></div></div>)}</Section>
    <Section title="Sesiones de terminal" action={<Refresh resource={sessions} />}><ResourceState resource={sessions} empty="No hay sesiones de terminal registradas en este workspace." />{itemsOf(sessions.data).map(s => <div className="tw-item" key={s.id}><Identity value={s.id} /><small>{s.status} · PID {s.pid ?? 'desconocido'} · proveedor {s.provider || 'desconocido'}</small><DataView value={s} label="Descriptor real de sesión" /></div>)}</Section>
    <details className="tw-details"><summary>Fuentes de ejecuciones vinculables</summary><ResourceState resource={runs} empty="Sin ejecuciones de playground." /><ResourceState resource={automation} empty="Sin ejecuciones de Playwright." /></details><Attention {...props} /></>;
}

function Git({ workspace, api }) {
  const [base, setBase] = useState(''), [chosenBase, setChosenBase] = useState('');
  const resource = useResource(api, 'git.inspect', { workspaceId: workspace.id, ...(chosenBase.trim() ? { base: chosenBase.trim() } : {}) });
  const data = resource.data;
  return <><form className="tw-search" onSubmit={e => { e.preventDefault(); setChosenBase(base); if (base === chosenBase) resource.reload(); }}><Field label="Base de comparación (vacío: base del adaptador)"><input value={base} onChange={e => setBase(e.target.value)} placeholder="Referencia Git opcional" /></Field><Button type="submit" icon={RefreshCw} disabled={resource.loading}>Inspeccionar</Button></form><ResourceState resource={resource} empty="" />{data?.available && <><Section title="Repositorio"><Identity value={data.root} /><p>Rama: <b>{data.branch || 'desconocida / HEAD separado'}</b> · base: {data.base || 'desconocida'}</p><p>Árbol: {data.dirty === true ? 'Con cambios' : data.dirty === false ? 'Limpio' : 'desconocido'} · observado: {data.observedAt || 'desconocido'}</p></Section><Section title="Ramas"><div className="tw-table-scroll"><table className="tw-table"><thead><tr><th>Rama</th><th>Adelante / detrás</th><th>Integración en base</th></tr></thead><tbody>{data.branches?.map(branch => <tr key={branch.name}><td><span title={branch.oid}>{branch.current ? 'Actual · ' : ''}{branch.name}</span></td><td>{branch.ahead ?? '?'} / {branch.behind ?? '?'}</td><td>{branch.merged === true ? 'Integrada' : branch.merged === false ? 'No integrada (no implica lista)' : 'Desconocida'}</td></tr>)}</tbody></table></div></Section><Section title="Cambios">{!data.changes?.length && <p className="tw-empty">No se observaron cambios.</p>}{data.changes?.map((change, i) => <div className="tw-list-row" key={i}><Identity value={typeof change === 'string' ? change : change.path || change.file} /><span className="tw-badge">{change.status || change.xy || '?'}</span><DataView value={change} label="Detalle" /></div>)}</Section><Section title="Worktrees">{data.worktrees?.map((tree, i) => <div className="tw-item" key={i}><Identity value={tree.path || tree.worktree} /><DataView value={tree} /></div>)}</Section></>}</>;
}

function ServiceOwner({ owner, workspace, onOpenPanel, op }) {
  if (typeof owner === 'string') return <small>Propietario: {textValue(owner)}</small>;
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return <small>Propietario: desconocido</small>;
  const sessionId = typeof owner.sessionId === 'string' && owner.sessionId ? owner.sessionId : null;
  const node = sessionId && workspace.nodes?.find(node => node.type === 'terminal' && node.data?.sessionId === sessionId);
  const containerId = typeof owner.containerId === 'string' && owner.containerId ? owner.containerId : null;
  return <div>
    {sessionId || Number.isSafeInteger(owner.pid) ? <><small>Proceso propio · PID {Number.isSafeInteger(owner.pid) && owner.pid > 0 ? owner.pid : 'desconocido'}</small>
      {sessionId ? <><small>Sesión propietaria</small><Identity value={sessionId} />{node && onOpenPanel ? <Button icon={ArrowUpRight} disabled={op.busy} onClick={() => op.run(() => onOpenPanel('terminal', { focusNodeId: node.id }, textValue(node.title, 'Terminal')))}>Ir a sesión propietaria</Button> : <small>No se encontró un panel de terminal asociado a esta sesión.</small>}</> : <small>Sesión: desconocida</small>}
    </> : containerId ? <><small>Contenedor propietario</small><Identity value={containerId} /><small>Daemon: {textValue(owner.daemon)} · contexto: {textValue(owner.context)}</small></> : <small>Propietario: forma desconocida; consulta los datos de la fuente.</small>}
  </div>;
}

function Services({ workspace, api, refresh, notify, onOpenPanel }) {
  const resource = useResource(api, 'services.list', { workspaceId: workspace.id });
  const [url, setUrl] = useState(''), [title, setTitle] = useState(''); const op = useOperation(notify);
  return <><Section title="Fijar un sitio"><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => {
    const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Usa una URL http o https.');
    await api('services.pin', { workspaceId: workspace.id, url: parsed.href, title: title.trim() || parsed.host }); await refresh(); resource.reload(); setUrl(''); setTitle('');
  }, 'Sitio fijado'); }}><Field label="URL"><input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:3000" /></Field><Field label="Nombre opcional"><input value={title} onChange={e => setTitle(e.target.value)} /></Field><Button type="submit" tone="primary" disabled={op.busy}>Fijar URL</Button></form></Section>
    <Section title="Servicios y sitios" action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="Fija una URL o inicia un servicio propio para verlo aquí." />
      {resource.data?.processReason && <p className="tw-warning">Atribución de procesos incompleta: {textValue(resource.data.processReason)}</p>}
      {resource.data?.dockerReason && <p className="tw-muted">Docker: {textValue(resource.data.dockerReason)}</p>}
      {itemsOf(resource.data).map((service, index) => {
        const serviceURL = typeof service.url === 'string' ? service.url : null;
        const label = textValue(service.title, serviceURL || 'Servicio sin título');
        return <article className="tw-item" key={textValue(service.id, `service-${index}`)}>
          <div className="tw-heading"><strong>{label}</strong><span className="tw-badge">Estado: {textValue(service.status, 'desconocido')}</span></div>
          <Identity value={serviceURL} /><small>Fuente: {textValue(service.source, 'desconocida')} · salud: {textValue(service.health, 'desconocida')} · observado: {textValue(service.observedAt || resource.data?.observedAt, 'desconocido')}</small>
          <ServiceOwner owner={service.owner} workspace={workspace} onOpenPanel={onOpenPanel} op={op} />
          <div className="tw-row"><Button icon={ArrowUpRight} disabled={op.busy || !serviceURL || !onOpenPanel} onClick={() => op.run(() => onOpenPanel('browser', { url: serviceURL }, label))}>Abrir en navegador</Button>
            {service.source === 'pinned' && typeof service.id === 'string' && <Button icon={Trash2} disabled={op.busy} onClick={() => op.run(async () => { await api('services.remove', { workspaceId: workspace.id, id: service.id }); await refresh(); resource.reload(); })}>Quitar URL fijada</Button>}
          </div><DataView value={service} label="Datos originales del servicio" />
        </article>;
      })}
    </Section><OperationState op={op} /></>;
}

function Docker({ workspace, api, notify }) {
  const resource = useResource(api, 'docker.list', { workspaceId: workspace.id });
  const [logs, setLogs] = useState(null); const op = useOperation(notify);
  return <><p className="tw-muted">Solo contenedores cuya pertenencia a este proyecto ha comprobado el host. La disponibilidad del daemon no implica salud de la aplicación.</p><Section title="Contenedores propios" action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="No se encontraron contenedores atribuibles a este proyecto. Revisa las etiquetas Compose y el contexto Docker." />{itemsOf(resource.data).map(container => <article className="tw-item" key={container.id}><div className="tw-heading"><strong>{container.name || container.names || container.id}</strong><span className="tw-badge">{container.status || container.state || 'Estado desconocido'}</span></div><Identity value={container.id} /><DataView value={container} label="Imagen, contexto y pertenencia observados" /><div className="tw-row">{[['start', 'Iniciar'], ['stop', 'Detener'], ['restart', 'Reiniciar']].map(([action, label]) => <Button key={action} disabled={op.busy} onClick={() => op.run(async () => { await api('docker.action', { workspaceId: workspace.id, id: container.id, action }); resource.reload(); }, `${label}: acción enviada`)}>{label}</Button>)}<Button disabled={op.busy} onClick={() => op.run(async () => { const value = await api('docker.logs', { workspaceId: workspace.id, id: container.id, tail: 200 }); setLogs({ id: container.id, text: String(value.text || '').slice(-64000) }); })}>Últimas 200 líneas</Button></div></article>)}</Section>{logs && <Section title="Logs acotados"><Identity value={logs.id} /><pre className="tw-code" aria-live="polite">{logs.text || 'Sin salida en el intervalo solicitado.'}</pre></Section>}<OperationState op={op} /></>;
}

function Workflows(props) {
  const { workspace, api, refresh, notify, onOpenPanel } = props;
  const [edit, setEdit] = useState(null), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [stepsText, setStepsText] = useState(''), [format, setFormat] = useState('text'), [preview, setPreview] = useState(null);
  const skills = useResource(api, 'phantom.list', { workspaceId: workspace.id, topic: 'skills' }); const op = useOperation(notify);
  const reset = () => { setEdit(null); setTitle(''); setDescription(''); setStepsText(''); setPreview(null); };
  const parseSteps = () => { const steps = format === 'json' ? JSON.parse(stepsText) : stepsText.split('\n').map(text => text.trim()).filter(Boolean).map(text => ({ type: 'task', title: text })); if (!Array.isArray(steps) || !steps.length) throw new Error('Declara al menos un paso en un array JSON o una línea de texto.'); return steps; };
  return <><Section title={edit ? 'Editar plantilla' : 'Crear plantilla'}><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!title.trim()) throw new Error('Escribe un título.'); const steps = parseSteps(); const previous = workspace.workflows?.find(w => w.id === edit); await api('workflow.save', { workspaceId: workspace.id, ...(edit ? { id: edit } : {}), title: title.trim(), description, steps, version: previous ? previous.version + 1 : 1 }); await refresh(); reset(); }, 'Plantilla guardada'); }}><Field label="Título"><input required value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="Descripción / entradas necesarias"><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field><Field label="Formato de pasos"><select value={format} onChange={e => setFormat(e.target.value)}><option value="text">Texto: una tarea por línea</option><option value="json">JSON: array de pasos</option></select></Field><Field label="Pasos" hint={'JSON admite {"type":"task","title":"…"} o {"type":"playground","runtime":"node|python|shell","code":"…"}. Se ejecutan únicamente con el botón del paso.'}><textarea rows={7} className="tw-code-input" value={stepsText} onChange={e => setStepsText(e.target.value)} required /></Field><div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy}>Guardar {edit ? 'nueva versión' : 'plantilla'}</Button><Button disabled={op.busy} onClick={() => op.run(async () => setPreview(parseSteps()))}>Previsualizar entradas</Button>{edit && <Button onClick={reset}>Cancelar edición</Button>}</div>{preview && <DataView value={preview} label="Previsualización sin ejecución" />}</form><OperationState op={op} /></Section>
    <Section title="Plantillas guardadas">{!workspace.workflows?.length && <p className="tw-empty">Guarda pasos repetibles. Seleccionar o editar una plantilla nunca ejecuta código.</p>}{workspace.workflows?.map(workflow => <article className="tw-item" key={workflow.id}><div className="tw-heading"><strong>{workflow.title}</strong><span className="tw-badge">v{workflow.version}</span></div><p>{workflow.description}</p><div className="tw-row"><Button onClick={() => { setEdit(workflow.id); setTitle(workflow.title); setDescription(workflow.description || ''); setStepsText(json(workflow.steps)); setFormat('json'); }}>Editar y versionar</Button><Button disabled={op.busy} onClick={() => op.run(async () => { await api('workflow.remove', { workspaceId: workspace.id, id: workflow.id }); await refresh(); })}>Eliminar plantilla</Button></div>{workflow.steps?.map((step, index) => { const value = typeof step === 'string' ? { type: 'task', title: step } : step; const executable = value.type === 'playground' && ['node', 'python', 'shell'].includes(value.runtime) && typeof value.code === 'string'; return <div className="tw-step" key={index}><strong>{index + 1}. {value.title || value.type || 'Paso sin título'}</strong><DataView value={value} label="Entradas del paso (sin ejecutar)" /><Button disabled={op.busy} icon={executable ? Play : Check} onClick={() => op.run(async () => { if (executable) { const run = await api('playground.run', { workspaceId: workspace.id, runtime: value.runtime, code: value.code }); onOpenPanel?.('playground', { runId: run.id }, workflow.title); } else { await api('task.create', { workspaceId: workspace.id, kind: 'draft', title: value.title || `${workflow.title}: paso ${index + 1}`, description: typeof value.description === 'string' ? value.description : json(value), refs: [{ kind: 'workflow', id: workflow.id, version: workflow.version, step: index }] }); await refresh(); } }, executable ? 'Ejecución solicitada' : 'Borrador local creado')}>{executable ? 'Ejecutar este paso en playground' : 'Crear borrador de este paso'}</Button></div>; })}</article>)}</Section>
    <Section title="Skills y referencias de workflow" action={<Refresh resource={skills} />}><ResourceState resource={skills} empty="No hay skills nativas publicadas para este workspace." />{itemsOf(skills.data).map(skill => <PhantomItem key={skill.id} item={skill} topic="skills" kind="skill" {...props} onChange={skills.reload} />)}{workspace.contextRefs?.filter(ref => /skill|workflow/.test(ref.kind)).map(ref => <DataView key={ref.id} value={ref} label={ref.title} />)}</Section></>;
}

function useToolEvents(workspaceId, onStatus) {
  const [events, setEvents] = useState({}), callback = useRef(onStatus);
  callback.current = onStatus;
  useEffect(() => {
    setEvents({});
    return window.phantom?.onEvent?.(event => {
      if (event.workspaceId !== workspaceId || !['tool.output', 'tool.status'].includes(event.type) || !event.id) return;
      setEvents(previous => {
        const old = previous[event.id] || {};
        const next = { ...previous, [event.id]: event.type === 'tool.output' ? { ...old, text: ((old.text || '') + String(event.data || '')).slice(-64000) } : { ...old, status: event.status, result: event.result, error: event.error } };
        const keys = Object.keys(next); if (keys.length > 40) delete next[keys[0]];
        return next;
      });
      if (event.type === 'tool.status') callback.current?.();
    });
  }, [workspaceId]);
  return events;
}

function Runs({ resource, events, api, workspace, family, op, onOpenPanel }) {
  const [selected, setSelected] = useState(null);
  const [tracePaths, setTracePaths] = useState({});
  const items = itemsOf(resource.data);
  return <Section title={family === 'automation' ? 'Ejecuciones reales de Playwright' : 'Historial de ejecuciones'} action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="No hay ejecuciones. El editor contiene entrada sin ejecutar." />{items.map(run => {
    const event = events[run.id] || {}, status = event.status || run.status;
    const tracePath = tracePaths[run.id] || event.result?.tracePath || run.tracePath;
    return <article className="tw-item" key={run.id}>
      <div className="tw-heading"><Identity value={run.id} /><span className="tw-badge">{status || 'Estado desconocido'}</span></div>
      <small>{family === 'automation' ? `${run.headed === false ? 'Live sin ventana' : run.headed === true ? 'Live: ventana independiente de Chromium' : 'Modo de ventana desconocido'} · ${textValue(run.url, 'URL desconocida')}` : textValue(run.runtime, 'Runtime desconocido')}</small>
      {family === 'automation' && <small>{run.keepOpen === true ? `Tras las acciones: ventana hasta Stop o ${Number.isFinite(run.keepOpenMs) ? run.keepOpenMs / 1000 : 300} s de límite automático.` : run.keepOpen === false ? 'Ventana cerrada al completar las acciones.' : 'Duración de ventana no declarada.'} {run.browserOpen ? 'Ventana live abierta.' : 'No se informa una ventana live abierta.'}</small>}
      <div className="tw-row"><Button onClick={() => setSelected(selected === run.id ? null : run.id)}>Ver salida y descriptor</Button>
        {(active(status) || run.browserOpen || run.viewer?.status === 'running') && <Button icon={Square} disabled={op.busy} onClick={() => op.run(async () => { await api(`${family}.stop`, { workspaceId: workspace.id, id: run.id }); resource.reload(); }, 'Detención solicitada')}>Detener ejecución</Button>}
        {family === 'automation' && <Button disabled={op.busy} onClick={() => op.run(async () => {
          const trace = await api('automation.trace', { workspaceId: workspace.id, id: run.id, openViewer: true });
          if (typeof trace.path === 'string' && trace.path) setTracePaths(previous => ({ ...previous, [run.id]: trace.path }));
          if (typeof trace.url !== 'string' || !trace.url) throw new Error('El host no devolvió la URL del visor grabado. Reintenta al terminar la ejecución; la ruta del artefacto puede consultarse por separado.');
          const url = new URL(trace.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('El visor devolvió una URL no admitida. Revisa el host y vuelve a abrir el trace.');
          if (!onOpenPanel) throw new Error('No está disponible la apertura de paneles de navegador. Abre Playwright desde el workspace.');
          await onOpenPanel('browser', { url: url.href }, `Trace · ${textValue(run.title, run.id)}`);
          resource.reload();
        })}>Ver trace grabado en canvas</Button>}
        {family === 'automation' && <Button disabled={op.busy} onClick={() => op.run(async () => {
          const trace = await api('automation.trace', { workspaceId: workspace.id, id: run.id, openViewer: false });
          if (typeof trace.path !== 'string' || !trace.path) throw new Error('No se recibió una ruta de trace.zip. Espera al final de las acciones o detén la ejecución.');
          setTracePaths(previous => ({ ...previous, [run.id]: trace.path }));
        })}>Consultar ruta de trace.zip</Button>}
      </div>
      {family === 'automation' && <p className="tw-muted">Trace = reproducción grabada, no control de la ventana live. Su visor local es temporal (hasta 5 minutos).</p>}
      {typeof tracePath === 'string' && tracePath && <div><small>Artefacto trace.zip</small><Identity value={tracePath} /><Button disabled={op.busy} onClick={() => op.run(() => api('desktop.openPath', { path: tracePath }))}>Abrir archivo trace.zip en el sistema</Button></div>}
      {(event.error || run.error) && <ErrorNotice error={event.error || run.error} />}{selected === run.id && <><pre className="tw-code" aria-live="polite">{event.text || run.output || run.text || 'Sin salida capturada. Se conservarán hasta 64 000 caracteres de eventos nuevos.'}</pre><DataView value={{ ...run, ...(event.result !== undefined ? { result: event.result } : {}) }} label="Descriptor / artefactos reales" /></>}
    </article>;
  })}</Section>;
}

function Playground({ workspace, api, notify, node }) {
  const resource = useResource(api, 'playground.list', { workspaceId: workspace.id });
  const events = useToolEvents(workspace.id, resource.reload), op = useOperation(notify);
  const [runtime, setRuntime] = useState(node?.data?.runtime || 'node');
  const [code, setCode] = useState(node?.data?.code || 'console.log("Hola, workspace");');
  const [result, setResult] = useState(null);
  return <><Section title="Editor de ejecución explícita"><p className="tw-muted">Entrada sin guardar ni ejecutar. Cada ejecución crea un proceso propio, con tiempo y salida acotados.</p><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!code.trim()) throw new Error('Escribe código antes de ejecutar.'); const value = await api('playground.run', { workspaceId: workspace.id, runtime, code }); setResult(value); resource.reload(); }, 'Ejecución solicitada'); }}><Field label="Runtime"><select value={runtime} onChange={e => setRuntime(e.target.value)}><option value="node">Node</option><option value="python">Python</option><option value="shell">Shell</option></select></Field><Field label="Código / comandos"><textarea rows={12} spellCheck={false} className="tw-code-input" value={code} onChange={e => setCode(e.target.value)} required /></Field><Button type="submit" tone="primary" icon={Play} disabled={op.busy}>Ejecutar entrada</Button></form>{result && <DataView value={result} label="Descriptor de inicio real" />}<OperationState op={op} /></Section><Runs resource={resource} events={events} api={api} workspace={workspace} family="playground" op={op} /></>;
}

function Playwright({ workspace, api, notify, node, onOpenPanel }) {
  const resource = useResource(api, 'automation.list', { workspaceId: workspace.id });
  const events = useToolEvents(workspace.id, resource.reload), op = useOperation(notify);
  const [url, setUrl] = useState(node?.data?.url || ''), [headed, setHeaded] = useState(true), [actions, setActions] = useState([]), [preview, setPreview] = useState(false), [result, setResult] = useState(null);
  const [keepOpen, setKeepOpen] = useState(false), [keepOpenSeconds, setKeepOpenSeconds] = useState(300);
  const update = (index, patch) => setActions(previous => previous.map((action, i) => i === index ? { ...action, ...patch } : action));
  const lifetime = { keepOpen, ...(keepOpen ? { keepOpenMs: keepOpenSeconds * 1000 } : {}) };
  return <><Section title="Preparar navegación">
    <p className="tw-muted">Modo manual: editar y previsualizar no abre procesos. Live usa una ventana independiente de Chromium, fuera del canvas. El trace grabado se consulta después en un navegador del canvas.</p>
    <form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => {
      const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('La URL inicial debe ser http o https.');
      const value = await api('automation.start', { workspaceId: workspace.id, url: parsed.href, headed, actions, ...lifetime }); setResult(value); resource.reload();
    }, 'Inicio de Playwright solicitado'); }}>
      <Field label="URL inicial"><input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></Field>
      <label className="tw-check"><input type="checkbox" checked={headed} onChange={e => setHeaded(e.target.checked)} />Ventana visible (headed)</label>
      <label className="tw-check"><input type="checkbox" checked={keepOpen} onChange={e => setKeepOpen(e.target.checked)} />Mantener ventana al terminar</label>
      {keepOpen && <Field label="Límite de ventana después de las acciones (segundos)" hint="De 1 a 600 segundos. Stop cierra antes la ventana propia."><input type="number" min="1" max="600" step="1" required value={keepOpenSeconds} onChange={e => setKeepOpenSeconds(Number(e.target.value))} /></Field>}
      <p className="tw-muted">{keepOpen ? `Tras las acciones, el navegador seguirá abierto hasta Stop o durante ${keepOpenSeconds} segundos como máximo.` : 'El navegador se cierra al terminar las acciones. Activa «Mantener ventana al terminar» para observarlo después.'} Las acciones tienen un límite de 60 segundos por ejecución.</p>
      {actions.map((action, index) => <fieldset className="tw-action-editor" key={index}><legend>Acción {index + 1}</legend>
        <Field label="Tipo"><select value={action.type} onChange={e => { const type = e.target.value; setActions(old => old.map((a, i) => i === index ? { type, ...(type === 'fill' ? { value: '' } : type === 'wait' ? { milliseconds: 500 } : {}) } : a)); }}>{['goto', 'click', 'fill', 'screenshot', 'wait'].map(type => <option key={type}>{type}</option>)}</select></Field>
        {action.type === 'goto' && <Field label="URL de destino"><input type="url" value={action.url || ''} required onChange={e => update(index, { url: e.target.value })} /></Field>}
        {['click', 'fill'].includes(action.type) && <Field label="Selector Playwright"><input required value={action.selector || ''} onChange={e => update(index, { selector: e.target.value })} /></Field>}
        {action.type === 'fill' && <Field label="Texto a escribir"><input value={action.value || ''} onChange={e => update(index, { value: e.target.value })} /></Field>}
        {action.type === 'wait' && <Field label="Milisegundos"><input type="number" min="0" max="10000" value={action.milliseconds ?? 500} onChange={e => update(index, { milliseconds: Number(e.target.value) })} /></Field>}
        {action.type === 'screenshot' && <p className="tw-muted">La captura se guarda en el directorio de artefactos de esta ejecución.</p>}
        <Button icon={Trash2} onClick={() => setActions(actions.filter((_, i) => i !== index))}>Quitar acción</Button>
      </fieldset>)}
      <div className="tw-row"><Button disabled={actions.length >= 50} onClick={() => setActions([...actions, { type: 'screenshot' }])}>Añadir acción</Button><Button onClick={() => setPreview(!preview)}>Previsualizar sin ejecutar</Button><Button type="submit" tone="primary" icon={Play} disabled={op.busy}>Iniciar navegador y acciones</Button></div>
      {preview && <DataView value={{ url, headed, actions, ...lifetime }} label="Previsualización; no ejecutada" />}
    </form>
    <p className="tw-muted">Si faltan Playwright o Chromium, configura el runtime del host. El error indicará el componente ausente; no se simula una ejecución correcta.</p>
    {result && <DataView value={result} label="Inicio / directorio de artefactos" />}<OperationState op={op} />
  </Section><Runs resource={resource} events={events} api={api} workspace={workspace} family="automation" op={op} onOpenPanel={onOpenPanel} /></>;
}

function Settings({ workspace, state, api, refresh, notify }) {
  const info = useResource(api, 'system.info', {}), desktop = useResource(api, 'desktop.info', {});
  const settings = state?.settings || {};
  const [form, setForm] = useState(() => ({ phantomPath: settings.phantomPath || '', phantomData: settings.phantomData || '', model: settings.model || '', shell: settings.shell || '', voiceProvider: settings.voiceProvider || 'auto', voiceModel: settings.voiceModel || '', voiceBaseURL: settings.voiceBaseURL || '', localWhisperOutput: settings.localWhisperOutput || 'files', localWhisperCommand: typeof settings.localWhisperCommand === 'string' ? settings.localWhisperCommand : settings.localWhisperCommand ? json(settings.localWhisperCommand) : '' }));
  const [confirmStop, setConfirmStop] = useState(null), [importData, setImportData] = useState(null), [history, setHistory] = useState(false);
  const [dirty, setDirty] = useState([]);
  const op = useOperation(notify);
  const change = key => e => { setForm({ ...form, [key]: e.target.value }); setDirty(previous => previous.includes(key) ? previous : [...previous, key]); };
  const stop = async method => {
    // A host shutdown affects every workspace, including when no folder is selected.
    const workspaces = state?.workspaces || (workspace ? [workspace] : []);
    const resources = await Promise.all(workspaces.flatMap(w => ['terminal.list', 'playground.list', 'automation.list'].map(method => api(method, { workspaceId: w.id }))));
    const count = resources.flatMap(itemsOf).filter(item => active(item.status) || item.browserOpen || item.viewer?.status === 'running').length + workspaces.flatMap(w => w.phantomControllers || []).filter(item => active(item.status)).length;
    if (count) setConfirmStop({ method, count });
    else await api(method, method === 'desktop.quit' ? { stopHost: true } : {});
  };
  return <><Section title="Host y almacenamiento" action={<Refresh resource={info} />}><ErrorNotice error={info.error} retry={info.reload} />{info.loading ? <p role="status">Consultando host…</p> : info.data && <DataView value={info.data} label="Runtime, rutas y opciones de datos del host" />}<ErrorNotice error={desktop.error} retry={desktop.reload} />{desktop.data && <DataView value={desktop.data} label="Aplicación de escritorio" />}<p className="tw-muted">La ruta de datos del host se selecciona al arrancar con --data o PHANTOM_WORKSPACE_HOME. Consulta aquí la ruta efectiva; cambiar el directorio requiere reiniciar el host con esa opción.</p></Section>
    <Section title="Preferencias del host"><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => {
      // Preserve host-discovered configuration and fields changed by another client.
      // Empty inputs mean "no override", not an instruction to overwrite defaults.
      const patch = Object.fromEntries(dirty.filter(key => form[key].trim()).map(key => [key, form[key].trim()]));
      if (!Object.keys(patch).length) throw new Error('Los campos vacíos conservan la configuración automática o existente del host. Introduce un valor para cambiar una preferencia.');
      if (patch.localWhisperCommand) { const argv = JSON.parse(patch.localWhisperCommand); if (!Array.isArray(argv) || !argv.length || argv.some(arg => typeof arg !== 'string' || !arg) || !argv.slice(1).some(arg => arg.includes('{input}'))) throw new Error('El comando local debe ser un array JSON de argumentos sin shell, con {input} y opcionalmente {outputDir}.'); }
      if (patch.voiceProvider && !['auto', 'local', 'openai'].includes(patch.voiceProvider)) throw new Error('Selecciona Automático, Motor local o API OpenAI compatible.');
      await api('settings.update', { patch }); await refresh(); setDirty([]);
    }, 'Preferencias guardadas'); }}>
      <p className="tw-muted">Solo se guardan campos editados y no vacíos. Un comando o una ruta en blanco conservan la configuración del host. Automático descubre el runtime local instalado en voice-runtime/config.json dentro del directorio de datos; no requiere rellenar el comando ni seleccionar una API.</p>
      {[['phantomPath', 'Ruta del ejecutable Phantom (vacío: conservar configuración del host)'], ['phantomData', 'Datos nativos de Phantom (ruta opcional)'], ['model', 'Modelo Phantom opcional'], ['shell', 'Shell opcional']].map(([key, label]) => <Field key={key} label={label}><input value={form[key]} onChange={change(key)} /></Field>)}
      <Field label="Proveedor de voz" hint="Automático prioriza el runtime local descubierto. La API solo se usa según la configuración y credenciales del host; guardar otro campo no cambia el proveedor."><select value={form.voiceProvider} onChange={change('voiceProvider')}><option value="auto">Automático</option><option value="local">Motor local</option><option value="openai">API OpenAI compatible</option>{!['auto', 'local', 'openai'].includes(form.voiceProvider) && <option value={form.voiceProvider}>Proveedor actual no reconocido: {textValue(form.voiceProvider)}</option>}</select></Field>
      <Field label="Modelo de transcripción opcional"><input value={form.voiceModel} onChange={change('voiceModel')} /></Field><Field label="URL base de API de voz opcional"><input type="url" value={form.voiceBaseURL} onChange={change('voiceBaseURL')} /></Field>
      <Field label="Comando local de transcripción (argv JSON)" hint="Array JSON de argumentos sin shell. Usa {input} para el audio y {outputDir} para la salida. En blanco no sobreescribe el comando ni la detección automática."><textarea rows={3} value={form.localWhisperCommand} onChange={change('localWhisperCommand')} spellCheck={false} /></Field>
      <Field label="Salida del motor local"><select value={form.localWhisperOutput} onChange={change('localWhisperOutput')}><option value="files">Archivos .txt en outputDir</option><option value="stdout">Texto por stdout</option></select></Field><Button type="submit" tone="primary" disabled={op.busy || !dirty.length}>Guardar preferencias</Button></form></Section>
    <Section title="Portabilidad"><label className="tw-check"><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} />Incluir historial al exportar</label><Button disabled={op.busy} onClick={() => op.run(async () => { const data = await api('storage.export', { includeHistory: history }); await api('desktop.export', { data }); }, 'Solicitud de exportación completada')}>Exportar estado a un archivo</Button><Field label="Seleccionar JSON para importar" hint="Se lee en el navegador, se valida en el host y no ejecuta procesos."><input type="file" accept="application/json,.json" onChange={e => { const file = e.target.files?.[0]; setImportData(null); if (file) op.run(async () => { if (file.size > 20 * 1024 * 1024) throw new Error('El archivo supera 20 MB. Usa una exportación de menor tamaño.'); setImportData(JSON.parse(await file.text())); }); }} /></Field>{importData && <><p>JSON leído; pendiente de importar. El host validará su versión y contenido.</p><Button disabled={op.busy} onClick={() => op.run(async () => { await api('storage.import', { data: importData }); await refresh(); setImportData(null); }, 'Estado importado')}>Importar este estado</Button><Button onClick={() => setImportData(null)}>Descartar archivo</Button></>}</Section>
    <Section title="Cierre y procesos"><p className="tw-muted">Cerrar la interfaz permite reconectar al host. Detener el host termina sus procesos propios.</p><div className="tw-row"><Button disabled={op.busy} onClick={() => op.run(() => api('desktop.quit', { stopHost: false }))}>Cerrar solo interfaz</Button><Button tone="danger" disabled={op.busy} onClick={() => op.run(() => stop('host.shutdown'))}>Detener host y sus procesos</Button><Button tone="danger" disabled={op.busy} onClick={() => op.run(() => stop('desktop.quit'))}>Cerrar y detener host</Button></div>{confirmStop && <div className="tw-warning" role="alert"><p>Se detendrán {confirmStop.count} sesiones o ejecuciones activas de este host.</p><div className="tw-row"><Button tone="danger" disabled={op.busy} onClick={() => op.run(async () => { await api(confirmStop.method, confirmStop.method === 'desktop.quit' ? { stopHost: true } : {}); setConfirmStop(null); })}>Confirmar detención de sesiones</Button><Button onClick={() => setConfirmStop(null)}>Conservar sesiones</Button></div></div>}</Section><OperationState op={op} /></>;
}

export function ToolContent({ type, ...props }) {
  if (!props.workspace && type !== 'settings') return <div className="tw-empty">Abre una carpeta para usar las herramientas del workspace.</div>;
  const components = { plugins: Plugins, 'phantom-cards': PhantomCards, 'phantom-skills': PhantomSkills, tasks: Tasks, context: Context, mission: Missions, sessions: Missions, git: Git, services: Services, docker: Docker, workflows: Workflows, playwright: Playwright, playground: Playground, settings: Settings };
  const owner = panelPlugin(type);
  const Content = owner && !pluginEnabled(props.workspace, owner.id) ? DisabledPlugin : components[type];
  const identity = `${props.workspace?.id || 'host'}:${type}:${props.node?.id || 'inspector'}`;
  return <div className="tw-content"><ToolErrorBoundary key={identity} title={TOOL_TITLES[type] || 'esta herramienta'}>{Content ? <><Content {...props} />{type === 'context' && <p className="tw-muted">Las revisiones y hashes solo se muestran cuando la fuente los proporciona. Si no aparecen, son desconocidos; la referencia fijada no acredita una revisión verificada.</p>}</> : <p className="tw-empty">Esta herramienta no tiene contenido registrado: {type}. Elige una herramienta desde el inspector.</p>}</ToolErrorBoundary></div>;
}

export function ToolPanel({ node, workspace, api, refresh, onOpenPanel, notify }) {
  return <div className="tw-tool-panel"><ToolContent type={node.type} node={node} workspace={workspace} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} /></div>;
}
