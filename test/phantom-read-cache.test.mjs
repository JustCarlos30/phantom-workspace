import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../host/store.mjs';
import { handleIntegration } from '../integrations/index.mjs';
import { invalidatePhantomReadCache } from '../integrations/phantom.mjs';

async function fixture(t, ttl = 5000) {
  const home = await mkdtemp(path.join(tmpdir(), 'phantom-read-cache-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  invalidatePhantomReadCache();
  t.after(() => invalidatePhantomReadCache());
  const root = path.join(home, 'project');
  await mkdir(root);
  const cli = path.join(home, 'inert.mjs');
  await writeFile(cli, '// Not executed');
  const store = new Store(path.join(home, 'host'));
  const workspace = store.transaction(() => store.open(root));
  store.flush();
  const context = { dataDir: store.dir, state: store.state, getWorkspace: id => store.getWorkspace(id), persist: () => store.persist(), phantomReadCacheMs: ttl };
  const state = { reads: 0, fail: false, tasks: [{ id: 'task_a', status: 'done', contract: { goal: 'A', workspace: root } }] };
  context.execFile = async (file, args) => {
    if (file === 'git') throw new Error('Not a Git workspace');
    if (args.includes('list')) {
      state.reads++;
      await new Promise(resolve => setTimeout(resolve, 20));
      if (state.fail) throw new Error('boom');
      return { stdout: JSON.stringify(state.tasks) };
    }
    throw new Error('unexpected command');
  };
  const call = async (method, payload = {}) => {
    const response = await handleIntegration(method, { workspaceId: workspace.id, ...payload }, context);
    assert.equal(response.handled, true); return response.result;
  };
  await call('plugins.update', { id: 'phantom', patch: { config: { phantomPath: cli } } });
  return { state, call, context };
}

test('identical concurrent lists share one CLI invocation', async t => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([f.call('phantom.list', { topic: 'tasks' }), f.call('phantom.list', { topic: 'tasks' })]);
  assert.equal(f.state.reads, 1);
  assert.deepEqual(a.items.map(i => i.id), ['task_a']);
  assert.deepEqual(b, a);
});

test('a second read inside the TTL does not invoke the CLI again', async t => {
  const f = await fixture(t);
  await f.call('phantom.list', { topic: 'tasks' });
  await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(f.state.reads, 1);
});

test('a read after the TTL expires invokes the CLI again', async t => {
  const f = await fixture(t, 40);
  await f.call('phantom.list', { topic: 'tasks' });
  await new Promise(resolve => setTimeout(resolve, 80));
  await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(f.state.reads, 2);
});

test('invalidation forces a fresh read and TTL 0 disables the cache', async t => {
  const f = await fixture(t);
  await f.call('phantom.list', { topic: 'tasks' });
  f.state.tasks = [];
  invalidatePhantomReadCache();
  assert.deepEqual((await f.call('phantom.list', { topic: 'tasks' })).items, []);
  assert.equal(f.state.reads, 2);
  f.context.phantomReadCacheMs = 0;
  await f.call('phantom.list', { topic: 'tasks' });
  await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(f.state.reads, 4);
});

test('errors are not cached', async t => {
  const f = await fixture(t);
  f.state.fail = true;
  const failed = await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(failed.available, false);
  f.state.fail = false;
  const ok = await f.call('phantom.list', { topic: 'tasks' });
  assert.deepEqual(ok.items.map(i => i.id), ['task_a']);
  assert.equal(f.state.reads, 2);
});

test('mutating a returned result does not alter later reads', async t => {
  const f = await fixture(t);
  const first = await f.call('phantom.list', { topic: 'tasks' });
  first.items.length = 0;
  const second = await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(f.state.reads, 1);
  assert.deepEqual(second.items.map(i => i.id), ['task_a']);
  second.items[0].raw.status = 'mutated'; second.items[0].title = 'mutated';
  const third = await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(third.items[0].raw.status, 'done');
  assert.equal(third.items[0].title, 'A');
});
