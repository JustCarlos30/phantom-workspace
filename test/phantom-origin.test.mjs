import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../host/store.mjs';
import { handleIntegration } from '../integrations/index.mjs';

async function fixture(t, { chatRunning, worktree } = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'phantom-origin-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cli = path.join(home, 'inert.mjs');
  await writeFile(cli, '// Not executed');
  const store = new Store(path.join(home, 'host'));
  const workspace = store.transaction(() => store.open(home));
  const spawn = () => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 4242; child.kill = () => true; return child; };
  const context = { dataDir: store.dir, state: store.state, getWorkspace: id => store.getWorkspace(id), persist: () => store.persist(), spawn,
    sessions: [{ id: 'sess-live', nodeId: 'node-1', workspaceId: workspace.id, status: 'running' }, { id: 'sess-dead', nodeId: 'node-2', workspaceId: workspace.id, status: 'lost' }],
    execFile: async (_file, args) => { if (args.includes('show')) return { stdout: JSON.stringify({ id: 'task_origin', contract: { workspace: home, checks: [] } }) }; throw new Error('Not a Git workspace'); } };
  if (chatRunning) context.chatRunning = chatRunning;
  if (worktree !== undefined) workspace.nodes.push({ id: 'node-1', type: 'terminal', title: 'T', x: 0, y: 0, w: 100, h: 100, data: worktree ? { worktree: { path: worktree === 'same' ? home : worktree } } : {} });
  const call = async (method, payload) => (await handleIntegration(method, { workspaceId: workspace.id, ...payload }, context)).result;
  await call('plugins.update', { id: 'phantom', patch: { config: { phantomPath: cli } } });
  return { run: async (id, extra) => {
    await call('phantom.control', { id: 'task_origin', action: 'run', model: 'claude-sonnet-5-5', ...extra });
    return (await call('phantom.controllers', {})).items.at(-1);
  }, id: () => 'task_origin', home, workspace };
}

test('origin lleva via chat si el chat del nodo tiene un turno en curso', async t => {
  const f = await fixture(t, { chatRunning: id => id === 'node-1' });
  assert.deepEqual((await f.run('x', { sessionId: 'sess-live' })).origin, { nodeId: 'node-1', via: 'chat' });
  const g = await fixture(t, { chatRunning: () => false });
  assert.deepEqual((await g.run('x', { sessionId: 'sess-live' })).origin, { nodeId: 'node-1' });
});

test('el chat principal lanza con main:true y queda como origin via chat', async t => {
  let asked;
  const f = await fixture(t, { chatRunning: id => { asked = id; return id.startsWith('phantom:'); } });
  const item = await f.run('x', { main: true });
  assert.deepEqual(item.origin, { nodeId: `phantom:${f.workspace.id}`, via: 'chat' });
  assert.equal(asked, `phantom:${f.workspace.id}`);
  const g = await fixture(t, { chatRunning: () => false });
  assert.equal('origin' in await g.run('x', { main: true }), false);
  const h = await fixture(t);
  assert.equal('origin' in await h.run('x', { main: true }), false);
});

test('rechaza lanzar un encargo de otro worktree desde una terminal con worktree propio', async t => {
  const f = await fixture(t, { worktree: '/tmp/otro-worktree' });
  await assert.rejects(f.run('x', { sessionId: 'sess-live' }), error => /\/tmp\/otro-worktree/.test(error.message) && error.message.includes(f.home) && /handoff/.test(error.message));
  const g = await fixture(t, { worktree: 'same' });
  assert.deepEqual((await g.run('x', { sessionId: 'sess-live' })).origin, { nodeId: 'node-1' });
  const h = await fixture(t, { worktree: null });
  assert.deepEqual((await h.run('x', { sessionId: 'sess-live' })).origin, { nodeId: 'node-1' });
});

test('el descriptor guarda origin.nodeId cuando el sessionId es de una sesión viva', async t => {
  const f = await fixture(t);
  const item = await f.run('x', { sessionId: 'sess-live' });
  assert.deepEqual(item.origin, { nodeId: 'node-1' });
});

test('omite origin si la sesión no está viva, no existe o el sessionId es inválido', async t => {
  for (const sessionId of ['sess-dead', 'sess-unknown', 'bad\u0000id', 42, undefined]) {
    const f = await fixture(t);
    const item = await f.run('x', { sessionId });
    assert.equal('origin' in item, false, String(sessionId));
  }
});
