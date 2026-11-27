// Cliente del stream phantom.task.activity del harness (`phantom mcp`, JSON-RPC por líneas).
// Entrega al menos una vez: deduplica por eventId y persiste {cursor, seen} tras cada lote.
import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

const EXTENSION = 'io.modelcontextprotocol/events';
const EVENT_NAME = 'phantom.task.activity';
const SEEN_LIMIT = 500;
const MAX_LINE = 1024 * 1024;
const MISSED_HEARTBEATS = 3;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const invalidCursor = (error) => {
  if (!error) return false;
  const text = typeof error === 'string' ? error : `${error.code ?? ''} ${error.message ?? ''} ${error.data?.code ?? ''} ${error.data?.reason ?? ''}`;
  return /invalid_cursor/i.test(text);
};

function loadState(path) {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const cursor = typeof raw?.cursor === 'string' ? raw.cursor : null;
    const seen = Array.isArray(raw?.seen) ? raw.seen.filter((id) => typeof id === 'string').slice(-SEEN_LIMIT) : [];
    return { cursor, seen };
  } catch { return { cursor: null, seen: [] }; }
}

function saveState(path, state) {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, path);
  } catch (error) {
    try { unlinkSync(tmp); } catch {}
    throw error;
  }
}

export function createTaskActivityClient({
  spawn = nodeSpawn, command = 'phantom', args = [], workspace, statePath, onEvent, onState,
  now = Date.now, backoff = {},
} = {}) {
  if (typeof onEvent !== 'function') throw new TypeError('onEvent es obligatorio');
  if (!workspace) throw new TypeError('workspace es obligatorio');
  if (!statePath) throw new TypeError('statePath es obligatorio');
  const baseMs = backoff.baseMs ?? 500, maxMs = backoff.maxMs ?? 30000;
  const jitter = backoff.jitter ?? Math.random;

  const persisted = loadState(statePath);
  let cursor = persisted.cursor;
  const seenList = persisted.seen.slice();
  const seen = new Set(seenList);
  let state = 'idle', lastEventAt = null, reconnects = 0, delivered = 0, duplicates = 0;
  let conn = null, timer = null, attempt = 0, stopped = true, generation = 0, truncatedNext = false;

  const emitState = (next, extra = {}) => {
    state = next;
    try { onState?.({ state: next, cursor, ...extra }); } catch {}
  };
  const persist = () => { try { saveState(statePath, { cursor, seen: seenList.slice() }); } catch {} };
  const remember = (id) => {
    seen.add(id); seenList.push(id);
    while (seenList.length > SEEN_LIMIT) seen.delete(seenList.shift());
  };

  function schedule(immediate = false) {
    if (stopped || timer) return;
    const cap = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30));
    const delay = immediate ? 0 : Math.round(cap * (0.5 + 0.5 * Math.min(1, Math.max(0, jitter()))));
    if (!immediate) attempt++;
    reconnects++;
    emitState('reconnecting', { delayMs: delay });
    timer = setTimeout(() => { timer = null; connect(); }, delay);
  }

  function closeConn(c, { reconnect, immediate = false } = {}) {
    if (c.closed) return;
    c.closed = true;
    clearTimeout(c.watchdog);
    try { c.proc.kill(); } catch {}
    if (reconnect && c.gen === generation) schedule(immediate);
  }

  function connect() {
    if (stopped) return;
    const gen = generation;
    let proc;
    emitState('connecting');
    try { proc = spawn(command, args, { stdio: 'pipe' }); } catch (error) {
      conn = { closed: true, gen };
      schedule();
      return;
    }
    const c = conn = { proc, gen, closed: false, nextId: 1, pending: new Map(), streamId: null, heartbeatMs: 0, watchdog: null, buffer: '', chain: Promise.resolve() };
    const send = (message) => {
      try { proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`); } catch {}
    };
    const request = (method, params) => new Promise((resolve) => {
      const id = c.nextId++;
      c.pending.set(id, resolve);
      send({ id, method, params });
    });
    c.send = send;
    proc.stdin?.on?.('error', () => {});
    proc.stderr?.on?.('data', () => {});
    proc.on('error', () => closeConn(c, { reconnect: true }));
    proc.on('close', () => closeConn(c, { reconnect: true }));
    proc.stdout.on('data', (chunk) => {
      if (c.closed) return;
      c.buffer += chunk.toString('utf8');
      const lines = c.buffer.split('\n');
      c.buffer = lines.pop();
      if (c.buffer.length > MAX_LINE) c.buffer = '';
      if (!lines.length) { armWatchdog(c); return; }
      c.chain = c.chain.then(() => handleLines(c, lines)).catch(() => {});
    });
    handshake(c, request).catch(() => closeConn(c, { reconnect: true }));
  }

  function armWatchdog(c) {
    clearTimeout(c.watchdog);
    if (!c.heartbeatMs || c.closed) return;
    c.watchdog = setTimeout(() => closeConn(c, { reconnect: true }), c.heartbeatMs * MISSED_HEARTBEATS);
  }

  async function handshake(c, request) {
    let res = await request('server/discover', {});
    if (res.error || !isObject(res.result)) {
      if (c.closed) return;
      res = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'phantom-workspace-task-activity', version: '1' } });
      if (res.error || !isObject(res.result)) throw new Error('initialize falló');
      c.send({ method: 'notifications/initialized' });
    }
    if (c.closed) return;
    const ext = res.result.capabilities?.extensions?.[EXTENSION];
    if (!ext) {
      stopped = true; generation++;
      closeConn(c, {});
      emitState('unsupported', { reason: `El harness no anuncia ${EXTENSION}` });
      return;
    }
    const truncated = truncatedNext; truncatedNext = false;
    c.truncated = truncated;
    c.streamId = c.nextId++;
    c.send({ id: c.streamId, method: 'events/stream', params: { name: EVENT_NAME, arguments: { workspace, includeChildren: true }, cursor } });
    c.pending.set(c.streamId, (msg) => {
      if (c.closed) return;
      if (msg.error && invalidCursor(msg.error)) return resetCursor(c);
      closeConn(c, { reconnect: true });
    });
    armWatchdog(c);
  }

  function resetCursor(c) {
    cursor = null; truncatedNext = true;
    persist();
    closeConn(c, { reconnect: true, immediate: true });
  }

  async function handleLines(c, lines) {
    let dirty = false;
    for (const line of lines) {
      if (c.closed) break;
      const text = line.trim();
      if (!text) continue;
      let msg;
      try { msg = JSON.parse(text); } catch { continue; }
      if (!isObject(msg)) continue;
      armWatchdog(c);
      if (msg.id !== undefined && !msg.method) {
        const done = c.pending.get(msg.id);
        if (done) { c.pending.delete(msg.id); done(msg); }
        continue;
      }
      const p = isObject(msg.params) ? msg.params : {};
      switch (msg.method) {
        case 'notifications/events/active':
          if (typeof p.cursor === 'string') { cursor = p.cursor; dirty = true; }
          if (Number.isFinite(p.heartbeatMs) && p.heartbeatMs > 0) c.heartbeatMs = p.heartbeatMs;
          attempt = 0;
          armWatchdog(c);
          emitState('streaming', (p.truncated || c.truncated) ? { truncated: true } : {});
          c.truncated = false;
          break;
        case 'notifications/events/heartbeat':
          if (typeof p.cursor === 'string') { cursor = p.cursor; dirty = true; }
          break;
        case 'notifications/events/event': {
          const id = typeof p.eventId === 'string' ? p.eventId : null;
          if (!id) break;
          if (seen.has(id)) {
            duplicates++;
            if (typeof p.cursor === 'string') { cursor = p.cursor; dirty = true; }
            break;
          }
          const data = isObject(p.data) ? p.data : {};
          try {
            await onEvent({
              eventId: id, timestamp: p.timestamp, taskId: data.taskId, runId: data.runId,
              parentTaskId: data.parentTaskId, type: data.type, payload: data.payload,
            });
          } catch {
            if (dirty) persist();
            closeConn(c, { reconnect: true });
            return;
          }
          remember(id); delivered++; lastEventAt = now();
          if (typeof p.cursor === 'string') cursor = p.cursor;
          dirty = true;
          break;
        }
        case 'notifications/events/terminated':
          if (dirty) persist();
          if (invalidCursor(p.error)) return resetCursor(c);
          closeConn(c, { reconnect: true });
          return;
        default: break;
      }
    }
    if (dirty) persist();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false; attempt = 0; generation++;
      connect();
    },
    stop() {
      if (stopped && !conn) { emitState('stopped'); return; }
      stopped = true; generation++;
      clearTimeout(timer); timer = null;
      const c = conn;
      if (c && !c.closed) {
        if (c.streamId != null) c.send?.({ method: 'notifications/cancelled', params: { requestId: c.streamId } });
        closeConn(c, {});
      }
      conn = null;
      emitState('stopped');
    },
    status() { return { state, cursor, lastEventAt, reconnects, delivered, duplicates }; },
  };
}
