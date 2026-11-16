import { lastLine, duration, statusLabel, statusTone, phaseOf, runsOf, checkResult } from './phantom-desk.mjs';
import { contractOf, goalOf, stateOf } from './plugin-model.mjs';

const textOf = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const commandOf = part => typeof part.input === 'object' && part.input ? part.input.command || part.input.cmd || part.detail : part.input || part.detail;

export function phantomRunIds(part) {
  if (part?.type !== 'tool' || !/^(bash|shell|exec|run)/i.test(part.name || '')) return [];
  const command = textOf(commandOf(part));
  if (!/(?:^|[;|&(\n]|\b(?:do|then|while|until|if)\s+)\s*(?:["']?(?:[^\s;|&()]*\/)?phantom["']?\s+(?:run|show|events|do|create)\b|(?:["']?(?:[^\s;|&()]*\/)?node["']?\s+)?["']?[^\s;|&()]*agent\.mjs["']?\s+(?:run|bind)\b)/.test(command)) return [];
  return [...new Set([part.detail, part.input, part.output].flatMap(value => textOf(value).match(/\b(?:task|card)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) || []))];
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
    phase: phaseOf({ ...native, run: run || native.run }),
    live: ['ready', 'running', 'verifying', 'recovering'].includes(status) || controller?.status === 'running',
    duration: duration(run?.startedAt || controller?.startedAt || controller?.createdAt, run?.endedAt || controller?.endedAt, now),
    line: lastLine(controller?.output), output: typeof controller?.output === 'string' ? controller.output.slice(-4000) : '',
    checks, passed: results.filter(check => check.passed === true && check.executed !== false).length, total: checks.length,
  };
}
