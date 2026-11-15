import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, FileText, Play, RefreshCw, Square, Trash2, X } from 'lucide-react';
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
import Settings from './Settings.jsx';
import GlobalSites from './GlobalSites.jsx';
import { HUBS, hubTab } from '../hooks/hubs.mjs';
import '../hubs.css';

export const TOOL_TITLES = { tasks: 'Trabajo', context: 'Contexto', sessions: 'Sesiones', mission: 'Misiones', git: 'Git', services: 'Servicios', docker: 'Docker', workflows: 'Automatizar', playwright: 'Navegador automático', playground: 'Código', settings: 'Configuración' };
Object.assign(TOOL_TITLES, PLUGIN_TITLES, { review: 'Revisión de video', 'command-center': 'Centro de mando', incorporaciones: 'Cola de integración', branches: 'Ramas', repo: 'Git', 'skills-catalog': 'Skills' });
const json = value => JSON.stringify(value, null, 2);
const textValue = (value, fallback = 'Sin datos') => typeof value === 'string' && value.trim() ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
const message = error => textValue(error?.message, typeof error === 'string' ? error : 'Algo falló. Vuelve a intentarlo.');
const itemsOf = data => {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (!Array.isArray(data.items)) throw new Error('No se pudo leer la lista. Vuelve a intentarlo.');
  return data.items;
};
const active = status => ['running', 'starting', 'queued', 'stopping'].includes(status);
const STATUS = { running: 'En marcha', starting: 'Arrancando', queued: 'En espera', stopping: 'Deteniendo', stopped: 'Detenido', exited: 'Detenido', completed: 'Terminada', failed: 'Falló', healthy: 'En marcha', pinned: 'Fijado', unknown: 'Sin datos', todo: 'Por hacer', doing: 'En curso', done: 'Completada', ready: 'Lista', blocked: 'Bloqueada' };
const statusLabel = value => STATUS[value] || textValue(value);
const hostOf = url => { try { return new URL(url).host || url; } catch { return textValue(url, 'Navegación'); } };

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

export function Button({ children, icon: Icon, tone, ...props }) {
  return <button type="button" className={`tw-button ${tone ? `tw-${tone}` : ''}`} {...props}>{Icon && <Icon size={15} aria-hidden="true" />}{children}</button>;
}
export function Field({ label, children, hint }) {
  const id = useId();
  return <div className="tw-field"><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
// Missing tools get one plain sentence and, when there is something to do, one
// action; the original message stays available under Detalles.
const PHANTOM_MISSING = /Phantom unavailable|Phantom CLI not found/i;
const CHROMIUM_MISSING = /Chromium de Playwright no está descargado|Playwright no disponible/i;
function Unavailable({ reason, onOpenPanel, retry }) {
  const raw = textValue(reason, '');
  const phantom = PHANTOM_MISSING.test(raw);
  return <div className="tw-warning" role="status"><span>{phantom ? 'Phantom no está instalado o no se encuentra.' : 'No está disponible en este equipo.'}</span>
    <div className="tw-row">{phantom && onOpenPanel && <Button onClick={() => onOpenPanel('plugins', { category: 'agents' }, 'Configuración')}>Abrir Configuración</Button>}{retry && <Button icon={RefreshCw} onClick={retry}>Reintentar</Button>}</div>
    {raw && <DataView value={raw} />}
  </div>;
}
export function ErrorNotice({ error, retry, clear, onOpenPanel }) {
  if (!error) return null;
  const raw = message(error);
  if (PHANTOM_MISSING.test(raw)) return <Unavailable reason={raw} onOpenPanel={onOpenPanel} retry={retry} />;
  if (CHROMIUM_MISSING.test(raw)) return <div className="tw-error" role="alert"><span>Falta instalar Chromium para el navegador automático. Ejecuta: <code>npx playwright install chromium</code></span><div className="tw-row">{clear && <Button onClick={clear}>Cerrar</Button>}</div><DataView value={raw} /></div>;
  return <div className="tw-error" role="alert"><span>{raw}</span><div className="tw-row">{retry && <Button icon={RefreshCw} onClick={retry}>Reintentar</Button>}{clear && <Button onClick={clear}>Cerrar</Button>}</div></div>;
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
function ResourceState({ resource, empty = 'Aún no hay nada aquí.', onOpenPanel }) {
  if (resource.loading) return <p className="tw-muted" role="status">Cargando…</p>;
  if (resource.error) return <ErrorNotice error={resource.error} retry={resource.reload} onOpenPanel={onOpenPanel} />;
  if (resource.data?.available === false) return <Unavailable reason={resource.data.reason} onOpenPanel={onOpenPanel} retry={resource.reload} />;
  return empty && itemsOf(resource.data).length === 0 ? <EmptyState className="tw-empty" description={empty} /> : null;
}
export function DataView({ value, label = 'Detalles', open }) {
  return <details className="tw-details" open={open}><summary>{label}</summary><pre className="tw-code">{typeof value === 'string' ? value : json(value)}</pre></details>;
}
function Identity({ value }) {
  const [copied, setCopied] = useState(false), op = useOperation();
  if (value == null) return <span className="tw-muted">Sin datos</span>;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return <span className="tw-identity"><span className="tw-truncate" title={text}>{text}</span><Button icon={copied ? Check : Copy} aria-label="Copiar" onClick={() => op.run(async () => { await navigator.clipboard.writeText(text); setCopied(true); })} /><ErrorNotice error={op.error} clear={op.clear} /></span>;
}
function Section({ title, children, action }) {
  return <section className="tw-section"><div className="tw-heading"><h3>{title}</h3>{action}</div>{children}</section>;
}
function OperationState({ op, onOpenPanel }) { return <><ErrorNotice error={op.error} clear={op.clear} onOpenPanel={onOpenPanel} />{op.busy && <p className="tw-muted" role="status">Procesando…</p>}</>; }
function Refresh({ resource }) { return <Button icon={RefreshCw} disabled={resource.loading} onClick={resource.reload}>Actualizar</Button>; }

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

function Tasks(props) {
  const { workspace, api, refresh, notify, onOpenPanel } = props;
  const [mode, setMode] = useState('draft'), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [edit, setEdit] = useState(null);
  const source = useResource(api, 'phantom.list', { workspaceId: workspace.id, topic: 'tasks' });
  const op = useOperation(notify);
  const [cardId, setCardId] = useState(props.node?.data?.cardId || '');
  useEffect(() => { setCardId(props.node?.data?.cardId || ''); }, [props.node?.data?.cardId]);
  if (cardId) return <Section title="Tarea vinculada" action={<Refresh resource={source} />}><Button onClick={() => setCardId('')}>Ver todas</Button><ResourceState resource={source} empty="" onOpenPanel={onOpenPanel} />{itemsOf(source.data).filter(item => item.id === cardId).map(item => <PhantomItem key={item.id} item={item} topic="tasks" kind="card" {...props} onChange={source.reload} />)}{!source.loading && source.data?.available && !itemsOf(source.data).some(item => item.id === cardId) && <p className="tw-warning">La tarea vinculada ya no está en este proyecto.</p>}</Section>;
  return <><Section title={edit ? 'Editar borrador' : 'Nuevo borrador'}><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!title.trim()) throw new Error('Escribe un título.'); await api(edit ? 'task.update' : 'task.create', { workspaceId: workspace.id, ...(edit ? { id: edit, patch: { title: title.trim(), description, kind: mode } } : { title: title.trim(), description, kind: mode, status: 'todo', refs: [] }) }); await refresh(); setTitle(''); setDescription(''); setEdit(null); }, 'Guardado'); }}>
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
    {controller && <><p className="tw-muted">Ejecución: {statusLabel(controller.status)}</p><pre className="tw-code" aria-live="polite">{controller.text || controller.output || 'Sin salida.'}</pre><ErrorNotice error={controller.error} /></>}<OperationState op={op} onOpenPanel={onOpenPanel} />
  </article>;
}

function DocumentItem({ item, workspace, api, refresh, op, onRead }) {
  const path = typeof item.path === 'string' && item.path ? item.path : null;
  const hash = item.hash ?? item.sha256;
  const title = textValue(item.title, path || 'Documento');
  return <article className="tw-item"><strong>{title}</strong>{path && path !== title && <small>{path}</small>}
    <div className="tw-row"><Button disabled={op.busy || !path} onClick={() => op.run(async () => { onRead(await api('context.read', { workspaceId: workspace.id, path })); })}>Leer</Button>
      <Button disabled={op.busy || !path} onClick={() => op.run(async () => {
        const ref = { path, ...(typeof hash === 'string' && hash ? { hash } : {}), ...(item.revision != null ? { revision: item.revision } : {}) };
        await api('context.pin', { workspaceId: workspace.id, path, title, kind: textValue(item.kind, 'document'), ...(item.source != null ? { source: item.source } : {}), ref });
        await refresh();
      }, 'Documento fijado')}>Fijar</Button></div>
  </article>;
}

function Context(props) {
  const { workspace, api, refresh, notify, onOpenPanel } = props;
  const [tab, setTab] = useState('docs'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [detail, setDetail] = useState(null);
  const topic = tab === 'skills' ? 'skills' : 'memories';
  const resource = useResource(api, tab === 'docs' ? 'context.scan' : 'phantom.list', { workspaceId: workspace.id, query: search, ...(tab === 'docs' ? {} : { topic }) });
  const op = useOperation(notify);
  return <><div className="tw-tabs" aria-label="Tipo de contexto">{[['docs', 'Documentos'], ['decisions', 'Decisiones'], ['skills', 'Skills']].map(([id, title]) => <Button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setDetail(null); }}>{title}</Button>)}</div>
    <form className="tw-search" onSubmit={e => { e.preventDefault(); setSearch(query); if (query === search) resource.reload(); }}><Field label="Buscar"><input type="search" value={query} onChange={e => setQuery(e.target.value)} /></Field><Button type="submit" disabled={resource.loading}>Buscar</Button></form>
    <Section title={tab === 'docs' ? 'Documentos' : tab === 'skills' ? 'Skills' : 'Decisiones'} action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="Sin resultados." onOpenPanel={onOpenPanel} />{resource.data?.truncated && <p className="tw-muted">Hay más resultados; afina la búsqueda.</p>}
      {itemsOf(resource.data).map((item, index) => tab === 'docs' ? <DocumentItem key={item.path || index} item={item} workspace={workspace} api={api} refresh={refresh} op={op} onRead={setDetail} /> : <PhantomItem key={item.id} item={item} topic={topic} kind={tab === 'skills' ? 'skill' : 'decision'} {...props} onChange={resource.reload} />)}
      {detail && <div className="tw-item"><strong>{detail.path}</strong>{detail.truncated && <p className="tw-muted">Se muestra solo el principio.</p>}<pre className="tw-code">{detail.text}</pre></div>}
    </Section><OperationState op={op} />
    {tab !== 'docs' && <Section title={tab === 'skills' ? 'Nueva skill' : 'Nueva decisión'}><NativeForm key={tab} kind={tab === 'skills' ? 'skill' : 'decision'} {...props} onSaved={resource.reload} /></Section>}
    <Section title="Fijados">{!workspace.contextRefs?.length && <EmptyState className="tw-empty" description="Fija un documento para tenerlo a mano." />}{workspace.contextRefs?.map(ref => <div className="tw-item" key={ref.id}><strong>{ref.title}</strong>{ref.path && ref.path !== ref.title && <small>{ref.path}</small>}<DataView value={ref} /><Button icon={Trash2} disabled={op.busy} onClick={() => op.run(async () => { await api('context.unpin', { workspaceId: workspace.id, id: ref.id }); await refresh(); })}>Quitar</Button></div>)}</Section></>;
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

function ServiceOwner({ owner, workspace, onOpenPanel, op }) {
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return null;
  const sessionId = typeof owner.sessionId === 'string' && owner.sessionId ? owner.sessionId : null;
  const node = sessionId && workspace.nodes?.find(node => node.type === 'terminal' && node.data?.sessionId === sessionId);
  if (node && onOpenPanel) return <Button icon={ArrowUpRight} disabled={op.busy} onClick={() => op.run(() => onOpenPanel('terminal', { focusNodeId: node.id }, textValue(node.title, 'Terminal')))}>Ir a la sesión</Button>;
  return null;
}

function Services({ workspace, api, refresh, notify, onOpenPanel }) {
  const resource = useResource(api, 'services.list', { workspaceId: workspace.id });
  const [url, setUrl] = useState(''), [title, setTitle] = useState(''); const op = useOperation(notify);
  const notes = [resource.data?.processReason, resource.data?.dockerReason].filter(value => typeof value === 'string' && value);
  return <><Section title="Fijar un sitio"><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => {
    const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Usa una URL http o https.');
    await api('services.pin', { workspaceId: workspace.id, url: parsed.href, title: title.trim() || parsed.host }); await refresh(); resource.reload(); setUrl(''); setTitle('');
  }, 'Sitio fijado'); }}><Field label="URL"><input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:3000" /></Field><Field label="Nombre"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Opcional" /></Field><Button type="submit" tone="primary" disabled={op.busy}>Fijar</Button></form></Section>
    <Section title="Servicios y sitios" action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="Fija una URL o arranca un servidor en una sesión para verlo aquí." />
      {notes.length > 0 && <DataView value={notes.join('\n')} />}
      {itemsOf(resource.data).map((service, index) => {
        const serviceURL = typeof service.url === 'string' ? service.url : null;
        const label = textValue(service.title, serviceURL || 'Servicio');
        return <article className="tw-item" key={textValue(service.id, `service-${index}`)}>
          <div className="tw-heading"><strong>{label}</strong><span className="tw-badge">{statusLabel(service.status)}</span></div>
          {serviceURL && serviceURL !== label && <small>{serviceURL}</small>}
          <div className="tw-row"><Button icon={ArrowUpRight} disabled={op.busy || !serviceURL || !onOpenPanel} onClick={() => op.run(() => onOpenPanel('browser', { url: serviceURL }, label))}>Abrir</Button>
            <ServiceOwner owner={service.owner} workspace={workspace} onOpenPanel={onOpenPanel} op={op} />
            {service.source === 'pinned' && typeof service.id === 'string' && <Button icon={Trash2} disabled={op.busy} onClick={() => op.run(async () => { await api('services.remove', { workspaceId: workspace.id, id: service.id }); await refresh(); resource.reload(); })}>Quitar</Button>}
          </div><DataView value={service} />
        </article>;
      })}
    </Section><OperationState op={op} /></>;
}

function Docker({ workspace, api, notify }) {
  const resource = useResource(api, 'docker.list', { workspaceId: workspace.id });
  const [logs, setLogs] = useState(null); const op = useOperation(notify);
  return <><Section title="Contenedores" action={<Refresh resource={resource} />}><ResourceState resource={resource} empty="No hay contenedores de este proyecto." />{itemsOf(resource.data).map(container => { const name = textValue(container.name || container.names, 'Contenedor'); return <article className="tw-item" key={container.id}><div className="tw-heading"><strong>{name}</strong><span className="tw-badge">{statusLabel(container.status || container.state)}</span></div><div className="tw-row">{[['start', 'Iniciar'], ['stop', 'Detener'], ['restart', 'Reiniciar']].map(([action, label]) => <Button key={action} disabled={op.busy} onClick={() => op.run(async () => { await api('docker.action', { workspaceId: workspace.id, id: container.id, action }); resource.reload(); }, `${name}: ${label.toLowerCase()}`)}>{label}</Button>)}<Button disabled={op.busy} onClick={() => op.run(async () => { const value = await api('docker.logs', { workspaceId: workspace.id, id: container.id, tail: 200 }); setLogs({ name, text: String(value.text || '').slice(-64000) }); })}>Ver registro</Button></div><DataView value={container} /></article>; })}</Section>{logs && <Section title={`Registro · ${logs.name}`}><pre className="tw-code" aria-live="polite">{logs.text || 'Sin salida.'}</pre></Section>}<OperationState op={op} /></>;
}

const simpleStep = step => typeof step === 'string' || (step && step.type === 'task' && typeof step.title === 'string' && Object.keys(step).every(key => ['type', 'title'].includes(key)));
function Workflows(props) {
  const { workspace, api, refresh, notify, onOpenPanel } = props;
  const [edit, setEdit] = useState(null), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [stepsText, setStepsText] = useState(''), [format, setFormat] = useState('text');
  const op = useOperation(notify);
  const reset = () => { setEdit(null); setTitle(''); setDescription(''); setStepsText(''); setFormat('text'); };
  const parseSteps = () => { let steps; if (format === 'json') { try { steps = JSON.parse(stepsText); } catch { throw new Error('Los pasos no son JSON válido.'); } } else steps = stepsText.split('\n').map(text => text.trim()).filter(Boolean).map(text => ({ type: 'task', title: text })); if (!Array.isArray(steps) || !steps.length) throw new Error('Añade al menos un paso.'); return steps; };
  const load = workflow => { const simple = (workflow.steps || []).every(simpleStep); setEdit(workflow.id); setTitle(workflow.title); setDescription(workflow.description || ''); setFormat(simple ? 'text' : 'json'); setStepsText(simple ? (workflow.steps || []).map(step => typeof step === 'string' ? step : step.title).join('\n') : json(workflow.steps)); };
  return <><Section title={edit ? 'Editar secuencia' : 'Nueva secuencia'}><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!title.trim()) throw new Error('Escribe un título.'); const steps = parseSteps(); const previous = workspace.workflows?.find(w => w.id === edit); await api('workflow.save', { workspaceId: workspace.id, ...(edit ? { id: edit } : {}), title: title.trim(), description, steps, version: previous ? previous.version + 1 : 1 }); await refresh(); reset(); }, 'Secuencia guardada'); }}><Field label="Título"><input required value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="Pasos" hint={format === 'json' ? undefined : 'Uno por línea'}><textarea rows={6} className={format === 'json' ? 'tw-code-input' : undefined} spellCheck={format !== 'json'} value={stepsText} onChange={e => setStepsText(e.target.value)} required /></Field>
      <details className="tw-details" open={format === 'json' || undefined}><summary>Detalles</summary><Field label="Descripción"><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field><label className="tw-check"><input type="checkbox" checked={format === 'json'} onChange={e => setFormat(e.target.checked ? 'json' : 'text')} />Escribir los pasos en JSON</label>{format === 'json' && <pre className="tw-code">{'[{ "type": "task", "title": "…" },\n { "type": "playground", "runtime": "node | python | shell", "code": "…" }]'}</pre>}</details>
      <div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy}>Guardar</Button>{edit && <Button onClick={reset}>Cancelar</Button>}</div></form><OperationState op={op} /></Section>
    <Section title="Secuencias">{!workspace.workflows?.length && <EmptyState className="tw-empty" description="Aún no hay secuencias." />}{workspace.workflows?.map(workflow => <article className="tw-item" key={workflow.id}><div className="tw-heading"><strong>{workflow.title}</strong><span className="tw-badge">v{workflow.version}</span></div>{workflow.description && <p>{workflow.description}</p>}<div className="tw-row"><Button onClick={() => load(workflow)}>Editar</Button><Button disabled={op.busy} onClick={() => op.run(async () => { await api('workflow.remove', { workspaceId: workspace.id, id: workflow.id }); await refresh(); })}>Eliminar</Button></div>{workflow.steps?.map((step, index) => { const value = typeof step === 'string' ? { type: 'task', title: step } : step; const executable = value.type === 'playground' && ['node', 'python', 'shell'].includes(value.runtime) && typeof value.code === 'string'; return <div className="tw-step tw-row" key={index}><strong>{index + 1}. {value.title || (executable ? 'Ejecutar código' : 'Paso')}</strong>{!simpleStep(step) && <DataView value={value} />}<Button disabled={op.busy} icon={executable ? Play : Check} onClick={() => op.run(async () => { if (executable) { const run = await api('playground.run', { workspaceId: workspace.id, runtime: value.runtime, code: value.code }); onOpenPanel?.('playground', { runId: run.id }, workflow.title); } else { await api('task.create', { workspaceId: workspace.id, kind: 'draft', title: value.title || `${workflow.title}: paso ${index + 1}`, description: typeof value.description === 'string' ? value.description : simpleStep(step) ? '' : json(value), refs: [{ kind: 'workflow', id: workflow.id, version: workflow.version, step: index }] }); await refresh(); } }, executable ? 'En marcha' : 'Borrador creado')}>{executable ? 'Ejecutar' : 'Crear borrador'}</Button></div>; })}</article>)}</Section></>;
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

const RUNTIMES = { node: 'Node', python: 'Python', shell: 'Shell' };
function Runs({ resource, events, api, workspace, family, op, onOpenPanel }) {
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

function Playground({ workspace, api, notify, node }) {
  const resource = useResource(api, 'playground.list', { workspaceId: workspace.id });
  const events = useToolEvents(workspace.id, resource.reload), op = useOperation(notify);
  const [runtime, setRuntime] = useState(node?.data?.runtime || 'node');
  const [code, setCode] = useState(node?.data?.code || 'console.log("Hola, workspace");');
  return <><Section title="Ejecutar código"><form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => { if (!code.trim()) throw new Error('Escribe código antes de ejecutar.'); await api('playground.run', { workspaceId: workspace.id, runtime, code }); resource.reload(); }, 'En marcha'); }}><Field label="Lenguaje"><select value={runtime} onChange={e => setRuntime(e.target.value)}><option value="node">Node</option><option value="python">Python</option><option value="shell">Shell</option></select></Field><Field label="Código"><textarea rows={12} spellCheck={false} className="tw-code-input" value={code} onChange={e => setCode(e.target.value)} required /></Field><Button type="submit" tone="primary" icon={Play} disabled={op.busy}>Ejecutar</Button></form><OperationState op={op} /></Section><Runs resource={resource} events={events} api={api} workspace={workspace} family="playground" op={op} /></>;
}

const ACTIONS = [['goto', 'Ir a'], ['click', 'Clic'], ['fill', 'Escribir'], ['screenshot', 'Captura'], ['wait', 'Esperar']];
function Playwright({ workspace, api, notify, node, onOpenPanel }) {
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
    <div className="hub-body" role="tabpanel" aria-label={hub.tabs.find(item => item[0] === tab)?.[1]}>{content === 'sites' ? <GlobalSites api={props.api} embedded /> : <ToolContent type={content} bare {...props} />}</div>
  </div>;
}

export function ToolContent({ type, bare, ...props }) {
  if (HUBS[type] && !bare && props.workspace) return <Hub type={type} {...props} />;
  if (PLUGIN_TITLES[type]) return <ToolErrorBoundary key={`${props.workspace?.id}:${type}:${props.node?.id || 'inspector'}`} title={PLUGIN_TITLES[type]}><PluginPanels type={type} {...props} /></ToolErrorBoundary>;
  if (!props.workspace && type !== 'settings') return <EmptyState className="tw-empty" description="Abre una carpeta para usar las herramientas del workspace." />;
  const components = { review: VideoReview, 'command-center': CommandCenter, incorporaciones: Incorporaciones, branches: Branches, repo: Repository, 'skills-catalog': SkillsCatalog, tasks: Tasks, context: Context, mission: Missions, sessions: Missions, git: Git, services: Services, docker: Docker, workflows: Workflows, playwright: Playwright, playground: Playground, settings: Settings };
  const Content = components[type];
  const identity = `${props.workspace?.id || 'host'}:${type}:${props.node?.id || 'inspector'}`;
  return <div className={`tw-content${type === 'skills-catalog' || type === 'branches' || type === 'repo' ? ' is-flush' : ''}`}><ToolErrorBoundary key={identity} title={TOOL_TITLES[type] || 'esta herramienta'}>{Content ? <Content {...props} /> : <p className="tw-warning" role="status">Esta herramienta no tiene contenido registrado: {type}. Elige una herramienta desde el inspector.</p>}</ToolErrorBoundary></div>;
}

export function ToolPanel({ node, workspace, api, refresh, onOpenPanel, notify, active }) {
  return <div className="tw-tool-panel"><ToolContent type={node.type} node={node} workspace={workspace} api={api} refresh={refresh} onOpenPanel={onOpenPanel} notify={notify} active={active} /></div>;
}
