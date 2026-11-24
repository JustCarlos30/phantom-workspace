import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, FileText, RefreshCw, Trash2, X } from 'lucide-react';
import '../tools.css';
import { CardAgents } from './AgentIdentity';
import { PluginPanels, PLUGIN_TITLES } from './PluginPanels';
import CommandCenter from './CommandCenter.jsx';
import SkillsCatalog from './SkillsCatalog.jsx';
import Incorporaciones from './Incorporaciones.jsx';
import Branches from './Branches.jsx';
import Repository from './Repository.jsx';
import VideoReview from './VideoReview.jsx';
import EmptyState from './EmptyState.jsx';
import { Button, Field, useOperation, useResource, ErrorNotice as SharedErrorNotice, DataView as SharedDataView, ResourceState as SharedResourceState } from './PluginPrimitives.jsx';
import Markdown from './Markdown.jsx';
import MemoryCard, { MemoryForm } from './MemoryCard.jsx';
import { pinnedRef, readerKind, emptyMessage } from '../hooks/context-view.mjs';
import Settings from './Settings.jsx';
import GlobalSites from './GlobalSites.jsx';
import { HUBS, hubTab } from '../hooks/hubs.mjs';
import Environment from './Environment.jsx';
import { Docker, Workflows, Playground, Playwright } from './tools/ToolAutomation.jsx';
import '../hubs.css';

export const TOOL_TITLES = { tasks: 'Trabajo', context: 'Contexto', sessions: 'Sesiones', mission: 'Misiones', git: 'Git', services: 'Entorno', docker: 'Docker', workflows: 'Automatizar', playwright: 'Navegador automático', playground: 'Código', settings: 'Configuración' };
Object.assign(TOOL_TITLES, PLUGIN_TITLES, { review: 'Revisión de video', 'command-center': 'Centro de mando', incorporaciones: 'Cola de integración', branches: 'Ramas', repo: 'Git', 'skills-catalog': 'Skills' });
export const json = value => JSON.stringify(value, null, 2);
export const textValue = (value, fallback = 'Sin datos') => typeof value === 'string' && value.trim() ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
const message = error => textValue(error?.message, typeof error === 'string' ? error : 'Algo falló. Vuelve a intentarlo.');
export const itemsOf = data => {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (!Array.isArray(data.items)) throw new Error('No se pudo leer la lista. Vuelve a intentarlo.');
  return data.items;
};
const STATUS = { running: 'En marcha', starting: 'Arrancando', queued: 'En espera', stopping: 'Deteniendo', stopped: 'Detenido', exited: 'Detenido', completed: 'Terminada', failed: 'Falló', healthy: 'En marcha', pinned: 'Fijado', unknown: 'Sin datos', todo: 'Por hacer', doing: 'En curso', done: 'Completada', ready: 'Lista', blocked: 'Bloqueada' };
export const statusLabel = value => STATUS[value] || textValue(value);
export const hostOf = url => { try { return new URL(url).host || url; } catch { return textValue(url, 'Navegación'); } };

export class ToolErrorBoundary extends React.Component {
  state = { error: null, attempt: 0 };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <section className="tw-section" role="alert">
      <h3>No se pudo mostrar {this.props.title || 'esta herramienta'}</h3>
      <DataView value={message(this.state.error)} />
      <div className="tw-row"><Button icon={RefreshCw} onClick={() => this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 }))}>Reintentar</Button>{this.props.onClose && <Button onClick={this.props.onClose}>Cerrar</Button>}</div>
    </section>;
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}

// Single contract lives in PluginPrimitives; these bindings only keep this surface's wording.
export { Button, Field, useOperation, useResource };
export function ErrorNotice(props) { return <SharedErrorNotice clearLabel="Cerrar" detailsLabel="Detalles" {...props} />; }
export function DataView({ label = 'Detalles', ...props }) { return <SharedDataView label={label} {...props} />; }
export function ResourceState({ empty = 'Aún no hay nada aquí.', ...props }) { return <SharedResourceState strict loadingLabel="Cargando…" empty={empty} {...props} />; }
function Identity({ value }) {
  const [copied, setCopied] = useState(false), op = useOperation();
  if (value == null) return <span className="tw-muted">Sin datos</span>;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return <span className="tw-identity"><span className="tw-truncate" title={text}>{text}</span><Button icon={copied ? Check : Copy} aria-label="Copiar" onClick={() => op.run(async () => { await navigator.clipboard.writeText(text); setCopied(true); })} /><ErrorNotice error={op.error} clear={op.clear} /></span>;
}
export function Section({ title, children, action }) {
  return <section className="tw-section"><div className="tw-heading"><h3>{title}</h3>{action}</div>{children}</section>;
}
export function OperationState({ op, onOpenPanel }) { return <><ErrorNotice error={op.error} clear={op.clear} onOpenPanel={onOpenPanel} />{op.busy && <p className="tw-muted" role="status">Procesando…</p>}</>; }
export function Refresh({ resource }) { return <Button icon={RefreshCw} disabled={resource.loading} onClick={resource.reload}>Actualizar</Button>; }

// These forms also power voice drafts: canonical objects never pass through local task updates.
export function NativeForm({ kind = 'card', workspace, api, refresh, notify, initialText = '', existing, onSaved, onOpenPanel }) {
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
  const noun = kind === 'card' ? 'tarea' : kind === 'decision' ? 'decisión' : 'skill';
  return <form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => {
    const parsed = JSON.parse(input);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('El contenido debe ser un objeto JSON.');
    if (kind === 'card' && (!parsed.goal?.trim() || !Array.isArray(parsed.scope) || !Array.isArray(parsed.checks))) throw new Error('La tarea necesita goal, scope y checks.');
    if (existing && kind === 'card' && !replace) throw new Error('Marca la casilla para crear la tarea de reemplazo.');
    if (kind === 'card' && parsed.lane !== 'coordinated') throw new Error('La tarea necesita lane: coordinated.');
    if (existing && kind !== 'card' && !revision.trim()) throw new Error('Indica la revisión antes de guardar.');
    if (existing && (typeof existing.id !== 'string' || !existing.id)) throw new Error('No se pudo identificar la entrada. Vuelve a abrirla.');
    const value = await api(existing ? 'phantom.update' : 'phantom.create', { workspaceId: workspace.id, kind, input: parsed, ...(existing ? { id: existing.id, ...(kind === 'card' ? { replace: true } : { revision: /^\d+$/.test(revision) ? Number(revision) : revision }) } : {}) });
    setResult(value); await refresh?.(); onSaved?.(value);
  }, existing && kind !== 'card' ? 'Guardado en Phantom' : 'Creado en Phantom'); }}>
    <Field label={`${noun[0].toUpperCase()}${noun.slice(1)} (JSON)`}><textarea className="tw-code-input" rows={12} value={input} onChange={e => setInput(e.target.value)} required spellCheck={false} /></Field>
    {existing && kind !== 'card' && <Field label="Revisión"><input value={revision} onChange={e => setRevision(e.target.value)} required /></Field>}
    {existing && kind === 'card' && <label className="tw-check"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Crear una tarea nueva y conservar la original</label>}
    <OperationState op={op} onOpenPanel={onOpenPanel} /><Button type="submit" tone="primary" disabled={op.busy}>{existing ? kind === 'card' ? 'Crear reemplazo' : 'Guardar' : `Crear ${noun}`}</Button>
    {result && <DataView value={result} />}
  </form>;
}

export function Todos({ workspace, api, refresh, notify }) {
  const [title, setTitle] = useState(''), [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null), [editedTitle, setEditedTitle] = useState('');
  const op = useOperation(notify);
  const tasks = (workspace.tasks || []).filter(task => task.kind !== 'phantom');
  const pending = tasks.filter(task => task.status !== 'done').length;
  const visible = tasks.filter(task => filter === 'all' || (filter === 'done' ? task.status === 'done' : task.status !== 'done'));
  return <Section title="Pendientes">
    <form className="tw-form" onSubmit={event => { event.preventDefault(); op.run(async () => {
      if (!title.trim()) throw new Error('Escribe un título.');
      await api('task.create', { workspaceId: workspace.id, title: title.trim(), kind: 'draft', status: 'todo', description: '', refs: [] });
      await refresh(); setTitle('');
    }); }}>
      <Field label="Añadir pendiente"><input value={title} readOnly={op.busy} onChange={event => setTitle(event.target.value)} required /></Field>
      <Button type="submit" disabled={op.busy}>Añadir</Button>
    </form>
    <OperationState op={op} />
    <p role="status">{pending} pendientes · {tasks.length - pending} completados · {tasks.length} en total</p>
    <div className="tw-row" role="group" aria-label="Filtrar pendientes">{[['all', 'Todos'], ['todo', 'Pendientes'], ['done', 'Completados']].map(([value, label]) => <Button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}</div>
    {!visible.length && <EmptyState className="tw-empty" description="No hay pendientes que mostrar con este filtro." />}
    {visible.map(task => <article className="tw-item" key={task.id} aria-label={task.title}>
      <label className="tw-check"><input type="checkbox" checked={task.status === 'done'} disabled={op.busy} onChange={event => {
        const status = event.target.checked ? 'done' : 'todo';
        op.run(async () => { await api('task.update', { workspaceId: workspace.id, id: task.id, patch: { status } }); await refresh(); });
      }} />{task.title}</label>
      {task.description && <p className="tw-prose">{task.description}</p>}
      {editing === task.id ? <form className="tw-form" onSubmit={event => { event.preventDefault(); op.run(async () => {
        if (!editedTitle.trim()) throw new Error('Escribe un título.');
        await api('task.update', { workspaceId: workspace.id, id: task.id, patch: { title: editedTitle.trim() } });
        await refresh(); setEditing(null);
      }); }}>
        <Field label="Título del pendiente"><input required disabled={op.busy} value={editedTitle} onChange={event => setEditedTitle(event.target.value)} /></Field>
        <div className="tw-row"><Button type="submit" disabled={op.busy}>Guardar</Button><Button disabled={op.busy} onClick={() => setEditing(null)}>Cancelar</Button></div>
      </form> : <div className="tw-row"><Button disabled={op.busy} onClick={() => { setEditing(task.id); setEditedTitle(task.title); }}>Editar</Button><Button icon={Trash2} disabled={op.busy} onClick={() => op.run(async () => { await api('task.remove', { workspaceId: workspace.id, id: task.id }); await refresh(); })}>Eliminar</Button></div>}
    </article>)}
  </Section>;
}

function Tasks(props) {
  const { workspace, api, refresh, notify, onOpenPanel } = props;
  const [mode, setMode] = useState('draft'), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [edit, setEdit] = useState(null);
  const source = useResource(api, 'phantom.list', { workspaceId: workspace.id, topic: 'tasks' });
  const op = useOperation(notify);
  const [cardId, setCardId] = useState(props.node?.data?.cardId || '');
  useEffect(() => { setCardId(props.node?.data?.cardId || ''); }, [props.node?.data?.cardId]);
  if (cardId) return <Section title="Tarea vinculada" action={<Refresh resource={source} />}><Button onClick={() => setCardId('')}>Ver todas</Button><ResourceState resource={source} empty="" onOpenPanel={onOpenPanel} />{itemsOf(source.data).filter(item => item.id === cardId).map(item => <PhantomItem key={item.id} item={item} topic="tasks" kind="card" {...props} onChange={source.reload} />)}{!source.loading && source.data?.available && !itemsOf(source.data).some(item => item.id === cardId) && <p className="tw-warning">La tarea vinculada ya no está en este proyecto.</p>}</Section>;
  return <><Todos key={workspace.id} {...props} /><Section title={edit ? 'Editar borrador' : 'Nuevo borrador'}><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!title.trim()) throw new Error('Escribe un título.'); await api(edit ? 'task.update' : 'task.create', { workspaceId: workspace.id, ...(edit ? { id: edit, patch: { title: title.trim(), description, kind: mode } } : { title: title.trim(), description, kind: mode, status: 'todo', refs: [] }) }); await refresh(); setTitle(''); setDescription(''); setEdit(null); }, 'Guardado'); }}>
      <Field label="Tipo"><select value={mode} onChange={e => setMode(e.target.value)}><option value="draft">Borrador</option><option value="checklist">Lista de pasos</option></select></Field>
      <Field label="Título"><input value={title} onChange={e => setTitle(e.target.value)} required /></Field><Field label={mode === 'checklist' ? 'Pasos' : 'Descripción'}><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} /></Field><div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy}>{edit ? 'Guardar' : 'Crear'}</Button>{edit && <Button onClick={() => { setEdit(null); setTitle(''); setDescription(''); }}>Cancelar</Button>}</div>
    </form><OperationState op={op} /></Section>
    <Section title="Borradores">{!workspace.tasks?.length && <EmptyState className="tw-empty" description="Aún no hay borradores." />}{workspace.tasks?.map(task => <article className="tw-item" key={task.id}><div className="tw-heading"><strong>{task.title}</strong><span className="tw-badge">{task.kind === 'phantom' ? 'Tarea de Phantom' : task.kind === 'checklist' ? 'Lista de pasos' : 'Borrador'}</span></div>{task.description && <p className="tw-prose">{task.description}</p>}{task.kind !== 'phantom' && <div className="tw-row"><Field label="Estado"><select value={task.status} disabled={op.busy} onChange={e => op.run(async () => { await api('task.update', { workspaceId: workspace.id, id: task.id, patch: { status: e.target.value } }); await refresh(); })}><option value="todo">Por hacer</option><option value="doing">En curso</option><option value="done">Completada</option></select></Field><Button onClick={() => { setEdit(task.id); setTitle(task.title); setDescription(task.description || ''); setMode(task.kind === 'checklist' ? 'checklist' : 'draft'); }}>Editar</Button><Button icon={Trash2} disabled={op.busy} onClick={() => op.run(async () => { await api('task.remove', { workspaceId: workspace.id, id: task.id }); await refresh(); })}>Eliminar</Button></div>}{task.refs?.length > 0 && <DataView value={{ id: task.phantomId || task.id, refs: task.refs }} />}</article>)}</Section>
    <Section title="Tareas de Phantom" action={<Refresh resource={source} />}><ResourceState resource={source} empty="No hay tareas de Phantom en este proyecto." onOpenPanel={onOpenPanel} />{itemsOf(source.data).map(item => <PhantomItem key={item.id} item={item} topic="tasks" kind="card" {...props} onChange={source.reload} />)}</Section></>;
}

function PhantomItem({ item, topic, kind, workspace, api, refresh, notify, onChange, onOpenPanel }) {
  const [detail, setDetail] = useState(null), [editing, setEditing] = useState(false);
  const events = useToolEvents(workspace.id, onChange);
  const persistedController = workspace.phantomControllers?.findLast(run => run.taskId === item.id);
  const controller = events[persistedController?.id] || persistedController;
  const editable = topic !== 'memories' || item.kind === 'decision';
  const op = useOperation(notify);
  const read = () => op.run(async () => { const ref = item.raw?.ref || item.ref; setDetail(await api('phantom.detail', { workspaceId: workspace.id, topic, id: item.id, ...(ref != null ? { ref } : {}) })); });
  return <article className="tw-item"><div className="tw-heading"><strong>{item.title || 'Sin título'}</strong>{item.status && <span className="tw-badge">{statusLabel(item.status)}</span>}</div>
    <div className="tw-row"><Button icon={FileText} disabled={op.busy} onClick={read}>Ver detalles</Button><Button disabled={op.busy} onClick={() => op.run(async () => {
      const source = item.source != null ? { source: item.source } : {};
      if (topic === 'tasks') await api('task.create', { workspaceId: workspace.id, title: item.title || item.id, kind: 'phantom', phantomId: item.id, refs: [{ ...source, id: item.id, kind: 'card' }] });
      else await api('context.pin', { workspaceId: workspace.id, kind, title: item.title || item.id, ...source, ref: item.raw?.ref || item.ref || { id: item.id, ...(item.revision != null ? { revision: item.revision } : {}) } });
      await refresh();
    }, 'Fijado')}>Fijar</Button></div>
    {kind === 'card' && <CardAgents cardId={item.id} workspace={workspace} onOpenPanel={onOpenPanel} />}
    {detail && <><DataView value={detail} open />{editable && <Button onClick={() => setEditing(!editing)}>{editing ? 'Cerrar edición' : kind === 'card' ? 'Crear reemplazo' : 'Editar'}</Button>}{editing && <NativeForm kind={kind} workspace={workspace} api={api} refresh={refresh} notify={notify} onOpenPanel={onOpenPanel} existing={{ ...item, raw: detail }} onSaved={() => { setEditing(false); setDetail(null); onChange?.(); }} />}</>}
    {controller && <><p className="tw-muted">Ejecución: {statusLabel(controller.status)}</p><pre className="tw-code" aria-live="polite">{controller.text || controller.output || 'Sin salida.'}</pre>{controller.outputFile && !controller.text && <p className="tw-muted">Esto es el final de la salida; el registro completo está en {controller.outputFile} dentro del directorio de datos.</p>}<ErrorNotice error={controller.error} /></>}<OperationState op={op} onOpenPanel={onOpenPanel} />
  </article>;
}

function DocumentItem({ item, workspace, api, refresh, op, reader, readerId }) {
  const path = typeof item.path === 'string' && item.path ? item.path : null;
  const hash = item.hash ?? item.sha256;
  const title = textValue(item.title, path || 'Documento');
  const pinned = pinnedRef(workspace.contextRefs, path);
  return <article className="tw-item"><div className="tw-heading"><strong>{title}</strong>{pinned && <span className="tw-badge">Fijado</span>}</div>{path && path !== title && <small>{path}</small>}
    <div className="tw-row">{reader.button(readerId, path)}
      <Button disabled={op.busy || !path} onClick={() => op.run(async () => {
        if (pinned) await api('context.unpin', { workspaceId: workspace.id, id: pinned.id });
        else {
          const ref = { path, ...(typeof hash === 'string' && hash ? { hash } : {}), ...(item.revision != null ? { revision: item.revision } : {}) };
          await api('context.pin', { workspaceId: workspace.id, path, title, kind: textValue(item.kind, 'document'), ...(item.source != null ? { source: item.source } : {}), ref });
        }
        await refresh();
      }, pinned ? 'Documento quitado' : 'Documento fijado')}>{pinned ? 'Quitar' : 'Fijar'}</Button></div>
    {reader.content(readerId, path)}
  </article>;
}

function Context(props) {
  const { workspace, api, refresh, notify, onOpenPanel } = props;
  const [tab, setTab] = useState('docs'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [detail, setDetail] = useState(null), [creating, setCreating] = useState(false);
  const debounce = useRef(null);
  useEffect(() => {
    debounce.current = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(debounce.current);
  }, [query]);
  const resource = useResource(api, tab === 'docs' ? 'context.scan' : 'phantom.list', { workspaceId: workspace.id, query: search, ...(tab === 'docs' ? {} : { topic: 'memories' }) });
  const op = useOperation(notify);
  const reader = {
    button: (id, path) => <Button disabled={op.busy || !path} aria-expanded={detail?.id === id} onClick={() => {
      if (detail?.id === id) setDetail(null);
      else op.run(async () => { const value = await api('context.read', { workspaceId: workspace.id, path }); setDetail({ id, value }); });
    }}>Leer</Button>,
    content: (id, path) => detail?.id === id && <div className="tw-document-reader">{detail.value.truncated && <p className="tw-muted">Se muestra solo el principio.</p>}{readerKind(path) === 'markdown' ? <Markdown source={detail.value.text} /> : <pre className="tw-code">{detail.value.text}</pre>}<Button onClick={() => setDetail(null)}>Cerrar</Button></div>,
  };
  const searchLabel = tab === 'docs' ? 'Buscar en documentos' : 'Buscar en decisiones';
  return <><div className="tw-tabs" aria-label="Tipo de contexto">{[['docs', 'Documentos'], ['decisions', 'Decisiones']].map(([id, title]) => <Button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setDetail(null); }}>{title}</Button>)}</div>
    <form className="tw-search" onSubmit={e => { e.preventDefault(); clearTimeout(debounce.current); setSearch(query); if (query === search) resource.reload(); }}><Field label={searchLabel}><input type="search" value={query} onChange={e => setQuery(e.target.value)} /></Field></form>
    {workspace.contextRefs?.length > 0 && <Section title="Fijados">{workspace.contextRefs.filter(Boolean).map(ref => {
      const path = ref.path || ref.ref?.path, title = textValue(ref.title, path || 'Referencia'), id = `pinned:${ref.id}`;
      return <article className="tw-item" key={ref.id}><strong>{title}</strong>{path && path !== title && <small>{path}</small>}<div className="tw-row">{path && reader.button(id, path)}<Button disabled={op.busy} onClick={() => op.run(async () => { await api('context.unpin', { workspaceId: workspace.id, id: ref.id }); await refresh(); })}>Quitar</Button></div>{reader.content(id, path)}<DataView value={ref} /></article>;
    })}</Section>}
    <Section title={tab === 'docs' ? `Documentos · ${itemsOf(resource.data).length}` : 'Decisiones'} action={tab === 'docs' ? <Refresh resource={resource} /> : <Button aria-expanded={creating} onClick={() => setCreating(!creating)}>Nueva decisión</Button>}>
      {tab === 'decisions' && creating && <MemoryForm workspace={workspace} api={api} refresh={refresh} notify={notify} onSaved={() => { resource.reload(); setCreating(false); }} />}
      <ResourceState resource={resource} empty={emptyMessage(tab, search)} onOpenPanel={onOpenPanel} />{resource.data?.truncated && <p className="tw-muted">Hay más resultados; afina la búsqueda.</p>}
      {itemsOf(resource.data).map((item, index) => tab === 'docs' ? <DocumentItem key={item.path || index} readerId={`doc:${item.path || index}`} item={item} workspace={workspace} api={api} refresh={refresh} op={op} reader={reader} /> : <MemoryCard key={item.id} item={item} workspace={workspace} api={api} refresh={refresh} notify={notify} onChange={resource.reload} />)}
    </Section><OperationState op={op} onOpenPanel={onOpenPanel} /></>;
}

const REF_KINDS = { node: 'Panel', task: 'Tarea', run: 'Ejecución', context: 'Documento' };
function Missions(props) {
  const { workspace, api, refresh, notify, onOpenPanel } = props;
  const runs = useResource(api, 'playground.list', { workspaceId: workspace.id });
  const automation = useResource(api, 'automation.list', { workspaceId: workspace.id });
  const [edit, setEdit] = useState(null), [title, setTitle] = useState(''), [notes, setNotes] = useState(''), [nextAction, setNextAction] = useState(''), [refs, setRefs] = useState([]);
  const op = useOperation(notify);
  const listed = resource => { try { return itemsOf(resource.data); } catch { return []; } };
  const candidates = [...(workspace.nodes || []).map(n => ({ kind: 'node', id: n.id, title: n.title || n.type })), ...(workspace.tasks || []).map(t => ({ kind: 'task', id: t.id, title: t.title })), ...listed(runs).map((r, i) => ({ kind: 'run', id: r.id, title: `Código ${i + 1}` })), ...listed(automation).map((r, i) => ({ kind: 'run', id: r.id, title: r.url ? hostOf(r.url) : `Navegación ${i + 1}` })), ...(workspace.contextRefs || []).map(r => ({ kind: 'context', id: r.id, title: r.title }))];
  const reset = () => { setEdit(null); setTitle(''); setNotes(''); setNextAction(''); setRefs([]); };
  return <><Section title={edit ? 'Editar misión' : 'Nueva misión'}><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!title.trim()) throw new Error('Escribe un título para la misión.'); const fields = { title: title.trim(), notes, nextAction, refs }; await api(edit ? 'mission.update' : 'mission.create', { workspaceId: workspace.id, ...(edit ? { id: edit, patch: fields } : fields) }); await refresh(); reset(); }, 'Misión guardada'); }}><Field label="Título"><input required value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="Notas"><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></Field><Field label="Próxima acción"><textarea rows={2} value={nextAction} onChange={e => setNextAction(e.target.value)} /></Field><Field label="Vincular"><select value="" onChange={e => { const ref = candidates.find(c => `${c.kind}:${c.id}` === e.target.value); if (ref && !refs.some(r => r.id === ref.id && r.kind === ref.kind)) setRefs([...refs, ref]); }}><option value="">Elegir…</option>{candidates.map(c => <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>{REF_KINDS[c.kind]} · {c.title}</option>)}</select></Field>{refs.map((ref, i) => <div className="tw-list-row" key={`${ref.kind}:${ref.id}:${i}`}><div>{ref.title || REF_KINDS[ref.kind] || 'Sin título'}</div><Button aria-label={`Desvincular ${ref.title || REF_KINDS[ref.kind] || ''}`} icon={X} onClick={() => setRefs(refs.filter((_, index) => index !== i))} /></div>)}<div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy}>Guardar</Button>{edit && <Button onClick={reset}>Cancelar</Button>}</div></form><OperationState op={op} /></Section>
    <Section title="Misiones">{!workspace.missions?.length && <EmptyState className="tw-empty" description="Guarda notas y la próxima acción para retomar el proyecto con contexto." />}{workspace.missions?.map(mission => <article className="tw-item" key={mission.id}><strong>{mission.title}</strong>{mission.notes && <p className="tw-prose">{mission.notes}</p>}<p><b>Próxima acción: </b>{mission.nextAction || 'Sin definir'}</p>{mission.refs?.length > 0 && <small>{mission.refs.map(ref => ref.title || REF_KINDS[ref.kind]).filter(Boolean).join(' · ')}</small>}<div className="tw-row"><Button onClick={() => onOpenPanel?.('mission', { missionId: mission.id }, mission.title)}>Abrir</Button><Button onClick={() => { setEdit(mission.id); setTitle(mission.title); setNotes(mission.notes || ''); setNextAction(mission.nextAction || ''); setRefs(mission.refs || []); }}>Editar</Button><Button disabled={op.busy} onClick={() => op.run(async () => { await api('mission.remove', { workspaceId: workspace.id, id: mission.id }); await refresh(); })}>Eliminar</Button></div></article>)}</Section>
    <Section title="Paneles">{!workspace.nodes?.length && <EmptyState className="tw-empty" description="Aún no hay paneles." />}{workspace.nodes?.map(node => <div className="tw-item" key={node.id}><strong>{node.title || node.type}</strong><div className="tw-row"><Button icon={ArrowUpRight} onClick={() => onOpenPanel?.(node.type, { ...node.data, nodeId: node.id, focusNodeId: node.id }, node.title)}>Ir al panel</Button><Field label="Misión"><select value={node.groupId || ''} disabled={op.busy} onChange={e => op.run(async () => { await api('node.update', { workspaceId: workspace.id, id: node.id, patch: { groupId: e.target.value || null } }); await refresh(); })}><option value="">Ninguna</option>{workspace.missions?.map(m => <option value={m.id} key={m.id}>{m.title}</option>)}</select></Field></div></div>)}</Section></>;
}

function Git({ workspace, api }) {
  const [base, setBase] = useState(''), [chosenBase, setChosenBase] = useState('');
  const resource = useResource(api, 'git.inspect', { workspaceId: workspace.id, ...(chosenBase.trim() ? { base: chosenBase.trim() } : {}) });
  const data = resource.data;
  return <><form className="tw-search" onSubmit={e => { e.preventDefault(); setChosenBase(base); if (base === chosenBase) resource.reload(); }}><Field label="Base de comparación (vacío: base del adaptador)"><input value={base} onChange={e => setBase(e.target.value)} placeholder="Referencia Git opcional" /></Field><Button type="submit" icon={RefreshCw} disabled={resource.loading}>Inspeccionar</Button></form><ResourceState resource={resource} empty="" />{data?.available && <><Section title="Repositorio"><Identity value={data.root} /><p>Rama: <b>{data.branch || 'desconocida / HEAD separado'}</b> · base: {data.base || 'desconocida'}</p><p>Árbol: {data.dirty === true ? 'Con cambios' : data.dirty === false ? 'Limpio' : 'desconocido'} · observado: {data.observedAt || 'desconocido'}</p></Section><Section title="Ramas"><div className="tw-table-scroll"><table className="tw-table"><thead><tr><th>Rama</th><th>Adelante / detrás</th><th>Integración en base</th></tr></thead><tbody>{data.branches?.map(branch => <tr key={branch.name}><td><span title={branch.oid}>{branch.current ? 'Actual · ' : ''}{branch.name}</span></td><td>{branch.ahead ?? '?'} / {branch.behind ?? '?'}</td><td>{branch.merged === true ? 'Integrada' : branch.merged === false ? 'No integrada (no implica lista)' : 'Desconocida'}</td></tr>)}</tbody></table></div></Section><Section title="Cambios">{!data.changes?.length && <p className="tw-empty">No se observaron cambios.</p>}{data.changes?.map((change, i) => <div className="tw-list-row" key={i}><Identity value={typeof change === 'string' ? change : change.path || change.file} /><span className="tw-badge">{change.status || change.xy || '?'}</span><DataView value={change} label="Detalle" /></div>)}</Section><Section title="Worktrees">{data.worktrees?.map((tree, i) => <div className="tw-item" key={i}><Identity value={tree.path || tree.worktree} /><DataView value={tree} /></div>)}</Section></>}</>;
}

export function useToolEvents(workspaceId, onStatus) {
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

// A hub: one panel, a few tabs, each tab an existing tool. The tab is kept per
// hub type so reopening Git lands where you left it; an explicit request
// (`phantom:hub-tab`) wins, e.g. "Revisar" from the inbox opens Git on Ramas.
function Hub({ type, ...props }) {
  const hub = HUBS[type], key = `phantom.hub.${type}`;
  const [tab, setTab] = useState(() => hubTab(type, props.node?.data?.hubTab || localStorage.getItem(key))[0]);
  useEffect(() => {
    const onTab = event => { if (event.detail?.type === type && hubTab(type, event.detail.tab)[0] === event.detail.tab) setTab(event.detail.tab); };
    window.addEventListener('phantom:hub-tab', onTab);
    return () => window.removeEventListener('phantom:hub-tab', onTab);
  }, [type]);
  const pick = id => { setTab(id); try { localStorage.setItem(key, id); } catch {} };
  const [, , content] = hubTab(type, tab);
  return <div className="hub" data-hub={type}>
    <div className="hub-bar"><div className="hub-tabs" role="tablist" aria-label={hub.name}>{hub.tabs.map(([id, name]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => pick(id)}>{name}</button>)}</div></div>
    <div className="hub-body" role="tabpanel" aria-label={hub.tabs.find(item => item[0] === tab)?.[1]}>{content === 'sites' ? <GlobalSites api={props.api} onOpenPanel={props.onOpenPanel} embedded /> : <ToolContent type={content} bare {...props} />}</div>
  </div>;
}

export function ToolContent({ type, bare, ...props }) {
  if (HUBS[type] && !bare && props.workspace) return <Hub type={type} {...props} />;
  if (PLUGIN_TITLES[type]) return <ToolErrorBoundary key={`${props.workspace?.id}:${type}:${props.node?.id || 'inspector'}`} title={PLUGIN_TITLES[type]}><PluginPanels type={type} {...props} /></ToolErrorBoundary>;
  if (!props.workspace && type !== 'settings') return <EmptyState className="tw-empty" description="Abre una carpeta para usar las herramientas del workspace." />;
  const components = { review: VideoReview, 'command-center': CommandCenter, incorporaciones: Incorporaciones, branches: Branches, repo: Repository, 'skills-catalog': SkillsCatalog, tasks: Tasks, context: Context, mission: Missions, sessions: Missions, git: Git, services: Environment, processes: Environment, docker: Docker, workflows: Workflows, playwright: Playwright, playground: Playground, settings: Settings };
  const Content = components[type];
  const identity = `${props.workspace?.id || 'host'}:${type}:${props.node?.id || 'inspector'}`;
  return <div className={`tw-content${type === 'skills-catalog' || type === 'branches' || type === 'repo' ? ' is-flush' : ''}`}><ToolErrorBoundary key={identity} title={TOOL_TITLES[type] || 'esta herramienta'}>{Content ? <Content {...props} /> : <p className="tw-warning" role="status">Esta herramienta no tiene contenido registrado: {type}. Elige una herramienta desde el inspector.</p>}</ToolErrorBoundary></div>;
}

export function ToolPanel({ node, workspace, api, refresh, onOpenPanel, notify, active }) {
  return <div className="tw-tool-panel"><ToolContent type={node.type} node={node} workspace={workspace} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} active={active} /></div>;
}
