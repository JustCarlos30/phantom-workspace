import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHost } from '../host/server.mjs';

// Host real (socket, PTY /bin/sh, stores en dataDir temporal) con un proceso `phantom mcp` falso inyectado.
// El primer plano y lo escrito/enviado se simulan con deliveryOptions: no se lanza ningún CLI de agente.
const P = 'task_11111111-1111-4111-8111-111111111111';
// Hijas de P: los eventos de tareas hijas con dueño van a la audiencia owner; las raíz, a la del workspace.
const C = 'task_22222222-2222-4222-8222-222222222222';
const U = 'task_33333333-3333-4333-8333-333333333333';
const EXT = 'io.modelcontextprotocol/events';
const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('Condición no cumplida a tiempo');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeHarness({ extension = true } = {}) {
  const procs = [];
  const notice = (method, params) => ({ jsonrpc: '2.0', method, params });
  const frame = ({ id, taskId, parentTaskId, type, payload = {} }) => notice('notifications/events/event', {
    eventId: id, name: 'phantom.task.activity', timestamp: new Date().toISOString(), cursor: `cur-${id}`,
    data: { taskId, runId: 'run_1', parentTaskId, type, payload },
  });
  const spawn = (command, args) => {
    const proc = new EventEmitter();
    proc.launch = { command, args };
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.out = (message) => proc.stdout.write(`${JSON.stringify(message)}\n`);
    proc.stdin = Object.assign(new EventEmitter(), {
      write(text) {
        for (const line of String(text).split('\n').filter(Boolean)) {
          const m = JSON.parse(line);
          if (m.method === 'server/discover') proc.out({ jsonrpc: '2.0', id: m.id, result: { capabilities: { extensions: extension ? { [EXT]: {} } : {} } } });
          else if (m.method === 'events/stream') {
            proc.streaming = true;
            proc.out(notice('notifications/events/active', { cursor: 'cur-0', truncated: false, heartbeatMs: 60000 }));
          }
        }
        return true;
      },
    });
    proc.kill = () => { proc.streaming = false; return true; };
    procs.push(proc);
    return proc;
  };
  return { spawn, procs, push: (...events) => { for (const p of procs) if (p.streaming) for (const e of events) p.out(frame(e)); } };
}

async function fixture(t, { harness = fakeHarness(), escalateAfterMs = 400 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-delivery-'));
  const dataDir = path.join(root, 'state');
  const foreground = new Set(), writes = [], chatSends = [];
  const start = (h) => createHost({
    dataDir,
    handleIntegration: async () => ({ handled: false }),
    supervisorOptions: { summarize: async () => ({ summary: 'Sin novedades', proposals: [] }) },
    activityOptions: { spawn: h.spawn, launch: async (w) => ({ command: 'fake-phantom', args: ['mcp'], root: w.canonicalPath }), client: { backoff: { baseMs: 5, maxMs: 20 } } },
    deliveryOptions: {
      foreground: (id) => (foreground.has(id) ? { command: 'claude', agent: 'claude', shell: false } : null),
      write: (id, data) => { writes.push({ id, data }); },
      chatSend: (sub, message) => { chatSends.push({ id: sub.id, message }); },
      delivery: { windowMs: 20, retryMs: 40, escalateAfterMs },
    },
  });
  let host = await start(harness);
  t.after(async () => { await host.close().catch(() => {}); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: root });
  const status = async () => (await host.invoke('workspace.events.status', { workspaceId: workspace.id })).workspaces[0];
  return {
    root, dataDir, workspace, status, harness, foreground, writes, chatSends,
    get host() { return host; },
    streaming: () => until(async () => { const s = await status(); return s.client?.state === 'streaming' && s; }),
    restart: async (h) => { await host.close(); host = await start(h); return host; },
  };
}

const session = async (f) => {
  const { node, session: s } = await f.host.invoke('terminal.create', { workspaceId: f.workspace.id, shell: '/bin/sh' });
  return { node, sessionId: s.id };
};
const owned = (f, node, taskId) => f.host.emit({ type: 'tool.status', workspaceId: f.workspace.id, id: `ctl-${taskId}`, status: 'completed', result: { source: 'phantom', action: 'create', taskId, title: 'Tarea', origin: { nodeId: node.id } } });
const subscriber = (f, id) => f.host.eventDelivery.status().subscribers.find((s) => s.id === id);
const sentTo = (f, sessionId, needle) => f.writes.filter((w) => w.id === sessionId && w.data.includes(needle));
// El rol orquestador solo se crea con Incorporaciones activas sobre git; aquí se fija en el estado y se reconcilia.
async function orchestrator(f) {
  const o = await session(f);
  f.host.store.getWorkspace(f.workspace.id).nodes.find((n) => n.id === o.node.id).data.role = 'orchestrator';
  await f.host.invoke('workspace.update', { id: f.workspace.id, patch: { name: 'Proyecto' } });
  await until(() => subscriber(f, o.node.id)?.role === 'orchestrator');
  return o;
}

test('un bloqueo de una tarea con dueño llega como aviso a la terminal dueña con agente en primer plano', async (t) => {
  const f = await fixture(t);
  const { node, sessionId } = await session(f);
  assert.equal(subscriber(f, node.id).role, 'worker');
  assert.equal(subscriber(f, `phantom:${f.workspace.id}`).role, 'assistant');
  f.foreground.add(sessionId);
  await f.streaming();
  owned(f, node, P);
  f.harness.push({ id: 'e1', taskId: C, parentTaskId: P, type: 'task.blocked', payload: { reason: 'budget exhausted: maxTokens' } });
  const [sent] = await until(() => { const found = sentTo(f, sessionId, C); return found.length && found; });
  assert.ok(sent.data.endsWith('\r') && !sent.data.slice(0, -1).includes('\n'), 'una sola línea más \\r');
  assert.match(sent.data, /Aviso automático de Phantom Workspace/);
  assert.match(sent.data, /blocked/);
});

test('una tarea raíz cancelada avisa a su terminal dueña', async (t) => {
  const f = await fixture(t);
  const { node, sessionId } = await session(f);
  f.foreground.add(sessionId);
  await f.streaming();
  owned(f, node, P);
  f.harness.push({ id: 'r0', taskId: P, parentTaskId: null, type: 'task.cancelled', payload: {} });
  const [sent] = await until(() => { const found = sentTo(f, sessionId, P); return found.length && found; });
  assert.match(sent.data, /Aviso automático de Phantom Workspace/);
});

test('una terminal no recibe el aviso de una tarea raíz de otra terminal del mismo workspace', async (t) => {
  const f = await fixture(t);
  const mine = await session(f);
  const other = await session(f);
  f.foreground.add(mine.sessionId);
  f.foreground.add(other.sessionId);
  await f.streaming();
  owned(f, other.node, U);
  owned(f, mine.node, P);
  f.harness.push({ id: 'r1', taskId: U, parentTaskId: null, type: 'task.cancelled', payload: {} });
  f.harness.push({ id: 'r2', taskId: P, parentTaskId: null, type: 'task.cancelled', payload: {} });
  await until(() => sentTo(f, mine.sessionId, P).length > 0);
  await until(() => sentTo(f, other.sessionId, U).length > 0);
  assert.equal(sentTo(f, mine.sessionId, U).length, 0, 'no recibe la tarea raíz ajena');
});

test('una tarea raíz bloqueada llega a su terminal dueña con la categoría del bloqueo', async (t) => {
  const f = await fixture(t);
  const { node, sessionId } = await session(f);
  f.foreground.add(sessionId);
  await f.streaming();
  owned(f, node, P);
  f.harness.push({ id: 'b1', taskId: P, parentTaskId: null, type: 'task.blocked', payload: { reason: 'budget exhausted: maxTokens' } });
  const [sent] = await until(() => { const found = sentTo(f, sessionId, P); return found.length && found; });
  assert.match(sent.data, /blocked/);
  assert.match(sent.data, /budget/i);
});

test('sin agente en primer plano escala al orquestador y luego al chat principal', async (t) => {
  const f = await fixture(t);
  const worker = await session(f);
  const orch = await orchestrator(f);
  await f.streaming();
  f.foreground.add(orch.sessionId);
  owned(f, worker.node, P);
  f.harness.push({ id: 'e1', taskId: C, parentTaskId: P, type: 'task.blocked', payload: { reason: 'budget exhausted: maxTokens' } });
  const [toOrch] = await until(() => { const found = sentTo(f, orch.sessionId, `La tarea ${C}`); return found.length && found; });
  assert.match(toOrch.data, /El dueño no pudo atenderlo/);
  assert.equal(sentTo(f, worker.sessionId, C).length, 0, 'el dueño nunca tuvo agente en primer plano');
  assert.equal(f.chatSends.length, 0);

  f.foreground.delete(orch.sessionId);
  f.harness.push({ id: 'e2', taskId: U, parentTaskId: P, type: 'task.blocked', payload: { reason: 'budget exhausted: maxTokens' } });
  const main = await until(() => f.chatSends.find((c) => c.message.includes(U)));
  assert.equal(main.id, `phantom:${f.workspace.id}`);
  assert.equal(sentTo(f, orch.sessionId, U).length, 0);
});

test('una transición de integración ready llega al orquestador', async (t) => {
  const f = await fixture(t);
  const worker = await session(f);
  const orch = await orchestrator(f);
  f.foreground.add(orch.sessionId);
  const item = { id: 'req-1', branch: 'feature/x', nodeId: worker.node.id };
  f.host.merges.transition(f.workspace.id, item, 'queued');
  f.host.merges.transition(f.workspace.id, item, 'ready');
  const [sent] = await until(() => { const found = sentTo(f, orch.sessionId, 'req-1'); return found.length && found; });
  assert.match(sent.data, /merge req-1/);
});

test('el aviso final legacy no se duplica con streaming activo y sí se entrega sin streaming', async (t) => {
  const finished = (f, node, runId, taskId) => f.host.emit({ type: 'tool.status', workspaceId: f.workspace.id, id: runId, status: 'completed', result: { source: 'phantom', action: 'run', id: runId, taskId, origin: { nodeId: node.id, via: 'terminal' }, status: 'completed', exitCode: 0 } });

  const live = await fixture(t);
  const a = await session(live);
  live.foreground.add(a.sessionId);
  await live.streaming();
  finished(live, a.node, 'run-live', P);
  await pause(300);
  assert.equal(sentTo(live, a.sessionId, 'terminó').length, 0, 'con streaming llega por el bus');

  const down = await fixture(t, { harness: fakeHarness({ extension: false }) });
  const b = await session(down);
  down.foreground.add(b.sessionId);
  await until(async () => (await down.status()).client?.state === 'unsupported');
  finished(down, b.node, 'run-down', P);
  const [sent] = await until(() => { const found = sentTo(down, b.sessionId, 'terminó'); return found.length && found; });
  assert.match(sent.data, new RegExp(P));
});

test('tras reiniciar el host un aviso pendiente se entrega una sola vez', async (t) => {
  const f = await fixture(t, { escalateAfterMs: 600000 });
  const { node } = await session(f);
  await f.streaming();
  owned(f, node, P);
  f.harness.push({ id: 'e1', taskId: C, parentTaskId: P, type: 'task.blocked', payload: { reason: 'budget exhausted: maxTokens' } });
  await until(() => subscriber(f, node.id)?.queued >= 1);
  assert.equal(f.writes.length, 0, 'sin agente en primer plano no se escribe');

  await f.restart(fakeHarness());
  const again = await f.host.invoke('terminal.create', { workspaceId: f.workspace.id, nodeId: node.id, shell: '/bin/sh' });
  assert.ok(subscriber(f, node.id).queued >= 1, 'el aviso pendiente sobrevivió al reinicio');
  f.foreground.add(again.session.id);
  await until(() => sentTo(f, again.session.id, C).length);
  await pause(300);
  assert.equal(sentTo(f, again.session.id, C).length, 1);
  assert.ok(subscriber(f, node.id).delivered >= 1);
});

async function chatMode(f, node) {
  f.host.store.getWorkspace(f.workspace.id).nodes.find((n) => n.id === node.id).data.chat = { provider: 'claude' };
  await f.host.invoke('workspace.update', { id: f.workspace.id, patch: { name: 'Proyecto' } });
}
const blocked = (f, id = 'e1') => f.harness.push({ id, taskId: C, parentTaskId: P, type: 'task.blocked', payload: { reason: 'budget exhausted: maxTokens' } });
const finishedRun = (f, nodeId, via, runId = 'run-x') => f.host.emit({ type: 'tool.status', workspaceId: f.workspace.id, id: runId, status: 'completed', result: { source: 'phantom', action: 'run', id: runId, taskId: P, origin: { nodeId, via }, status: 'completed', exitCode: 0 } });

test('terminal en modo chat sin agente en primer plano recibe el aviso por chat en ese nodo', async (t) => {
  const f = await fixture(t);
  const { node, sessionId } = await session(f);
  await chatMode(f, node);
  await f.streaming();
  owned(f, node, P);
  blocked(f);
  const sent = await until(() => f.chatSends.find((c) => c.message.includes(C)));
  assert.equal(sent.id, node.id);
  assert.equal(f.chatSends.filter((c) => c.message.includes(C)).length, 1);
  assert.equal(sentTo(f, sessionId, C).length, 0);
});

test('terminal en modo chat con agente en primer plano usa el PTY', async (t) => {
  const f = await fixture(t);
  const { node, sessionId } = await session(f);
  await chatMode(f, node);
  f.foreground.add(sessionId);
  await f.streaming();
  owned(f, node, P);
  blocked(f);
  await until(() => sentTo(f, sessionId, C).length);
  await pause(200);
  assert.equal(sentTo(f, sessionId, C).length, 1);
  assert.equal(f.chatSends.filter((c) => c.id === node.id).length, 0);
});

test('fin de tarea lanzada desde el chat principal produce un aviso al chat principal con streaming', async (t) => {
  const f = await fixture(t);
  const main = `phantom:${f.workspace.id}`;
  await f.streaming();
  f.host.emit({ type: 'tool.status', workspaceId: f.workspace.id, id: `ctl-${P}`, status: 'completed', result: { source: 'phantom', action: 'create', taskId: P, title: 'Tarea', origin: { nodeId: main, via: 'chat' } } });
  f.harness.push({ id: 'e1', taskId: P, type: 'task.completed', payload: {} });
  await until(() => f.chatSends.find((c) => c.id === main && c.message.includes(P)));
  await pause(300);
  assert.equal(f.chatSends.filter((c) => c.id === main && c.message.includes(P)).length, 1);
});

test('aviso de fin de tarea para un dueño ocupado queda en cola y se entrega una sola vez al quedar libre', async (t) => {
  const f = await fixture(t, { escalateAfterMs: 600000 });
  const { node, sessionId } = await session(f);
  await f.streaming();
  f.host.emit({ type: 'tool.status', workspaceId: f.workspace.id, id: `ctl-${P}`, status: 'running', result: { source: 'phantom', action: 'create', taskId: P, title: 'Tarea', origin: { nodeId: node.id } } });
  f.harness.push({ id: 'e1', taskId: C, parentTaskId: P, type: 'task.completed', payload: {} });
  await until(() => subscriber(f, node.id)?.queued >= 1);
  assert.equal(f.writes.length + f.chatSends.length, 0);
  f.foreground.add(sessionId);
  await until(() => sentTo(f, sessionId, C).length);
  await pause(300);
  assert.equal(sentTo(f, sessionId, C).length, 1);
  assert.equal(subscriber(f, node.id).queued, 0);
});

test('sin streaming un fin de tarea produce un único aviso (legacy) y ninguno por el bus', async (t) => {
  const f = await fixture(t, { harness: fakeHarness({ extension: false }) });
  const { node, sessionId } = await session(f);
  f.foreground.add(sessionId);
  await until(async () => (await f.status()).client?.state === 'unsupported');
  finishedRun(f, node.id, 'terminal');
  await until(() => sentTo(f, sessionId, 'terminó').length);
  await pause(400);
  assert.equal(sentTo(f, sessionId, P).length, 1);
  assert.equal(subscriber(f, node.id).delivered, 0);
  assert.equal(subscriber(f, node.id).queued, 0);
});

test('workspace.events.status incluye delivery filtrado a los workspaces visibles', async (t) => {
  const f = await fixture(t);
  const a = await session(f);
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-delivery-b-'));
  t.after(() => fs.rmSync(root2, { recursive: true, force: true }));
  const wb = await f.host.invoke('workspace.open', { path: root2 });
  const b = await f.host.invoke('terminal.create', { workspaceId: wb.id, shell: '/bin/sh' });

  const own = await f.host.invoke('workspace.events.status', { workspaceId: f.workspace.id });
  const ids = own.delivery.subscribers.map((s) => s.id);
  assert.ok(ids.includes(a.node.id) && ids.includes(`phantom:${f.workspace.id}`));
  assert.ok(!ids.includes(b.node.id));
  assert.ok(own.delivery.subscribers.every((s) => s.workspaceId === f.workspace.id));
  assert.equal(typeof own.delivery.totals.delivered, 'number');

  const bySession = await f.host.invoke('workspace.events.status', { sessionId: a.sessionId });
  assert.ok(bySession.delivery.subscribers.every((s) => s.workspaceId === f.workspace.id));
  assert.ok(!JSON.stringify(bySession.delivery).includes(b.node.id));
});
