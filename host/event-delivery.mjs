/*
 * Cola durable de entrega del bus de eventos a suscriptores (terminales/chats en nombre de su sesión).
 *
 * CONTRATO
 * - createEventDelivery({file, subscribe, render, deliver, ready, now?, timers?, windowMs, maxBatch,
 *   maxQueued, rate:{max,perMs}, retryMs, escalateAfterMs}) -> {addSubscriber, removeSubscriber, has,
 *   resetLimit, flush, status, close}.
 * - isMaterial(event, sub) decide qué eventos entran a la cola de cada suscriptor.
 * - Entrega al menos una vez: el lote se persiste como inflight con key estable y se reentrega con la
 *   misma key tras reiniciar. Nada se descarta en silencio: lo descartado se cuenta en dropped.
 * - Escalado: un evento crítico sin entregar > escalateAfterMs, o cuyo suscriptor desaparece, pasa al
 *   parentId marcado {escalated:true, from}; sin padre queda en unrouted. Máximo dos niveles.
 * - Los textos de los eventos son datos no confiables: render() es responsable de sanearlos.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROLES = ['worker', 'orchestrator', 'assistant'];
const WORKER_CARD = new Set(['blocked', 'review', 'completed', 'failed', 'cancelled']);
const ORCH_CARD = new Set(['blocked', 'failed', 'review']);
const ORCH_INTEGRATION = new Set(['ready', 'conflict', 'failed', 'integrated']);
const MAX_LEVEL = 2;

export function isCritical(ev) {
  if (!ev) return false;
  if (ev.alert) return ev.alert === 'unattended' || ev.alert === 'stalled';
  if (ev.kind === 'card') return ev.status === 'blocked' || ev.status === 'failed';
  if (ev.kind === 'integration') return ev.status === 'conflict' || ev.status === 'failed';
  return false;
}

export function isMaterial(ev, sub) {
  if (!ev || typeof ev !== 'object' || !sub) return false;
  if (ev.kind === 'terminal' && ev.entityId === sub.id) return false;
  if (sub.workspaceId && ev.workspaceId && ev.workspaceId !== sub.workspaceId) return false;
  const card = ev.kind === 'card';
  const integration = ev.kind === 'integration';
  if (sub.role === 'worker') {
    if (card) {
      if (!(ev.audience === 'owner' || ev.ownerNodeId === sub.id)) return false;
      if (ev.alert) return ev.alert === 'stalled';
      return WORKER_CARD.has(ev.status) || ev.phase === 'repair';
    }
    return integration && !ev.alert && ev.ownerNodeId === sub.id;
  }
  if (sub.role === 'orchestrator') {
    if (ev.audience !== 'workspace') return false;
    if (ev.alert) return ev.alert === 'unattended';
    if (card && !ev.parentId) {
      if (ORCH_CARD.has(ev.status)) return true;
      const p = ev.progress;
      return !!p && ((p.total > 0 && p.done === p.total) || p.blocked > 0);
    }
    return integration && ORCH_INTEGRATION.has(ev.status);
  }
  if (sub.role === 'assistant') {
    if (ev.escalated) return true;
    if (ev.alert) return ev.alert === 'unattended';
    return integration && (ev.status === 'conflict' || ev.status === 'failed');
  }
  return false;
}

const entityKey = (ev) => `${ev.workspaceId}\u0000${ev.kind}\u0000${ev.entityId}`;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const blankStats = () => ({ delivered: 0, retried: 0, coalesced: 0, escalated: 0, dropped: 0, lastDeliveredAt: null });

export function createEventDelivery({
  file,
  subscribe,
  render,
  deliver,
  ready,
  now = Date.now,
  timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout },
  windowMs = 1500,
  maxBatch = 20,
  maxQueued = 200,
  rate = { max: 12, perMs: 600000 },
  retryMs = 5000,
  escalateAfterMs = 120000,
} = {}) {
  const subs = new Map();
  const wakeups = new Map();
  let unrouted = [];
  let gone = blankStats();
  let persistErrors = 0;
  let closed = false;

  function blank() {
    return { sub: null, unsub: null, queue: [], inflight: null, retryAt: 0, sent: [], busy: false, stats: blankStats() };
  }

  function persist() {
    if (!file) return;
    const data = {
      version: 1,
      unrouted,
      gone,
      subs: Object.fromEntries([...subs].map(([id, s]) => [id, { queue: s.queue, inflight: s.inflight, retryAt: s.retryAt, sent: s.sent, stats: s.stats }])),
    };
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch {
      persistErrors += 1;
      try { fs.rmSync(tmp, { force: true }); } catch { /* sin acción */ }
    }
  }

  const validEntry = (e) => e && typeof e === 'object' && e.event && typeof e.event === 'object' && typeof e.event.eventId === 'string';
  const cleanEntry = (e) => ({ event: e.event, queuedAt: num(e.queuedAt), critical: isCritical(e.event), level: Math.max(0, Math.min(MAX_LEVEL, num(e.level))), ...(e.unrouted ? { unrouted: true } : {}), ...(e.copied ? { copied: true } : {}) });

  function load() {
    if (!file) return;
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    if (!data || typeof data !== 'object' || !data.subs || typeof data.subs !== 'object') return;
    for (const [id, raw] of Object.entries(data.subs)) {
      if (!raw || typeof raw !== 'object') continue;
      const s = blank();
      s.queue = Array.isArray(raw.queue) ? raw.queue.filter(validEntry).map(cleanEntry) : [];
      const inf = raw.inflight;
      if (inf && typeof inf.key === 'string' && Array.isArray(inf.entries) && inf.entries.every(validEntry) && inf.entries.length) {
        s.inflight = { key: inf.key, entries: inf.entries.map(cleanEntry) };
      }
      s.retryAt = num(raw.retryAt);
      s.sent = Array.isArray(raw.sent) ? raw.sent.filter((x) => typeof x === 'number') : [];
      Object.assign(s.stats, Object.fromEntries(Object.keys(s.stats).map((k) => [k, k === 'lastDeliveredAt' ? (typeof raw.stats?.[k] === 'number' ? raw.stats[k] : null) : num(raw.stats?.[k])])));
      subs.set(id, s);
    }
    if (Array.isArray(data.unrouted)) unrouted = data.unrouted.filter((u) => u && typeof u === 'object' && u.event && typeof u.event === 'object').slice(-maxQueued);
    if (data.gone && typeof data.gone === 'object') for (const k of Object.keys(gone)) if (k !== 'lastDeliveredAt') gone[k] = num(data.gone[k]);
  }

  const active = (id) => { const s = subs.get(id); return s && s.sub ? s : null; };
  const has = (id) => !!active(id);
  const prune = (s) => { const t = now(); s.sent = s.sent.filter((x) => t - x < rate.perMs); };
  const throttled = (s) => { prune(s); return s.sent.length >= rate.max; };

  function schedule(id, delay) {
    if (closed) return;
    const at = now() + delay;
    const cur = wakeups.get(id);
    if (cur) {
      if (cur.at <= at) return;
      timers.clearTimeout(cur.handle);
    }
    const handle = timers.setTimeout(() => {
      wakeups.delete(id);
      run(id, false).catch(() => {});
    }, Math.max(0, delay));
    handle?.unref?.();
    wakeups.set(id, { at, handle });
  }

  function rearm(s, notReady = false) {
    if (closed || !s.sub) return;
    const t = now();
    let next = Infinity;
    for (const e of [...s.queue, ...(s.inflight?.entries ?? [])]) {
      if (e.critical && !e.unrouted && !e.copied) next = Math.min(next, e.queuedAt + escalateAfterMs + 1);
    }
    if (s.inflight || s.queue.length) {
      let at = s.inflight ? Math.max(t, s.retryAt) : s.queue[0].queuedAt + windowMs;
      if (throttled(s)) at = Math.max(at, s.sent[0] + rate.perMs);
      if (notReady) at = Math.max(at, t + retryMs);
      next = Math.min(next, at);
    }
    if (Number.isFinite(next)) schedule(s.sub.id, Math.max(0, next - t));
  }

  function addUnrouted(subId, entry) {
    unrouted.push({ subId, event: entry.event, at: now() });
    while (unrouted.length > maxQueued) { unrouted.shift(); gone.dropped += 1; }
  }

  function enqueue(s, event, level = 0) {
    const critical = isCritical(event);
    const k = entityKey(event);
    const idx = s.queue.findIndex((e) => entityKey(e.event) === k);
    if (idx >= 0) {
      s.queue[idx] = { ...s.queue[idx], event, critical, level, unrouted: undefined, copied: undefined };
      s.stats.coalesced += 1;
    } else if (s.queue.some((e) => e.event.eventId === event.eventId) || s.inflight?.entries.some((e) => e.event.eventId === event.eventId)) {
      return;
    } else {
      s.queue.push({ event, queuedAt: now(), critical, level });
    }
    while (s.queue.length > maxQueued) {
      let i = s.queue.findIndex((e) => !e.critical);
      if (i < 0) i = 0;
      s.queue.splice(i, 1);
      s.stats.dropped += 1;
    }
    persist();
    rearm(s);
  }

  function escalate(s, entry) {
    const parent = s.sub?.parentId ? active(s.sub.parentId) : null;
    if (!parent || parent === s || entry.level >= MAX_LEVEL) return false;
    enqueue(parent, { ...entry.event, escalated: true, from: s.sub.id }, entry.level + 1);
    s.stats.escalated += 1;
    return true;
  }

  function checkEscalation(s) {
    const t = now();
    let changed = false;
    const due = (e) => e.critical && !e.unrouted && !e.copied && t - e.queuedAt > escalateAfterMs;
    for (const e of s.queue.filter(due)) {
      changed = true;
      if (escalate(s, e)) s.queue.splice(s.queue.indexOf(e), 1);
      else { e.unrouted = true; addUnrouted(s.sub.id, e); }
    }
    for (const e of (s.inflight?.entries ?? []).filter(due)) {
      changed = true;
      if (!escalate(s, e)) { e.unrouted = true; addUnrouted(s.sub.id, e); }
      e.copied = true;
    }
    if (changed) persist();
  }

  function retire(s) {
    const id = s.sub.id;
    for (const e of [...(s.inflight?.entries ?? []), ...s.queue]) {
      if (!e.critical) s.stats.dropped += 1;
      else if (!e.copied && !e.unrouted && !escalate(s, e)) addUnrouted(id, e);
    }
    s.unsub?.();
    const w = wakeups.get(id);
    if (w) { timers.clearTimeout(w.handle); wakeups.delete(id); }
    for (const k of Object.keys(gone)) if (k !== 'lastDeliveredAt') gone[k] += s.stats[k];
    subs.delete(id);
    persist();
  }

  async function run(id, force) {
    const s = active(id);
    if (!s || s.busy || closed) return 'idle';
    s.busy = true;
    try {
      checkEscalation(s);
      prune(s);
      if (!s.inflight && !s.queue.length) return 'idle';
      const t = now();
      if (s.inflight ? t < s.retryAt : !force && t < s.queue[0].queuedAt + windowMs) { rearm(s); return 'wait'; }
      if (throttled(s)) { rearm(s); return 'throttled'; }
      let ok = false;
      try { ok = !!(await ready(s.sub)); } catch { ok = false; }
      if (!ok || closed || subs.get(id) !== s) { rearm(s, !ok); return 'notready'; }
      if (!s.inflight) {
        const entries = s.queue.splice(0, maxBatch);
        const key = createHash('sha256').update(JSON.stringify([s.sub.id, entries.map((e) => e.event.eventId)])).digest('hex').slice(0, 32);
        s.inflight = { key, entries };
        s.retryAt = 0;
        persist();
      }
      const { key, entries } = s.inflight;
      const events = entries.map((e) => e.event);
      let res;
      try {
        res = await deliver({ sub: s.sub, key, events, message: render({ sub: s.sub, events }) });
      } catch (err) {
        res = { retry: true, reason: String(err?.message ?? err) };
      }
      if (subs.get(id) !== s) return 'idle';
      if (res?.delivered) {
        s.stats.delivered += entries.length;
        s.stats.lastDeliveredAt = now();
        s.sent.push(now());
        s.inflight = null;
        s.retryAt = 0;
        persist();
        rearm(s);
        return 'delivered';
      }
      if (res?.gone) { retire(s); return 'gone'; }
      s.stats.retried += 1;
      s.retryAt = now() + retryMs;
      persist();
      rearm(s);
      return 'retry';
    } finally {
      s.busy = false;
    }
  }

  function onEvent(s, ev) {
    if (closed || !ev || typeof ev !== 'object' || subs.get(s.sub?.id) !== s) return;
    if (isMaterial(ev, s.sub)) { enqueue(s, ev); return; }
    // Crítico cuyo dueño no tiene suscriptor: el asistente lo recibe como escalado.
    if (s.sub.role === 'assistant' && ev.kind !== 'terminal' && isCritical(ev) && ev.ownerNodeId && ev.ownerNodeId !== s.sub.id && !has(ev.ownerNodeId)) {
      enqueue(s, { ...ev, escalated: true, from: ev.ownerNodeId }, 1);
    }
  }

  load();

  return {
    addSubscriber(sub) {
      if (closed || !sub || typeof sub.id !== 'string' || !sub.id || !ROLES.includes(sub.role)) return false;
      const s = subs.get(sub.id) ?? blank();
      s.unsub?.();
      s.sub = { ...sub };
      subs.set(sub.id, s);
      s.unsub = subscribe(sub.filter, (ev) => { try { onEvent(s, ev); } catch { /* un evento defectuoso no rompe el bus */ } });
      persist();
      rearm(s);
      return true;
    },
    removeSubscriber(id) {
      const s = active(id);
      if (!s) return false;
      retire(s);
      return true;
    },
    has,
    resetLimit(id) {
      const s = active(id);
      if (!s) return false;
      s.sent = [];
      persist();
      schedule(id, 0);
      return true;
    },
    async flush() {
      for (const id of [...subs.keys()]) {
        for (let i = 0; i < 1000; i += 1) {
          if ((await run(id, true)) !== 'delivered') break;
        }
      }
    },
    status() {
      const list = [...subs.values()].filter((s) => s.sub).map((s) => ({
        id: s.sub.id,
        role: s.sub.role,
        workspaceId: s.sub.workspaceId,
        queued: s.queue.length,
        inflight: s.inflight ? s.inflight.entries.length : 0,
        delivered: s.stats.delivered,
        retried: s.stats.retried,
        coalesced: s.stats.coalesced,
        escalated: s.stats.escalated,
        dropped: s.stats.dropped,
        throttled: throttled(s),
        lastDeliveredAt: s.stats.lastDeliveredAt,
        oldestQueuedAt: [...s.queue, ...(s.inflight?.entries ?? [])].reduce((m, e) => (m === null || e.queuedAt < m ? e.queuedAt : m), null),
      }));
      const totals = { queued: 0, inflight: 0, delivered: gone.delivered, retried: gone.retried, coalesced: gone.coalesced, escalated: gone.escalated, dropped: gone.dropped, persistErrors };
      for (const s of list) for (const k of Object.keys(totals)) if (k in s) totals[k] += s[k];
      return { subscribers: list, unrouted: unrouted.length, totals };
    },
    close() {
      closed = true;
      for (const w of wakeups.values()) timers.clearTimeout(w.handle);
      wakeups.clear();
      for (const s of subs.values()) { s.unsub?.(); s.unsub = null; }
    },
  };
}
