import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHost } from '../host/server.mjs';
import { GUARD_MARKER, mergeToken, integrationPolicy } from '../host/merge-guard.mjs';
import { main as agent } from '../scripts/agent.mjs';
import { Merges, GitPolling } from '../host/merges.mjs';

const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 30)); } throw new Error('Timed out'); };
// Git as a process of a given terminal would run it: only the environment tells the guard who is asking.
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PHANTOM_')));
const gitAs = (env, cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...clean(), ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('merge polling shares concurrent rounds and queue writes invalidate cached Git results', async t => {
  const f = autoFixture(t);
  let rounds = 0;
  const original = f.merges.readStatus.bind(f.merges);
  f.merges.readStatus = async (...args) => { rounds++; return original(...args); };
  const [first, second] = await Promise.all([f.merges.status(f.workspace), f.merges.status(f.workspace)]);
  assert.strictEqual(first, second); assert.equal(rounds, 1);
  let calls = 0;
  const polling = f.merges.polling = new GitPolling(async () => { calls++; return 'file.txt'; });
  const args = ['diff', '--name-only', `${'a'.repeat(40)}...${'b'.repeat(40)}`];
  await Promise.all([polling.git('/repo', args), polling.git('/repo', args)]);
  await polling.git('/repo', args); assert.equal(calls, 1);
  f.merges.change(f.workspace.id, integration => { integration.plan = 'updated'; });
  await polling.git('/repo', args); assert.equal(calls, 2);
});

test('polling limits Git processes, retries errors and does not revive invalidated work', async () => {
  let active = 0, peak = 0;
  const polling = new GitPolling(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--; return '';
  });
  await Promise.all(Array.from({ length: 30 }, (_, index) => polling.git('/repo', ['rev-parse', String(index)])));
  assert.equal(peak, 8); assert.equal(active, 0);
  let attempts = 0;
  const failing = new GitPolling(async () => { if (++attempts === 1) throw new Error('retry'); return 'ok'; });
  const args = ['diff', 'a'.repeat(40)];
  await assert.rejects(failing.git('/repo', args), /retry/);
  assert.equal(await failing.git('/repo', args), 'ok'); assert.equal(attempts, 2);
  let finish;
  const pending = polling.read('pending', () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  polling.invalidate(); finish('old'); await pending;
  assert.equal(await polling.read('pending', () => 'new'), 'new');
});

test('immutable polling results expire after two seconds', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  let calls = 0;
  const polling = new GitPolling(async () => String(++calls));
  const args = ['rev-list', '--count', 'a'.repeat(40)];
  assert.equal(await polling.git('/repo', args), '1');
  t.mock.timers.tick(1999);
  assert.equal(await polling.git('/repo', args), '1');
  t.mock.timers.tick(1);
  assert.equal(await polling.git('/repo', args), '2');
});

function autoFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-auto-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repo'); fs.mkdirSync(repository);
  const git = (...args) => gitAs({}, repository, ...args);
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@localhost');
  fs.writeFileSync(path.join(repository, 'base.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'Base');
  const workspace = { id: 'auto-fixture', path: repository, nodes: [], attention: [], integration: { enabled: true, auto: false, checks: `${JSON.stringify(process.execPath)} -e "process.exit(require('node:fs').existsSync('bad.txt') ? 1 : 0)"`, queue: [] } };
  const sessions = [];
  const store = { dir: path.join(root, 'state'), state: { workspaces: [workspace] }, getWorkspace: () => workspace };
  const merges = new Merges({ store, terminals: { sessions, get: id => sessions.find(s => s.id === id) }, mutate: (id, fn) => fn(), emit: () => {} });
  const worker = (name, file = `${name}.txt`, content = name) => {
    const tree = path.join(root, name); git('worktree', 'add', '-b', name, tree, 'main');
    fs.writeFileSync(path.join(tree, file), content); gitAs({}, tree, 'add', '.'); gitAs({}, tree, 'commit', '-m', name);
    const session = { id: name, workspaceId: workspace.id, nodeId: name, cwd: tree, worktree: { branch: name, path: tree } };
    sessions.push(session); workspace.nodes.push({ id: name, title: name, type: 'terminal', data: { sessionId: name, role: 'worker', worktree: session.worktree } });
    return name;
  };
  const submit = sessionId => merges.handle('merge.submit', { sessionId });
  const configure = settings => merges.handle('merge.configure', { workspaceId: workspace.id, ...settings });
  const settled = () => until(() => !merges.running.size && !merges.draining.size);
  return { root, repository, git, workspace, merges, worker, submit, configure, settled };
}

test('auto defaults off; enabling it drains and submit integrates without an orchestrator with evidence and stats', async t => {
  const f = autoFixture(t), first = f.worker('one');
  await assert.rejects(f.configure({ auto: 'yes' }), /Invalid auto/);
  await f.submit(first); await f.settled();
  assert.equal(f.workspace.integration.queue[0].status, 'queued');
  assert.equal(f.git('rev-list', '--count', 'main'), '1');
  await f.configure({ auto: true }); await f.settled();
  const item = f.workspace.integration.queue[0];
  assert.equal(item.status, 'merged'); assert.equal(item.by, 'auto'); assert.ok(Date.parse(item.startedAt));
  assert.equal(item.checks.ok, true); assert.ok(item.checks.durationMs >= 0); assert.equal(item.fileCount, 1);
  await f.submit(f.worker('two')); await f.settled();
  const status = await f.merges.status(f.workspace);
  assert.equal(status.auto, true); assert.equal(status.orchestrator, null);
  assert.deepEqual({ ...status.stats, medianWaitMs: 0, medianChecksMs: 0 }, { queued: 0, returned: 0, oldestWaitMs: null, mergedToday: 2, filesToday: 2, mergedTotal: 2, medianWaitMs: 0, medianChecksMs: 0, autoMerged: 2 });
  assert.ok(status.stats.medianWaitMs >= 0); assert.ok(status.stats.medianChecksMs >= 0);
});

test('auto rolls failing checks back, returns the worker and continues the queue', async t => {
  const f = autoFixture(t);
  await f.submit(f.worker('bad', 'bad.txt')); await f.submit(f.worker('good'));
  await f.configure({ auto: true }); await f.settled();
  assert.deepEqual(f.workspace.integration.queue.map(item => item.status), ['failed', 'merged']);
  assert.equal(fs.existsSync(path.join(f.repository, 'bad.txt')), false);
  assert.equal(fs.existsSync(path.join(f.repository, 'good.txt')), true);
  assert.equal(f.workspace.nodes[0].data.agent.status, 'blocked');
  assert.ok(f.workspace.integration.queue[0].checks.durationMs >= 0);
  assert.equal((await f.merges.status(f.workspace)).stats.returned, 1);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('failed checks keep their output tail and the failure kind tells checks from conflicts', async t => {
  const f = autoFixture(t);
  f.workspace.integration.checks = `${JSON.stringify(process.execPath)} -e "console.log('x'.repeat(9000) + 'FIN'); process.exit(3)"`;
  await f.submit(f.worker('bad', 'bad.txt'));
  await f.configure({ auto: true }); await f.settled();
  const failed = f.workspace.integration.queue[0];
  assert.equal(failed.status, 'failed'); assert.equal(failed.failure, 'checks');
  assert.equal(failed.checks.ok, false); assert.equal(failed.checks.code, 3); assert.equal(failed.checks.timedOut, false); assert.ok(failed.checks.durationMs >= 0);
  assert.ok(failed.checks.output.trimEnd().endsWith('FIN')); assert.ok(failed.checks.output.length <= 8000); assert.match(failed.note, /Checks fallidos/);
  const listed = (await f.merges.status(f.workspace)).queue[0];
  assert.equal(listed.failure, 'checks'); assert.equal(listed.checks.output, failed.checks.output);

  const g = autoFixture(t);
  await g.submit(g.worker('one', 'base.txt', 'one\n')); await g.submit(g.worker('two', 'base.txt', 'two\n'));
  await g.configure({ auto: true }); await g.settled();
  assert.deepEqual(g.workspace.integration.queue.map(item => item.failure), [undefined, 'conflict']);
  assert.equal(g.workspace.integration.queue[1].checks, undefined);
});

test('operator withdraw and retry act by item id, only from valid states, without a session or token', async t => {
  const f = autoFixture(t), id = n => f.workspace.integration.queue[n].id, by = { workspaceId: f.workspace.id };
  await f.submit(f.worker('bad', 'bad.txt')); await f.submit(f.worker('good')); await f.submit(f.worker('also'));
  await f.configure({ auto: true }); await f.settled();
  assert.deepEqual(f.workspace.integration.queue.map(item => item.status), ['failed', 'merged', 'merged']);
  await f.configure({ auto: false });
  // Retry: only failed/conflict/stale go back to the queue; the evidence of the failure is cleared.
  await assert.rejects(f.merges.handle('merge.retry', { ...by, id: id(1) }), /estado «merged»/);
  await assert.rejects(f.merges.handle('merge.retry', { ...by, id: 'nope-nope' }), /no encontrada/);
  await assert.rejects(f.merges.handle('merge.retry', { id: id(0) }), /Invalid workspace ID/);
  const retried = await f.merges.handle('merge.retry', { ...by, id: id(0) });
  assert.equal(retried.status, 'queued'); assert.equal(retried.by, 'operator'); assert.equal(retried.failure, undefined); assert.equal(retried.checks, undefined);
  await assert.rejects(f.merges.handle('merge.retry', { ...by, id: id(0) }), /estado «queued»/);
  // Withdraw: queued/failed/conflict/rejected/stale; merged is final.
  await assert.rejects(f.merges.handle('merge.withdraw', { ...by, id: id(1) }), /estado «merged»/);
  const withdrawn = await f.merges.handle('merge.withdraw', { ...by, id: id(0) });
  assert.equal(withdrawn.status, 'withdrawn'); assert.equal(withdrawn.by, 'operator'); assert.ok(withdrawn.finishedAt);
  await assert.rejects(f.merges.handle('merge.withdraw', { ...by, id: id(0) }), /estado «withdrawn»/);
  for (const status of ['rejected', 'stale', 'conflict']) {
    f.workspace.integration.queue.push({ id: `item-${status}`, nodeId: 'x', title: 'x', branch: 'x', status, headOid: 'a'.repeat(40), requestedAt: new Date().toISOString() });
    assert.equal((await f.merges.handle('merge.withdraw', { ...by, id: `item-${status}` })).status, 'withdrawn');
  }
  // Worker sessions keep their own withdraw, and the orchestrator-only methods still demand the token.
  await f.submit(f.worker('late')); assert.equal((await f.merges.handle('merge.withdraw', { sessionId: 'late' })).status, 'withdrawn');
  await assert.rejects(f.merges.handle('merge.reject', { ...by, id: id(0), reason: 'x' }), /Solo la sesión orquestadora/);
  f.workspace.integration.enabled = false;
  await assert.rejects(f.merges.handle('merge.retry', { ...by, id: id(0) }), /no está activo/);
});

test('auto aborts conflicts, returns the worker and continues the queue', async t => {
  const f = autoFixture(t);
  await f.submit(f.worker('one', 'base.txt', 'one\n'));
  await f.submit(f.worker('two', 'base.txt', 'two\n'));
  await f.submit(f.worker('three'));
  await f.configure({ auto: true }); await f.settled();
  assert.deepEqual(f.workspace.integration.queue.map(item => item.status), ['merged', 'conflict', 'merged']);
  assert.equal(f.workspace.nodes[1].data.agent.status, 'blocked');
  assert.deepEqual(f.workspace.integration.queue[1].conflicts, ['base.txt']);
  assert.throws(() => f.git('rev-parse', '-q', '--verify', 'MERGE_HEAD'));
  assert.equal(f.git('status', '--porcelain'), '');
});

test('operational errors leave queued requests blocked until reconfigured', async t => {
  const f = autoFixture(t);
  await f.submit(f.worker('one')); await f.submit(f.worker('two'));
  fs.writeFileSync(path.join(f.repository, 'base.txt'), 'dirty\n');
  await f.configure({ auto: true }); await f.settled();
  assert.deepEqual(f.workspace.integration.queue.map(item => item.status), ['queued', 'queued']);
  assert.match(f.workspace.integration.autoBlocked.reason, /sin commitear/);
  assert.ok(Date.parse(f.workspace.integration.autoBlocked.at));
  const status = await f.merges.status(f.workspace);
  assert.equal(status.stats.queued, 2); assert.ok(status.stats.oldestWaitMs >= 0); assert.ok(status.autoBlocked);
  f.git('restore', 'base.txt'); f.merges.resume(); await f.settled();
  assert.equal(f.workspace.integration.queue[0].status, 'queued', 'a block does not retry in a loop');
  await f.configure({ auto: true }); await f.settled();
  assert.deepEqual(f.workspace.integration.queue.map(item => item.status), ['merged', 'merged']);
  assert.equal(f.workspace.integration.autoBlocked, undefined);
});

test('a conflict raises attention with failure, branch, first three conflicts and a stable eventKey', async t => {
  const f = autoFixture(t);
  const events = []; f.merges.emit = e => events.push(e);
  await f.submit(f.worker('one', 'base.txt', 'one\n')); await f.submit(f.worker('two', 'base.txt', 'two\n'));
  await f.configure({ auto: true }); await f.settled();
  const [item] = f.workspace.attention, request = f.workspace.integration.queue[1];
  assert.equal(f.workspace.attention.length, 1);
  assert.equal(item.source, 'incorporaciones'); assert.equal(item.failure, 'conflict'); assert.equal(item.branch, 'two');
  assert.deepEqual(item.conflicts, ['base.txt']); assert.equal(item.ref, request.id);
  assert.equal(item.eventKey, `merge:${request.id}:conflict:${request.headOid}`);
  await until(() => events.some(e => e.type === 'attention.new'));
});

test('a merge that cannot start raises one attention without blocking the worker, and a retry does not duplicate it', async t => {
  const f = autoFixture(t);
  const events = []; f.merges.emit = e => events.push(e);
  fs.writeFileSync(path.join(f.repository, '.git', 'hooks', 'pre-merge-commit'), '#!/bin/sh\necho rechazado >&2\nexit 1\n', { mode: 0o755 });
  await f.submit(f.worker('one'));
  const id = f.workspace.integration.queue[0].id;
  for (let i = 0; i < 2; i++) await assert.rejects(f.merges.execute(f.workspace, id, { by: 'orchestrator' }), /No se pudo incorporar/);
  const request = f.workspace.integration.queue[0];
  assert.equal(request.status, 'queued');
  assert.equal(f.workspace.attention.length, 1);
  const [item] = f.workspace.attention;
  assert.equal(item.failure, 'error'); assert.equal(item.branch, 'one'); assert.equal(item.eventKey, `merge:${id}:error:${request.headOid}`);
  assert.notEqual(f.workspace.nodes[0].data.agent?.status, 'blocked');
  await until(() => events.filter(e => e.type === 'attention.new').length === 1);
});

test('resume drains enabled automatic projects and stats use the latest thirty integrations', async t => {
  const f = autoFixture(t);
  await f.submit(f.worker('one'));
  f.workspace.integration.auto = true;
  f.merges.resume(); await f.settled();
  assert.equal(f.workspace.integration.queue[0].status, 'merged');
  const today = new Date(); today.setHours(12, 0, 0, 0);
  f.workspace.integration.queue = Array.from({ length: 32 }, (_, index) => ({
    id: `merged-${index}`, status: 'merged', requestedAt: new Date(today.getTime() + index * 10000).toISOString(),
    startedAt: new Date(today.getTime() + index * 10000 + index * 100).toISOString(),
    finishedAt: new Date(today.getTime() + index * 10000 + index * 100 + 1000).toISOString(),
    checks: { durationMs: index * 10 }, fileCount: 2, by: index % 2 ? 'auto' : 'orchestrator',
  }));
  const stats = (await f.merges.status(f.workspace)).stats;
  assert.deepEqual(stats, { queued: 0, returned: 0, oldestWaitMs: null, mergedToday: 32, filesToday: 64, mergedTotal: 32, medianWaitMs: 1650, medianChecksMs: 165, autoMerged: 15 });
});

test('workers own one branch; only the orchestrator session orders and integrates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-merges-')), repository = path.join(root, 'repository'), dataDir = path.join(root, 'state');
  fs.mkdirSync(repository);
  const git = (...args) => gitAs({}, repository, ...args);
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@localhost');
  fs.writeFileSync(path.join(repository, 'shared.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'Base');
  const host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: repository }), workspaceId = workspace.id;

  // Off by default: no hooks, no orchestrator, nothing to submit to.
  let status = await host.invoke('merge.status', { workspaceId });
  assert.equal(status.available, true); assert.equal(status.enabled, false); assert.equal(status.guard.installed, false); assert.equal(status.base.branch, 'main');
  await assert.rejects(host.invoke('node.create', { workspaceId, type: 'terminal', data: { role: 'orchestrator' } }), /Activa Incorporaciones/);
  status = await host.invoke('merge.configure', { workspaceId, enabled: true });
  assert.equal(status.guard.installed, true);
  for (const hook of ['reference-transaction', 'pre-push']) assert.ok(fs.readFileSync(path.join(repository, '.git/hooks', hook), 'utf8').includes(GUARD_MARKER));

  const open = async data => {
    const node = await host.invoke('node.create', { workspaceId, type: 'terminal', title: data.title, data: data.role ? { role: data.role } : {} });
    const { session, node: launched } = await host.invoke('terminal.create', { workspaceId, nodeId: node.id, shell: '/bin/sh' });
    return { node: launched, session, env: { PHANTOM_TERMINAL_SESSION_ID: session.id, PHANTOM_TERMINAL_ROLE: data.role ?? 'worker', ...(launched.data.worktree ? { PHANTOM_TERMINAL_BRANCH: launched.data.worktree.branch } : {}) } };
  };
  const one = await open({ title: 'Uno' }), two = await open({ title: 'Dos' });
  const commit = (worker, content, message) => { fs.writeFileSync(path.join(worker.session.cwd, 'shared.txt'), content); gitAs(worker.env, worker.session.cwd, 'commit', '-am', message); };

  // The guard: own branch yes; any other branch, the project checkout and pushes no.
  commit(one, 'uno\n', 'Uno cambia shared');
  assert.throws(() => gitAs(one.env, one.session.cwd, 'update-ref', 'refs/heads/main', 'HEAD'), /solo puede escribir su rama/);
  assert.throws(() => gitAs(one.env, one.session.cwd, 'branch', 'otra'), /solo puede escribir su rama/);
  assert.throws(() => gitAs(one.env, repository, 'commit', '--allow-empty', '-m', 'desde worker'), /solo puede escribir su rama/);
  assert.throws(() => gitAs(one.env, one.session.cwd, 'push', repository, 'HEAD:refs/heads/pushed'), /no puede hacer push/);
  assert.equal(git('rev-list', '--count', 'main'), '1');
  // The user's own Git is never restricted.
  git('branch', 'personal'); git('branch', '-D', 'personal');
  // The real PTY carries the role, so the guard applies to whatever the terminal runs.
  await host.invoke('terminal.write', { sessionId: one.session.id, data: 'printf "ROLE_%s_%s\\n" "$PHANTOM_TERMINAL_ROLE" "$PHANTOM_TERMINAL_BRANCH"\n' });
  await until(async () => (await host.invoke('terminal.attach', { sessionId: one.session.id })).data.includes(`ROLE_worker_${one.node.data.worktree.branch}`));

  // Requests need committed work.
  await assert.rejects(host.invoke('merge.submit', { sessionId: two.session.id }), /no tiene commits nuevos/);
  fs.writeFileSync(path.join(two.session.cwd, 'draft.txt'), 'pendiente');
  await assert.rejects(host.invoke('merge.submit', { sessionId: two.session.id }), /sin commitear/);
  fs.unlinkSync(path.join(two.session.cwd, 'draft.txt'));
  commit(two, 'dos\n', 'Dos cambia shared');
  status = await host.invoke('merge.status', { workspaceId });
  assert.deepEqual(status.active.map(item => [item.title, item.ahead, item.overlaps[0]?.path, item.overlaps[0]?.with]), [['Uno', 1, 'shared.txt', ['Dos']], ['Dos', 1, 'shared.txt', ['Uno']]]);
  host.store.getWorkspace(workspaceId).nodes.find(n => n.id === one.node.id).data.agent = { cardId: 'fixture-card-at-submit' };
  const first = await agent(['submit', 'Uno: nuevo contenido'], { ...one.env, PHANTOM_WORKSPACE_SOCKET: host.socketPath });
  assert.equal(first.cardId, 'fixture-card-at-submit');
  host.store.getWorkspace(workspaceId).nodes.find(n => n.id === one.node.id).data.agent.cardId = 'fixture-card-later';
  assert.equal((await host.invoke('merge.status', { workspaceId })).queue[0].cardId, 'fixture-card-at-submit');
  const second = await host.invoke('merge.submit', { sessionId: two.session.id, summary: 'Dos: otro contenido' });
  assert.deepEqual([first.position, second.position], [1, 2]);
  assert.equal(host.store.getWorkspace(workspaceId).nodes.find(n => n.id === one.node.id).data.agent.status, 'review');

  // Only the orchestrator session, with its token, orders and integrates.
  const orchestrator = await open({ title: 'Orquestador', role: 'orchestrator' });
  assert.equal(orchestrator.session.cwd, repository); assert.equal(orchestrator.node.data.worktree, null);
  await assert.rejects(host.invoke('node.create', { workspaceId, type: 'terminal', data: { role: 'orchestrator' } }), /ya tiene una sesión orquestadora/);
  const token = mergeToken(dataDir, workspaceId), lead = { sessionId: orchestrator.session.id, token };
  await assert.rejects(host.invoke('merge.run', { sessionId: one.session.id, token, id: first.id }), /Solo la sesión orquestadora/);
  await assert.rejects(host.invoke('merge.run', { sessionId: orchestrator.session.id, id: first.id }), /Solo la sesión orquestadora/);
  // The project's Phantom conversation has no terminal session: the merge token for the workspace is its proof.
  await assert.rejects(host.invoke('merge.note', { workspaceId, token: 'f'.repeat(64), id: first.id, text: 'x' }), /Solo la sesión orquestadora/);
  await assert.rejects(host.invoke('merge.note', { workspaceId, id: first.id, text: 'x' }), /Solo la sesión orquestadora/);
  const mainEnv = { PHANTOM_WORKSPACE_ID: workspaceId, PHANTOM_MERGE_TOKEN: token, PHANTOM_WORKSPACE_SOCKET: host.socketPath };
  assert.equal((await agent(['note', first.id.slice(0, 8), 'Desde el chat de Phantom'], mainEnv)).note, 'Desde el chat de Phantom');
  assert.deepEqual((await agent(['queue'], mainEnv)).queue.map(item => item.id).sort(), [first.id, second.id].sort());
  await assert.rejects(agent(['submit'], mainEnv), /Falta la identidad de terminal/);
  await host.invoke('terminal.write', { sessionId: orchestrator.session.id, data: 'printf "LEAD_%s_%s\\n" "$PHANTOM_TERMINAL_ROLE" "${PHANTOM_MERGE_TOKEN:+token}"\n' });
  await until(async () => (await host.invoke('terminal.attach', { sessionId: orchestrator.session.id })).data.includes('LEAD_orchestrator_token'));
  const leadEnv = { ...orchestrator.env, PHANTOM_MERGE_TOKEN: token, PHANTOM_WORKSPACE_SOCKET: host.socketPath };
  await agent(['plan', 'Primero Dos, luego Uno'], leadEnv);
  assert.deepEqual((await agent(['order', second.id, first.id], leadEnv)).map(item => item.title), ['Dos', 'Uno']);
  await agent(['note', first.id.slice(0, 8), 'Va después de Dos'], leadEnv);
  status = await agent(['queue'], leadEnv);
  assert.equal(status.self.role, 'orchestrator'); assert.equal(status.plan, 'Primero Dos, luego Uno');
  assert.deepEqual(status.queue.map(item => [item.title, item.position, item.note]), [['Dos', 1, ''], ['Uno', 2, 'Va después de Dos']]);

  assert.equal((await agent(['merge', second.id], leadEnv)).status, 'merged');
  assert.equal(fs.readFileSync(path.join(repository, 'shared.txt'), 'utf8'), 'dos\n');
  assert.match(git('log', '-1', '--format=%s'), /^Incorporar Dos \(phantom\/terminal-/);
  // A conflicting request is aborted cleanly and handed back to its worker.
  const conflict = await host.invoke('merge.run', { ...lead, id: first.id });
  assert.equal(conflict.status, 'conflict'); assert.deepEqual(conflict.conflicts, ['shared.txt']);
  assert.equal(git('status', '--porcelain'), ''); assert.throws(() => git('rev-parse', '-q', '--verify', 'MERGE_HEAD'));
  const returned = host.store.getWorkspace(workspaceId);
  assert.equal(returned.nodes.find(n => n.id === one.node.id).data.agent.status, 'blocked');
  assert.ok(returned.attention.some(item => item.source === 'incorporaciones' && item.ref === first.id));
  await assert.rejects(host.invoke('merge.run', { ...lead, id: first.id }), /estado «conflict»/);
  // The worker updates its own branch from the base, resolves, and submits again.
  assert.throws(() => gitAs(one.env, one.session.cwd, 'merge', 'main'));
  fs.writeFileSync(path.join(one.session.cwd, 'shared.txt'), 'dos\nuno\n'); gitAs(one.env, one.session.cwd, 'commit', '-am', 'Resuelve con main');
  const again = await host.invoke('merge.submit', { sessionId: one.session.id });
  assert.equal(again.id, first.id); assert.equal(again.status, 'queued');
  assert.equal((await host.invoke('merge.run', { ...lead, id: first.id })).status, 'merged');
  assert.equal(fs.readFileSync(path.join(repository, 'shared.txt'), 'utf8'), 'dos\nuno\n');
  status = await host.invoke('merge.status', { workspaceId });
  assert.deepEqual(status.queue, []); assert.deepEqual(status.history.map(item => [item.title, item.status]), [['Uno', 'merged'], ['Dos', 'merged']]);

  // Rejection returns the reason; withdrawing is the worker's own call.
  // A request must contain the current base: Dos is behind main until it merges it in.
  fs.writeFileSync(path.join(two.session.cwd, 'more.txt'), 'más\n'); gitAs(two.env, two.session.cwd, 'add', 'more.txt'); gitAs(two.env, two.session.cwd, 'commit', '-m', 'Dos sigue');
  await assert.rejects(host.invoke('merge.submit', { sessionId: two.session.id }), /no incluye lo último de main/);
  gitAs(two.env, two.session.cwd, 'merge', '--no-edit', 'main');
  const third = await host.invoke('merge.submit', { sessionId: two.session.id });
  assert.equal((await host.invoke('merge.reject', { ...lead, id: third.id, reason: 'Faltan pruebas' })).status, 'rejected');
  assert.match(host.store.getWorkspace(workspaceId).nodes.find(n => n.id === two.node.id).data.agent.step, /Faltan pruebas/);
  await host.invoke('merge.submit', { sessionId: two.session.id });
  assert.equal((await host.invoke('merge.withdraw', { sessionId: two.session.id })).status, 'withdrawn');

  // Turning it off removes exactly the hooks it installed.
  status = await host.invoke('merge.configure', { workspaceId, enabled: false });
  assert.equal(status.enabled, false); assert.equal(fs.existsSync(path.join(repository, '.git/hooks/reference-transaction')), false);
  await assert.rejects(host.invoke('merge.submit', { sessionId: two.session.id }), /no está activo/);
});

test('merge review inspects the submitted commit despite branch movement, rebinding or a removed terminal', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-merge-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => gitAs({}, root, ...args);
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@localhost');
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'Base');
  const baseOid = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'worker');
  fs.writeFileSync(path.join(root, 'sent.txt'), 'submitted content\n'); git('add', '.'); git('commit', '-m', 'Sent');
  const headOid = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'later.txt'), 'must not appear\n'); git('add', '.'); git('commit', '-m', 'Later');
  git('checkout', 'main');
  const request = { id: 'request', nodeId: 'worker-node', title: 'Worker', branch: 'worker', cardId: 'card-at-submit', headOid, status: 'queued' };
  const workspace = { id: 'fixture', path: root, nodes: [{ id: 'worker-node', type: 'terminal', title: 'Worker', data: { worktree: { branch: 'worker', path: root }, agent: { cardId: 'rebound-card' } } }], integration: { enabled: true, queue: [request] } };
  const merges = new Merges({ store: { state: { workspaces: [workspace] } }, terminals: { sessions: [] } });
  let result = await merges.status(workspace, request.id);
  assert.equal(result.queue[0].stale, true);
  assert.equal(result.queue[0].cardId, 'card-at-submit');
  assert.equal(result.queue[0].inspection.baseOid, baseOid);
  assert.equal(result.queue[0].inspection.headOid, headOid);
  assert.deepEqual(result.queue[0].files, ['sent.txt']);
  assert.match(result.queue[0].inspection.diff, /submitted content/);
  assert.doesNotMatch(result.queue[0].inspection.diff, /later.txt|must not appear/);
  assert.equal((await merges.status(workspace)).queue[0].inspection.diff, undefined, 'diff is read only on demand');
  workspace.nodes = [];
  result = await merges.status(workspace, request.id);
  assert.equal(result.queue[0].stale, null);
  assert.deepEqual(result.queue[0].files, ['sent.txt']);
  assert.equal(result.queue[0].cardId, 'card-at-submit');
  request.headOid = 'f'.repeat(40);
  result = await merges.status(workspace, request.id);
  assert.equal(result.queue[0].inspection.available, false);
  assert.equal(result.queue[0].fileCount, null, 'unreadable commit is not zero changed files');
  assert.equal(result.queue[0].checks, undefined, 'queued is not passed checks');
});

test('the guard never replaces hooks it does not own, and policies name each role', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-merges-')), repository = path.join(root, 'repository');
  fs.mkdirSync(repository); const git = (...args) => gitAs({}, repository, ...args);
  git('init', '-b', 'main'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--allow-empty', '-m', 'Base');
  const foreign = path.join(repository, '.git/hooks/pre-push'); fs.writeFileSync(foreign, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: repository });
  const status = await host.invoke('merge.configure', { workspaceId: workspace.id, enabled: true });
  assert.equal(status.enabled, true); assert.equal(status.guard.installed, false); assert.match(status.guard.reason, /pre-push/);
  assert.equal(fs.readFileSync(foreign, 'utf8'), '#!/bin/sh\nexit 0\n'); assert.equal(fs.existsSync(path.join(repository, '.git/hooks/reference-transaction')), false);
  assert.match(integrationPolicy({ role: 'worker', base: 'main', branch: 'phantom/terminal-x' }), /only writable branch is `phantom\/terminal-x`[\s\S]*submit/);
  assert.match(integrationPolicy({ role: 'orchestrator', base: 'main' }), /only session that integrates[\s\S]*merge ID/);
  const outside = await host.invoke('workspace.open', { path: root });
  assert.match((await host.invoke('merge.status', { workspaceId: outside.id })).reason, /no es un repositorio Git/);
});
