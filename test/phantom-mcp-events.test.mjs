import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serve, PHANTOM_MCP_TOOL } from '../scripts/phantom-mcp.mjs';
import { EVENT_NAME, EVENTS_METHOD } from '../shared/workspace-events.mjs';

const EXTENSION = 'io.modelcontextprotocol/events';
const UNTRUSTED = 'io.modelcontextprotocol/untrusted';
const SUBSCRIPTION = 'io.modelcontextprotocol/subscriptionId';
const ENV = { PHANTOM_TERMINAL_SESSION_ID: 'session-1', PHANTOM_WORKSPACE_SOCKET: '/tmp/phantom-test.sock' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, ms = 1000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('timeout esperando condición');
    await sleep(5);
  }
}

function fakeHost(responses = []) {
  const calls = [];
  const call = async (method, payload, socket) => {
    calls.push({ method, payload, socket });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? { events: [], cursor: payload.cursor ?? 'cur-0', truncated: false };
  };
  return { call, calls };
}

function harness({ call, env = ENV, pollMs = 10 }) {
  const input = new PassThrough();
  const output = new PassThrough();
  const rows = [];
  let buffer = '';
  output.setEncoding('utf8');
  output.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      rows.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  serve({ input, output, env, call, pollMs });
  return {
    rows,
    send: message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'),
    end: () => input.end(),
    responseTo: id => rows.find(row => row.id === id),
    notifications: method => rows.filter(row => row.method === method),
  };
}

const event = (n, extra = {}) => ({
  eventId: `ws:card:c${n}:working:${n}`,
  seq: n,
  cursor: `cur-${n}`,
  workspaceId: 'ws',
  kind: 'card',
  entityId: `c${n}`,
  status: 'working',
  previous: null,
  audience: 'workspace',
  at: '2026-11-23T10:00:00.000Z',
  title: 'Tarea',
  ...extra,
});

test('initialize y server/discover anuncian la extensión de eventos junto a tools', async () => {
  const h = harness({ call: fakeHost().call });
  h.send({ id: 1, method: 'initialize', params: {} });
  h.send({ id: 2, method: 'server/discover' });
  await until(() => h.responseTo(1) && h.responseTo(2));
  for (const id of [1, 2]) {
    const { capabilities } = h.responseTo(id).result;
    assert.deepEqual(capabilities.extensions[EXTENSION], {});
    assert.deepEqual(capabilities.tools, {});
  }
  h.end();
});

test('events/list describe el evento con delivery poll y push y sin propiedades extra', async () => {
  const h = harness({ call: fakeHost().call });
  h.send({ id: 3, method: 'events/list' });
  await until(() => h.responseTo(3));
  const result = h.responseTo(3).result;
  assert.equal(result.resultType, 'complete');
  assert.equal(result.events[0].name, EVENT_NAME);
  assert.deepEqual(result.events[0].delivery, ['poll', 'push']);
  assert.equal(result.events[0].inputSchema.additionalProperties, false);
  h.end();
});

test('events/poll pasa el cursor al host, limita con maxEvents y marca el payload como no confiable', async () => {
  const host = fakeHost([{ events: [event(1), event(2), event(3)], cursor: 'cur-3', truncated: false }]);
  const h = harness({ call: host.call });
  h.send({ id: 4, method: 'events/poll', params: { name: EVENT_NAME, arguments: { workspaceId: 'ws' }, cursor: 'cur-0', maxEvents: 2 } });
  await until(() => h.responseTo(4));
  const result = h.responseTo(4).result;
  assert.equal(host.calls[0].method, EVENTS_METHOD);
  assert.deepEqual(host.calls[0].payload, { principal: { sessionId: 'session-1' }, cursor: 'cur-0', workspaceId: 'ws' });
  assert.equal(host.calls[0].socket, ENV.PHANTOM_WORKSPACE_SOCKET);
  assert.equal(result.resultType, 'complete');
  assert.equal(result.events.length, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.cursor, 'cur-2');
  assert.equal(result.nextPollMs, 10);
  assert.equal(result.events[0].name, EVENT_NAME);
  for (const ev of result.events) assert.equal(ev._meta[UNTRUSTED], true);
  h.end();
});

test('events/poll rechaza nombre o argumentos no válidos sin llamar al host', async () => {
  const host = fakeHost();
  const h = harness({ call: host.call });
  h.send({ id: 5, method: 'events/poll', params: { name: 'otro.evento', arguments: {}, cursor: null } });
  h.send({ id: 6, method: 'events/poll', params: { name: EVENT_NAME, arguments: { workspaceId: 'ws', extra: 1 }, cursor: null } });
  h.send({ id: 7, method: 'events/stream', params: { name: EVENT_NAME, arguments: { scope: 'todo' }, cursor: null } });
  await until(() => h.responseTo(5) && h.responseTo(6) && h.responseTo(7));
  for (const id of [5, 6, 7]) assert.equal(h.responseTo(id).error.code, -32602);
  assert.equal(host.calls.length, 0);
  h.end();
});

test('events/stream envía active, event y heartbeat con el id de suscripción', async () => {
  const host = fakeHost([
    { events: [], cursor: 'cur-0', truncated: false },
    { events: [event(1)], cursor: 'cur-1', truncated: false },
  ]);
  const h = harness({ call: host.call });
  h.send({ id: 'stream-1', method: 'events/stream', params: { name: EVENT_NAME, arguments: {}, cursor: null, heartbeatMs: 100 } });
  await until(() => h.notifications('notifications/events/event').length === 1 && h.notifications('notifications/events/heartbeat').length >= 1);
  const methods = h.rows.map(row => row.method).filter(Boolean);
  assert.deepEqual(methods.slice(0, 2), ['notifications/events/active', 'notifications/events/event']);
  for (const row of h.rows.filter(r => r.method)) assert.equal(row.params._meta[SUBSCRIPTION], 'stream-1');
  assert.equal(h.notifications('notifications/events/event')[0].params._meta[UNTRUSTED], true);
  assert.equal(h.responseTo('stream-1'), undefined);
  h.end();
});

test('notifications/cancelled cierra el stream sin más notificaciones ni sondeos', async () => {
  const host = fakeHost();
  const h = harness({ call: host.call });
  h.send({ id: 'stream-2', method: 'events/stream', params: { name: EVENT_NAME, arguments: {}, cursor: null, heartbeatMs: 100 } });
  await until(() => h.notifications('notifications/events/active').length === 1);
  h.send({ method: 'notifications/cancelled', params: { requestId: 'stream-2' } });
  await sleep(10);
  const rows = h.rows.length;
  const calls = host.calls.length;
  await sleep(250);
  assert.equal(h.rows.length, rows);
  assert.equal(host.calls.length, calls);
  h.end();
});

test('events/poll y events/stream sin sesión devuelven Forbidden sin stream', async () => {
  const host = fakeHost();
  const h = harness({ call: host.call, env: { PHANTOM_WORKSPACE_SOCKET: '/tmp/phantom-test.sock' } });
  h.send({ id: 8, method: 'events/poll', params: { name: EVENT_NAME, arguments: {}, cursor: null } });
  h.send({ id: 9, method: 'events/stream', params: { name: EVENT_NAME, arguments: {}, cursor: null } });
  await until(() => h.responseTo(8) && h.responseTo(9));
  assert.equal(h.responseTo(8).error.code, -32003);
  assert.equal(h.responseTo(9).error.code, -32003);
  assert.equal(h.notifications('notifications/events/active').length, 0);
  assert.equal(host.calls.length, 0);
  h.end();
});

test('events/stream envía terminated y deja de sondear si el host revoca la sesión', async () => {
  const host = fakeHost([
    { events: [], cursor: 'cur-0', truncated: false },
    new Error('Forbidden: sesión revocada'),
  ]);
  const h = harness({ call: host.call });
  h.send({ id: 'stream-3', method: 'events/stream', params: { name: EVENT_NAME, arguments: {}, cursor: null } });
  await until(() => h.notifications('notifications/events/terminated').length === 1);
  assert.equal(h.notifications('notifications/events/terminated')[0].params._meta[SUBSCRIPTION], 'stream-3');
  const calls = host.calls.length;
  await sleep(50);
  assert.equal(host.calls.length, calls);
  h.end();
});

test('cerrar stdin limpia los streams abiertos', async () => {
  const host = fakeHost();
  const h = harness({ call: host.call });
  h.send({ id: 'stream-4', method: 'events/stream', params: { name: EVENT_NAME, arguments: {}, cursor: null, heartbeatMs: 100 } });
  await until(() => h.notifications('notifications/events/active').length === 1);
  h.end();
  await sleep(10);
  const rows = h.rows.length;
  const calls = host.calls.length;
  await sleep(250);
  assert.equal(h.rows.length, rows);
  assert.equal(host.calls.length, calls);
});

test('las tools existentes siguen anunciadas junto a la extensión', async () => {
  const h = harness({ call: fakeHost().call });
  h.send({ id: 10, method: 'tools/list' });
  await until(() => h.responseTo(10));
  assert.equal(h.responseTo(10).result.tools[0].name, PHANTOM_MCP_TOOL);
  h.end();
});
