import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEventDelivery, isMaterial } from '../host/event-delivery.mjs';

const tick = () => new Promise((r) => setImmediate(r));
let n = 0;
const ev = (o = {}) => { n += 1; return { eventId: `e${n}`, workspaceId: 'w1', kind: 'card', entityId: 'c1', status: 'blocked', audience: 'owner', ownerNodeId: 't1', title: 'x', ...o }; };
const W = { id: 't1', workspaceId: 'w1', role: 'worker', filter: { workspaceIds: ['w1'], ownerNodeIds: ['t1'], audiences: ['owner'] } };
const O = { id: 'o1', workspaceId: 'w1', role: 'orchestrator', filter: { workspaceIds: ['w1'], audiences: ['workspace'] } };
const A = { id: 'a1', workspaceId: 'w1', role: 'assistant', filter: { workspaceIds: ['w1'] } };

function fakeTimers(clock) {
  let id = 0;
  const list = new Map();
  return {
    setTimeout(fn, ms) { id += 1; list.set(id, { at: clock.t + ms, fn }); return id; },
    clearTimeout(h) { list.delete(h); },
    size: () => list.size,
    async advance(ms) {
      const end = clock.t + ms;
      for (;;) {
        let next = null;
        for (const [h, x] of list) if (x.at <= end && (!next || x.at < next[1].at)) next = [h, x];
        if (!next) break;
        list.delete(next[0]);
        clock.t = Math.max(clock.t, next[1].at);
        next[1].fn();
        await tick();
      }
      clock.t = end;
      await tick();
    },
  };
}

function harness(o = {}) {
  const clock = o.clock ?? { t: 1_000_000 };
  const timers = fakeTimers(clock);
  const listeners = new Set();
  const filters = [];
  const calls = [];
  const state = { ready: () => true, result: () => ({ delivered: true }) };
  const d = createEventDelivery({
    file: o.file,
    subscribe: (filter, fn) => { filters.push(filter); listeners.add(fn); return () => listeners.delete(fn); },
    render: ({ events }) => `msg:${events.map((e) => e.eventId).join(',')}`,
    deliver: async (a) => { calls.push(a); return state.result(a); },
    ready: (sub) => state.ready(sub),
    now: () => clock.t,
    timers,
    ...o.opts,
  });
  const emit = (e) => { for (const fn of [...listeners]) fn(e); };
  return { d, clock, timers, listeners, filters, calls, state, emit };
}

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evd-')), 'delivery.json');
const sub = (d, id) => d.status().subscribers.find((s) => s.id === id);

test('isMaterial: orchestrator con cards e integraciones propias sigue reglas de worker', () => {
  const own = (o) => isMaterial(ev({ audience: 'workspace', ownerNodeId: 'o1', ...o }), O);
  assert.equal(own({ status: 'completed' }), true);
  assert.equal(own({ status: 'cancelled' }), true);
  assert.equal(own({ status: 'running' }), false);
  assert.equal(own({ status: 'running', alert: 'stalled' }), true);
  assert.equal(isMaterial(ev({ kind: 'integration', audience: 'workspace', ownerNodeId: 'o1', status: 'queued' }), O), true);
  assert.equal(isMaterial(ev({ audience: 'workspace', ownerNodeId: 'otro', status: 'completed' }), O), false);
});

test('isMaterial: assistant con cards e integraciones propias sigue reglas de worker', () => {
  const own = (o) => isMaterial(ev({ audience: 'owner', ownerNodeId: 'a1', ...o }), A);
  assert.equal(own({ status: 'completed' }), true);
  assert.equal(own({ status: 'running' }), false);
  assert.equal(isMaterial(ev({ kind: 'integration', ownerNodeId: 'a1', status: 'queued' }), A), true);
  assert.equal(isMaterial(ev({ ownerNodeId: 'otro', status: 'completed' }), A), false);
});

test('isMaterial: worker', () => {
  const m = (o) => isMaterial(ev(o), W);
  for (const status of ['blocked', 'review', 'completed', 'failed', 'cancelled']) assert.equal(m({ status }), true, status);
  assert.equal(m({ status: 'working' }), false);
  assert.equal(m({ status: 'working', phase: 'repair' }), true);
  assert.equal(m({ status: 'working', phase: 'agent' }), false);
  assert.equal(m({ status: undefined, alert: 'stalled' }), true);
  assert.equal(m({ status: undefined, alert: 'unattended' }), false);
  assert.equal(m({ audience: 'workspace' }), true);
  assert.equal(m({ audience: 'workspace', ownerNodeId: 'otro' }), false);
  assert.equal(m({ kind: 'integration', status: 'conflict', ownerNodeId: 't1' }), true);
  assert.equal(m({ kind: 'integration', status: 'conflict', ownerNodeId: 'otro', audience: 'workspace' }), false);
  assert.equal(m({ kind: 'terminal', entityId: 't1', status: 'blocked' }), false);
});

test('isMaterial: orchestrator', () => {
  const m = (o) => isMaterial(ev({ audience: 'workspace', ownerNodeId: undefined, ...o }), O);
  assert.equal(m({ status: 'blocked' }), true);
  assert.equal(m({ status: 'review' }), true);
  assert.equal(m({ status: 'completed' }), false);
  assert.equal(m({ status: 'blocked', parentId: 'p' }), false);
  assert.equal(m({ status: 'working', progress: { done: 2, total: 2, blocked: 0 } }), true);
  assert.equal(m({ status: 'working', progress: { done: 1, total: 3, blocked: 0 } }), false);
  assert.equal(m({ status: 'working', progress: { done: 1, total: 3, blocked: 1 } }), true);
  assert.equal(m({ status: undefined, alert: 'unattended' }), true);
  assert.equal(m({ status: undefined, alert: 'stalled' }), false);
  assert.equal(m({ kind: 'integration', status: 'ready' }), true);
  assert.equal(m({ kind: 'integration', status: 'integrated' }), true);
  assert.equal(m({ kind: 'integration', status: 'queued' }), false);
  assert.equal(m({ audience: 'owner' }), false);
  assert.equal(m({ kind: 'terminal', entityId: 'o1', status: 'blocked' }), false);
});

test('isMaterial: assistant solo escalados, unattended e integration conflict/failed', () => {
  const m = (o) => isMaterial(ev({ audience: 'workspace', ...o }), A);
  assert.equal(m({ escalated: true }), true);
  assert.equal(m({ status: undefined, alert: 'unattended' }), true);
  assert.equal(m({ kind: 'integration', status: 'conflict' }), true);
  assert.equal(m({ kind: 'integration', status: 'failed' }), true);
  assert.equal(m({ kind: 'integration', status: 'ready' }), false);
  assert.equal(m({ status: 'blocked' }), false);
  assert.equal(m({ kind: 'terminal', entityId: 'a1', escalated: true }), false);
});

test('addSubscriber llama subscribe(filter) y removeSubscriber/close cancelan la suscripción', () => {
  const h = harness();
  assert.equal(h.d.addSubscriber(W), true);
  assert.deepEqual(h.filters, [W.filter]);
  assert.equal(h.d.has('t1'), true);
  assert.equal(h.listeners.size, 1);
  assert.equal(h.d.removeSubscriber('t1', 'cerrado'), true);
  assert.equal(h.d.has('t1'), false);
  assert.equal(h.listeners.size, 0);
  h.d.close();
});

test('agrupado: un evento posterior de la misma entidad sustituye al anterior', async () => {
  const h = harness();
  h.d.addSubscriber(W);
  h.emit(ev({ status: 'blocked' }));
  const last = ev({ status: 'review' });
  h.emit(last);
  assert.equal(sub(h.d, 't1').queued, 1);
  assert.equal(sub(h.d, 't1').coalesced, 1);
  await h.timers.advance(1000);
  assert.equal(h.calls.length, 0);
  await h.timers.advance(600);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].events.map((e) => e.eventId), [last.eventId]);
  h.d.close();
});

test('lote <= maxBatch con clave estable y mensaje renderizado', async () => {
  const h = harness({ opts: { maxBatch: 3 } });
  h.d.addSubscriber(W);
  const evs = [1, 2, 3, 4, 5].map((i) => ev({ entityId: `c${i}` }));
  evs.forEach(h.emit);
  await h.timers.advance(1500);
  assert.deepEqual(h.calls.map((c) => c.events.length), [3, 2]);
  const ids = evs.slice(0, 3).map((e) => e.eventId);
  assert.equal(h.calls[0].key, createHash('sha256').update(JSON.stringify(['t1', ids])).digest('hex').slice(0, 32));
  assert.equal(h.calls[0].message, `msg:${ids.join(',')}`);
  assert.equal(h.calls[0].sub.id, 't1');
  assert.equal(sub(h.d, 't1').delivered, 5);
  assert.ok(sub(h.d, 't1').lastDeliveredAt);
  assert.equal(sub(h.d, 't1').queued, 0);
  h.d.close();
});

test('retry reintenta tras retryMs conservando la clave', async () => {
  const h = harness();
  const results = [{ retry: true, reason: 'ocupado' }, { delivered: true }];
  h.state.result = () => results.shift();
  h.d.addSubscriber(W);
  h.emit(ev());
  await h.timers.advance(1500);
  assert.equal(h.calls.length, 1);
  assert.equal(sub(h.d, 't1').retried, 1);
  assert.equal(sub(h.d, 't1').inflight, 1);
  await h.timers.advance(4000);
  assert.equal(h.calls.length, 1);
  await h.timers.advance(1000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].key, h.calls[0].key);
  assert.equal(sub(h.d, 't1').inflight, 0);
  assert.equal(sub(h.d, 't1').delivered, 1);
  h.d.close();
});

test('ready=false retiene y entrega cuando vuelve a estar listo', async () => {
  const h = harness();
  h.state.ready = () => false;
  h.d.addSubscriber(W);
  h.emit(ev());
  await h.timers.advance(10000);
  assert.equal(h.calls.length, 0);
  assert.equal(sub(h.d, 't1').queued, 1);
  h.state.ready = () => true;
  await h.timers.advance(5000);
  assert.equal(h.calls.length, 1);
  h.d.close();
});

test('gone quita el suscriptor, escala lo crítico al padre y cuenta lo descartado', async () => {
  const h = harness();
  h.state.ready = (s) => s.id === 't1';
  h.state.result = () => ({ gone: true, reason: 'terminal cerrada' });
  h.d.addSubscriber({ ...W, parentId: 'o1' });
  h.d.addSubscriber(O);
  h.emit(ev({ entityId: 'c1', status: 'blocked' }));
  h.emit(ev({ entityId: 'c2', status: 'completed' }));
  await h.timers.advance(1500);
  assert.equal(h.d.has('t1'), false);
  assert.equal(sub(h.d, 'o1').queued, 1);
  assert.equal(h.d.status().totals.dropped, 1);
  assert.equal(h.d.status().totals.escalated, 1);
  h.state.ready = () => true;
  h.state.result = () => ({ delivered: true });
  await h.d.flush();
  assert.equal(h.calls.at(-1).events[0].escalated, true);
  assert.equal(h.calls.at(-1).events[0].from, 't1');
  h.d.close();
});

test('reinicio: el inflight se reentrega con la misma clave y la cola se conserva', async () => {
  const file = tmpFile();
  const clock = { t: 1_000_000 };
  const h1 = harness({ file, clock });
  h1.state.result = () => ({ retry: true, reason: 'caído' });
  h1.d.addSubscriber(W);
  const first = ev({ entityId: 'c1' });
  const second = ev({ entityId: 'c2' });
  h1.emit(first);
  await h1.timers.advance(1500);
  h1.emit(second);
  assert.equal(sub(h1.d, 't1').inflight, 1);
  assert.equal(sub(h1.d, 't1').queued, 1);
  h1.d.close();
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  clock.t += 6000;
  const h2 = harness({ file, clock });
  h2.d.addSubscriber(W);
  assert.equal(sub(h2.d, 't1').inflight, 1);
  assert.equal(sub(h2.d, 't1').queued, 1);
  await h2.timers.advance(1);
  assert.equal(h2.calls[0].key, h1.calls[0].key);
  assert.deepEqual(h2.calls[0].events.map((e) => e.eventId), [first.eventId]);
  assert.deepEqual(h2.calls[1].events.map((e) => e.eventId), [second.eventId]);
  assert.notEqual(h2.calls[1].key, h2.calls[0].key);
  h2.d.close();
});

test('tope por ventana deslizante: retiene, marca throttled y resetLimit lo reinicia', async () => {
  const h = harness({ opts: { rate: { max: 2, perMs: 10000 } } });
  h.d.addSubscriber(W);
  for (const id of ['c1', 'c2', 'c3']) {
    h.emit(ev({ entityId: id }));
    await h.timers.advance(1500);
  }
  assert.equal(h.calls.length, 2);
  assert.equal(sub(h.d, 't1').throttled, true);
  assert.equal(sub(h.d, 't1').queued, 1);
  await h.d.flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.d.resetLimit('t1'), true);
  assert.equal(sub(h.d, 't1').throttled, false);
  await h.timers.advance(1);
  assert.equal(h.calls.length, 3);
  h.d.close();
});

test('la ventana deslizante libera el tope tras perMs', async () => {
  const h = harness({ opts: { rate: { max: 1, perMs: 10000 } } });
  h.d.addSubscriber(W);
  h.emit(ev({ entityId: 'c1' }));
  await h.timers.advance(1500);
  h.emit(ev({ entityId: 'c2' }));
  await h.timers.advance(1500);
  assert.equal(h.calls.length, 1);
  assert.equal(sub(h.d, 't1').throttled, true);
  await h.timers.advance(10000);
  assert.equal(h.calls.length, 2);
  h.d.close();
});

test('escalado: un crítico sin entregar > escalateAfterMs pasa al padre marcado', async () => {
  const h = harness();
  h.state.ready = (s) => s.id === 'o1';
  h.d.addSubscriber({ ...W, parentId: 'o1' });
  h.d.addSubscriber(O);
  h.emit(ev({ status: 'blocked' }));
  await h.timers.advance(119000);
  assert.equal(h.calls.length, 0);
  await h.timers.advance(1002 + 2000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].sub.id, 'o1');
  assert.equal(h.calls[0].events[0].escalated, true);
  assert.equal(h.calls[0].events[0].from, 't1');
  assert.equal(sub(h.d, 't1').escalated, 1);
  assert.equal(sub(h.d, 't1').queued, 0);
  h.d.close();
});

test('un evento no crítico no escala', async () => {
  const h = harness();
  h.state.ready = () => false;
  h.d.addSubscriber({ ...W, parentId: 'o1' });
  h.d.addSubscriber(O);
  h.emit(ev({ status: 'completed' }));
  await h.timers.advance(300000);
  assert.equal(sub(h.d, 't1').queued, 1);
  assert.equal(sub(h.d, 'o1').queued, 0);
  assert.equal(h.d.status().unrouted, 0);
  h.d.close();
});

test('sin parentId el crítico queda retenido como unrouted y contado una vez', async () => {
  const h = harness();
  h.state.ready = () => false;
  h.d.addSubscriber(W);
  h.emit(ev({ status: 'failed' }));
  await h.timers.advance(121000);
  assert.equal(h.d.status().unrouted, 1);
  assert.equal(sub(h.d, 't1').queued, 1);
  await h.timers.advance(300000);
  assert.equal(h.d.status().unrouted, 1);
  h.d.close();
});

test('un escalado no escala más de dos niveles', async () => {
  const h = harness();
  h.state.ready = () => false;
  h.d.addSubscriber({ ...W, id: 't1', parentId: 'b' });
  h.d.addSubscriber({ ...A, id: 'b', parentId: 'c' });
  h.d.addSubscriber({ ...A, id: 'c', parentId: 'd' });
  h.d.addSubscriber({ ...A, id: 'd' });
  h.emit(ev({ status: 'blocked' }));
  await h.timers.advance(400000);
  assert.equal(sub(h.d, 't1').queued, 0);
  assert.equal(sub(h.d, 'b').queued, 0);
  assert.equal(sub(h.d, 'c').queued, 1);
  assert.equal(sub(h.d, 'd').queued, 0);
  assert.equal(h.d.status().unrouted, 1);
  h.d.close();
});

test('un crítico de un dueño sin suscriptor llega al asistente como escalado', async () => {
  const h = harness();
  h.d.addSubscriber(A);
  h.emit(ev({ audience: 'workspace', ownerNodeId: 'fantasma', status: 'blocked' }));
  await h.timers.advance(1500);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].events[0].escalated, true);
  assert.equal(h.calls[0].events[0].from, 'fantasma');
  h.d.close();
});

test('maxQueued descarta primero los no críticos más antiguos y los cuenta', async () => {
  const h = harness({ opts: { maxQueued: 3 } });
  h.state.ready = () => false;
  h.d.addSubscriber(W);
  h.emit(ev({ entityId: 'c1', status: 'completed' }));
  h.emit(ev({ entityId: 'c2', status: 'completed' }));
  h.emit(ev({ entityId: 'c3', status: 'blocked' }));
  h.emit(ev({ entityId: 'c4', status: 'completed' }));
  h.emit(ev({ entityId: 'c5', status: 'blocked' }));
  assert.equal(sub(h.d, 't1').queued, 3);
  assert.equal(sub(h.d, 't1').dropped, 2);
  assert.equal(h.d.status().totals.dropped, 2);
  h.state.ready = () => true;
  await h.d.flush();
  assert.deepEqual(h.calls[0].events.map((e) => e.entityId), ['c3', 'c4', 'c5']);
  h.d.close();
});

test('archivo corrupto o ausente empieza vacío', () => {
  const file = tmpFile();
  const h0 = harness({ file });
  assert.deepEqual(h0.d.status().subscribers, []);
  h0.d.close();
  fs.writeFileSync(file, 'no es json{');
  const h = harness({ file });
  assert.deepEqual(h.d.status().subscribers, []);
  assert.equal(h.d.status().unrouted, 0);
  h.d.addSubscriber(W);
  assert.equal(sub(h.d, 't1').queued, 0);
  h.d.close();
});

test('close cancela timers y suscripciones sin perder lo persistido', async () => {
  const file = tmpFile();
  const h = harness({ file });
  h.d.addSubscriber(W);
  h.emit(ev());
  assert.ok(h.timers.size() > 0);
  h.d.close();
  assert.equal(h.timers.size(), 0);
  assert.equal(h.listeners.size, 0);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.subs.t1.queue.length, 1);
});
