import test from 'node:test';
import assert from 'node:assert/strict';
import { delegatedRuns, delegationState } from './delegated-runs.mjs';

const run = (id, status, nodeId, at) => ({ id, status, createdAt: new Date(at).toISOString(), ...(nodeId ? { origin: { nodeId } } : {}) });

test('filtra encargos por nodo y separa vivos de terminados', () => {
  const runs = delegatedRuns('n1', [run('a', 'running', 'n1', 1000), run('b', 'completed', 'n1', 2000), run('c', 'running', 'n2', 3000), run('d', 'running', null, 4000)]);
  assert.deepEqual(runs.live.map(r => r.id), ['a']);
  assert.deepEqual(runs.finished.map(r => r.id), ['b']);
  assert.equal(runs.latest.id, 'b');
  assert.deepEqual(delegatedRuns('n1', undefined), { live: [], finished: [], latest: null });
});

test('turno idle con encargos vivos delega; turno activo no cambia', () => {
  const live = delegatedRuns('n1', [run('a', 'running', 'n1', 1), run('b', 'running', 'n1', 2)]);
  assert.deepEqual(delegationState('idle', live), { phase: 'delegating', live: 2, outcome: null });
  assert.equal(delegationState('running', live).phase, 'running');
  assert.equal(delegationState('waiting', live).phase, 'waiting');
});

test('resultado final: failed/lost atención, completed turno', () => {
  for (const [status, outcome] of [['failed', 'attention'], ['lost', 'attention'], ['completed', 'turn']]) {
    assert.equal(delegationState('idle', delegatedRuns('n1', [run('a', status, 'n1', 1)])).outcome, outcome);
  }
  assert.equal(delegationState('idle', delegatedRuns('n1', [])).outcome, null);
});
