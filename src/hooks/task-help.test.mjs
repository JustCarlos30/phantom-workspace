import test from 'node:test';
import assert from 'node:assert/strict';
import { taskHelp, failedChecks } from './task-help.mjs';

const all = { run: true, cancel: true, verify: true, recover: true };

test('solo failed y blocked necesitan ayuda', () => {
  for (const status of ['ready', 'running', 'completed']) assert.equal(taskHelp({ status, actions: all }), null);
});

test('failed: Reintentar es el botón principal y hay reemplazo', () => {
  const help = taskHelp({ status: 'failed', actions: { run: true, cancel: true } });
  assert.equal(help.kind, 'failed');
  assert.equal(help.accionPrincipal.id, 'run');
  assert.deepEqual(help.acciones.map(a => a.id), ['run', 'cancel', 'replace']);
});

test('presupuesto, permiso y controlador caído se reconocen por el motivo', () => {
  assert.equal(taskHelp({ status: 'blocked', reason: 'Agotó maxTurns', actions: all }).kind, 'budget');
  assert.equal(taskHelp({ status: 'blocked', reason: 'Permission denied for Bash', actions: all, hasSession: true }).accionPrincipal.id, 'session');
  const lost = taskHelp({ status: 'blocked', controller: { status: 'lost' }, actions: all });
  assert.equal(lost.kind, 'controller'); assert.equal(lost.accionPrincipal.id, 'recover');
});

test('sin acciones admitidas no hay botón principal inventado', () => {
  assert.equal(taskHelp({ status: 'failed', actions: {} }).accionPrincipal.id, 'replace');
  assert.equal(taskHelp({ status: 'blocked', actions: {} }).accionPrincipal, null);
});

test('verificación: checks fallidos con su salida', () => {
  const runs = [{ evidence: { verification: [{ round: 1, available: true, checks: [{ name: 'tests', passed: false, argv: ['npm', 'test'], exitCode: 1, stdout: 'a\nb' }, { name: 'ok', passed: true }] }] } }];
  const checks = failedChecks(runs);
  assert.equal(checks.length, 1);
  assert.match(checks[0].summary, /npm test/);
  assert.equal(checks[0].excerpt.text, 'a\nb');
  const help = taskHelp({ status: 'blocked', runs, actions: all });
  assert.equal(help.kind, 'verification'); assert.equal(help.accionPrincipal.id, 'verify');
});
