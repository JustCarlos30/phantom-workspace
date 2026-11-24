/*
 * Modelo puro de eventos de actividad del workspace (sin dependencias de host ni React).
 *
 * CONTRATO
 * - Socket del host: método EVENTS_METHOD con params {principal, cursor?, workspaceId?}
 *   y respuesta {events, cursor, truncated}.
 * - Tipo de evento MCP (io.modelcontextprotocol/events): EVENT_NAME.
 * - Entidades separadas: ENTITY.terminal (TERMINAL_STATUSES) y ENTITY.card (CARD_STATUSES).
 *   Una card con parentId es "hija"; sin parentId es "raíz".
 * - Audiencias:
 *   · 'owner': eventos de cards hijas (transiciones y stalled). Solo los ve la terminal
 *     dueña (ownerNodeId propio o, si falta, el del padre). Se filtran con ownerNodeIds.
 *   · 'workspace': feed global. Solo transiciones de terminales, transiciones de cards
 *     raíz, agregados del padre (progreso {done,total,blocked} solo si cambia de forma
 *     relevante: todas completadas, bloqueo 0<->>0 o cambio de cuartil; y 'blocked' del
 *     padre una sola vez nombrando a la hija) y alertas 'unattended'.
 * - Dedupe: repetir el mismo status no emite (pero cuenta como actividad).
 * - ALERTS.stalled: entidad en working sin actividad (ingest/activity) > stallMs; se emite
 *   una vez desde tick() y nueva actividad la rearma. Incluye minutesIdle.
 * - ALERTS.unattended: tras una hija en blocked/failed/completed o una raíz en blocked/review,
 *   si ni el padre ni la terminal dueña registran actividad en unattendedMs, tick() emite
 *   'unattended' (audience workspace) con suggestedAction de un catálogo cerrado
 *   (SUGGESTED_ACTIONS): 'unblock' (blocked/failed), 'review-integration' (raíz en review),
 *   'resume-parent' (hija completed y padre quieto). suggestedAction es dato, no comando.
 * - Payload mínimo y no confiable: {eventId, seq, cursor, workspaceId, kind, entityId,
 *   status|alert, previous, audience, at (ISO), title (≤120), reason? (≤200), progress?,
 *   ownerNodeId?, parentId?, suggestedAction?, minutesIdle?}. Los textos se sanean (sin
 *   controles, backticks, '<...>', '[[...]]' ni rutas absolutas) y se recortan.
 * - Cursor opaco: codifica seq. since(cursor, {workspaceIds?, ownerNodeIds?, audiences?})
 *   devuelve {events, cursor, truncated}. cursor null = desde ahora (sin replay).
 *   truncated=true si el buffer circular perdió eventos posteriores al cursor o el cursor
 *   es inválido (el cliente debe resincronizar). Eventos 'owner' solo pasan si su
 *   ownerNodeId está en ownerNodeIds (denegado por defecto).
 */

export const EVENTS_METHOD = 'workspace.events';
export const EVENT_NAME = 'phantom.workspace.activity';
export const ENTITY = Object.freeze({ terminal: 'terminal', card: 'card' });
export const TERMINAL_STATUSES = Object.freeze(['idle', 'working', 'blocked', 'review']);
export const CARD_STATUSES = Object.freeze(['working', 'blocked', 'review', 'completed', 'failed']);
export const ALERTS = Object.freeze({ stalled: 'stalled', unattended: 'unattended' });
export const AUDIENCE = Object.freeze({ owner: 'owner', workspace: 'workspace' });
export const SUGGESTED_ACTIONS = Object.freeze(['review-integration', 'unblock', 'resume-parent']);

const ID_RE = /^[\w.:@-]{1,200}$/;

function clean(value, max) {
  if (typeof value !== 'string') return '';
  let s = value.replace(/\p{Cc}/gu, ' ').replace(/`/g, '');
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^<>]*>/g, '').replace(/\[\[[^\][]*\]\]/g, '');
  } while (s !== prev);
  s = s.replace(/[<>]/g, '').replace(/\[\[|\]\]/g, '');
  s = s.replace(/(^|\s)(?:~[\\/]|\/|[A-Za-z]:[\\/])\S*/g, '$1(ruta)');
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

const validId = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : null);
const statusesFor = (kind) => (kind === ENTITY.terminal ? TERMINAL_STATUSES : kind === ENTITY.card ? CARD_STATUSES : null);
const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const key = (w, k, e) => `${w}\u0000${k}\u0000${e}`;
const encodeCursor = (seq) => Buffer.from(`pw1:${seq}`).toString('base64url');
function decodeCursor(c) {
  if (typeof c !== 'string') return null;
  const m = /^pw1:(\d+)$/.exec(Buffer.from(c, 'base64url').toString('utf8'));
  return m ? Number(m[1]) : null;
}
const step = (done, total) => (total > 0 ? Math.floor((done * 4) / total) : 0);

export function createWorkspaceEvents({ stallMs = 240000, unattendedMs = 240000, now = Date.now, limit = 1000 } = {}) {
  const config = { stallMs: positive(stallMs) ?? 240000, unattendedMs: positive(unattendedMs) ?? 240000 };
  const cap = Math.max(1, Math.floor(positive(limit) ?? 1000));
  const entities = new Map();
  const groups = new Map();
  let buffer = [];
  let seq = 0;

  const isChild = (e) => e.kind === ENTITY.card && !!e.parentId;
  const parentOf = (e) => (isChild(e) ? entities.get(key(e.workspaceId, ENTITY.card, e.parentId)) : undefined);
  const ownerIdOf = (e) => e.ownerNodeId || parentOf(e)?.ownerNodeId || null;

  function emit(fields) {
    seq += 1;
    const base = {
      eventId: `${fields.workspaceId}:${fields.kind}:${fields.entityId}:${fields.status ?? fields.alert}:${seq}`,
      seq,
      cursor: encodeCursor(seq),
    };
    const ev = { ...base };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) ev[k] = v;
    if (!('previous' in ev)) ev.previous = null;
    buffer.push(ev);
    if (buffer.length > cap) buffer = buffer.slice(buffer.length - cap);
    return ev;
  }

  function entityEvent(e, extra) {
    return emit({
      workspaceId: e.workspaceId,
      kind: e.kind,
      entityId: e.entityId,
      title: clean(e.title, 120) || e.entityId.slice(0, 120),
      ownerNodeId: ownerIdOf(e) ?? undefined,
      parentId: e.parentId ?? undefined,
      ...extra,
    });
  }

  function aggregate(child, out) {
    const gkey = key(child.workspaceId, ENTITY.card, child.parentId);
    const g = groups.get(gkey) ?? { progress: null, blockedAnnounced: false };
    groups.set(gkey, g);
    let total = 0;
    let done = 0;
    let blocked = 0;
    for (const x of entities.values()) {
      if (x.kind !== ENTITY.card || x.workspaceId !== child.workspaceId || x.parentId !== child.parentId) continue;
      total += 1;
      if (x.status === 'completed') done += 1;
      if (x.status === 'blocked') blocked += 1;
    }
    const progress = { done, total, blocked };
    if (blocked === 0) g.blockedAnnounced = false;
    const parent = entities.get(gkey) ?? {
      workspaceId: child.workspaceId,
      kind: ENTITY.card,
      entityId: child.parentId,
      title: '',
      status: null,
      ownerNodeId: child.ownerNodeId,
    };
    const parentStatus = parent.status ?? 'working';
    if (child.status === 'blocked' && !g.blockedAnnounced) {
      g.blockedAnnounced = true;
      g.progress = progress;
      out.push(entityEvent({ ...parent, parentId: null }, {
        status: 'blocked',
        previous: parent.status,
        audience: AUDIENCE.workspace,
        reason: clean(`Hija bloqueada: ${child.title || child.entityId}`, 200),
        progress,
        at: new Date(now()).toISOString(),
      }));
      return;
    }
    const prev = g.progress ?? { done: 0, total, blocked: 0 };
    const relevant =
      (done === total && done !== prev.done) ||
      (blocked > 0) !== (prev.blocked > 0) ||
      step(done, total) !== step(prev.done, prev.total);
    if (!relevant) return;
    g.progress = progress;
    out.push(entityEvent({ ...parent, parentId: null }, {
      status: parentStatus,
      previous: parentStatus,
      audience: AUDIENCE.workspace,
      progress,
      at: new Date(now()).toISOString(),
    }));
  }

  function ingest(raw) {
    try {
      if (!raw || typeof raw !== 'object') return [];
      const workspaceId = validId(raw.workspaceId);
      const entityId = validId(raw.entityId);
      const statuses = statusesFor(raw.kind);
      if (!workspaceId || !entityId || !statuses || !statuses.includes(raw.status)) return [];
      const kind = raw.kind;
      const k = key(workspaceId, kind, entityId);
      let e = entities.get(k);
      if (!e) {
        e = { workspaceId, kind, entityId, status: null, title: '', parentId: null, ownerNodeId: null, lastActivity: 0, stalled: false, pending: null };
        entities.set(k, e);
      }
      const t = now();
      e.lastActivity = t;
      e.stalled = false;
      if (typeof raw.title === 'string') e.title = clean(raw.title, 120);
      if (kind === ENTITY.card && raw.parentId !== undefined) e.parentId = validId(raw.parentId) && raw.parentId !== entityId ? raw.parentId : null;
      if (raw.ownerNodeId !== undefined) e.ownerNodeId = validId(raw.ownerNodeId);
      if (e.status === raw.status) return [];
      const previous = e.status;
      e.status = raw.status;
      const parsed = raw.at == null ? NaN : new Date(raw.at).getTime();
      const at = new Date(Number.isFinite(parsed) ? parsed : t).toISOString();
      const child = isChild(e);
      e.pending = null;
      if (child && ['blocked', 'failed', 'completed'].includes(e.status)) {
        e.pending = { at: t, action: e.status === 'completed' ? 'resume-parent' : 'unblock' };
      } else if (kind === ENTITY.card && !child && ['blocked', 'review'].includes(e.status)) {
        e.pending = { at: t, action: e.status === 'review' ? 'review-integration' : 'unblock' };
      }
      const out = [
        entityEvent(e, {
          status: e.status,
          previous,
          audience: child ? AUDIENCE.owner : AUDIENCE.workspace,
          reason: clean(raw.reason, 200) || undefined,
          at,
        }),
      ];
      if (child) aggregate(e, out);
      return out;
    } catch {
      return [];
    }
  }

  function activity(ref) {
    if (!ref || typeof ref !== 'object') return [];
    const e = entities.get(key(ref.workspaceId, ref.kind, ref.entityId));
    if (e) {
      e.lastActivity = now();
      e.stalled = false;
    }
    return [];
  }

  function tick() {
    const t = now();
    const out = [];
    for (const e of [...entities.values()]) {
      const at = new Date(t).toISOString();
      if (e.status === 'working' && !e.stalled && t - e.lastActivity > config.stallMs) {
        e.stalled = true;
        out.push(entityEvent(e, {
          alert: ALERTS.stalled,
          audience: isChild(e) ? AUDIENCE.owner : AUDIENCE.workspace,
          minutesIdle: Math.floor((t - e.lastActivity) / 60000),
          at,
        }));
      }
      if (e.pending) {
        const parent = parentOf(e);
        const ownerId = ownerIdOf(e);
        const owner = ownerId ? entities.get(key(e.workspaceId, ENTITY.terminal, ownerId)) : undefined;
        const last = Math.max(e.pending.at, parent?.lastActivity ?? 0, owner?.lastActivity ?? 0);
        if (t - last > config.unattendedMs) {
          const suggestedAction = e.pending.action;
          e.pending = null;
          out.push(entityEvent(e, {
            alert: ALERTS.unattended,
            audience: AUDIENCE.workspace,
            suggestedAction,
            reason: `Estado ${e.status} sin atender`,
            at,
          }));
        }
      }
    }
    return out;
  }

  function since(cursor, filter = {}) {
    const current = encodeCursor(seq);
    if (cursor == null) return { events: [], cursor: current, truncated: false };
    const s = decodeCursor(cursor);
    if (s == null || s > seq) return { events: [], cursor: current, truncated: true };
    const truncated = buffer.length ? buffer[0].seq > s + 1 : seq > s;
    const { workspaceIds, ownerNodeIds, audiences } = filter || {};
    const events = buffer.filter((ev) => {
      if (ev.seq <= s) return false;
      if (Array.isArray(workspaceIds) && !workspaceIds.includes(ev.workspaceId)) return false;
      if (Array.isArray(audiences) && !audiences.includes(ev.audience)) return false;
      if (ev.audience === AUDIENCE.owner && !(Array.isArray(ownerNodeIds) && ev.ownerNodeId && ownerNodeIds.includes(ev.ownerNodeId))) return false;
      return true;
    });
    return { events, cursor: current, truncated };
  }

  function configure(next = {}) {
    const a = positive(next?.stallMs);
    const b = positive(next?.unattendedMs);
    if (a) config.stallMs = a;
    if (b) config.unattendedMs = b;
    return { ...config };
  }

  function snapshot() {
    return {
      seq,
      cursor: encodeCursor(seq),
      config: { ...config },
      entities: [...entities.values()].map(({ workspaceId, kind, entityId, status, title, parentId, ownerNodeId, lastActivity }) => ({
        workspaceId, kind, entityId, status, title, parentId, ownerNodeId, lastActivity,
      })),
    };
  }

  return { ingest, activity, tick, since, configure, snapshot };
}
