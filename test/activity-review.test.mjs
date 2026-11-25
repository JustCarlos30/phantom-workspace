import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivity, cardIdOf, integrationGroups, integrationState, taskLinks } from '../src/hooks/activityModel.mjs';
import { checkResultsOf } from '../src/hooks/card-view.mjs';

test('activity connects exact Card bindings only to the current terminal session', () => {
  const nodes = [{ id: 'node', type: 'terminal', data: { sessionId: 'current', agent: { cardId: 'card-exact' } } }];
  const sessions = [{ id: 'old', nodeId: 'node', status: 'exited' }, { id: 'current', nodeId: 'node', status: 'running' }];
  const task = { id: 'card-exact', status: 'blocked' };
  assert.deepEqual(taskLinks(task, sessions, nodes).map(s => s.id), ['current']);
  const model = buildActivity({ workspace: { nodes }, sessions, tasks: [task] });
  assert.equal(model.needs.length, 0);
  const [item] = model.stuck[0].items;
  assert.equal(item.cardId, 'card-exact');
  assert.equal(item.sessions[0].nodeId, 'node');
  assert.equal(item.nodeId, 'node');
  assert.equal(model.sessions.find(s => s.id === 'old').cardId, '');
  assert.equal(cardIdOf({ ref: { kind: 'card', id: 'notice-card' } }), 'notice-card');
  assert.equal(cardIdOf({ ref: { kind: 'branch', id: 'card-looking-name' } }), '');
});

test('ready-to-integrate means a real queued request, never an unmerged branch or active work', () => {
  const queue = ['queued', 'merging', 'conflict', 'failed', 'merged', 'rejected', 'withdrawn', 'unknown'].map(status => ({ id: status, status }));
  const merges = { available: true, queue, active: [{ nodeId: 'worker', status: 'review' }] };
  const groups = integrationGroups(merges);
  assert.deepEqual(groups.ready.map(i => i.id), ['queued']);
  assert.deepEqual(groups.decisions.map(i => i.id), ['conflict', 'failed']);
  assert.deepEqual(groups.active.map(i => i.id || i.nodeId), ['merging', 'worker']);
  assert.deepEqual(integrationGroups({ ...merges, available: false }), { ready: [], decisions: [], active: [] });
  const model = buildActivity({ git: { branches: [{ name: 'feature', merged: false }] } });
  assert.deepEqual(model.integrations.ready, []);
  assert.equal(integrationState({ status: 'alien' }), 'Estado desconocido');
  assert.doesNotMatch(integrationState({ status: 'queued' }), /aprobada|segura/i);
});

test('unknown evidence and missing Card are explicit; stale rounds cannot approve a Card', () => {
  assert.equal(cardIdOf({ title: 'Looks like a Card', nodeId: 'some-node' }), '');
  const contract = { checks: [{ name: 'regression', argv: ['npm', 'test'] }] };
  assert.equal(checkResultsOf(contract, null)[0].state, 'pending');
  assert.equal(checkResultsOf(contract, { evidence: [{ checks: [{ name: 'regression', passed: true }] }, { checks: [] }] })[0].state, 'pending');
  assert.equal(checkResultsOf(contract, { evidence: [{ checks: [{ name: 'regression', passed: false, exitCode: 1 }] }] })[0].state, 'failed');
  const model = buildActivity({ merges: { available: true, queue: [{ id: 'failed', status: 'failed', headOid: 'sent' }], active: [] } });
  assert.equal(model.needs[0].target, 'integration');
  assert.equal(model.needs[0].headOid, 'sent');
});

test('current work includes real Card and agent activity without treating an open shell as work', () => {
  const sessions = [{ id: 'shell', status: 'running' }, { id: 'agent', status: 'running', agentState: 'running' }, { id: 'old', status: 'exited', agentState: 'working' }];
  const tasks = [{ id: 'verify', status: 'verifying' }, { id: 'done', status: 'completed' }];
  const model = buildActivity({ sessions, tasks });
  assert.deepEqual(model.inProgress.map(t => t.id), ['verify']);
  assert.deepEqual(model.activeSessions.map(s => s.id), ['agent']);
  assert.deepEqual(buildActivity({ sessions, tasks, connected: false }).activeSessions, []);
});
