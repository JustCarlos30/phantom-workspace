import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_REROUTES = 3;
export const MAX_INHIBIT_MS = 12 * 3600000;
export const WAIT_MARGIN_MS = 120000;

// Equivalentes por cliente/modelo, en orden de preferencia. Los modelos Claude solo existen en claude-code;
// opencode nunca recibe un modelo Claude.
export const MODEL_EQUIVALENTS = {
  'claude-code': {
    opus: [{ client: 'codex', model: 'gpt-5-high' }, { client: 'opencode', model: 'glm-4.6' }],
    sonnet: [{ client: 'codex', model: 'gpt-5' }, { client: 'opencode', model: 'glm-4.6' }],
    haiku: [{ client: 'codex', model: 'gpt-5-mini' }, { client: 'opencode', model: 'glm-4.5-air' }],
  },
  codex: {
    'gpt-5-high': [{ client: 'claude-code', model: 'opus' }, { client: 'opencode', model: 'glm-4.6' }],
    'gpt-5': [{ client: 'claude-code', model: 'sonnet' }, { client: 'opencode', model: 'glm-4.6' }],
    'gpt-5-mini': [{ client: 'claude-code', model: 'haiku' }, { client: 'opencode', model: 'glm-4.5-air' }],
  },
  opencode: {
    'glm-4.6': [{ client: 'claude-code', model: 'sonnet' }, { client: 'codex', model: 'gpt-5' }],
    'glm-4.5-air': [{ client: 'claude-code', model: 'haiku' }, { client: 'codex', model: 'gpt-5-mini' }],
  },
};

const isClaude = (model) => /claude|^(opus|sonnet|haiku)\b/i.test(String(model || ''));
const validTarget = (t) => t.client === 'claude-code' || !isClaude(t.model);
const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

function healthy(p) {
  if (!p) return false;
  if (p.available === false) return false;
  if (p.status === 'rate_limited' || p.status === 'error') return false;
  return !(p.windows || []).some((w) => Number(w.percent) >= 100);
}

function resetTime(provider) {
  const exhausted = (provider?.windows || []).filter((w) => Number(w.percent) >= 100 && ms(w.resetsAt) !== null).map((w) => ms(w.resetsAt));
  if (exhausted.length) return Math.max(...exhausted);
  const any = (provider?.windows || []).map((w) => ms(w.resetsAt)).filter((t) => t !== null);
  return any.length ? Math.min(...any) : null;
}

// providers: { [client]: { status, available, retryAt, windows:[{percent,resetsAt}] } }
export function decideRoute({ task = {}, blocker = {}, providers = {}, enabledEngines = [], reroutes = 0, now = Date.now() } = {}) {
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  if (reroutes < MAX_REROUTES) {
    const visited = new Set([task.client, ...(task.visited || [])]);
    const target = (MODEL_EQUIVALENTS[task.client]?.[task.model] || []).find((t) =>
      validTarget(t) && !visited.has(t.client) && enabledEngines.includes(t.client) && healthy(providers[t.client]));
    if (target) return { action: 'reroute', to: { client: target.client, model: target.model } };
  }
  const retry = ms(blocker.retryAt);
  const reset = resetTime(providers[task.client]);
  const notBefore = retry !== null ? retry : reset !== null ? reset + WAIT_MARGIN_MS : null;
  if (notBefore === null) return { action: 'notify', reason: 'sin motor sano ni hora de reintento conocida' };
  return { action: 'wait', notBefore: new Date(notBefore).toISOString(), inhibit: notBefore - nowMs <= MAX_INHIBIT_MS };
}

export function createQuotaQueue({ file, now = Date.now } = {}) {
  const read = () => {
    try { const v = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(v.items) ? v.items : []; }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  };
  const write = (items) => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2));
    renameSync(tmp, file);
  };
  return {
    enqueue(entry) {
      if (!entry?.taskId || ms(entry.notBefore) === null) throw new Error('quota-queue: taskId y notBefore ISO requeridos');
      const items = read().filter((i) => i.taskId !== entry.taskId);
      const item = { ...entry, enqueuedAt: new Date(now()).toISOString() };
      items.push(item);
      write(items);
      return item;
    },
    due() { const t = now(); return read().filter((i) => ms(i.notBefore) <= t); },
    complete(taskId) {
      const items = read();
      const rest = items.filter((i) => i.taskId !== taskId);
      if (rest.length === items.length) return false;
      write(rest);
      return true;
    },
    list() { return read(); },
  };
}
