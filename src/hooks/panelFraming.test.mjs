import test from 'node:test';
import assert from 'node:assert/strict';
import { frameFor, needsFraming } from './panelFraming.js';

const area = { left: 40, right: 60, top: 80, bottom: 20 };
const view = { width: 1100, height: 900 };
const node = { type: 'terminal', x: 100, y: 200, width: 400, height: 200 };

test('frameFor centers the panel inside the safe area and caps zoom at 1', () => {
  assert.deepEqual(frameFor(node, area, view), { x: 240, y: 180, zoom: 1 });
});

test('frameFor fits large panels with the existing margins', () => {
  assert.deepEqual(frameFor({ ...node, width: 1872, height: 400 }, area, view), { x: 22, y: 280, zoom: .5 });
  assert.equal(frameFor({ ...node, height: 1552 }, area, view).zoom, .5);
});

test('frameFor keeps the minimum zoom at .15', () => {
  assert.equal(frameFor({ ...node, width: 10000, height: 10000 }, area, view).zoom, .15);
});

test('frameFor includes the zone label without changing the node', () => {
  const zone = { type: 'zone', x: 0, y: 100, width: 400, height: 356 };
  assert.deepEqual(frameFor(zone, { left: 0, right: 0, top: 0, bottom: 0 }, { width: 1000, height: 424 }), { x: 300, y: -44, zoom: 1 });
  assert.equal(zone.y, 100);
  assert.equal(zone.height, 356);
});

test('frameFor returns null for an empty view', () => {
  for (const empty of [{}, { width: 0, height: 900 }, { width: 1100, height: 0 }]) {
    assert.equal(frameFor(node, area, empty), null);
  }
});

test('needsFraming always reveals clipped panels, including zones', () => {
  for (const type of ['terminal', 'zone']) {
    assert.equal(needsFraming({ clipped: true, zoom: 1, target: 1, type }), true);
  }
});

test('needsFraming enlarges tiny cards and shrinks oversized cards', () => {
  assert.equal(needsFraming({ clipped: false, zoom: .2, target: .8, type: 'terminal' }), true);
  assert.equal(needsFraming({ clipped: false, zoom: 1, target: .5, type: 'terminal' }), true);
});

test('needsFraming preserves zoom within the inclusive tolerance', () => {
  for (const zoom of [.85, 1, 1.15]) {
    assert.equal(needsFraming({ clipped: false, zoom, target: 1, type: 'terminal' }), false);
  }
  assert.equal(needsFraming({ clipped: false, zoom: .849, target: 1, type: 'terminal' }), true);
  assert.equal(needsFraming({ clipped: false, zoom: 1.151, target: 1, type: 'terminal' }), true);
});

test('needsFraming exempts visible zones from zoom changes', () => {
  for (const zoom of [.15, 1.8]) {
    assert.equal(needsFraming({ clipped: false, zoom, target: 1, type: 'zone' }), false);
  }
});

test('needsFraming falls back to clipping for missing or non-finite targets', () => {
  for (const target of [undefined, null, NaN, Infinity, -Infinity]) {
    for (const clipped of [false, true]) {
      assert.equal(needsFraming({ clipped, zoom: .15, target, type: 'terminal' }), clipped);
    }
  }
});

test('frameFor keeps the requested zoom and only centers the panel', () => {
  assert.deepEqual(frameFor(node, area, view, .5), { x: 390, y: 330, zoom: .5 });
  assert.equal(frameFor({ ...node, width: 10000 }, area, view, 1.2).zoom, 1.2);
});
