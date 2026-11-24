import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffPosition } from '../host/handoffs.mjs';

test('empty workspace places a terminal at the camera anchor with fallback camera', () => {
  assert.deepEqual(handoffPosition({ nodes: [] }), { x: 336, y: 26 });
  assert.deepEqual(handoffPosition({ nodes: [], camera: null }), { x: 336, y: 26 });
  assert.deepEqual(handoffPosition({ nodes: [], camera: { x: -18000, y: 8000, zoom: .5 } }), { x: 37120, y: -15500 });
});

test('new terminals leave at least 32 pixels around visible cards of mixed sizes', () => {
  const workspace = { nodes: [
    { type: 'terminal', x: 0, y: 0, width: 640, height: 640 },
    { type: 'note', x: 40, y: 40, width: 800, height: 400 },
    { type: 'browser', x: 900, y: -200, width: 760, height: 900 },
  ] };
  for (let i = 0; i < 5; i++) {
    const before = structuredClone(workspace);
    const next = { type: 'terminal', ...handoffPosition(workspace), width: 640, height: 640 };
    assert.deepEqual(workspace, before);
    for (const node of workspace.nodes) {
      assert.ok(next.x >= node.x + node.width + 32 || node.x >= next.x + next.width + 32 ||
        next.y >= node.y + node.height + 32 || node.y >= next.y + next.height + 32);
    }
    workspace.nodes.push(next);
  }
});

test('hidden cards and zones do not occupy terminal placement slots', () => {
  const camera = { x: -1200, y: 300, zoom: 2 };
  const anchor = handoffPosition({ nodes: [], camera });
  const nodes = [
    { type: 'terminal', ...anchor, width: 640, height: 640, data: { hidden: true } },
    { type: 'zone', x: anchor.x - 100, y: anchor.y - 100, width: 2000, height: 2000 },
  ];
  assert.deepEqual(handoffPosition({ nodes, camera }), anchor);
});
