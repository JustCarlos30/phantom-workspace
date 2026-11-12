import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadyToMerge, readyLabel, trackReady } from './ready-branches.mjs';

const row = (patch = {}) => ({ name: 'phantom/feature', oid: 'one', isBase: false, work: 'ready', ahead: 2, behind: 0, changeCount: 0, conflicts: [], terminal: null, ...patch });
const overview = (...branches) => ({ available: true, branches });

test('only clean, conflict-checked, non-base branches with commits and no working terminal are ready', () => {
  assert.equal(isReadyToMerge(row()), true);
  assert.equal(isReadyToMerge(row({ terminal: { title: 'Feature', status: 'idle' }, behind: 5 })), true);
  assert.equal(isReadyToMerge(row({ terminal: undefined })), true);
  for (const patch of [
    { isBase: true }, { work: 'dirty' }, { work: 'none' }, { ahead: 0 }, { ahead: -1 },
    { changeCount: 1 }, { changeCount: undefined }, { conflicts: null }, { conflicts: ['file'] },
    { conflicts: undefined }, { conflicts: {} }, { error: 'Git failed' }, { terminal: { status: 'working' } },
  ]) assert.equal(isReadyToMerge(row(patch)), false, JSON.stringify(patch));
});

test('first reading establishes a baseline with a single initial list and no fresh branches', () => {
  const ready = row();
  const result = trackReady(null, overview(ready, row({ name: 'dirty', work: 'dirty' })));
  assert.deepEqual(result.initial, [ready]);
  assert.deepEqual(result.fresh, []);
  assert.deepEqual(result.seen, new Map([[ready.name, ready.oid]]));
  assert.deepEqual(trackReady(null, overview()).initial, []);
});

test('unchanged tips are silent; new names and new tips are fresh without mutating the prior map', () => {
  const prior = new Map([['phantom/feature', 'one']]);
  assert.deepEqual(trackReady(prior, overview(row())).fresh, []);
  const changed = row({ oid: 'two' }), added = row({ name: 'another' });
  const result = trackReady(prior, overview(changed, added));
  assert.deepEqual(result.fresh, [changed, added]);
  assert.deepEqual(result.initial, []);
  assert.deepEqual(prior, new Map([['phantom/feature', 'one']]));
  assert.deepEqual(result.seen, new Map([[changed.name, 'two'], ['another', 'one']]));
});

test('leaving readiness or disappearing drops the tip so returning with the same tip alerts again', () => {
  const prior = trackReady(null, overview(row())).seen;
  for (const next of [overview(row({ work: 'dirty' })), overview(row({ terminal: { status: 'working' } })), overview()]) {
    const result = trackReady(prior, next);
    assert.equal(result.seen.size, 0);
    assert.deepEqual(trackReady(result.seen, overview(row())).fresh, [row()]);
  }
});

test('labels prefer terminal titles and otherwise strip only the phantom prefix', () => {
  assert.equal(readyLabel(row({ terminal: { title: 'Mi tarea' } })), 'Mi tarea · 2 commits');
  assert.equal(readyLabel(row()), 'feature · 2 commits');
  assert.equal(readyLabel(row({ name: 'feature/nested', ahead: 1 })), 'feature/nested · 1 commits');
});
