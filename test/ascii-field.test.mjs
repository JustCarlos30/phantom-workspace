import test from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS, SHADES, createCreatures, stepCreatures, renderFrame } from '../src/hooks/asciiField.mjs';
import { BACKGROUNDS, normalizeAppearance } from '../src/hooks/useAppearance.js';

const size = { cols: 100, rows: 50 };
const centered = (scale = 8) => ({ kind: 'jelly', x0: 50, x: 50, y: 15, scale, depth: (scale - 3) / 8, phase: 0, speed: 1, hue: .5 });

test('seed reproduces creatures, motion and frames', () => {
  const a = createCreatures({ ...size, seed: 42 });
  const b = createCreatures({ ...size, seed: 42 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, createCreatures({ ...size, seed: 43 }));
  assert.deepEqual(stepCreatures(a, .2, size), stepCreatures(b, .2, size));
  assert.deepEqual(renderFrame(a, 2, size), renderFrame(b, 2, size));
});

test('frames have exact dimensions, printable ASCII glyphs and coherent channels', () => {
  const creatures = createCreatures({ ...size, seed: 7 });
  const { chars, tint, shade, level } = renderFrame(creatures, 1, size);
  assert.equal(chars.length, size.rows);
  assert.ok(chars.every(row => row.length === size.cols && [...row].every(char => char === ' ' || GLYPHS.includes(char))));
  assert.ok([...GLYPHS].every(char => char.charCodeAt(0) >= 33 && char.charCodeAt(0) <= 126));
  for (const channel of [tint, shade, level]) {
    assert.ok(channel instanceof Uint8Array);
    assert.equal(channel.length, size.cols * size.rows);
  }
  assert.ok(tint.every(index => index <= creatures.length));
  assert.ok(shade.every(value => value < SHADES));
  assert.ok(level.every(value => value <= 9));
  [...chars.join('')].forEach((char, i) => {
    assert.equal(tint[i] !== 0, char !== ' ');
    assert.equal(level[i] !== 0, char !== ' ');
    if (char === ' ') assert.equal(shade[i], 0);
  });
});

test('small and large medusas retain a dome and trailing strands', () => {
  for (const scale of [3, 4, 10]) {
    const { chars } = renderFrame([centered(scale)], 0, size);
    assert.ok(chars.slice(0, 15).some(row => row.trim()));
    assert.ok(chars.slice(15 + scale * 2).some(row => row.trim()));
    const text = chars.join('');
    assert.match(text, /[()]/);
    assert.match(text, /[\/\\]/);
    assert.match(text, /\|/);
    if (scale === 10) assert.ok(new Set([...text].filter(char => char !== ' ')).size >= 8);
  }
});

test('population contains only medusas with depth derived from scale', () => {
  const creatures = createCreatures({ cols: 200, rows: 100, seed: 42 });
  assert.ok(creatures.every(c => c.kind === 'jelly' && c.scale >= 3 && c.scale <= 11));
  assert.ok(creatures.every(c => c.depth === (c.scale - 3) / 8));
  assert.ok(creatures.filter(c => c.scale < 7).length > creatures.filter(c => c.scale >= 7).length);
});

test('bell contraction and propulsion share phase independently of time', () => {
  const jelly = centered(10);
  const bell = (phase, t) => renderFrame([{ ...jelly, phase }], t, size).chars.slice(0, 15);
  const width = phase => Math.max(...bell(phase, 0).map(row => row.trim().length));
  assert.ok(width(Math.PI) > width(0));
  assert.deepEqual(bell(0, 0), bell(0, 99));
  const rise = phase => jelly.y - stepCreatures([{ ...jelly, phase }], .01, size)[0].y;
  assert.ok(rise(0) > rise(Math.PI));
  assert.equal(stepCreatures([jelly], .25, size)[0].phase, .25);
});

test('motion rises strictly, recycles below and sways without column drift', () => {
  let creatures = createCreatures({ ...size, seed: 42 });
  const original = structuredClone(creatures);
  let wraps = 0;
  for (let i = 0; i < 2000; i++) {
    const next = stepCreatures(creatures, .1, size);
    next.forEach((c, j) => {
      assert.ok(Math.abs(c.x - c.x0) <= c.scale);
      assert.equal(c.x0, original[j].x0);
      if (c.y >= creatures[j].y) {
        wraps++;
        assert.ok(creatures[j].y < 0 && c.y > size.rows);
      } else assert.ok(c.y < creatures[j].y);
    });
    creatures = next;
  }
  assert.ok(wraps > 0);
  const exited = { ...centered(), y: -33 };
  assert.ok(stepCreatures([exited], .1, size)[0].y > size.rows);
});

test('steps are pure and nearer medusas rise faster at pleasant speeds', () => {
  const creatures = [centered(3), centered(11)].map(c => ({ ...c, y: 1000 }));
  const before = structuredClone(creatures);
  let next = creatures;
  for (let i = 0; i < 240; i++) next = stepCreatures(next, 1 / 24, { cols: 100, rows: 2000 });
  assert.deepEqual(creatures, before);
  const distances = next.map(c => 1000 - c.y);
  assert.ok(distances[1] > distances[0]);
  assert.ok(distances.every(d => d >= 5 && d <= 150));
  assert.deepEqual(stepCreatures(creatures, 0, size), creatures);
});

test('population scales with area and respects minimum and maximum', () => {
  assert.equal(createCreatures({ cols: 1, rows: 1, seed: 1 }).length, 4);
  assert.equal(createCreatures({ cols: 90, rows: 90, seed: 1 }).length, 12);
  assert.equal(createCreatures({ cols: 1000, rows: 1000, seed: 1 }).length, 18);
});

test('ASCII background is selectable and survives appearance normalization', () => {
  assert.deepEqual(BACKGROUNDS.find(([key]) => key === 'ascii'), ['ascii', 'Medusas ASCII', 'Medusas multicolor que ascienden, dibujadas en ASCII']);
  assert.equal(normalizeAppearance({ background: 'ascii' }).background, 'ascii');
});
