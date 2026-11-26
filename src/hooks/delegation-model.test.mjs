import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDelegation, withCardPlans, chatSubagents, withChatSubagents, agentOpenRequest, agentTree, traceView, traceStatus, traceKind, traceContext, traceEventOwner, traceEventView, traceResult, mergeTraceEvents, agoLabel } from './delegation-model.mjs';

const agent = (id, extra = {}) => ({ id, workspaceId: 'w', nodeId: 'n', ...extra });

test('agentOpenRequest keeps workspace, card and agent explicit and drops anything incomplete or foreign', () => {
  assert.deepEqual(agentOpenRequest({ workspaceId: 'w', nodeId: 'card-1', id: 'toolu_A', extra: 'x' }, 'w'), { workspaceId: 'w', nodeId: 'card-1', id: 'toolu_A' });
  for (const request of [null, undefined, 'x', {}, { workspaceId: 'w', nodeId: 'card-1' }, { workspaceId: 'w', id: 'a' }, { nodeId: 'card-1', id: 'a' }, { workspaceId: 'otro', nodeId: 'card-1', id: 'a' }, { workspaceId: 'w', nodeId: '', id: 'a' }, { workspaceId: 'w', nodeId: 'card-1', id: 7 }]) assert.equal(agentOpenRequest(request, 'w'), null, JSON.stringify(request));
  assert.equal(agentOpenRequest({ workspaceId: 'w', nodeId: 'n', id: 'a' }, undefined), null);
});

test('trace tree links only explicit parents and tells root, subagent and run apart', () => {
  const items = [agent('child-a', { parentId: 'root' }), agent('root'), agent('run-1', { parentId: 'root', taskId: 't', runId: 'r' }), agent('child-b', { parentId: 'root' }), agent('grand', { parentId: 'child-a' }), agent('other-root')];
  const tree = agentTree(items);
  assert.deepEqual(tree.rows.map(row => [row.id, row.depth, row.kind]), [['root', 0, 'root'], ['child-a', 1, 'subagent'], ['grand', 2, 'subagent'], ['run-1', 1, 'run'], ['child-b', 1, 'subagent'], ['other-root', 0, 'root']]);
  assert.equal(tree.rows[0].childCount, 3);
  assert.deepEqual(tree.counts, { total: 6, roots: 2, subagents: 3, runs: 1, active: 0 });
});

test('trace tree never infers ownership from node, order or a missing parent and survives cycles', () => {
  const tree = agentTree([agent('late', { nodeId: 'same' }), agent('early', { nodeId: 'same' }), agent('lost', { parentId: 'absent' }), agent('a', { parentId: 'b' }), agent('b', { parentId: 'a' }), agent('self', { parentId: 'self' }), agent('late'), null, { id: 7 }, { name: 'sin id' }]);
  assert.deepEqual(tree.rows.map(row => [row.id, row.depth]), [['late', 0], ['early', 0], ['lost', 0], ['a', 0], ['b', 0], ['self', 0]]);
  assert.equal(tree.rows.find(row => row.id === 'lost').parentMissing, true);
  assert.equal(tree.rows.find(row => row.id === 'late').parentMissing, false);
  for (const value of [null, undefined, 'x', {}]) assert.deepEqual(agentTree(value).rows, []);
});

test('trace view reports unknown model, status, activity and time instead of inventing them', () => {
  const now = Date.parse('2026-01-01T00:10:00Z');
  const unknown = traceView(agent('x'), now);
  assert.deepEqual(unknown.model, { known: false, text: 'No disponible', source: '' });
  assert.deepEqual(unknown.status, { label: 'Estado no disponible', tone: 'unknown', known: false });
  assert.equal(unknown.name, 'Agente sin nombre');
  assert.equal(unknown.activity, '');
  assert.equal(unknown.updated, '');
  assert.equal(unknown.elapsed, '');
  assert.equal(unknown.parentId, null);
  assert.equal(traceStatus('ghost').known, false);
  assert.equal(traceStatus(undefined).label, 'Estado no disponible');
  const known = traceView(agent('y', { name: ' Revisor ', model: 'claude-sonnet-5-5', modelSource: 'observed', status: 'running', currentActivity: { tool: 'Read', detail: 'src/a.js' }, lastActivityAt: '2026-01-01T00:09:30Z', startedAt: '2026-01-01T00:08:00Z', parentId: 'x' }), now);
  assert.equal(known.name, 'Revisor');
  assert.deepEqual(known.model, { known: true, text: 'claude-sonnet-5-5', source: 'observado por el proveedor' });
  assert.equal(known.status.label, 'En ejecución');
  assert.equal(known.activity, 'Read · src/a.js');
  assert.equal(known.updated, 'hace 30 s');
  assert.equal(known.elapsed, '2 min 00 s');
  assert.equal(known.kind, 'subagent');
  assert.equal(traceView(agent('z', { model: 'm' }), now).model.source, '');
  assert.equal(traceView(agent('u', { availability: { available: false, reason: 'Sin historial' } }), now).unavailable, 'Sin historial');
});

test('trace context separates instructions, assignment and measured tokens and never derives a percentage', () => {
  const none = traceContext(agent('x'));
  assert.equal(none.instructions.available, false);
  assert.equal(none.assignment.available, false);
  assert.equal(none.tokens.available, false);
  assert.match(none.tokens.reason, /no midió/);
  const context = traceContext(agent('y', { context: {
    instructions: { available: true, text: 'Reglas del proyecto', source: 'CLAUDE.md' },
    assignment: 'Revisa el modelo',
    tokens: { input: 1200, output: 80, total: 1280, percent: 64, window: 200000, inheritedFrom: 'root' },
  } }));
  assert.deepEqual(context.instructions, { available: true, text: 'Reglas del proyecto', source: 'CLAUDE.md', size: 19, reason: '' });
  assert.equal(context.assignment.text, 'Revisa el modelo');
  assert.deepEqual(context.tokens.fields.map(field => [field.key, field.amount]), [['input', 1200], ['output', 80], ['total', 1280]]);
  assert.equal(JSON.stringify(context).includes('64'), false);
  assert.equal(JSON.stringify(context).includes('inherit'), false);
  assert.equal(traceContext(agent('z', { context: { tokens: { available: false, reason: 'Proveedor sin medición' }, instructions: { available: false, reason: 'No expuestas' } } })).tokens.reason, 'Proveedor sin medición');
  assert.equal(traceContext(agent('w', { context: { tokens: { input: -1, output: NaN, total: '5' } } })).tokens.available, false);
});

test('every tool event has a visible owner: explicit actor, the agent history or an unlisted actor', () => {
  const root = agent('root', { name: 'Raíz' }), one = agent('c1', { name: 'Hijo 1', parentId: 'root' }), two = agent('c2', { name: 'Hijo 2', parentId: 'root' });
  const byId = new Map([root, one, two].map(item => [item.id, item]));
  assert.deepEqual(traceEventOwner({ kind: 'tool', tool: 'Read' }, one, byId), { id: 'c1', label: 'Hijo 1', explicit: false, known: true });
  assert.deepEqual(traceEventOwner({ kind: 'tool', actorId: 'c1' }, one, byId), { id: 'c1', label: 'Hijo 1', explicit: true, known: true });
  assert.deepEqual(traceEventOwner({ kind: 'tool', actorId: 'c2' }, root, byId), { id: 'c2', label: 'Hijo 2', explicit: true, known: true });
  assert.deepEqual(traceEventOwner({ kind: 'tool', actorId: 'ghost' }, root, byId), { id: 'ghost', label: 'Agente no listado', explicit: true, known: false });
  assert.equal(traceEventOwner({ kind: 'tool', actorId: 4 }, root, null).label, 'Raíz');
  assert.equal(traceEventOwner({}, null, null).label, 'Agente sin nombre');
});

test('merged history deduplicates by event id, reads in time order and keeps undated events last', () => {
  const first = [{ id: 'e2', at: '2026-01-01T00:00:02Z', kind: 'tool', text: 'viejo' }, { id: 'e3', at: '2026-01-01T00:00:03Z', kind: 'tool' }];
  const second = [{ id: 'e1', at: '2026-01-01T00:00:01Z', kind: 'message', text: 'hola' }, { id: 'e2', at: '2026-01-01T00:00:02Z', kind: 'tool', text: 'nuevo' }, { id: 'u', kind: 'status' }, null];
  const merged = mergeTraceEvents(first, second);
  assert.deepEqual(merged.map(event => event.id), ['e1', 'e2', 'e3', 'u']);
  assert.equal(merged[1].text, 'nuevo');
  assert.deepEqual(mergeTraceEvents(), []);
  assert.deepEqual(mergeTraceEvents(undefined, [], [{ at: 'x', kind: 'tool', text: 'a' }, { at: 'x', kind: 'tool', text: 'a' }]).length, 1);
});

test('event and result views only use recorded fields', () => {
  const view = traceEventView({ id: 'e', at: '2026-01-01T00:00:00Z', kind: 'tool', tool: 'Bash', input: { command: 'npm test' }, status: 'done', output: 'ok' });
  assert.deepEqual([view.label, view.tool, view.text, view.output], ['Herramienta', 'Bash', 'npm test', 'ok']);
  assert.equal(traceEventView({}).label, 'Evento');
  assert.equal(traceKind(agent('r', { runId: 'run' })), 'run');
  const pending = traceResult(agent('a', { status: 'running' }), [{ kind: 'message', text: 'avance' }]);
  assert.deepEqual(pending, { available: false, text: '', reason: 'Aún sin resultado registrado.' });
  assert.match(traceResult(agent('b', { status: 'completed' }), []).reason, /sin resultado registrado/);
  assert.equal(traceResult(agent('c'), [{ kind: 'result', text: 'Listo' }, { kind: 'message', text: 'otro' }]).text, 'Listo');
  assert.equal(traceResult(agent('d', { result: 'Del campo' }), []).text, 'Del campo');
});

test('trace status maps every state the host records and never invents one', () => {
  assert.deepEqual(traceStatus('RUNNING'), { label: 'En ejecución', tone: 'live', known: true });
  assert.deepEqual([traceStatus('blocked').tone, traceStatus('error').label, traceStatus('done').tone], ['blocked', 'Falló', 'done']);
  assert.deepEqual([traceStatus('interrupted').label, traceStatus('interrupted').tone, traceStatus('cancelled').label, traceStatus('pending').label], ['Interrumpido', 'stopped', 'Cancelado', 'En cola']);
  for (const value of ['unknown', '', 5, null, {}]) assert.equal(traceStatus(value).known, false, String(value));
});

test('relative time labels step from seconds to days and refuse invalid or future dates', () => {
  const base = Date.parse('2026-01-01T12:00:00Z'), iso = '2026-01-01T12:00:00Z';
  assert.deepEqual([3, 30, 300, 3 * 3600, 2 * 86400].map(seconds => agoLabel(iso, base + seconds * 1000)), ['ahora', 'hace 30 s', 'hace 5 min', 'hace 3 h', 'hace 2 d']);
  assert.equal(agoLabel(iso, base - 10_000), 'ahora', 'a clock slightly behind the host is not shown as negative time');
  assert.equal(agoLabel(base, base + 30_000), 'hace 30 s');
  for (const value of ['basura', null, undefined, '', {}]) assert.equal(agoLabel(value, base), '', String(value));
});

test('a trace kind comes from explicit task, run or parent data only', () => {
  assert.equal(traceKind(agent('a')), 'root');
  assert.equal(traceKind(agent('b', { parentId: 'a' })), 'subagent');
  assert.equal(traceKind(agent('c', { taskId: 't' })), 'run');
  assert.equal(traceKind(agent('d', { parentId: 'a', runId: 'r' })), 'run', 'a run keeps its kind under a parent');
  assert.equal(traceKind(null), 'root');
  assert.deepEqual([traceView(agent('c', { taskId: 't' })).kindLabel, traceView(agent('b', { parentId: 'a' })).kindLabel], ['Ejecución', 'Subagente']);
});

test('the agent tree counts live agents only and keeps host order depth first', () => {
  const tree = agentTree([agent('c2', { parentId: 'root', status: 'working' }), agent('root', { status: 'running' }), agent('c1', { parentId: 'root', status: 'waiting' }), agent('g1', { parentId: 'c1', status: 'done' })]);
  assert.deepEqual(tree.rows.map(row => [row.id, row.depth]), [['root', 0], ['c2', 1], ['c1', 1], ['g1', 2]]);
  assert.equal(tree.counts.active, 2, 'running and working are live; waiting and done are not');
  assert.deepEqual([tree.counts.roots, tree.counts.subagents, tree.counts.total], [1, 3, 4]);
  assert.equal(tree.rows[0].childCount, 2);
  const dup = agentTree([agent('a', { name: 'primero' }), agent('a', { name: 'segundo' })]);
  assert.deepEqual([dup.rows.length, dup.rows[0].agent.name], [1, 'primero']);
});

test('context blocks keep instructions and assignment apart, bound their text and report why one is missing', () => {
  const long = traceContext(agent('a', { context: { assignment: 'x'.repeat(5000) } }));
  assert.deepEqual([long.assignment.text.length, long.assignment.size], [4000, 5000]);
  assert.equal(long.instructions.available, false, 'the child does not borrow instructions it was not given');
  assert.equal(traceContext(agent('b', { context: { brief: 'Encargo viejo' } })).assignment.text, 'Encargo viejo');
  assert.deepEqual(traceContext(agent('c', { context: { instructions: { available: true, text: '', chars: 120, source: 'host' } } })).instructions, { available: true, text: '', source: 'host', size: 120, reason: '' });
  assert.deepEqual(traceContext(agent('d', { context: { instructions: { available: false, reason: 'No expuesto', source: 'x' } } })).instructions, { available: false, text: '', source: 'x', size: null, reason: 'No expuesto' });
  assert.equal(traceContext(agent('e', { context: { assignment: '   ' } })).assignment.reason, 'El proveedor no informó este dato.');
});

test('measured tokens show only fields the provider reported and an explicit unavailable wins over stray numbers', () => {
  const partial = traceContext(agent('a', { context: { tokens: { cached: 10, total: 30, input: 'x', output: -1 } } })).tokens;
  assert.deepEqual(partial.fields.map(field => [field.key, field.amount]), [['cached', 10], ['total', 30]]);
  const denied = traceContext(agent('b', { context: { tokens: { available: false, input: 5 } } })).tokens;
  assert.deepEqual([denied.available, denied.fields, denied.reason], [false, [], 'El proveedor no midió tokens para este agente.']);
  const host = traceContext(agent('c', { context: { tokens: { available: true, measured: 157, total: 157, window: 200000, source: 'claude:request-v1' } } })).tokens;
  assert.deepEqual([host.fields.map(field => field.key), host.source], [['total'], 'claude:request-v1']);
  assert.equal(JSON.stringify(host).includes('200000'), false, 'the window never becomes a figure of use');
});

test('agent view names the model source, the provider and the reason a history is unavailable', () => {
  const task = traceView(agent('t', { taskId: 'task_1', provider: ' claude ', model: 'claude-x', modelSource: 'requested' }));
  assert.deepEqual([task.provider, task.taskId, task.runId, task.model.source], ['claude', 'task_1', '', 'solicitado']);
  assert.equal(traceView(agent('w', { model: 'm', modelSource: 'weird' })).model.source, 'weird');
  assert.equal(traceView(agent('u', { availability: { available: false } })).unavailable, 'El historial de este agente no está disponible.');
  assert.equal(traceView(agent('v', { availability: { history: { available: false } } })).unavailable, '');
  assert.deepEqual(['hola  mundo ', { text: 'x', target: 'y' }, { tool: 'Read' }, 7, null].map(value => traceView(agent('a', { currentActivity: value })).activity), ['hola mundo', 'x · y', 'Read', '', '']);
});

test('event views bound text and output, label known kinds and fall back to the recorded input', () => {
  const long = traceEventView({ kind: 'message', text: 'a'.repeat(700), output: 'b'.repeat(5000) });
  assert.deepEqual([long.text.length, long.output.length], [600, 4000]);
  assert.deepEqual(['result', 'final', 'error', 'custom.kind', undefined].map(kind => traceEventView({ kind }).label), ['Resultado', 'Resultado', 'Error', 'custom.kind', 'Evento']);
  assert.equal(traceEventView({ kind: 'tool', tool: 'Bash', input: 'ls -la' }).text, 'ls -la');
  assert.equal(traceEventView({ kind: 'tool', tool: 'Read', input: { file_path: '/r/a.txt' } }).text, '/r/a.txt');
  assert.equal(traceEventView({ kind: 'message', input: 'no se usa sin herramienta' }).text, '');
  assert.deepEqual([traceEventView({ id: 7, at: 'nunca' }).id, traceEventView({ id: 7, at: 'nunca' }).at], ['', null]);
});

test('the result is the last recorded result or final event, then its output, then the agent field', () => {
  assert.equal(traceResult(agent('a'), [{ kind: 'result', text: 'viejo' }, { kind: 'final', text: 'nuevo' }]).text, 'nuevo');
  assert.equal(traceResult(agent('b'), [{ kind: 'result', text: '  ', output: 'salida' }]).text, 'salida');
  assert.equal(traceResult(agent('c', { result: 'campo' }), [{ kind: 'result', text: '', output: ' ' }]).text, 'campo');
  assert.equal(traceResult(agent('d'), [{ kind: 'result', text: 'z'.repeat(5000) }]).text.length, 4000);
  assert.deepEqual(traceResult(agent('e'), null), { available: false, text: '', reason: 'Aún sin resultado registrado.' });
});

test('merged history keeps arrival order for ties and undated events and places dated ones first', () => {
  const tie = mergeTraceEvents([{ id: 'b', at: '2026-01-01T00:00:01Z', kind: 'x' }, { id: 'a', at: '2026-01-01T00:00:01Z', kind: 'x' }]);
  assert.deepEqual(tie.map(event => event.id), ['b', 'a']);
  const mixed = mergeTraceEvents([{ id: 'u1', kind: 'x' }, { id: 'u2', kind: 'x' }], [{ id: 'd', at: '2026-01-01T00:00:00Z', kind: 'x' }]);
  assert.deepEqual(mixed.map(event => event.id), ['d', 'u1', 'u2']);
});

const terminal = (id, data, title) => ({ id, type: 'terminal', data, title });
const handoff = (nodeId, createdAt = '', extra = {}) => ({ from: { workspaceId: 'w', nodeId, title: nodeId }, createdAt, ...extra });
const build = nodes => buildDelegation({ id: 'w', nodes });

test('chat subagents select running tools in appearance order and normalize fields', () => {
  const part = { type: 'tool', status: 'running', agent: { type: 'Explore' } };
  assert.deepEqual(chatSubagents([{ parts: [
    { ...part, id: 'a', detail: ' Buscar\n  usos ' },
    { ...part, id: 'done', status: 'done' },
    { ...part, id: 'plain', agent: null },
    { ...part },
  ] }, { parts: [{ ...part, id: 0, agent: {}, detail: '', name: 'Agent' }] }]), [
    { id: 'a', type: 'Explore', description: 'Buscar usos', background: false },
    { id: '0', type: '', description: 'Agent', background: false },
  ]);
});

test('chat subagents tolerate malformed messages and bound descriptions', () => {
  for (const messages of [null, undefined, 'x', {}]) assert.deepEqual(chatSubagents(messages), []);
  assert.deepEqual(chatSubagents([null, {}, { parts: {} }, { parts: [null] }]), []);
  const parts = [{ type: 'tool', id: 7, status: 'running', agent: { type: 1 }, detail: 'x'.repeat(500) }];
  assert.deepEqual(chatSubagents([{ parts }]), [{ id: '7', type: '', description: 'x'.repeat(240), background: false }]);
});

test('chat enrichment deduplicates per row and preserves plans, cards and inputs', () => {
  const base = withCardPlans(build([terminal('a', { agent: { cardId: 'c' } }), terminal('b')]), [card('c'), card('open')]);
  const old = { id: 'old', type: 'PTY', description: '', background: true };
  const added = { id: 'new', type: 'Explore', description: 'Find', background: false };
  base.rows[0].subagents.push(old);
  base.counts.subagents = 1;
  const snapshot = structuredClone(base);
  const result = withChatSubagents(base, { a: [{ ...old, type: 'Chat' }, added, added], absent: [added] });
  assert.deepEqual(result.rows[0].subagents, [old, added]);
  assert.deepEqual(result.rows[1].subagents, []);
  assert.equal(result.counts.subagents, 2);
  assert.equal(result.rows[0].plan, base.rows[0].plan);
  assert.equal(result.cards, base.cards);
  assert.deepEqual(base, snapshot);
  for (const byNode of [null, undefined]) assert.deepEqual(withChatSubagents(base, byNode), base);
});

test('subagents discard expired and malformed dates and normalize presentation', () => {
  const now=Date.parse('2026-01-01T12:00:00Z');
  const delegation=buildDelegation({id:'w',nodes:[terminal('a',{subagents:[
    {id:'valid',type:'Explore',description:'Files',background:true,startedAt:new Date(now-1000).toISOString()},
    {id:'defaults',startedAt:new Date(now).toISOString()},
    {id:'old',startedAt:new Date(now-7*3600e3).toISOString()},
    {id:'bad',startedAt:'invalid'},null,{startedAt:new Date(now).toISOString()},
  ]})]}, {now});
  assert.deepEqual(delegation.rows[0].subagents,[{id:'valid',type:'Explore',description:'Files',background:true},{id:'defaults',type:'',description:'',background:false}]);
  assert.equal(delegation.counts.subagents,2);
  assert.deepEqual(withCardPlans(delegation,null).rows[0].subagents,delegation.rows[0].subagents);
});

test('subagents default to empty for missing or non-array data', () => {
  const delegation=build([terminal('a'),terminal('b',{subagents:'bad'})]);
  assert.deepEqual(delegation.rows.map(row=>row.subagents),[[],[]]);
  assert.equal(delegation.counts.subagents,0);
});

const card = (id, status = 'ready', children = [{ key: 'one', goal: 'Primero' }], goal = ' Meta  de\n la card ') => ({
  id, kind: 'card', status, raw: { id, contract: { goal, coordination: { children } } },
});

test('card plans resolve registered children, dependencies and completion for both list shapes', () => {
  const delegation = build([terminal('a', { agent: { cardId: 'c' } })]);
  const items = [card('c', 'running', [{ key: 'one', goal: 'Primero' }, { key: 'two', goal: 'Segundo', dependencies: ['one'] }]),
    { id: 't', kind: 'task', status: 'completed', raw: { id: 't', parentId: 'c', key: 'one', status: 'completed' } }];
  for (const tasks of [items, { items }]) {
    assert.deepEqual(withCardPlans(delegation, tasks).rows[0].plan, {
      cardId: 'c', total: 2, done: 1, children: [
        { key: 'one', goal: 'Primero', status: 'completed', dependencies: [], taskId: 't' },
        { key: 'two', goal: 'Segundo', status: 'sin registrar', dependencies: ['one'], taskId: '' },
      ],
    });
  }
});

test('unassigned plans include only open items in catalog order and normalize goals', () => {
  const items = [card('assigned'), card('closed', 'completed'), card('cancelled', 'cancelled'), card('empty', 'ready', []), card('open'), card('long', 'blocked', undefined, 'x'.repeat(201))];
  const result = withCardPlans(build([terminal('a', { hidden: true, agent: { cardId: 'assigned' } })]), items);
  assert.deepEqual(result.cards.map(item => item.id), ['open', 'long']);
  assert.equal(result.cards[0].goal, 'Meta de la card');
  assert.equal(result.cards[0].status, 'ready');
  assert.equal(result.cards[1].goal, `${'x'.repeat(199)}…`);
});

test('enrichment preserves order and counts without mutating delegation or its rows', () => {
  const delegation = build([terminal('a', { agent: { cardId: 'c' } }), terminal('b'), terminal('c', { agent: { cardId: 'empty' } })]);
  const snapshot = structuredClone(delegation);
  delegation.rows.forEach(Object.freeze);
  Object.freeze(delegation.rows);
  Object.freeze(delegation);
  const result = withCardPlans(delegation, [card('c'), card('empty', 'ready', [])]);
  assert.deepEqual(result.rows.map(row => row.id), ['a', 'b', 'c']);
  assert.equal(result.counts, delegation.counts);
  assert.equal(result.rows[1].plan, null);
  assert.equal(result.rows[2].plan, null);
  assert.notEqual(result.rows[0], delegation.rows[0]);
  assert.deepEqual(delegation, snapshot);
});

test('missing catalogs yield no plans and items without raw use their own detail', () => {
  const delegation = build([terminal('a', { agent: { cardId: 'c' } })]);
  for (const tasks of [null, undefined, {}, 'x', { items: {} }]) {
    const result = withCardPlans(delegation, tasks);
    assert.equal(result.rows[0].plan, null);
    assert.deepEqual(result.cards, []);
  }
  const counts = { total: 0 };
  assert.deepEqual(withCardPlans({ rows: [], counts }, null), { rows: [], counts, cards: [] });
  const item = card('c');
  assert.equal(withCardPlans(delegation, [{ ...item.raw, status: 'ready' }]).rows[0].plan.total, 1);
});

test('purpose prioritizes tasks, handoffs and orchestrators and excludes processes', () => {
  const { rows } = build([
    terminal('task', { agent: { cardId: 'c', cardTitle: 'Task' }, handoff: {}, role: 'orchestrator' }),
    terminal('handoff', { handoff: { title: 'Request' }, agent: { cardId: '' } }),
    terminal('orchestrator', { role: 'orchestrator' }), terminal('none'),
    terminal('process', { process: {} }), { id: 'note', type: 'note' },
  ]);
  assert.deepEqual(rows.map(row => row.purpose), ['task', 'orchestrator', 'handoff', 'none']);
  assert.equal(rows[0].what, 'Task');
  assert.equal(rows[2].what, 'Request');
});

test('depth-first order puts orchestrators first and sorts siblings stably', () => {
  const { rows } = build([
    terminal('plain'), terminal('late', { handoff: handoff('parent', '2026-02-01') }),
    terminal('parent'), terminal('early', { handoff: handoff('parent', '2026-01-01') }),
    terminal('tie', { handoff: handoff('parent', '2026-01-01') }),
    terminal('grand', { handoff: handoff('early') }), terminal('orq', { role: 'orchestrator' }),
  ]);
  assert.deepEqual(rows.map(row => row.id), ['orq', 'plain', 'parent', 'early', 'grand', 'tie', 'late']);
  assert.deepEqual(rows.map(row => row.depth), [0, 0, 0, 1, 2, 1, 1]);
  assert.equal(rows[4].parentId, 'early');
});

test('why collapses whitespace, omits duplicate what and truncates to 200', () => {
  const { rows } = build([
    terminal('a', { handoff: { title: 'Title', brief: '  Reason\n\t with   spaces  ' } }),
    terminal('b', { handoff: { title: 'Same text', brief: ' Same\ntext ' } }),
    terminal('c', { handoff: { brief: 'x'.repeat(201) } }), terminal('d'),
  ]);
  assert.deepEqual(rows.map(row => row.why), ['Reason with spaces', '', `${'x'.repeat(199)}…`, '']);
});

test('external origin stays a root even when nodeId matches a local terminal', () => {
  const { rows } = build([terminal('local'), terminal('external', {
    handoff: { from: { workspaceId: 'other', workspaceName: 'Other', nodeId: 'local', title: 'Remote' } },
  })]);
  assert.deepEqual(rows[1].from, { nodeId: 'local', title: 'Remote', workspaceName: 'Other', external: true });
  assert.equal(rows[1].parentId, null);
  assert.equal(rows[1].depth, 0);
});

test('why removes a leading what only at a space boundary before truncating', () => {
  const { rows } = build([
    terminal('a', { handoff: { title: 'Primero', brief: 'Primero\n\n  Revisa   los tests\nporque fallan' } }),
    terminal('b', { handoff: { title: 'Pri', brief: 'Primero va esto' } }),
    terminal('c', { handoff: { title: 'Largo', brief: `Largo ${'x'.repeat(500)}` } }),
    terminal('d', { handoff: { title: 'Otro', brief: 'Nada que ver con el título' } }),
  ]);
  assert.deepEqual(rows.map(row => row.why), [
    'Revisa los tests porque fallan', 'Primero va esto', `${'x'.repeat(199)}…`, 'Nada que ver con el título',
  ]);
});

test('cycles, self-links and absent data yield each terminal exactly once', () => {
  const { rows } = build([
    terminal('a', { handoff: handoff('b') }), terminal('b', { handoff: handoff('a') }),
    terminal('self', { handoff: handoff('self') }), terminal('missing'),
    terminal('unknown', { handoff: handoff('absent') }),
  ]);
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map(row => row.id)).size, 5);
  const missing = rows.find(row => row.id === 'missing');
  assert.deepEqual(missing, {
    id: 'missing', title: 'Terminal', role: 'worker', depth: 0, parentId: null,
    purpose: 'none', what: '', why: '', from: null, status: 'idle', step: '', branch: '', cardId: '', hidden: false, subagents: [],
  });
  assert.equal(rows.find(row => row.id === 'self').parentId, null);
  const empty = { rows: [], counts: { total: 0, unassigned: 0, working: 0, blocked: 0, subagents: 0 } };
  assert.deepEqual(buildDelegation(null), empty);
  assert.deepEqual(buildDelegation({ id: 'w' }), empty);
});

test('counts include hidden terminals and normalize invalid status', () => {
  const { rows, counts } = build([
    terminal('working', { hidden: true, agent: { cardId: 'c', status: 'working', step: 'Editing' }, worktree: { branch: 'feature' } }),
    terminal('blocked', { agent: { status: 'blocked' } }),
    terminal('review', { agent: { status: 'review' }, handoff: {} }),
    terminal('invalid', { agent: { status: 'unknown' } }),
  ]);
  assert.deepEqual(counts, { total: 4, unassigned: 2, working: 1, blocked: 1, subagents: 0 });
  assert.equal(rows[0].hidden, true);
  assert.equal(rows[0].step, 'Editing');
  assert.equal(rows[0].branch, 'feature');
  assert.equal(rows[2].status, 'review');
  assert.equal(rows[3].status, 'idle');
});

test('terminals stored with worktree or agent null still produce rows', () => {
  const { rows } = build([
    terminal('orchestrator', { role: 'orchestrator', worktree: null, agent: null }),
    terminal('project', { worktree: null, worktreeReason: 'sin Git' }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.branch), ['', '']);
  assert.equal(rows[0].status, 'idle');
});
