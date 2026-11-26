import { childrenOf } from './card-view.mjs';
import { duration } from './phantom-desk.mjs';

// ---- Agent traces: what agent.traces.list / agent.traces.detail returned, nothing more ----
// Ownership comes only from the explicit parentId / taskId / runId / actorId the host recorded;
// never from the last message or the order of arrival. Unknown data stays unknown.
const flat = (value, max = 240) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const isoOf = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const TRACE_STATUS = {
  running: ['En ejecución', 'live'], working: ['Trabajando', 'live'], waiting: ['Esperando', 'idle'], idle: ['En espera', 'idle'],
  queued: ['En cola', 'idle'], pending: ['En cola', 'idle'], blocked: ['Bloqueado', 'blocked'], failed: ['Falló', 'blocked'], error: ['Falló', 'blocked'],
  completed: ['Terminó', 'done'], done: ['Terminó', 'done'], finished: ['Terminó', 'done'],
  stopped: ['Detenido', 'stopped'], cancelled: ['Cancelado', 'stopped'], canceled: ['Cancelado', 'stopped'], interrupted: ['Interrumpido', 'stopped'],
};
const MODEL_SOURCE = { observed: 'observado por el proveedor', requested: 'solicitado', declared: 'declarado', configured: 'configurado' };
export const TRACE_KIND_LABEL = { root: 'Agente raíz', subagent: 'Subagente', run: 'Ejecución' };

// A click on a sub-agent in a canvas card names the project, the card and the agent explicitly. A request that is
// incomplete or that belongs to another project than the active one is dropped; nothing is guessed from the selection.
export function agentOpenRequest(request, activeWorkspaceId) {
  const valid = value => typeof value === 'string' && value.length > 0;
  if (!request || typeof request !== 'object' || !valid(request.id) || !valid(request.nodeId) || !valid(request.workspaceId) || request.workspaceId !== activeWorkspaceId) return null;
  return { workspaceId: request.workspaceId, nodeId: request.nodeId, id: request.id };
}

export const traceKind = agent => agent?.taskId || agent?.runId ? 'run' : agent?.parentId ? 'subagent' : 'root';

export function traceStatus(status) {
  const entry = typeof status === 'string' ? TRACE_STATUS[status.toLowerCase()] : null;
  return entry ? { label: entry[0], tone: entry[1], known: true } : { label: 'Estado no disponible', tone: 'unknown', known: false };
}

export function agoLabel(iso, now = Date.now()) {
  const at = typeof iso === 'number' && Number.isFinite(iso) ? new Date(iso).toISOString() : isoOf(iso);
  if (!at) return '';
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  return seconds < 5 ? 'ahora' : seconds < 60 ? `hace ${seconds} s` : seconds < 3600 ? `hace ${Math.floor(seconds / 60)} min` : seconds < 86400 ? `hace ${Math.floor(seconds / 3600)} h` : `hace ${Math.floor(seconds / 86400)} d`;
}

const block = value => {
  const missing = { available: false, text: '', source: '', size: null, reason: 'El proveedor no informó este dato.' };
  if (typeof value === 'string') return value.trim() ? { available: true, text: value.slice(0, 4000), source: '', size: value.length, reason: '' } : missing;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return missing;
  const text = typeof value.text === 'string' ? value.text.slice(0, 4000) : '', size = finite(value.chars) ?? (text ? text.length : null);
  if (value.available === false || (!text && size === null)) return { ...missing, source: flat(value.source, 80), reason: flat(value.reason, 240) || missing.reason, available: false };
  return { available: true, text, source: flat(value.source, 80), size, reason: '' };
};

// Measured tokens only. No percentage and no inheritance are ever derived here.
const TOKEN_FIELDS = [['input', 'Entrada'], ['output', 'Salida'], ['cached', 'En caché'], ['total', 'Total']];
function tokensOf(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fields = TOKEN_FIELDS.map(([key, label]) => [key, label, finite(source[key])]).filter(([, , amount]) => amount !== null).map(([key, label, amount]) => ({ key, label, amount }));
  if (source.available === false || !fields.length) return { available: false, fields: [], source: flat(source.source, 80), reason: flat(source.reason, 240) || 'El proveedor no midió tokens para este agente.' };
  return { available: true, fields, source: flat(source.source, 80), reason: '' };
}

export function traceContext(agent) {
  const context = agent?.context && typeof agent.context === 'object' && !Array.isArray(agent.context) ? agent.context : {};
  return { instructions: block(context.instructions), assignment: block(context.assignment ?? context.brief), tokens: tokensOf(context.tokens) };
}

function activityOf(value) {
  if (typeof value === 'string') return flat(value);
  if (!value || typeof value !== 'object') return '';
  return flat([value.label ?? value.text ?? value.tool, value.detail ?? value.target].filter(part => typeof part === 'string' && part).join(' · '));
}

export function traceView(agent, now = Date.now()) {
  const model = flat(agent?.model, 120);
  const availability = agent?.availability && typeof agent.availability === 'object' ? agent.availability : null;
  return {
    id: String(agent?.id ?? ''), kind: traceKind(agent), kindLabel: TRACE_KIND_LABEL[traceKind(agent)],
    name: flat(agent?.name, 120) || 'Agente sin nombre', provider: flat(agent?.provider, 60),
    parentId: typeof agent?.parentId === 'string' && agent.parentId ? agent.parentId : null, nodeId: typeof agent?.nodeId === 'string' ? agent.nodeId : '',
    taskId: typeof agent?.taskId === 'string' ? agent.taskId : '', runId: typeof agent?.runId === 'string' ? agent.runId : '',
    status: traceStatus(agent?.status), activity: activityOf(agent?.currentActivity),
    model: model ? { known: true, text: model, source: MODEL_SOURCE[agent?.modelSource] || flat(agent?.modelSource, 60) } : { known: false, text: 'No disponible', source: '' },
    lastActivityAt: isoOf(agent?.lastActivityAt), updated: agoLabel(agent?.lastActivityAt, now),
    elapsed: isoOf(agent?.startedAt) ? duration(agent.startedAt, isoOf(agent?.endedAt) || undefined, now) : '',
    context: traceContext(agent),
    unavailable: availability?.available === false ? flat(availability.reason, 240) || 'El historial de este agente no está disponible.' : '',
  };
}

// The list as an explicit-parent forest, depth first, host order kept. A parent that is absent
// or would close a cycle leaves the agent as a root; nothing is guessed from nodes or timing.
export function agentTree(items) {
  const byId = new Map();
  for (const agent of Array.isArray(items) ? items : []) if (agent && typeof agent === 'object' && typeof agent.id === 'string' && agent.id && !byId.has(agent.id)) byId.set(agent.id, agent);
  const children = new Map([...byId.keys()].map(id => [id, []])), roots = [];
  const closesCycle = (agent, parent) => { for (let step = 0, node = parent; node && step <= byId.size; step += 1, node = byId.get(node.parentId)) if (node.id === agent.id) return true; return false; };
  for (const agent of byId.values()) {
    const parent = typeof agent.parentId === 'string' ? byId.get(agent.parentId) : null;
    if (parent && !closesCycle(agent, parent)) children.get(parent.id).push(agent); else roots.push(agent);
  }
  const rows = [];
  const visit = (agent, depth) => {
    rows.push({ id: agent.id, agent, depth, kind: traceKind(agent), parentMissing: Boolean(agent.parentId) && !(depth > 0), childCount: children.get(agent.id).length });
    children.get(agent.id).forEach(child => visit(child, depth + 1));
  };
  roots.forEach(agent => visit(agent, 0));
  const count = kind => rows.filter(row => row.kind === kind).length;
  return { rows, counts: { total: rows.length, roots: count('root'), subagents: count('subagent'), runs: count('run'), active: rows.filter(row => traceStatus(row.agent.status).tone === 'live').length } };
}

// Pages merge by event id and read in time order whichever way the host pages; ties keep arrival order.
export function mergeTraceEvents(...pages) {
  const seen = new Map();
  for (const event of pages.flat()) {
    if (!event || typeof event !== 'object') continue;
    const key = typeof event.id === 'string' && event.id ? event.id : `${event.at}|${event.kind}|${event.text}`;
    seen.set(key, event);
  }
  return [...seen.values()].map((event, index) => ({ event, index, time: isoOf(event.at) ? Date.parse(event.at) : Infinity }))
    .sort((a, b) => a.time === b.time ? a.index - b.index : a.time - b.time).map(entry => entry.event);
}

// Who owns an event: the agent the host names in actorId, else the agent whose history it was read from.
export function traceEventOwner(event, agent, agentsById) {
  const actor = typeof event?.actorId === 'string' ? event.actorId : '';
  const self = { id: String(agent?.id ?? ''), label: flat(agent?.name, 120) || 'Agente sin nombre', explicit: false, known: true };
  if (!actor || actor === self.id) return { ...self, explicit: actor === self.id && actor !== '' };
  const other = agentsById instanceof Map ? agentsById.get(actor) : agentsById?.[actor];
  return other ? { id: actor, label: flat(other.name, 120) || 'Agente sin nombre', explicit: true, known: true } : { id: actor, label: 'Agente no listado', explicit: true, known: false };
}

const EVENT_KIND = { tool: 'Herramienta', message: 'Mensaje', result: 'Resultado', final: 'Resultado', status: 'Estado', error: 'Error' };
const inputText = input => typeof input === 'string' ? input : input && typeof input === 'object' ? [input.command, input.cmd, input.file_path, input.path, input.pattern, input.description].find(value => typeof value === 'string' && value) || '' : '';
export function traceEventView(event) {
  const kind = typeof event?.kind === 'string' ? event.kind : '';
  const tool = flat(event?.tool, 80);
  return {
    id: typeof event?.id === 'string' ? event.id : '', at: isoOf(event?.at), kind, label: EVENT_KIND[kind] || flat(kind, 40) || 'Evento',
    tool, text: flat(event?.text, 600) || (tool ? flat(inputText(event?.input)) : ''), status: typeof event?.status === 'string' ? event.status : '',
    output: typeof event?.output === 'string' ? event.output.slice(0, 4000) : '',
  };
}

// The agent's outcome only from a recorded result event or field; otherwise it says it is not recorded.
export function traceResult(agent, events) {
  const event = (Array.isArray(events) ? events : []).findLast(item => item?.kind === 'result' || item?.kind === 'final');
  const text = typeof event?.text === 'string' && event.text.trim() ? event.text : typeof event?.output === 'string' && event.output.trim() ? event.output : typeof agent?.result === 'string' ? agent.result : '';
  return text.trim() ? { available: true, text: text.slice(0, 4000) } : { available: false, text: '', reason: traceStatus(agent?.status).tone === 'done' ? 'El agente terminó sin resultado registrado.' : 'Aún sin resultado registrado.' };
}

// ---- One shape for a chat sub-agent and for a Phantom assignment ----
// delegateView(input, now) -> {
//   kind: 'subagent' | 'run', id, label: 'Subagente' | 'Encargo', title,
//   tone: 'live' (working) | 'attention' (needs the user) | 'error' | 'done' (real success)
//       | 'stopped' (not moving: stopped, cancelled, queued) | 'unknown' (no recorded state),
//   stateLabel,
//   now: { label, detail } | null      what it is doing right now, only if recorded
//   duration: string                   '' when no start was recorded
//   model: string | null               short model name, null when not recorded
//   meta: string[]                     recorded counts only (steps, turns, tools, checks)
//   attention: { label, meaning } | null   only a real blocker, failed checks or a pending question
//   sections: [{ key, label, count? }] the <details> worth opening; absent data has no section
// }
// Inputs: a chat tool part with part.agent (type, model, steps, total, text, prompt; part.status, output, detail),
// or a Phantom assignment: the summarizePhantomRun summary plus `activity` (summarizePhantomActivity) and `id`.
// Either may carry `question` (string) when the caller found a pending question that belongs to it.
// Nothing is derived from step counts: no percentage, no progress.
const short = value => { const text = flat(value, 120); return text ? text.split('/').at(-1) : null; };
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const questionOf = value => flat(typeof value === 'string' ? value : value?.question, 240);
const SUBAGENT_STATE = { running: ['Trabajando', 'live'], done: ['Terminó', 'done'], error: ['Falló', 'error'], stopped: ['Detenido', 'stopped'] };

function subagentView(part, now) {
  const agent = part.agent && typeof part.agent === 'object' && !Array.isArray(part.agent) ? part.agent : {};
  const steps = Array.isArray(agent.steps) ? agent.steps : [], total = Math.max(finite(agent.total) ?? 0, steps.length);
  const [stateLabel, baseTone] = SUBAGENT_STATE[part.status] || ['Estado no disponible', 'unknown'];
  const question = baseTone === 'live' ? questionOf(part.question ?? agent.question) : '';
  const step = baseTone === 'live' ? steps.findLast(item => item?.status === 'running') || steps.at(-1) : null;
  const doing = step ? { label: flat(step.name, 120), detail: flat(step.detail) } : null;
  const type = flat(agent.type, 80);
  return {
    kind: 'subagent', id: part.id == null ? '' : String(part.id), label: 'Subagente',
    title: flat(part.detail) || flat(part.name) || 'Sin descripción',
    tone: question ? 'attention' : baseTone, stateLabel: question ? 'Espera tu respuesta' : stateLabel,
    now: doing && doing.label ? doing : null,
    duration: isoOf(agent.startedAt) ? duration(agent.startedAt, isoOf(agent.endedAt) || undefined, now) : '',
    model: short(agent.model),
    meta: [type, total > 0 ? plural(total, 'paso', 'pasos') : ''].filter(Boolean),
    attention: question ? { label: 'Pregunta pendiente', meaning: question } : null,
    sections: [
      total > 0 && { key: 'steps', label: 'Pasos', count: total },
      typeof agent.prompt === 'string' && agent.prompt.trim() && { key: 'prompt', label: 'Instrucción' },
      typeof agent.text === 'string' && agent.text.trim() && { key: 'said', label: 'Último mensaje' },
      typeof part.output === 'string' && part.output.trim() && { key: 'output', label: 'Resultado' },
    ].filter(Boolean),
  };
}

function runView(run) {
  const summary = run && typeof run === 'object' ? run : {}, activity = summary.activity && typeof summary.activity === 'object' ? summary.activity : null;
  const status = typeof summary.status === 'string' ? summary.status : 'unknown';
  const checks = Array.isArray(summary.checks) ? summary.checks : [];
  const failed = checks.filter(check => check?.passed === false);
  const working = summary.live === true && status !== 'ready';
  const blocker = summary.blocker && typeof summary.blocker === 'object' ? summary.blocker : null;
  const question = questionOf(summary.question);
  const attention = question ? { label: 'Pregunta pendiente', meaning: question }
    : blocker ? { label: flat(blocker.label, 120) || 'Phantom la bloqueó', meaning: flat(blocker.meaning, 240) || flat(blocker.reason, 240) || 'Phantom no informó el motivo.' }
    : failed.length && !working ? { label: failed.length === 1 ? 'Un check falló' : `${failed.length} checks fallaron`, meaning: failed.map(check => flat(check.name, 80)).filter(Boolean).join(' · ') || 'Phantom no informó cuáles.' }
    : null;
  const known = status !== 'unknown' && typeof summary.label === 'string' && summary.label;
  const tone = status === 'failed' ? 'error' : attention ? 'attention' : working ? 'live' : status === 'completed' ? 'done' : status === 'cancelled' || status === 'ready' ? 'stopped' : 'unknown';
  const current = working ? activity?.current : null, line = working ? flat(summary.line) : '';
  const doing = current?.label ? { label: flat(current.label, 120), detail: flat(current.detail) } : line ? { label: 'Salida', detail: line } : null;
  const results = checks.some(check => check?.result && check.result !== 'Sin resultado');
  const activityTotal = finite(activity?.total) ?? 0;
  return {
    kind: 'run', id: typeof summary.id === 'string' ? summary.id : '', label: 'Encargo',
    title: flat(summary.title) || flat(summary.goal) || 'Sin título',
    tone, stateLabel: known ? summary.label : 'Estado no disponible', now: doing,
    duration: typeof summary.duration === 'string' ? summary.duration : '', model: short(summary.model),
    meta: [
      finite(summary.turns) !== null ? plural(summary.turns, 'turno', 'turnos') : '',
      finite(summary.tools) !== null ? plural(summary.tools, 'herramienta', 'herramientas') : '',
      checks.length ? results ? `${finite(summary.passed) ?? 0} de ${checks.length} checks` : plural(checks.length, 'check sin resultado', 'checks sin resultado') : '',
    ].filter(Boolean),
    attention,
    sections: [
      Array.isArray(summary.phases) && summary.phases.length > 0 && { key: 'phases', label: 'Fases' },
      checks.length > 0 && { key: 'checks', label: 'Checks', count: checks.length },
      activityTotal > 0 && { key: 'activity', label: 'Actividad', count: activityTotal },
      typeof summary.output === 'string' && summary.output.trim() && { key: 'output', label: 'Salida' },
    ].filter(Boolean),
  };
}

export function delegateView(input, now = Date.now()) {
  return input?.type === 'tool' && input.agent ? subagentView(input, now) : runView(input);
}

// The live line over a turn: only what is working now. Accepts raw inputs or views already built.
export function delegateSummary(parts, runs) {
  const view = entry => entry?.kind && entry.tone ? entry : delegateView(entry);
  const seen = new Set();
  const subagents = (Array.isArray(parts) ? parts : []).filter(part => {
    if (part?.type !== 'tool' || !part.agent || part.status !== 'running') return false;
    const key = part.id == null ? '' : String(part.id);
    if (key && seen.has(key)) return false;
    seen.add(key);
    return true;
  }).length;
  const assignments = (Array.isArray(runs) ? runs : []).filter(run => view(run).tone === 'live').length;
  return [subagents && plural(subagents, 'subagente', 'subagentes'), assignments && plural(assignments, 'encargo', 'encargos')].filter(Boolean).join(' · ');
}

export function chatSubagents(messages) {
  const result = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      if (part?.type !== 'tool' || !part.agent || typeof part.agent !== 'object' || Array.isArray(part.agent) || part.status !== 'running' || part.id == null || part.id === '') continue;
      const description = part.detail || part.name || '';
      result.push({ id: String(part.id), type: typeof part.agent.type === 'string' ? part.agent.type : '', description: typeof description === 'string' ? description.replace(/\s+/g, ' ').trim().slice(0, 240) : '', background: false });
    }
  }
  return result;
}

export function withChatSubagents(delegation, byNode) {
  const rows = delegation.rows.map(row => {
    const subagents = [...row.subagents];
    const ids = new Set(subagents.map(entry => entry.id));
    for (const entry of byNode?.[row.id] || []) {
      if (ids.has(entry.id)) continue;
      ids.add(entry.id);
      subagents.push(entry);
    }
    return { ...row, subagents };
  });
  return { ...delegation, rows, counts: { ...delegation.counts, subagents: rows.reduce((total, row) => total + row.subagents.length, 0) } };
}

export function withCardPlans(delegation, tasks) {
  const items = Array.isArray(tasks) ? tasks : Array.isArray(tasks?.items) ? tasks.items : [];
  const plans = new Map();
  for (const item of items) {
    const children = childrenOf(item.raw ?? item, items).nodes.map(({ key, goal, status, dependencies, taskId = '' }) => ({ key, goal, status, dependencies, taskId }));
    if (children.length) plans.set(item.id, { cardId: item.id, total: children.length, done: children.filter(child => child.status === 'completed').length, children });
  }
  const assigned = new Set(delegation.rows.map(row => row.cardId).filter(Boolean));
  return {
    rows: delegation.rows.map(row => ({ ...row, plan: row.cardId ? plans.get(row.cardId) || null : null })),
    counts: delegation.counts,
    cards: items.filter(item => item.status !== 'completed' && item.status !== 'cancelled' && plans.has(item.id) && !assigned.has(item.id)).map(item => {
      let goal = ((item.raw ?? item).contract?.goal || '').replace(/\s+/g, ' ').trim();
      if (goal.length > 200) goal = `${goal.slice(0, 199)}…`;
      return { id: item.id, goal, status: item.status, plan: plans.get(item.id) };
    }),
  };
}

export function buildDelegation(workspace, { now = Date.now() } = {}) {
  const nodes = (workspace?.nodes || []).filter(node => node.type === 'terminal' && !node.data?.process);
  const rows = nodes.map(node => {
    const { handoff, role, hidden } = node.data || {};
    // Stored as null for terminals without their own copy: a destructuring default would not cover it.
    const agent = node.data?.agent || {}, worktree = node.data?.worktree || {};
    const what = agent.cardTitle || handoff?.title || '';
    let why = (handoff?.brief || '').replace(/\s+/g, ' ').trim();
    if (what && why.startsWith(`${what} `)) why = why.slice(what.length).trim();
    if (why === what) why = '';
    if (why.length > 200) why = `${why.slice(0, 199)}…`;
    return {
      id: node.id,
      title: node.title || 'Terminal',
      role: role === 'orchestrator' ? 'orchestrator' : 'worker',
      depth: 0,
      parentId: null,
      purpose: typeof agent.cardId === 'string' && agent.cardId.length > 0 ? 'task' : handoff ? 'handoff' : role === 'orchestrator' ? 'orchestrator' : 'none',
      what,
      why,
      from: handoff?.from ? {
        nodeId: handoff.from.nodeId,
        title: handoff.from.title,
        workspaceName: handoff.from.workspaceName,
        external: handoff.from.workspaceId !== workspace.id,
      } : null,
      status: ['idle', 'working', 'blocked', 'review'].includes(agent.status) ? agent.status : 'idle',
      step: agent.step || '',
      branch: worktree.branch || '',
      cardId: agent.cardId || '',
      hidden: Boolean(hidden),
      subagents: (Array.isArray(node.data?.subagents) ? node.data.subagents : []).filter(entry => entry && typeof entry.id === 'string' && typeof entry.startedAt === 'string' && Number.isFinite(Date.parse(entry.startedAt)) && now - Date.parse(entry.startedAt) <= 6 * 3600e3).map(entry => ({ id: entry.id, type: typeof entry.type === 'string' ? entry.type : '', description: typeof entry.description === 'string' ? entry.description : '', background: entry.background === true })),
    };
  });
  const byId = new Map(rows.map(row => [row.id, row]));
  rows.forEach(row => {
    if (!row.from || row.from.external) return;
    let parent = byId.get(row.from.nodeId);
    if (!parent || parent === row) return;
    const parentId = parent.id;
    while (parent && parent !== row) parent = byId.get(parent.parentId);
    if (!parent) row.parentId = parentId;
  });
  const children = new Map(rows.map(row => [row.id, []]));
  const createdAt = new Map(nodes.map(node => [node.id, node.data?.handoff?.createdAt || '']));
  for (const row of rows) if (row.parentId !== null) children.get(row.parentId).push(row);
  for (const siblings of children.values()) siblings.sort((a, b) => {
    const first = createdAt.get(a.id), second = createdAt.get(b.id);
    return first < second ? -1 : first > second ? 1 : 0;
  });
  const ordered = [];
  function visit(row, depth) {
    row.depth = depth;
    ordered.push(row);
    for (const child of children.get(row.id)) visit(child, depth + 1);
  }
  const roots = rows.filter(row => row.parentId === null);
  roots.sort((a, b) => Number(b.role === 'orchestrator') - Number(a.role === 'orchestrator'));
  for (const root of roots) visit(root, 0);
  return {
    rows: ordered,
    counts: {
      total: rows.length,
      unassigned: rows.filter(row => row.purpose === 'none').length,
      working: rows.filter(row => row.status === 'working').length,
      blocked: rows.filter(row => row.status === 'blocked').length,
      subagents: rows.reduce((total, row) => total + row.subagents.length, 0),
    },
  };
}
