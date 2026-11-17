import test from 'node:test';
import assert from 'node:assert/strict';
import { childrenOf } from '../src/hooks/card-view.mjs';

const card = { id: 'card', contract: { coordination: { children: [
  { key: 'activity', goal: 'Hacer', scope: ['src'], dependencies: [] },
  { key: 'docs', goal: 'Documentar', dependencies: ['activity'] },
] } } };
const task = (id, fields = {}) => ({ id, kind: 'task', parentTaskId: 'card', childKey: 'activity', status: 'cancelled', ...fields });

test('selects the latest updated attempt even when it appears first', () => {
  const result = childrenOf(card, [
    task('new', { status: 'completed', updatedAt: '2026-11-16T12:00:00Z' }),
    task('old', { updatedAt: '2026-11-15T12:00:00Z', createdAt: '2026-11-16T13:00:00Z' }),
    task('unrelated', { parentTaskId: 'other', updatedAt: '2026-11-17T12:00:00Z' }),
  ]);
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.nodes[0], { key: 'activity', goal: 'Hacer', scope: ['src'], dependencies: [], status: 'completed', taskId: 'new' });
  assert.deepEqual(result.edges, [{ from: 'activity', to: 'docs' }]);
});

test('selects the last attempt when dates are absent', () => {
  const result = childrenOf(card, [task('first'), task('last', { status: 'completed' })]);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[0].taskId, 'last');
  assert.equal(result.nodes[0].status, 'completed');
});

test('groups extra attempts by key and falls back to id', () => {
  const result = childrenOf(card, [
    task('extra-new', { childKey: 'extra', status: 'running', updatedAt: '2026-11-16T12:00:00Z', contract: { goal: 'Extra', scope: ['test'], dependencies: ['docs'] } }),
    task('extra-old', { childKey: undefined, coordinationKey: 'extra', updatedAt: '2026-11-15T12:00:00Z' }),
    task('solo', { childKey: undefined, status: 'ready' }),
    task('planned-key', { childKey: undefined, key: 'activity' }),
    task('planned-coordination', { childKey: undefined, coordinationKey: 'docs' }),
  ]);
  assert.deepEqual(result.nodes.map(n => [n.key, n.taskId]), [['activity', 'planned-key'], ['docs', 'planned-coordination'], ['extra', 'extra-new'], ['solo', 'solo']]);
  assert.deepEqual(result.nodes[2], { key: 'extra', goal: 'Extra', scope: ['test'], dependencies: ['docs'], status: 'running', taskId: 'extra-new' });
});

test('keeps planned children without registered tasks', () => {
  const result = childrenOf(card);
  assert.deepEqual(result.nodes.map(n => [n.key, n.status, n.taskId]), [['activity', 'sin registrar', undefined], ['docs', 'sin registrar', undefined]]);
  assert.deepEqual(childrenOf(null), { nodes: [], edges: [] });
});

test('uses createdAt when updatedAt ties or is absent', () => {
  for (const updatedAt of [undefined, '2026-11-16T12:00:00Z']) {
    const result = childrenOf(card, [
      task('new', { updatedAt, createdAt: '2026-11-16T11:00:00Z' }),
      task('old', { updatedAt, createdAt: '2026-11-16T10:00:00Z' }),
    ]);
    assert.equal(result.nodes[0].taskId, 'new');
  }
});
