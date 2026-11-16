import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBranchBoard, buildCola, buildResumen, buildIncorporaciones, isReadyBranch, mergePath, ownerLabel } from './incorporaciones-model.mjs';

const branch = (patch = {}) => ({ nodeId: 'n1', title: 'Feature', branch: 'phantom/terminal-1', ahead: 2, behind: 0, uncommitted: 0, missing: false, status: 'idle', overlaps: [], ...patch });
const request = (status, patch = {}) => ({ id: `r-${status}`, nodeId: `n-${status}`, title: status, status, overlaps: [], ...patch });

test('summary formats counts, missing data and durations without mutating status', () => {
  const data = { stats: { queued: 3, returned: 2, oldestWaitMs: 7920000, mergedToday: 4, filesToday: 12, medianChecksMs: 38000, medianWaitMs: 120000 } };
  assert.deepEqual(buildResumen(data, 0).map(item => item.value), ['3', '2.2 h', '4 · 12 archivos', '2', '38 s', '2 min']);
  assert.deepEqual(buildResumen(undefined, 0).map(item => item.value), ['0', '—', '—', '0', '—', '—']);
  assert.equal(buildResumen({ queue: [{ status: 'queued', requestedAt: new Date(0).toISOString() }] }, 90000)[1].value, '1 min');
  assert.equal(data.stats.queued, 3);
});

test('automatic queue names Phantom and displays waiting time and history evidence', () => {
  const now = Date.parse('2026-11-14T18:00:00');
  const cola = buildCola({ auto: true, queue: [request('queued', { requestedAt: '2026-11-14T17:58:00' })], history: [request('merged', { finishedAt: '2026-11-14T17:30:00', fileCount: 2, checks: { durationMs: 38000 }, by: 'auto' })] }, now);
  assert.equal(cola.orchestrator, '1 rama en cola; se integran solas');
  assert.match(cola.next[0].detail, /Espera 2 min/);
  assert.match(cola.today[0].detail, /2 archivos · Tests 38 s · Automática/);
  assert.equal(buildCola({ auto: true, queue: [request('merging')] }).now[0].detail, 'Phantom la está integrando');
  const path = mergePath(request('queued'), { auto: true, orchestrator: false });
  assert.deepEqual(path.missing, ['Que Phantom la integre']); assert.equal(path.owner, 'phantom');
});

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

test('a working branch names, in order, what it still lacks before main', () => {
  const dirty = mergePath(branch({ uncommitted: 3, status: 'working', behind: 2 }), { base: 'main', checks: 'npm test' });
  assert.equal(states(dirty), 'saved:now current:todo tests:todo landed:todo');
  assert.deepEqual(dirty.steps.map(step => step.label), ['Guardada', 'Al día', 'Tests', 'En main']);
  assert.deepEqual(dirty.missing, ['Que el agente termine', 'Guardar 3 archivos', 'Enviarla a la cola']);
  assert.deepEqual(dirty.notes, ['Le faltan 2 commits de main']);
  assert.equal(dirty.owner, 'session');
  const empty = mergePath(branch({ ahead: 0, uncommitted: 0, running: false }));
  assert.equal(states(empty), 'saved:now current:todo landed:todo');
  assert.deepEqual(empty.missing, ['Guardar el primer cambio', 'Enviarla a la cola']);
  assert.deepEqual(empty.notes, ['Su sesión está en pausa']);
  const clean = mergePath(branch());
  assert.equal(states(clean), 'saved:done current:done landed:now');
  assert.deepEqual(clean.missing, ['Enviarla a la cola']);
  assert.equal(mergePath(branch({ status: 'blocked', step: 'Falta una decisión' })).owner, 'you');
  assert.deepEqual(mergePath(branch({ missing: true })).missing, ['Git no encuentra la rama']);
});

test('a request waits on the orchestrator, or returns to its session with the reason', () => {
  const queued = mergePath(request('queued', { position: 2, stale: true }), { checks: 'npm test' });
  assert.equal(states(queued), 'saved:done current:done tests:now landed:todo');
  assert.deepEqual(queued.missing, ['Que el orquestador la integre · turno 2']);
  assert.equal(queued.owner, 'orchestrator');
  assert.equal(queued.notes.length, 1);
  const orphan = mergePath(request('queued'), { orchestrator: false });
  assert.equal(orphan.owner, 'you');
  assert.equal(orphan.missing[0], 'Abrir el orquestador');
  const conflict = mergePath(request('conflict', { conflicts: ['a.js', 'b.js'] }), { base: 'main', checks: 'npm test' });
  assert.equal(states(conflict), 'saved:done current:fail tests:todo landed:todo');
  assert.deepEqual(conflict.missing, ['Resolver el conflicto en a.js, b.js', 'Poner la rama al día con main y volver a enviarla']);
  assert.equal(conflict.owner, 'session');
  const failed = mergePath(request('failed', { checks: { command: 'npm test' } }), { checks: 'npm test' });
  assert.equal(states(failed), 'saved:done current:done tests:fail landed:todo');
  const merged = mergePath(request('merged', { behind: 4 }), { checks: 'npm test' });
  assert.equal(merged.done, merged.total);
  assert.deepEqual([merged.missing, merged.notes, ownerLabel(merged.owner)], [[], [], '']);
  assert.equal(ownerLabel('you'), 'Depende de ti');
  assert.equal(ownerLabel('session'), 'Depende de su sesión');
});

test('the branch board lists every unmerged branch, most urgent first, in the shared vocabulary', () => {
  const board = buildBranchBoard({
    available: true, base: { branch: 'main' }, checks: { command: '' }, orchestrator: { nodeId: 'o' },
    queue: [request('queued', { id: 'q1', position: 1 }), request('merging'), request('conflict')],
    active: [branch({ nodeId: 'w', status: 'working', uncommitted: 1 }), branch({ nodeId: 'u', uncommitted: 2 }), branch({ nodeId: 'r' }), branch({ nodeId: 'b', status: 'blocked' })],
    history: [request('merged')],
  });
  assert.deepEqual(board.rows.map(row => [row.key, row.state, row.label]), [['r-conflict', 'conflict', 'Conflicto'], ['b', 'blocked', 'Bloqueada'], ['r-merging', 'merging', 'Integrando'], ['q1', 'queued', 'En cola'], ['r', 'ready', 'Lista'], ['w', 'working', 'Trabajando'], ['u', 'unsaved', 'Sin guardar']]);
  assert.deepEqual(board.counts, { total: 7, attention: 2, queued: 2, ready: 1, working: 2 });
  assert.equal(board.rows[0].path.steps.length, 3);
  assert.deepEqual(buildBranchBoard({ available: false }).rows, []);
  assert.deepEqual(buildBranchBoard(undefined).counts.total, 0);
});

test('Cola shows what is integrating now, what follows and what came back; unsent branches stay out', () => {
  const now = Date.parse('2026-11-14T18:00:00');
  const cola = buildCola({
    available: true, base: { branch: 'main' }, orchestrator: { nodeId: 'o', title: 'Orquestador' },
    queue: [request('conflict', { conflicts: ['src/Canvas.jsx'] }), request('queued', { id: 'q1', title: 'Uno', position: 2, fileCount: 5 }), request('merging', { title: 'Glifos' }), request('queued', { id: 'q2', title: 'Dos', position: 4 }), request('failed')],
    active: [branch({ nodeId: 'ready' })],
    history: [request('merged', { finishedAt: '2026-11-14T17:30:00' }), request('rejected', { note: 'Fuera de alcance', updatedAt: '2026-11-10T10:00:00' }), request('withdrawn', { updatedAt: '2026-11-10T09:00:00' })],
  }, now);
  assert.equal(cola.orchestrator, 'El orquestador está integrando «Glifos»');
  assert.deepEqual(cola.now.map(row => [row.label, row.tone, row.detail]), [['Integrando', 'working', 'El orquestador la está integrando']]);
  assert.deepEqual(cola.next.map(row => [row.key, row.label, row.detail]), [['q1', 'En cola', 'Turno 1 · 5 archivos'], ['q2', 'En cola', 'Turno 2']]);
  assert.deepEqual(cola.returned.map(row => [row.label, row.detail]), [['Conflicto', 'Canvas.jsx choca con main'], ['Conflicto', 'Los tests fallaron']]);
  assert.deepEqual(cola.today.map(row => [row.label, row.detail]), [['En main', 'hace 30 min']]);
  assert.deepEqual(cola.earlier.map(row => [row.label, row.detail]), [['Rechazada', 'Fuera de alcance · hace 4 d'], ['Retirada', 'hace 4 d']]);
  assert.deepEqual(cola.counts, { now: 1, next: 2, returned: 2, open: 5 });
  assert.equal(buildCola({ available: true, queue: [], active: [], history: [] }).orchestrator, 'Sin orquestador abierto');
  assert.equal(buildCola({ orchestrator: {}, queue: [request('queued')] }).orchestrator, 'El orquestador tiene 1 rama en cola');
  assert.equal(buildCola({ orchestrator: {} }).orchestrator, 'El orquestador está en espera');
});
