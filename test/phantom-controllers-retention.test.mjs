import test from 'node:test';
import assert from 'node:assert/strict';
import { prunePhantomControllers } from '../integrations/phantom.mjs';

test('retains only the latest 8 finished controllers and bounds historical output', () => {
  const finished = Array.from({ length: 73 }, (_, i) => ({
    id: `controller-${i}`, status: i % 2 ? 'failed' : 'completed',
    createdAt: new Date(1700000000000 + i * 1000).toISOString(),
    output: 'x'.repeat(70 * 1024 - 4) + 'tail',
  }));
  finished[0].endedAt = new Date(1800000000000).toISOString();
  const running = { id: 'running', status: 'running', output: 'r'.repeat(65536) };
  const workspace = { phantomControllers: [running, ...finished.toReversed()] };
  assert.equal(prunePhantomControllers(workspace), true);
  assert.deepEqual(workspace.phantomControllers, [running, ...finished.slice(66).toReversed(), finished[0]]);
  for (const item of workspace.phantomControllers.filter(item => item !== running)) {
    assert.equal(item.output.length, 4096);
    assert.ok(item.output.endsWith('tail'));
    assert.equal(item.truncated, true);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(workspace)) < 600 * 1024);
  const snapshot = JSON.stringify(workspace);
  assert.equal(prunePhantomControllers(workspace), false);
  assert.equal(JSON.stringify(workspace), snapshot);
});

test('preserves every running or live controller regardless of age or status', () => {
  const protectedItems = Array.from({ length: 25 }, (_, i) => ({ id: `running-${i}`, status: 'running', output: 'x'.repeat(65536) }));
  const live = { id: 'live', status: 'lost', output: 'x'.repeat(65536) };
  const workspace = { phantomControllers: [...protectedItems, live, ...Array.from({ length: 30 }, (_, i) => ({ id: `old-${i}`, status: 'lost' }))] };
  prunePhantomControllers(workspace, new Map([[live.id, {}]]));
  assert.equal(workspace.phantomControllers.length, 34);
  assert.deepEqual(workspace.phantomControllers.slice(0, 26), [...protectedItems, live]);
  assert.equal(live.output.length, 65536);
  assert.ok(protectedItems.every(item => item.output.length === 65536));
});
