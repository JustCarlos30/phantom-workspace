import test from 'node:test';
import assert from 'node:assert/strict';
import { clampFrame, clampRange, createReviewId, elementsForRange, frameToTime, normalizeRegion, timeToFrame, validRegion, validReviewId, videoRect } from './video-review-model.mjs';

test('frame seeking preserves zero-based frames at integer and fractional fps', () => {
  for (const fps of [24, 30, 60, 30000 / 1001]) {
    for (const frame of [0, 1, 29, 59, 999]) assert.equal(timeToFrame(frameToTime(frame, fps), fps, 1000), frame);
    assert.equal(timeToFrame(500, fps, 90), 89);
  }
  assert.equal(clampFrame(-10, 90), 0);
  assert.equal(clampFrame(90, 90), 89);
  assert.deepEqual(clampRange(100, -4, 90), { start: 0, end: 89 });
  assert.deepEqual(clampRange(8, 8, 90), { start: 8, end: 8 });
  for (const fps of [0, -1, NaN, Infinity]) assert.throws(() => frameToTime(1, fps));
  assert.throws(() => clampFrame(NaN, 90));
  assert.throws(() => clampFrame(0, 0));
});

test('regions refer to the full video, accounting for horizontal and vertical letterboxing', () => {
  const wide = videoRect({ width: 400, height: 400 }, 1920, 1080);
  assert.deepEqual(wide, { left: 0, top: 87.5, width: 400, height: 225 });
  assert.deepEqual(normalizeRegion({ x: 100, y: 143.75 }, { x: 300, y: 256.25 }, wide), { x: .25, y: .25, width: .5, height: .5 });
  const tall = videoRect({ width: 400, height: 400 }, 100, 200);
  assert.deepEqual(tall, { left: 100, top: 0, width: 200, height: 400 });
  assert.deepEqual(normalizeRegion({ x: 500, y: 500 }, { x: -20, y: -20 }, tall), { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(normalizeRegion({ x: 100, y: 100 }, { x: 100, y: 200 }, tall), null);
  for (const region of [{ x: .8, y: 0, width: .3, height: 1 }, { x: 0, y: .8, width: 1, height: .3 }, { x: -1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: Infinity }]) assert.equal(validRegion(region), false);
  assert.throws(() => videoRect({ width: 0, height: 400 }, 100, 200));
});

test('element ranges must contain both inclusive endpoints', () => {
  const elements = [{ id: 'global' }, { id: 'title', range: { start: 10, end: 20 } }];
  assert.deepEqual(elementsForRange(elements, { start: 10, end: 20 }), elements);
  assert.deepEqual(elementsForRange(elements, { start: 20, end: 20 }), elements);
  for (const range of [{ start: 9, end: 20 }, { start: 10, end: 21 }]) assert.deepEqual(elementsForRange(elements, range), [elements[0]]);
});

test('annotation IDs obey v1 and are unique across revisions', () => {
  const ids = Array.from({ length: 1000 }, () => createReviewId());
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(validReviewId));
  assert.equal(validReviewId('a'.repeat(96)), true);
  for (const id of ['', '_start', '-start', 'á', 'a.b', 'a/b', 'a'.repeat(97)]) assert.equal(validReviewId(id), false);
  assert.throws(() => createReviewId('../escape'));
});
