import test from 'node:test';
import assert from 'node:assert/strict';
import { gridStep } from './canvasGrid.js';

const loop = zoom => { let step = 24 * zoom; while (step < 14) step *= 2; return step; };

test('grid spacing matches the doubling rule across the zoom range', () => {
  for (let zoom = .01; zoom <= 3; zoom += .0137) assert.equal(gridStep(24, zoom), loop(zoom), `zoom ${zoom}`);
});

test('grid spacing is finite for a camera that is not a valid zoom', () => {
  for (const zoom of [0, -1, -.35, -Infinity, Infinity, NaN, undefined, 1e-300]) {
    const step = gridStep(24, zoom);
    assert.ok(Number.isFinite(step) && step >= 14, `zoom ${zoom} gave ${step}`);
  }
});
