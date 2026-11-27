import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotaFlow } from '../host/run-wake.mjs';
import { decideRoute } from '../host/quota-queue.mjs';

const T0 = Date.parse('2026-11-27T10:00:00Z');
const HEALTHY = { windows: [{ percent: 10, resetsAt: '2026-11-27T20:00:00Z' }] };
const LIMITED = { windows: [{ percent: 100, resetsAt: '2026-11-27T12:00:00Z' }] };

function memQueue(clock) {
  let items = [];
  return {
    enqueue(e) { items = [...items.filter(i => i.taskId !== e.taskId), { ...e }]; return e; },
    due() { return items.filter(i => Date.parse(i.notBefore) <= clock.t); },
    complete(id) { const n = items.length; items = items.filter(i => i.taskId !== id); return n !== items.length; },
    list() { return [...items]; },
  };
}

function setup({ providers, engines = ['claude-code', 'codex'], runFails = false, model = 'claude-code/sonnet' } = {}) {
  const clock = { t: T0 }, events = [], calls = [], holds = [], timers = [];
  const state = { providers, reads: [] };
  const flow = createQuotaFlow({
    decide: decideRoute,
    queue: memQueue(clock),
    inhibitor: { hold: (until, why) => holds.push(['hold', until, why]), release: () => holds.push(['release']) },
    limits: { read: async o => { state.reads.push(o); return { providers: state.providers }; } },
    enabledEngines: () => engines,
    now: () => clock.t,
    emit: e => events.push(e),
    fetchTask: async () => ({ status: 'blocked', blockedReason: 'You hit your usage limit', contract: { model, workspace: '/w' } }),
    commitWip: async () => calls.push('commit'),
    createContract: async (_t, _task, to) => { calls.push(['create', to]); return { id: 'task_new' }; },
    run: async item => { calls.push(['run', item.taskId, item.client, item.model]); if (runFails) throw new Error('x'); },
    setTimer: (fn, ms) => { timers.push(ms); return { unref() {} }; },
    clearTimer: () => {},
  });
  return { flow, clock, events, calls, holds, timers, state };
}
const target = { id: 'run_1', taskId: 'task_1', workspaceId: 'ws', nodeId: 'n1', via: 'terminal' };

test('rate_limit con motor sano: commit WIP, contrato nuevo y evento rerouted', async () => {
  const s = setup({ providers: { 'claude-code': LIMITED, codex: HEALTHY } });
  assert.equal(await s.flow.accept(target, { status: 'failed' }), true);
  assert.deepEqual(s.calls, ['commit', ['create', { client: 'codex', model: 'gpt-5' }], ['run', 'task_new', 'codex', 'gpt-5']]);
  assert.equal(s.events[0].type, 'quota.queue');
  assert.equal(s.events[0].state, 'rerouted');
  assert.equal(s.events[0].taskId, 'task_1');
});

test('sin motor sano: encola, emite waiting y mantiene el inhibidor', async () => {
  const s = setup({ providers: { 'claude-code': LIMITED, codex: LIMITED } });
  assert.equal(await s.flow.accept(target, {}), true);
  assert.equal(s.events[0].state, 'waiting');
  assert.equal(s.events[0].notBefore, '2026-11-27T12:02:00.000Z');
  assert.equal(s.holds[0][0], 'hold');
  assert.deepEqual(s.calls, []);
});

test('al vencer consulta limits con force y reanuda; vaciar la cola libera el inhibidor', async () => {
  const s = setup({ providers: { 'claude-code': LIMITED, codex: LIMITED } });
  await s.flow.accept(target, {});
  s.clock.t = Date.parse('2026-11-27T12:03:00Z'); s.state.providers = { 'claude-code': HEALTHY };
  await s.flow.tick();
  assert.deepEqual(s.state.reads.at(-1), { force: true });
  assert.deepEqual(s.calls, [['run', 'task_1', 'claude-code', 'sonnet']]);
  assert.equal(s.events.at(-1).state, 'resumed');
  assert.deepEqual(s.holds.at(-1), ['release']);
});

test('si el límite persiste, reprograma con backoff creciente sin reanudar', async () => {
  const s = setup({ providers: { 'claude-code': LIMITED, codex: LIMITED } });
  await s.flow.accept(target, {});
  s.clock.t = Date.parse('2026-11-27T12:03:00Z');
  await s.flow.tick();
  assert.deepEqual(s.calls, []);
  assert.equal(s.timers.at(-1) >= 1000, true);
  assert.notEqual(s.holds.at(-1)[0], 'release');
  assert.equal(s.events.filter(e => e.state === 'resumed').length, 0);
});

test('fallo al reanudar reprograma y mantiene la cola', async () => {
  const s = setup({ providers: { 'claude-code': LIMITED }, engines: ['claude-code'], runFails: true });
  await s.flow.accept(target, {});
  s.clock.t = Date.parse('2026-11-27T12:03:00Z'); s.state.providers = { 'claude-code': HEALTHY };
  await s.flow.tick();
  assert.equal(s.events.filter(e => e.state === 'resumed').length, 0);
  assert.notEqual(s.holds.at(-1)[0], 'release');
});

test('bloqueo que no es rate_limit no se gestiona', async () => {
  const s = setup({ providers: {} });
  const flow = createQuotaFlow({ decide: decideRoute, queue: memQueue(s.clock), inhibitor: { hold() {}, release() {} }, limits: { read: async () => ({}) }, enabledEngines: () => [], emit: e => s.events.push(e), fetchTask: async () => ({ status: 'blocked', blockedReason: 'Faltan pruebas suficientes' }), setTimer: () => ({}), clearTimer() {} });
  assert.equal(await flow.accept(target, {}), false);
  assert.deepEqual(s.events, []);
});

test('el mismo descriptor se procesa una sola vez', async () => {
  const s = setup({ providers: { 'claude-code': LIMITED, codex: HEALTHY } });
  await s.flow.accept(target, {}); await s.flow.accept(target, {});
  assert.equal(s.calls.filter(c => c === 'commit').length, 1);
  assert.equal(await s.flow.settled('run_1'), true);
});
