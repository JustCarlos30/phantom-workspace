import test from 'node:test';
import assert from 'node:assert/strict';
import { phantomRunIds, summarizePhantomRun, summarizePhantomActivity } from './phantom-run-link.mjs';

const id = 'task_12345678-1234-1234-1234-123456789abc';
const card = 'card_abcdef12-1234-1234-1234-123456789abc';
const shell = detail => ({ type: 'tool', name: 'Bash', detail });

test('resume modelo y contadores nativos', () => {
  const summary = summarizePhantomRun({ run: { requestedModel: 'openai/model', turns: 0, tools: 3 } });
  assert.equal(summary.model, 'openai/model');
  assert.equal(summary.turns, 0);
  assert.equal(summary.tools, 3);
});

test('actividad relativa, etiquetas, paso actual y anteriores', () => {
  const tools = ['read', 'grep', 'glob', 'list', 'edit', 'write', 'apply_patch', 'patch', 'bash', 'shell', 'webfetch', 'task', 'custom'];
  const summary = summarizePhantomActivity({ available: true, total: 20, items: tools.map((tool, id) => ({ id, tool, target: '/work/src/a', status: id === 2 || id === 4 ? 'running' : 'done' })) }, '/work');
  assert.deepEqual(summary.steps.map(step => step.label), ['Leer', 'Buscar', 'Buscar', 'Buscar', 'Editar', 'Editar', 'Editar', 'Editar', 'Ejecutar', 'Ejecutar', 'Web', 'Agente', 'custom']);
  assert.ok(summary.steps.every(step => step.detail === 'src/a'));
  assert.equal(summary.current.id, 4);
  assert.equal(summary.hidden, 7);
  assert.equal(summary.total, 20);
  assert.deepEqual(summarizePhantomActivity(null), { steps: [], total: 0, hidden: 0, current: null, runs: [], reason: null });
  assert.deepEqual(summarizePhantomActivity({ available: false, items: [{}] }).steps, []);
});

test('resume checks, verificaciones e intentos con sus motivos', () => {
  const check = { id: 'initial', tool: 'check', target: 'Pruebas', status: 'error' };
  const verify = { id: 'final', tool: 'verify', target: 'Build', status: 'running' };
  const summary = summarizePhantomActivity({ available: true, items: [verify], total: 1, reason: 'Bloqueado', runs: [
    { runId: 'a', attempt: 1, steps: [check], total: 42, reason: 'Sin pruebas' },
    { runId: 'b', attempt: 2, steps: [verify], total: 1, reason: 'Bloqueado' },
  ] });
  assert.equal(summary.reason, 'Bloqueado');
  assert.equal(summary.runs[0].steps[0].label, 'Check');
  assert.equal(summary.runs[0].hidden, 41);
  assert.equal(summary.runs[0].reason, 'Sin pruebas');
  assert.equal(summary.runs[1].steps[0].label, 'Verificar');
  assert.deepEqual(summary.current, summary.runs[1].current);
  assert.deepEqual(summary.steps, summary.runs[1].steps);
});

test('enlaza agent.mjs run', () => {
  assert.deepEqual(phantomRunIds(shell(`node /tmp/agent.mjs run ${id}`)), [id]);
});
test('enlaza el comando de bootstrap con modelo y cola de salida', () => {
  assert.deepEqual(phantomRunIds(shell(`"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" run ${id} openai/gpt-5.1-codex 2>&1 | head -20 | cut -c1-250`)), [id]);
});
test('enlaza variables de CLI con y sin intérprete para run y bind', () => {
  for (const cli of ['"$PHANTOM_AGENT_CLI"', '$PHANTOM_AGENT_CLI', '${PHANTOM_AGENT_CLI}', '"${PHANTOM_AGENT_CLI}"']) {
    for (const node of ['', '"$PHANTOM_AGENT_NODE" ', '${PHANTOM_AGENT_NODE} ', 'node ']) {
      for (const action of ['run', 'bind']) {
        assert.deepEqual(phantomRunIds(shell(`${node}${cli} ${action} ${id}`)), [id], `${node}${cli} ${action}`);
      }
    }
  }
});
test('enlaza phantom card', () => {
  assert.deepEqual(phantomRunIds(shell(`phantom card ${card}`)), [card]);
});
test('enlaza un bucle que espera phantom show', () => {
  assert.deepEqual(phantomRunIds(shell(`while true; do phantom show ${id}; sleep 3; done`)), [id]);
});
test('no enlaza comandos ajenos aunque su salida mencione Phantom', () => {
  assert.deepEqual(phantomRunIds({ ...shell(`echo ${id}`), output: `phantom run ${id}` }), []);
  assert.deepEqual(phantomRunIds(shell(`echo phantom run ${id}`)), []);
  assert.deepEqual(phantomRunIds(shell(`cat agent.mjs run ${id}`)), []);
  assert.deepEqual(phantomRunIds(shell(`echo "$PHANTOM_AGENT_CLI" run ${id}`)), []);
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
