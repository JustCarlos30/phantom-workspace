import { lastLine, duration, statusLabel, statusTone, phaseOf, runsOf, checkResult } from './phantom-desk.mjs';
import { contractOf, goalOf, stateOf } from './plugin-model.mjs';

const textOf = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const commandOf = part => typeof part.input === 'object' && part.input ? part.input.command || part.input.cmd || part.detail : part.input || part.detail;

export function phantomRunIds(part) {
  if (part?.type !== 'tool' || !/^(bash|shell|exec|run)/i.test(part.name || '')) return [];
  const aliases = new Map();
  const command = textOf(commandOf(part)).replace(/(?:^|[;|&(\n])\s*([A-Za-z_][A-Za-z0-9_]*)=("?)\$(?:\{(PHANTOM_AGENT_(?:CLI|NODE))\}|(PHANTOM_AGENT_(?:CLI|NODE)))\2(?=\s|[;|&)]|$)|\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (match, alias, quote, braced, plain, bracedRef, plainRef) => {
    if (alias) {
      aliases.set(alias, braced || plain);
      return match;
    }
    const target = aliases.get(bracedRef || plainRef);
    return target ? `$${target}` : match;
  });
  if (!/(?:^|[;|&(\n]|\b(?:do|then|while|until|if)\s+)\s*(?:["']?(?:[^\s;|&()]*\/)?phantom["']?\s+(?:run|show|events|do|create|card)\b|(?:["']?(?:(?:[^\s;|&()]*\/)?node|\$(?:PHANTOM_AGENT_NODE|\{PHANTOM_AGENT_NODE\}))["']?\s+)?(?:["']?[^\s;|&()]*agent\.mjs["']?|"?\$(?:PHANTOM_AGENT_CLI|\{PHANTOM_AGENT_CLI\})"?)\s+(?:run|bind)\b)/.test(command)) return [];
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
  return {
    goal: goalOf(native), status, label: statusLabel(status), tone: statusTone(status),
    model: run?.requestedModel,
    ...(typeof run?.turns === 'number' ? { turns: run.turns } : {}),
    ...(typeof run?.tools === 'number' ? { tools: run.tools } : {}),
    phase: phaseOf({ ...native, run: run || native.run }),
    live: ['ready', 'running', 'verifying', 'recovering'].includes(status) || controller?.status === 'running',
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
