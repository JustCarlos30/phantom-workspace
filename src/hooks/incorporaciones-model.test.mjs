import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncorporaciones, isReadyBranch } from './incorporaciones-model.mjs';

const branch = (patch = {}) => ({ nodeId: 'n1', title: 'Feature', branch: 'phantom/terminal-1', ahead: 2, behind: 0, uncommitted: 0, missing: false, status: 'idle', overlaps: [], ...patch });
const request = (status, patch = {}) => ({ id: `r-${status}`, nodeId: `n-${status}`, title: status, status, overlaps: [], ...patch });

test('a branch is ready only with saved commits, a clean worktree and no agent mid-edit', () => {
  assert.equal(isReadyBranch(branch()), true);
  assert.equal(isReadyBranch(branch({ status: 'review' })), true);
  for (const patch of [{ ahead: 0 }, { ahead: null }, { uncommitted: 3 }, { uncommitted: null }, { missing: true }, { status: 'working' }, { status: 'blocked' }]) {
    assert.equal(isReadyBranch(branch(patch)), false, JSON.stringify(patch));
  }
  assert.equal(isReadyBranch(null), false);
});

test('ready lists queued requests in order first, then unrequested clean branches', () => {
  const data = {
    queue: [request('merging'), request('queued', { id: 'q1' }), request('conflict'), request('queued', { id: 'q2' }), request('failed')],
    active: [branch({ nodeId: 'a' }), branch({ nodeId: 'b', uncommitted: 2 }), branch({ nodeId: 'c', status: 'working' })],
    history: [request('merged'), request('rejected')],
  };
  const model = buildIncorporaciones(data);
  assert.equal(model.merging.status, 'merging');
  assert.deepEqual(model.ready.map(entry => [entry.kind, entry.item.id ?? entry.item.nodeId]), [['request', 'q1'], ['request', 'q2'], ['branch', 'a']]);
  assert.deepEqual(model.attention.map(item => item.status), ['conflict', 'failed']);
  assert.deepEqual(model.working.map(item => item.nodeId), ['b', 'c']);
  assert.deepEqual(model.counts, { cards: 5, ready: 3, queued: 2, unrequested: 1, attention: 2, working: 2, merged: 1, overlapping: 0 });
});

test('counts overlaps once per terminal and tolerates an empty status', () => {
  const data = { queue: [request('queued', { overlaps: [{ path: 'a', with: ['x'] }] })], active: [branch({ overlaps: [{ path: 'a', with: ['y'] }] })], history: [] };
  assert.equal(buildIncorporaciones(data).counts.overlapping, 2);
  const empty = buildIncorporaciones(undefined);
  assert.equal(empty.merging, null);
  assert.deepEqual(empty.counts, { cards: 0, ready: 0, queued: 0, unrequested: 0, attention: 0, working: 0, merged: 0, overlapping: 0 });
});
