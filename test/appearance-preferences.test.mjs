import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, normalizeAppearance, loadAppearance } from '../src/hooks/useAppearance.js';

test('appearance migration keeps v2 choices and separates artwork from atmosphere', () => {
  for (const background of ['gengar', 'aurora', 'tide', 'ember', 'plain']) {
    const legacy = { v: 2, background, accent: 'iris', grid: false, intensity: 27, image: '', futurePreference: 'keep' };
    const value = normalizeAppearance(legacy);
    assert.equal(value.background, background);
    assert.equal(value.accent, 'iris');
    assert.equal(value.grid, false);
    assert.equal(value.intensity, 27);
    assert.equal(value.gengarIntensity, 27);
    assert.equal(value.gengar, background === 'gengar');
    assert.equal(value.pulse, false);
    assert.equal(value.concentration, false);
    assert.equal(value.futurePreference, 'keep');
    assert.deepEqual(normalizeAppearance(value), value, 'migration is idempotent');
  }
  assert.equal(normalizeAppearance({ v: 1, accent: 'iris' }).accent, 'lilac');
  const image = 'data:image/png;base64,YQ==';
  assert.equal(normalizeAppearance({ image }).image, image);
  assert.equal(normalizeAppearance({ image }).gengar, false);
});

test('appearance validates independent settings and defaults to a still environment', () => {
  const value = normalizeAppearance({ intensity: -3, gengarIntensity: 140, pulse: 'yes', concentration: 1, grid: 'no', gengar: false, background: 'missing', accent: 'missing', image: 'https://example.com/a.png' });
  assert.equal(value.intensity, 0);
  assert.equal(value.gengarIntensity, 100);
  assert.equal(value.pulse, false);
  assert.equal(value.concentration, false);
  assert.equal(value.gengar, false);
  assert.equal(value.grid, true);
  assert.equal(value.image, '');
  assert.equal(value.background, defaults.background);
  assert.equal(value.accent, defaults.accent);
  for (const bad of [null, [], 3, 'bad']) assert.equal(normalizeAppearance(bad).pulse, false);
  assert.equal(normalizeAppearance({ intensity: NaN, gengarIntensity: Infinity }).gengarIntensity, 55);
});

test('appearance reads only the target project and recovers malformed storage without overwriting it', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([
    ['phantom:studio:a', JSON.stringify({ v: 3, intensity: 12, gengar: false, pulse: true, concentration: true })],
    ['phantom:studio:b', JSON.stringify({ v: 2, intensity: 87, accent: 'mint' })],
    ['phantom:studio:broken', '{broken'],
  ]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null } });
  try {
    assert.equal(loadAppearance('a').pulse, true);
    assert.equal(loadAppearance('a').gengar, false);
    assert.equal(loadAppearance('b').pulse, false);
    assert.equal(loadAppearance('b').intensity, 87);
    assert.equal(loadAppearance('b').accent, 'mint');
    assert.equal(loadAppearance('broken').intensity, 55);
    assert.equal(values.get('phantom:studio:broken'), '{broken');
    assert.equal(loadAppearance().concentration, false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
