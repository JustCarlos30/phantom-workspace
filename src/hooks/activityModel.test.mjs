import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivity, classifyState, isRead, sessionState } from './activityModel.mjs';

const workspace = { id: 'w', nodes: [{ id: 'visible', type: 'terminal', title: 'Shell', data: { sessionId: 's1' } }, { id: 'hidden', type: 'terminal', title: 'Oculta', data: { sessionId: 's2', hidden: true } }], attention: [] };
const sessions = [{ id: 's1', workspaceId: 'w', nodeId: 'visible', status: 'running', cwd: '/repo' }, { id: 's2', workspaceId: 'w', nodeId: 'hidden', status: 'running', cwd: '/worktrees/feature' }];

test('un shell abierto no acredita actividad ni intervención del agente', () => {
  const model = buildActivity({ workspace, sessions });
  assert.equal(model.needs.length, 0);
  assert.equal(model.sessions[0].state.label, 'Conectada · sin señal del agente');
  assert.equal(sessionState({ status: 'exited', exitCode: 0 }).label, 'Proceso salido · código 0');
  assert.equal(sessionState({ status: 'exited' }).needsIntervention, false);
  assert.equal(classifyState('completed').needsIntervention, false);
  assert.match(classifyState('completed').label, /aceptación no acreditada/);
});

test('solo estados explícitos señalan intervención; desconocidos no se convierten en éxito', () => {
  for (const state of ['blocked', 'needs_input', 'awaiting_approval', 'pending_approval', 'failed']) assert.equal(classifyState(state).needsIntervention, true);
  for (const state of [undefined, 'new-native-state', 'todo', 'running', 'completed']) assert.equal(classifyState(state).needsIntervention, false);
  assert.equal(classifyState().label, 'Estado desconocido');
  assert.equal(sessionState({ status: 'running', agentState: 'blocked' }).needsIntervention, true);
  assert.equal(sessionState({ status: 'running', agentState: 'blocked' }, false).status, 'disconnected');
});

test('sesiones ocultas, históricas sin vista y nodos sin descriptor se conservan', () => {
  const model = buildActivity({ workspace: { ...workspace, nodes: [...workspace.nodes, { id: 'empty', type: 'terminal', title: 'Sin sesión', data: {} }] }, sessions: [...sessions, { id: 'old', nodeId: 'visible', workspaceId: 'w', status: 'exited' }, { id: 'foreign', workspaceId: 'other', status: 'running' }] });
  assert.equal(model.sessions.length, 4);
  assert.equal(model.sessions.find(s => s.id === 's2').hidden, true);
  assert.equal(model.sessions.find(s => s.id === 's2').nodeId, 'hidden');
  assert.equal(model.sessions.find(s => s.id === 'old').nodeId, undefined);
  assert.equal(model.sessions.find(s => s.nodeId === 'empty').state.status, 'unknown');
});

test('leer un aviso no aprueba ni resuelve una tarea bloqueada', () => {
  const task = { id: 't', title: 'Necesita aprobación', status: 'awaiting_approval' };
  const notice = { id: 'a', title: 'Fallo', status: 'failed', acknowledgedAt: '2026-11-11T00:00:00Z' };
  const model = buildActivity({ workspace: { ...workspace, attention: [notice] }, tasks: [task] });
  assert.equal(isRead(notice), true);
  assert.equal(model.unread, 0);
  assert.equal(model.needs.length, 1);
  assert.equal(model.needs[0].status, 'awaiting_approval');
  assert.equal(task.status, 'awaiting_approval');
});

test('salir con código cero es aviso, código no cero sin leer exige revisión', () => {
  const model = buildActivity({ workspace: { ...workspace, attention: [{ id: 'ok', sessionId: 's1', exitCode: 0 }, { id: 'bad', sessionId: 's2', exitCode: 2 }] }, sessions });
  assert.equal(model.needs.length, 1);
  assert.equal(model.needs[0].nodeId, 'hidden');
  assert.equal(model.needs[0].target, 'terminal');
});

test('integración necesita base válida y comparación; no integrada nunca significa lista', () => {
  const branches = [{ name: 'main', merged: true, ahead: 0, behind: 0 }, { name: 'feature', merged: false, ahead: 2, behind: 1 }];
  for (const git of [{ branches }, { available: true, branches }, { available: false, base: 'main', comparison: {}, branches }, { available: true, base: 'invalid', branches }]) {
    const model = buildActivity({ git });
    assert.equal(model.unknownBranches, 2);
    assert.equal(model.pendingBranches, 0);
  }
  const model = buildActivity({ git: { available: true, base: 'main', comparison: { baseOid: 'abc' }, branches } });
  assert.deepEqual(model.branches.map(b => b.integration), ['Integrada', 'No integrada']);
  assert.equal(model.pendingBranches, 1);
});

test('los vínculos requieren identidad de rama o worktree exacto, nunca título ni proximidad', () => {
  const git = { available: true, branches: [{ name: 'feature' }, { name: 'main' }], worktrees: [{ path: '/worktrees/feature/', branch: 'feature' }] };
  const model = buildActivity({ workspace, sessions, git, tasks: [{ id: 'real', raw: { branch: 'feature' } }, { id: 'also-real', raw: { worktreePath: '/worktrees/feature' } }, { id: 'fake', title: 'feature' }] });
  assert.deepEqual(model.branches[0].sessions.map(s => s.id), ['s2']);
  assert.deepEqual(model.branches[0].tasks.map(t => t.id), ['real', 'also-real']);
  assert.equal(model.branches[1].sessions.length, 0);
  assert.equal(model.branches[1].tasks.length, 0);
});
