import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoalescer, livePollDelay } from './poll-schedule.mjs';

function clock() {
  let time = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => time,
    schedule: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: time + ms }); return id; },
    cancel: id => { timers.delete(id); },
    pending: () => timers.size,
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); time = next[1].at; next[1].fn();
      }
      time = end;
    },
  };
}
const make = (c, run, options = {}) => createCoalescer({ now: c.now, schedule: c.schedule, cancel: c.cancel, run, ...options });

test('livePollDelay: visible devuelve base', () => {
  assert.equal(livePollDelay({ hidden: false }), 5000);
  assert.equal(livePollDelay({ hidden: false, base: 1000 }), 1000);
});

test('livePollDelay: oculto devuelve hiddenDelay (null por defecto)', () => {
  assert.equal(livePollDelay({ hidden: true }), null);
  assert.equal(livePollDelay({ hidden: true, hiddenDelay: 30000 }), 30000);
});

test('el coalescer junta 10 disparos en 1 ejecución', () => {
  const c = clock(); let runs = 0;
  const co = make(c, () => runs++);
  for (let i = 0; i < 10; i++) co.trigger();
  c.advance(399); assert.equal(runs, 0);
  c.advance(1); assert.equal(runs, 1);
  c.advance(5000); assert.equal(runs, 1);
});

test('el coalescer respeta minGap desde la última ejecución', () => {
  const c = clock(); const at = [];
  const co = make(c, () => at.push(c.now()));
  co.trigger(); c.advance(400);
  c.advance(100); co.trigger();
  c.advance(5000);
  assert.deepEqual(at, [400, 2400]);
});

test('un disparo durante la espera no atrasa la ejecución', () => {
  const c = clock(); const at = [];
  const co = make(c, () => at.push(c.now()));
  co.trigger(); c.advance(300); co.trigger(); c.advance(100);
  assert.deepEqual(at, [400]);
});

test('flush ejecuta de inmediato una sola vez', () => {
  const c = clock(); let runs = 0;
  const co = make(c, () => runs++);
  co.trigger(); co.flush(); co.flush();
  c.advance(5000);
  assert.equal(runs, 1);
});

test('dispose cancela lo pendiente y bloquea nuevos disparos', () => {
  const c = clock(); let runs = 0;
  const co = make(c, () => runs++);
  co.trigger(); co.dispose();
  assert.equal(c.pending(), 0);
  co.trigger(); co.flush(); c.advance(5000);
  assert.equal(runs, 0);
});
