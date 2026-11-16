import test from 'node:test';
import assert from 'node:assert/strict';
import { AQUARIUM_PALETTE, OCEAN_COLORS, creatureColor, createBubbles, stepBubbles, createPlants, renderPlants } from '../src/hooks/asciiField.mjs';

const size = { cols: 100, rows: 50, seed: 42 };
const inside = cell => cell.x >= 0 && cell.x < size.cols && cell.y >= 0 && cell.y < size.rows;

test('aquarium palette has seven vibrant valid hex colors', () => {
  assert.equal(new Set(AQUARIUM_PALETTE).size, 7);
  for (const color of [...AQUARIUM_PALETTE, ...OCEAN_COLORS]) assert.match(color, /^#[0-9a-f]{6}$/i);
});

test('creature shading is deterministic and brighter at dense edges', () => {
  for (let i = 0; i < AQUARIUM_PALETTE.length; i++) {
    const hue = i / AQUARIUM_PALETTE.length;
    assert.equal(creatureColor(hue, 0), AQUARIUM_PALETTE[i]);
    const bright = creatureColor(hue, 1);
    assert.match(bright, /^#[0-9a-f]{6}$/i);
    assert.equal(bright, creatureColor(hue, 1));
    for (const offset of [1, 3, 5]) {
      assert.ok(parseInt(bright.slice(offset, offset + 2), 16) >= parseInt(AQUARIUM_PALETTE[i].slice(offset, offset + 2), 16));
    }
    assert.notEqual(bright, AQUARIUM_PALETTE[i]);
  }
});

test('bubble seeds reproduce population and motion', () => {
  const bubbles = createBubbles(size);
  assert.deepEqual(bubbles, createBubbles(size));
  assert.notDeepEqual(bubbles, createBubbles({ ...size, seed: 43 }));
  assert.deepEqual(stepBubbles(bubbles, 1, size), stepBubbles(createBubbles(size), 1, size));
  assert.ok(bubbles.every(bubble => inside(bubble) && ['o', 'O', '.', '°'].includes(bubble.char)));
});

test('bubbles rise without mutating their input', () => {
  const bubbles = createBubbles(size).map(bubble => ({ ...bubble, y: 25 }));
  const before = structuredClone(bubbles);
  const next = stepBubbles(bubbles, .5, size);
  assert.deepEqual(bubbles, before);
  next.forEach((bubble, index) => assert.ok(bubble.y < bubbles[index].y));
});

test('bubbles recycle at the bottom and remain inside through long steps', () => {
  let bubbles = [{ x: 0, y: .1, phase: 0, speed: 1, char: 'o' }];
  const recycled = stepBubbles(bubbles, .2, size);
  assert.ok(Math.abs(recycled[0].y - 49.9) < 1e-9);
  for (let i = 0; i < 200; i++) {
    bubbles = stepBubbles(bubbles, 123.4, size);
    assert.ok(bubbles.every(inside));
  }
});

test('plants are seeded and wave deterministically without mutation', () => {
  const plants = createPlants(size);
  const before = structuredClone(plants);
  assert.deepEqual(plants, createPlants(size));
  assert.notDeepEqual(plants, createPlants({ ...size, seed: 43 }));
  assert.deepEqual(renderPlants(plants, 2, size), renderPlants(createPlants(size), 2, size));
  assert.notDeepEqual(renderPlants(plants, 0, size), renderPlants(plants, 3, size));
  assert.deepEqual(plants, before);
});

test('plant glyphs remain inside the area including tiny viewports', () => {
  for (const area of [size, { cols: 1, rows: 1, seed: 1 }, { cols: 3, rows: 2, seed: 7 }]) {
    const plants = createPlants(area);
    for (const time of [0, 1, 20, 100]) {
      const cells = renderPlants(plants, time, area);
      assert.ok(cells.length > 0);
      assert.ok(cells.every(cell => cell.x >= 0 && cell.x < area.cols && cell.y >= 0 && cell.y < area.rows));
      assert.ok(cells.some(cell => cell.y === area.rows - 1));
      assert.ok(cells.every(cell => /^#[0-9a-f]{6}$/i.test(cell.color)));
    }
  }
});

test('empty viewports produce no ambient entities or glyphs', () => {
  for (const area of [{ cols: 0, rows: 10 }, { cols: 10, rows: 0 }]) {
    assert.deepEqual(createBubbles({ ...area, seed: 1 }), []);
    assert.deepEqual(createPlants({ ...area, seed: 1 }), []);
    assert.deepEqual(stepBubbles(createBubbles(size), 1, area), []);
    assert.deepEqual(renderPlants(createPlants(size), 1, area), []);
  }
});
