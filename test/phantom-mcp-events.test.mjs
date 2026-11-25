import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serve, PHANTOM_MCP_TOOL, tracesRequest, TRACES_MCP_TOOL } from '../scripts/phantom-mcp.mjs';
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

test('la tool traces es de solo lectura: reenvía solo la sesión propia y valida sus argumentos', async () => {
  const host = fakeHost([{ items: [] }, { agent: null, events: [], cursor: null, hasMore: false }]);
  const h = harness({ call: host.call });
  h.send({ id: 20, method: 'tools/list' });
  await until(() => h.responseTo(20));
  assert.deepEqual(h.responseTo(20).result.tools.map(tool => tool.name), [PHANTOM_MCP_TOOL, 'traces']);
  h.send({ id: 21, method: 'tools/call', params: { name: 'traces', arguments: {} } });
  h.send({ id: 22, method: 'tools/call', params: { name: 'traces', arguments: { id: 'toolu_A1', cursor: '12', limit: 5 } } });
  await until(() => h.responseTo(21) && h.responseTo(22));
  assert.deepEqual(host.calls.map(call => [call.method, call.payload]), [
    ['terminal.agent.traces', { sessionId: 'session-1' }],
    ['terminal.agent.traces', { sessionId: 'session-1', id: 'toolu_A1', cursor: '12', limit: 5 }],
  ]);
  assert.equal(h.responseTo(21).result._meta[UNTRUSTED], true);
  for (const [id, args] of [[23, { workspaceId: 'w1' }], [24, { id: '../etc' }], [25, { id: 'a', limit: 0 }], [26, { id: 'a', cursor: 'x' }], [27, { limit: 3 }], [28, { sessionId: 'otra' }]]) {
    h.send({ id, method: 'tools/call', params: { name: 'traces', arguments: args } });
    await until(() => h.responseTo(id));
    assert.equal(h.responseTo(id).result.isError, true);
  }
  assert.equal(host.calls.length, 2, 'invalid arguments never reach the host');
  h.end();
});

test('traces sin sesión de terminal es Forbidden y no llama al host', async () => {
  const host = fakeHost();
  const h = harness({ call: host.call, env: {} });
  h.send({ id: 30, method: 'tools/call', params: { name: 'traces', arguments: {} } });
  await until(() => h.responseTo(30));
  assert.equal(h.responseTo(30).result.isError, true);
  assert.match(h.responseTo(30).result.content[0].text, /^Forbidden/);
  assert.equal(host.calls.length, 0);
  h.end();
});

const SESSION_ENV = { PHANTOM_TERMINAL_SESSION_ID: 'session-1', PHANTOM_WORKSPACE_SOCKET: '/tmp/host.sock' };

test('tracesRequest: la herramienta se llama traces y exige sesión y socket del entorno', () => {
  assert.equal(TRACES_MCP_TOOL, 'traces');
  assert.match(tracesRequest({}, {}).error, /^Forbidden/);
  assert.match(tracesRequest({}, { PHANTOM_TERMINAL_SESSION_ID: 'session-1' }).error, /^Forbidden/);
  assert.match(tracesRequest({}, { PHANTOM_WORKSPACE_SOCKET: '/tmp/host.sock' }).error, /^Forbidden/);
  assert.deepEqual(tracesRequest({}, SESSION_ENV), { payload: { sessionId: 'session-1' } });
});

test('tracesRequest: solo reenvía id, cursor y limit y la sesión sale del entorno, nunca de los argumentos', () => {
  assert.deepEqual(tracesRequest({ id: 'toolu_A1', cursor: '12', limit: 5 }, SESSION_ENV), { payload: { sessionId: 'session-1', id: 'toolu_A1', cursor: '12', limit: 5 } });
  for (const args of [{ sessionId: 'otra' }, { workspaceId: 'w' }, { nodeId: 'n' }, { path: '/etc/passwd' }, { id: 'a', extra: 1 }]) {
    assert.match(tracesRequest(args, SESSION_ENV).error, /Argumentos no válidos/, JSON.stringify(args));
  }
  for (const args of [null, [], 'x', 7]) assert.ok(tracesRequest(args, SESSION_ENV).error, String(args));
});

test('tracesRequest: valida la forma de id, cursor y limit y exige id para paginar', () => {
  for (const args of [{ id: '../etc' }, { id: 'a/b' }, { id: '' }, { id: 5 }, { id: 'x'.repeat(201) }, { id: 'a', cursor: 'abc' }, { id: 'a', cursor: '-1' }, { id: 'a', cursor: 12 },
    { id: 'a', limit: 0 }, { id: 'a', limit: 201 }, { id: 'a', limit: 1.5 }, { id: 'a', limit: '5' }]) {
    assert.ok(tracesRequest(args, SESSION_ENV).error, JSON.stringify(args));
  }
  assert.match(tracesRequest({ cursor: '3' }, SESSION_ENV).error, /requieren un id/);
  assert.match(tracesRequest({ limit: 3 }, SESSION_ENV).error, /requieren un id/);
  assert.deepEqual(tracesRequest({ id: 'a', limit: 200 }, SESSION_ENV).payload, { sessionId: 'session-1', id: 'a', limit: 200 });
  assert.deepEqual(tracesRequest({ id: 'a:b@c+d.e-f_g' }, SESSION_ENV).payload, { sessionId: 'session-1', id: 'a:b@c+d.e-f_g' });
});
