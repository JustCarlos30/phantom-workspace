import test from 'node:test';
import assert from 'node:assert/strict';
import { phantomRunIds, summarizePhantomRun } from './phantom-run-link.mjs';

const id = 'task_12345678-1234-1234-1234-123456789abc';
const card = 'card_abcdef12-1234-1234-1234-123456789abc';
const shell = detail => ({ type: 'tool', name: 'Bash', detail });

test('enlaza agent.mjs run', () => {
  assert.deepEqual(phantomRunIds(shell(`node /tmp/agent.mjs run ${id}`)), [id]);
});
test('enlaza un bucle que espera phantom show', () => {
  assert.deepEqual(phantomRunIds(shell(`while true; do phantom show ${id}; sleep 3; done`)), [id]);
});
test('no enlaza comandos ajenos aunque su salida mencione Phantom', () => {
  assert.deepEqual(phantomRunIds({ ...shell(`echo ${id}`), output: `phantom run ${id}` }), []);
  assert.deepEqual(phantomRunIds(shell(`echo phantom run ${id}`)), []);
  assert.deepEqual(phantomRunIds(shell(`cat agent.mjs run ${id}`)), []);
});
test('deduplica IDs de detalle, entrada y salida', () => {
  assert.deepEqual(phantomRunIds({ ...shell(`phantom run ${id}`), input: { command: `phantom run ${id}` }, output: `${id} ${card} ${id}` }), [id, card]);
});
test('enlaza el ID recibido en la salida de create', () => {
  assert.deepEqual(phantomRunIds({ ...shell('phantom create --goal ejemplo'), output: { id: card } }), [card]);
});
test('acepta bind y rechaza herramientas no shell e IDs incompletos', () => {
  assert.deepEqual(phantomRunIds(shell(`node "agent.mjs" bind ${card}`)), [card]);
  assert.deepEqual(phantomRunIds({ ...shell(`phantom run ${id}`), name: 'Read' }), []);
  assert.deepEqual(phantomRunIds(shell('phantom run task_123')), []);
});
test('resume evidencia, salida, duración y actividad sin completar por el controlador', () => {
  const value = { task: { status: 'running', contract: { goal: 'Objetivo' } }, runs: [{ startedAt: '2026-11-15T00:00:00Z', phase: 'checks', evidence: { verification: [{ available: true, checks: [{ name: 'build', passed: true }, { name: 'test', passed: false }] }] } }] };
  const summary = summarizePhantomRun(value, [{ taskId: id, status: 'completed', output: `inicio\n${'x'.repeat(4100)}\nfin\n` }], id, Date.parse('2026-11-15T00:00:10Z'));
  assert.equal(summary.status, 'running');
  assert.equal(summary.live, true);
  assert.equal(summary.passed, 1);
  assert.equal(summary.total, 2);
  assert.equal(summary.checks[1].result, 'Falló');
  assert.equal(summary.duration, '10 s');
  assert.equal(summary.line, 'fin');
  assert.equal(summary.output.length, 4000);
  assert.equal(summary.phase, 'Fase nativa: checks');
  assert.equal(summarizePhantomRun({ status: 'completed' }, [], id).live, false);
  assert.equal(summarizePhantomRun({ status: 'blocked' }, [{ taskId: id, status: 'running' }], id).live, true);
});
