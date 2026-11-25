import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Durable, local history of agents (root, sub-agents) and what they did.
// Separate from the chat summary kept in chats.json: this store keeps what the
// provider actually exposed, bounded and redacted, and survives restarts.
//
// Layout (all private, 0700 dirs / 0600 files): <dataDir>/agent-traces/<ws>/
//   <agent>.json   agent record (atomic rename)       <agent>.jsonl   events, append-only
// <ws> and <agent> are sha256 prefixes of the validated IDs: an ID is data and
// never becomes part of a path. Symlinks are refused (lstat on dirs, O_NOFOLLOW on files).
//
// API
//   createAgentTraceStore({dataDir,now?,onChange?,limits?}) -> {record,list,detail,health,close}
//   record({workspaceId,nodeId,id,parentId?,provider?,name?,model?,modelSource?,status?,taskId?,runId?,context?,event?,
//           providerAgentId?,matchOnly?}) -> {agent,event,duplicate?} | {agent:null,ignored:'unresolved'}
//   list({workspaceId,nodeId?})            -> {items,truncation}
//   detail({workspaceId,id,cursor?,limit?}) -> {agent,events,cursor,hasMore,availability}
//   health() -> {onChangeErrors,lastError}   close()
// Ownership: nodeId, parentId, taskId and runId are explicit data: once set they never change
// (a different value throws). Nothing is inferred from arrival order or the last message.
// Status: a terminal status (done/error/stopped/cancelled/interrupted) is kept; only an
// 'interrupted' one is replaced by a real outcome, and an explicit session/turn start reopens it.
// Retention: per agent maxEvents (oldest dropped, signalled as truncation); per workspace
// maxAgents (oldest finished dropped, signalled in list().truncation).
// Context never carries an inherited value or a percentage: instructions / assignment are
// available or not, tokens are the provider's measurement or unavailable.
// providerAgentId: the provider's own ID for the agent (e.g. Claude agent_id). A record whose id
// matches no agent but equals some agent's providerAgentId updates that agent; with matchOnly an
// unresolved record is ignored instead of creating an agent.

export const TRACE_LIMITS = Object.freeze({ maxEvents: 2000, compactSlack: 250, maxAgents: 300, maxText: 4000, maxIo: 4000, pageDefault: 50, pageMax: 200 });
export const TRACE_STATUSES = Object.freeze(['pending', 'starting', 'running', 'waiting', 'idle', 'blocked', 'done', 'error', 'stopped', 'cancelled', 'interrupted', 'unknown']);
const TERMINAL = new Set(['done', 'error', 'stopped', 'cancelled', 'interrupted']);
const REOPEN = new Set(['session.start', 'turn.start']);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,199}$/;
const KIND = /^[a-z][a-z0-9._-]{0,39}$/;
const EVENT_STATUS = /^[a-z][a-z_-]{0,23}$/;
const PROVIDER = /^[a-z][a-z0-9_-]{0,39}$/;
const MODEL = /^[A-Za-z0-9][\w./:@\[\]-]{0,199}$/;
const NOT_EXPOSED = 'No expuesto por el proveedor';
const NO_TOKENS = 'Sin medición del proveedor';

export const isTraceId = value => typeof value === 'string' && ID.test(value);
export const isTraceModel = value => typeof value === 'string' && MODEL.test(value);
const fail = message => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 32);
const iso = ms => new Date(ms).toISOString();
const callOf = id => String(id ?? '').replace(/:(start|end)$/, '');

// --- Redaction -------------------------------------------------------------
const SECRET_KEY = /^(env|environment|credentials?|passwords?|passwd|secrets?|tokens?|api[_-]?key|apikey|authorization|cookies?|private[_-]?key|access[_-]?key|client[_-]?secret)$/i;
const NAMED = 'API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?';
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redactado]'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '[redactado]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redactado]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redactado]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[redactado]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redactado]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[redactado]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redactado]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redactado]'],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redactado]@'],
  [new RegExp(`("[^"\\\\\\n]*(?:${NAMED}|authorization|cookie)[^"\\\\\\n]*"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi'), '$1"[redactado]"'],
  [new RegExp(`\\b([A-Z0-9_]*(?:${NAMED})[A-Z0-9_]*)(\\s*[=:]\\s*)(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s"',;]+)`, 'gi'), '$1$2[redactado]'],
];
// Secrets the host itself holds (its environment) are removed wherever they appear.
function knownSecrets() {
  const values = [];
  for (const [key, value] of Object.entries(process.env)) if (/API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i.test(key) && typeof value === 'string' && value.length >= 12) values.push(value);
  return values;
}
export function redactText(value) {
  let out = String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  for (const secret of knownSecrets()) out = out.split(secret).join('[redactado]');
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
function serialize(value) {
  if (typeof value === 'string') return value;
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, item) => {
      if (key && SECRET_KEY.test(key)) return '[redactado]';
      if (typeof item === 'bigint') return String(item);
      if (item && typeof item === 'object') { if (seen.has(item)) return '[circular]'; seen.add(item); }
      return item;
    }) ?? '';
  } catch { return ''; }
}
// Text stored in a trace: redacted first, then bounded (the cut marks itself).
export function clipTrace(value, max = TRACE_LIMITS.maxText) {
  if (value === undefined || value === null) return { text: '', truncated: false };
  const text = redactText(serialize(value));
  return text.length > max ? { text: `${text.slice(0, max)}…`, truncated: true } : { text, truncated: false };
}

// --- Safe filesystem helpers --------------------------------------------------
function safeDir(dir, create) {
  let stat = null;
  try { stat = fs.lstatSync(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!stat) {
    if (!create) return false;
    fs.mkdirSync(dir, { mode: 0o700 }); fs.chmodSync(dir, 0o700); stat = fs.lstatSync(dir);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Directorio de trazas no seguro');
  return true;
}
function writeJSON(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try { fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value)); fs.closeSync(fd); fd = undefined; fs.renameSync(tmp, file); }
  finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(tmp, { force: true }); }
}
function readText(file) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try { return fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
}
function appendLine(file, text) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeSync(fd, `${text}\n`); } finally { fs.closeSync(fd); }
}
function readEvents(file) {
  const raw = readText(file); let corrupt = 0; const events = [];
  for (const row of (raw ?? '').split('\n')) {
    if (!row) continue;
    try { const event = JSON.parse(row); if (event && typeof event === 'object' && Number.isInteger(event.seq)) events.push(event); else corrupt++; } catch { corrupt++; }
  }
  return { events, corrupt };
}

// --- Validation ---------------------------------------------------------------
const id = (value, name) => { assert(typeof value === 'string' && ID.test(value), `Invalid ${name}`); return value; };
const optional = (value, check) => value === undefined || value === null ? null : check(value);
function line(value, max, name) {
  assert(typeof value === 'string', `Invalid ${name}`);
  return redactText(value.slice(0, max * 4)).replace(/[\s\x00-\x1f\x7f-\x9f]+/g, ' ').trim().slice(0, max);
}
function timestamp(value, now) {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms >= Date.UTC(2000, 0, 1) && ms <= now + 86_400_000 ? ms : now;
}
const freshContext = () => ({ instructions: { available: false, reason: NOT_EXPOSED }, assignment: { available: false, reason: NOT_EXPOSED }, tokens: { available: false, reason: NO_TOKENS } });
function mergeContext(current, input, at) {
  if (input === undefined || input === null) return current;
  assert(typeof input === 'object' && !Array.isArray(input), 'Invalid context');
  const next = structuredClone(current);
  for (const [field, keys] of [['instructions', ['instructions']], ['assignment', ['assignment', 'brief']]]) {
    const value = keys.map(key => input[key]).find(item => item !== undefined && item !== null);
    if (value === undefined) continue;
    assert(typeof value === 'string', `Invalid context ${field}`);
    const clipped = clipTrace(value);
    next[field] = clipped.text.trim() ? { available: true, text: clipped.text, chars: value.length, ...(clipped.truncated ? { truncated: true } : {}) } : { available: false, reason: NOT_EXPOSED };
  }
  const measured = Number.isFinite(input.tokens) && input.tokens >= 0 ? Math.trunc(input.tokens) : null;
  const window = Number.isFinite(input.window) && input.window > 0 ? Math.trunc(input.window) : null;
  if (measured !== null) next.tokens = { available: true, measured, ...(window ? { window } : next.tokens.window ? { window: next.tokens.window } : {}), source: line(String(input.source ?? 'provider'), 80, 'context source') || 'provider', measuredAt: iso(at) };
  else if (window) next.tokens = { ...next.tokens, window };
  return next;
}

export function createAgentTraceStore({ dataDir, now = Date.now, onChange, limits } = {}) {
  assert(typeof dataDir === 'string' && path.isAbsolute(dataDir), 'dataDir must be an absolute path');
  const cap = { ...TRACE_LIMITS, ...limits };
  const root = path.join(dataDir, 'agent-traces');
  const spaces = new Map(), idSets = new Map();
  const state = { closed: false, loadError: null, onChangeErrors: 0, lastError: null };

  const space = workspaceId => {
    let entry = spaces.get(workspaceId);
    if (!entry) { entry = { dir: path.join(root, digest(workspaceId)), agents: new Map(), aliases: new Map(), droppedAgents: 0 }; spaces.set(workspaceId, entry); }
    return entry;
  };
  const files = (entry, agentId) => { const base = path.join(entry.dir, digest(agentId)); return { meta: `${base}.json`, events: `${base}.jsonl` }; };
  const persist = (entry, agent) => writeJSON(files(entry, agent.id).meta, agent);
  const ensure = entry => { fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 }); safeDir(root, true); safeDir(entry.dir, true); };
  const guard = () => { if (state.loadError) throw state.loadError; };
  const note = (agent, at, event) => { agent.lastActivityAt = Math.max(agent.lastActivityAt ?? 0, at); return event; };

  function appendEvent(entry, agent, input, at) {
    const seq = agent.seq + 1;
    const text = clipTrace(input.text), tool = input.tool === undefined || input.tool === null ? '' : line(String(input.tool), 120, 'event tool');
    const args = clipTrace(input.input, cap.maxIo), output = clipTrace(input.output, cap.maxIo);
    const event = { seq, id: input.id ?? `e${seq}`, at: iso(at), kind: input.kind,
      ...(text.text ? { text: text.text } : {}), ...(tool ? { tool } : {}), ...(args.text ? { input: args.text } : {}), ...(output.text ? { output: output.text } : {}),
      ...(input.status ? { status: input.status } : {}), ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(text.truncated || args.truncated || output.truncated ? { truncated: true } : {}) };
    appendLine(files(entry, agent.id).events, JSON.stringify(event));
    agent.seq = seq; agent.retained = (agent.retained ?? 0) + 1;
    if (agent.retained > cap.maxEvents + cap.compactSlack) {
      const kept = readEvents(files(entry, agent.id).events).events.slice(-cap.maxEvents);
      const tmp = `${files(entry, agent.id).events}.${randomUUID()}.tmp`;
      try { fs.writeFileSync(tmp, kept.map(item => JSON.stringify(item)).join('\n') + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, files(entry, agent.id).events); } finally { fs.rmSync(tmp, { force: true }); }
      agent.dropped = (agent.dropped ?? 0) + agent.retained - kept.length; agent.retained = kept.length;
    }
    return event;
  }
  function knownIds(entry, agent) {
    const key = `${agent.workspaceId}\0${agent.id}`;
    let set = idSets.get(key);
    if (!set) { set = new Set(readEvents(files(entry, agent.id).events).events.map(event => event.id)); idSets.set(key, set); }
    return set;
  }
  function expire(entry) {
    while (entry.agents.size >= cap.maxAgents) {
      const all = [...entry.agents.values()], pool = all.some(agent => TERMINAL.has(agent.status)) ? all.filter(agent => TERMINAL.has(agent.status)) : all;
      const oldest = pool.reduce((a, b) => (b.lastActivityAt < a.lastActivityAt ? b : a));
      entry.agents.delete(oldest.id); if (oldest.providerAgentId) entry.aliases.delete(oldest.providerAgentId);
      idSets.delete(`${oldest.workspaceId}\0${oldest.id}`);
      for (const file of Object.values(files(entry, oldest.id))) fs.rmSync(file, { force: true });
      entry.droppedAgents++;
    }
    writeJSON(path.join(entry.dir, 'workspace.json'), { droppedAgents: entry.droppedAgents });
  }

  function load() {
    if (!safeDir(root, false)) return;
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      let stat; try { stat = fs.lstatSync(dir); } catch { continue; }
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      let dropped = 0; try { dropped = JSON.parse(readText(path.join(dir, 'workspace.json')) ?? '{}').droppedAgents | 0; } catch { /* Counter lost; agents are intact. */ }
      for (const file of fs.readdirSync(dir)) {
        if (!/^[0-9a-f]{32}\.json$/.test(file)) continue;
        let agent; try { agent = JSON.parse(readText(path.join(dir, file)) ?? ''); } catch { continue; }
        if (!agent || typeof agent !== 'object' || !ID.test(agent.workspaceId ?? '') || !ID.test(agent.id ?? '') || !ID.test(agent.nodeId ?? '')) continue;
        if (digest(agent.workspaceId) !== name || `${digest(agent.id)}.json` !== file) continue;
        const entry = space(agent.workspaceId); entry.droppedAgents = dropped; entry.agents.set(agent.id, agent);
        if (agent.providerAgentId) entry.aliases.set(agent.providerAgentId, agent.id);
      }
    }
    // Sessions left open by a previous host never finished here: state unknown, never invented as done.
    const at = now();
    for (const entry of spaces.values()) for (const agent of entry.agents.values()) {
      if (TERMINAL.has(agent.status)) continue;
      try {
        agent.seq = Math.max(agent.seq ?? 0, ...readEvents(files(entry, agent.id).events).events.map(event => event.seq));
        appendEvent(entry, agent, { id: `interrupted:${agent.seq + 1}`, kind: 'interrupted', status: 'interrupted', text: 'El host se reinició; el estado final es desconocido.' }, at);
        Object.assign(agent, { status: 'interrupted', endedAt: at, currentActivity: null, outcomeUnavailable: 'El host se reinició; el estado final es desconocido' });
        persist(entry, agent);
      } catch (error) { state.lastError = error.message; }
    }
  }
  try { load(); } catch (error) { state.loadError = error; }

  function view(agent) {
    const { seq, retained, dropped, outcomeUnavailable, parentUnavailable, ...rest } = agent;
    const requested = agent.requestedModel ?? null, observed = agent.observedModel ?? null;
    return structuredClone({ ...rest, parentId: agent.parentId ?? null, model: observed ?? requested, modelSource: observed ? 'observed' : requested ? 'requested' : 'unknown',
      requestedModel: requested, observedModel: observed, taskId: agent.taskId ?? null, runId: agent.runId ?? null,
      startedAt: iso(agent.startedAt), endedAt: agent.endedAt ? iso(agent.endedAt) : null, lastActivityAt: iso(agent.lastActivityAt), eventCount: seq,
      truncation: { truncated: (dropped ?? 0) > 0, dropped: dropped ?? 0, limit: cap.maxEvents },
      availability: {
        history: seq > 0 ? { available: true } : { available: false, reason: 'Sin eventos registrados' },
        model: observed || requested ? { available: true } : { available: false, reason: 'El proveedor no informó el modelo' },
        taskRun: agent.taskId || agent.runId ? { available: true } : { available: false, reason: 'Sin evidencia explícita de tarea o ejecución' },
        ...(parentUnavailable && !agent.parentId ? { parent: { available: false, reason: parentUnavailable } } : {}),
        ...(outcomeUnavailable ? { outcome: { available: false, reason: outcomeUnavailable } } : {}),
      } });
  }

  function record(input) {
    guard(); assert(!state.closed, 'Agent trace store is closed');
    assert(input && typeof input === 'object' && !Array.isArray(input), 'Invalid agent trace record');
    const workspaceId = id(input.workspaceId, 'workspaceId'), nodeId = id(input.nodeId, 'nodeId'), agentId = id(input.id, 'id');
    const parentId = optional(input.parentId, value => id(value, 'parentId')), taskId = optional(input.taskId, value => id(value, 'taskId')), runId = optional(input.runId, value => id(value, 'runId'));
    const providerAgentId = optional(input.providerAgentId, value => id(value, 'providerAgentId'));
    const provider = optional(input.provider, value => { assert(typeof value === 'string' && PROVIDER.test(value), 'Invalid provider'); return value; });
    const name = optional(input.name, value => line(value, 120, 'name'));
    const model = optional(input.model, value => { assert(typeof value === 'string' && MODEL.test(value), 'Invalid model'); return value; });
    const modelSource = optional(input.modelSource, value => { assert(value === 'requested' || value === 'observed', 'Invalid modelSource'); return value; });
    assert(model === null || modelSource !== null, 'model requires modelSource');
    const status = optional(input.status, value => { assert(TRACE_STATUSES.includes(value), 'Invalid status'); return value; });
    assert(input.matchOnly === undefined || typeof input.matchOnly === 'boolean', 'Invalid matchOnly');
    assert(parentId !== agentId, 'Un agente no puede ser su propio padre');
    let event = null;
    if (input.event !== undefined && input.event !== null) {
      const raw = input.event;
      assert(typeof raw === 'object' && !Array.isArray(raw), 'Invalid event');
      assert(typeof raw.kind === 'string' && KIND.test(raw.kind), 'Invalid event kind');
      event = { id: optional(raw.id, value => id(value, 'event id')) ?? undefined, kind: raw.kind, text: raw.text, tool: raw.tool, input: raw.input, output: raw.output,
        status: optional(raw.status, value => { assert(typeof value === 'string' && EVENT_STATUS.test(value), 'Invalid event status'); return value; }) ?? undefined,
        actorId: optional(raw.actorId, value => id(value, 'actorId')) ?? undefined, at: raw.at };
      for (const key of ['text', 'tool']) assert(raw[key] === undefined || raw[key] === null || typeof raw[key] === 'string', `Invalid event ${key}`);
    }
    const at = timestamp(event?.at, now());
    const entry = space(workspaceId);
    let agent = entry.agents.get(agentId) ?? (entry.aliases.has(agentId) ? entry.agents.get(entry.aliases.get(agentId)) : undefined);
    if (!agent && input.matchOnly) return { agent: null, ignored: 'unresolved' };
    const created = !agent;
    if (created) {
      ensure(entry); expire(entry);
      agent = { id: agentId, workspaceId, nodeId, parentId: null, provider: provider ?? null, name: name ?? null, status: 'unknown', taskId: null, runId: null,
        startedAt: at, endedAt: null, lastActivityAt: at, currentActivity: null, context: freshContext(), seq: 0, retained: 0, dropped: 0 };
    } else {
      assert(agent.nodeId === nodeId, 'El agente pertenece a otro nodo');
      for (const [field, value] of [['parentId', parentId], ['taskId', taskId], ['runId', runId], ['provider', provider]]) assert(value === null || !agent[field] || agent[field] === value, `${field} es inmutable una vez establecido`);
      ensure(entry);
    }
    const context = mergeContext(agent.context, input.context, at); // validated before anything changes
    const before = JSON.stringify(agent);
    if (parentId) { agent.parentId = parentId; delete agent.parentUnavailable; }
    else if (created && input.parent && input.parent.available === false) agent.parentUnavailable = line(String(input.parent.reason ?? 'Sin evidencia explícita de propiedad'), 200, 'parent reason');
    if (taskId) agent.taskId = taskId;
    if (runId) agent.runId = runId;
    if (provider && !agent.provider) agent.provider = provider;
    if (name && (!agent.name || created)) agent.name = name;
    if (providerAgentId) agent.providerAgentId = providerAgentId;
    if (model) agent[modelSource === 'observed' ? 'observedModel' : 'requestedModel'] = model;
    agent.context = context;
    if (status) {
      // 'unknown' never regresses a known state, except from an explicit 'settled' event (the run ended unconfirmed).
      if (agent.status === 'unknown' || (!TERMINAL.has(agent.status) && (status !== 'unknown' || event?.kind === 'settled'))) agent.status = status;
      else if (agent.status === 'interrupted' && TERMINAL.has(status) && status !== 'interrupted') { agent.status = status; delete agent.outcomeUnavailable; }
      else if (status === 'running' && REOPEN.has(event?.kind) && (!event.id || !knownIds(entry, agent).has(event.id))) { agent.status = 'running'; agent.endedAt = null; delete agent.outcomeUnavailable; } // a replayed start never reopens
      if (TERMINAL.has(agent.status)) { agent.endedAt ??= at; agent.currentActivity = null; }
      else if (event?.kind === 'settled') agent.currentActivity = null;
    }
    let stored = null, duplicate = false;
    if (event) {
      const ids = knownIds(entry, agent);
      if (event.id && ids.has(event.id)) duplicate = true;
      else {
        stored = appendEvent(entry, agent, event, at); ids.add(stored.id);
        if (event.kind === 'tool' && !TERMINAL.has(agent.status)) {
          if (!event.status || event.status === 'running') agent.currentActivity = { kind: 'tool', tool: stored.tool ?? null, text: (stored.text ?? '').slice(0, 200), since: stored.at, callId: callOf(stored.id) };
          else if (agent.currentActivity?.callId === callOf(stored.id)) agent.currentActivity = null;
        }
      }
      if (stored) note(agent, at);
    } else if (created || status) note(agent, at);
    const changed = created || stored || JSON.stringify(agent) !== before;
    if (changed) {
      persist(entry, agent);
      if (created) entry.agents.set(agent.id, agent);
      if (agent.providerAgentId) entry.aliases.set(agent.providerAgentId, agent.id);
      if (onChange) { try { onChange({ workspaceId, nodeId: agent.nodeId, id: agent.id }); } catch (error) { state.onChangeErrors++; state.lastError = error.message; } }
    }
    return { agent: view(agent), event: stored ? structuredClone(stored) : null, ...(duplicate ? { duplicate: true } : {}) };
  }

  function list({ workspaceId, nodeId } = {}) {
    guard(); id(workspaceId, 'workspaceId'); if (nodeId !== undefined && nodeId !== null) id(nodeId, 'nodeId');
    safeDir(root, false);
    const entry = spaces.get(workspaceId);
    const items = [...(entry?.agents.values() ?? [])].filter(agent => !nodeId || agent.nodeId === nodeId).sort((a, b) => b.lastActivityAt - a.lastActivityAt).map(view);
    return { items, truncation: { truncated: (entry?.droppedAgents ?? 0) > 0, droppedAgents: entry?.droppedAgents ?? 0, limit: cap.maxAgents } };
  }

  function detail({ workspaceId, id: agentId, cursor, limit } = {}) {
    guard(); id(workspaceId, 'workspaceId'); id(agentId, 'id');
    assert(cursor === undefined || cursor === null || (typeof cursor === 'string' && /^\d{1,12}$/.test(cursor)), 'Invalid cursor');
    assert(limit === undefined || limit === null || (Number.isInteger(limit) && limit >= 1), 'Invalid limit');
    safeDir(root, false);
    const entry = spaces.get(workspaceId), agent = entry?.agents.get(agentId);
    if (!agent) return { agent: null, events: [], cursor: cursor ?? null, hasMore: false, availability: { available: false, reason: 'Agente no encontrado' } };
    const size = Math.min(limit ?? cap.pageDefault, cap.pageMax), after = cursor ? Number(cursor) : 0;
    const { events, corrupt } = readEvents(files(entry, agentId).events);
    const pending = events.filter(event => event.seq > after).sort((a, b) => a.seq - b.seq), page = pending.slice(0, size);
    const publicAgent = view(agent);
    return { agent: publicAgent, events: page, cursor: page.length ? String(page.at(-1).seq) : cursor ?? null, hasMore: pending.length > page.length,
      availability: { available: true, ...publicAgent.availability, truncation: publicAgent.truncation, ...(corrupt ? { corruptLines: corrupt } : {}) } };
  }

  return {
    record, list, detail,
    health: () => ({ onChangeErrors: state.onChangeErrors, lastError: state.lastError }),
    close() { state.closed = true; idSets.clear(); },
  };
}
