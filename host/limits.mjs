// Plan limits of the subscriptions the agent CLIs are signed in with. Each CLI
// already stores an OAuth session on disk; the host reads it, asks the
// provider's own usage endpoint, and returns percentages and reset times only.
// Tokens never leave this process and are never refreshed or written here: an
// expired session is reported so the user reopens the CLI that owns it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT_MS = 10000;
export const LIMITS_TTL_MS = 4 * 60000;
export const TRANSIENT_RETRY_MS = 60000;
const RATE_DEFAULT_MS = 5 * 60000;
const RATE_MAX_MS = 30 * 60000;
const POKE_MIN_MS = 30000;

export function parseRetryAfter(value, now = Date.now()) {
  let ms = NaN;
  if (value != null && String(value).trim() !== '') {
    const text = String(value).trim();
    ms = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  }
  if (!Number.isFinite(ms) || ms <= 0) return RATE_DEFAULT_MS;
  return Math.min(ms, RATE_MAX_MS);
}

function failure(base, error, rejectedReason, name) {
  if (error.unauthorized) return { ...base, available: false, status: 'rejected', reason: rejectedReason };
  if (error.rateLimited) return { ...base, available: false, status: 'rate_limited', reason: `${name} limitó las consultas de uso (429). Se reintentará más tarde.`, retryAfterMs: error.retryAfterMs };
  return { ...base, available: false, status: 'error', reason: error.message };
}

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const finite = value => (Number.isFinite(value) ? value : null);
const iso = value => { const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };

async function getJson(fetchImpl, url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (response.status === 401 || response.status === 403) { const error = new Error('unauthorized'); error.unauthorized = true; throw error; }
    if (response.status === 429) { const error = new Error('rate limited'); error.rateLimited = true; error.retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after')); throw error; }
    if (!response.ok) throw new Error(`El proveedor respondió ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('El proveedor tardó demasiado en responder');
    throw error;
  } finally { clearTimeout(timer); }
}

const CLAUDE_KINDS = { session: 'Sesión · 5 h', weekly_all: 'Semanal · todos los modelos' };
export function claudeWindows(usage) {
  if (Array.isArray(usage?.limits) && usage.limits.length) {
    return usage.limits.filter(limit => Number.isFinite(limit?.percent)).map(limit => ({
      id: [limit.kind, limit.scope?.model?.display_name].filter(Boolean).join(':'),
      label: CLAUDE_KINDS[limit.kind] || (limit.kind === 'weekly_scoped' && limit.scope?.model?.display_name ? `Semanal · ${limit.scope.model.display_name}` : String(limit.kind || 'Límite')),
      percent: limit.percent,
      resetsAt: iso(limit.resets_at),
      severity: typeof limit.severity === 'string' ? limit.severity : null,
    }));
  }
  // Older responses carry only the named windows.
  return [['five_hour', 'Sesión · 5 h'], ['seven_day', 'Semanal · todos los modelos'], ['seven_day_opus', 'Semanal · Opus'], ['seven_day_sonnet', 'Semanal · Sonnet']]
    .filter(([key]) => Number.isFinite(usage?.[key]?.utilization))
    .map(([key, label]) => ({ id: key, label, percent: usage[key].utilization, resetsAt: iso(usage[key].resets_at), severity: null }));
}

async function readClaude({ home, env, fetchImpl }) {
  const base = { id: 'claude', label: 'Claude', plan: null, windows: [] };
  const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const oauth = readJson(path.join(dir, '.credentials.json'))?.claudeAiOauth;
  if (!oauth?.accessToken) return { ...base, available: false, status: 'no_session', reason: 'No hay una sesión de Claude Code con suscripción en esta máquina. Inicia sesión con `claude` para ver tu plan.' };
  base.plan = oauth.subscriptionType || null;
  if (Number.isFinite(oauth.expiresAt) && oauth.expiresAt < Date.now()) return { ...base, available: false, status: 'expired', reason: 'La sesión de Claude Code venció. Abre `claude` una vez para renovarla.' };
  try {
    const usage = await getJson(fetchImpl, 'https://api.anthropic.com/api/oauth/usage', { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' });
    const extra = usage?.extra_usage?.is_enabled ? { percent: finite(usage.extra_usage.utilization), used: finite(usage.extra_usage.used_credits), limit: finite(usage.extra_usage.monthly_limit), currency: usage.extra_usage.currency || null } : null;
    return { ...base, available: true, status: 'ok', windows: claudeWindows(usage), extra };
  } catch (error) {
    return failure(base, error, 'Claude rechazó la sesión guardada. Abre `claude` para renovarla.', 'Claude');
  }
}

const windowLabel = seconds => seconds === 18000 ? 'Sesión · 5 h' : seconds === 604800 ? 'Semanal' : seconds === 86400 ? 'Diario' : Number.isFinite(seconds) ? `Ventana · ${Math.round(seconds / 3600)} h` : 'Ventana';
export function codexWindows(usage) {
  const windows = [];
  const add = (id, window, prefix = '') => {
    if (!Number.isFinite(window?.used_percent)) return;
    const resetsAt = Number.isFinite(window.reset_at) ? iso(window.reset_at) : Number.isFinite(window.reset_after_seconds) ? new Date(Date.now() + window.reset_after_seconds * 1000).toISOString() : null;
    windows.push({ id, label: prefix + windowLabel(window.limit_window_seconds), percent: window.used_percent, resetsAt, severity: null });
  };
  add('primary', usage?.rate_limit?.primary_window);
  add('secondary', usage?.rate_limit?.secondary_window);
  add('review-primary', usage?.code_review_rate_limit?.primary_window, 'Code review · ');
  add('review-secondary', usage?.code_review_rate_limit?.secondary_window, 'Code review · ');
  for (const [index, extra] of (Array.isArray(usage?.additional_rate_limits) ? usage.additional_rate_limits : []).entries()) {
    const name = extra?.limit_name || extra?.metered_feature || `Límite ${index + 1}`;
    add(`extra-${index}-p`, extra?.rate_limit?.primary_window, `${name} · `);
    add(`extra-${index}-s`, extra?.rate_limit?.secondary_window, `${name} · `);
  }
  return windows;
}

// Codex's own login first; OpenCode's ChatGPT login is the same subscription.
function codexSession({ home, env }) {
  const codex = readJson(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'auth.json'))?.tokens;
  if (codex?.access_token) return { token: codex.access_token, account: codex.account_id, source: 'codex' };
  const opencode = readJson(path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode', 'auth.json'))?.openai;
  if (opencode?.type === 'oauth' && opencode.access) return { token: opencode.access, account: opencode.accountId, source: 'opencode', expired: Number.isFinite(opencode.expires) && opencode.expires < Date.now() };
  return null;
}

async function readCodex({ home, env, fetchImpl }) {
  const base = { id: 'codex', label: 'Codex', plan: null, windows: [] };
  const session = codexSession({ home, env });
  if (!session) return { ...base, available: false, status: 'no_session', reason: 'No hay una sesión de ChatGPT en Codex ni en OpenCode. Inicia sesión con `codex login` para ver tu plan.' };
  const renew = session.source === 'codex' ? 'Abre `codex` para renovarla.' : 'Abre `opencode` para renovarla.';
  if (session.expired) return { ...base, available: false, status: 'expired', reason: `La sesión de ChatGPT venció. ${renew}` };
  try {
    const usage = await getJson(fetchImpl, 'https://chatgpt.com/backend-api/wham/usage', { Authorization: `Bearer ${session.token}`, ...(session.account ? { 'ChatGPT-Account-Id': session.account } : {}), 'User-Agent': 'codex-cli' });
    const windows = codexWindows(usage);
    if (!windows.length) return { ...base, available: false, status: 'error', reason: 'Formato de respuesta inesperado' };
    const credits = usage?.credits?.has_credits ? { balance: usage.credits.unlimited ? 'ilimitado' : String(usage.credits.balance ?? '') } : null;
    return { ...base, available: true, status: 'ok', plan: typeof usage?.plan_type === 'string' ? usage.plan_type : null, limitReached: usage?.rate_limit?.limit_reached === true, windows, credits };
  } catch (error) {
    return failure(base, error, `ChatGPT rechazó la sesión guardada. ${renew}`, 'ChatGPT');
  }
}

export function createLimits({ home = os.homedir(), env = process.env, fetchImpl = globalThis.fetch, ttlMs = LIMITS_TTL_MS, retryMs = TRANSIENT_RETRY_MS, now = Date.now } = {}) {
  const readers = { claude: readClaude, codex: readCodex };
  const state = Object.fromEntries(Object.keys(readers).map(id => [id, { value: null, good: null, goodAt: 0, nextAt: 0, hardUntil: 0, pending: null }]));
  const load = async id => {
    const s = state[id];
    const result = await readers[id]({ home, env, fetchImpl });
    const t = now();
    s.loadedAt = t;
    const { retryAfterMs, ...value } = result;
    if (value.status === 'ok') {
      s.good = value; s.goodAt = t; s.nextAt = t + ttlMs; s.hardUntil = 0;
    } else {
      if (value.status === 'rate_limited') { s.hardUntil = t + retryAfterMs; s.nextAt = s.hardUntil; value.retryAt = new Date(s.hardUntil).toISOString(); }
      else { s.hardUntil = 0; s.nextAt = t + retryMs; if (value.status === 'error') value.retryAt = new Date(s.nextAt).toISOString(); }
      if (s.good) Object.assign(value, { ...s.good, available: true, stale: true, staleSince: new Date(s.goodAt).toISOString(), status: value.status, reason: value.reason, retryAt: value.retryAt });
    }
    s.value = value;
    return value;
  };
  const one = id => {
    const s = state[id];
    s.pending ??= load(id).finally(() => { s.pending = null; });
    return s.pending;
  };
  const listeners = new Set();
  let lastKey = null, timer = null, running = false;
  const keyOf = providers => JSON.stringify(providers.map(p => [p.id, p.available, p.status, p.stale === true, p.plan, p.limitReached === true, (p.windows || []).map(w => [w.id, w.label, w.percent, w.resetsAt])]));
  const snapshot = () => ({ observedAt: new Date(now()).toISOString(), providers: Object.keys(readers).map(id => state[id].value).filter(Boolean) });
  const notify = () => {
    const data = snapshot();
    const key = keyOf(data.providers);
    if (key === lastKey) return;
    lastKey = key;
    for (const listener of [...listeners]) { try { listener(data); } catch {} }
  };
  const schedule = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!running) return;
    const t = now();
    const due = Math.min(...Object.values(state).map(s => Math.max(s.nextAt, s.hardUntil)));
    timer = setTimeout(tick, Math.max(1000, due - t));
    timer.unref?.();
  };
  const tick = async () => {
    timer = null;
    if (!running) return;
    const t = now();
    await Promise.all(Object.keys(readers).filter(id => t >= state[id].hardUntil && t >= state[id].nextAt).map(one));
    notify();
    schedule();
  };
  return {
    // Each provider is cached on its own; a 429 blocks only that provider until Retry-After, even when forced.
    async read({ force = false } = {}) {
      const providers = await Promise.all(Object.keys(readers).map(id => {
        const s = state[id], t = now();
        if (s.value && (t < s.hardUntil || (!force && t < s.nextAt))) return s.value;
        return one(id);
      }));
      notify();
      return { observedAt: new Date(now()).toISOString(), providers };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() { if (running) return; running = true; tick(); },
    stop() { running = false; if (timer) { clearTimeout(timer); timer = null; } },
    async poke() {
      if (!running) return;
      const t = now();
      const ids = Object.keys(readers).filter(id => t >= state[id].hardUntil && (!state[id].loadedAt || t - state[id].loadedAt >= POKE_MIN_MS));
      if (!ids.length) return;
      await Promise.all(ids.map(one));
      notify();
      schedule();
    },
  };
}
