import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHost } from '../host/server.mjs';

// Host real (socket, PTY /bin/sh, stores en dataDir temporal) con un proceso `phantom mcp` falso inyectado.
const P = 'task_11111111-1111-4111-8111-111111111111';
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

function fakeHarness({ extension = true, replay = [] } = {}) {
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
            for (const event of replay) proc.out(frame(event));
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

async function fixture(t, { harness = fakeHarness(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-activity-')) } = {}) {
  const dataDir = path.join(root, 'state');
  const start = (h) => createHost({
    dataDir,
    handleIntegration: async () => ({ handled: false }),
    supervisorOptions: { summarize: async () => ({ summary: 'Sin novedades', proposals: [] }) },
    activityOptions: { spawn: h.spawn, launch: async (w) => ({ command: 'fake-phantom', args: ['mcp'], root: w.canonicalPath }), client: { backoff: { baseMs: 5, maxMs: 20 } } },
  });
  let host = await start(harness);
  t.after(async () => { await host.close().catch(() => {}); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: root });
  const status = async () => (await host.invoke('workspace.events.status', { workspaceId: workspace.id })).workspaces[0];
  return {
    root, dataDir, workspace, status, harness,
    get host() { return host; },
    streaming: () => until(async () => { const s = await status(); return s.client?.state === 'streaming' && s; }),
    restart: async (h) => { await host.close(); host = await start(h); return host; },
  };
}

const session = async (f) => {
  const { node, session: s } = await f.host.invoke('terminal.create', { workspaceId: f.workspace.id, shell: '/bin/sh' });
  return { node, sessionId: s.id };
};
const owned = (f, node, taskId) => f.host.emit({ type: 'tool.status', workspaceId: f.workspace.id, id: 'ctl-1', status: 'completed', result: { source: 'phantom', action: 'create', taskId, title: 'Padre', origin: { nodeId: node.id } } });

test('eventos del stream salen por workspace.events con dueño y padre correctos', async (t) => {
  const f = await fixture(t);
  const { node, sessionId } = await session(f);
  await f.streaming();
  const start = (await f.host.invoke('workspace.events', { sessionId })).cursor;
  owned(f, node, P);
  f.harness.push({ id: 'e1', taskId: C, parentTaskId: P, type: 'task.running' });
  await until(async () => (await f.status()).bus.entities.some((e) => e.entityId === C));
  const { events } = await f.host.invoke('workspace.events', { sessionId, cursor: start });
  const child = events.filter((e) => e.kind === 'card' && e.entityId === C);
  assert.ok(child.length >= 1);
  assert.ok(child.every((e) => e.audience === 'owner' && e.ownerNodeId === node.id && e.parentId === P && e.workspaceId === f.workspace.id));
  assert.equal(child[0].phase, 'agent');
});

test('los eventos sobreviven a reiniciar el host sin duplicarse', async (t) => {
  const f = await fixture(t);
  await f.streaming();
  f.harness.push({ id: 'e1', taskId: U, type: 'task.created' }, { id: 'e2', taskId: U, type: 'task.running' }, { id: 'e3', taskId: U, type: 'task.verifying' });
  const before = await until(async () => { const s = await f.status(); return s.client.delivered === 3 && s; });
  await until(() => { try { return JSON.parse(fs.readFileSync(path.join(f.dataDir, 'task-activity', fs.readdirSync(path.join(f.dataDir, 'task-activity'))[0]), 'utf8')).seen.length === 3; } catch { return false; } });
  const replay = [{ id: 'e1', taskId: U, type: 'task.created' }, { id: 'e2', taskId: U, type: 'task.running' }, { id: 'e3', taskId: U, type: 'task.verifying' }];
  await f.restart(fakeHarness({ replay }));
  const after = await until(async () => { const s = await f.status(); return s.client?.state === 'streaming' && s.client.duplicates === 3 && s; });
  assert.equal(after.bus.seq, before.bus.seq, 'el replay no añade eventos al bus');
  const stable = (s) => s.bus.entities.map(({ lastActivity, ...rest }) => rest);
  assert.deepEqual(stable(after), stable(before));
  assert.equal(after.bus.entities.length, 1);
  assert.equal(after.client.delivered, 0);
});

test('una tarea sin mapeo sale solo en audiencia workspace', async (t) => {
  const f = await fixture(t);
  const { sessionId } = await session(f);
  await f.streaming();
  const start = (await f.host.invoke('workspace.events', { sessionId })).cursor;
  f.harness.push({ id: 'e1', taskId: U, type: 'task.blocked', payload: { reason: 'budget exhausted: maxTokens' } });
  await until(async () => (await f.status()).bus.entities.some((e) => e.entityId === U));
  const { events } = await f.host.invoke('workspace.events', { sessionId, cursor: start });
  const mine = events.filter((e) => e.entityId === U);
  assert.ok(mine.length >= 1);
  assert.ok(mine.every((e) => e.audience === 'workspace' && e.workspaceId === f.workspace.id && !e.ownerNodeId));
  assert.equal(mine.at(-1).status, 'blocked');
  assert.equal(mine.at(-1).blocker?.category, 'budget');
});

test('una transición de la cola emite el evento integration', async (t) => {
  const f = await fixture(t);
  const { node, sessionId } = await session(f);
  const start = (await f.host.invoke('workspace.events', { sessionId })).cursor;
  const item = { id: 'req-1', branch: 'feature/x', nodeId: node.id };
  f.host.merges.transition(f.workspace.id, item, 'queued');
  f.host.merges.transition(f.workspace.id, item, 'conflict', 'Conflicto en a.txt');
  const { events } = await f.host.invoke('workspace.events', { sessionId, cursor: start });
  const mine = events.filter((e) => e.kind === 'integration' && e.entityId === 'req-1');
  assert.deepEqual([...new Set(mine.map((e) => e.audience))].sort(), ['owner', 'workspace']);
  assert.deepEqual(mine.filter((e) => e.audience === 'owner').map((e) => e.status), ['queued', 'conflict']);
  assert.ok(mine.every((e) => e.branch === 'feature/x' && e.ownerNodeId === node.id));
});

async function twoWorkspaces(t) {
  const f = await fixture(t);
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-activity-b-'));
  t.after(() => fs.rmSync(root2, { recursive: true, force: true }));
  const wb = await f.host.invoke('workspace.open', { path: root2 });
  assert.notEqual(wb.id, f.workspace.id);
  const a = await session(f);
  const b = (await f.host.invoke('terminal.create', { workspaceId: wb.id, shell: '/bin/sh' }));
  const status = (p) => f.host.invoke('workspace.events.status', p);
  // Entidad del bus solo en el workspace B.
  f.host.merges.transition(wb.id, { id: 'req-b', branch: 'feature/b', nodeId: b.node.id }, 'queued');
  f.host.merges.transition(f.workspace.id, { id: 'req-a', branch: 'feature/a', nodeId: a.node.id }, 'queued');
  return { f, wb, a, b, status };
}

test('status: una sesión worker solo ve su propio workspace', async (t) => {
  const { f, a, status } = await twoWorkspaces(t);
  const own = await status({ sessionId: a.sessionId });
  assert.deepEqual(own.workspaces.map((w) => w.workspaceId), [f.workspace.id]);
});

test('status: una sesión pidiendo otro workspace recibe Forbidden', async (t) => {
  const { a, wb, status } = await twoWorkspaces(t);
  await assert.rejects(status({ sessionId: a.sessionId, workspaceId: wb.id }), { message: 'Forbidden' });
});

test('status: sesión inexistente o terminada recibe Forbidden', async (t) => {
  const { f, b, status } = await twoWorkspaces(t);
  await assert.rejects(status({ sessionId: 'nope' }), { message: 'Forbidden' });
  await f.host.invoke('terminal.stop', { sessionId: b.session.id });
  await until(() => f.host.terminals.get(b.session.id).status !== 'running');
  await assert.rejects(status({ sessionId: b.session.id }), { message: 'Forbidden' });
});

test('status: el renderer con workspaceId ve solo ese workspace y uno inexistente falla', async (t) => {
  const { wb, status } = await twoWorkspaces(t);
  const only = await status({ workspaceId: wb.id });
  assert.deepEqual(only.workspaces.map((w) => w.workspaceId), [wb.id]);
  assert.ok(only.workspaces[0].bus.entities.every((e) => e.workspaceId === wb.id));
  await assert.rejects(status({ workspaceId: 'inexistente' }));
});

test('status: la respuesta de una sesión no contiene entidades de otros workspaces', async (t) => {
  const { f, a, status } = await twoWorkspaces(t);
  const own = await status({ sessionId: a.sessionId });
  const ids = own.workspaces[0].bus.entities.map((e) => e.entityId);
  assert.ok(ids.includes('req-a'));
  assert.ok(!ids.includes('req-b'));
  assert.ok(own.workspaces[0].bus.entities.every((e) => e.workspaceId === f.workspace.id));
  assert.ok(!JSON.stringify(own).includes('req-b'));
});

test('un harness sin la extensión queda visible como unsupported y el host sigue funcionando', async (t) => {
  const f = await fixture(t, { harness: fakeHarness({ extension: false }) });
  const s = await until(async () => { const v = await f.status(); return v.client?.state === 'unsupported' && v; });
  assert.deepEqual(s.bus.entities, []);
  assert.equal((await f.host.invoke('system.info')).pid, process.pid);
});
