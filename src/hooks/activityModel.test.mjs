import test from 'node:test';
import assert from 'node:assert/strict';
import { activityEvent, buildActivity, classifyState, isRead, sessionState } from './activityModel.mjs';

test('un shell abierto no acredita trabajo y un proceso salido no acredita éxito', () => {
  assert.equal(sessionState({ status: 'running' }).label, 'Conectada · sin señal de agente');
  assert.equal(sessionState({ status: 'exited', exitCode: 0 }).label, 'Proceso salido · código 0');
  assert.equal(sessionState({ status: 'exited', agentState: 'completed' }).intervention, false);
  assert.equal(sessionState({ status: 'running', agentState: 'needs_input' }).intervention, true);
  assert.equal(sessionState({ status: 'running', agentState: 'working' }).label, 'En curso declarado');
  assert.equal(sessionState({ status: 'running', agentState: 'working' }, false).label, 'Sin conexión');
  assert.equal(sessionState(null).label, 'Sin señal');
  assert.equal(classifyState('new_future_state').label, 'Estado desconocido');
});

test('leído no aprueba ni resuelve intervención declarada', () => {
  const model = buildActivity({ workspace: { attention: [{ id: 'approval', title: 'Revisar', status: 'awaiting_approval', acknowledgedAt: '2026-01-01' }] }, tasks: [{ id: 't', status: 'blocked' }] });
  assert.equal(isRead(model.notices[0]), true);
  assert.equal(model.unread, 0);
  assert.equal(model.needs.length, 2);
  assert.equal(model.needs.find(n => n.id === 'approval').state.label, 'Requiere revisión');
  assert.equal('approved' in model.notices[0], false);
  assert.equal('resolved' in model.notices[0], false);
});

test('sesiones ocultas se conservan y el historial antiguo no apunta a una sesión nueva', () => {
  const workspace = { nodes: [{ id: 'n', type: 'terminal', title: 'Oculta', data: { hidden: true, sessionId: 'current' } }, { id: 'missing', type: 'terminal', data: {} }] };
  const model = buildActivity({ workspace, sessions: [{ id: 'old', nodeId: 'n', status: 'exited' }, { id: 'current', nodeId: 'n', status: 'running' }] });
  assert.equal(model.sessions.length, 3);
  assert.equal(model.sessions.find(s => s.id === 'old').nodeId, undefined);
  assert.equal(model.sessions.find(s => s.id === 'current').hidden, true);
  assert.equal(model.sessions.find(s => s.id === 'current').nodeId, 'n');
  assert.equal(model.sessions.find(s => s.id === 'missing').state.label, 'Sin señal');
});

test('integración requiere base validada; pendiente no significa lista', () => {
  const git = { available: true, branches: [{ name: 'main', merged: true, ahead: 0 }, { name: 'feature', merged: false, ahead: 3 }] };
  const unknown = buildActivity({ git });
  assert.equal(unknown.pendingBranches, 0);
  assert.equal(unknown.unknownBranches, 2);
  const compared = buildActivity({ git: { ...git, base: 'main', comparison: { baseOid: 'abc' } } });
  assert.equal(compared.pendingBranches, 1);
  assert.deepEqual(compared.branches.map(b => b.integration), ['Integrada', 'No integrada']);
  assert.equal('ready' in compared.branches[1], false);
  assert.equal(buildActivity({ git: { ...git, base: 'nonexistent' } }).unknownBranches, 2);
});

test('vínculos exactos por worktree o identidad; nunca por similitud del título', () => {
  const model = buildActivity({ workspace: { nodes: [{ id: 'n', type: 'terminal', data: { sessionId: 's' } }], attention: [{ id: 'a', sessionId: 's' }, { id: 'b', taskId: 't' }] }, sessions: [{ id: 's', worktree: { branch: 'feature', path: '/repo/tree' } }, { id: 'unlinked', title: 'feature', cwd: '/repo/elsewhere' }], tasks: [{ id: 't', title: 'Cualquier título', raw: { contract: { workspace: '/repo/tree' } } }, { id: 'lookalike', title: 'feature', raw: {} }], git: { available: true, worktrees: [{ branch: 'feature', path: '/repo/tree' }], branches: [{ name: 'feature' }] } });
  assert.deepEqual(model.branches[0].sessions.map(s => s.id), ['s']);
  assert.deepEqual(model.branches[0].tasks.map(t => t.id), ['t']);
  assert.deepEqual(model.notices[0].target, { kind: 'terminal', id: 'n' });
  assert.deepEqual(model.notices[1].target, { kind: 'tasks', id: 't' });
});

test('referencias Phantom locales no fabrican estados y las tareas locales declaran fuente', () => {
  const model = buildActivity({ workspace: { tasks: [{ id: 'ref', kind: 'phantom', status: 'blocked' }, { id: 'local', kind: 'draft', status: 'blocked' }] } });
  assert.equal(model.needs.length, 1);
  assert.match(model.needs[0].source, /local/);
  assert.equal(model.needs[0].id, 'local');
});

test('solo eventos pertinentes del workspace, nunca bytes PTY', () => {
  assert.equal(activityEvent({ type: 'terminal.output', workspaceId: 'w' }, 'w'), false);
  assert.equal(activityEvent({ type: 'state.changed', workspaceId: 'other' }, 'w'), false);
  for (const type of ['state.changed', 'terminal.exit', 'attention.new', 'tool.status', 'git.changed', 'agent.status']) assert.equal(activityEvent({ type, workspaceId: 'w' }, 'w'), true);
});
