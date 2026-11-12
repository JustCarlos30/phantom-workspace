import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivity, branchState, classifyNotice, classifyTask, sessionState, taskLinks } from './activityModel.mjs';

test('Un shell abierto no acredita actividad del agente y salir no acredita éxito', () => {
  assert.equal(sessionState({ status: 'running' }).label, 'Conectada · agente sin señal');
  assert.equal(sessionState({ status: 'exited', exitCode: 0 }).label, 'Proceso salido · código 0');
  assert.equal(sessionState({ status: 'lost' }).needsYou, true);
  assert.match(sessionState({ status: 'running', agentState: 'running' }).label, /Agente: En curso/);
  assert.match(sessionState({ status: 'running' }, false).label, /sin confirmar/);
  assert.equal(sessionState(null).label, 'Estado desconocido');
});

test('Estados explícitos de tareas y desconocidos no se convierten en progreso', () => {
  for (const status of ['blocked', 'awaiting_approval', 'awaiting_input', 'failed']) assert.equal(classifyTask({ status }).needsYou, true);
  for (const status of ['running', 'queued', 'done', 'alien', undefined]) assert.equal(classifyTask({ status }).needsYou, false);
  assert.equal(classifyTask({}).label, 'Estado desconocido');
  assert.equal(classifyTask({ status: 'alien' }).label, 'Estado fuente: alien');
});

test('Leer un aviso no lo aprueba ni resuelve una intervención', () => {
  const notice = { status: 'awaiting_approval', acknowledgedAt: '2026-11-11' };
  assert.deepEqual(classifyNotice(notice), { read: true, approved: false, needsYou: true });
  assert.deepEqual(classifyNotice({ approved: true }), { read: false, approved: true, needsYou: false });
  const before = buildActivity({ workspace: { attention: [{ id: 'n', status: 'blocked' }] } });
  const after = buildActivity({ workspace: { attention: [{ id: 'n', status: 'blocked', acknowledgedAt: 'now' }] } });
  assert.equal(before.needs.length, after.needs.length);
  assert.equal(after.unread, 0);
});

const nodes = [{ id: 'n', type: 'terminal', title: 'Oculta', data: { sessionId: 's', hidden: true, worktree: { branch: 'feature' } } }];
const sessions = [{ id: 's', nodeId: 'n', status: 'running' }];

test('Vínculos por identidad real; títulos, PID, rama y carpeta no unen tareas a sesiones', () => {
  assert.equal(taskLinks({ raw: { sessionId: 's' } }, sessions, nodes).length, 1);
  assert.equal(taskLinks({ raw: { refs: [{ kind: 'terminal', id: 'n' }] } }, sessions, nodes).length, 1);
  assert.equal(taskLinks({ raw: { nodeId: 'n' } }, sessions, nodes).length, 1);
  assert.equal(taskLinks({ title: 'Oculta', raw: { branch: 'feature', pid: 2, contract: { workspace: '/same' } } }, sessions, nodes).length, 0);
  assert.equal(taskLinks({ raw: { refs: [{ kind: 'card', id: 's' }] } }, sessions, nodes).length, 0);
});

test('Sesiones ocultas son operativas y estados de tareas solo se propagan con vínculo real', () => {
  const model = buildActivity({ workspace: { nodes }, sessions, tasks: [{ id: 't', status: 'blocked', raw: { sessionId: 's' } }] });
  assert.equal(model.sessions[0].hidden, true);
  assert.equal(model.sessions[0].nodeId, 'n');
  assert.equal(model.sessions[0].label, 'Tarea: Bloqueada');
  assert.equal(model.needs.length, 1, 'Una tarea bloqueada no se duplica como intervención de sesión');
  const unrelated = buildActivity({ workspace: { nodes }, sessions, tasks: [{ id: 't', status: 'blocked' }] });
  assert.equal(unrelated.sessions[0].label, 'Conectada · agente sin señal');
});

test('Historial relanzado no navega a una sesión diferente; panel sin descriptor permanece desconocido', () => {
  const model = buildActivity({ workspace: { nodes }, sessions: [{ id: 'old', nodeId: 'n', status: 'exited' }] });
  assert.equal(model.sessions.find(s => s.id === 'old').nodeId, null);
  assert.equal(model.sessions.find(s => s.nodeId === 'n').label, 'Estado desconocido');
  assert.equal(model.sessionCount, 1);
  assert.equal(model.unknownViews, 1);
  assert.equal(taskLinks({ raw: { nodeId: 'n' } }, [{ id: 'old', nodeId: 'n' }], nodes).length, 0);
  assert.equal(taskLinks({ raw: { refs: [{ kind: 'terminal', id: 'n' }] } }, [{ id: 'old', nodeId: 'n' }], nodes).length, 0);
});

test('Integración exige base explícita y comparación válida; no integrada nunca significa lista', () => {
  const git = { available: true, base: 'main', comparison: { baseOid: 'abc' }, branches: [{ name: 'feature', merged: false, ahead: 2, behind: 1 }, { name: 'other', merged: true }] };
  assert.equal(branchState(git.branches[0], { ...git, comparison: null }), 'Integración desconocida');
  assert.equal(branchState(git.branches[0], { ...git, base: null }), 'Integración desconocida');
  assert.equal(branchState(git.branches[0], { ...git, available: false }), 'Integración desconocida');
  const model = buildActivity({ workspace: { nodes }, sessions, git });
  assert.equal(model.pendingBranches, 1);
  assert.equal(model.branches[0].label, 'No integrada');
  assert.equal(model.branches[0].sessions[0].id, 's');
  assert.equal(model.branches[1].sessions.length, 0);
  assert.equal(buildActivity({ workspace: { nodes }, git: { branches: git.branches } }).unknownBranches, 2);
});

test('screen state turns a quiet agent terminal into a needs-you signal', () => {
  assert.deepEqual(sessionState({ status: 'running', screenState: 'awaiting_approval', agentState: 'working' }), { needsYou: true, label: 'Pide tu aprobación', tone: 'warning', screen: 'awaiting_approval' });
  assert.equal(sessionState({ status: 'running', screenState: 'awaiting_input' }).needsYou, true);
  assert.deepEqual(sessionState({ status: 'running', screenState: 'working' }), { needsYou: false, label: 'Trabajando', tone: 'working', screen: 'working' });
  assert.equal(sessionState({ status: 'running', screenState: 'awaiting_input' }, false).needsYou, false);
});
