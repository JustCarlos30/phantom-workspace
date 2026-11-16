import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSince, stateTone } from './terminalPulse.mjs';

test('formatSince expresa los cortes de antigüedad', () => {
  for (const [ms, expected] of [
    [0, 'ahora'], [9999, 'ahora'], [10000, 'hace 10 s'],
    [59999, 'hace 59 s'], [60000, 'hace 1 min'],
    [3599999, 'hace 59 min'], [3600000, 'hace 1 h'],
    [86399999, 'hace 23 h'], [86400000, 'hace 1 d'],
    [NaN, 'ahora'], [-5, 'ahora'], [Infinity, 'ahora'], [-Infinity, 'ahora'],
  ]) assert.equal(formatSince(ms), expected);
});

test('stateTone distingue trabajo, atención y estados neutros', () => {
  assert.equal(stateTone('working'), 'working');
  for (const state of ['approval', 'turn', 'blocked', 'review']) {
    assert.equal(stateTone(state), 'attention');
  }
  for (const state of ['idle', 'done', 'error', '', null, undefined, 'unknown']) {
    assert.equal(stateTone(state), null);
  }
});
