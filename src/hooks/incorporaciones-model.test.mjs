import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBranchBoard, buildIncorporaciones, isReadyBranch, mergePath, ownerLabel } from './incorporaciones-model.mjs';

const branch = (patch = {}) => ({ nodeId: 'n1', title: 'Feature', branch: 'phantom/terminal-1', ahead: 2, behind: 0, uncommitted: 0, missing: false, status: 'idle', overlaps: [], ...patch });
const request = (status, patch = {}) => ({ id: `r-${status}`, nodeId: `n-${status}`, title: status, status, overlaps: [], ...patch });

test('a branch is ready only with saved commits, a clean worktree and no agent mid-edit', () => {
  assert.equal(isReadyBranch(branch()), true);
  assert.equal(isReadyBranch(branch({ status: 'review' })), true);
  for (const patch of [{ ahead: 0 }, { ahead: null }, { uncommitted: 3 }, { uncommitted: null }, { missing: true }, { status: 'working' }, { status: 'blocked' }]) {
    assert.equal(isReadyBranch(branch(patch)), false, JSON.stringify(patch));
  }
  assert.equal(isReadyBranch(null), false);
});

test('ready lists queued requests in order first, then unrequested clean branches', () => {
  const data = {
    queue: [request('merging'), request('queued', { id: 'q1' }), request('conflict'), request('queued', { id: 'q2' }), request('failed')],
    active: [branch({ nodeId: 'a' }), branch({ nodeId: 'b', uncommitted: 2 }), branch({ nodeId: 'c', status: 'working' })],
    history: [request('merged'), request('rejected')],
  };
  const model = buildIncorporaciones(data);
  assert.equal(model.merging.status, 'merging');
  assert.deepEqual(model.ready.map(entry => [entry.kind, entry.item.id ?? entry.item.nodeId]), [['request', 'q1'], ['request', 'q2'], ['branch', 'a']]);
  assert.deepEqual(model.attention.map(item => item.status), ['conflict', 'failed']);
  assert.deepEqual(model.working.map(item => item.nodeId), ['b', 'c']);
  assert.deepEqual(model.counts, { cards: 5, ready: 3, queued: 2, unrequested: 1, attention: 2, working: 2, merged: 1, overlapping: 0 });
});

test('counts overlaps once per terminal and tolerates an empty status', () => {
  const data = { queue: [request('queued', { overlaps: [{ path: 'a', with: ['x'] }] })], active: [branch({ overlaps: [{ path: 'a', with: ['y'] }] })], history: [] };
  assert.equal(buildIncorporaciones(data).counts.overlapping, 2);
  const empty = buildIncorporaciones(undefined);
  assert.equal(empty.merging, null);
  assert.deepEqual(empty.counts, { cards: 0, ready: 0, queued: 0, unrequested: 0, attention: 0, working: 0, merged: 0, overlapping: 0 });
});

const states = path => path.steps.map(step => `${step.id}:${step.state}`).join(' ');

test('a working branch names, in order, what it still lacks before the merge', () => {
  const dirty = mergePath(branch({ uncommitted: 3, status: 'working', behind: 2 }), { base: 'main', checks: 'npm test' });
  assert.equal(states(dirty), 'commits:done saved:now requested:todo merge:todo checks:todo landed:todo');
  assert.deepEqual(dirty.missing, ['Que el agente termine su trabajo', 'Guardar 3 archivos en un commit', 'Enviar la solicitud de integración']);
  assert.deepEqual(dirty.notes, ['2 commits detrás de main']);
  assert.equal(dirty.owner, 'terminal');
  const empty = mergePath(branch({ ahead: 0, uncommitted: 0, running: false }));
  assert.equal(states(empty), 'commits:now saved:todo requested:todo merge:todo landed:todo');
  assert.deepEqual(empty.missing, ['Hacer el primer commit', 'Enviar la solicitud de integración']);
  assert.deepEqual(empty.notes, ['Su terminal no tiene sesión activa']);
  const clean = mergePath(branch());
  assert.equal(states(clean), 'commits:done saved:done requested:now merge:todo landed:todo');
  assert.deepEqual(clean.missing, ['Enviar la solicitud de integración']);
  assert.equal(mergePath(branch({ status: 'blocked', step: 'Falta una decisión' })).owner, 'you');
  assert.deepEqual(mergePath(branch({ missing: true })).missing, ['Git no encuentra la rama']);
});

test('a request waits on the orchestrator, or returns to its terminal with the reason', () => {
  const queued = mergePath(request('queued', { position: 2, stale: true }), { checks: 'npm test' });
  assert.equal(states(queued), 'commits:done saved:done requested:done merge:now checks:todo landed:todo');
  assert.deepEqual(queued.missing, ['Que el orquestador la incorpore · turno 2']);
  assert.equal(queued.owner, 'orchestrator');
  assert.equal(queued.notes.length, 1);
  const orphan = mergePath(request('queued'), { orchestrator: false });
  assert.equal(orphan.owner, 'you');
  assert.equal(orphan.missing[0], 'Abrir la sesión orquestadora');
  const conflict = mergePath(request('conflict', { conflicts: ['a.js', 'b.js'] }), { base: 'main', checks: 'npm test' });
  assert.equal(states(conflict), 'commits:done saved:done requested:done merge:fail checks:todo landed:todo');
  assert.deepEqual(conflict.missing, ['Resolver el conflicto en a.js, b.js', 'Traer main a la rama y volver a enviarla']);
  assert.equal(conflict.owner, 'terminal');
  const failed = mergePath(request('failed', { checks: { command: 'npm test' } }), { checks: 'npm test' });
  assert.equal(states(failed), 'commits:done saved:done requested:done merge:done checks:fail landed:todo');
  const merged = mergePath(request('merged', { behind: 4 }), { checks: 'npm test' });
  assert.equal(merged.done, merged.total);
  assert.deepEqual([merged.missing, merged.notes, ownerLabel(merged.owner)], [[], [], '']);
  assert.equal(ownerLabel('you'), 'Depende de ti');
});

test('the branch board lists every unmerged branch, most urgent first', () => {
  const board = buildBranchBoard({
    available: true, base: { branch: 'main' }, checks: { command: '' }, orchestrator: { nodeId: 'o' },
    queue: [request('queued', { id: 'q1', position: 1 }), request('merging'), request('conflict')],
    active: [branch({ nodeId: 'w', status: 'working', uncommitted: 1 }), branch({ nodeId: 'r' }), branch({ nodeId: 'b', status: 'blocked' })],
    history: [request('merged')],
  });
  assert.deepEqual(board.rows.map(row => [row.key, row.state]), [['r-conflict', 'conflict'], ['b', 'blocked'], ['r-merging', 'merging'], ['q1', 'queued'], ['r', 'ready'], ['w', 'working']]);
  assert.deepEqual(board.counts, { total: 6, attention: 2, queued: 2, ready: 1, working: 1 });
  assert.equal(board.rows[0].path.steps.length, 5);
  assert.deepEqual(buildBranchBoard({ available: false }).rows, []);
  assert.deepEqual(buildBranchBoard(undefined).counts.total, 0);
});
