import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { connectHost } from '../desktop/host-client.mjs';
import { SETUP_MARKER } from '../host/worktree-setup.mjs';
import { until, setupRepository } from './support/host-pty-fixture.mjs';

test('background dependency failure preserves a writable shell; retry, attach and restart preserve worktree', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-host-setup-'));
  const { repository, git } = setupRepository(root, 'fail');
  const dataDir = path.join(root, 'state');
  let host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: repository });
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal' });
  const create = () => host.invoke('terminal.create', { workspaceId: workspace.id, nodeId: node.id, shell: '/bin/sh' });
  const initial = await create();
  await until(() => host.terminals.get(initial.session.id).setup?.status === 'failed', 15000);
  assert.match(host.terminals.get(initial.session.id).setup.error, /HOST_SETUP_FIXTURE_FAILED/);
  host.store.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8')).workspaces.find(w => w.id === workspace.id).nodes.find(n => n.id === node.id).data;
  assert.ok(saved.worktree.branch);
  assert.equal(saved.cwd, saved.worktree.path);
  assert.equal(host.terminals.live.size, 1);
  assert.equal(git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2);
  assert.equal(fs.existsSync(path.join(repository, 'node_modules')), false);
  fs.writeFileSync(path.join(saved.cwd, 'private-change.txt'), 'preserved');
  fs.unlinkSync(path.join(saved.cwd, 'fail'));
  const launched = initial;
  await host.invoke('terminal.write', {sessionId: initial.session.id, data: "printf 'AGENT_%s\\n' 'READY'\n"});
  await until(async () => (await host.invoke('terminal.attach', {sessionId: initial.session.id})).data.includes('AGENT_READY'));
  await until(() => !host.terminals.setupJobs.size);
  await host.invoke('terminal.setup.retry', {sessionId: initial.session.id});
  await until(() => host.terminals.get(initial.session.id).setup?.status === 'ready', 15000);
  assert.equal(launched.session.cwd, saved.cwd);
  assert.equal(launched.session.worktree.branch, saved.worktree.branch);
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'install-count'), 'utf8'), '2');
  // A changed lock does not install on attach or a new transport connection.
  fs.appendFileSync(path.join(saved.cwd, 'package-lock.json'), '\n');
  const client = await connectHost({ dataDir });
  try { assert.equal((await client.invoke('terminal.attach', { sessionId: launched.session.id })).session.pid, launched.session.pid); }
  finally { client.close(); }
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'install-count'), 'utf8'), '2');
  await host.close();
  host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'install-count'), 'utf8'), '2');
  assert.equal(host.terminals.live.size, 0);
  const retried = await create();
  assert.equal(retried.session.cwd, saved.cwd);
  await until(() => host.terminals.get(retried.session.id).setup?.status === 'ready', 15000);
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'install-count'), 'utf8'), '3');
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'private-change.txt'), 'utf8'), 'preserved');
  assert.equal(git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2);
});

for (const action of ['host', 'terminal']) test(`closing ${action} during npm ci cancels setup and reaps lifecycle descendants`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-host-setup-close-'));
  const { repository } = setupRepository(root, 'slow');
  const dataDir = path.join(root, 'state');
  let host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: repository });
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal' });
  const launched = await host.invoke('terminal.create', { workspaceId: workspace.id, nodeId: node.id, shell: '/bin/sh' });
  assert.equal(launched.session.status, 'running');
  assert.equal(launched.session.setup.status, 'queued');
  const cwd = await until(() => {
    const cwd = host.store.getWorkspace(workspace.id).nodes.find(n => n.id === node.id).data.cwd;
    return cwd && fs.existsSync(path.join(cwd, 'descendant-pid')) && cwd;
  }, 15000);
  const pid = Number(fs.readFileSync(path.join(cwd, 'descendant-pid'), 'utf8'));
  if (action === 'host') await host.close();
  else await host.invoke('terminal.close', { workspaceId: workspace.id, nodeId: node.id });
  assert.equal(host.terminals.setupJobs.size, 0);
  assert.equal(host.terminals.live.size, 0);
  await until(() => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); } catch { return true; } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', SETUP_MARKER), 'utf8')).state, 'incomplete');
  if (action === 'host') {
    host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
    assert.equal(fs.readFileSync(path.join(cwd, 'install-count'), 'utf8'), '1');
    fs.unlinkSync(path.join(cwd, 'slow'));
    const retry = await host.invoke('terminal.create', { workspaceId: workspace.id, nodeId: node.id, shell: '/bin/sh' });
    assert.equal(retry.session.cwd, cwd);
    await until(() => host.terminals.get(retry.session.id).setup?.status === 'ready', 15000);
    assert.equal(fs.readFileSync(path.join(cwd, 'install-count'), 'utf8'), '2');
  } else assert.equal(host.store.getWorkspace(workspace.id).nodes.some(n => n.id === node.id), false);
});
