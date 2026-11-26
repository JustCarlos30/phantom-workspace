import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePartialState } from './stateMerge.js';

const previous = { activeWorkspaceId: 'a', settings: { v: 1 }, workspaces: [{ id: 'a', n: 1 }, { id: 'b', n: 1 }] };

test('sustituye el workspace conservando el orden', () => {
  const next = mergePartialState(previous, { partial: true, workspaceId: 'b', activeWorkspaceId: 'b', settings: { v: 2 }, workspaces: [{ id: 'b', n: 2 }] });
  assert.deepEqual(next.workspaces, [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
  assert.equal(next.activeWorkspaceId, 'b');
  assert.deepEqual(next.settings, { v: 2 });
  assert.equal('partial' in next, false);
});

test('workspace ausente devuelve null', () => {
  assert.equal(mergePartialState(previous, { partial: true, workspaces: [{ id: 'z' }] }), null);
});

test('sin previous devuelve null', () => {
  assert.equal(mergePartialState(null, { partial: true, workspaces: [{ id: 'a' }] }), null);
});

test('un estado no parcial devuelve null', () => {
  assert.equal(mergePartialState(previous, { workspaces: [{ id: 'a' }] }), null);
});
