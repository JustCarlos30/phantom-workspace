import { createWorkspaceEvents, ENTITY, EVENTS_METHOD } from '../shared/workspace-events.mjs';

export { EVENTS_METHOD };

export const FORBIDDEN_CODE = -32020;
export const MAX_EVENTS_PER_RESPONSE = 100;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 1000;

const CARD_STATUS = { running: 'working', completed: 'review', failed: 'failed' };
const str = (v) => (typeof v === 'string' && v ? v : undefined);

export function forbidden(message = 'Forbidden') {
  const error = new Error(message);
  error.code = FORBIDDEN_CODE;
  return error;
}

/** Pure mapping of a host event to model input: { raws, activities }. nodeOf(sessionId) -> nodeId. */
export function adaptHostEvent(event, nodeOf = () => undefined) {
  const out = { raws: [], activities: [] };
  if (!event || typeof event !== 'object') return out;
  const workspaceId = event.workspaceId;
  if (event.type === 'tool.status') {
    const r = event.result;
    const status = CARD_STATUS[event.status];
    if (r?.source === 'phantom' && str(r.taskId) && status) {
      out.raws.push({
        workspaceId,
        kind: ENTITY.card,
        entityId: r.taskId,
        status,
        title: str(r.title) ?? str(r.goal) ?? str(event.title) ?? r.taskId,
        ownerNodeId: str(r.origin?.nodeId),
        parentId: str(r.parentTaskId) ?? str(r.parentId) ?? str(r.parent?.taskId) ?? undefined,
        reason: event.status === 'failed' ? str(r.error) ?? str(event.error) : undefined,
      });
    }
  } else if (event.type === 'quota.queue') {
    const status = { waiting: 'blocked', rerouted: 'working', resumed: 'working' }[event.state];
    if (status && str(event.taskId)) {
      const label = (v) => (typeof v === 'string' ? v : [v?.client, v?.model].filter(Boolean).join('/'));
      const detail = { waiting: `En cola por cuota hasta ${str(event.notBefore) ?? 'nueva orden'}`, rerouted: `Redirigida a ${label(event.to) || 'otro motor'}`, resumed: 'Reanudada tras la cola de cuota' }[event.state];
      out.raws.push({ workspaceId, kind: ENTITY.card, entityId: event.taskId, status, reason: detail });
    }
  } else if (event.type === 'terminal.exit') {
    const nodeId = nodeOf(event.sessionId);
    if (nodeId) out.raws.push({ workspaceId, kind: ENTITY.terminal, entityId: nodeId, status: 'idle' });
  } else if (event.type === 'terminal.output' || event.type === 'terminal.setup') {
    const nodeId = nodeOf(event.sessionId);
    if (nodeId) out.activities.push({ workspaceId, kind: ENTITY.terminal, entityId: nodeId });
  }
  return out;
}

/** Maps the merged agent record of a terminal (after terminal.agent.report) to model input. */
export function adaptAgentReport({ workspaceId, nodeId, agent }) {
  if (!nodeId || !agent || typeof agent.status !== 'string') return null;
  return { workspaceId, kind: ENTITY.terminal, entityId: nodeId, status: agent.status, title: str(agent.step) ?? nodeId };
}

/**
 * Resolves who is asking and what they may see. Re-evaluated on every call.
 * lookup: { session(id) -> session|undefined, workspaces() -> workspace[] }
 */
export function authorize(principal, request = {}, lookup) {
  const sessionId = principal?.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) throw forbidden();
  let session;
  try { session = lookup.session(sessionId); } catch { session = undefined; }
  if (!session || session.status !== 'running') throw forbidden();
  const workspaces = lookup.workspaces() ?? [];
  const own = workspaces.find((w) => w.id === session.workspaceId);
  const node = own?.nodes?.find((n) => n.id === session.nodeId && n.type === 'terminal');
  if (!own || !node || node.data?.sessionId !== session.id) throw forbidden();
  const orchestrator = node.data?.role === 'orchestrator';
  let workspaceIds = orchestrator
    ? workspaces.filter((w) => w.id === own.id || (w.integration?.enabled && !w.hidden && !w.archived)).map((w) => w.id)
    : [own.id];
  const wanted = request?.workspaceId;
  if (wanted !== undefined && wanted !== null) {
    if (typeof wanted !== 'string' || !workspaceIds.includes(wanted)) throw forbidden();
    workspaceIds = [wanted];
  }
  return { workspaceIds, ownerNodeIds: [node.id], audiences: ['workspace', 'owner'], role: orchestrator ? 'orchestrator' : 'worker' };
}

// --- Observabilidad de agentes: validación de RPC, permisos y saneado de registros -------------------------------
// Los RPC del renderer (agent.traces.*, supervisor.*) y los de agentes (terminal.agent.trace[s]) comparten estos
// validadores, pero nunca la superficie: el renderer nombra el workspace; un agente solo existe por su sesión PTY vigente.
export const TRACE_RENDERER_METHODS = Object.freeze(['agent.traces.list', 'agent.traces.detail', 'supervisor.read', 'supervisor.configure', 'supervisor.refresh']);
export const TRACE_AGENT_METHODS = Object.freeze(['terminal.agent.trace', 'terminal.agent.traces']);
export const TRACE_MAX_RECORDS = 50;
export const TRACE_MAX_BYTES = 256 * 1024;
const TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,199}$/;
const TRACE_PROVIDERS = new Set(['claude', 'codex', 'opencode']);
const RECORD_KEYS = new Set(['id', 'parentId', 'provider', 'name', 'model', 'modelSource', 'status', 'context', 'event', 'providerAgentId', 'matchOnly', 'parent', 'workspaceId', 'nodeId', 'taskId', 'runId']);
const refuse = (message) => { throw new Error(message); };
const plainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function traceId(value, name) {
  if (typeof value !== 'string' || !TRACE_ID.test(value)) refuse(`${name} no válido`);
  return value;
}

/** Parámetros exactos de un RPC de observabilidad; cualquier clave extra o fuera de rango se rechaza. */
export function traceParams(method, payload) {
  if (!plainObject(payload)) refuse('Parámetros no válidos');
  const allowed = {
    'agent.traces.list': ['workspaceId', 'nodeId'],
    'agent.traces.detail': ['workspaceId', 'id', 'cursor', 'limit'],
    'terminal.agent.traces': ['sessionId', 'id', 'cursor', 'limit'],
    'supervisor.read': ['workspaceId'],
    'supervisor.refresh': ['workspaceId'],
    'supervisor.configure': ['workspaceId', 'patch'],
  }[method];
  if (!allowed) refuse('Método de trazas desconocido');
  for (const key of Object.keys(payload)) if (!allowed.includes(key)) refuse(`Clave no permitida: ${String(key).slice(0, 40)}`);
  const out = {};
  if (allowed.includes('sessionId')) out.sessionId = traceId(payload.sessionId, 'sessionId');
  if (allowed.includes('workspaceId')) out.workspaceId = traceId(payload.workspaceId, 'workspaceId');
  if (payload.nodeId !== undefined && payload.nodeId !== null) out.nodeId = traceId(payload.nodeId, 'nodeId');
  if (allowed.includes('id') && (method !== 'terminal.agent.traces' || payload.id !== undefined)) out.id = traceId(payload.id, 'id');
  if (payload.cursor !== undefined && payload.cursor !== null) {
    if (typeof payload.cursor !== 'string' || !/^\d{1,12}$/.test(payload.cursor)) refuse('cursor no válido');
    out.cursor = payload.cursor;
  }
  if (payload.limit !== undefined && payload.limit !== null) {
    if (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 200) refuse('limit debe ser un entero entre 1 y 200');
    out.limit = payload.limit;
  }
  if (method === 'supervisor.configure') {
    if (!plainObject(payload.patch) || Object.keys(payload.patch).length > 8) refuse('patch no válido');
    out.patch = payload.patch;
  }
  return out;
}

/** Lo que la UI lee: el total medido por el proveedor es la suma de sus campos; nunca se estima ni se hereda. */
export function publicTraceAgent(agent) {
  const tokens = agent?.context?.tokens;
  if (!tokens || tokens.available !== true || !Number.isFinite(tokens.measured)) return agent;
  return { ...agent, context: { ...agent.context, tokens: { ...tokens, total: tokens.measured } } };
}

/**
 * Qué agentes de trazas puede leer una sesión: solo con sesión PTY viva y vigente (misma regla que workspace.events).
 * Un worker lee los agentes de su propio nodo; la sesión orquestadora, los de su workspace. Nunca otros proyectos.
 */
export function authorizeTraceRead(sessionId, lookup) {
  const grant = authorize({ sessionId }, {}, lookup);
  const session = lookup.session(sessionId);
  return { workspaceId: session.workspaceId, nodeId: grant.role === 'worker' ? session.nodeId : null, role: grant.role };
}

/**
 * Registros que un hook de agente envía por su sesión: el host impone workspace y nodo de la sesión, descarta
 * taskId/runId (el agente no puede probarlos) y rechaza padres/actores que pertenezcan a otro nodo.
 * identity: { workspaceId, nodeId, taskId?, resolveAgent(id) -> {nodeId}|null }
 */
export function sanitizeTraceRecords(records, identity) {
  if (!Array.isArray(records) || records.length < 1 || records.length > TRACE_MAX_RECORDS) refuse(`Se esperan entre 1 y ${TRACE_MAX_RECORDS} registros`);
  if (JSON.stringify(records).length > TRACE_MAX_BYTES) refuse('Los registros superan el límite de tamaño');
  const local = new Map();
  const owner = (id) => local.get(id) ?? identity.resolveAgent(id);
  const foreign = (id) => { const found = owner(id); return !!found && found.nodeId !== identity.nodeId; };
  return records.map((raw) => {
    if (!plainObject(raw)) refuse('Registro no válido');
    for (const key of Object.keys(raw)) if (!RECORD_KEYS.has(key)) refuse(`Campo de registro no permitido: ${String(key).slice(0, 40)}`);
    const record = { ...raw, workspaceId: identity.workspaceId, nodeId: identity.nodeId };
    traceId(record.id, 'id');
    delete record.runId;
    if (record.taskId !== undefined && record.taskId !== null && record.taskId !== identity.taskId) delete record.taskId;
    if (record.provider !== undefined && record.provider !== null && !TRACE_PROVIDERS.has(record.provider)) refuse('Proveedor no permitido');
    for (const key of ['parentId', 'providerAgentId']) if (record[key] !== undefined && record[key] !== null) traceId(record[key], key);
    if (foreign(record.id)) refuse('El agente pertenece a otro nodo');
    if (record.parentId && foreign(record.parentId)) refuse('El padre pertenece a otro nodo');
    if (plainObject(record.event) && record.event.actorId !== undefined) {
      const actor = record.event.actorId;
      if (typeof actor !== 'string' || !TRACE_ID.test(actor)) refuse('actorId no válido');
      if (foreign(actor)) refuse('El actor pertenece a otro nodo');
      if (actor !== record.parentId && !owner(actor)) record.event = { ...record.event, actorId: undefined };
    }
    local.set(record.id, { nodeId: identity.nodeId });
    return record;
  });
}

export function createHostEvents({ stallMs, unattendedMs, tickMs = 30000, broadcast = () => {}, now = Date.now } = {}) {
  const model = createWorkspaceEvents({ stallMs, unattendedMs, now });
  const owned = new Map();
  const calls = new Map();

  const publish = (events) => {
    for (const event of events) {
      try { broadcast({ type: 'workspace.event', event }); } catch { /* the renderer must not break the host */ }
    }
    return events;
  };
  const ownerKey = (w, n) => `${w}\u0000${n}`;

  function ingest(raw) {
    const events = model.ingest(raw);
    if (raw?.kind === ENTITY.card && raw.ownerNodeId) {
      const k = ownerKey(raw.workspaceId, raw.ownerNodeId);
      const set = owned.get(k) ?? new Set();
      if (raw.status === 'working' || raw.status === 'blocked') set.add(raw.entityId); else set.delete(raw.entityId);
      if (set.size) owned.set(k, set); else owned.delete(k);
    }
    return publish(events);
  }

  function activity(ref) {
    model.activity(ref);
    if (ref?.kind === ENTITY.terminal) {
      for (const taskId of owned.get(ownerKey(ref.workspaceId, ref.entityId)) ?? []) {
        model.activity({ workspaceId: ref.workspaceId, kind: ENTITY.card, entityId: taskId });
      }
    }
    return [];
  }

  function feed(event, nodeOf) {
    const { raws, activities } = adaptHostEvent(event, nodeOf);
    const events = [];
    for (const raw of raws) events.push(...ingest(raw));
    for (const ref of activities) activity(ref);
    return events;
  }

  function report(info) {
    const raw = adaptAgentReport(info);
    if (!raw) return [];
    return ingest(raw);
  }

  function limit(sessionId) {
    const t = now();
    const recent = (calls.get(sessionId) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      calls.set(sessionId, recent);
      throw new Error('Demasiadas consultas de eventos; espera un momento');
    }
    recent.push(t);
    calls.set(sessionId, recent);
    if (calls.size > 500) for (const [k, v] of calls) if (!v.some((x) => t - x < RATE_WINDOW_MS)) calls.delete(k);
  }

  function query(payload, lookup) {
    const principal = payload && 'principal' in payload ? payload.principal : { sessionId: payload?.sessionId };
    const filter = authorize(principal, payload, lookup);
    limit(principal.sessionId);
    const result = model.since(payload?.cursor ?? null, filter);
    const events = result.events.slice(0, MAX_EVENTS_PER_RESPONSE);
    const cut = events.length < result.events.length;
    return { events, cursor: cut ? events[events.length - 1].cursor : result.cursor, truncated: result.truncated };
  }

  const tick = () => publish(model.tick());
  const timer = setInterval(() => { try { tick(); } catch { /* best effort */ } }, tickMs);
  timer.unref?.();

  return {
    feed,
    report,
    ingest,
    activity,
    query,
    tick,
    configure: model.configure,
    snapshot: model.snapshot,
    close() { clearInterval(timer); calls.clear(); owned.clear(); },
  };
}
