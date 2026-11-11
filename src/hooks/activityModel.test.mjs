import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivity, branchLinks, classifyNotice, classifySession, classifyTask, isRead, linkedTask } from './activityModel.mjs';

test('shell liveness and process exit never imply agent work or success', () => {
  assert.equal(classifySession({ status: 'running' }).label, 'Conectada · sin señal del agente');
  assert.equal(classifySession({ status: 'exited', exitCode: 0 }).tone, 'neutral');
  assert.equal(classifySession({ status: 'exited', exitCode: 0 }).intervention, false);
  assert.equal(classifySession({ status: 'exited', exitCode: 2 }).intervention, true);
  assert.equal(classifySession({ status: 'exited' }).intervention, false);
  assert.equal(classifySession({ status: 'lost' }).intervention, true);
  assert.equal(classifySession({ status: 'running' }, null, false).label, 'Host desconectado');
  assert.equal(classifySession({ status: 'running' }, { status: 'blocked' }).intervention, true);
});

test('explicit task states retain their semantics; future statuses remain unknown', () => {
  assert.equal(classifyTask({ status: 'blocked' }).intervention, true);
  assert.equal(classifyTask({ status: 'awaiting_approval' }).label, 'Requiere revisión');
  assert.equal(classifyTask({ status: 'running' }).label, 'En ejecución · agente');
  assert.equal(classifyTask({ status: 'completed' }).tone, 'neutral');
  assert.equal(classifyTask({ status: 'accepted' }).label, 'Aceptada en la fuente');
  assert.equal(classifyTask({ status: 'future_status' }).label, 'Estado desconocido');
  assert.equal(classifyTask({}).intervention, false);
});

test('marking read never approves or removes an explicit intervention', () => {
  const notice = { id: 'n', status: 'awaiting_approval', acknowledgedAt: '2026-11-11T00:00:00Z' };
  assert.equal(isRead(notice), true);
  assert.deepEqual(classifyNotice(notice), { status: 'awaiting_approval', label: 'Requiere revisión', tone: 'warning', intervention: true, read: true, approved: false });
  assert.equal(classifyNotice({ status: 'completed' }).approved, false);
  const activity = buildActivity({ notices: [notice] });
  assert.equal(activity.needs.length, 1);
  assert.equal(activity.notices[0].read, true);
});

test('hidden terminal sessions stay in the model and retain navigation identity', () => {
  const workspace = { nodes: [{ id: 'node', type: 'terminal', title: 'Oculta', data: { sessionId: 'session', hidden: true } }] };
  const model = buildActivity({ workspace, sessions: [{ id: 'session', status: 'lost', nodeId: 'node' }] });
  assert.equal(model.sessions.length, 1);
  assert.equal(model.sessions[0].hidden, true);
  assert.equal(model.needs[0].action.nodeId, 'node');
  assert.equal(model.byNode.node.label, 'Sesión perdida');
});

test('history for a previous session cannot take over a relaunched node', () => {
  const workspace = { nodes: [{ id: 'node', type: 'terminal', data: { sessionId: 'new' } }] };
  const model = buildActivity({ workspace, sessions: [{ id: 'old', nodeId: 'node', status: 'exited', exitCode: 9 }, { id: 'new', nodeId: 'node', status: 'running' }] });
  assert.equal(model.sessions[0].node, undefined);
  assert.equal(model.byNode.node.id, 'new');
  assert.deepEqual(model.needs[0].action, { tab: 'sessions' });
});

test('task/session associations require identity, never names, PID, or project coincidence', () => {
  const session = { id: 's', pid: 3, cwd: '/project' }, node = { id: 'n' };
  assert.equal(linkedTask({ title: 's', raw: { pid: 3, contract: { workspace: '/project' } } }, session, node), false);
  assert.equal(linkedTask({ raw: { sessionId: 's' } }, session, node), true);
  assert.equal(linkedTask({ raw: { refs: [{ kind: 'node', id: 'n' }] } }, session, node), true);
  const task = { id: 't', status: 'blocked', raw: { sessionId: 's' } };
  const activity = buildActivity({ tasks: [task], sessions: [{ ...session, status: 'running' }], notices: [{ id: 'notice', status: 'failed', taskId: 't' }] });
  assert.equal(activity.needs.length, 1, 'the same linked task is not counted again as a session/notice');
});

test('branch links use exact declared worktree identity, not branch-name guesses', () => {
  const git = { worktrees: [{ branch: 'feature', path: '/worktrees/feature' }] };
  const sessions = [{ id: 's1', cwd: '/worktrees/feature' }, { id: 's2', worktree: { branch: 'feature' } }, { id: 'feature', cwd: '/elsewhere' }];
  const tasks = [{ id: 't1', raw: { contract: { workspace: '/worktrees/feature' } } }, { id: 'feature', title: 'feature', raw: { contract: { workspace: '/project' } } }];
  const links = branchLinks({ name: 'feature' }, git, sessions, tasks);
  assert.deepEqual(links.sessions.map(s => s.id), ['s1', 's2']);
  assert.deepEqual(links.tasks.map(t => t.id), ['t1']);
});

test('integration requires an explicit, verified base and never means ready', () => {
  const branches = [{ name: 'main', merged: true, ahead: 0, behind: 0 }, { name: 'feature', merged: false, ahead: 2, behind: 1 }, { name: 'other' }];
  let model = buildActivity({ git: { available: true, branches } });
  assert.equal(model.unknownBranches, 3);
  model = buildActivity({ git: { available: true, base: 'main', comparison: { baseOid: 'abc' }, branches } });
  assert.deepEqual(model.branches.map(b => b.integration), ['integrated', 'pending', 'unknown']);
  assert.equal(model.pendingBranches, 1);
  assert.equal(model.needs.length, 0, 'unmerged branches are not an approval request');
  assert.equal(buildActivity({ git: { available: false, base: 'invalid', branches } }).unknownBranches, 3);
});

test('missing descriptors and unattached history remain explicitly unknown', () => {
  const model = buildActivity({ workspace: { nodes: [{ id: 'empty', type: 'terminal', data: {} }] } });
  assert.equal(model.byNode.empty.label, 'Estado desconocido');
  assert.equal(model.sessions[0].session, undefined);
  assert.equal(model.needs.length, 0);
  assert.equal(classifyNotice({ title: 'Proceso finalizado', status: 'completed' }).intervention, false);
});
