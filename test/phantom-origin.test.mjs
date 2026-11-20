import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../host/store.mjs';
import { handleIntegration } from '../integrations/index.mjs';

async function fixture(t) {
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
  const call = async (method, payload) => (await handleIntegration(method, { workspaceId: workspace.id, ...payload }, context)).result;
  await call('plugins.update', { id: 'phantom', patch: { config: { phantomPath: cli } } });
  return { run: async (id, extra) => {
    await call('phantom.control', { id: 'task_origin', action: 'run', model: 'claude-sonnet-5-5', ...extra });
    return (await call('phantom.controllers', {})).items.at(-1);
  }, id: () => 'task_origin' };
}

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
