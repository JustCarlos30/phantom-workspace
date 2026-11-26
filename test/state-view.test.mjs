import test from 'node:test';
import assert from 'node:assert/strict';
import { stateView } from '../host/state-view.mjs';

const state = () => ({ activeWorkspaceId: 'a', settings: {}, terminalHistory: { x: 'y' }, workspaces: [{ id: 'a' }, { id: 'b' }] });

test('sin workspaceId devuelve el estado completo sin historial', () => {
  const view = stateView(state());
  assert.equal(view.partial, undefined);
  assert.equal(view.workspaces.length, 2);
  assert.equal('terminalHistory' in view, false);
});

test('workspaceId existente devuelve vista parcial', () => {
  const view = stateView(state(), { workspaceId: 'b' });
  assert.equal(view.partial, true);
  assert.equal(view.workspaceId, 'b');
  assert.deepEqual(view.workspaces, [{ id: 'b' }]);
  assert.equal(view.activeWorkspaceId, 'a');
});

test('workspaceId desconocido devuelve el estado completo', () => {
  const view = stateView(state(), { workspaceId: 'zzz' });
  assert.equal(view.partial, undefined);
  assert.equal(view.workspaces.length, 2);
});

test('no muta el estado original', () => {
  const original = state();
  stateView(original, { workspaceId: 'a' });
  assert.equal(original.workspaces.length, 2);
  assert.ok(original.terminalHistory);
});
