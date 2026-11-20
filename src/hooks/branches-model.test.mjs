import test from 'node:test';
import assert from 'node:assert/strict';
import { branchPath, branchState, branchTitle, buildBranches, cardLocations, contentByBranch, shortBranch, span, changeLabel } from './branches-model.mjs';
import { buildDesk } from './phantom-desk.mjs';

const row = (name, extra = {}) => ({ name, oid: 'a'.repeat(40), isBase: false, last: { at: '2026-11-11T10:00:00Z', subject: 'x' }, worktree: { path: `/w/${name}`, exists: true, main: false, locked: false }, terminal: null, ahead: 0, behind: 0, committed: [], committedCount: 0, changes: [], changeCount: 0, conflicts: null, overlaps: [], request: null, work: 'none', ...extra });
const uuid = '362f2765-6c0b-498c-81c8-aab82e02f145';

test('Ramas gives every branch one state, one line and one action, most urgent first', () => {
  const data = { available: true, base: { branch: 'main' }, branches: [
    row('main', { isBase: true, worktree: { path: '/repo', exists: true, main: true }, changeCount: 1, changes: [{ status: ' M', path: 'docs/README.md' }] }),
    row(`phantom/terminal-${uuid}`, { work: 'dirty', changeCount: 4, changes: [{ status: ' M', path: 'old.js', inBase: true }, { status: ' M', path: 'src/App.jsx' }], inBase: 1, behind: 21, terminal: { nodeId: 'n1', title: 'Sidebar', running: true, status: 'working' } }),
    row('feature/unsaved', { work: 'dirty', changeCount: 3, terminal: { nodeId: 'n3', title: 'Notas', running: false, status: 'idle' } }),
    row('feature/ready', { work: 'ready', ahead: 2, behind: 1, conflicts: [], committed: ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'], committedCount: 5 }),
    row('feature/clash', { work: 'ready', ahead: 1, behind: 3, conflicts: ['src/Canvas.jsx'], terminal: { nodeId: 'n4', title: 'Canvas', running: false, status: 'idle' } }),
    row('feature/queued', { work: 'ready', ahead: 1, conflicts: [], request: 'queued' }),
    row('feature/merging', { work: 'ready', ahead: 1, conflicts: [], request: 'merging' }),
    row('feature/failed', { work: 'ready', ahead: 1, conflicts: [], request: 'failed' }),
    row('old/orphan', { behind: 14 }),
    row('old/owned', { behind: 14, terminal: { nodeId: 'n2', title: 'Chat', running: false, status: 'idle' } }),
  ] };
  const model = buildBranches(data);
  assert.equal(model.base, 'main'); assert.equal(model.total, 9); assert.equal(model.title, '9 ramas');
  assert.deepEqual(model.counts, { conflict: 2, ready: 1, merging: 1, queued: 1, unsaved: 1, working: 1, merged: 2 });
  assert.deepEqual(model.rows.map(item => item.state), ['conflict', 'conflict', 'ready', 'merging', 'queued', 'unsaved', 'working', 'merged', 'merged']);
  assert.deepEqual(model.groups.flatMap(group => group.rows), model.rows);
  assert.deepEqual([model.baseRow.state, model.baseRow.stateLabel, model.baseRow.detail, model.baseRow.action], ['unsaved', 'Sin guardar', '1 archivo sin guardar · README.md', 'save']);
  assert.equal(model.unsaved, 7); assert.equal(model.pending, 6);
  const by = Object.fromEntries(model.rows.map(item => [item.name, item]));
  const read = name => [by[name].stateLabel, by[name].tone, by[name].detail, by[name].action];
  const working = by[`phantom/terminal-${uuid}`];
  assert.equal(working.title, 'Sidebar');
  assert.deepEqual(read(working.name), ['Trabajando', 'working', '4 archivos sin guardar', null]);
  assert.equal(working.pendingCount, 3); assert.deepEqual(working.changes.map(change => change.path), ['src/App.jsx', 'old.js']); assert.equal(model.unsavedInBase, 1);
  assert.deepEqual(working.can, { commit: true, integrate: false, update: true, remove: false });
  assert.deepEqual(read('feature/unsaved'), ['Sin guardar', 'attention', '3 archivos sin guardar', 'save']);
  assert.deepEqual(read('feature/ready'), ['Lista', 'success', '2 commits · 5 archivos', 'integrate']);
  assert.deepEqual(by['feature/ready'].can, { commit: false, integrate: true, update: true, remove: false });
  // A predicted conflict is resolved in its session, never forced from the panel.
  assert.deepEqual(read('feature/clash'), ['Conflicto', 'danger', 'Canvas.jsx choca con main', 'session']);
  assert.deepEqual(by['feature/clash'].can, { commit: false, integrate: false, update: false, remove: false });
  assert.deepEqual(read('feature/failed'), ['Tests fallaron', 'danger', 'Los tests fallaron al integrar', null]);
  // By hand: a terminal in the copy, resolving a clash when no agent is live, aborting only a half-done update.
  assert.deepEqual(by['feature/clash'].byHand, { terminal: true, resolve: true, abort: false });
  assert.equal(by[`phantom/terminal-${uuid}`].byHand.resolve, false);
  const half = buildBranches({ available: true, base: { branch: 'main' }, branches: [row('feature/half', { ahead: 1, behind: 2, changeCount: 1, changes: [{ status: 'UU', path: 'a.js' }] })] }).rows[0];
  assert.deepEqual([half.midMerge, half.byHand.abort], [true, true]);
  assert.deepEqual(read('feature/queued'), ['En cola', 'neutral', 'Espera su turno en la cola', null]);
  assert.deepEqual(read('feature/merging'), ['Integrando', 'working', 'El orquestador la está integrando', null]);
  // Only branches without a session are cleaned; owned ones are brought up to date.
  assert.deepEqual(read('old/orphan'), ['En main', 'neutral', 'Ya está en main · sesión cerrada', 'remove']);
  assert.deepEqual(read('old/owned'), ['En main', 'neutral', 'Sin cambios propios', null]);
  assert.deepEqual(model.removable.map(item => item.name), ['old/orphan']);
  assert.deepEqual(model.updatable.map(item => item.name).sort(), ['old/orphan', 'old/owned']);
  assert.equal(buildBranches(data, { query: 'app.jsx' }).visible, 1);
  assert.equal(buildBranches(data, { query: 'conflicto' }).visible, 1);
  assert.equal(buildBranches(data, { query: 'tests fallaron' }).visible, 1);
  assert.equal(shortBranch(`phantom/terminal-${uuid}`), 'Sesión cerrada · 362f2765'); assert.equal(shortBranch('feature/x'), 'feature/x');
  assert.equal(branchTitle(null), 'Sin rama');
  assert.equal(buildBranches({ base: { branch: 'main' }, branches: [row(`phantom/terminal-${uuid}`)] }).title, '1 rama de tus sesiones');
  assert.equal(span(0), 0); assert.ok(span(1) < span(40) && span(4000) <= 96);
  assert.equal(changeLabel('??'), 'Nuevo'); assert.equal(changeLabel(' D'), 'Borrado');
});

test('state filters count search matches and preserve global totals and row order', () => {
  const data = { base: { branch: 'dev' }, branches: [row('dev', { isBase: true }), row('match/landed', { behind: 2 }), row('match/ready', { ahead: 1, work: 'ready' }), row('other/dirty', { changeCount: 2, work: 'dirty' }), row('match/clash', { conflicts: ['x'] })] };
  const all = buildBranches(data), searched = buildBranches(data, { query: 'match/' });
  assert.deepEqual(buildBranches(data, { filter: '' }), all);
  assert.deepEqual(all.rows.map(item => item.name), ['match/clash', 'match/ready', 'other/dirty', 'match/landed']);
  assert.deepEqual(searched.filters, [{ id: 'conflict', label: 'Conflicto', count: 1 }, { id: 'ready', label: 'Lista', count: 1 }, { id: 'merged', label: 'En dev', count: 1 }]);
  assert.equal(searched.matched, 3);
  const filtered = buildBranches(data, { query: 'match/', filter: 'merged' });
  assert.deepEqual(filtered.filters, searched.filters); assert.equal(filtered.matched, 3);
  assert.equal(filtered.visible, 1); assert.deepEqual(filtered.rows.map(item => item.name), ['match/landed']);
  assert.deepEqual(filtered.groups.flatMap(group => group.rows), filtered.rows);
  assert.deepEqual(filtered.active, []); assert.deepEqual(filtered.landed, filtered.rows);
  assert.deepEqual(all.active, all.rows.filter(item => item.state !== 'merged'));
  assert.deepEqual(all.landed, all.rows.filter(item => item.state === 'merged'));
  for (const key of ['counts', 'total', 'removable', 'updatable']) assert.deepEqual(filtered[key], all[key]);
  const empty = buildBranches(data, { query: 'match/', filter: 'unsaved' });
  assert.equal(empty.visible, 0); assert.equal(empty.matched, 3); assert.deepEqual(empty.active, []); assert.deepEqual(empty.landed, []);
});

test('branchState is pure and prefers the queue over local Git facts', () => {
  const dirty = row('x', { changeCount: 2, ahead: 1, request: 'merging' });
  assert.equal(branchState(dirty).state, 'merging');
  assert.deepEqual(branchState(dirty), branchState(dirty));
  assert.equal(branchState(row('x', { ahead: 1, terminal: { status: 'working' } })).state, 'working');
  assert.equal(branchState(row('x', { terminal: { status: 'working', step: 'Leyendo el código' } })).detail, 'Leyendo el código');
  assert.equal(branchState(row('x', { ahead: 1, conflicts: ['a.js', 'b/c.js', 'd.js'] }), 'dev').detail, 'a.js y 2 más chocan con dev');
  assert.equal(branchState(row('main', { isBase: true })).detail, 'Al día');
  assert.equal(branchState(row('x', { ahead: 1, error: 'boom' })).detail, 'Git no pudo leer esta rama');
});

test('the road to main is four steps, or three without tests', () => {
  const states = path => path.steps.map(step => `${step.label}:${step.state}`).join(' ');
  const describe = (extra, options) => branchPath(buildBranches({ base: { branch: 'main' }, branches: [row('x', extra)] }).rows[0], { base: 'main', ...options });
  assert.equal(states(describe({ changeCount: 2, work: 'dirty' }, { checks: 'npm test' })), 'Guardada:now Al día:todo Tests:todo En main:todo');
  assert.equal(states(describe({ ahead: 2, work: 'ready' }, { checks: 'npm test' })), 'Guardada:done Al día:done Tests:now En main:todo');
  assert.equal(states(describe({ ahead: 2, behind: 1, work: 'ready' })), 'Guardada:done Al día:now En main:todo');
  assert.equal(states(describe({ ahead: 2, behind: 1, conflicts: ['a.js'], work: 'ready' }, { checks: 'npm test' })), 'Guardada:done Al día:fail Tests:todo En main:todo');
  assert.equal(states(describe({ ahead: 2, request: 'failed', work: 'ready' }, { checks: 'npm test' })), 'Guardada:done Al día:done Tests:fail En main:todo');
  const landed = describe({}, { checks: 'npm test' });
  assert.equal(landed.done, landed.total);
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
  assert.deepEqual(cardLocations(cards, []).map(item => item.label), ['Proyecto', 'Sesión cerrada · 362f2765']);
  const content = contentByBranch({ cards, skills: [{ name: 's', origin: 'worktree', branch }, { name: 'p', origin: 'project' }] });
  assert.equal(content.get(branch).cards.length, 2); assert.equal(content.get(branch).skills.length, 1); assert.equal(content.has('main'), false);
  assert.deepEqual(buildDesk(cards, [], '', branch).cards.map(card => card.id), ['b', 'c']);
  assert.equal(buildDesk(cards, []).total, 4);
});
