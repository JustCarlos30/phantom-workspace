import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { validateState } from '../host/store.mjs';
import { validatePlan, applyPlanOp, PHASE_STATUSES } from '../host/agents.mjs';
import { nextPlanStep } from '../host/plan-chain.mjs';
import { main as agentCLI } from '../scripts/agent.mjs';

fs.mkdirSync('/tmp/opencode', { recursive: true });
const NOW = '2026-11-23T10:00:00.000Z', LATER = '2026-11-23T11:00:00.000Z';
const A = 'task_0000aaaa', B = 'task_0000bbbb';
const valid = () => ({ title: 'Rediseño', chain: false, source: 'agent', updatedAt: NOW, phases: [{ key: 'one', title: 'Uno', status: 'pending' }, { key: 'two', title: 'Dos', status: 'pending' }] });
const running = (chain, second = { taskId: B }) => ({ ...valid(), chain, phases: [{ key: 'one', title: 'Uno', status: 'running', taskId: A, startedAt: NOW }, { key: 'two', title: 'Dos', status: 'pending', ...second }] });

async function fixture(t) {
  const root = fs.mkdtempSync('/tmp/opencode/phantom-plan-'), dataDir = path.join(root, 'state');
  const handleIntegration = async (method, p) => {
    if (method === 'phantom.detail') {
      if (![A, B].includes(p.id)) throw new Error('Phantom task belongs to another workspace');
      return { handled: true, result: { id: p.id, kind: 'task', status: 'ready', contract: { goal: 'Fase' } } };
    }
    return { handled: false };
  };
  let host = await createHost({ dataDir, handleIntegration });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const w = await host.invoke('workspace.open', { path: root });
  const { node, session } = await host.invoke('terminal.create', { workspaceId: w.id, shell: '/bin/sh' });
  const plan = op => host.invoke('terminal.agent.plan', { sessionId: session.id, op });
  return { w, node, session, plan, get host() { return host; }, restart: async () => { await host.close(); host = await createHost({ dataDir, handleIntegration }); } };
}

test('validatePlan acepta un plan válido', () => {
  assert.deepEqual(PHASE_STATUSES, ['pending', 'running', 'done', 'blocked']);
  const plan = { ...running(true), phases: [...running(true).phases, { key: 'three', title: 'Tres', status: 'blocked', note: 'falló', endedAt: LATER }] };
  assert.equal(validatePlan(plan), plan);
});

test('validatePlan rechaza claves desconocidas en plan y fase', () => {
  assert.throws(() => validatePlan({ ...valid(), extra: 1 }), /clave desconocida/);
  const plan = valid(); plan.phases[0].owner = 'x';
  assert.throws(() => validatePlan(plan), /clave de fase desconocida/);
});

test('validatePlan rechaza key duplicada o mal formada', () => {
  const plan = valid(); plan.phases[1].key = 'one';
  assert.throws(() => validatePlan(plan), /duplicada/);
  plan.phases[1].key = 'Dos';
  assert.throws(() => validatePlan(plan), /key de fase inválida/);
});

test('validatePlan rechaza estado inválido y taskId mal formado', () => {
  const plan = valid(); plan.phases[0].status = 'completed';
  assert.throws(() => validatePlan(plan), /estado de fase inválido/);
  plan.phases[0].status = 'pending'; plan.phases[0].taskId = 'card-1';
  assert.throws(() => validatePlan(plan), /taskId/);
});

test('validatePlan rechaza más de 16 fases y ninguna', () => {
  const phases = Array.from({ length: 17 }, (_, i) => ({ key: `p${i}`, title: `F${i}`, status: 'pending' }));
  assert.throws(() => validatePlan({ ...valid(), phases }), /entre 1 y 16/);
  assert.throws(() => validatePlan({ ...valid(), phases: [] }), /entre 1 y 16/);
  assert.ok(validatePlan({ ...valid(), phases: phases.slice(0, 16) }));
});

test('validatePlan rechaza títulos multilínea o largos y notas largas', () => {
  assert.throws(() => validatePlan({ ...valid(), title: 'a\nb' }), /una línea/);
  assert.throws(() => validatePlan({ ...valid(), title: 'x'.repeat(161) }), /una línea/);
  const plan = valid(); plan.phases[0].note = 'n'.repeat(301);
  assert.throws(() => validatePlan(plan), /note/);
});

test('validatePlan rechaza dos fases en curso', () => {
  const plan = valid(); for (const p of plan.phases) p.status = 'running';
  assert.throws(() => validatePlan(plan), /una fase en curso/);
});

test('applyPlanOp set, start, task y done', () => {
  let plan = applyPlanOp(undefined, { type: 'set', title: 'Plan', chain: true, phases: [{ key: 'one', title: 'Uno' }, { key: 'two', title: 'Dos', taskId: B }] }, NOW);
  assert.deepEqual(plan, { title: 'Plan', chain: true, phases: [{ key: 'one', title: 'Uno', status: 'pending' }, { key: 'two', title: 'Dos', status: 'pending', taskId: B }], source: 'agent', updatedAt: NOW });
  assert.equal(applyPlanOp(undefined, { type: 'set', title: 'P', phases: [{ key: 'a', title: 'A' }] }, NOW).chain, false);
  const before = structuredClone(plan);
  plan = applyPlanOp(plan, { type: 'start', key: 'one', taskId: A }, LATER);
  assert.deepEqual(before.phases[0], { key: 'one', title: 'Uno', status: 'pending' });
  assert.deepEqual(plan.phases[0], { key: 'one', title: 'Uno', status: 'running', taskId: A, startedAt: LATER });
  assert.equal(plan.updatedAt, LATER);
  plan = applyPlanOp(plan, { type: 'task', key: 'one', taskId: B }, LATER);
  assert.equal(plan.phases[0].taskId, B);
  plan = applyPlanOp(plan, { type: 'done', key: 'one', note: 'ok' }, LATER);
  assert.deepEqual(plan.phases[0], { key: 'one', title: 'Uno', status: 'done', taskId: B, startedAt: LATER, endedAt: LATER, note: 'ok' });
});

test('applyPlanOp block, reset y clear', () => {
  let plan = applyPlanOp(running(false), { type: 'block', key: 'one', note: 'sin modelo' }, LATER);
  assert.equal(plan.phases[0].status, 'blocked'); assert.equal(plan.phases[0].note, 'sin modelo');
  plan = applyPlanOp(plan, { type: 'reset', key: 'one' }, LATER);
  assert.deepEqual(plan.phases[0], { key: 'one', title: 'Uno', status: 'pending', taskId: A });
  assert.equal(applyPlanOp(plan, { type: 'clear' }), null);
});

test('applyPlanOp rechaza operaciones inválidas', () => {
  assert.throws(() => applyPlanOp(running(false), { type: 'start', key: 'two' }), /otra fase en curso/);
  assert.throws(() => applyPlanOp(valid(), { type: 'start', key: 'nope' }), /inexistente/);
  assert.throws(() => applyPlanOp(undefined, { type: 'done', key: 'one' }), /no hay plan/);
  assert.throws(() => applyPlanOp(valid(), { type: 'remove', key: 'one' }), /operación desconocida/);
  assert.throws(() => applyPlanOp(valid(), { type: 'done', key: 'one', status: 'x' }), /clave de operación/);
  assert.throws(() => applyPlanOp(valid(), { type: 'block', key: 'one' }), /note/);
  assert.throws(() => applyPlanOp(valid(), { type: 'start', key: 'one', taskId: 'bad' }), /taskId/);
  const done = applyPlanOp(valid(), { type: 'done', key: 'one' });
  assert.throws(() => applyPlanOp(done, { type: 'task', key: 'one', taskId: A }), /pendiente o en curso/);
  assert.throws(() => applyPlanOp(undefined, { type: 'set', title: 'P', phases: [{ key: 'a', title: 'A', status: 'done' }] }), /clave de fase/);
});

test('nextPlanStep: completado sin chain marca done y no lanza', () => {
  const { plan, launch } = nextPlanStep(running(false), { taskId: A, taskStatus: 'completed', controllerStatus: 'completed' }, LATER);
  assert.equal(launch, null);
  assert.equal(plan.phases[0].status, 'done'); assert.equal(plan.phases[0].endedAt, LATER);
  assert.equal(plan.phases[1].status, 'pending');
});

test('nextPlanStep: con chain lanza la siguiente fase registrada', () => {
  const input = running(true), { plan, launch } = nextPlanStep(input, { taskId: A, taskStatus: 'completed' }, LATER);
  assert.equal(launch, B);
  assert.equal(plan.phases[0].status, 'done');
  assert.deepEqual(plan.phases[1], { key: 'two', title: 'Dos', status: 'running', taskId: B, startedAt: LATER });
  assert.equal(input.phases[0].status, 'running');
  validatePlan(plan);
});

test('nextPlanStep: con chain pero sin taskId en la siguiente no lanza', () => {
  const { plan, launch } = nextPlanStep(running(true, {}), { taskId: A, taskStatus: 'completed' }, LATER);
  assert.equal(launch, null); assert.equal(plan.phases[0].status, 'done'); assert.equal(plan.phases[1].status, 'pending');
});

test('nextPlanStep: estado no completed bloquea sin lanzar', () => {
  for (const taskStatus of ['blocked', 'cancelled', 'ready', undefined]) {
    const { plan, launch } = nextPlanStep(running(true), { taskId: A, taskStatus, controllerStatus: 'failed' }, LATER);
    assert.equal(launch, null); assert.equal(plan.phases[0].status, 'blocked'); assert.equal(plan.phases[1].status, 'pending');
    assert.ok(plan.phases[0].note.length <= 300 && !/\n/.test(plan.phases[0].note));
    validatePlan(plan);
  }
});

test('nextPlanStep: taskId que no coincide con la fase en curso no cambia nada', () => {
  const input = running(true), result = nextPlanStep(input, { taskId: B, taskStatus: 'completed' }, LATER);
  assert.equal(result.plan, input); assert.equal(result.launch, null);
});

test('host: terminal.agent.plan persiste, aparece en el contexto y sobrevive a un node.update obsoleto', async t => {
  const f = await fixture(t);
  const stale = structuredClone((await f.host.invoke('state.get')).workspaces[0].nodes.find(n => n.id === f.node.id).data);
  const set = await f.plan({ type: 'set', title: 'Plan', chain: true, phases: [{ key: 'one', title: 'Uno' }, { key: 'two', title: 'Dos', taskId: B }] });
  assert.equal(set.phases.length, 2);
  const started = await f.plan({ type: 'start', key: 'one', taskId: A });
  assert.equal(started.phases[0].status, 'running'); assert.equal(started.phases[0].taskId, A);
  await assert.rejects(f.plan({ type: 'task', key: 'two', taskId: 'task_0000cccc' }), /another workspace/);
  await f.host.invoke('node.update', { workspaceId: f.w.id, id: f.node.id, patch: { data: { ...stale, fontSize: 18 } } });
  let context = await f.host.invoke('terminal.agent.context', { sessionId: f.session.id });
  assert.deepEqual(context.plan, started);
  assert.deepEqual((await f.host.invoke('terminal.list', { workspaceId: f.w.id }))[0].plan, started);
  assert.equal(await f.plan({ type: 'clear' }), null);
  context = await f.host.invoke('terminal.agent.context', { sessionId: f.session.id });
  assert.equal(context.plan, undefined);
});

test('host: rechaza una sesión que no es la actual del panel y acepta la actual perdida', async t => {
  const f = await fixture(t);
  await f.plan({ type: 'set', title: 'Plan', phases: [{ key: 'one', title: 'Uno' }] });
  const node = f.host.store.getWorkspace(f.w.id).nodes.find(n => n.id === f.node.id);
  node.data.sessionId = 'other-session';
  await assert.rejects(f.plan({ type: 'start', key: 'one' }), /sesión actual del panel/);
  node.data.sessionId = f.session.id;
  await f.restart();
  await assert.rejects(f.host.invoke('terminal.agent.report', { sessionId: f.session.id, patch: { step: 'x' } }), /current live/);
  const plan = await f.host.invoke('terminal.agent.plan', { sessionId: f.session.id, op: { type: 'done', key: 'one', note: 'hecho' } });
  assert.equal(plan.phases[0].status, 'done');
  assert.equal((await f.host.invoke('terminal.agent.context', { sessionId: f.session.id })).plan.phases[0].note, 'hecho');
});

test('validateState rechaza un plan inválido', async t => {
  const f = await fixture(t);
  const state = structuredClone(f.host.store.state);
  const terminal = state.workspaces[0].nodes.find(n => n.id === f.node.id);
  terminal.data.plan = valid();
  validateState(state);
  terminal.data.plan = { ...valid(), phases: valid().phases.map(p => ({ ...p, status: 'running' })) };
  assert.throws(() => validateState(state), /una fase en curso/);
  terminal.data.plan = { ...valid(), source: 'manual' };
  assert.throws(() => validateState(state), /source/);
});

test('CLI phases: argumentos inválidos dan USAGE antes de consultar el host', async () => {
  for (const args of [['phases'], ['phases', 'show', 'x'], ['phases', 'start'], ['phases', 'task', 'one'], ['phases', 'block', 'one'], ['phases', 'reset'], ['phases', 'clear', 'x'], ['phases', 'nope']])
    await assert.rejects(agentCLI(args, {}), /Uso: agent.mjs.*\nEncargos:.*\nProcesos:.*\nEntorno.*\n.*\n.*\nFases: phases show/);
  await assert.rejects(agentCLI(['phases', 'show'], {}), /identidad de terminal/);
});
