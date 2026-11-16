import test from 'node:test';
import assert from 'node:assert/strict';
import { OCEAN_COLORS, SHADES, CREATURE_SCHEMES, creatureGradient, renderFrame, createCreatures, stepCreatures } from '../src/hooks/asciiField.mjs';

const size = { cols: 100, rows: 50, seed: 42 };
test('ocean remains a subtle dark gradient', () => {
  assert.deepEqual(OCEAN_COLORS, ['#090c12', '#0c1118', '#10171a']);
});

test('empty and negative viewports produce no painted cells', () => {
  for (const area of [{ cols: 0, rows: 10 }, { cols: 10, rows: 0 }, { cols: -5, rows: 10 }, { cols: 10, rows: -5 }]) {
    assert.deepEqual(createCreatures({ ...area, seed: 1 }), []);
    assert.deepEqual(stepCreatures(createCreatures(size), 1, area), []);
    const frame = renderFrame(createCreatures(size), 1, area);
    assert.equal(frame.chars.join(''), '');
    for (const key of ['tint', 'shade', 'level']) assert.equal(frame[key].length, 0);
  }
});

test('each scheme yields a reproducible vibrant gradient with distinct anchors', () => {
  assert.ok(CREATURE_SCHEMES.length >= 6);
  const gradients = CREATURE_SCHEMES.map((scheme, index) => {
    assert.ok(scheme.length >= 3 && scheme.length <= 4);
    const creature = { hue: (index + .1) / CREATURE_SCHEMES.length };
    const gradient = creatureGradient(creature);
    assert.equal(gradient.length, SHADES);
    assert.equal(gradient[0], scheme[0]);
    assert.equal(gradient.at(-1), scheme.at(-1));
    assert.deepEqual(gradient, creatureGradient(creature));
    for (const color of gradient) {
      assert.match(color, /^#[0-9a-f]{6}$/i);
      const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
      assert.ok(Math.max(...channels) - Math.min(...channels) > 60);
    }
    const anchors = [gradient[0], gradient[Math.floor(SHADES / 2)], gradient.at(-1)];
    for (let a = 0; a < anchors.length; a++) for (let b = a + 1; b < anchors.length; b++) {
      const distance = Math.hypot(...[1, 3, 5].map(offset => parseInt(anchors[a].slice(offset, offset + 2), 16) - parseInt(anchors[b].slice(offset, offset + 2), 16)));
      assert.ok(distance > 80);
    }
    return gradient.join('');
  });
  assert.equal(new Set(gradients).size, CREATURE_SCHEMES.length);
});

const detailedArea = { cols: 161, rows: 101 };
const detailedCreature = { kind: 'jelly', x0: 80, x: 80, y: 40, scale: 10, depth: .875, phase: 0, speed: 1, hue: .2 };

test('medusa has anatomical brightness and spatially varied shades', () => {
  const creature = detailedCreature;
  const frame = renderFrame([creature], 0, detailedArea);
  assert.deepEqual(frame, renderFrame([creature], 0, detailedArea));
  assert.ok(frame.shade instanceof Uint8Array);
  assert.equal(frame.shade.length, detailedArea.cols * detailedArea.rows);
  assert.ok(frame.shade.every((shade, cell) => shade < SHADES && (frame.tint[cell] !== 0 || shade === 0)));
  const painted = [...frame.shade].filter((_, cell) => frame.tint[cell]);
  assert.ok(new Set(painted).size >= 8);
  const glyphs = new Set([...frame.chars.join('')].filter(char => char !== ' '));
  assert.ok(glyphs.size >= 8);
  const text = frame.chars.join('');
  [...text].forEach((char, cell) => {
    if ('oO@'.includes(char)) assert.equal(frame.level[cell], 9);
    if ('{}S$%&'.includes(char)) assert.equal(frame.level[cell], 6);
  });
  const tips = [...frame.level].filter((_, cell) => Math.floor(cell / detailedArea.cols) > 65 && frame.tint[cell]);
  assert.ok(tips.length > 0 && tips.every(level => level <= 3));
  assert.ok(frame.chars[0].trim().length === 0 && frame.chars.at(-1).trim().length === 0);
  assert.ok(frame.chars.slice(61).some(row => row.trim().length > 0));
});

test('near medusas overlay distant ones while tint retains original indices', () => {
  const near = detailedCreature;
  const far = { ...near, scale: 4, depth: .125 };
  const nearFrame = renderFrame([near], 0, detailedArea);
  const mixed = renderFrame([near, far], 0, detailedArea);
  nearFrame.tint.forEach((value, cell) => {
    if (!value) return;
    assert.equal(mixed.tint[cell], 1);
    assert.equal(mixed.chars[Math.floor(cell / detailedArea.cols)][cell % detailedArea.cols], nearFrame.chars[Math.floor(cell / detailedArea.cols)][cell % detailedArea.cols]);
    assert.equal(mixed.level[cell], nearFrame.level[cell]);
  });
});
