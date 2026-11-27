import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskActivityClient } from '../host/task-activity-client.mjs';

const EXT = 'io.modelcontextprotocol/events';
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); }
  assert.fail('timeout esperando condición');
};
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tac-'));
  return { dir, statePath: join(dir, 'state.json') };
};

// Servidor falso sobre streams en memoria. `onStream(proc, params, id)` decide qué emite cada conexión.
function fakeServer({ discover = 'ok', capabilities = { extensions: { [EXT]: {} } }, onStream = () => {} } = {}) {
  const procs = [];
  const spawn = () => {
    const proc = new EventEmitter();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.received = [];
    proc.killed = false;
    proc.push = (method, params) => proc.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    proc.raw = (text) => proc.stdout.write(text);
    proc.kill = () => {
      if (proc.killed) return;
      proc.killed = true;
      setImmediate(() => { proc.stdout.end(); proc.emit('close', 0); });
    };
    let buf = '';
    proc.stdin.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        const msg = JSON.parse(line);
        proc.received.push(msg);
        const reply = (result) => proc.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`);
        if (msg.method === 'server/discover') {
          if (discover === 'ok') reply({ capabilities });
          else proc.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })}\n`);
        } else if (msg.method === 'initialize') reply({ capabilities });
        else if (msg.method === 'events/stream') onStream(proc, msg.params, msg.id, procs.length);
      }
    });
    procs.push(proc);
    return proc;
  };
  return { spawn, procs };
}
const ev = (n, cursor = `c${n}`, extra = {}) => ({
  eventId: `e${n}`, name: 'phantom.task.activity', timestamp: '2026-01-01T00:00:00Z', cursor,
  data: { taskId: `t${n}`, runId: `r${n}`, parentTaskId: null, type: 'task.created', payload: { n }, ...extra },
});
const make = (server, ctx, over = {}) => {
  const events = [], states = [];
  const client = createTaskActivityClient({
    spawn: server.spawn, command: 'phantom', args: ['mcp'], workspace: '/w', statePath: ctx.statePath,
    onEvent: (e) => { events.push(e); }, onState: (s) => states.push(s),
    backoff: { baseMs: 5, maxMs: 20, jitter: () => 0 }, ...over,
  });
  return { client, events, states };
};
const active = (proc, cursor = 'a0', extra = {}) => proc.push('notifications/events/active', { cursor, truncated: false, heartbeatMs: 1000, ...extra });

test('negocia con server/discover, abre el stream con cursor null y entrega eventos mapeados', async () => {
  const ctx = tmp();
  const server = fakeServer({ onStream: (proc) => { active(proc); proc.push('notifications/events/event', ev(1)); } });
  const { client, events } = make(server, ctx);
  client.start();
  await until(() => events.length === 1);
  const stream = server.procs[0].received.find((m) => m.method === 'events/stream');
  assert.equal(stream.params.name, 'phantom.task.activity');
  assert.equal(stream.params.cursor, null);
  assert.equal(stream.params.arguments.workspace, '/w');
  assert.deepEqual(events[0], { eventId: 'e1', timestamp: '2026-01-01T00:00:00Z', taskId: 't1', runId: 'r1', parentTaskId: null, type: 'task.created', payload: { n: 1 } });
  assert.equal(client.status().state, 'streaming');
  assert.equal(client.status().cursor, 'c1');
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('cae a initialize cuando server/discover falla', async () => {
  const ctx = tmp();
  const server = fakeServer({ discover: 'error', onStream: (proc) => { active(proc); proc.push('notifications/events/event', ev(1)); } });
  const { client, events } = make(server, ctx);
  client.start();
  await until(() => events.length === 1);
  const methods = server.procs[0].received.map((m) => m.method);
  assert.deepEqual(methods.slice(0, 4), ['server/discover', 'initialize', 'notifications/initialized', 'events/stream']);
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('sin la capability de la extensión queda unsupported y no reintenta', async () => {
  const ctx = tmp();
  const server = fakeServer({ capabilities: { extensions: {} } });
  const { client, states } = make(server, ctx);
  client.start();
  await until(() => client.status().state === 'unsupported');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(server.procs.length, 1);
  assert.equal(server.procs[0].killed, true);
  assert.ok(states.some((s) => s.state === 'unsupported' && s.reason));
  assert.equal(client.status().reconnects, 0);
  rmSync(ctx.dir, { recursive: true });
});

test('deduplica por eventId y cuenta los duplicados', async () => {
  const ctx = tmp();
  const server = fakeServer({ onStream: (proc) => {
    active(proc);
    proc.push('notifications/events/event', ev(1));
    proc.push('notifications/events/event', ev(1));
    proc.push('notifications/events/event', ev(2));
  } });
  const { client, events } = make(server, ctx);
  client.start();
  await until(() => client.status().delivered === 2 && client.status().duplicates === 1);
  assert.deepEqual(events.map((e) => e.eventId), ['e1', 'e2']);
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('persiste {cursor, seen} con modo 0600 y conserva solo los últimos 500 ids', async () => {
  const ctx = tmp();
  const server = fakeServer({ onStream: (proc) => {
    active(proc);
    for (let i = 1; i <= 520; i++) proc.push('notifications/events/event', ev(i));
  } });
  const { client } = make(server, ctx);
  client.start();
  await until(() => client.status().delivered === 520);
  await until(() => { try { return JSON.parse(readFileSync(ctx.statePath, 'utf8')).cursor === 'c520'; } catch { return false; } });
  const saved = JSON.parse(readFileSync(ctx.statePath, 'utf8'));
  assert.equal(saved.seen.length, 500);
  assert.equal(saved.seen[0], 'e21');
  assert.equal(saved.seen.at(-1), 'e520');
  assert.equal(statSync(ctx.statePath).mode & 0o777, 0o600);
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('usa el cursor persistido, ignora ids ya vistos y persiste el cursor de heartbeat', async () => {
  const ctx = tmp();
  writeFileSync(ctx.statePath, JSON.stringify({ cursor: 'saved', seen: ['e1'] }));
  const server = fakeServer({ onStream: (proc) => {
    active(proc, 'saved');
    proc.push('notifications/events/event', ev(1));
    proc.push('notifications/events/heartbeat', { cursor: 'hb' });
  } });
  const { client, events } = make(server, ctx);
  client.start();
  await until(() => client.status().cursor === 'hb');
  assert.equal(server.procs[0].received.find((m) => m.method === 'events/stream').params.cursor, 'saved');
  assert.equal(events.length, 0);
  await until(() => JSON.parse(readFileSync(ctx.statePath, 'utf8')).cursor === 'hb');
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('reconecta tras el cierre del proceso con backoff acotado y el último cursor', async () => {
  const ctx = tmp();
  const jitters = [];
  const server = fakeServer({ onStream: (proc, _p, _id, n) => {
    active(proc);
    if (n === 1) { proc.push('notifications/events/event', ev(1)); setImmediate(() => proc.kill()); }
    else proc.push('notifications/events/event', ev(2));
  } });
  const { client, events } = make(server, ctx, { backoff: { baseMs: 5, maxMs: 20, jitter: () => { jitters.push(1); return 0; } } });
  client.start();
  await until(() => events.length === 2);
  assert.equal(server.procs.length, 2);
  assert.equal(server.procs[1].received.find((m) => m.method === 'events/stream').params.cursor, 'c1');
  assert.ok(jitters.length >= 1);
  assert.equal(client.status().reconnects, 1);
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('el backoff crece de forma exponencial y se acota en maxMs', async () => {
  const ctx = tmp();
  const server = fakeServer({ discover: 'ok', onStream: (proc) => proc.kill() });
  const { client, states } = make(server, ctx, { backoff: { baseMs: 4, maxMs: 16, jitter: () => 1 } });
  client.start();
  await until(() => states.filter((s) => s.state === 'reconnecting').length >= 5);
  const delays = states.filter((s) => s.state === 'reconnecting').map((s) => s.delayMs);
  assert.deepEqual(delays.slice(0, 4), [4, 8, 16, 16]);
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('un cursor rechazado reinicia desde null e informa truncated:true', async () => {
  const ctx = tmp();
  writeFileSync(ctx.statePath, JSON.stringify({ cursor: 'bad', seen: [] }));
  const server = fakeServer({ onStream: (proc, params, id) => {
    if (params.cursor === 'bad') proc.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message: 'invalid_cursor' } })}\n`);
    else { active(proc, 'fresh'); proc.push('notifications/events/event', ev(1)); }
  } });
  const { client, events, states } = make(server, ctx);
  client.start();
  await until(() => events.length === 1);
  assert.equal(server.procs[1].received.find((m) => m.method === 'events/stream').params.cursor, null);
  assert.ok(states.some((s) => s.state === 'streaming' && s.truncated === true));
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('terminated con invalid_cursor también reinicia; otro terminated reconecta con el cursor', async () => {
  const ctx = tmp();
  const server = fakeServer({ onStream: (proc, params, _id, n) => {
    active(proc);
    if (n === 1) { proc.push('notifications/events/event', ev(1)); proc.push('notifications/events/terminated', { error: { message: 'boom' } }); }
    else if (n === 2) proc.push('notifications/events/terminated', { error: { message: 'invalid_cursor' } });
    else proc.push('notifications/events/event', ev(2));
  } });
  const { client, events, states } = make(server, ctx);
  client.start();
  await until(() => events.length === 2);
  const cursors = server.procs.map((p) => p.received.find((m) => m.method === 'events/stream').params.cursor);
  assert.deepEqual(cursors, [null, 'c1', null]);
  assert.ok(states.some((s) => s.truncated === true));
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('si onEvent lanza no avanza el cursor y el evento se reentrega tras reconectar', async () => {
  const ctx = tmp();
  const server = fakeServer({ onStream: (proc, _p, _id, n) => {
    active(proc);
    proc.push('notifications/events/event', ev(1));
    proc.push('notifications/events/event', ev(2));
  } });
  let failed = false;
  const got = [];
  const client = createTaskActivityClient({
    spawn: server.spawn, workspace: '/w', statePath: ctx.statePath,
    onEvent: (e) => { if (e.eventId === 'e2' && !failed) { failed = true; throw new Error('fallo'); } got.push(e.eventId); },
    backoff: { baseMs: 5, maxMs: 20, jitter: () => 0 },
  });
  client.start();
  await until(() => got.length >= 2);
  // e2 lanzó: el cursor se quedó en c1 y e2 no se marcó como visto, así que se reentrega.
  assert.equal(server.procs[1].received.find((m) => m.method === 'events/stream').params.cursor, 'c1');
  assert.deepEqual(got, ['e1', 'e2']);
  assert.equal(client.status().duplicates, 1);
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('stop envía notifications/cancelled, mata el proceso y no reconecta', async () => {
  const ctx = tmp();
  const server = fakeServer({ onStream: (proc) => active(proc) });
  const { client } = make(server, ctx);
  client.start();
  await until(() => client.status().state === 'streaming');
  client.stop();
  const proc = server.procs[0];
  await until(() => proc.received.some((m) => m.method === 'notifications/cancelled'));
  const streamId = proc.received.find((m) => m.method === 'events/stream').id;
  assert.equal(proc.received.find((m) => m.method === 'notifications/cancelled').params.requestId, streamId);
  assert.equal(proc.killed, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(server.procs.length, 1);
  assert.equal(client.status().state, 'stopped');
  rmSync(ctx.dir, { recursive: true });
});

test('reconecta si pasan 3 intervalos de heartbeat sin mensajes', async () => {
  const ctx = tmp();
  const server = fakeServer({ onStream: (proc) => active(proc, 'a0', { heartbeatMs: 20 }) });
  const { client } = make(server, ctx);
  client.start();
  await until(() => server.procs.length >= 2, 3000);
  assert.equal(server.procs[0].killed, true);
  assert.ok(client.status().reconnects >= 1);
  client.stop(); rmSync(ctx.dir, { recursive: true });
});

test('tolera líneas JSON inválidas y mensajes partidos en varios fragmentos', async () => {
  const ctx = tmp();
  const server = fakeServer({ onStream: (proc) => {
    active(proc);
    proc.raw('esto no es json\n');
    proc.raw('{"oops":\n');
    const line = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/events/event', params: ev(1) });
    proc.raw(line.slice(0, 20));
    setTimeout(() => proc.raw(`${line.slice(20)}\n`), 10);
  } });
  const { client, events } = make(server, ctx);
  client.start();
  await until(() => events.length === 1);
  assert.equal(events[0].eventId, 'e1');
  assert.equal(client.status().state, 'streaming');
  client.stop(); rmSync(ctx.dir, { recursive: true });
});
