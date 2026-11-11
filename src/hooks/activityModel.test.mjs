import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivity, classifyState, sessionState, isRead, relevantActivityEvent, createActivityFence } from './activityModel.mjs';

const node = { id: 'n1', type: 'terminal', title: 'Agente', data: { sessionId: 's1', hidden: true } };
const session = { id: 's1', nodeId: 'n1', status: 'running', cwd: '/trees/feature' };
const task = { id: 't1', title: 'Contrato', status: 'blocked', raw: { contract: { workspace: '/trees/feature' } } };
const git = { available: true, base: 'trunk', comparison: { baseOid: 'abc' }, branches: [{ name: 'trunk', ahead: 0, behind: 0, merged: true }, { name: 'feature', ahead: 3, behind: 2, merged: false }], worktrees: [{ path: '/trees/feature', branch: 'feature' }] };
const model = extra => buildActivity({ workspace: { nodes: [node], attention: [] }, sessions: [session], tasks: { items: [task] }, git, ...extra });

test('un shell conectado no acredita trabajo de agente; salir no acredita éxito', () => {
  assert.equal(sessionState(session).kind, 'unknown');
  assert.match(sessionState(session).label, /sin señal/);
  assert.equal(sessionState({ ...session, status: 'exited', exitCode: 0 }).kind, 'exited');
  assert.equal(sessionState({ ...session, status: 'exited', agentStatus: 'working' }).kind, 'exited');
  assert.equal(sessionState({ ...session, agentStatus: 'working' }).kind, 'active');
  assert.equal(sessionState(session, false).kind, 'unknown');
});
test('intervención solo con estado explícito, desconocidos se conservan', () => {
  assert.equal(classifyState('awaiting_approval').intervention, true);
  assert.equal(classifyState('blocked').intervention, true);
  assert.equal(classifyState('made_up_state').kind, 'unknown');
  assert.equal(classifyState('made_up_state').intervention, false);
  assert.equal(classifyState('constructor').kind, 'unknown');
  assert.equal(classifyState({ phase: 'running' }).kind, 'unknown');
  assert.equal(model().counts.needs, 1);
  assert.equal(model({ tasks: { items: [{ ...task, status: undefined }] } }).counts.needs, 0);
});
test('sesiones ocultas cuentan y conservan vínculo exacto para recuperar vista', () => {
  const result = model();
  assert.equal(result.counts.sessions, 1);
  assert.equal(result.sessions[0].hidden, true);
  assert.equal(result.sessions[0].node.id, node.id);
  assert.equal(result.terminals.n1.kind, 'unknown');
  const older = model({ sessions: [{ ...session, id: 'old', status: 'exited' }, session] });
  assert.equal(older.sessions[0].node, undefined);
});
test('lectura no cambia aprobación, necesidad ni integración', () => {
  const notice = { id: 'a1', title: 'Solicita revisión', source: 'phantom', taskId: 't1' };
  const before = model({ workspace: { nodes: [node], attention: [notice] } });
  const after = model({ workspace: { nodes: [node], attention: [{ ...notice, acknowledgedAt: '2026-01-01' }] } });
  assert.equal(isRead(notice), false);
  assert.equal(after.counts.unread, 0);
  assert.deepEqual(before.needs, after.needs);
  assert.equal(after.counts.pending, before.counts.pending);
  assert.equal(after.tasks[0].status, 'blocked');
  assert.equal(after.tasks[0].approved, undefined);
  assert.equal(isRead({ ackedAt: 'now' }), true);
});
test('base explícita validada necesaria para integrada/no integrada; pendiente no significa lista', () => {
  assert.equal(model().counts.pending, 1);
  assert.equal(model().branches[1].label, 'No integrada');
  assert.equal(model().branches[1].ahead, 3);
  assert.equal(model().branches[1].behind, 2);
  for (const unknownGit of [{ ...git, base: undefined }, { ...git, comparison: undefined }, { ...git, available: false }]) {
    const result = model({ git: unknownGit });
    assert.equal(result.counts.pending, null);
    assert.equal(result.branches[1].state, 'unknown');
  }
});
test('asociaciones solo por worktree real, nunca por título, prefijo o carpeta compartida', () => {
  const result = model();
  assert.equal(result.branches[1].sessions[0].id, 's1');
  assert.equal(result.branches[1].tasks[0].id, 't1');
  assert.equal(result.branches[0].sessions.length, 0);
  const unlinked = model({ sessions: [{ ...session, cwd: '/trees/feature-similar', worktree: null }], tasks: { items: [{ ...task, title: 'feature', raw: { contract: { workspace: '/repo' } } }] } });
  assert.equal(unlinked.branches[1].sessions.length, 0);
  assert.equal(unlinked.branches[1].tasks.length, 0);
});
test('avisos navegan con identidad acreditada, ni texto libre ni sesión antigua', () => {
  const result = model({ workspace: { nodes: [node], attention: [
    { id: 'a1', sessionId: 's1' }, { id: 'a2', ref: 's1' }, { id: 'a3', taskId: 't1' }, { id: 'a4', source: 'git' }, { id: 'a5', sessionId: 'old' },
  ] }, sessions: [session, { ...session, id: 'old' }] });
  assert.deepEqual(result.notices.map(n => n.target), [{ type: 'terminal', id: 'n1' }, null, { type: 'tasks', id: 't1' }, { type: 'git' }, null]);
  const controllerNotice = model({ workspace: { nodes: [], phantomControllers: [{ id: 'run1', taskId: 'native-task' }], attention: [{ id: 'a6', runId: 'run1', status: 'completed' }] }, tasks: [] });
  assert.deepEqual(controllerNotice.notices[0].target, { type: 'tasks', id: 'native-task' });
  assert.equal(controllerNotice.counts.needs, 0, 'completed controller is not task acceptance or intervention');
});
test('eventos pertinentes y coalescibles excluyen todos los bytes PTY y otros proyectos', () => {
  assert.equal(relevantActivityEvent({ type: 'terminal.output', workspaceId: 'w1' }, 'w1'), false);
  assert.equal(relevantActivityEvent({ type: 'state.changed', workspaceId: 'w2' }, 'w1'), false);
  assert.equal(relevantActivityEvent({ type: 'tool.status', workspaceId: 'w1' }, 'w1'), true);
});
test('resultados anteriores no publican después de cambiar proyecto o desconectar', async () => {
  const fence = createActivityFence();
  const token = fence.token();
  let resolve, published = false;
  const pending = new Promise(done => { resolve = done; }).then(() => { if (fence.current(token)) published = true; });
  fence.invalidate(); resolve(); await pending;
  assert.equal(published, false);
  assert.equal(fence.current(fence.token()), true);
});
