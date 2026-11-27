import test from 'node:test';
import assert from 'node:assert/strict';
import { peakWindow, toneOf, resetIn, summarize, queueNote, railWindows, resetAbsolute, resetLabel, paceOf, freshness } from './limits-view.mjs';

test('resetAbsolute/resetLabel: hora hoy y día+hora si es otro día', () => {
  const now = new Date(2026, 10, 27, 10, 0).getTime();
  const today = new Date(2026, 10, 27, 18, 40).getTime();
  assert.equal(resetAbsolute(today, now), '18:40');
  assert.equal(resetLabel(today, now), '18:40 · en 8 h 40 min');
  const monday = new Date(2026, 10, 30, 9, 0).getTime();
  assert.equal(resetAbsolute(monday, now), 'lun 09:00');
  assert.equal(resetLabel(monday, now), 'lun 09:00 · en 2 d');
  assert.equal(resetLabel(null, now), '');
});

test('paceOf calcula el tiempo transcurrido de la ventana o null', () => {
  const now = 1_000_000_000_000;
  assert.equal(paceOf(now + 9000 * 1000, 18000, now), 50);
  assert.equal(paceOf(now + 18000 * 1000, 18000, now), 0);
  assert.equal(paceOf(now - 1000, 18000, now), 100);
  assert.equal(paceOf(now + 1000, undefined, now), null);
  assert.equal(paceOf(null, 18000, now), null);
});

test('summarize añade reset absoluto/relativo y pace por ventana', () => {
  const now = new Date(2026, 10, 27, 10, 0).getTime();
  const resetsAt = new Date(2026, 10, 27, 12, 30).getTime();
  const [row] = summarize({ providers: [{ id: 'c', label: 'C', available: true, windows: [{ label: 'Sesión · 5 h', percent: 40, resetsAt, windowSeconds: 18000 }] }] }, now);
  assert.deepEqual([row.windows[0].resetAt, row.windows[0].resetLabel, row.windows[0].pace], ['12:30', '12:30 · en 2 h 30 min', 50]);
});

test('freshness usa el updatedAt más antiguo y marca viejo solo pasados 5 min', () => {
  const now = 1_000_000_000_000;
  const at = s => new Date(now - s * 1000).toISOString();
  const fresh = freshness({ providers: [{ updatedAt: at(10) }, { updatedAt: at(40) }] }, now);
  assert.deepEqual(fresh, { text: 'Actualizado hace 40 s', stale: false, reason: null });
  assert.equal(freshness({ providers: [{ updatedAt: at(300) }] }, now).stale, false);
  const old = freshness({ providers: [{ label: 'Claude', updatedAt: at(9 * 60), reason: 'límite 429', retryAt: new Date(now + 120000).toISOString() }, { updatedAt: at(5) }] }, now);
  assert.equal(old.text, 'Actualizado hace 9 min');
  assert.equal(old.stale, true);
  assert.match(old.reason, /Claude: límite 429 · reintenta en 2 min/);
  assert.deepEqual(freshness({ providers: [] }, now), { text: null, stale: false, reason: null });
});

test('railWindows elige Sesión 5 h y Semanal para Claude y Codex', () => {
  const claude = { windows: [{ label: 'Sesión · 5 h', percent: 18.4 }, { label: 'Semanal · Opus', percent: 95 }, { label: 'Semanal · todos los modelos', percent: 72 }] };
  assert.deepEqual(railWindows(claude).map(w => [w.key, w.percent, w.tone]), [['session', 18, 'ok'], ['weekly', 72, 'warn']]);
  const codex = { windows: [{ label: 'Code review · Semanal', percent: 99 }, { label: 'Semanal', percent: 91 }, { label: 'Sesión · 5 h', percent: 5 }] };
  assert.deepEqual(railWindows(codex).map(w => [w.key, w.percent, w.tone]), [['session', 5, 'ok'], ['weekly', 91, 'danger']]);
  assert.deepEqual(railWindows({ windows: [] }), []);
});

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

test('summarize expone stale, staleSince, status y retry', () => {
  const now = 1_000_000_000_000;
  const [row] = summarize({ providers: [{ id: 'claude', label: 'Claude', available: true, stale: true, status: 'rate_limited', staleSince: new Date(now - 7 * 60000).toISOString(), retryAt: new Date(now + 4 * 60000).toISOString(), windows: [{ label: '5 h', percent: 40 }] }] }, now);
  assert.deepEqual([row.stale, row.staleSince, row.status, row.retry, row.percent], [true, 'hace 7 min', 'rate_limited', 'reintenta en 4 min', 40]);
});

test('summarize cubre disponible, sin sesión y vacío', () => {
  const now = 1_000_000_000_000;
  const rows = summarize({ providers: [
    { id: 'claude', label: 'Claude', plan: 'Max', available: true, windows: [{ id: 's', label: '5 h', percent: 71.6, resetsAt: now + 3600000 }, { id: 'w', label: 'Semana', percent: 20, resetsAt: now - 1 }] },
    { id: 'codex', label: 'Codex', available: false, reason: 'No hay sesión', windows: [] }
  ] }, now);
  assert.equal(rows[0].percent, 72);
  assert.equal(rows[0].tone, 'warn');
  assert.deepEqual([rows[0].windows[0].label, rows[0].windows[0].percent, rows[0].windows[0].tone, rows[0].windows[0].reset, rows[0].windows[0].pace], ['5 h', 72, 'warn', 'en 1 h', null]);
  assert.equal(rows[0].windows[1].reset, 'ya');
  assert.equal(rows[1].available, false);
  assert.equal(rows[1].percent, null);
  assert.equal(rows[1].reason, 'No hay sesión');
  assert.deepEqual(summarize(undefined), []);
  assert.deepEqual(summarize({}), []);
});

test('queueNote describe la espera de cuota con hora local HH:MM', () => {
  const at = new Date(2026, 10, 27, 9, 5).getTime();
  assert.equal(queueNote({ taskId: 't1', state: 'waiting', notBefore: at }), 'en espera de cuota hasta 09:05');
  assert.equal(queueNote({ taskId: 't1', state: 'waiting', notBefore: new Date(2026, 10, 27, 21, 30).toISOString() }, null), 'en espera de cuota hasta 21:30');
  assert.equal(queueNote({ taskId: 't1', state: 'waiting' }), 'en espera de cuota');
});

test('queueNote indica el traslado a la cuenta B usando el nombre de limits', () => {
  assert.equal(queueNote({ taskId: 't2', state: 'moved', from: 'A', to: 'B' }), 'movida a cuenta B');
  assert.equal(queueNote({ taskId: 't2', state: 'moved', from: 'A', to: 'B' }, { providers: [{ id: 'B', label: 'Codex' }] }), 'movida a cuenta Codex');
});

test('queueNote devuelve null para estados no tratados', () => {
  assert.equal(queueNote({ taskId: 't3', state: 'running' }), null);
  assert.equal(queueNote(undefined), null);
});
