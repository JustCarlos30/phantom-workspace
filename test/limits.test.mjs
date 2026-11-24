import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLimits, claudeWindows, codexWindows, parseRetryAfter } from '../host/limits.mjs';

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-limits-'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('Claude: usa el arreglo limits con etiquetas legibles y cae a las ventanas nombradas', () => {
  const windows = claudeWindows({ limits: [{ kind: 'session', percent: 18, resets_at: '2026-11-12T09:20:00Z', severity: 'normal' }, { kind: 'weekly_scoped', percent: 40, resets_at: '2026-11-16T23:00:00Z', scope: { model: { display_name: 'Opus' } } }] });
  assert.deepEqual(windows.map(w => [w.label, w.percent]), [['Sesión · 5 h', 18], ['Semanal · Opus', 40]]);
  assert.deepEqual(claudeWindows({ five_hour: { utilization: 5, resets_at: null }, seven_day: { utilization: 9 } }).map(w => w.percent), [5, 9]);
});

test('Codex: ventanas primaria, secundaria y de code review con su duración', () => {
  const windows = codexWindows({ rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1794925072 }, secondary_window: { used_percent: 78, limit_window_seconds: 604800, reset_after_seconds: 60 } }, code_review_rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 604800 } } });
  assert.deepEqual(windows.map(w => [w.label, w.percent]), [['Sesión · 5 h', 12], ['Semanal', 78], ['Code review · Semanal', 3]]);
  assert.equal(windows[0].resetsAt, new Date(1794925072000).toISOString());
});

test('lee ambas cuentas, nunca devuelve tokens y cachea un minuto', async () => {
  const dir = home(), calls = [];
  write(path.join(dir, '.claude/.credentials.json'), { claudeAiOauth: { accessToken: 'claude-secret', expiresAt: Date.now() + 3600e3, subscriptionType: 'max' } });
  write(path.join(dir, '.codex/auth.json'), { tokens: { access_token: 'codex-secret', account_id: 'acct' } });
  const fetchImpl = async (url, { headers }) => {
    calls.push([url, headers]);
    return url.includes('anthropic') ? reply(200, { limits: [{ kind: 'session', percent: 30 }] }) : reply(200, { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 50, limit_window_seconds: 604800 } } });
  };
  const limits = createLimits({ home: dir, env: {}, fetchImpl });
  const value = await limits.read();
  assert.deepEqual(value.providers.map(p => [p.id, p.available, p.plan, p.windows[0].percent]), [['claude', true, 'max', 30], ['codex', true, 'plus', 50]]);
  assert.doesNotMatch(JSON.stringify(value), /secret/);
  assert.equal(calls.find(([url]) => url.includes('chatgpt'))[1]['ChatGPT-Account-Id'], 'acct');
  await limits.read();
  assert.equal(calls.length, 2);
  await limits.read({ force: true });
  assert.equal(calls.length, 4);
});

const setup = () => {
  const dir = home();
  write(path.join(dir, '.claude/.credentials.json'), { claudeAiOauth: { accessToken: 'claude-secret', expiresAt: Date.now() + 3600e3 } });
  write(path.join(dir, '.codex/auth.json'), { tokens: { access_token: 'codex-secret' } });
  return dir;
};
const okClaude = reply(200, { limits: [{ kind: 'session', percent: 30 }] });
const okCodex = reply(200, { rate_limit: { primary_window: { used_percent: 50, limit_window_seconds: 604800 } } });

test('429 con Retry-After conserva datos y no reintenta ni con force', async () => {
  let t = 1_000_000, mode = 'ok', calls = 0;
  const fetchImpl = async url => {
    if (!url.includes('anthropic')) return okCodex;
    calls++;
    return mode === 'ok' ? okClaude : { ok: false, status: 429, headers: { get: () => '120' }, json: async () => ({}) };
  };
  const limits = createLimits({ home: setup(), env: {}, fetchImpl, ttlMs: 1000, now: () => t });
  await limits.read();
  t += 2000; mode = '429';
  const c = (await limits.read()).providers[0];
  assert.deepEqual([c.available, c.stale, c.status, c.windows[0].percent], [true, true, 'rate_limited', 30]);
  assert.equal(c.retryAt, new Date(t + 120000).toISOString());
  assert.ok(c.staleSince);
  const before = calls;
  t += 60000;
  await limits.read({ force: true });
  assert.equal(calls, before);
  t += 61000; mode = 'ok';
  assert.equal((await limits.read({ force: true })).providers[0].status, 'ok');
  assert.equal(calls, before + 1);
});

test('Retry-After por defecto 5 min, fecha y tope de 30 min', () => {
  assert.equal(parseRetryAfter(null), 300000);
  assert.equal(parseRetryAfter('99999'), 1800000);
  assert.equal(parseRetryAfter(new Date(91000).toUTCString(), 1000), 90000);
});

test('error transitorio conserva datos y reintenta a ~60 s; TTL independiente por proveedor', async () => {
  let t = 1_000_000, fail = false;
  const calls = { claude: 0, codex: 0 };
  const fetchImpl = async url => {
    const id = url.includes('anthropic') ? 'claude' : 'codex';
    calls[id]++;
    if (id === 'claude' && fail) return reply(503, {});
    return id === 'claude' ? okClaude : okCodex;
  };
  const limits = createLimits({ home: setup(), env: {}, fetchImpl, now: () => t });
  await limits.read();
  t += 239000;
  await limits.read();
  assert.deepEqual(calls, { claude: 1, codex: 1 });
  t += 2000; fail = true;
  let v = await limits.read();
  assert.deepEqual(calls, { claude: 2, codex: 2 });
  assert.deepEqual([v.providers[0].available, v.providers[0].stale, v.providers[0].status, v.providers[0].windows[0].percent], [true, true, 'error', 30]);
  assert.equal(v.providers[1].status, 'ok');
  t += 30000;
  await limits.read();
  assert.equal(calls.claude, 2);
  t += 31000;
  await limits.read();
  assert.deepEqual(calls, { claude: 3, codex: 2 });
});

test('Codex sin ventanas reconocibles: error de formato; sin datos previos no disponible', async () => {
  const fetchImpl = async url => (url.includes('anthropic') ? okClaude : reply(200, { plan_type: 'plus' }));
  const p = (await createLimits({ home: setup(), env: {}, fetchImpl }).read()).providers[1];
  assert.deepEqual([p.status, p.reason, p.available], ['error', 'Formato de respuesta inesperado', false]);
  assert.doesNotMatch(JSON.stringify(p), /secret/);
});

test('sin sesión, sesión vencida o rechazada: explica qué CLI abrir sin consultar la red de más', async () => {
  const empty = await createLimits({ home: home(), env: {}, fetchImpl: async () => { throw new Error('no debería consultar'); } }).read();
  assert.deepEqual(empty.providers.map(p => p.available), [false, false]);
  assert.match(empty.providers[0].reason, /claude/);
  assert.match(empty.providers[1].reason, /codex login/);
  const dir = home();
  write(path.join(dir, '.claude/.credentials.json'), { claudeAiOauth: { accessToken: 't', expiresAt: Date.now() - 1 } });
  write(path.join(dir, '.local/share/opencode/auth.json'), { openai: { type: 'oauth', access: 't', accountId: 'a', expires: Date.now() + 3600e3 } });
  const value = await createLimits({ home: dir, env: {}, fetchImpl: async () => reply(401, {}) }).read();
  assert.match(value.providers[0].reason, /venció/);
  assert.match(value.providers[1].reason, /opencode/);
});
