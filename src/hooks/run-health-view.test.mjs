import test from 'node:test';
import assert from 'node:assert/strict';
import { runHealthView } from './run-health-view.mjs';

test('formatea actividad, hijos y tiempo sin actividad', () => {
  assert.deepEqual(runHealthView({ current: { tool: 'read', target: 'src/app.mjs', at: '2026-11-23T10:00:00Z' }, children: { done: 1, total: 2 }, idleMs: 5_000 }), {
    line: 'read · src/app.mjs · hijos 1/2 · sin actividad 5 s', level: 'ok', warning: '',
  });
});

test('muestra verificación aunque no haya una acción actual', () => {
  assert.equal(runHealthView({ phase: 'verifying', idleMs: 65_000 }).line, 'Verificando · hijos 0/0 · sin actividad 1 min 5 s');
});

test('un encargo estancado produce aviso warn', () => {
  const view = runHealthView({ stalled: true, idleMs: 120_000 });
  assert.equal(view.level, 'warn');
  assert.equal(view.warning, 'Encargo sin actividad reciente');
});

test('un bucle prevalece como alert', () => {
  const view = runHealthView([{ stalled: true }, { looping: true }]);
  assert.equal(view.level, 'alert');
  assert.equal(view.warning, 'Posible bucle de actividad');
});

test('agrega hijos y conserva la actividad más reciente', () => {
  const view = runHealthView([
    { current: { tool: 'read', target: 'old', at: '2026-11-23T10:00:00Z' }, children: { done: 1, total: 1 }, idleMs: 2_000 },
    { current: { tool: 'edit', target: 'new', at: '2026-11-23T10:00:02Z' }, children: { done: 0, total: 2 }, idleMs: 4_000 },
  ]);
  assert.equal(view.line, 'edit · new · hijos 1/3 · sin actividad 4 s');
});
