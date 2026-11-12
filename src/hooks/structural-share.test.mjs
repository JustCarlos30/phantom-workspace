import test from 'node:test';
import assert from 'node:assert/strict';
import { structuralShare } from './structuralShare.js';
import { cameraTier } from './useCanvasCamera.js';

test('equal state keeps the previous identity', () => {
  const previous = { workspaces: [{ id: 'w', nodes: [{ id: 'a', x: 1, data: { text: 'hi' } }] }] };
  const next = JSON.parse(JSON.stringify(previous));
  assert.equal(structuralShare(previous, next), previous);
});

test('only the changed path gets new identities', () => {
  const previous = { workspaces: [{ id: 'w', camera: { x: 0, y: 0, zoom: 1 }, missions: [{ id: 'm' }], nodes: [{ id: 'a', x: 1 }, { id: 'b', x: 2, data: { text: '' } }] }] };
  const next = JSON.parse(JSON.stringify(previous));
  next.workspaces[0].nodes[1].data.text = 'changed';
  const shared = structuralShare(previous, next);
  const [before, after] = [previous.workspaces[0], shared.workspaces[0]];
  assert.notEqual(shared, previous);
  assert.notEqual(after, before);
  assert.equal(after.camera, before.camera);
  assert.equal(after.missions, before.missions);
  assert.equal(after.nodes[0], before.nodes[0]);
  assert.notEqual(after.nodes[1], before.nodes[1]);
  assert.equal(after.nodes[1].data.text, 'changed');
});

test('reordered, added and removed items match by id', () => {
  const a = { id: 'a', x: 1 }, b = { id: 'b', x: 2 };
  const shared = structuralShare([a, b], [{ id: 'b', x: 2 }, { id: 'c', x: 3 }]);
  assert.equal(shared[0], b);
  assert.deepEqual(shared[1], { id: 'c', x: 3 });
  assert.equal(structuralShare([a, b], [{ id: 'a', x: 1 }]).length, 1);
});

test('removed or added keys produce a new object', () => {
  const previous = { a: 1, b: 2 };
  assert.deepEqual(structuralShare(previous, { a: 1 }), { a: 1 });
  assert.deepEqual(structuralShare(previous, { a: 1, b: 2, c: undefined }), { a: 1, b: 2, c: undefined });
  assert.notEqual(structuralShare(previous, { a: 1, b: 2, c: undefined }), previous);
});

test('camera tiers follow the overview thresholds', () => {
  assert.equal(cameraTier(1.2), -1);
  assert.equal(cameraTier(1), 0);
  assert.equal(cameraTier(.45), 0);
  assert.equal(cameraTier(.44), 1);
  assert.equal(cameraTier(.25), 1);
  assert.equal(cameraTier(.2), 2);
});
