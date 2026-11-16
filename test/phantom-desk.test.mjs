import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesk, changedStatuses, statusMap, zoneOf, lastLine, budgetText, duration, relative, runsOf, argvText } from '../src/hooks/phantom-desk.mjs';

const task = (id, status, goal, extra = {}) => ({ id, title: goal, status, kind: 'card', raw: { id, status, contract: { goal, scope: ['src/a.js'], dependencies: [] }, updatedAt: '2026-11-11T10:00:00Z', ...extra } });

test('desk zones follow native status and controllers', () => {
  assert.equal(zoneOf('blocked'), 'decide');
  assert.equal(zoneOf('verifying'), 'live');
  assert.equal(zoneOf('ready', 'running'), 'live');
  assert.equal(zoneOf('completed'), 'queue');
  const items = [task('t1', 'ready', 'Lista'), task('t2', 'blocked', 'Bloqueada', { reason: 'Falta decisión' }), task('t3', 'running', 'Corre'), task('t4', 'completed', 'Hecha'), task('t5', 'ready', 'Con controlador')];
  const desk = buildDesk(items, [{ id: 'c1', taskId: 't5', status: 'running', output: 'uno\n\x1b[32mdos\x1b[0m\n' }]);
  assert.deepEqual(desk.zones.decide.map(card => card.id), ['t2']);
  assert.equal(desk.zones.decide[0].reason, 'Falta decisión');
  assert.deepEqual(desk.zones.live.map(card => card.id).sort(), ['t3', 't5']);
  assert.deepEqual(desk.zones.queue.map(card => card.id), ['t1', 't4']);
  assert.equal(lastLine(desk.zones.live.find(card => card.id === 't5').controller.output), 'dos');
  assert.equal(buildDesk(items, [], 'src/a.js').total, 5);
  assert.equal(buildDesk(items, [], 'corre').total, 1);
});

test('status changes are news only after the first observation', () => {
  const first = [task('t1', 'ready', 'A'), task('t2', 'running', 'B')];
  assert.deepEqual(changedStatuses(null, first), []);
  const second = [task('t1', 'ready', 'A'), task('t2', 'blocked', 'B'), task('t3', 'ready', 'C')];
  assert.deepEqual(changedStatuses(statusMap(first), second), ['t2']);
});

test('formatters stay honest about missing data', () => {
  assert.equal(budgetText({ timeoutMs: 1500000, maxTurns: 40 }), '25 min · 40 turnos');
  assert.equal(budgetText(null), '');
  assert.equal(duration('2026-01-01T00:00:00Z', '2026-01-01T00:18:40Z'), '18 min 40 s');
  assert.equal(duration(null), '');
  assert.equal(relative('nope'), '');
  assert.equal(relative(new Date(Date.now() - 3 * 3600e3).toISOString()), 'hace 3 h');
  assert.equal(argvText(['node', '--test', 'a b.mjs']), 'node --test "a b.mjs"');
  assert.deepEqual(runsOf({ run: { id: 'r1' } }).map(run => run.id), ['r1']);
  assert.deepEqual(runsOf({ runs: [{ id: 'a' }, { id: 'b' }] }).map(run => run.id), ['b', 'a']);
});

import { parseCommand, commandOf, budgetFieldsOf, budgetJsonOf } from '../src/hooks/phantom-desk.mjs';
import { checkResult, eventLabel, eventDetails, phaseOf } from '../src/hooks/phantom-desk.mjs';
test('execution evidence never turns declarations or missing artifacts into success', () => {
  assert.equal(checkResult({}), 'Desconocido');
  assert.equal(checkResult({ passed: true }), 'Pasó');
  assert.equal(checkResult({ passed: false }), 'Falló');
  assert.equal(checkResult({ executed: false, passed: true }), 'No ejecutada');
  const native = { status: 'cancelled', reason: 'Cancelación explícita', run: { id: 'r', status: 'failed', reason: 'Baseline voice-desktop falló', evidence: { baseline: { available: true, checks: [{ name: 'voice-desktop', passed: false }] } } } };
  assert.equal(runsOf(native)[0].reason, 'Baseline voice-desktop falló');
  assert.equal(native.reason, 'Cancelación explícita');
  assert.match(phaseOf(native), /iniciales del worktree/);
  assert.match(phaseOf({ contract: { checks: [{ name: 'build' }] } }), /no disponible/);
  assert.equal(eventLabel('task.cancelled'), 'Tarea cancelada');
  assert.equal(eventLabel('native.unknown'), 'native.unknown');
  assert.match(eventDetails({ data: { reason: 'Fallo real' } }), /Fallo real/);
  assert.match(eventDetails({ data: { base: 'x'.repeat(70000) } }), /recortados explícitamente/);
  const argv = ['node', '-e', 'console.log("a");'.repeat(1000), ''];
  assert.deepEqual(parseCommand(argvText(argv)), argv);
});
test('command lines become argv without a shell', () => {
  assert.deepEqual(parseCommand('node --test "test/con espacios.test.mjs" \'$HOME; echo literal\''), ['node', '--test', 'test/con espacios.test.mjs', '$HOME; echo literal']);
  assert.deepEqual(parseCommand('["npm","test"]'), ['npm', 'test']);
  assert.deepEqual(parseCommand('echo ""'), ['echo', '']);
  assert.throws(() => parseCommand('echo "abierto'), /comilla/);
  const argv = ['node', '--test', 'a b.mjs'];
  assert.deepEqual(parseCommand(commandOf(JSON.stringify(argv))), argv);
});
test('budget fields round-trip and keep unknown keys', () => {
  const fields = budgetFieldsOf('{"timeoutMs":1500000,"maxTurns":40,"custom":1}');
  assert.equal(fields.timeoutMin, '25');
  assert.equal(fields.maxTurns, '40');
  assert.deepEqual(JSON.parse(budgetJsonOf({ ...fields, maxRepairs: '0' })), { custom: 1, timeoutMs: 1500000, maxTurns: 40, maxRepairs: 0 });
  assert.equal(budgetJsonOf(budgetFieldsOf('')), '');
  assert.throws(() => budgetJsonOf({ timeoutMin: '-1' }), /positivos/);
});
