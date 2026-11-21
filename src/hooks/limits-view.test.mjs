import test from 'node:test';
import assert from 'node:assert/strict';
import { peakWindow, toneOf, resetIn, summarize } from './limits-view.mjs';

test('toneOf respeta los límites', () => {
  assert.equal(toneOf(69), 'ok');
  assert.equal(toneOf(70), 'warn');
  assert.equal(toneOf(89), 'warn');
  assert.equal(toneOf(90), 'danger');
});

test('peakWindow elige el mayor percent', () => {
  assert.equal(peakWindow({ windows: [{ id: 'a', percent: 10 }, { id: 'b', percent: 80 }, { id: 'c', percent: 40 }] }).id, 'b');
  assert.equal(peakWindow({ windows: [] }), null);
  assert.equal(peakWindow({}), null);
});

test('resetIn da texto corto', () => {
  const now = 1_000_000_000_000;
  assert.equal(resetIn(now + (2 * 60 + 10) * 60000, now), 'en 2 h 10 min');
  assert.equal(resetIn(now + 3 * 86400000 + 1000, now), 'en 3 d');
  assert.equal(resetIn(now + 20 * 60000, now), 'en 20 min');
  assert.equal(resetIn(now - 1000, now), 'ya');
  assert.equal(resetIn(new Date(now + 3600000).toISOString(), now), 'en 1 h');
});

test('summarize cubre disponible, sin sesión y vacío', () => {
  const now = 1_000_000_000_000;
  const rows = summarize({ providers: [
    { id: 'claude', label: 'Claude', plan: 'Max', available: true, windows: [{ id: 's', label: '5 h', percent: 71.6, resetsAt: now + 3600000 }, { id: 'w', label: 'Semana', percent: 20, resetsAt: now - 1 }] },
    { id: 'codex', label: 'Codex', available: false, reason: 'No hay sesión', windows: [] }
  ] }, now);
  assert.equal(rows[0].percent, 72);
  assert.equal(rows[0].tone, 'warn');
  assert.deepEqual(rows[0].windows[0], { label: '5 h', percent: 72, tone: 'warn', reset: 'en 1 h' });
  assert.equal(rows[0].windows[1].reset, 'ya');
  assert.equal(rows[1].available, false);
  assert.equal(rows[1].percent, null);
  assert.equal(rows[1].reason, 'No hay sesión');
  assert.deepEqual(summarize(undefined), []);
  assert.deepEqual(summarize({}), []);
});
