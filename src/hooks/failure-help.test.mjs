import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFixPrompt, checksExcerpt, failureHelp } from './failure-help.mjs';

const failed = { id: 'r1', status: 'failed', failure: 'checks', checks: { command: 'npm test', ok: false, code: 1, output: 'a\nb\nFAIL x\n' }, note: 'Checks fallidos' };

test('tests fallaron: comando, código y acción principal', () => {
  const help = failureHelp(failed, { base: 'main', hasSession: true });
  assert.equal(help.kind, 'checks');
  assert.equal(help.titulo, 'Los tests fallaron');
  assert.match(help.queOcurrio, /«npm test» terminó con código 1/);
  assert.equal(help.accionPrincipal.id, 'ask');
  assert.deepEqual(help.acciones.map(a => a.id), ['ask', 'terminal', 'retry', 'withdraw', 'session']);
});

test('tests con tiempo agotado y sin sesión', () => {
  const help = failureHelp({ ...failed, checks: { ...failed.checks, timedOut: true, durationMs: 120000 } });
  assert.equal(help.titulo, 'Los tests tardaron demasiado');
  assert.match(help.queOcurrio, /se agotó el tiempo \(2 min\)/);
  assert.equal(help.accionPrincipal.id, 'terminal');
  assert.ok(!help.acciones.some(a => a.id === 'ask' || a.id === 'session'));
});

test('conflicto con main lista archivos; resolver solo si la sesión no está viva', () => {
  const item = { id: 'r2', status: 'conflict', failure: 'conflict', conflicts: ['a.js', 'b.js', 'c.js', 'd.js'] };
  const help = failureHelp(item, { base: 'main' });
  assert.equal(help.kind, 'conflict');
  assert.match(help.queOcurrio, /a\.js, b\.js, c\.js y 1 más/);
  assert.equal(help.accionPrincipal.id, 'resolve');
  assert.ok(!failureHelp({ ...item, running: true }).acciones.some(a => a.id === 'resolve'));
});

test('rama desactualizada y sin guardar (filas de Ramas, sin cola)', () => {
  const behind = failureHelp({ name: 'x', ahead: 1, behind: 3, changeCount: 0, request: null });
  assert.equal(behind.kind, 'behind');
  assert.equal(behind.accionPrincipal.label, 'Poner al día con main');
  assert.ok(!behind.acciones.some(a => a.id === 'retry'));
  const unsaved = failureHelp({ name: 'x', ahead: 0, behind: 0, changeCount: 2, request: null });
  assert.equal(unsaved.kind, 'unsaved');
  assert.equal(unsaved.accionPrincipal.id, 'save');
});

test('devuelta por el orquestador usa el motivo; error del host usa el error', () => {
  const rejected = failureHelp({ id: 'r3', status: 'rejected', note: 'Falta documentar' });
  assert.equal(rejected.kind, 'returned');
  assert.equal(rejected.queOcurrio, 'Falta documentar');
  const error = failureHelp({ id: 'r4', status: 'queued', failure: 'error', error: 'boom' });
  assert.equal(error.kind, 'error');
  assert.equal(error.queOcurrio, 'boom');
  assert.equal(error.accionPrincipal.id, 'retry');
});

test('sin problema devuelve null', () => {
  assert.equal(failureHelp(null), null);
  assert.equal(failureHelp({ id: 'r5', status: 'queued' }), null);
  assert.equal(failureHelp({ ahead: 1, behind: 0, changeCount: 0, request: null }), null);
});

test('extracto: últimas líneas, sin colores ni líneas vacías finales', () => {
  const output = `${Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n')}\n\x1b[31mrojo\x1b[0m\n\n`;
  const excerpt = checksExcerpt(output, 40);
  assert.equal(excerpt.lines, 40);
  assert.equal(excerpt.total, 51);
  assert.equal(excerpt.truncated, true);
  assert.ok(excerpt.text.endsWith('rojo'));
  assert.equal(checksExcerpt('').text, '');
});

test('mensaje para el agente incluye comando, código, salida y archivos', () => {
  const text = agentFixPrompt(failed);
  assert.match(text, /Comando: npm test/);
  assert.match(text, /Código de salida: 1/);
  assert.match(text, /FAIL x/);
  assert.match(agentFixPrompt({ id: 'r', status: 'conflict', conflicts: ['a.js'] }), /Archivos en conflicto: a\.js/);
  assert.equal(agentFixPrompt({ id: 'r', status: 'queued' }), '');
});
