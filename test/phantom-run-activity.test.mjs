import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../host/store.mjs';
import { handleIntegration } from '../integrations/index.mjs';

async function fixture(t, checks = [{ name: 'Pruebas' }, { name: 'Build' }]) {
  const home = await mkdtemp(path.join(tmpdir(), 'phantom-activity-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cli = path.join(home, 'inert.mjs');
  await writeFile(cli, '// Not executed');
  const store = new Store(path.join(home, 'host'));
  const workspace = store.transaction(() => store.open(home));
  const events = [];
  const context = { dataDir: store.dir, state: store.state, getWorkspace: id => store.getWorkspace(id), persist: () => store.persist(), execFile: async (_file, args) => {
    if (args.includes('show')) return { stdout: JSON.stringify({ id: 'task_activity', contract: { workspace: home, checks } }) };
    if (args.includes('events')) return { stdout: JSON.stringify(events) };
    throw new Error('Not a Git workspace');
  } };
  const call = async (method, payload) => {
    const response = await handleIntegration(method, { workspaceId: workspace.id, ...payload }, context);
    assert.equal(response.handled, true);
    return response.result;
  };
  await call('plugins.update', { id: 'phantom', patch: { config: { phantomPath: cli } } });
  const add = (type, data = {}, run_id = 'first') => events.push({ seq: events.length + 1, run_id, task_id: 'task_activity', at: new Date(1794787200000 + events.length * 1000).toISOString(), type, data });
  return { add, activity: () => call('phantom.events', { id: 'task_activity', view: 'activity' }) };
}

test('preflight bloqueado muestra checks iniciales nombrados y motivo', async t => {
  const f = await fixture(t);
  f.add('run.started');
  for (const [id, code] of [['p1', 0], ['p2', 1], ['p3', 0]]) {
    f.add('process.intended', { id, kind: 'check' });
    f.add('process.prepared', { id });
    f.add('process.authorized', { id });
    f.add('process.exited', { id, code, quiet: true });
  }
  f.add('run.error', { reason: 'Las comprobaciones no acreditan pruebas suficientes' });
  f.add('task.blocked', { reason: 'Las comprobaciones no acreditan pruebas suficientes', result: { artifacts: '/private' } });
  const result = await f.activity();
  assert.deepEqual(result.items.map(step => [step.tool, step.target, step.status]), [['check', 'Pruebas', 'done'], ['check', 'Build', 'error'], ['check', 'Pruebas', 'done']]);
  assert.match(result.reason, /no acreditan/);
  assert.equal(result.runs[0].reason, result.reason);
  assert.equal(result.total, 3);
  assert.equal(result.model, null);
  assert.doesNotMatch(JSON.stringify(result), /private|artifacts|quiet/);
});

test('checks sin nombre usan su orden y no incluyen procesos ajenos al preflight', async t => {
  const f = await fixture(t, []);
  f.add('run.started');
  f.add('process.intended', { id: 'executor', kind: 'executor' });
  f.add('process.intended', { id: 'initial', kind: 'check' });
  f.add('process.exited', { id: 'initial', code: null, signal: 'SIGTERM' });
  f.add('preflight.admitted');
  f.add('process.intended', { id: 'later', kind: 'check' });
  const result = await f.activity();
  assert.equal(result.total, 1);
  assert.equal(result.items[0].target, 'Check 1');
  assert.equal(result.items[0].status, 'error');
});

test('acciones y verificación mantienen orden y reemplazan procesos por resultados', async t => {
  const f = await fixture(t);
  f.add('run.started');
  f.add('process.intended', { id: 'baseline', kind: 'check' });
  assert.equal((await f.activity()).items[0].status, 'running');
  f.add('process.exited', { id: 'baseline', code: 0 });
  f.add('preflight.admitted');
  f.add('model.requested', { model: 'gpt-6.1-sol' });
  f.add('action.intended', { callID: 'read', tool: 'read', args: { filePath: '/work/file' } });
  f.add('action.observed', { callID: 'read', output: 'SECRET' });
  f.add('task.verifying');
  f.add('process.intended', { id: 'verify', kind: 'check' });
  f.add('process.exited', { id: 'verify', code: 0 });
  const pending = await f.activity();
  assert.equal(pending.items.at(-1).tool, 'verify');
  assert.equal(pending.items.at(-1).status, 'running');
  f.add('verification.recorded', { round: 0, checks: [{ name: 'Pruebas', passed: true }, { name: 'Build', passed: false }] });
  const result = await f.activity();
  assert.deepEqual(result.items.map(step => [step.tool, step.status]), [['check', 'done'], ['read', 'done'], ['verify', 'done'], ['verify', 'error']]);
  assert.deepEqual(result.items.slice(-2).map(step => step.target), ['Pruebas', 'Build']);
  assert.equal(result.model, 'gpt-6.1-sol');
  assert.equal(result.reason, null);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  f.add('task.verifying');
  f.add('process.intended', { id: 'verify-again', kind: 'check' });
  f.add('verification.recorded', { round: 1, checks: [{ name: 'Build', passed: true }] });
  assert.equal((await f.activity()).items.at(-1).status, 'done');
  assert.equal((await f.activity()).total, 5);
});

test('dos intentos conservan historial y limitan cada lista; campos planos son del último', async t => {
  const f = await fixture(t);
  f.add('run.started');
  f.add('model.requested', { model: 'old-model' });
  for (let i = 0; i < 43; i++) f.add('action.intended', { callID: `old-${i}`, tool: 'read', args: { filePath: 'old' } });
  f.add('task.blocked', { reason: 'Primer bloqueo' });
  f.add('run.started', {}, 'second');
  f.add('run.error', { reason: 'Segundo bloqueo' }, 'second');
  let result = await f.activity();
  assert.equal(result.total, 0);
  assert.equal(result.reason, 'Segundo bloqueo');
  assert.equal(result.runs.length, 2);
  for (let i = 0; i < 45; i++) f.add('action.intended', { callID: `new-${i}`, tool: 'read', args: { filePath: 'new' } }, 'second');
  result = await f.activity();
  assert.deepEqual(result.runs.map(run => [run.runId, run.attempt, run.total, run.steps.length]), [['first', 1, 43, 40], ['second', 2, 45, 40]]);
  assert.equal(result.runs[0].reason, 'Primer bloqueo');
  assert.equal(result.runId, 'second');
  assert.equal(result.model, null);
  assert.equal(result.total, 45);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.items, result.runs[1].steps);
  assert.equal(result.items[0].id, 'new-5');
});
