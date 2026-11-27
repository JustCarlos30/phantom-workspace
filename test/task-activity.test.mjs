import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskProjection, TYPE_TABLE, ACTIVITY_ONLY } from '../shared/task-activity.mjs';
import { createWorkspaceEvents } from '../shared/workspace-events.mjs';
import { createTaskRegistry, MAX_TASKS } from '../host/task-registry.mjs';

const CLOSED_TYPES = [
  'task.created', 'task.running', 'task.verifying', 'task.completed', 'task.blocked', 'task.cancelled', 'task.admission_blocked',
  'run.started', 'run.error', 'preflight.admitted', 'verification.recorded', 'judge.started', 'judge.verdict',
  'child.created', 'child.started', 'child.reused', 'child.settled', 'child.delivery_accepted', 'child.failed_local', 'child.skipped',
  'coordination.failed', 'recovery.claimed', 'recovery.unresolved', 'recovery.abandoned', 'recovery.reconciled',
  'git.committed', 'integration.publication_intended',
];
const entry = { workspaceId: 'ws1', ownerNodeId: 'n1', goal: 'Objetivo' };
const ev = (type, payload = {}, extra = {}) => ({ data: { taskId: 't1', runId: 'r1', type, payload, ...extra } });

test('TYPE_TABLE cubre toda la lista cerrada', () => {
  for (const t of CLOSED_TYPES) assert.ok(Object.hasOwn(TYPE_TABLE, t), `falta ${t}`);
  assert.equal(Object.keys(TYPE_TABLE).length, CLOSED_TYPES.length);
  assert.deepEqual([...ACTIVITY_ONLY].sort(), ['git.committed', 'integration.publication_intended', 'recovery.claimed', 'recovery.reconciled']);
});

test('cada tipo produce raw o actividad sin lanzar', () => {
  for (const t of CLOSED_TYPES) {
    const p = createTaskProjection();
    const r = p.apply(ev(t, { key: 'k', taskId: 'c1', status: 'completed' }), entry);
    assert.equal(r.raw.length + r.activity.length, 1, t);
    assert.equal(ACTIVITY_ONLY.includes(t), r.activity.length === 1, t);
  }
});

test('fases de ejecución y repair tras verificación', () => {
  const p = createTaskProjection();
  const one = (t, pl) => p.apply(ev(t, pl), entry).raw[0];
  assert.deepEqual([one('task.created').status, one('task.created').phase], ['working', 'waiting']);
  assert.equal(one('preflight.admitted').phase, 'waiting');
  assert.equal(one('run.started').phase, 'waiting');
  const run = one('task.running');
  assert.deepEqual([run.phase, run.round], ['agent', 0]);
  assert.equal(one('task.verifying').phase, 'checks');
  assert.equal(one('verification.recorded').phase, 'checks');
  const rep = one('task.running');
  assert.deepEqual([rep.phase, rep.round], ['repair', 1]);
  assert.equal(one('judge.started').phase, 'judge');
  assert.equal(one('judge.verdict', { passed: true }).phase, 'checks');
});

test('un run nuevo reinicia la ronda', () => {
  const p = createTaskProjection();
  p.apply(ev('verification.recorded'), entry);
  const r = p.apply(ev('task.running', {}, { runId: 'r2' }), entry).raw[0];
  assert.deepEqual([r.phase, r.round], ['agent', 0]);
});

test('cierres: review con acceptance, blocked con reason, cancelled', () => {
  const p = createTaskProjection();
  const done = p.apply(ev('task.completed', { closure: { acceptance: 'accepted', integration: 'not_recorded' } }), entry).raw[0];
  assert.deepEqual([done.status, done.acceptance], ['review', 'accepted']);
  for (const t of ['task.blocked', 'task.admission_blocked', 'run.error', 'coordination.failed', 'recovery.unresolved']) {
    const r = p.apply(ev(t, { reason: 'motivo' }), entry).raw[0];
    assert.deepEqual([r.status, r.reason], ['blocked', 'motivo'], t);
  }
  for (const t of ['task.cancelled', 'recovery.abandoned']) {
    assert.equal(p.apply(ev(t, { reason: 'x' }), entry).raw[0].status, 'cancelled', t);
  }
});

test('child.* proyecta fase children en el padre con progress', () => {
  const p = createTaskProjection();
  const a = p.apply(ev('child.created', { key: 'a', taskId: 'c1' }), entry).raw[0];
  assert.deepEqual([a.entityId, a.phase, a.status], ['t1', 'children', 'working']);
  assert.deepEqual(a.progress, { done: 0, total: 1, blocked: 0 });
  p.apply(ev('child.reused', { key: 'b', taskId: 'c2' }), entry);
  p.apply(ev('child.created', { key: 'c', taskId: 'c3' }), entry);
  p.apply(ev('child.created', { key: 'd', taskId: 'c4' }), entry);
  p.apply(ev('child.settled', { key: 'a', taskId: 'c1', status: 'completed' }), entry);
  p.apply(ev('child.delivery_accepted', { key: 'b', taskId: 'c2' }), entry);
  p.apply(ev('child.failed_local', { key: 'c', taskId: 'c3' }), entry);
  const last = p.apply(ev('child.skipped', { key: 'd', taskId: 'c4' }), entry).raw[0];
  assert.deepEqual(last.progress, { done: 3, total: 4, blocked: 1 });
});

test('tipo desconocido se ignora y se cuenta', () => {
  const p = createTaskProjection();
  const r = p.apply(ev('algo.nuevo'), entry);
  assert.deepEqual(r, { raw: [], activity: [] });
  p.apply(ev('algo.nuevo'), entry);
  assert.equal(p.stats().unknown, 2);
  assert.equal(p.stats().unknownTypes['algo.nuevo'], 2);
});

test('estado por tarea exportable y restaurable', () => {
  const p = createTaskProjection();
  p.apply(ev('verification.recorded'), entry);
  p.apply(ev('child.created', { key: 'a' }), entry);
  const state = JSON.parse(JSON.stringify(p.exportState()));
  const q = createTaskProjection();
  assert.equal(q.restoreState(state), true);
  assert.equal(q.restoreState({ tasks: 'x' }), false);
  const r = q.apply(ev('task.running'), entry).raw[0];
  assert.deepEqual([r.phase, r.round], ['repair', 1]);
  assert.equal(q.apply(ev('child.created', { key: 'b' }), entry).raw[0].progress.total, 2);
});

test('registro: remember/get/list persisten de forma atómica', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
  const file = path.join(dir, 'tasks.json');
  const a = createTaskRegistry({ file });
  a.remember({ taskId: 'p', workspaceId: 'ws1', ownerNodeId: 'n1', goal: 'G', via: 'cli' });
  a.remember({ taskId: 'c', workspaceId: 'ws1', parentId: 'p' });
  a.remember({ taskId: 'o', workspaceId: 'ws2' });
  assert.deepEqual(fs.readdirSync(dir), ['tasks.json']);
  const b = createTaskRegistry({ file });
  assert.equal(b.get('p').ownerNodeId, 'n1');
  assert.equal(b.list({ workspaceId: 'ws1' }).length, 2);
  assert.equal(b.get('nada'), null);
  fs.writeFileSync(file, '{corrupto');
  assert.equal(createTaskRegistry({ file }).list().length, 0);
});

test('registro: resolve hereda del ancestro más cercano y nunca inventa dueño', () => {
  const r = createTaskRegistry({});
  r.remember({ taskId: 'root', workspaceId: 'ws1', ownerNodeId: 'n1' });
  r.remember({ taskId: 'mid', workspaceId: 'ws1', parentId: 'root' });
  r.remember({ taskId: 'leaf', workspaceId: 'ws1', parentId: 'mid' });
  r.remember({ taskId: 'own', workspaceId: 'ws1', ownerNodeId: 'n9', parentId: 'root' });
  r.remember({ taskId: 'huerfana', workspaceId: 'ws1', parentId: 'desconocida' });
  r.remember({ taskId: 'a', workspaceId: 'ws1', parentId: 'b' });
  r.remember({ taskId: 'b', workspaceId: 'ws1', parentId: 'a' });
  assert.equal(r.resolve('leaf').ownerNodeId, 'n1');
  assert.equal(r.resolve('own').ownerNodeId, 'n9');
  assert.equal(r.resolve('huerfana').ownerNodeId, undefined);
  assert.equal(r.resolve('a').ownerNodeId, undefined);
  assert.equal(r.resolve('nada'), null);
});

test('registro: acota a MAX_TASKS expulsando las cerradas más antiguas', () => {
  let t = 0;
  const r = createTaskRegistry({ now: () => (t += 1) });
  for (let i = 0; i < MAX_TASKS; i += 1) r.remember({ taskId: `t${i}`, workspaceId: 'ws1' });
  r.close('t5');
  r.close('t2');
  r.remember({ taskId: 'nueva', workspaceId: 'ws1' });
  assert.equal(r.list().length, MAX_TASKS);
  assert.equal(r.get('t5'), null);
  assert.ok(r.get('t2'));
  assert.ok(r.get('t0'));
  assert.ok(r.get('nueva'));
});

test('e2e: hija con parentTaskId sin dueño resoluble es visible al workspace y no al owner de otro nodo', () => {
  const registry = createTaskRegistry({});
  registry.remember({ taskId: 'hija', workspaceId: 'ws1', parentId: 'padre-desconocido', goal: 'Tarea hija' });
  const bus = createWorkspaceEvents();
  const projection = createTaskProjection();
  const resolved = registry.resolve('hija');
  assert.equal(resolved.ownerNodeId, undefined);
  const { raw } = projection.apply({ data: { taskId: 'hija', runId: 'r1', parentTaskId: 'padre-desconocido', type: 'task.running', payload: {} } }, resolved);
  const out = raw.flatMap((r) => bus.ingest(r));
  assert.ok(out.length >= 1);
  const ws = bus.since('cHcxOjA', { workspaceIds: ['ws1'], audiences: ['workspace'] });
  assert.ok(ws.events.some((e) => e.entityId === 'hija' && e.parentId === 'padre-desconocido' && e.phase === 'agent'));
  const other = bus.since('cHcxOjA', { workspaceIds: ['ws1'], audiences: ['owner'], ownerNodeIds: ['otro-nodo'] });
  assert.equal(other.events.filter((e) => e.entityId === 'hija').length, 0);
});
