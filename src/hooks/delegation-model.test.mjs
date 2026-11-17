import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDelegation, withCardPlans } from './delegation-model.mjs';

const terminal = (id, data, title) => ({ id, type: 'terminal', data, title });
const handoff = (nodeId, createdAt = '', extra = {}) => ({ from: { workspaceId: 'w', nodeId, title: nodeId }, createdAt, ...extra });
const build = nodes => buildDelegation({ id: 'w', nodes });

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
