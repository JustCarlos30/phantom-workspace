import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgressView, formatDuration } from './run-progress-view.mjs';

const T0 = Date.parse('2026-11-23T12:00:00Z');
const base = { taskId: 't1', phase: 'agent', activity: 'edit · src/x.css', startedAt: '2026-11-23T12:00:00Z', lastEventAt: '2026-11-23T12:00:10Z', elapsedMs: 10_000, idleMs: 0, round: 0, children: { done: 0, total: 0, items: [] }, stalled: false, looping: false, log: [], blocker: null, observedAt: '2026-11-23T12:00:10Z' };

test('sin run no hay vista', () => {
  assert.equal(runProgressView(null), null);
  assert.equal(runProgressView(undefined, T0), null);
});

test('etiquetas y tonos por fase', () => {
  const cases = { waiting: ['Esperando eventos', 'idle'], agent: ['Agente trabajando', 'working'], checks: ['Ejecutando checks', 'working'], judge: ['Juez revisando', 'working'], children: ['Hijos', 'working'], completed: ['Terminado', 'review'], blocked: ['Bloqueado', 'error'], cancelled: ['Cancelado', 'idle'] };
  for (const [phase, [label, tone]] of Object.entries(cases)) {
    const view = runProgressView({ ...base, phase }, T0 + 20_000);
    assert.equal(view.label, label, phase);
    assert.equal(view.tone, tone, phase);
  }
  assert.equal(runProgressView({ ...base, phase: 'repair', round: 2 }, T0).label, 'Reparación 2');
});

test('el reloj avanza desde startedAt y lastEventAt', () => {
  const a = runProgressView(base, T0 + 30_000), b = runProgressView(base, T0 + 70_000);
  assert.equal(a.elapsed, '30 s');
  assert.equal(a.idle, '20 s');
  assert.equal(b.elapsed, '1 min 10 s');
  assert.equal(b.idle, '1 min');
});

test('sin eventos todavía no inventa inactividad', () => {
  const view = runProgressView({ ...base, phase: 'waiting', lastEventAt: null, idleMs: 0 }, T0 + 5_000);
  assert.equal(view.idle, '');
  assert.equal(view.idleMs, null);
});

test('al terminar el reloj se congela y no avisa de atoro', () => {
  const view = runProgressView({ ...base, phase: 'completed', elapsedMs: 90_000, stalled: true }, T0 + 9_999_000);
  assert.equal(view.elapsed, '1 min 30 s');
  assert.equal(view.idle, '');
  assert.equal(view.warning, '');
  assert.equal(view.terminal, true);
});

test('avisa de atoro y de bucle (bucle prevalece)', () => {
  assert.equal(runProgressView({ ...base, stalled: true }, T0).level, 'warn');
  const view = runProgressView({ ...base, stalled: true, looping: true }, T0);
  assert.equal(view.level, 'alert');
  assert.equal(view.warning, 'Posible bucle de actividad');
});

test('hijos y log', () => {
  const log = Array.from({ length: 25 }, (_, i) => ({ at: '2026-11-23T12:01:00Z', text: `línea ${i}` }));
  const view = runProgressView({ ...base, phase: 'children', children: { done: 1, total: 2, items: [{ key: 'ui', status: 'done', activity: '' }, { key: 'host', status: 'running', activity: 'check tests' }] }, log }, T0);
  assert.deepEqual(view.children.items.map(i => [i.key, i.statusLabel, i.activity]), [['ui', 'Listo', ''], ['host', 'En curso', 'check tests']]);
  assert.equal(view.children.total, 2);
  assert.equal(view.lines.length, 20);
  assert.equal(view.lines.at(-1).text, 'línea 24');
});

test('bloqueo ask_user por presupuesto ofrece ampliar', () => {
  const blocker = { category: 'budget', autonomy: 'ask_user', summary: 'Sin tokens', remedy: 'Amplía el presupuesto', commands: ['phantom amend t1'], retryAt: '2026-11-23T13:00:00Z' };
  const view = runProgressView({ ...base, phase: 'blocked', blocker }, T0);
  assert.equal(view.tone, 'error');
  assert.equal(view.blocker.title, 'Presupuesto agotado');
  assert.deepEqual(view.blocker.action, { id: 'amend', label: 'Ampliar presupuesto' });
  assert.deepEqual(view.blocker.commands, ['phantom amend t1']);
  assert.ok(view.blocker.retryAt);
});

test('bloqueo humano o de otra categoría no ofrece botón', () => {
  const human = runProgressView({ ...base, phase: 'blocked', blocker: { category: 'budget', autonomy: 'human', summary: 's', remedy: 'r', commands: [] } }, T0);
  const other = runProgressView({ ...base, phase: 'blocked', blocker: { category: 'rate_limit', autonomy: 'ask_user', summary: 's', remedy: 'r', commands: [], retryAt: 'no-fecha' } }, T0);
  assert.equal(human.blocker.action, null);
  assert.equal(other.blocker.action, null);
  assert.equal(other.blocker.retryAt, '');
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0 s');
  assert.equal(formatDuration(3_660_000), '1 h 1 min');
});
