import test from 'node:test';
import assert from 'node:assert/strict';
import { RAMP, createCreatures, stepCreatures, renderFrame } from '../src/hooks/asciiField.mjs';
import { BACKGROUNDS, normalizeAppearance } from '../src/hooks/useAppearance.js';

const size = { cols: 100, rows: 50 };
const centered = kind => ({ kind, x: 50, y: 25, scale: 8, phase: 0, speed: 1, hue: .5 });

test('seed reproduces creatures, motion and frames', () => {
  const a = createCreatures({ ...size, seed: 42 });
  const b = createCreatures({ ...size, seed: 42 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, createCreatures({ ...size, seed: 43 }));
  assert.deepEqual(stepCreatures(a, .2, size), stepCreatures(b, .2, size));
  assert.deepEqual(renderFrame(a, 2, size), renderFrame(b, 2, size));
});

test('frames have exact dimensions, ramp characters and tint indices', () => {
  const creatures = createCreatures({ ...size, seed: 7 });
  const { chars, tint } = renderFrame(creatures, 1, size);
  assert.equal(chars.length, size.rows);
  assert.ok(chars.every(row => row.length === size.cols && [...row].every(char => RAMP.includes(char))));
  assert.ok(tint instanceof Uint8Array);
  assert.equal(tint.length, size.cols * size.rows);
  assert.ok(tint.every(index => index <= creatures.length));
});

test('each creature kind paints visible cells at the center', () => {
  for (const kind of ['jelly', 'butterfly', 'ghost']) {
    assert.match(renderFrame([centered(kind)], 0, size).chars.join(''), /[^ ]/);
  }
});

test('original ghost has open empty eyes and a hollow smile', () => {
  const { chars } = renderFrame([centered('ghost')], 0, size);
  assert.equal(chars[22][44], ' ');
  assert.equal(chars[22][56], ' ');
  assert.notEqual(chars[23][50], ' ');
  assert.equal(chars[29][50], ' ');
  const blinking = renderFrame([centered('ghost')], 4.9, size);
  assert.notEqual(blinking.chars[22][44], ' ');
});

test('jelly bell breathes between contraction and expansion', () => {
  const jelly = centered('jelly');
  const width = t => renderFrame([jelly], t, size).chars[25].trim().length;
  assert.ok(width(Math.PI / 2) > width(3 * Math.PI / 2));
});

test('motion wraps all kinds within the area plus their size margin', () => {
  let creatures = ['jelly', 'butterfly', 'ghost'].map(centered);
  const original = structuredClone(creatures);
  for (let i = 0; i < 2000; i++) {
    creatures = stepCreatures(creatures, .5, size);
    for (const creature of creatures) {
      const margin = creature.scale * 4;
      assert.ok(creature.x >= -margin && creature.x < size.cols + margin);
      assert.ok(creature.y >= -margin && creature.y < size.rows + margin);
    }
  }
  assert.notDeepEqual(creatures, original);
});

test('population scales with area and respects minimum and maximum', () => {
  assert.equal(createCreatures({ cols: 1, rows: 1, seed: 1 }).length, 3);
  assert.equal(createCreatures({ cols: 90, rows: 90, seed: 1 }).length, 9);
  assert.equal(createCreatures({ cols: 1000, rows: 1000, seed: 1 }).length, 14);
});

test('ASCII background is selectable and survives appearance normalization', () => {
  assert.ok(BACKGROUNDS.some(([key]) => key === 'ascii'));
  assert.equal(normalizeAppearance({ background: 'ascii' }).background, 'ascii');
});
