import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesk, changedStatuses, statusMap, zoneOf, lastLine, budgetText, duration, relative, runsOf, argvText } from '../src/hooks/phantom-desk.mjs';

const task = (id, status, goal, extra = {}) => ({ id, title: goal, status, kind: 'card', raw: { id, status, contract: { goal, scope: ['src/a.js'], dependencies: [] }, updatedAt: '2026-11-11T10:00:00Z', ...extra } });

test('desk zones follow native status and controllers', () => {
  assert.equal(zoneOf('blocked'), 'decide');
  assert.equal(zoneOf('verifying'), 'live');
  assert.equal(zoneOf('ready', 'running'), 'live');
  assert.equal(zoneOf('completed'), 'history');
  assert.equal(zoneOf('ready'), 'queue');
  assert.equal(zoneOf('blocked', undefined, true), 'resolved');
  const items = [task('t1', 'ready', 'Lista'), task('t2', 'blocked', 'Bloqueada', { reason: 'Falta decisión' }), task('t3', 'running', 'Corre'), task('t4', 'completed', 'Hecha'), task('t5', 'ready', 'Con controlador'), task('t6', 'cancelled', 'Cancelada'), task('t7', 'mystery', 'Rara')];
  const desk = buildDesk(items, [{ id: 'c1', taskId: 't5', status: 'running', output: 'uno\n\x1b[32mdos\x1b[0m\n' }]);
  assert.deepEqual(desk.zones.decide.map(card => card.id), ['t2']);
  assert.equal(desk.zones.decide[0].reason, 'Falta decisión');
  assert.deepEqual(desk.zones.live.map(card => card.id).sort(), ['t3', 't5']);
  assert.deepEqual(desk.zones.queue.map(card => card.id), ['t1', 't7']);
  assert.deepEqual(desk.zones.history.map(card => card.id).sort(), ['t4', 't6']);
  assert.equal(lastLine(desk.zones.live.find(card => card.id === 't5').controller.output), 'dos');
  assert.equal(buildDesk(items, [], 'src/a.js').total, 7);
  assert.equal(buildDesk(items, [], 'corre').total, 1);
});

test('failed va a «Espera tu decisión», la más reciente primero', () => {
  assert.equal(zoneOf('failed'), 'decide');
  const desk = buildDesk([task('n', 'failed', 'Nueva', { updatedAt: '2026-11-12T10:00:00Z' }), task('b', 'blocked', 'Vieja', { updatedAt: '2026-11-10T10:00:00Z' }), task('o', 'failed', 'Media', { updatedAt: '2026-11-11T10:00:00Z' })]);
  assert.deepEqual(desk.zones.decide.map(card => card.id), ['n', 'o', 'b']);
});

import { titleOf, sectionsOf, explainReason, resolutionOf, runSummary, groupByCause, tailOf } from '../src/hooks/phantom-desk.mjs';
test('titles and sections read plain goals and contract markdown', () => {
  const goal = '## Título\nRediseñar las Cards\n\n## Propósito\nMenos texto técnico.\nMás claro.';
  assert.equal(titleOf(goal), 'Rediseñar las Cards');
  assert.equal(titleOf('Arreglar el login. Luego documentar.'), 'Arreglar el login.');
  assert.equal(titleOf('x'.repeat(200)).length, 90);
  assert.equal(titleOf(''), '');
  assert.deepEqual(sectionsOf(goal), [{ heading: 'Título', body: 'Rediseñar las Cards' }, { heading: 'Propósito', body: 'Menos texto técnico.\nMás claro.' }]);
  assert.deepEqual(sectionsOf('Solo texto'), [{ heading: '', body: 'Solo texto' }]);
});
test('native reasons become plain causes, including child prefixes', () => {
  assert.equal(explainReason('Verificación fallida; margen de reparación agotado').label, 'Tests en rojo');
  assert.match(explainReason('Verificación fallida').next, /Abre Verificación/);
  assert.equal(explainReason('No hay un cambio atribuible que satisfaga el encargo').label, 'El agente no hizo cambios');
  assert.equal(explainReason('claude_code_refused: Presupuesto de tokens agotado').cause, 'budget');
  assert.equal(explainReason('El motor reportó un error: Presupuesto de tiempo agotado').label, 'Se quedó sin tiempo/tokens');
  assert.equal(explainReason('OpenCode x fetch failed').cause, 'engine');
  assert.equal(explainReason('claude-x model is not supported').cause, 'engine');
  const child = explainReason('Hijo ui: Hay una regresión previa al cambio');
  assert.equal(child.cause, 'baseline'); assert.equal(child.child, 'ui');
  for (const [reason, cause] of [['Los checks modificaron el artefacto', 'checks-mutate'], ['Las comprobaciones iniciales modificaron el workspace', 'baseline-dirty'], ['Snapshot no soporta directorios', 'snapshot'], ['EISDIR: illegal operation', 'snapshot'], ['git_dirty', 'git-dirty'], ['judge_rejected: no', 'judge'], ['Workspace desaparecido', 'workspace-gone'], ['Cambio fuera del mandato: a.js', 'out-of-scope'], ['Las comprobaciones no acreditan pruebas suficientes', 'weak-checks']]) assert.equal(explainReason(reason).cause, cause, reason);
  const other = explainReason('Algo raro'); assert.equal(other.cause, 'other'); assert.equal(other.meaning, 'Algo raro');
  assert.equal(explainReason('').cause, 'other');
  const groups = groupByCause([{ reason: 'Verificación fallida' }, { reason: 'git_dirty' }, { reason: 'Verificación fallida' }]);
  assert.deepEqual(groups.map(group => [group.label, group.cards.length]), [['Tests en rojo', 2], ['Hay cambios sin guardar', 1]]);
});
test('blocked cards resolved elsewhere leave the decision zone', () => {
  assert.equal(resolutionOf({ resolution: { supersededBy: { id: 'b', status: 'completed' }, landed: 0 } }), 'superseded');
  assert.equal(resolutionOf({ resolution: { supersededBy: null, landed: 3 } }), 'landed');
  assert.equal(resolutionOf({ resolution: { supersededBy: null, landed: 0 } }), null);
  assert.equal(resolutionOf({}), null);
  const items = [
    { ...task('a', 'blocked', 'Vieja', { reason: 'git_dirty' }), resolution: { supersededBy: { id: 'b', status: 'completed' }, landed: 0 } },
    task('b', 'completed', 'Nueva versión'),
    { ...task('c', 'blocked', 'Con commits'), resolution: { supersededBy: null, landed: 2 } },
    { ...task('d', 'blocked', 'Pendiente'), resolution: { supersededBy: null, landed: 0 } },
  ];
  const desk = buildDesk(items);
  assert.deepEqual(desk.zones.decide.map(card => card.id), ['d']);
  assert.deepEqual(desk.zones.resolved.map(card => card.id).sort(), ['a', 'c']);
  assert.equal(desk.cards.find(card => card.id === 'a').resolutionText, 'Sustituida por Nueva versión · Completada');
  assert.equal(desk.cards.find(card => card.id === 'c').resolutionText, 'Sus archivos cambiaron en main después · 2 commits');
});
test('run summary counts files, lines, checks and attempts honestly', () => {
  assert.deepEqual(runSummary(null), { files: 0, added: 0, removed: 0, checksPassed: 0, checksTotal: 0, attempts: 0 });
  const run = { summary: { files: [{ path: 'a', added: 3, removed: 1 }, { path: 'b', added: 2, removed: 0 }] }, evidence: { verification: [{ round: 1, available: true, checks: [{ passed: false }] }, { round: 2, available: true, checks: [{ passed: true }, { passed: false }] }, { round: 3, available: false }] } };
  assert.deepEqual(runSummary(run), { files: 2, added: 5, removed: 1, checksPassed: 1, checksTotal: 2, attempts: 3 });
  assert.equal(tailOf('a\nb\nc\n', 2), 'b\nc');
  assert.equal(tailOf(null), '');
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

import { humanTitleOf, briefOf, failedCheckOf, storyOf } from '../src/hooks/phantom-desk.mjs';
test('humanTitleOf prefers the Título section and strips agent jargon', () => {
  assert.equal(humanTitleOf('## Título\nCards que se entienden\n\n## Propósito\nx'), 'Cards que se entienden');
  assert.equal(humanTitleOf('BUG: Implementar el login con Google (decisión 2026-11-26). Más detalle.'), 'El login con Google');
  assert.equal(humanTitleOf('Sustituye task_abc123 con un arreglo del menú. Resto.'), 'Con un arreglo del menú');
  const long = humanTitleOf('Arreglar ' + 'una cosa muy larga '.repeat(10));
  assert.ok(long.length <= 70 && long.endsWith('…'));
  assert.equal(humanTitleOf(''), '');
});
test('briefOf prefers human sections and drops ids and long paths', () => {
  assert.equal(briefOf('## Título\nT\n\n## Para el usuario\nVes qué hace cada tarea. Y por qué se atoró.\n\n## Otra\nz'), 'Ves qué hace cada tarea. Y por qué se atoró.');
  assert.equal(briefOf('## Propósito / resultado observable\nLa mesa explica los bloqueos con task_abc123 en src/a/b/c.js claros.'), 'La mesa explica los bloqueos con en claros.');
  assert.equal(briefOf('Arreglar el login. Debe recordar la sesión. Y otra cosa.'), 'Debe recordar la sesión. Y otra cosa.');
  assert.ok(briefOf('Titulo. ' + 'palabra '.repeat(100)).length <= 220);
  assert.equal(briefOf(''), '');
});
test('failedCheckOf finds the real failing check and ignores stack frames', () => {
  const run = { evidence: { verification: [
    { round: 1, available: true, checks: [{ name: 'viejo', passed: false, stderr: 'x' }] },
    { round: 2, available: true, checks: [{ name: 'ok', passed: true }, { name: 'unit', passed: false, stderr: '\nError: boom\n  at foo (a.js:1)\n  at bar (b.js:2)\n\n' }] }] } };
  assert.deepEqual(failedCheckOf(run), { name: 'unit', line: 'Error: boom' });
  assert.deepEqual(failedCheckOf({ evidence: { baseline: { available: true, checks: [{ name: 'base', passed: false, reason: 'Salida 1' }] } } }), { name: 'base', line: 'Salida 1' });
  assert.equal(failedCheckOf({ evidence: { verification: [{ available: true, checks: [{ name: 'a', passed: true }] }] } }), null);
  assert.equal(failedCheckOf(null), null);
});
test('storyOf explains blocks with the real check, the agent message, or plain status', () => {
  const run = { evidence: { verification: [{ available: true, checks: [{ name: 'unit', passed: false, stdout: 'not ok 3 - parse' }] }] } };
  const verification = storyOf({ status: 'blocked', reason: 'Verificación fallida', run });
  assert.equal(verification.why, 'Falló «unit»: not ok 3 - parse');
  assert.equal(verification.current, 2); assert.equal(verification.failed, true); assert.equal(verification.tone, 'blocked');
  const other = storyOf({ status: 'blocked', reason: 'Algo raro interno', message: 'Me falta permiso para escribir en config.json. Detalle largo.' });
  assert.equal(other.why, 'Me falta permiso para escribir en config.json.');
  assert.equal(storyOf({ status: 'blocked', reason: 'Algo raro' }).why, 'Algo raro');
});
test('storyOf keeps completed and running stories short and coherent', () => {
  const done = storyOf({ status: 'completed' });
  assert.equal(done.current, 3); assert.equal(done.failed, false); assert.equal(done.tone, 'done');
  const running = storyOf({ status: 'running' });
  assert.equal(running.current, 1); assert.equal(running.tone, 'live'); assert.deepEqual(running.steps, ['Preparada', 'Trabajando', 'Verificando', 'Lista']);
});
test('buildDesk adds brief and why without dropping existing fields', () => {
  const desk = buildDesk([task('b1', 'blocked', '## Título\nArreglar menú\n\n## Para el usuario\nEl menú abre bien.', { reason: 'git_dirty' }), task('r1', 'running', 'Corre. Algo más.')]);
  const blocked = desk.cards.find(card => card.id === 'b1'), running = desk.cards.find(card => card.id === 'r1');
  assert.equal(blocked.title, 'Arreglar menú');
  assert.equal(blocked.brief, 'El menú abre bien.');
  assert.match(blocked.why, /cambios sin confirmar/);
  assert.equal(blocked.explain.cause, 'git-dirty'); assert.equal(blocked.zone, 'decide');
  assert.equal(running.why, '');
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
