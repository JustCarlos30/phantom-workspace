// Performance contract, Fase 2: renderer event fan-out, shared terminal tails
// and bounded attention history. Protected acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
// Loaded lazily so each test reports its own failure before the modules exist.
const hubModule = () => import('../src/hooks/eventHub.js');
const pollerModule = () => import('../src/hooks/tailPoller.js');
const storeModule = () => import('../host/store.mjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeSource() {
  const listeners = new Set(); let registrations = 0;
  return {
    register: listener => { registrations++; listeners.add(listener); return () => listeners.delete(listener); },
    emit: event => { for (const listener of [...listeners]) listener(event); },
    get registrations() { return registrations; }, get active() { return listeners.size; },
  };
}

test('event hub registers one bridge listener for any number of subscribers', async () => {
  const { createEventHub } = await hubModule();
  const source = fakeSource(), hub = createEventHub(source.register);
  const offs = Array.from({ length: 50 }, () => hub.subscribe(() => {}));
  for (let i = 0; i < 50; i++) offs.push(hub.subscribeSession(`s${i}`, () => {}));
  assert.equal(source.registrations, 1);
  assert.equal(source.active, 1);
  offs.forEach(off => off());
  assert.equal(source.active, 0, 'bridge listener released when nobody listens');
  hub.subscribe(() => {});
  assert.equal(source.active, 1, 'bridge listener registered again on demand');
});

test('session subscribers only receive their session plus connection events', async () => {
  const { createEventHub } = await hubModule();
  const source = fakeSource(), hub = createEventHub(source.register);
  const a = [], b = [], all = [];
  hub.subscribeSession('a', event => a.push(event));
  hub.subscribeSession('b', event => b.push(event));
  hub.subscribe(event => all.push(event));
  source.emit({ type: 'terminal.output', sessionId: 'a', seq: 1, data: 'x' });
  source.emit({ type: 'terminal.output', sessionId: 'b', seq: 1, data: 'y' });
  source.emit({ type: 'connection', status: 'connected' });
  source.emit({ type: 'state.changed', workspaceId: 'w' });
  assert.deepEqual(a.map(e => e.type + (e.sessionId || '')), ['terminal.outputa', 'connection']);
  assert.deepEqual(b.map(e => e.type + (e.sessionId || '')), ['terminal.outputb', 'connection']);
  assert.equal(all.length, 4, 'generic subscribers still see every event');
});

test('a throwing subscriber does not starve the others', async () => {
  const { createEventHub } = await hubModule();
  const source = fakeSource(), hub = createEventHub(source.register);
  const seen = [];
  hub.subscribe(() => { throw new Error('boom'); });
  hub.subscribeSession('a', () => { throw new Error('boom'); });
  hub.subscribe(event => seen.push(event.type));
  hub.subscribeSession('a', event => seen.push(`a:${event.type}`));
  source.emit({ type: 'terminal.output', sessionId: 'a', seq: 1, data: '' });
  assert.deepEqual(seen.sort(), ['a:terminal.output', 'terminal.output']);
});

test('tail poller shares one request stream across subscribers and stops when unused', async () => {
  const { createEventHub } = await hubModule(); const { createTailPoller } = await pollerModule();
  const source = fakeSource(), hub = createEventHub(source.register);
  let calls = 0;
  const invoke = async (method, payload) => { assert.equal(method, 'terminal.tail'); calls++; return { lines: [`tail ${payload.sessionId} ${payload.lines}`], seq: calls }; };
  const poller = createTailPoller({ sessionId: 'a', lines: 4, invoke, subscribeSession: hub.subscribeSession, throttleMs: 40, heartbeatMs: 10_000 });
  const values = Array.from({ length: 20 }, () => []);
  const offs = values.map(list => poller.subscribe(value => list.push(value)));
  await wait(20);
  assert.equal(calls, 1, '20 subscribers trigger one initial read');
  assert.ok(values.every(list => list.length === 1 && list[0].lines[0] === 'tail a 4'));
  for (let i = 2; i < 30; i++) source.emit({ type: 'terminal.output', sessionId: 'a', seq: i, data: 'z' });
  await wait(120);
  assert.ok(calls >= 2 && calls <= 4, `output burst throttled into few reads, got ${calls}`);
  source.emit({ type: 'terminal.output', sessionId: 'b', seq: 1, data: 'z' });
  const before = calls; await wait(80);
  assert.equal(calls, before, 'other sessions do not trigger reads');
  offs.forEach(off => off());
  for (let i = 30; i < 40; i++) source.emit({ type: 'terminal.output', sessionId: 'a', seq: i, data: 'z' });
  await wait(80);
  assert.equal(calls, before, 'no reads without subscribers');
  assert.equal(source.active, 0, 'poller released its session subscription');
});

test('late subscriber gets the last tail immediately without a new request', async () => {
  const { createEventHub } = await hubModule(); const { createTailPoller } = await pollerModule();
  const source = fakeSource(), hub = createEventHub(source.register);
  let calls = 0;
  const poller = createTailPoller({ sessionId: 'a', lines: 1, invoke: async () => ({ lines: [`v${++calls}`] }), subscribeSession: hub.subscribeSession, throttleMs: 40, heartbeatMs: 10_000 });
  const off1 = poller.subscribe(() => {});
  await wait(20);
  const late = [];
  const off2 = poller.subscribe(value => late.push(value));
  assert.equal(late.length, 1); assert.equal(late[0].lines[0], 'v1'); assert.equal(calls, 1);
  off1(); off2();
});

test('attention history is bounded per workspace, newest kept, also on load', async () => {
  const { Store, ATTENTION_LIMIT, pushAttention } = await storeModule();
  assert.ok(Number.isInteger(ATTENTION_LIMIT) && ATTENTION_LIMIT <= 300 && ATTENTION_LIMIT >= 100);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-attention-')), dir = path.join(root, 'data'), folder = path.join(root, 'p');
  fs.mkdirSync(folder);
  const store = new Store(dir); const w = store.open(folder);
  for (let i = 0; i < 1000; i++) w.attention.push({ id: randomUUID(), title: `a${i}`, source: 'terminal', createdAt: new Date(1700000000000 + i).toISOString() });
  store.persist(); store.flush();
  const reloaded = new Store(dir); reloaded.flush();
  const kept = reloaded.state.workspaces[0].attention;
  assert.equal(kept.length, ATTENTION_LIMIT);
  assert.equal(kept.at(-1).title, 'a999'); assert.equal(kept[0].title, `a${1000 - ATTENTION_LIMIT}`);
  for (let i = 0; i < 10; i++) pushAttention(reloaded.state.workspaces[0], { id: randomUUID(), title: `n${i}`, source: 'terminal', createdAt: new Date().toISOString() });
  assert.equal(reloaded.state.workspaces[0].attention.length, ATTENTION_LIMIT);
  assert.equal(reloaded.state.workspaces[0].attention.at(-1).title, 'n9');
  reloaded.close();
});
