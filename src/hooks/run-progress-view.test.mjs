import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgressView, formatDuration } from './run-progress-view.mjs';
import { terminalJourney } from './terminal-journey.mjs';

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

// ── Recorrido de la terminal (terminalJourney) ──
const node = (agent = {}, extra = {}) => ({ id: 'n1', data: { agent, ...extra } });
const turn = (parts, status = 'streaming', createdAt = '2026-11-23T12:00:05Z') => ({ role: 'assistant', status, createdAt, parts });
const blocked = blocker => ({ ...base, phase: 'blocked', blocker: { summary: 's', remedy: 'r', commands: [], ...blocker } });

test('recorrido: un permiso pendiente pesa más que trabajar y no desaparece al abrir la terminal', () => {
  const messages = [turn([{ type: 'tool', id: 't', name: 'Bash', detail: 'ls', status: 'running' }, { type: 'permission', id: 'p', tool: 'Bash', detail: 'rm -rf build', status: 'pending' }])];
  for (const screenState of ['working', undefined]) {
    const view = terminalJourney({ node: node({ status: 'working' }), screenState, messages, running: true, now: T0 + 10_000 });
    assert.equal(view.tone, 'attention');
    assert.equal(view.statusLabel, 'Pide permiso');
    assert.equal(view.needsAttention, true);
    assert.equal(view.activity.source, 'request');
    assert.equal(view.activity.detail, 'rm -rf build');
  }
  assert.equal(terminalJourney({ node: node(), screenState: 'awaiting_approval' }).statusLabel, 'Pide permiso');
});

test('recorrido: una pregunta pendiente en reposo sigue pidiendo atención, incluso sin conexión', () => {
  const messages = [turn([{ type: 'question', id: 'q', status: 'pending', questions: [{ question: '¿Mantengo la duración?' }] }], 'done')];
  for (const connected of [true, false]) {
    const view = terminalJourney({ node: node({ status: 'idle' }), connected, messages, now: T0 });
    assert.equal(view.needsAttention, true);
    assert.equal(view.statusLabel, 'Hace una pregunta');
    assert.equal(view.activity.detail, '¿Mantengo la duración?');
  }
  const answered = [turn([{ type: 'question', id: 'q', status: 'answered', questions: [] }], 'done')];
  assert.equal(terminalJourney({ node: node({ status: 'idle' }), messages: answered }).needsAttention, false);
  assert.equal(terminalJourney({ node: node({ status: 'idle' }), screenState: 'awaiting_input' }).statusLabel, 'Terminó · tu turno');
});

test('recorrido: espera autónoma y recuperación no se confunden con una decisión humana', () => {
  const wait = terminalJourney({ node: node({ run: blocked({ category: 'rate_limit', autonomy: 'auto', retryAt: '2026-11-23T13:00:00Z' }) }), now: T0 });
  assert.equal(wait.tone, 'idle');
  assert.equal(wait.needsAttention, false);
  assert.match(wait.statusLabel, /^Se recupera sola · reintento /);
  assert.equal(wait.blocker.kind, 'recovery');
  const orchestrator = terminalJourney({ node: node({ run: blocked({ category: 'contract', autonomy: 'orchestrator' }) }), now: T0 });
  assert.equal(orchestrator.statusLabel, 'Espera al orquestador');
  assert.equal(orchestrator.needsAttention, false);
  const decision = terminalJourney({ node: node({ run: blocked({ category: 'budget', autonomy: 'ask_user' }) }), now: T0 });
  assert.equal(decision.needsAttention, true);
  assert.equal(decision.blocker.kind, 'decision');
  const human = terminalJourney({ node: node({ run: blocked({ category: 'policy', autonomy: 'human' }) }), now: T0 });
  assert.deepEqual([human.tone, human.needsAttention, human.blocker.kind], ['error', false, 'human']);
  const unknown = terminalJourney({ node: node({ run: blocked({ category: 'budget', autonomy: 'invented' }) }), now: T0 });
  assert.deepEqual([unknown.tone, unknown.needsAttention, unknown.blocker.kind, unknown.blocker.autonomy], ['error', false, 'unknown', '']);
});

test('recorrido: el plan explícito manda y la fase real del run solo se une a su propia fase', () => {
  const plan = { phases: [{ key: 'a', title: 'Explorar', status: 'done', taskId: 't0' }, { key: 'b', title: 'Implementar', status: 'running', taskId: 't1' }, { key: 'c', title: 'Revisar', status: 'pending' }] };
  const view = terminalJourney({ node: node({ run: { ...base, phase: 'checks' } }, { plan }), now: T0 + 20_000 });
  assert.deepEqual(view.phases.map(p => [p.label, p.kind, p.status]), [['Explorar', 'discovery', 'done'], ['Implementar', 'develop', 'current'], ['Revisar', 'judge', 'pending']]);
  assert.equal(view.phases[1].detail, 'Ejecutando checks');
  assert.equal(view.phases[1].current, true);
  assert.equal(view.statusLabel, 'Ejecutando checks');
  const other = terminalJourney({ node: node({ run: { ...base, taskId: 'otro', phase: 'checks' } }, { plan }), now: T0 + 20_000 });
  assert.equal(other.phases[1].detail, 'En curso');
});

test('recorrido: reparación y juez salen de la fase real y no dan por hechas las demás', () => {
  const repair = terminalJourney({ node: node({ run: { ...base, phase: 'repair', round: 2 } }), now: T0 + 20_000 });
  assert.equal(repair.statusLabel, 'Reparación 2');
  assert.equal(repair.tone, 'working');
  assert.equal(repair.needsAttention, false);
  assert.deepEqual(repair.phases.map(p => [p.kind, p.status]), [['develop', 'pending'], ['checks', 'pending'], ['repair', 'current'], ['judge', 'pending']]);
  assert.equal(repair.phases[2].detail, '2 rondas');
  const judge = terminalJourney({ node: node({ run: { ...base, phase: 'judge' } }), now: T0 + 20_000 });
  assert.equal(judge.statusLabel, 'Juez revisando');
  assert.deepEqual(judge.phases.filter(p => p.current).map(p => p.kind), ['judge']);
  assert.equal(judge.phases.some(p => p.status === 'done'), false);
});

test('recorrido: terminar no infiere integración ni la inventa', () => {
  const done = terminalJourney({ node: node({ run: { ...base, phase: 'completed', elapsedMs: 90_000 } }), now: T0 + 999_000 });
  assert.equal(done.statusLabel, 'Terminó');
  assert.equal(done.tone, 'review');
  assert.deepEqual(done.phases.map(p => [p.key, p.status, p.detail]), [['completed', 'done', 'Sin datos de integración']]);
  assert.equal(done.phases.some(p => p.kind === 'integration'), false);
  const plan = { phases: [{ key: 'dev', title: 'Desarrollo', status: 'done' }, { key: 'int', title: 'Integrar a main', status: 'pending' }] };
  const declared = terminalJourney({ node: node({ run: { ...base, phase: 'completed' } }, { plan }) });
  assert.deepEqual(declared.phases.map(p => [p.kind, p.status]), [['develop', 'done'], ['integration', 'pending']]);
});

test('recorrido: sin datos o sin conexión es desconocido y no inventa fases, actividad ni hora', () => {
  for (const view of [terminalJourney(), terminalJourney({ node: node() })]) {
    assert.deepEqual([view.tone, view.statusLabel, view.needsAttention], ['unknown', 'Sin datos', false]);
    assert.deepEqual([view.phases, view.activity, view.blocker, view.lastEventAt], [[], null, null, null]);
    assert.deepEqual(view.delegates, { total: 0, running: 0, items: [] });
  }
  const offline = terminalJourney({ node: node({ status: 'working' }), connected: false, screenState: 'working', running: true });
  assert.deepEqual([offline.tone, offline.statusLabel], ['unknown', 'Sin conexión']);
});

test('recorrido: traduce Phantom a un propósito cotidiano y conserva el texto técnico con su antigüedad', () => {
  const command = 'node "$PHANTOM_AGENT_CLI" show task_1234';
  const messages = [turn([{ type: 'tool', id: 't1', name: 'Bash', detail: command, status: 'running' }])];
  const view = terminalJourney({ node: node({ status: 'working' }), messages, now: T0 + 25_000 });
  assert.deepEqual([view.activity.label, view.activity.detail, view.activity.age, view.activity.status], ['Consultando una tarea', command, '20 s', 'running']);
  const run = terminalJourney({ node: node({ run: base }), now: T0 + 40_000 });
  assert.deepEqual([run.activity.label, run.activity.detail, run.activity.source, run.activity.age], ['Editando', 'src/x.css', 'run', '30 s']);
  const finished = terminalJourney({ node: node(), messages: [turn([{ type: 'tool', id: 't2', name: 'mcp__phantom__context', detail: 'convenciones', status: 'done' }], 'done')], now: T0 + 65_000 });
  assert.deepEqual([finished.activity.label, finished.activity.status, finished.activity.age], ['Buscó contexto del proyecto', 'done', '1 min']);
  assert.equal(finished.lastEventAt, '2026-11-23T12:00:05.000Z');
});

test('recorrido: delegados combinan subagentes, hijos y encargos propios sin duplicar ni atribuir de otra terminal', () => {
  const messages = [
    turn([{ type: 'tool', id: 'a1', name: 'Agent', detail: 'Mapear módulos', status: 'running', agent: { type: 'Explore', steps: [{ id: 1, name: 'Read', detail: 'x.js', status: 'running' }] } }], 'done'),
    turn([{ type: 'tool', id: 'a1', name: 'Agent', detail: 'Mapear módulos', status: 'done', agent: { type: 'Explore', steps: [] } }, { type: 'tool', id: 'a2', name: 'Agent', detail: 'Escribir pruebas', status: 'running', agent: { type: 'general-purpose', steps: [{ id: 2, name: 'Edit', detail: 'a.test.mjs', status: 'running' }] } }]),
  ];
  const run = { ...base, phase: 'children', children: { done: 1, total: 2, items: [{ key: 'ui', status: 'done', activity: '' }, { key: 'host', status: 'running', activity: 'check tests' }] } };
  const controllers = [
    { id: 'c1', taskId: 'task_1', status: 'running', origin: { nodeId: 'n1' }, title: 'Revisar CSS' },
    { id: 'c1b', taskId: 'task_1', status: 'running', origin: { nodeId: 'n1' }, title: 'Revisar CSS' },
    { id: 'c2', taskId: 'task_2', status: 'running', origin: { nodeId: 'otra' } },
    { id: 'c3', taskId: 't1', status: 'running', origin: { nodeId: 'n1' } },
  ];
  const { delegates } = terminalJourney({ node: node({ run }), messages, controllers, now: T0 + 20_000 });
  assert.deepEqual(delegates.items.map(i => [i.key, i.status]), [['subagent:a2', 'running'], ['child:host', 'running'], ['task:task_1', 'running'], ['subagent:a1', 'done'], ['child:ui', 'done']]);
  assert.deepEqual([delegates.total, delegates.running], [5, 3]);
  const [agent, child, task, finished] = delegates.items;
  assert.deepEqual([agent.type, agent.label, agent.activity], ['general-purpose', 'Escribir pruebas', 'Edit a.test.mjs']);
  assert.deepEqual([child.source, child.activity, child.statusLabel], ['child', 'check tests', 'En curso']);
  assert.deepEqual([task.source, task.label], ['task', 'Revisar CSS']);
  assert.deepEqual([finished.type, finished.statusLabel], ['Explore', 'Listo']);
});
