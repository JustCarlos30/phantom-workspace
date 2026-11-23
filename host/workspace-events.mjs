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
