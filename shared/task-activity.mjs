/**
 * Mapeo puro de la actividad de tareas del harness (phantom.task.activity) al bus de workspace.
 *
 * apply(activityEvent, entry) -> { raw, activity }
 * - raw: entradas para hostEvents.ingest (kind 'card', entityId = taskId).
 * - activity: referencias {workspaceId, kind, entityId} para createWorkspaceEvents().activity (latido sin cambio de estado).
 * - activityEvent: {data:{taskId, runId, parentTaskId, type, payload}} (o el propio data).
 * - entry: registro conocido de la tarea {workspaceId, ownerNodeId?, parentId?, goal?}. Nunca se inventa dueño:
 *   sin ownerNodeId la hija viaja a la audiencia workspace conservando parentId.
 *
 * Los tipos son una lista cerrada (TYPE_TABLE); un tipo desconocido se ignora y se cuenta en stats().
 */

const WORKING = 'working';

export const TYPE_TABLE = Object.freeze({
  'task.created': Object.freeze({ status: WORKING, phase: 'waiting' }),
  'preflight.admitted': Object.freeze({ status: WORKING, phase: 'waiting' }),
  'run.started': Object.freeze({ status: WORKING, phase: 'waiting', newRun: true }),
  'task.running': Object.freeze({ status: WORKING, phase: 'agent', repairAfterVerification: true }),
  'task.verifying': Object.freeze({ status: WORKING, phase: 'checks' }),
  'verification.recorded': Object.freeze({ status: WORKING, phase: 'checks', markVerified: true }),
  'judge.started': Object.freeze({ status: WORKING, phase: 'judge' }),
  'judge.verdict': Object.freeze({ status: WORKING, phase: 'checks' }),
  'child.created': Object.freeze({ child: 'open' }),
  'child.started': Object.freeze({ child: 'open' }),
  'child.reused': Object.freeze({ child: 'open' }),
  'child.settled': Object.freeze({ child: 'settled' }),
  'child.delivery_accepted': Object.freeze({ child: 'done' }),
  'child.failed_local': Object.freeze({ child: 'blocked' }),
  'child.skipped': Object.freeze({ child: 'done' }),
  'task.completed': Object.freeze({ status: 'review', acceptance: true }),
  'task.blocked': Object.freeze({ status: 'blocked', reason: true }),
  'task.admission_blocked': Object.freeze({ status: 'blocked', reason: true }),
  'run.error': Object.freeze({ status: 'blocked', reason: true }),
  'coordination.failed': Object.freeze({ status: 'blocked', reason: true }),
  'recovery.unresolved': Object.freeze({ status: 'blocked', reason: true }),
  'task.cancelled': Object.freeze({ status: 'cancelled', reason: true }),
  'recovery.abandoned': Object.freeze({ status: 'cancelled', reason: true }),
  'recovery.claimed': Object.freeze({ activityOnly: true }),
  'recovery.reconciled': Object.freeze({ activityOnly: true }),
  'git.committed': Object.freeze({ activityOnly: true }),
  'integration.publication_intended': Object.freeze({ activityOnly: true }),
});

/** Tipos que solo cuentan como actividad (no cambian estado ni fase). */
export const ACTIVITY_ONLY = Object.freeze(Object.keys(TYPE_TABLE).filter((t) => TYPE_TABLE[t].activityOnly));

const CHILD_OK = new Set(['completed', 'accepted', 'done', 'passed', 'succeeded', 'success']);
const CHILD_BAD = new Set(['blocked', 'failed', 'cancelled', 'rejected', 'error']);
const ACCEPTANCE = ['accepted', 'rejected', 'not_applicable'];

const str = (v) => (typeof v === 'string' && v ? v : null);

export function createTaskProjection() {
  /** taskId -> {runId, verified, round, children: Map<key, 'open'|'done'|'blocked'>} */
  const tasks = new Map();
  const stats = { applied: 0, activityOnly: 0, unknown: 0, rejected: 0, unknownTypes: {} };

  const stateOf = (taskId) => {
    let s = tasks.get(taskId);
    if (!s) {
      s = { runId: null, verified: false, round: 0, children: new Map() };
      tasks.set(taskId, s);
    }
    return s;
  };

  function apply(activityEvent, entry) {
    const out = { raw: [], activity: [] };
    const data = activityEvent && typeof activityEvent === 'object' ? (activityEvent.data ?? activityEvent) : null;
    const type = str(data?.type);
    const taskId = str(data?.taskId);
    if (!type || !taskId) { stats.rejected += 1; return out; }
    const spec = Object.hasOwn(TYPE_TABLE, type) ? TYPE_TABLE[type] : null;
    if (!spec) {
      stats.unknown += 1;
      stats.unknownTypes[type.slice(0, 80)] = (stats.unknownTypes[type.slice(0, 80)] ?? 0) + 1;
      return out;
    }
    const workspaceId = str(entry?.workspaceId);
    if (!workspaceId) { stats.rejected += 1; return out; }
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    const ref = { workspaceId, kind: 'card', entityId: taskId };
    const at = str(activityEvent.timestamp) ?? undefined;

    const base = { ...ref, workspaceId };
    if (str(entry.ownerNodeId)) base.ownerNodeId = entry.ownerNodeId;
    if (str(entry.parentId) ?? str(data.parentTaskId)) base.parentId = str(entry.parentId) ?? str(data.parentTaskId);
    if (str(entry.goal)) { base.goal = entry.goal; base.title = entry.goal; }
    if (at) base.at = at;

    if (spec.activityOnly) {
      stats.activityOnly += 1;
      out.activity.push(ref);
      return out;
    }

    const s = stateOf(taskId);
    const runId = str(data.runId);
    if (runId && runId !== s.runId) { s.runId = runId; s.verified = false; s.round = 0; }

    if (spec.child) {
      const key = str(payload.key) ?? str(payload.taskId);
      if (!key) { stats.rejected += 1; return out; }
      let state = spec.child;
      if (state === 'settled') {
        const st = String(payload.status ?? '').toLowerCase();
        state = CHILD_OK.has(st) ? 'done' : CHILD_BAD.has(st) ? 'blocked' : 'open';
      }
      s.children.set(key, state);
      let done = 0;
      let blocked = 0;
      for (const v of s.children.values()) { if (v === 'done') done += 1; else if (v === 'blocked') blocked += 1; }
      stats.applied += 1;
      out.raw.push({
        ...base, kind: 'card', entityId: taskId, status: WORKING, phase: 'children', round: s.round,
        progress: { done, total: s.children.size, blocked },
      });
      return out;
    }

    const raw = { ...base, kind: 'card', status: spec.status };
    if (spec.phase) {
      raw.phase = spec.phase;
      if (spec.repairAfterVerification && s.verified) {
        s.round += 1;
        s.verified = false;
        raw.phase = 'repair';
      }
      if (spec.markVerified) s.verified = true;
      raw.round = s.round;
    }
    if (spec.reason) raw.reason = str(payload.reason) ?? type;
    if (spec.acceptance) {
      const a = payload.closure?.acceptance;
      if (ACCEPTANCE.includes(a)) raw.acceptance = a;
    }
    const b = payload.blocker;
    if (spec.status === 'blocked' && b && typeof b === 'object' && str(b.category) && str(b.autonomy)) {
      raw.blocker = { category: b.category, autonomy: b.autonomy };
    }
    stats.applied += 1;
    out.raw.push(raw);
    return out;
  }

  function exportState() {
    return {
      version: 1,
      tasks: [...tasks].map(([taskId, s]) => ({
        taskId, runId: s.runId, verified: s.verified, round: s.round, children: Object.fromEntries(s.children),
      })),
    };
  }

  /** Restaura desde datos no confiables: lo inválido se descarta. */
  function restoreState(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.tasks)) return false;
    tasks.clear();
    for (const t of state.tasks) {
      if (!t || typeof t !== 'object' || !str(t.taskId)) continue;
      const children = new Map();
      if (t.children && typeof t.children === 'object') {
        for (const [k, v] of Object.entries(t.children)) if (['open', 'done', 'blocked'].includes(v)) children.set(k, v);
      }
      tasks.set(t.taskId, {
        runId: str(t.runId),
        verified: t.verified === true,
        round: Number.isInteger(t.round) && t.round >= 0 ? t.round : 0,
        children,
      });
    }
    return true;
  }

  return {
    apply,
    exportState,
    restoreState,
    stats: () => ({ ...stats, unknownTypes: { ...stats.unknownTypes } }),
  };
}
