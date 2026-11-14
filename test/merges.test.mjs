import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHost } from '../host/server.mjs';
import { GUARD_MARKER, mergeToken, integrationPolicy } from '../host/merge-guard.mjs';
import { main as agent } from '../scripts/agent.mjs';
import { Merges } from '../host/merges.mjs';

const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 30)); } throw new Error('Timed out'); };
// Git as a process of a given terminal would run it: only the environment tells the guard who is asking.
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PHANTOM_')));
const gitAs = (env, cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...clean(), ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

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
  commit(two, 'dos\nuno\nmás\n', 'Dos sigue'); const third = await host.invoke('merge.submit', { sessionId: two.session.id });
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
