import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowUp, ArrowUpRight, Mic, RefreshCw, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { VoiceActivity, VoiceTranscript, dictationPreview } from './VoiceActivity';
import { canSubmit, mergeDictation, sendAction } from '../hooks/voice-send.mjs';
import { useComposerSize } from '../hooks/useComposerSize';
import { useVoiceDraft } from './VoiceProvider';
import Incorporaciones from './Incorporaciones';
import { preferredCardMode } from './ChatCard';
import { ErrorNotice, Switch, useResource } from './PluginPrimitives';
import { buildCola } from '../hooks/incorporaciones-model.mjs';
import { agentTree, agoLabel, buildDelegation, mergeTraceEvents, traceEventOwner, traceEventView, traceResult, traceView, withCardPlans, withChatSubagents } from '../hooks/delegation-model.mjs';
import { useChatSubagents } from '../hooks/useChatSubagents';
import { useAgentDetail, useAgentTraces, useSupervisor } from '../hooks/useAgentTraces';
import { formatCost, formatTokens } from '../hooks/chatState';
import { statusLabel } from '../hooks/phantom-desk.mjs';
import '../incorporaciones.css';

const AGENT = { working: 'Trabajando', blocked: 'Bloqueado', review: 'En espera', idle: 'En espera' };

function CardPlan({ plan }) {
  return <div className="pd-deleg-plan-block">
    <small>Plan · {plan.done} de {plan.total} completadas</small>
    <ul className="pd-deleg-plan" aria-label="Plan de la card">{plan.children.map(child => <li key={child.key} className="pd-deleg-child" data-status={child.status}><small>{child.status === 'sin registrar' ? 'Sin registrar' : statusLabel(child.status)}</small><span>{child.goal}</span></li>)}</ul>
  </div>;
}

// The dock's Orquestador tab: the orchestrator at a glance, a line to talk to
// it (typed or dictated) when it runs as a chat, and where the queue stands.
// The full queue lives in Git › Cola; without a way to open it, it is shown here.
export default function PhantomOrchestrator({ workspace, api, notify, connected, status, onOpenPanel, agentFocus, onAgentFocusConsumed }) {
  const orchestrator = status.orchestrator;
  const root = useRef(null), returnTo = useRef(null);
  const traces = useAgentTraces({ api, workspaceId: workspace.id, connected });
  const tree = useMemo(() => agentTree(traces.items), [traces.items]);
  const [selection, setSelection] = useState(() => ({ workspaceId: workspace.id, id: agentFocus?.workspaceId === workspace.id ? agentFocus.id : null }));
  const selectedId = selection.workspaceId === workspace.id ? selection.id : null;
  const select = useCallback(id => setSelection({ workspaceId: workspace.id, id }), [workspace.id]);
  const openAgent = useCallback(id => { returnTo.current = id; select(id); }, [select]);
  const closeAgent = useCallback(() => {
    const target = returnTo.current;
    select(null);
    requestAnimationFrame(() => [...(root.current?.querySelectorAll('[data-agent-row]') || [])].find(el => el.dataset.agentRow === target)?.focus({ preventScroll: false }));
  }, [select]);
  useEffect(() => {
    if (!agentFocus) return;
    if (agentFocus.id && agentFocus.workspaceId === workspace.id) { returnTo.current = agentFocus.id; select(agentFocus.id); }
    onAgentFocusConsumed?.();
  }, [agentFocus, onAgentFocusConsumed, select, workspace.id]);
  const tasks = useResource(api, 'phantom.list', { workspaceId: workspace.id, topic: 'tasks' });
  const [lastTasks, setLastTasks] = useState(null);
  useEffect(() => {
    if (tasks.data != null) setLastTasks({ workspaceId: workspace.id, data: tasks.data });
  }, [tasks.data, workspace.id]);
  useEffect(() => {
    const interval = setInterval(tasks.reload, 20_000);
    return () => clearInterval(interval);
  }, [tasks.reload]);
  const taskData = tasks.data ?? (lastTasks?.workspaceId === workspace.id ? lastTasks.data : null);
  const chatSubagents = useChatSubagents(workspace, api, connected);
  const delegation = useMemo(() => withChatSubagents(withCardPlans(buildDelegation(workspace), taskData), chatSubagents), [workspace, taskData, chatSubagents]);
  const delegates = delegation.rows.filter(row => row.role !== 'orchestrator' && !row.hidden);
  const working = delegates.filter(row => row.status === 'working').length;
  const blocked = delegates.filter(row => row.status === 'blocked').length;
  const unassigned = delegates.filter(row => row.purpose === 'none').length;
  const subagents = delegates.reduce((total, row) => total + row.subagents.length, 0);
  const summary = [
    working && `${working} trabajando`,
    blocked && `${blocked} ${blocked === 1 ? 'bloqueada' : 'bloqueadas'}`,
    unassigned && `${unassigned} sin encargo`,
    subagents && `${subagents} ${subagents === 1 ? 'subagente' : 'subagentes'}`,
  ].filter(Boolean).join(' · ');
  if (selectedId) return <div className="pd-orchestrator" ref={root}>
    <AgentDetail key={workspace.id} workspace={workspace} api={api} connected={connected} id={selectedId} tree={tree} onBack={closeAgent} onSelect={openAgent} />
  </div>;
  return <div className="pd-orchestrator" ref={root}>
    {orchestrator && <section className="pd-session" data-tone={status.tone} aria-label="Orquestador">
      <div className="pd-session-head">
        <span className="pd-dot" aria-hidden="true" />
        <div className="pd-session-title"><strong>{orchestrator.title}</strong><small>{AGENT[orchestrator.agent] || AGENT.idle}{orchestrator.step ? ` · ${orchestrator.step}` : ''}</small></div>
        <button type="button" className="pd-open-session" onClick={() => onOpenPanel?.('terminal', { focusNodeId: orchestrator.id })}><ArrowUpRight size={15} aria-hidden="true" />Ir a la sesión</button>
      </div>
      {orchestrator.chat
        ? <OrchestratorComposer key={orchestrator.id} workspace={workspace} api={api} connected={connected} nodeId={orchestrator.id} title={orchestrator.title} />
        : null}
    </section>}
    <SupervisorSection workspace={workspace} api={api} connected={connected} onOpenPanel={onOpenPanel} />
    <AgentsSection workspace={workspace} tree={tree} traces={traces} onSelect={openAgent} />
    {(delegates.length > 0 || delegation.cards.length > 0) && <section className="pd-deleg" aria-label="Delegación">
      <div className="pd-deleg-head"><strong>Quién tiene qué</strong>{summary && <small>{summary}</small>}</div>
      <ul className="pd-deleg-list">{delegates.map(row => {
        const content = <>
          <span className="pd-deleg-dot" aria-hidden="true" />
          <span className="pd-deleg-content">
            <strong>{row.title}</strong>
            <small>{{ working: 'Trabajando', blocked: 'Bloqueado', review: 'Lista para revisión', idle: 'En espera' }[row.status]}{row.step ? ` · ${row.step}` : ''}</small>
            {(row.purpose === 'none' || (row.what && !row.title.endsWith(row.what))) && <span className="pd-deleg-what">{row.purpose === 'none' ? 'Sin tarea ni encargo' : row.what}</span>}
            {row.why && <small>{row.why}</small>}
            {row.from && <small>Pedido por {row.from.title}{row.from.external ? ` · ${row.from.workspaceName}` : ''}</small>}
            {row.branch && <code>{row.branch}</code>}
          </span>
        </>;
        return <li key={row.id} className="pd-deleg-row" data-purpose={row.purpose} data-status={row.status} style={{ '--deleg-depth': row.depth }}>
          {onOpenPanel
            ? <button type="button" className="pd-deleg-item" aria-label={`Ir a ${row.title}`} onClick={() => onOpenPanel('terminal', { focusNodeId: row.id })}>{content}</button>
             : <div className="pd-deleg-item">{content}</div>}
          {row.plan && <CardPlan plan={row.plan} />}
          {row.subagents.length > 0 && <ul className="pd-deleg-subs" aria-label="Subagentes">{row.subagents.map(subagent => <li key={subagent.id} className="pd-deleg-sub"><span>Subagente{subagent.type ? ` · ${subagent.type}` : ''}</span>{subagent.description && <span>{subagent.description}</span>}{subagent.background && <span>en segundo plano</span>}</li>)}</ul>}
        </li>;
      })}</ul>
      {delegation.cards.length > 0 && <div className="pd-deleg-cards">
        <strong>Cards sin terminal</strong>
        {delegation.cards.map(card => <div key={card.id}><strong>{card.goal}</strong><small>{statusLabel(card.status)}</small><CardPlan plan={card.plan} /></div>)}
      </div>}
    </section>}
    {onOpenPanel
      ? <QueueSummary workspace={workspace} api={api} onOpenPanel={onOpenPanel} hasOrchestrator={Boolean(orchestrator)} />
      : <Incorporaciones workspace={workspace} api={api} notify={notify} sessionVisible={Boolean(orchestrator)} />}
  </div>;
}

const useClock = (interval = 10_000) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(timer); }, [interval]);
  return now;
};
const clock = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) : '';
const short = value => String(value).slice(0, 13);

// What a resource shows until it has data, and when it is stale or failed after having had some.
function TraceNotice({ resource, noun }) {
  if (resource.status === 'loading') return <p className="tw-muted" role="status">Leyendo {noun}…</p>;
  if (resource.status === 'disconnected') return <p className="tw-muted" role="status">Sin conexión con el host. Se leerá al reconectar.</p>;
  if (resource.status === 'error') return <ErrorNotice error={resource.error} retry={resource.reload} />;
  if (resource.status === 'unavailable') return <p className="tw-muted" role="status">No disponible: {resource.reason || 'el host no indicó el motivo.'}</p>;
  if (resource.status !== 'ready') return null;
  return <>
    {!resource.connected && <p className="tw-muted" role="status">Sin conexión con el host · últimos datos recibidos{resource.updatedAt ? ` ${agoLabel(new Date(resource.updatedAt).toISOString())}` : ''}.</p>}
    {resource.error && resource.connected && <ErrorNotice error={resource.error} retry={resource.reload} />}
  </>;
}

function AgentsSection({ workspace, tree, traces, onSelect }) {
  const now = useClock();
  const titles = useMemo(() => new Map((workspace.nodes || []).map(node => [node.id, node.title])), [workspace.nodes]);
  const byId = useMemo(() => new Map(tree.rows.map(row => [row.id, row.agent])), [tree]);
  const { counts } = tree;
  const summary = [counts.roots && `${counts.roots} ${counts.roots === 1 ? 'raíz' : 'raíces'}`, counts.subagents && `${counts.subagents} ${counts.subagents === 1 ? 'subagente' : 'subagentes'}`, counts.runs && `${counts.runs} ${counts.runs === 1 ? 'ejecución' : 'ejecuciones'}`, counts.active && `${counts.active} ${counts.active === 1 ? 'activo' : 'activos'}`].filter(Boolean).join(' · ');
  return <section className="pd-deleg pd-agents" aria-label="Agentes">
    <div className="pd-deleg-head"><strong>Agentes</strong>{summary && <small>{summary}</small>}</div>
    <TraceNotice resource={traces} noun="los agentes" />
    {traces.status === 'ready' && !tree.rows.length && <p className="tw-muted">Aún no hay agentes registrados en este proyecto.</p>}
    {tree.rows.length > 0 && <ul className="pd-deleg-list" aria-label="Árbol de agentes">{tree.rows.map(row => {
      const view = traceView(row.agent, now), parent = view.parentId && row.depth > 0 ? traceView(byId.get(view.parentId), now).name : '';
      const session = row.depth === 0 && titles.get(view.nodeId);
      return <li key={row.id} className="pd-deleg-row pd-agent-row" data-tone={view.status.tone} data-kind={row.kind} style={{ '--deleg-depth': row.depth }}>
        <button type="button" className="pd-deleg-item" data-agent-row={row.id} aria-label={`Abrir ${view.name}: ${view.kindLabel}${parent ? ` de ${parent}` : ''}, ${view.status.label}`} onClick={() => onSelect(row.id)}>
          <span className="pd-deleg-dot" aria-hidden="true" />
          <span className="pd-deleg-content">
            <strong>{view.name}</strong>
            <small>{view.kindLabel} · {view.status.label}{view.activity ? ` · ${view.activity}` : ''}</small>
            <small>Modelo: {view.model.text}{view.updated ? ` · ${view.updated}` : ''}</small>
            {view.taskId && <small>Encargo <code>{short(view.taskId)}</code></small>}
            {session && <small>Sesión: {session}</small>}
            {row.parentMissing && <small>Padre no listado</small>}
          </span>
        </button>
      </li>;
    })}</ul>}
  </section>;
}

const SUPERVISOR_STATUS = { disabled: 'Desactivado', idle: 'En espera', running: 'Resumiendo', error: 'Con error', unavailable: 'No disponible' };
const PROPOSAL_KIND = { 'review-integration': 'Revisar integración', unblock: 'Desbloquear', 'resume-parent': 'Reanudar al padre', dependency: 'Dependencia' };

// The supervisor reads what agents did and proposes; it never merges or runs anything itself.
function SupervisorSection({ workspace, api, connected, onOpenPanel }) {
  const sup = useSupervisor({ api, workspaceId: workspace.id, connected });
  const now = useClock(30_000);
  const data = sup.data, config = data?.config || {}, enabled = config.enabled === true;
  const feed = useMemo(() => mergeTraceEvents(Array.isArray(data?.events) ? data.events : []), [data]);
  const events = useMemo(() => feed.slice(-5).reverse(), [feed]);
  const known = useMemo(() => new Map(feed.map(event => [event.id, event])), [feed]);
  const summary = typeof data?.summary === 'string' ? { text: data.summary, at: null } : data?.summary && typeof data.summary === 'object' ? { text: String(data.summary.text ?? ''), at: data.summary.at } : null;
  const proposals = Array.isArray(data?.proposals) ? data.proposals : [];
  const failure = typeof data?.error === 'string' ? data.error : data?.error?.message;
  const cost = data?.cost?.available === true && Number.isFinite(data.cost.usd) ? formatCost(data.cost.usd) : 'No disponible';
  const state = typeof data?.status === 'string' && SUPERVISOR_STATUS[data.status] ? SUPERVISOR_STATUS[data.status] : data ? 'Estado no disponible' : '';
  return <section className="pd-deleg pd-sup" aria-label="Supervisor">
    <div className="pd-sup-head">
      <div className="pd-deleg-head"><strong>Supervisor</strong>{state && <small>{state}{data?.updatedAt ? ` · ${agoLabel(data.updatedAt, now)}` : ''}</small>}</div>
      {data && <Switch checked={enabled} label={enabled ? 'Desactivar supervisor' : 'Activar supervisor'} disabled={!connected || Boolean(sup.busy)} onChange={next => sup.configure({ enabled: next })} />}
    </div>
    <TraceNotice resource={sup} noun="el supervisor" />
    {!data && sup.status === 'ready' && <p className="tw-muted" role="status">No disponible: el host no devolvió datos del supervisor.</p>}
    {sup.actionError && <ErrorNotice error={sup.actionError} clear={sup.clearActionError} />}
    {data && <>
      <p className="pd-sup-meta"><small>Modelo {config.model || 'No disponible'}</small>{Number.isFinite(config.maxCallsPerHour) && <small>Hasta {config.maxCallsPerHour} llamadas por hora</small>}{Number.isFinite(config.batchThreshold) && <small>Resume cada {config.batchThreshold} eventos</small>}<small>Coste: {cost}</small></p>
      {failure && <p className="pc-phantom-warning" role="alert">{failure}</p>}
      {!enabled && <p className="tw-muted">Desactivado: solo se conserva la actividad local.</p>}
      {enabled && <div className="pd-sup-summary">
        {summary?.text ? <><p>{summary.text}</p>{summary.at && <small>{agoLabel(summary.at, now)}</small>}</> : <p className="tw-muted">Aún sin resumen.</p>}
        <button type="button" className="inc-button is-quiet" disabled={!connected || Boolean(sup.busy)} onClick={sup.refresh}><RefreshCw size={14} aria-hidden="true" />{sup.busy === 'refresh' ? 'Resumiendo…' : 'Actualizar resumen'}</button>
      </div>}
      {proposals.length > 0 && <ul className="pd-sup-proposals" aria-label="Propuestas del supervisor">{proposals.map((proposal, index) => <li key={`${proposal.kind}:${proposal.title}:${index}`}>
        <strong>{proposal.title}</strong>
        <small>{PROPOSAL_KIND[proposal.kind] || 'Propuesta'}</small>
        {proposal.reason && <span>{proposal.reason}</span>}
        {Array.isArray(proposal.evidenceIds) && proposal.evidenceIds.length > 0 && <small>Evidencia: {proposal.evidenceIds.map(evidence => { const event = known.get(evidence); return event ? traceEventView(event).text || traceEventView(event).label : `${short(evidence)} (fuera del feed)`; }).join(' · ')}</small>}
        {proposal.kind === 'review-integration' && onOpenPanel && <button type="button" className="inc-button" onClick={() => onOpenPanel('incorporaciones')}>Revisar cola</button>}
      </li>)}</ul>}
      {events.length > 0 && <details className="pd-sup-feed"><summary>Actividad reciente · {events.length}</summary><ol>{events.map((event, index) => { const item = traceEventView(event); return <li key={item.id || index}><span>{item.text || item.label}</span><small>{agoLabel(item.at, now)}</small></li>; })}</ol></details>}
    </>}
  </section>;
}

function ContextBlock({ title, block }) {
  return <div className="pd-agent-block"><strong>{title}</strong>
    {block.available
      ? <>{block.source && <small>Fuente: {block.source}</small>}
        {block.text ? <details><summary>Ver texto{block.size ? ` · ${block.size} caracteres` : ''}</summary><pre className="pc-subagent-prompt">{block.text}</pre></details> : <small>Disponible; el registro no incluye el texto.</small>}</>
      : <small>No disponible · {block.reason}</small>}
  </div>;
}

function AgentDetail({ workspace, api, connected, id, tree, onBack, onSelect }) {
  const detail = useAgentDetail({ api, workspaceId: workspace.id, id, connected });
  const now = useClock();
  const back = useRef(null);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, []);
  const byId = useMemo(() => new Map(tree.rows.map(row => [row.id, row.agent])), [tree]);
  const source = detail.agent || byId.get(id) || null;
  const view = source ? traceView(source, now) : null;
  const result = source ? traceResult(source, detail.events) : null;
  const children = tree.rows.filter(row => row.depth > 0 && row.agent.parentId === id);
  const parent = view?.parentId ? byId.get(view.parentId) : null;
  const unavailable = view?.unavailable || (detail.availability?.available === false ? detail.availability.reason || 'El historial de este agente no está disponible.' : '');
  return <section className="pd-agent" aria-label={`Detalle de ${view?.name || 'agente'}`} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && event.target.tagName !== 'SELECT') { event.preventDefault(); event.stopPropagation(); onBack(); } }}>
    <div className="pd-agent-bar">
      <button type="button" ref={back} className="inc-button is-quiet" onClick={onBack} title="Volver · Esc"><ArrowLeft size={15} aria-hidden="true" />Volver</button>
      <select className="pd-agent-select" aria-label="Elegir agente" value={id} onChange={event => onSelect(event.target.value)}>
        {!byId.has(id) && <option value={id}>{view?.name || 'Agente'}</option>}
        {tree.rows.map(row => <option key={row.id} value={row.id}>{'– '.repeat(row.depth)}{traceView(row.agent, now).name}</option>)}
      </select>
    </div>
    <TraceNotice resource={detail} noun="el agente" />
    {unavailable && <p className="tw-muted" role="status">{unavailable}</p>}
    {view && <>
      <header className="pd-agent-head" data-tone={view.status.tone}>
        <strong>{view.name}</strong>
        <small>{view.kindLabel} · {view.status.label}</small>
      </header>
      <dl className="pd-agent-facts">
        <div><dt>Estado</dt><dd>{view.status.label}</dd></div>
        <div><dt>Actividad actual</dt><dd>{view.activity || 'Sin actividad registrada'}</dd></div>
        <div><dt>Tiempo</dt><dd>{view.elapsed || 'No disponible'}</dd></div>
        <div><dt>Última actualización</dt><dd>{view.updated || 'No disponible'}</dd></div>
        <div><dt>Modelo</dt><dd>{view.model.text}{view.model.known && view.model.source ? ` · ${view.model.source}` : ''}</dd></div>
        {view.provider && <div><dt>Proveedor</dt><dd>{view.provider}</dd></div>}
        <div><dt>Padre</dt><dd>{view.parentId ? parent ? <button type="button" className="pd-agent-link" onClick={() => onSelect(view.parentId)}>{traceView(parent, now).name}</button> : <>No listado <code>{short(view.parentId)}</code></> : view.kind === 'root' ? 'Ninguno · agente raíz' : 'Sin padre registrado'}</dd></div>
        {view.taskId && <div><dt>Encargo</dt><dd><code>{view.taskId}</code></dd></div>}
        {view.runId && <div><dt>Ejecución</dt><dd><code>{view.runId}</code></dd></div>}
      </dl>
      {children.length > 0 && <div className="pd-agent-block"><strong>Subagentes y ejecuciones</strong><ul className="pd-agent-children">{children.map(row => <li key={row.id}><button type="button" className="pd-agent-link" onClick={() => onSelect(row.id)}>{traceView(row.agent, now).name}</button><small>{traceView(row.agent, now).kindLabel} · {traceView(row.agent, now).status.label}</small></li>)}</ul></div>}
      <section className="pd-agent-section" aria-label="Contexto">
        <h3>Contexto disponible</h3>
        <ContextBlock title="Instrucciones" block={view.context.instructions} />
        <ContextBlock title="Encargo" block={view.context.assignment} />
        <div className="pd-agent-block"><strong>Tokens medidos</strong>
          {view.context.tokens.available
            ? <><small>{view.context.tokens.fields.map(field => `${field.label} ${formatTokens(field.amount)}`).join(' · ')}</small>{view.context.tokens.source && <small>Fuente: {view.context.tokens.source}</small>}</>
            : <small>No disponible · {view.context.tokens.reason}</small>}
        </div>
      </section>
      <section className="pd-agent-section" aria-label="Historial">
        <h3>Historial</h3>
        {detail.events.length === 0 && (detail.status === 'ready' || detail.status === 'unavailable') && <p className="tw-muted">Sin eventos registrados todavía.</p>}
        {detail.events.length > 0 && <ol className="pd-agent-history" aria-label="Historial del agente">{detail.events.map((event, index) => {
          const item = traceEventView(event), owner = traceEventOwner(event, source, byId);
          return <li key={item.id || `${index}`} data-kind={item.kind || undefined}>
            <span className="pd-agent-owner" data-foreign={owner.id !== id || undefined} title={owner.id}>{owner.label}</span>
            <span className="pd-agent-event">{item.label}{item.tool ? ` · ${item.tool}` : ''}{item.status ? ` · ${item.status}` : ''}</span>
            {item.text && <span className="pd-agent-event-text">{item.text}</span>}
            {item.at && <time dateTime={item.at}>{clock(item.at)}</time>}
            {item.output && <details><summary>Salida</summary><pre className="pc-subagent-prompt">{item.output}</pre></details>}
          </li>;
        })}</ol>}
        {detail.moreError && <ErrorNotice error={detail.moreError} retry={detail.loadMore} />}
        {detail.hasMore && <button type="button" className="inc-button" disabled={detail.loadingMore || !connected} onClick={detail.loadMore}>{detail.loadingMore ? 'Cargando…' : 'Cargar más historial'}</button>}
      </section>
      <section className="pd-agent-section" aria-label="Resultado">
        <h3>Resultado</h3>
        {result.available ? <pre className="pc-subagent-prompt">{result.text}</pre> : <p className="tw-muted">{result.reason}</p>}
      </section>
    </>}
  </section>;
}

// One line about the queue and the way into it.
function QueueSummary({ workspace, api, onOpenPanel, hasOrchestrator }) {
  const { data, error, reload } = useResource(api, 'merge.status', { workspaceId: workspace.id });
  const queueKey = JSON.stringify(workspace.integration ?? null);
  useEffect(() => { reload(); }, [queueKey, reload]);
  if (!data) return error ? <ErrorNotice error={error} retry={reload} /> : <p className="tw-muted" role="status">Leyendo la cola…</p>;
  const cola = buildCola(data), { now, next, returned } = cola.counts;
  const parts = [next && `${next} en cola`, returned && `${returned} ${returned === 1 ? 'devuelta' : 'devueltas'}`].filter(Boolean);
  const title = !data.available ? data.reason || 'La cola no está disponible en esta carpeta.' : !data.enabled ? 'Integración automática apagada' : now ? cola.orchestrator : parts.length ? parts.join(' · ') : 'Nada en cola';
  return <ul className="inc-group">
    <li className="inc-item"><div className="inc-line is-setting">
      <div className="inc-main"><span className="inc-title" role="status">{title}</span>{data.available && data.enabled && now > 0 && parts.length > 0 && <span className="inc-sub">{parts.join(' · ')}</span>}</div>
      <button type="button" className="inc-button" onClick={() => onOpenPanel('incorporaciones')}>Abrir Cola</button>
    </div></li>
    {data.available && data.enabled && !hasOrchestrator && !data.orchestrator && <li className="inc-item"><div className="inc-line is-setting">
      <div className="inc-main"><span className="inc-title">Sin orquestador abierto</span></div>
      <button type="button" className="inc-button is-primary" onClick={() => onOpenPanel('terminal', { role: 'orchestrator', chat: { provider: preferredCardMode() } }, 'Orquestador')}>Abrir orquestador</button>
    </div></li>}
  </ul>;
}

function OrchestratorComposer({ workspace, api, connected, nodeId, title }) {
  const { chat, error, send } = useChat({ workspaceId: workspace.id, nodeId, provider: 'orchestrator', api, connected });
  const [draft, setDraft] = useVoiceDraft(`${workspace.id}:${nodeId}:orchestrator`);
  const [sending, setSending] = useState(false);
  const [armed, setArmed] = useState(false);
  const input = useRef(null), armedRef = useRef(false), draftRef = useRef(draft), submitRef = useRef(null);
  draftRef.current = draft;
  const arm = value => { armedRef.current = value; setArmed(value); };
  const recorderVoice = useVoiceRecorder({ api, workspaceId: workspace.id, scopeId: `phantom:${workspace.id}:orchestrator:${nodeId}`, enabled: connected, onText: text => {
    const merged = mergeDictation(draftRef.current, text), pendingSend = armedRef.current;
    arm(false); draftRef.current = merged; setDraft(merged);
    if (pendingSend) submitRef.current(merged, true);
  } });
  const voice = { ...recorderVoice, cancel: () => { arm(false); recorderVoice.cancel(); } };
  const dictating = voice.status === 'recording' || voice.status === 'transcribing', running = !!chat?.running;
  useLayoutEffect(() => { if (voice.status === 'idle' || !connected) arm(false); }, [voice.status, connected]);
  useLayoutEffect(() => { arm(false); }, [workspace.id, nodeId]);
  const preview = dictationPreview(voice, draft);
  useComposerSize(input, preview);
  const submit = async (value = draftRef.current, fromVoice = false) => {
    if (sending || !connected || !chat) return;
    if (!fromVoice) {
      const action = sendAction({ status: voice.status, draft: value, armed: armedRef.current });
      if (action === 'none') return;
      if (action === 'stop-and-send' || action === 'await-voice') { arm(true); if (action === 'stop-and-send') voice.stop(); return; }
      if (voice.status !== 'idle') voice.cancel();
    }
    const text = value.trim();
    if (!text) return;
    setSending(true);
    try { await send(text); setDraft(''); } catch { /* Shown inline by the hook. */ }
    finally { setSending(false); }
  };
  submitRef.current = submit;
  return <form className="pd-composer pc-composer" data-dictating={voice.status !== 'idle' || undefined} onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Escape' && voice.status !== 'idle') { e.preventDefault(); e.stopPropagation(); voice.cancel(); } }}>
    {error && <p className="pc-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{error}</span></p>}
    {voice.error && <p className="pc-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{voice.error}</span><button type="button" className="pc-icon" aria-label="Descartar aviso de voz" onClick={voice.clearError}><X size={13} /></button></p>}
    <div className="pd-field pc-field">
      <div className="pc-input" data-preview={voice.status !== 'idle' || undefined}><VoiceTranscript voice={voice} draft={draft} /><textarea ref={input} rows={1} value={preview} readOnly={voice.status !== 'idle'} disabled={!connected} aria-label={`Mensaje para ${title}`} placeholder={running ? `${title} está trabajando · lo que envíes queda en espera` : `Indica algo a ${title}…`} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} /></div>
      <div className="pc-controls"><VoiceActivity voice={voice} onFinish={() => submit()} finishLabel="Terminar dictado y enviar · Enter" />
        {voice.status === 'idle' && <button type="button" className="phantom-chat-mic" disabled={!connected || voice.busyElsewhere} title={voice.busyElsewhere ? 'Otro dictado en curso: detén o cancela su audio' : 'Dictar al orquestador'} aria-label="Dictar al orquestador" onClick={voice.start}><Mic size={18} /></button>}
        <button type="submit" className="pc-send" title={dictating ? 'Terminar dictado y enviar · Enter' : 'Enviar · Enter'} aria-label={dictating ? 'Terminar dictado' : `Enviar mensaje a ${title}`} aria-busy={armed} disabled={!canSubmit({ status: voice.status, draft, armed, sending, connected, ready: !!chat })}><ArrowUp size={18} /></button>
      </div>
    </div>
  </form>;
}
