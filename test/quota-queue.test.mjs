import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideRoute, createQuotaQueue, MODEL_EQUIVALENTS, MAX_REROUTES, MAX_INHIBIT_MS, WAIT_MARGIN_MS } from '../host/quota-queue.mjs';

const NOW = Date.parse('2026-11-27T10:00:00Z');
const task = { client: 'claude-code', model: 'sonnet' };
const ok = { status: 'ok', available: true, windows: [{ percent: 10 }] };
const full = (resetsAt) => ({ status: 'ok', windows: [{ percent: 100, resetsAt }] });

test('reroute a motor sano habilitado', () => {
  const r = decideRoute({ task, blocker: {}, providers: { 'claude-code': full('2026-11-27T12:00:00Z'), codex: ok }, enabledEngines: ['claude-code', 'codex'], reroutes: 0, now: NOW });
  assert.deepEqual(r, { action: 'reroute', to: { client: 'codex', model: 'gpt-5' } });
});

test('no reroute a motor no habilitado o agotado', () => {
  const r = decideRoute({ task, blocker: {}, providers: { 'claude-code': full('2026-11-27T12:00:00Z'), codex: { status: 'rate_limited' } }, enabledEngines: ['claude-code', 'codex'], reroutes: 0, now: NOW });
  assert.equal(r.action, 'wait');
  const r2 = decideRoute({ task, blocker: {}, providers: { 'claude-code': full('2026-11-27T12:00:00Z'), codex: ok }, enabledEngines: ['claude-code'], reroutes: 0, now: NOW });
  assert.equal(r2.action, 'wait');
});

test('tabla de modelos: Claude solo en claude-code, opencode nunca Claude', () => {
  for (const [client, models] of Object.entries(MODEL_EQUIVALENTS))
    for (const targets of Object.values(models))
      for (const t of targets) {
        if (t.client === 'opencode') assert.doesNotMatch(t.model, /claude|opus|sonnet|haiku/i);
        if (/claude|opus|sonnet|haiku/i.test(t.model)) assert.equal(t.client, 'claude-code');
      }
  assert.ok(MODEL_EQUIVALENTS['claude-code'].sonnet.length > 0);
});

test('espera con notBefore = resetsAt + margen', () => {
  const r = decideRoute({ task, blocker: {}, providers: { 'claude-code': full('2026-11-27T12:00:00Z') }, enabledEngines: ['claude-code'], reroutes: 0, now: NOW });
  assert.equal(r.action, 'wait');
  assert.equal(r.notBefore, new Date(Date.parse('2026-11-27T12:00:00Z') + WAIT_MARGIN_MS).toISOString());
  assert.equal(r.inhibit, true);
});

test('espera con notBefore = retryAt del bloqueo', () => {
  const r = decideRoute({ task, blocker: { retryAt: '2026-11-27T11:00:00.000Z' }, providers: {}, enabledEngines: [], reroutes: 0, now: NOW });
  assert.deepEqual(r, { action: 'wait', notBefore: '2026-11-27T11:00:00.000Z', inhibit: true });
});

test('inhibit=false si el reseteo supera 12 h', () => {
  const far = new Date(NOW + MAX_INHIBIT_MS + 3600000).toISOString();
  const r = decideRoute({ task, blocker: {}, providers: { 'claude-code': full(far) }, enabledEngines: [], reroutes: 0, now: NOW });
  assert.equal(r.action, 'wait');
  assert.equal(r.inhibit, false);
});

test('tope de reroutes: tras 3 espera en lugar de reencaminar', () => {
  const r = decideRoute({ task, blocker: {}, providers: { 'claude-code': full('2026-11-27T12:00:00Z'), codex: ok }, enabledEngines: ['claude-code', 'codex'], reroutes: MAX_REROUTES, now: NOW });
  assert.equal(r.action, 'wait');
});

test('sin ping-pong: no vuelve a un motor ya visitado', () => {
  const t = { client: 'codex', model: 'gpt-5', visited: ['claude-code'] };
  const r = decideRoute({ task: t, blocker: {}, providers: { 'claude-code': ok, opencode: ok }, enabledEngines: ['claude-code', 'codex', 'opencode'], reroutes: 1, now: NOW });
  assert.deepEqual(r, { action: 'reroute', to: { client: 'opencode', model: 'glm-4.6' } });
});

test('notify si no hay motor ni hora de reintento', () => {
  const r = decideRoute({ task, blocker: {}, providers: {}, enabledEngines: [], reroutes: 0, now: NOW });
  assert.equal(r.action, 'notify');
  assert.ok(r.reason);
});

test('cola persistente: sobrevive reinicios, due y complete', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'quota-queue-')), 'sub', 'queue.json');
  let t = NOW;
  const q1 = createQuotaQueue({ file, now: () => t });
  q1.enqueue({ workspaceId: 'w', taskId: 'a', notBefore: new Date(NOW + 1000).toISOString() });
  q1.enqueue({ workspaceId: 'w', taskId: 'b', notBefore: new Date(NOW + 5000).toISOString() });
  const q2 = createQuotaQueue({ file, now: () => t });
  assert.equal(q2.list().length, 2);
  assert.deepEqual(q2.due(), []);
  t = NOW + 2000;
  assert.deepEqual(q2.due().map((i) => i.taskId), ['a']);
  assert.equal(q2.complete('a'), true);
  assert.equal(q2.complete('a'), false);
  assert.deepEqual(createQuotaQueue({ file, now: () => t }).list().map((i) => i.taskId), ['b']);
  assert.deepEqual(readdirSync(join(file, '..')), ['queue.json']);
});

test('enqueue reemplaza la misma tarea y valida entrada', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'quota-queue-')), 'q.json');
  const q = createQuotaQueue({ file, now: () => NOW });
  q.enqueue({ taskId: 'a', notBefore: new Date(NOW).toISOString() });
  q.enqueue({ taskId: 'a', notBefore: new Date(NOW + 1).toISOString() });
  assert.equal(q.list().length, 1);
  assert.throws(() => q.enqueue({ taskId: 'x', notBefore: 'nope' }));
});
