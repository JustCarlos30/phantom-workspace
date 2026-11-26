import test from 'node:test';
import assert from 'node:assert/strict';
import { createWarmThrottle } from '../src/hooks/voice-warm.mjs';

test('primera llamada calienta y la siguiente dentro de la ventana no', () => {
  let t = 1000;
  const th = createWarmThrottle(60000, () => t);
  assert.equal(th.shouldWarm(), true);
  t += 59999;
  assert.equal(th.shouldWarm(), false);
});

test('vuelve a calentar tras el intervalo', () => {
  let t = 0;
  const th = createWarmThrottle(60000, () => t);
  assert.equal(th.shouldWarm(), true);
  t = 60000;
  assert.equal(th.shouldWarm(), true);
  t = 60001;
  assert.equal(th.shouldWarm(), false);
});
