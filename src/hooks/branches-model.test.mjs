import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBranches, cardLocations, contentByBranch, shortBranch, span, changeLabel } from './branches-model.mjs';
import { buildDesk } from './phantom-desk.mjs';

const row = (name, extra = {}) => ({ name, oid: 'a'.repeat(40), isBase: false, last: { at: '2026-11-11T10:00:00Z', subject: 'x' }, worktree: { path: `/w/${name}`, exists: true, main: false, locked: false }, terminal: null, ahead: 0, behind: 0, committed: [], committedCount: 0, changes: [], changeCount: 0, conflicts: null, overlaps: [], request: null, work: 'none', ...extra });
const uuid = '362f2765-6c0b-498c-81c8-aab82e02f145';

test('Ramas groups by pending work and offers only what the host accepts', () => {
  const data = { available: true, base: { branch: 'main' }, branches: [
    row('main', { isBase: true, worktree: { path: '/repo', exists: true, main: true } }),
    row(`phantom/terminal-${uuid}`, { work: 'dirty', changeCount: 4, changes: [{ status: ' M', path: 'old.js', inBase: true }, { status: ' M', path: 'src/App.jsx' }], inBase: 1, behind: 21, terminal: { nodeId: 'n1', title: 'Sidebar', running: true } }),
    row('feature/ready', { work: 'ready', ahead: 2, behind: 1, conflicts: [], committed: ['a.js'], committedCount: 1 }),
    row('feature/clash', { work: 'ready', ahead: 1, behind: 3, conflicts: ['a.js'] }),
    row('old/orphan', { behind: 14 }),
    row('old/owned', { behind: 14, terminal: { nodeId: 'n2', title: 'Chat', running: false } }),
  ] };
  const model = buildBranches(data);
  assert.equal(model.base, 'main'); assert.equal(model.total, 5); assert.deepEqual(model.counts, { dirty: 1, ready: 2, clean: 2 });
  assert.equal(model.unsaved, 4); assert.equal(model.pending, 3);
  const by = Object.fromEntries(model.groups.flatMap(group => group.rows).map(item => [item.name, item]));
  const dirty = by[`phantom/terminal-${uuid}`];
  assert.equal(dirty.title, 'Sidebar'); assert.equal(dirty.where, 'Terminal con sesión activa');
  assert.equal(dirty.summary, '4 archivos sin guardar (1 ya idénticos en main) · 21 commits detrás de main');
  assert.equal(dirty.pendingCount, 3); assert.deepEqual(dirty.changes.map(change => change.path), ['src/App.jsx', 'old.js']); assert.equal(model.unsavedInBase, 1);
  assert.deepEqual(dirty.can, { commit: true, integrate: false, update: true, remove: false });
  assert.deepEqual(by['feature/ready'].can, { commit: false, integrate: true, update: true, remove: false });
  // A predicted conflict is resolved in the terminal, never forced from the panel.
  assert.deepEqual(by['feature/clash'].can, { commit: false, integrate: false, update: false, remove: false });
  // Only branches without a terminal on the canvas are cleaned; owned ones are brought up to date.
  assert.deepEqual(model.removable.map(item => item.name), ['old/orphan']);
  assert.deepEqual(model.updatable.map(item => item.name).sort(), ['old/orphan', 'old/owned']);
  assert.equal(buildBranches(data, { query: 'app.jsx' }).visible, 1);
  assert.equal(shortBranch(`phantom/terminal-${uuid}`), 'terminal 362f2765'); assert.equal(shortBranch('feature/x'), 'feature/x');
  assert.equal(span(0), 0); assert.ok(span(1) < span(40) && span(4000) <= 96);
  assert.equal(changeLabel('??'), 'Nuevo'); assert.equal(changeLabel(' D'), 'Borrado');
});

test('Cards and Skills are attributed to the worktree they live in', () => {
  const branch = `phantom/terminal-${uuid}`;
  const cards = [
    { id: 'a', title: 'A', location: { path: '/repo', branch: 'main', main: true } },
    { id: 'b', title: 'B', location: { path: '/w/1', branch, main: false } },
    { id: 'c', title: 'C', location: { path: '/w/1', branch, main: false } },
    { id: 'd', title: 'D' },
  ];
  const nodes = [{ id: 'n1', type: 'terminal', title: 'Sidebar', data: { worktree: { branch } } }];
  assert.deepEqual(cardLocations(cards, nodes).map(item => [item.key, item.label, item.count]), [['main', 'Proyecto', 1], [branch, 'Sidebar', 2]]);
  assert.deepEqual(cardLocations(cards, []).map(item => item.label), ['Proyecto', 'terminal 362f2765']);
  const content = contentByBranch({ cards, skills: [{ name: 's', origin: 'worktree', branch }, { name: 'p', origin: 'project' }] });
  assert.equal(content.get(branch).cards.length, 2); assert.equal(content.get(branch).skills.length, 1); assert.equal(content.has('main'), false);
  assert.deepEqual(buildDesk(cards, [], '', branch).cards.map(card => card.id), ['b', 'c']);
  assert.equal(buildDesk(cards, []).total, 4);
});
