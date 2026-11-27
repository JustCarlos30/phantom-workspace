import test from 'node:test';
import assert from 'node:assert/strict';
import { phantomRunIds, summarizePhantomRun, summarizePhantomActivity, turnRunIds, linkedRunBadge, phantomCallKind, phantomCallSummary, PHANTOM_CALL_LABEL } from './phantom-run-link.mjs';

const id = 'task_12345678-1234-1234-1234-123456789abc';
const card = 'card_abcdef12-1234-1234-1234-123456789abc';
const shell = detail => ({ type: 'tool', name: 'Bash', detail });

test('phantomCallSummary resume acciones sin exponer variables de entorno', () => {
  const cmd = '"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" context; phantom list --works';
  const summary = phantomCallSummary(shell(cmd));
  assert.equal(summary, 'context · list');
  assert.doesNotMatch(summary, /PHANTOM_AGENT/);
});

test('phantomCallSummary abrevia el ID a 13 caracteres', () => {
  assert.equal(phantomCallSummary(shell(`node agent.mjs run ${id}`)), 'run task_12345678');
  assert.equal(phantomCallSummary(shell(`"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" bind ${card}`)), 'bind card_abcdef12');
});

test('phantomCallSummary nombra el archivo y lee llamadas estructuradas', () => {
  assert.equal(phantomCallSummary(shell('phantom create --file docs/contrato.json')), 'create contrato.json');
  assert.equal(phantomCallSummary({ type: 'tool', name: 'phantom_workspace.phantom', input: { cli: 'agent', args: ['run', id] } }), 'run task_12345678');
});

test('phantomCallSummary devuelve vacío si no es una llamada Phantom', () => {
  assert.equal(phantomCallSummary(shell('ls -la')), '');
  assert.equal(phantomCallSummary({ type: 'text', text: 'hola' }), '');
  assert.equal(phantomCallSummary(undefined), '');
});

test('turnRunIds une ids sin duplicar y conserva el orden', () => {
  const parts = [shell(`node agent.mjs run ${id}`), { type: 'text', text: id }, shell(`node agent.mjs bind ${card}`), shell(`node agent.mjs show ${id}`)];
  assert.deepEqual(turnRunIds(parts), [id, card]);
  assert.deepEqual(turnRunIds([]), []);
  assert.deepEqual(turnRunIds(undefined), []);
});

test('linkedRunBadge mapea el estado real con tiempo transcurrido', () => {
  const now = Date.parse('2026-01-01T00:05:00Z'), start = '2026-01-01T00:02:30Z';
  assert.deepEqual(linkedRunBadge('running', start, now), { label: 'En ejecución', tone: 'live', elapsed: '2 min 30 s' });
  assert.equal(linkedRunBadge('review', start, now).label, 'En revisión');
  assert.equal(linkedRunBadge('blocked', start, now).label, 'Bloqueada');
  assert.equal(linkedRunBadge('failed', start, now).label, 'Fallida');
  assert.equal(linkedRunBadge('completed', start, now), null);
});

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

const mcp = (input, name = 'mcp__phantom_workspace__phantom') => ({ type: 'tool', name, detail: 'phantom', input });
test('enlaza run y bind del MCP estructurado con cualquier prefijo de herramienta', () => {
  for (const name of ['mcp__phantom_workspace__phantom', 'phantom_workspace.phantom', 'phantom_workspace_phantom', 'Phantom_Workspace:phantom']) {
    for (const action of ['run', 'bind']) {
      assert.deepEqual(phantomRunIds(mcp({ cli: 'agent', args: [action, id, 'openai/model'] }, name)), [id], `${name} ${action}`);
    }
  }
  assert.deepEqual(phantomRunIds(mcp(JSON.stringify({ cli: 'agent', args: ['bind', card] }))), [card]);
});
test('MCP estructurado valida acción, ID completo y forma; ignora la salida', () => {
  for (const input of [{ cli: 'agent', args: ['show', id] }, { cli: 'agent', args: ['run', 'task_123'] }, { cli: 'agent', args: ['run', `${id}x`] }, { cli: 'agent', args: ['run'] }, { cli: 'agent', args: ['run', 7] }, { cli: 'phantom', args: ['run', id] }, { args: ['run', id] }, { cli: 'agent', args: `run ${id}` }, 'no es json', null, undefined]) {
    assert.deepEqual(phantomRunIds({ ...mcp(input), output: `${id} ${card}` }), [], JSON.stringify(input));
  }
  assert.deepEqual(phantomRunIds(mcp({ cli: 'agent', args: ['run', id] }, 'mcp__otro__phantom')), []);
  assert.deepEqual(phantomRunIds({ ...mcp({ cli: 'agent', args: ['run', id] }), type: 'text' }), []);
});
test('phantomCallKind distingue encargo, vínculo y consulta sin llamar subagente a nada', () => {
  assert.equal(phantomCallKind(mcp({ cli: 'agent', args: ['run', id] })), 'assignment');
  assert.equal(phantomCallKind(mcp({ cli: 'agent', args: ['bind', id] })), 'bind');
  assert.equal(phantomCallKind(mcp({ cli: 'agent', args: ['run', 'x'] })), 'assignment');
  assert.equal(phantomCallKind(mcp({ cli: 'phantom', args: ['show', id] })), 'query');
  assert.equal(phantomCallKind(mcp(undefined)), 'query');
  assert.equal(phantomCallKind({ type: 'tool', name: 'phantom.list', input: {} }), 'query');
  assert.equal(phantomCallKind(shell(`phantom show ${id}`)), 'query');
  assert.equal(phantomCallKind(shell(`phantom run ${id}`)), 'assignment');
  assert.equal(phantomCallKind(shell('phantom create --goal x')), 'create');
  assert.equal(phantomCallKind(shell(`node agent.mjs bind ${card}`)), 'bind');
  assert.equal(phantomCallKind(shell('echo hola')), null);
  assert.equal(phantomCallKind({ type: 'tool', name: 'Task', agent: { type: 'Explore' } }), null);
  assert.equal(phantomCallKind(null), null);
  assert.equal(PHANTOM_CALL_LABEL.query, 'Consulta a Phantom');
  assert.notEqual(PHANTOM_CALL_LABEL.assignment, PHANTOM_CALL_LABEL.query);
});
test('turnRunIds suma ids del MCP y de shells sin duplicar y sin buscar en la salida', () => {
  const parts = [mcp({ cli: 'agent', args: ['bind', card] }), shell(`node agent.mjs run ${id}`), { ...mcp({ cli: 'agent', args: ['run', id] }), output: `otro ${card} task_ffffffff-1234-1234-1234-123456789abc` }];
  assert.deepEqual(turnRunIds(parts), [card, id]);
});
test('el MCP estructurado no sustituye los alias de shell ni los ids literales del detalle', () => {
  assert.deepEqual(phantomRunIds({ ...mcp({ cli: 'agent', args: ['run', id] }), detail: `phantom run ${card}` }), [id]);
  assert.deepEqual(phantomRunIds(shell(`C="$PHANTOM_AGENT_CLI"; "$C" bind ${card}`)), [card]);
});

test('phantomCallKind clasifica el MCP estructurado con cualquier prefijo y separador', () => {
  for (const name of ['mcp__phantom_workspace__phantom', 'mcp.phantom_workspace.phantom', 'phantom_workspace:phantom', 'Phantom_Workspace__Phantom']) {
    assert.equal(phantomCallKind(mcp({ cli: 'agent', args: ['run', id] }, name)), 'assignment', name);
    assert.equal(phantomCallKind(mcp({ cli: 'agent', args: ['bind', card] }, name)), 'bind', name);
    assert.equal(phantomCallKind(mcp({ cli: 'agent', args: ['show', id] }, name)), 'query', name);
  }
});

test('phantomCallKind: un vínculo con ID incompleto sigue siendo vínculo pero no enlaza ninguna ejecución', () => {
  const part = mcp({ cli: 'agent', args: ['bind', 'card_123'] });
  assert.equal(phantomCallKind(part), 'bind');
  assert.deepEqual(phantomRunIds(part), []);
  const extra = mcp({ cli: 'agent', args: ['run', id, 'openai/model', '--flag'] });
  assert.equal(phantomCallKind(extra), 'assignment');
  assert.deepEqual(phantomRunIds(extra), [id]);
});

test('phantomCallKind: una entrada malformada es una consulta, nunca un encargo ni un subagente', () => {
  for (const input of ['no es json', null, undefined, 7, { cli: 'agent', args: ['run', 7] }, { cli: 'agent', args: 'run' }, { cli: 'otro', args: ['run', id] }]) {
    assert.equal(phantomCallKind(mcp(input)), 'query', JSON.stringify(input));
    assert.deepEqual(phantomRunIds(mcp(input)), [], JSON.stringify(input));
  }
  assert.equal(phantomCallKind({ ...mcp({ cli: 'agent', args: ['run', id] }), type: 'text' }), null);
  assert.equal(phantomCallKind({ type: 'tool', name: 'Task', agent: { type: 'Explore' } }), null);
});

test('phantomCallKind: otras herramientas de Phantom son consultas y no enlazan ejecuciones', () => {
  const traces = { type: 'tool', name: 'mcp__phantom_workspace__traces', input: { id: 'toolu_A1' }, output: id };
  assert.equal(phantomCallKind(traces), 'query');
  assert.deepEqual(phantomRunIds(traces), []);
  assert.equal(phantomCallKind({ type: 'tool', name: 'Read', input: { file_path: 'a.txt' } }), null);
  assert.equal(new Set(Object.values(PHANTOM_CALL_LABEL)).size, 4);
  for (const kind of ['assignment', 'create', 'bind', 'query']) assert.ok(PHANTOM_CALL_LABEL[kind]);
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
test('enlaza alias de node y CLI con run desde la entrada completa', () => {
  const command = `A="$PHANTOM_AGENT_NODE"; C="$PHANTOM_AGENT_CLI"; "$A" "$C" run ${id}`;
  assert.deepEqual(phantomRunIds({ ...shell(command.slice(0, 30)), input: { command } }), [id]);
  assert.deepEqual(phantomRunIds({ ...shell(command.slice(0, 30)), input: command }), [id]);
});
test('enlaza alias de CLI con bind', () => {
  assert.deepEqual(phantomRunIds(shell(`C="\${PHANTOM_AGENT_CLI}"; "$C" bind ${card}`)), [card]);
  assert.deepEqual(phantomRunIds(shell(`A=$PHANTOM_AGENT_NODE; C=$PHANTOM_AGENT_CLI; "\${A}" "\${C}" bind ${card}`)), [card]);
});
test('no enlaza echo ni cat con alias', () => {
  for (const command of ['echo', 'cat']) {
    assert.deepEqual(phantomRunIds(shell(`A="$PHANTOM_AGENT_NODE"; C="$PHANTOM_AGENT_CLI"; ${command} "$A" "$C" run ${id}`)), []);
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
test('deduplica IDs literales y no toma otros encargos de la salida de run', () => {
  assert.deepEqual(phantomRunIds({ ...shell(`phantom run ${id}`), input: { command: `phantom run ${id}` }, output: `${id} ${card} ${id}` }), [id]);
});
test('phantom list con show --help no produce ids', () => {
  assert.deepEqual(phantomRunIds({ ...shell('phantom list --json | head; phantom show --help'), output: `${id}\n${card}` }), []);
});
test('show con ID literal produce solo ese id', () => {
  assert.deepEqual(phantomRunIds({ ...shell(`phantom show ${id}`), output: `${card} ${id}` }), [id]);
});
test('create toma el id de la salida', () => {
  assert.deepEqual(phantomRunIds({ ...shell('phantom create --goal x'), output: `creada ${card}` }), [card]);
});
test('show "$ID" toma solo el primer id de la salida', () => {
  assert.deepEqual(phantomRunIds({ ...shell('phantom show "$ID"'), output: `${card} depende de ${id}` }), [card]);
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
const phaseStates = summary => Object.fromEntries(summary.phases.map(phase => [phase.key, phase.state]));
test('título acotado de objetivos markdown, multilínea y largos; objetivo íntegro aparte', () => {
  const md = '## Título\nEncargos compactos\n## Propósito\nMucho texto';
  assert.equal(summarizePhantomRun({ task: { status: 'ready', contract: { goal: md } } }, [], id).title, 'Encargos compactos');
  const long = summarizePhantomRun({ task: { status: 'ready', contract: { goal: `${'palabra '.repeat(60)}\nsegunda` } } }, [], id);
  assert.ok(long.title.length <= 90);
  assert.equal(long.goal.includes('segunda'), true);
  assert.equal(summarizePhantomRun({ status: 'ready' }, [], id).title, 'Sin objetivo declarado');
});
test('sin evidencia no se infieren fases ni checks pasados', () => {
  const summary = summarizePhantomRun({ status: 'blocked', reason: 'Algo' }, [], id);
  assert.deepEqual(phaseStates(summary), { prep: 'unobserved', exec: 'unobserved', verify: 'unobserved', result: 'blocked' });
  assert.equal(summary.passed, 0);
});
test('exitCode o fase posterior no acreditan checks iniciales', () => {
  const run = { startedAt: '2026-11-15T00:00:00Z', exitCode: 0, evidence: { baseline: { available: true, checks: [{ name: 'a', exitCode: 0 }] }, verification: [{ available: true, checks: [{ name: 'a', passed: true }] }] } };
  const states = phaseStates(summarizePhantomRun({ task: { status: 'verifying' }, runs: [run] }, [], id));
  assert.equal(states.prep, 'unknown');
  assert.equal(states.verify, 'done');
});
test('verificación fallida: fase fallida y bloqueo con motivo', () => {
  const run = { startedAt: '2026-11-15T00:00:00Z', endedAt: '2026-11-15T00:01:00Z', evidence: { verification: [{ available: true, checks: [{ name: 'a', passed: false }] }] } };
  const summary = summarizePhantomRun({ task: { status: 'blocked', reason: 'Verificación fallida: a' }, runs: [run] }, [], id);
  const states = phaseStates(summary);
  assert.equal(states.verify, 'failed');
  assert.equal(states.exec, 'done');
  assert.equal(summary.blocker.cause, 'verification');
});
test('controlador terminado sin aceptación no completa el resultado', () => {
  const summary = summarizePhantomRun({ status: 'review' }, [{ taskId: id, status: 'completed' }], id);
  const result = summary.phases.at(-1);
  assert.equal(result.state, 'unknown');
  assert.match(result.detail, /sin aceptación/);
  assert.equal(summary.blocker, null);
});
test('bloqueo solo sin controlador vivo; cancelada y completada sin bloqueo', () => {
  assert.equal(summarizePhantomRun({ status: 'failed', reason: 'x' }, [], id).blocker.status, 'failed');
  assert.equal(summarizePhantomRun({ status: 'blocked' }, [{ taskId: id, status: 'running' }], id).blocker, null);
  assert.equal(summarizePhantomRun({ status: 'cancelled' }, [], id).phases.at(-1).state, 'cancelled');
  assert.equal(summarizePhantomRun({ status: 'completed' }, [], id).phases.at(-1).state, 'done');
});
