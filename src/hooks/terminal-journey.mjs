// Modelo puro del recorrido de una terminal: qué hace, en qué fase va, a quién delegó y qué le impide avanzar.
// Solo consume datos ya existentes (node.data.plan, node.data.agent[.run], mensajes del chat, controllers);
// no abre transportes ni inventa eventos: un socket futuro solo cambia los argumentos y se vuelve a calcular.
//
// terminalJourney({ node, screenState, connected = true, messages = [], running = false, controllers = [], now = Date.now() })
// → {
//   tone:           'attention' | 'working' | 'idle' | 'review' | 'error' | 'unknown',
//   statusLabel:    string,                     // una frase corta; nunca vacía
//   needsAttention: boolean,                    // true solo si espera una decisión de la persona
//   activity:       null | { label, detail, source: 'request'|'tool'|'run'|'step', status, at, age, warning },
//                   //   label: propósito cotidiano; detail: texto técnico original (comando, ruta);
//                   //   status: 'running'|'done'|'error'|'stopped'|''; at: ms o null; age: '12 s' o ''
//   phases:         [{ key, label, kind, status, detail, current, taskId }],
//                   //   status: 'done'|'current'|'blocked'|'pending'|'stopped'|'unknown'; vacío si no hay plan ni run
//   delegates:      { total, running, items: [{ key, id, source: 'subagent'|'child'|'task', type, label, status, statusLabel, activity }] },
//                   //   status: 'running'|'done'|'error'|'stopped'|'blocked'|'pending'|'unknown'
//   blocker:        null | { kind: 'decision'|'human'|'recovery'|'wait'|'unknown', title, summary, remedy, commands, retryAt, autonomy },
//   lastEventAt:    string ISO | null,          // la señal más reciente conocida; null si no hay ninguna
// }
// Precedencia del estado: petición pendiente (permiso > pregunta > turno del usuario) > bloqueo del run >
// fin de run > run vivo > trabajo declarado > reposo > desconocido. Sin conexión no se deduce nada vivo.
import { runProgressView, formatDuration } from './run-progress-view.mjs';
import { phaseState } from './plan-view.mjs';
import { phantomCallKind, PHANTOM_CALL_LABEL } from './phantom-run-link.mjs';

const list = value => Array.isArray(value) ? value : [];
const when = value => { const t = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(t) ? t : null; };
const clean = (value, max = 240) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const ageOf = (at, now) => at == null ? '' : formatDuration(Math.max(0, now - at));

const TOOL_VERBS = [
  [/^(read|view|cat|notebookread)/, 'Leyendo', 'Leyó'], [/^(edit|multiedit|write|patch|apply|notebookedit)/, 'Editando', 'Editó'],
  [/^(bash|shell|exec|run)/, 'Ejecutando un comando', 'Ejecutó un comando'], [/^(grep|glob|search|list|ls|find|toolsearch)/, 'Buscando', 'Buscó'],
  [/^(web|fetch)/, 'Consultando la web', 'Consultó la web'], [/^(task|agent)/, 'Delegando', 'Delegó'],
  [/^(check|verify)$/, 'Verificando', 'Verificó'], [/^todo/, 'Actualizando el plan', 'Actualizó el plan'],
];
// Las llamadas a Phantom se nombran con el mismo vocabulario que la fila de herramienta del chat (phantom-run-link).
function describe(name, detail, live) {
  const tool = clean(name, 120), tech = clean(detail), lower = tool.toLowerCase();
  const call = phantomCallKind({ type: 'tool', name: tool, input: tech || undefined, detail: tech });
  if (call) return { label: PHANTOM_CALL_LABEL[call], detail: tech || tool, phantom: true };
  const known = TOOL_VERBS.find(([pattern]) => pattern.test(lower));
  if (known) return { label: known[live ? 1 : 2], detail: tech, phantom: false };
  return { label: tool ? `${live ? 'Usando' : 'Usó'} ${tool}` : '', detail: tech, phantom: false };
}

const TOOL_STATUS = { running: 'running', done: 'done', completed: 'done', error: 'error', failed: 'error', stopped: 'stopped' };

function requestsOf(messages) {
  const found = { permission: null, question: null };
  for (const message of list(messages)) for (const part of list(message?.parts)) {
    if (part?.status !== 'pending' || (part.type !== 'permission' && part.type !== 'question')) continue;
    found[part.type] = { part, at: when(message.createdAt) };
  }
  return found;
}

function toolsOf(messages) {
  let live = null, last = null;
  for (const message of list(messages)) for (const part of list(message?.parts)) {
    if (part?.type !== 'tool' || part.agent || typeof part.name !== 'string') continue;
    const entry = { part, at: when(message.createdAt) };
    last = entry;
    if (part.status === 'running' && message.status === 'streaming') live = entry;
  }
  return { live, last };
}

function activityOf({ requests, tools, run, agent, now }) {
  const candidates = [];
  const request = requests.permission || requests.question;
  if (request) {
    const { part, at } = request;
    const question = clean(part.questions?.[0]?.question, 240);
    candidates.push({ rank: 0, source: 'request', label: part.type === 'permission' ? `Pide permiso${part.tool ? ` para ${clean(part.tool, 80)}` : ''}` : 'Hace una pregunta', detail: part.type === 'permission' ? clean(part.detail) : question, status: '', at });
  }
  if (tools.live) {
    const { part, at } = tools.live, text = describe(part.name, part.detail || part.input?.command || part.input?.cmd, true);
    candidates.push({ rank: 1, source: 'tool', label: text.label, detail: text.detail, status: 'running', at });
  }
  const runText = clean(run?.activity);
  if (runText) {
    const [head, ...rest] = runText.split(' · ');
    const text = describe(head, rest.join(' · '), !['completed', 'blocked', 'cancelled'].includes(run.phase));
    candidates.push({ rank: 2, source: 'run', label: text.label || runText, detail: text.label ? text.detail : '', status: '', at: when(run.lastEventAt) });
  }
  const step = clean(agent?.step);
  if (step) candidates.push({ rank: 3, source: 'step', label: step, detail: '', status: '', at: when(agent.updatedAt) });
  if (tools.last && !tools.live) {
    const { part, at } = tools.last, text = describe(part.name, part.detail || part.input?.command || part.input?.cmd, false);
    candidates.push({ rank: 4, source: 'tool', label: text.label, detail: text.detail, status: part.status === 'running' ? '' : TOOL_STATUS[part.status] || '', at });
  }
  const pool = candidates.filter(item => item.rank === 0).length ? candidates.filter(item => item.rank === 0) : candidates.filter(item => item.rank === 1).length ? candidates.filter(item => item.rank === 1) : candidates;
  const best = pool.reduce((top, item) => !top || (item.at ?? -Infinity) > (top.at ?? -Infinity) || ((item.at ?? -Infinity) === (top.at ?? -Infinity) && item.rank < top.rank) ? item : top, null);
  return best && best.label ? { label: best.label, detail: best.detail, source: best.source, status: best.status, at: best.at, age: ageOf(best.at, now), warning: '' } : null;
}

const PLAN_STATUS = { done: 'done', running: 'current', blocked: 'blocked', pending: 'pending' };
const KINDS = [[/discover|descubr|explor|investig/, 'discovery'], [/plan/, 'planning'], [/check/, 'checks'], [/judge|juez|review|revis/, 'judge'], [/repair|repar/, 'repair'], [/integra|merge/, 'integration'], [/develop|desarrol|implement/, 'develop']];
const kindOf = phase => { const text = `${phase.kind || ''} ${phase.key || ''} ${phase.title || ''}`.toLowerCase(); return KINDS.find(([pattern]) => pattern.test(text))?.[1] || 'step'; };

function planPhases(plan, view) {
  const phases = list(plan?.phases);
  if (!phases.length) return null;
  const running = phases.findIndex(phase => phase.status === 'running'), focus = running >= 0 ? running : phases.findIndex(phase => phase.status === 'blocked');
  return phases.map((phase, index) => {
    const status = PLAN_STATUS[phase.status] || 'unknown';
    const live = index === focus && view && !view.terminal && phase.taskId && phase.taskId === view.taskId;
    return {
      key: String(phase.key ?? index), label: clean(phase.title, 80) || `Fase ${index + 1}`, kind: kindOf(phase), status,
      detail: live ? view.label : status === 'blocked' && phase.note ? clean(phase.note) : PLAN_STATUS[phase.status] ? phaseState(phase) : '',
      current: index === focus, taskId: phase.taskId ? String(phase.taskId) : '',
    };
  });
}

// Solo etapas con evidencia: la fase real del run y las rondas de reparación contadas; nada más se da por hecho.
function runPhases(run, view) {
  const item = (key, label, kind, status, detail = '') => ({ key, label, kind, status, detail, current: status === 'current' || status === 'blocked', taskId: '' });
  const out = [], round = Math.max(0, Number(run.round) || 0), phase = view.phase;
  if (!view.terminal) {
    if (phase === 'waiting') return [item('waiting', 'Espera', 'wait', 'current', 'Esperando eventos')];
    out.push(item('agent', 'Desarrollo', 'develop', phase === 'agent' ? 'current' : 'pending'));
    out.push(item('checks', 'Checks', 'checks', phase === 'checks' ? 'current' : 'pending'));
    if (phase === 'repair' || round > 0) out.push(item('repair', 'Reparación', 'repair', phase === 'repair' ? 'current' : 'done', `${Math.max(1, round)} ${Math.max(1, round) === 1 ? 'ronda' : 'rondas'}`));
    out.push(item('judge', 'Juez', 'judge', phase === 'judge' ? 'current' : 'pending'));
    if (phase === 'children' || view.children.total > 0) out.push(item('children', 'Hijos', 'children', phase === 'children' ? 'current' : 'pending', view.children.total ? `${view.children.done} de ${view.children.total}` : ''));
    return out;
  }
  if (round > 0) out.push(item('repair', 'Reparación', 'repair', 'done', `${round} ${round === 1 ? 'ronda' : 'rondas'}`));
  if (view.children.total > 0) out.push(item('children', 'Hijos', 'children', 'pending', `${view.children.done} de ${view.children.total}`));
  if (phase === 'completed') out.push(item('completed', 'Terminado', 'end', 'done', 'Sin datos de integración'));
  else if (phase === 'blocked') out.push(item('blocked', 'Bloqueado', 'end', 'blocked', view.blocker?.title || ''));
  else out.push(item('cancelled', 'Cancelado', 'end', 'stopped'));
  return out;
}

const DELEGATE_STATUS = { running: ['running', 'En curso'], starting: ['running', 'En curso'], done: ['done', 'Listo'], completed: ['done', 'Listo'], error: ['error', 'Falló'], failed: ['error', 'Falló'], lost: ['error', 'Perdido'], stopped: ['stopped', 'Detenido'], cancelled: ['stopped', 'Cancelado'], blocked: ['blocked', 'Bloqueado'], pending: ['pending', 'Pendiente'], waiting: ['pending', 'Pendiente'] };
const statusOf = value => DELEGATE_STATUS[value] || ['unknown', 'Sin estado'];

function delegatesOf({ nodeId, messages, run, controllers }) {
  const byKey = new Map();
  // Misma identidad = una sola fila; la observación más reciente (última en el orden recibido) prevalece.
  const add = item => { const [status, statusLabel] = statusOf(item.raw); byKey.set(item.key, { key: item.key, id: item.id, source: item.source, type: item.type || '', label: item.label, status, statusLabel, activity: item.activity || '' }); };
  for (const message of list(messages)) for (const part of list(message?.parts)) {
    if (part?.type !== 'tool' || !part.agent || typeof part.agent !== 'object' || Array.isArray(part.agent) || part.id == null || part.id === '') continue;
    const steps = list(part.agent.steps), step = part.status === 'running' ? steps.findLast(entry => entry.status === 'running') || steps.at(-1) : null;
    add({ key: `subagent:${part.id}`, id: String(part.id), source: 'subagent', type: typeof part.agent.type === 'string' ? part.agent.type : '', label: clean(part.detail || part.name, 160), raw: part.status, activity: step ? clean(`${step.name || ''} ${step.detail || ''}`) : '' });
  }
  for (const child of list(run?.children?.items)) if (child?.key != null) add({ key: `child:${child.key}`, id: String(child.key), source: 'child', label: clean(String(child.key), 160), raw: child.status, activity: clean(child.activity) });
  for (const controller of list(controllers)) {
    if (!controller || typeof nodeId !== 'string' || !nodeId || controller.origin?.nodeId !== nodeId || (run?.taskId && controller.taskId === run.taskId)) continue;
    const id = String(controller.taskId || controller.id || '');
    if (id) add({ key: `task:${id}`, id, source: 'task', type: 'Phantom', label: clean(controller.title || controller.goal || id, 160), raw: controller.status });
  }
  const items = [...byKey.values()].sort((a, b) => (b.status === 'running') - (a.status === 'running'));
  return { total: items.length, running: items.filter(item => item.status === 'running').length, items };
}

const BLOCKER_KIND = { ask_user: 'decision', human: 'human', auto: 'recovery', orchestrator: 'wait' };
const WAITING = { auto: 'Se recupera sola', orchestrator: 'Espera al orquestador' };

export function terminalJourney({ node, screenState, connected = true, messages = [], running = false, controllers = [], now = Date.now() } = {}) {
  const data = node?.data || {}, agent = data.agent || {}, run = agent.run && typeof agent.run === 'object' ? agent.run : null;
  const view = run ? runProgressView(run, now) : null;
  const requests = requestsOf(messages), tools = toolsOf(messages);
  const blocker = view?.blocker ? {
    kind: BLOCKER_KIND[view.blocker.autonomy] || 'unknown', title: view.blocker.title, summary: view.blocker.summary, remedy: view.blocker.remedy,
    commands: view.blocker.commands, retryAt: view.blocker.retryAt, autonomy: BLOCKER_KIND[view.blocker.autonomy] ? view.blocker.autonomy : '',
  } : null;
  const screen = connected ? screenState : undefined;
  const declared = agent.status;
  let tone, statusLabel, needsAttention = false;
  if (requests.permission || screen === 'awaiting_approval') { tone = 'attention'; statusLabel = 'Pide permiso'; needsAttention = true; }
  else if (requests.question) { tone = 'attention'; statusLabel = 'Hace una pregunta'; needsAttention = true; }
  else if (screen === 'awaiting_input' && declared !== 'blocked') { tone = 'attention'; statusLabel = 'Terminó · tu turno'; needsAttention = true; }
  else if (blocker) {
    if (blocker.kind === 'decision') { tone = 'attention'; statusLabel = `Necesita tu decisión · ${blocker.title}`; needsAttention = true; }
    else if (blocker.kind === 'human' || blocker.kind === 'unknown') { tone = 'error'; statusLabel = `Bloqueado · ${blocker.title}`; }
    else { tone = 'idle'; statusLabel = `${WAITING[blocker.autonomy]}${blocker.retryAt ? ` · reintento ${blocker.retryAt}` : ''}`; }
  } else if (view?.terminal) {
    if (view.phase === 'completed') { tone = 'review'; statusLabel = 'Terminó'; }
    else if (view.phase === 'cancelled') { tone = 'idle'; statusLabel = 'Cancelado'; }
    else { tone = 'error'; statusLabel = 'Bloqueado'; }
  } else if (!connected) { tone = 'unknown'; statusLabel = 'Sin conexión'; }
  else if (view) { tone = view.tone === 'error' ? 'error' : view.tone === 'idle' ? 'idle' : 'working'; statusLabel = view.phase === 'waiting' ? 'Espera eventos' : view.phase === 'children' ? 'Hijos en curso' : view.label; }
  else if (running || screen === 'working' || declared === 'working') { tone = 'working'; statusLabel = 'Trabajando'; }
  else if (declared === 'blocked') { tone = 'attention'; statusLabel = 'Declaró un bloqueo'; needsAttention = true; }
  else if (declared === 'review') { tone = 'review'; statusLabel = 'Lista para revisar'; }
  else if (declared === 'idle' || screen === 'awaiting_input') { tone = 'idle'; statusLabel = 'En reposo'; }
  else { tone = 'unknown'; statusLabel = 'Sin datos'; }

  const activity = activityOf({ requests, tools, run, agent, now });
  if (activity && view?.warning) activity.warning = view.warning;
  const phases = planPhases(data.plan, view) || (run && view ? runPhases(run, view) : []);
  const stamps = [when(run?.lastEventAt), when(agent.updatedAt), activity?.at ?? null, ...list(messages).map(message => when(message?.createdAt))].filter(value => value != null);
  return {
    tone, statusLabel, needsAttention,
    activity: activity || (view?.warning ? { label: view.warning, detail: '', source: 'run', status: '', at: null, age: '', warning: view.warning } : null),
    phases, delegates: delegatesOf({ nodeId: node?.id, messages, run, controllers }), blocker,
    lastEventAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
  };
}
