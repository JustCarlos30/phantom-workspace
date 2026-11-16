import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDelegation } from './delegation-model.mjs';

const terminal = (id, data, title) => ({ id, type: 'terminal', data, title });
const handoff = (nodeId, createdAt = '', extra = {}) => ({ from: { workspaceId: 'w', nodeId, title: nodeId }, createdAt, ...extra });
const build = nodes => buildDelegation({ id: 'w', nodes });

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
    purpose: 'none', what: '', why: '', from: null, status: 'idle', step: '', branch: '', cardId: '', hidden: false,
  });
  assert.equal(rows.find(row => row.id === 'self').parentId, null);
  const empty = { rows: [], counts: { total: 0, unassigned: 0, working: 0, blocked: 0 } };
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
  assert.deepEqual(counts, { total: 4, unassigned: 2, working: 1, blocked: 1 });
  assert.equal(rows[0].hidden, true);
  assert.equal(rows[0].step, 'Editing');
  assert.equal(rows[0].branch, 'feature');
  assert.equal(rows[2].status, 'review');
  assert.equal(rows[3].status, 'idle');
});
