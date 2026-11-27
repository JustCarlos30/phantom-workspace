import { lastLine, duration, statusLabel, statusTone, phaseOf, runsOf, checkResult, titleOf, explainReason } from './phantom-desk.mjs';
import { contractOf, goalOf, stateOf } from './plugin-model.mjs';

const textOf = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const commandOf = part => typeof part.input === 'object' && part.input ? part.input.command || part.input.cmd || part.detail : part.input || part.detail;

const SHELL_TOOL = /^(bash|shell|exec|run)/i;
// The structured MCP tool phantom_workspace.phantom (any provider prefix/separator).
const MCP_PHANTOM = /^(?:mcp[_.:-]+)?phantom[_.:-]workspace[_.:-]+phantom$/i;
const FULL_ID = /^(?:task|card)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHELL_PHANTOM = /(?:^|[;|&(\n]|\b(?:do|then|while|until|if)\s+)\s*(?:["']?(?:[^\s;|&()]*\/)?phantom["']?\s+(run|show|events|do|create|card)\b|(?:["']?(?:(?:[^\s;|&()]*\/)?node|\$(?:PHANTOM_AGENT_NODE|\{PHANTOM_AGENT_NODE\}))["']?\s+)?(?:["']?[^\s;|&()]*agent\.mjs["']?|"?\$(?:PHANTOM_AGENT_CLI|\{PHANTOM_AGENT_CLI\})"?)\s+(run|bind)\b)/;

// {cli:'agent', args:[run|bind, id]} as the host recorded it; only the literal action and a complete ID count.
function structuredCall(part) {
  if (!MCP_PHANTOM.test(part.name || '')) return null;
  let input = part.input;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { return null; } }
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.cli !== 'agent' || !Array.isArray(input.args) || !input.args.every(arg => typeof arg === 'string')) return null;
  const [action, id] = input.args;
  if (action !== 'run' && action !== 'bind') return null;
  return { action, ids: FULL_ID.test(id || '') ? [id] : [] };
}

const KIND_OF = { run: 'assignment', do: 'assignment', create: 'create', bind: 'bind' };
export const PHANTOM_CALL_LABEL = { assignment: 'Encargo a Phantom', create: 'Creación en Phantom', bind: 'Vínculo con Phantom', query: 'Consulta a Phantom' };
// What a Phantom tool call really is: a query is not an assignment, and none is a sub-agent.
export function phantomCallKind(part) {
  if (part?.type !== 'tool') return null;
  const structured = structuredCall(part);
  if (structured) return KIND_OF[structured.action];
  if (MCP_PHANTOM.test(part.name || '')) return 'query';
  const shell = SHELL_TOOL.test(part.name || '') ? shellCommand(part) : null;
  if (shell) return KIND_OF[shell.action] || 'query';
  return /phantom[._:-]/i.test(part.name || '') ? 'query' : null;
}

function shellCommand(part) {
  const aliases = new Map();
  const command = textOf(commandOf(part)).replace(/(?:^|[;|&(\n])\s*([A-Za-z_][A-Za-z0-9_]*)=("?)\$(?:\{(PHANTOM_AGENT_(?:CLI|NODE))\}|(PHANTOM_AGENT_(?:CLI|NODE)))\2(?=\s|[;|&)]|$)|\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (match, alias, quote, braced, plain, bracedRef, plainRef) => {
    if (alias) {
      aliases.set(alias, braced || plain);
      return match;
    }
    const target = aliases.get(bracedRef || plainRef);
    return target ? `$${target}` : match;
  });
  const match = SHELL_PHANTOM.exec(command);
  return match ? { command, action: match[1] || match[2] } : null;
}

const CLI_CALL = /(?:\$\{?PHANTOM_AGENT_CLI\}?|[^\s"']*agent\.mjs|(?:^|\s)(?:[^\s"']*\/)?phantom)["']?\s+(\S[^;|&\n]*)/g;
const ID_ANY = /\b(?:task|card)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const argWords = text => text.split(/\s+/).map(word => word.replace(/^["']+|["']+$/g, '')).filter(Boolean);

// Short readable summary of a Phantom call ("context · list", "run task_9eb4db96"); never exposes $PHANTOM_AGENT_* variables.
export function phantomCallSummary(part) {
  if (part?.type !== 'tool') return '';
  let calls = [];
  const structured = structuredCall(part);
  if (structured || MCP_PHANTOM.test(part.name || '')) {
    let input = part.input;
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = null; } }
    if (Array.isArray(input?.args)) calls = [input.args.filter(arg => typeof arg === 'string')];
  } else if (SHELL_TOOL.test(part.name || '')) {
    const command = textOf(commandOf(part));
    calls = [...command.matchAll(CLI_CALL)].map(match => argWords(match[1]));
  } else return '';
  const seen = new Set(), parts = [];
  for (const words of calls) {
    const action = words.find(word => /^[a-z][a-z-]*$/.test(word));
    if (!action) continue;
    const rest = words.slice(words.indexOf(action) + 1).filter(word => !word.startsWith('-') && !word.startsWith('$'));
    const id = rest.map(word => word.match(ID_ANY)?.[0]).find(Boolean);
    const file = rest.find(word => /\.[A-Za-z0-9]{1,8}$/.test(word) && !ID_ANY.test(word));
    const target = id ? id.slice(0, 13) : file ? file.split('/').pop() : '';
    const text = target ? `${action} ${target}` : action;
    if (!seen.has(text)) { seen.add(text); parts.push(text); }
  }
  return parts.slice(0, 3).join(' · ');
}

export function phantomRunIds(part) {
  if (part?.type !== 'tool') return [];
  const structured = structuredCall(part);
  if (structured) return structured.ids;
  if (!SHELL_TOOL.test(part.name || '')) return [];
  const shell = shellCommand(part);
  if (!shell) return [];
  const { command } = shell;
  const ids = value => textOf(value).match(/\b(?:task|card)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) || [];
  const found = [part.detail, part.input].flatMap(ids), output = ids(part.output);
  if (/phantom["']?\s+(?:create|card|do)\b/.test(command)) found.push(...output);
  else if (!found.length && /(?:phantom["']?\s+(?:show|run|events)|(?:agent\.mjs|PHANTOM_AGENT_CLI\}?)["']?\s+(?:run|bind))\s+["']?\$/.test(command) && output.length) found.push(output[0]);
  return [...new Set(found)];
}

// One entry per task id for the whole turn, in first-seen order.
export const turnRunIds = parts => [...new Set((parts || []).flatMap(phantomRunIds))];

const LINKED = { running: ['En ejecución', 'live'], verifying: ['En ejecución', 'live'], recovering: ['En ejecución', 'live'], review: ['En revisión', 'review'], in_review: ['En revisión', 'review'], blocked: ['Bloqueada', 'blocked'], failed: ['Fallida', 'blocked'] };
// Real Phantom status for the card linked to a terminal; null when it is not one worth showing.
export function linkedRunBadge(status, startedAt, now = Date.now()) {
  const entry = LINKED[status];
  if (!entry) return null;
  return { label: entry[0], tone: entry[1], elapsed: duration(startedAt, undefined, now) };
}

// Verdict of one evidence round, only from recorded check results.
const roundState = round => {
  const checks = Array.isArray(round?.checks) ? round.checks : [];
  if (checks.some(check => check.passed === false)) return 'failed';
  if (checks.length && checks.every(check => check.passed === true && check.executed !== false)) return 'done';
  return 'unknown';
};
const PHASE_TEXT = { pending: 'Pendiente', unobserved: 'No observada', current: 'En curso', failed: 'Falló', done: 'Completada', unknown: 'Sin resultado', blocked: 'Bloqueada', cancelled: 'Cancelada' };

// Four phases from real evidence only; a later phase never vouches for an earlier one.
export function phasesOf({ run, status, live, controllerEnded }) {
  const baseline = run?.evidence?.baseline, rounds = (run?.evidence?.verification || []).filter(round => round?.available);
  const lastRound = rounds.at(-1);
  const prep = baseline?.available ? roundState(baseline) : live && !run ? 'current' : 'unobserved';
  const exec = !run ? 'unobserved' : run.endedAt ? 'done' : live && !lastRound ? 'current' : run.startedAt ? 'unknown' : 'unobserved';
  const verify = lastRound ? roundState(lastRound) : status === 'verifying' ? 'current' : 'unobserved';
  const result = status === 'completed' ? 'done' : status === 'failed' ? 'failed' : status === 'blocked' ? 'blocked' : status === 'cancelled' ? 'cancelled' : live ? 'pending' : controllerEnded ? 'unknown' : 'pending';
  const detail = { result: controllerEnded && !live && status !== 'completed' ? 'El controlador terminó sin aceptación de Phantom' : undefined };
  return [['prep', 'Pruebas iniciales', prep], ['exec', 'Ejecución', exec], ['verify', 'Verificación', verify], ['result', 'Resultado', result]]
    .map(([key, label, state]) => ({ key, label, state, text: PHASE_TEXT[state], ...(detail[key] ? { detail: detail[key] } : {}) }));
}

export function summarizePhantomRun(value, controllers = [], id, now = Date.now()) {
  const native = value?.task || value || {}, run = runsOf(value)[0];
  const related = controllers.filter(item => item.taskId === id);
  const controller = related.findLast(item => item.status === 'running') || related.at(-1);
  const status = stateOf(native);
  const evidence = run?.evidence;
  const latest = evidence?.verification?.filter(round => round.available).at(-1) || (evidence?.baseline?.available ? evidence.baseline : null);
  const declared = contractOf(native).checks || [];
  const results = latest?.checks || [];
  const checks = (results.length ? results : declared).map(check => ({ ...check, result: results.length ? checkResult(check) : 'Sin resultado' }));
  const live = ['ready', 'running', 'verifying', 'recovering'].includes(status) || controller?.status === 'running';
  const reason = typeof native.reason === 'string' ? native.reason.trim() : '';
  const stuck = ['blocked', 'failed'].includes(status) && controller?.status !== 'running';
  return {
    goal: goalOf(native), title: titleOf(goalOf(native)) || id || '', status, label: statusLabel(status), tone: statusTone(status),
    phases: phasesOf({ run, status, live: live && status !== 'ready', controllerEnded: Boolean(controller) && controller.status !== 'running' }),
    blocker: stuck ? { status, ...explainReason(reason), reason } : null,
    model: run?.requestedModel,
    ...(typeof run?.turns === 'number' ? { turns: run.turns } : {}),
    ...(typeof run?.tools === 'number' ? { tools: run.tools } : {}),
    phase: phaseOf({ ...native, run: run || native.run }),
    live,
    duration: duration(run?.startedAt || controller?.startedAt || controller?.createdAt, run?.endedAt || controller?.endedAt, now),
    line: lastLine(controller?.output), output: typeof controller?.output === 'string' ? controller.output.slice(-4000) : '',
    checks, passed: results.filter(check => check.passed === true && check.executed !== false).length, total: checks.length,
  };
}

export function summarizePhantomActivity(activity, workspace) {
  const labels = { check: 'Check', verify: 'Verificar', read: 'Leer', grep: 'Buscar', glob: 'Buscar', list: 'Buscar', edit: 'Editar', write: 'Editar', apply_patch: 'Editar', patch: 'Editar', bash: 'Ejecutar', shell: 'Ejecutar', webfetch: 'Web', task: 'Agente' };
  const prefix = typeof workspace === 'string' && workspace ? `${workspace.replace(/\/$/, '')}/` : '';
  const mapSteps = items => items.map(item => {
    const kind = String(item.tool || '').toLowerCase();
    return { id: item.id, kind, label: labels[kind] || item.tool, detail: prefix ? String(item.target || '').split(prefix).join('') : String(item.target || ''), status: item.status };
  });
  const steps = activity?.available && Array.isArray(activity.items) ? mapSteps(activity.items) : [];
  const runs = activity?.available && Array.isArray(activity.runs) ? activity.runs.map(run => {
    const steps = mapSteps(run.steps || []), total = Math.max(run.total || 0, steps.length);
    return { ...run, steps, total, hidden: total - steps.length, current: steps.findLast(step => step.status === 'running') || null };
  }) : [];
  const total = activity?.available ? Math.max(activity.total || 0, steps.length) : 0;
  return { steps, total, hidden: total - steps.length, current: steps.findLast(step => step.status === 'running') || null, runs, reason: activity?.available ? activity.reason ?? null : null };
}
