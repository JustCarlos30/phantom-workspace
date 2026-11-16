import test from 'node:test';
import assert from 'node:assert/strict';
import { AQUARIUM_PALETTE, OCEAN_COLORS, creatureColor, createBubbles, stepBubbles, createPlants, renderPlants } from '../src/hooks/asciiField.mjs';
import { SHADES, CREATURE_SCHEMES, creatureGradient, RAMP, renderFrame, createCreatures, stepCreatures } from '../src/hooks/asciiField.mjs';

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

test('each scheme yields a reproducible vibrant gradient with distinct anchors', () => {
  assert.ok(CREATURE_SCHEMES.length >= 6);
  const gradients = CREATURE_SCHEMES.map((scheme, index) => {
    assert.ok(scheme.length >= 3 && scheme.length <= 4);
    const creature = { hue: (index + .1) / CREATURE_SCHEMES.length };
    const gradient = creatureGradient(creature);
    assert.equal(gradient.length, SHADES);
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
const detailedCreature = kind => ({ kind, x: 80, y: 40, scale: 10, phase: 0, speed: 1, hue: .2, dir: 1 });

for (const kind of ['jelly', 'butterfly', 'fish']) {
  test(`${kind} has detailed ramp coverage and spatially varied shades`, () => {
    const creature = detailedCreature(kind);
    const frame = renderFrame([creature], 0, detailedArea);
    assert.deepEqual(frame, renderFrame([creature], 0, detailedArea));
    assert.ok(frame.shade instanceof Uint8Array);
    assert.equal(frame.shade.length, detailedArea.cols * detailedArea.rows);
    assert.ok(frame.shade.every((shade, cell) => shade < SHADES && (frame.tint[cell] !== 0 || shade === 0)));
    const painted = [...frame.shade].filter((_, cell) => frame.tint[cell]);
    assert.ok(new Set(painted).size >= 8);
    const glyphs = new Set([...frame.chars.join('')].filter(char => char !== ' '));
    assert.ok(glyphs.size >= 5);
    assert.ok([...glyphs].every(char => RAMP.includes(char)));
    assert.ok(frame.chars[0].trim().length === 0 && frame.chars.at(-1).trim().length === 0);
    if (kind === 'jelly') assert.ok(frame.chars.slice(61).some(row => row.trim().length > 0));
  });
}

test('fish direction reflects its complete silhouette and colors', () => {
  const fish = detailedCreature('fish');
  const right = renderFrame([fish], .7, detailedArea);
  const left = renderFrame([{ ...fish, dir: -1 }], .7, detailedArea);
  assert.ok(right.chars.some(row => row.trim()));
  assert.notDeepEqual(left.chars, right.chars);
  for (let row = 0; row < detailedArea.rows; row++) {
    assert.equal(left.chars[row], [...right.chars[row]].reverse().join(''));
    for (let col = 0; col < detailedArea.cols; col++) {
      assert.equal(left.shade[row * detailedArea.cols + col], right.shade[row * detailedArea.cols + detailedArea.cols - 1 - col]);
    }
  }
});

test('fish swim in their direction and wrap within the existing size margin', () => {
  for (const dir of [-1, 1]) {
    const fish = { ...detailedCreature('fish'), dir };
    const before = structuredClone(fish);
    let next = stepCreatures([fish], .5, detailedArea)[0];
    assert.ok((next.x - fish.x) * dir > 0);
    assert.deepEqual(fish, before);
    for (let i = 0; i < 200; i++) {
      next = stepCreatures([next], 123.4, detailedArea)[0];
      const margin = next.scale * 4;
      assert.ok(next.x >= -margin && next.x < detailedArea.cols + margin);
      assert.ok(next.y >= -margin && next.y < detailedArea.rows + margin);
    }
  }
});

test('large populations retain the original leading kinds and include fish', () => {
  const creatures = createCreatures({ cols: 200, rows: 100, seed: 42 });
  assert.equal(creatures.length, 14);
  assert.deepEqual(creatures.slice(0, 4).map(creature => creature.kind), ['jelly', 'butterfly', 'ghost', 'fish']);
  assert.ok(creatures.every(creature => creature.scale >= 6 && creature.scale <= 10 && [-1, 1].includes(creature.dir)));
});
