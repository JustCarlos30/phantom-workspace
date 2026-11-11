import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhantom } from '../integrations/phantom.mjs';
import { buildCommandCenter, createCommandCenterMonitor, getCommandCenterMonitor } from '../src/plugins/commandCenter.js';
import { validatePluginSettings } from '../src/plugins/registry.js';
import { createHost } from '../host/server.mjs';
import { Store, validateState } from '../host/store.mjs';
import { phantom } from '../integrations/phantom.mjs';
import { HOST_METHODS } from '../desktop/security.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Acceptance API for the subsequent implementer (these modules do not exist yet):
// registry.js exports getPluginDescriptor(id), returning the Phantom descriptor:
// { id, title, version, configuration, panels: [{ id }], commands: [{ id }] }.
// commandCenter.js exports buildCommandCenter({ tasks, controllers }). Tasks are
// normalizePhantom results; controllers use the host's taskId/status fields.
// The result is an ordered array of { id, sourceStatus, controllerStatus, raw }.
// sourceStatus is the native task status, never inferred from a local process;
// controllerStatus is the matching controller status, or null when absent.
// Native blocked tasks precede active ones (native running OR local running),
// then other tasks. Preserve input order within each group and canonical raw.
// Dynamic imports deliberately occur INSIDE tests: missing future modules must
// produce ordinary node:test failures without preventing test discovery/reporting.

async function builder() {
  const module = await import('../src/plugins/commandCenter.js');
  assert.equal(typeof module.buildCommandCenter, 'function',
    'commandCenter.js must export buildCommandCenter({ tasks, controllers })');
  return module.buildCommandCenter;
}

function task(id, status) {
  return normalizePhantom({
    id, kind: 'card', ...(status === undefined ? {} : { status }),
    contract: { goal: `Goal ${id}`, workspace: '/acceptance/project' },
    nativeExtra: { evidence: ['native evidence'], revision: 3 },
  }, 'tasks');
}

function controller(taskId, status) {
  return { id: `controller_${taskId}`, taskId, status, action: 'run', source: 'phantom' };
}

test('normalization preserves unknown native status and the complete canonical raw object', () => {
  const raw = {
    id: 'task_unknown', kind: 'card', status: 'awaiting_external_review_v2',
    contract: { goal: 'Preserve native state', workspace: '/acceptance/project' },
    nativeExtra: { evidence: ['opaque'], nested: { retained: true } },
  };
  const before = structuredClone(raw);
  const normalized = normalizePhantom(raw, 'tasks');
  assert.equal(normalized.status, raw.status, 'Unknown statuses must not become ready/running/completed');
  assert.strictEqual(normalized.raw, raw, 'raw must remain the canonical source object');
  assert.deepEqual(raw, before, 'Normalization must not rewrite native fields');
  assert.equal(normalized.title, raw.contract.goal);
  assert.equal(normalized.source, 'phantom');
});

test('normalization retains native state fallback and does not invent a missing status', () => {
  const raw = { id: 'task_state', kind: 'card', state: 'future_native_state' };
  assert.equal(normalizePhantom(raw, 'tasks').status, raw.state,
    'Native state fallback must survive even when its value is unknown');
  const absent = normalizePhantom({ id: 'task_absent', kind: 'card' }, 'tasks');
  assert.equal(absent.status, undefined, 'No native state must not imply ready or success');
  assert.equal(normalizePhantom({ id: 'task_empty', status: '', state: 'ready' }, 'tasks').status, '',
    'An explicit native value must not be replaced by a fallback based on truthiness');
  assert.equal(normalizePhantom({ id: 'task_empty_only', status: '' }, 'tasks').status, '',
    'An explicit empty native status must survive normalization');
});

test('registry exposes an identifiable, versioned Phantom plugin with configuration, panels and commands', async () => {
  const registry = await import('../src/plugins/registry.js');
  assert.equal(typeof registry.getPluginDescriptor, 'function',
    'registry.js must export getPluginDescriptor(id) for plugin discovery');
  const descriptor = registry.getPluginDescriptor('phantom');
  assert.ok(descriptor, 'The registry must include the first-party Phantom plugin');
  assert.equal(descriptor.id, 'phantom');
  assert.equal(typeof descriptor.title, 'string');
  assert.ok(descriptor.title.trim(), 'Plugin identity needs a visible title');
  assert.match(descriptor.version, /^\d+\.\d+\.\d+(?:[-+].+)?$/, 'Plugin version must be explicit');
  assert.ok(descriptor.configuration && typeof descriptor.configuration === 'object',
    'The descriptor must declare its connection/preferences configuration');
  for (const field of ['panels', 'commands']) {
    assert.ok(Array.isArray(descriptor[field]) && descriptor[field].length > 0,
      `Phantom must declare discoverable ${field}`);
    const ids = descriptor[field].map(entry => entry.id);
    assert.ok(ids.every(id => typeof id === 'string' && id.trim()), `${field} need stable identifiers`);
    assert.equal(new Set(ids).size, ids.length, `${field} identifiers must be unique`);
  }
});

for (const status of ['running', 'completed', 'failed']) {
  test(`controller ${status} never overwrites the native blocked task state`, async () => {
    const buildCommandCenter = await builder();
    const source = task('task_blocked', 'blocked');
    const input = { tasks: [source], controllers: [controller(source.id, status)] };
    const before = structuredClone(input);
    const items = buildCommandCenter(input);
    assert.equal(items.length, 1, 'Each source task must have exactly one command-center item');
    assert.equal(items[0].id, source.id);
    assert.equal(items[0].sourceStatus, 'blocked',
      'Native task status remains authoritative regardless of controller lifecycle');
    assert.equal(items[0].controllerStatus, status,
      'Local controller lifecycle must be exposed separately from native state');
    assert.strictEqual(items[0].raw, source.raw, 'Command center must retain canonical raw');
    assert.deepEqual(input, before, 'Building the command center must not mutate tasks or controllers');
  });
}

test('command center preserves unknown and missing source states without unrelated controller leakage', async () => {
  const buildCommandCenter = await builder();
  const unknown = task('task_unknown', 'native_future_state');
  const absent = task('task_absent');
  const items = buildCommandCenter({
    tasks: [unknown, absent], controllers: [controller('task_unrelated', 'completed')],
  });
  assert.deepEqual(items.map(item => item.id), [unknown.id, absent.id],
    'Controllers without a matching task must not fabricate task entries');
  assert.equal(items[0].sourceStatus, 'native_future_state', 'Unknown native states must remain visible');
  assert.equal(items[1].sourceStatus, undefined, 'Missing native state must not become success');
  for (const [index, source] of [unknown, absent].entries()) {
    assert.equal(items[index].controllerStatus, null, 'No matching controller means explicit null');
    assert.strictEqual(items[index].raw, source.raw, 'Even unknown states retain canonical raw');
  }
});

test('blocked tasks precede native/local active tasks, with stable order and no input sorting', async () => {
  const buildCommandCenter = await builder();
  const tasks = [
    task('task_done', 'completed'),
    task('task_local_active', 'ready'),
    task('task_blocked_a', 'blocked'),
    task('task_native_active', 'running'),
    task('task_unknown', 'future_state'),
    task('task_blocked_b', 'blocked'),
    task('task_ready', 'ready'),
  ];
  const input = {
    tasks,
    controllers: [
      controller('task_local_active', 'running'),
      controller('task_blocked_b', 'running'),
      controller('task_ready', 'completed'),
    ],
  };
  const before = structuredClone(input);
  const items = buildCommandCenter(input);
  assert.deepEqual(items.map(item => item.id), [
    'task_blocked_a', 'task_blocked_b',
    'task_local_active', 'task_native_active',
    'task_done', 'task_unknown', 'task_ready',
  ], 'Blocked wins over local running; active includes native running; groups retain source order');
  assert.deepEqual(input, before, 'Ordering must not sort the caller-owned arrays in place');
  assert.equal(items.find(item => item.id === 'task_ready').sourceStatus, 'ready',
    'A completed controller does not mark its native task completed');
});

test('plugin settings persist per project through host restart and reject invalid API/import input', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'command-center-store-'));
  let host;
  t.after(async () => { await host?.close(); await rm(home, { recursive: true, force: true }); });
  await mkdir(path.join(home, 'a')); await mkdir(path.join(home, 'b'));
  host = await createHost({ dataDir: path.join(home, 'state') });
  const a = await host.invoke('workspace.open', { path: path.join(home, 'a') });
  const b = await host.invoke('workspace.open', { path: path.join(home, 'b') });
  const node = await host.invoke('node.create', { workspaceId: a.id, type: 'command-center' });
  const settings = { enabled: true, refreshMs: 3000 };
  await host.invoke('plugin.update', { workspaceId: a.id, id: 'phantom', settings });
  assert.deepEqual(await host.invoke('plugin.get', { workspaceId: b.id, id: 'phantom' }), { enabled: false, refreshMs: 4000 });
  for (const invalid of [null, [], {}, { ...settings, enabled: 'yes' }, { ...settings, refreshMs: 2999 }, { ...settings, refreshMs: 5001 }, { ...settings, refreshMs: 4000.5 }, { ...settings, path: '/external' }]) {
    assert.throws(() => validatePluginSettings('phantom', invalid));
    await assert.rejects(host.invoke('plugin.update', { workspaceId: a.id, id: 'phantom', settings: invalid }));
  }
  await assert.rejects(host.invoke('plugin.update', { workspaceId: a.id, id: 'external', settings }));
  await assert.rejects(host.invoke('plugin.get', { workspaceId: 'missing', id: 'phantom' }));
  const badImport = await host.invoke('state.get');
  badImport.workspaces[0].plugins.phantom.refreshMs = 1;
  assert.throws(() => validateState(badImport));
  await host.invoke('plugin.update', { workspaceId: a.id, id: 'phantom', settings: { ...settings, enabled: false } });
  await host.close(); host = null;
  const restored = new Store(path.join(home, 'state'));
  assert.deepEqual(restored.getWorkspace(a.id).plugins.phantom, { enabled: false, refreshMs: 3000 });
  assert.ok(restored.getWorkspace(a.id).nodes.some(n => n.id === node.id));
  assert.equal(restored.getWorkspace(b.id).plugins, undefined);
  for (const method of ['plugin.get', 'plugin.update', 'phantom.events']) assert.ok(HOST_METHODS.has(method));
});

test('events validate IDs and authorize exact worktree family before reading CLI events', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'command-center-events-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = path.join(home, 'project'), linked = path.join(home, 'linked'), foreign = path.join(home, 'foreign');
  for (const dir of [root, linked, foreign]) await mkdir(dir);
  const cli = path.join(home, 'synthetic-cli.mjs'); await writeFile(cli, '// Synthetic fixture; never executed.');
  const workspace = { id: 'fixture-project', path: root, canonicalPath: root };
  const calls = [];
  let nativeWorkspace = linked, returnedId = 'task_selected', invalidEvents = false;
  const context = { workspace, getWorkspace: () => workspace, state: { settings: { phantomPath: cli, phantomData: path.join(home, 'native') } }, execFile: async (file, args) => {
    calls.push({ file, args });
    if (file === 'git') return { stdout: `worktree ${root}\0\0worktree ${linked}\0\0`, stderr: '' };
    if (args.includes('show')) return { stdout: JSON.stringify({ id: returnedId, contract: { workspace: nativeWorkspace } }), stderr: '' };
    assert.ok(args.includes('events'));
    return { stdout: JSON.stringify(invalidEvents ? {} : Array.from({ length: 120 }, (_, id) => ({ id, type: 'synthetic.event' }))), stderr: '' };
  } };
  const read = id => phantom('phantom.events', { workspaceId: workspace.id, id }, context);
  for (const id of [undefined, '', '--all', '../task', 'a b', 'x;cmd', 'a'.repeat(201)]) await assert.rejects(read(id), /Invalid Phantom ID/);
  assert.equal(calls.length, 0, 'Invalid IDs must not invoke any transport');
  nativeWorkspace = foreign;
  await assert.rejects(read('task_selected'), /another workspace/);
  assert.ok(!calls.some(c => c.args.includes('events')), 'Foreign task events must never be read');
  nativeWorkspace = linked; returnedId = 'task_other';
  await assert.rejects(read('task_selected'), /ID mismatch/);
  assert.ok(!calls.some(c => c.args.includes('events')));
  returnedId = 'task_selected';
  const result = await read('task_selected');
  assert.equal(result.items.length, 100); assert.equal(result.items[0].id, 20); assert.equal(result.truncated, true);
  assert.ok(calls.findIndex(c => c.args.includes('show')) < calls.findIndex(c => c.args.includes('events')));
  invalidEvents = true; await assert.rejects(read('task_selected'), /invalid events/);
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function drain() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function monitorFixture(api, workspaceId = 'a') {
  let time = 0, serial = 0;
  const timers = new Map();
  const monitor = createCommandCenterMonitor({ api, workspaceId, now: () => time,
    schedule: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: time + delay }); return id; }, cancel: id => timers.delete(id) });
  return { monitor, timers, async tick(ms = 0) {
    time += ms;
    const due = [...timers].filter(([, timer]) => timer.at <= time);
    for (const [id, timer] of due) { timers.delete(id); timer.fn(); }
    await drain();
  } };
}

test('refresh serializes catalog and selected events, preserves good data, retries and pauses', async () => {
  const calls = [], gate = deferred(); let fail = false, slow = true;
  const f = monitorFixture(async (method, payload) => {
    calls.push({ method, payload });
    if (slow) { slow = false; await gate.promise; }
    if (fail) throw new Error('Synthetic offline');
    return method === 'phantom.list' ? { items: [task('task_a', 'blocked'), task('task_b', 'running')], controllers: [], observedAt: '2026-01-01T00:00:00Z' } : { items: [{ type: 'synthetic', taskId: payload.id }] };
  });
  const stop = f.monitor.subscribe(() => {});
  await f.tick(); assert.equal(calls.length, 1);
  await f.monitor.refresh(); await f.monitor.refresh();
  assert.equal(calls.length, 1, 'No overlapping catalog requests');
  gate.resolve(); await drain(); await f.tick(150);
  assert.equal(calls.length, 2);
  f.monitor.select('task_b'); await f.tick();
  assert.equal(calls.at(-1).method, 'phantom.events'); assert.equal(calls.at(-1).payload.id, 'task_b');
  assert.equal(calls.filter(c => c.method === 'phantom.events').length, 1, 'No event fan-out');
  const good = f.monitor.getState().tasks;
  fail = true; await f.tick(4000);
  assert.match(f.monitor.getState().error, /Synthetic offline/); assert.strictEqual(f.monitor.getState().tasks, good);
  fail = false; await f.tick(4000); assert.equal(f.monitor.getState().error, '');
  f.monitor.pause(true); const count = calls.length; await f.tick(10000); assert.equal(calls.length, count);
  await f.monitor.refresh(); assert.ok(calls.length > count, 'Manual refresh works while paused');
  f.monitor.pause(false); await f.tick();
  stop(); const stopped = calls.length; await f.tick(10000); assert.equal(calls.length, stopped);
  f.monitor.dispose();
});

test('late project/selection responses are isolated and disabling retains the last good data', async () => {
  const gate = deferred(), calls = [];
  let hold = false;
  const api = async (method, payload) => {
    calls.push({ method, ...payload });
    if (hold) await gate.promise;
    return method === 'phantom.list' ? { items: [task(`task_${payload.workspaceId}`, 'running')] } : { items: [{ taskId: payload.id }] };
  };
  const a = monitorFixture(api, 'a'), b = monitorFixture(api, 'b');
  let stop = a.monitor.subscribe(() => {}); await a.tick();
  a.monitor.select('task_a'); hold = true; await a.tick();
  stop(); const last = a.monitor.getState().tasks;
  const off = b.monitor.subscribe(() => {}); await b.tick();
  gate.resolve(); await drain();
  assert.strictEqual(a.monitor.getState().tasks, last);
  assert.equal(a.monitor.getState().eventsId, null);
  assert.equal(b.monitor.getState().tasks[0].id, 'task_b');
  hold = false; stop = a.monitor.subscribe(() => {}, false); await a.tick(10000);
  assert.strictEqual(a.monitor.getState().tasks, last);
  stop(); stop = a.monitor.subscribe(() => {}, true); await a.tick();
  assert.equal(a.monitor.getState().eventsId, 'task_a');
  a.monitor.select('task_other'); assert.deepEqual(a.monitor.getState().events, []);
  stop(); off(); a.monitor.dispose(); b.monitor.dispose();
  assert.strictEqual(getCommandCenterMonitor(api, 'a'), getCommandCenterMonitor(api, 'a'));
  assert.notStrictEqual(getCommandCenterMonitor(api, 'a'), getCommandCenterMonitor(api, 'b'));
});

test('tool events accelerate refresh, expose real output separately and reconnect without duplicate subscriptions', async () => {
  let listener, subscriptions = 0, unsubscriptions = 0, requests = 0;
  const f = monitorFixture(async () => { requests++; return { items: [task('task_a', 'blocked')], controllers: [controller('task_a', 'running')] }; });
  const stop = f.monitor.subscribe(() => {}); await f.tick();
  f.monitor.handleEvent({ type: 'tool.output', workspaceId: 'foreign', id: 'controller_task_a', data: 'FOREIGN' });
  f.monitor.handleEvent({ type: 'tool.output', workspaceId: 'a', id: 'controller_task_a', data: 'Synthetic actual stdout\n' });
  assert.equal(f.monitor.getState().controllers[0].output, 'Synthetic actual stdout\n');
  assert.equal(buildCommandCenter(f.monitor.getState())[0].sourceStatus, 'blocked');
  await f.tick(150); assert.equal(requests, 2);
  f.monitor.handleEvent({ type: 'connection', status: 'disconnected' });
  await f.tick(10000); assert.equal(requests, 2);
  f.monitor.handleEvent({ type: 'connection', status: 'connected' }); await f.tick(); assert.equal(requests, 3);
  f.monitor.handleEvent({ type: 'tool.status', workspaceId: 'a', id: 'controller_task_a', result: { ...controller('task_a', 'failed'), output: 'Synthetic failure' } });
  const item = buildCommandCenter(f.monitor.getState())[0];
  assert.equal(item.sourceStatus, 'blocked'); assert.equal(item.controllerStatus, 'failed');
  stop(); f.monitor.dispose();
  const shared = createCommandCenterMonitor({ api: async () => ({ items: [] }), workspaceId: 'shared', subscribeEvents: fn => { listener = fn; subscriptions++; return () => { unsubscriptions++; }; } });
  const offA = shared.subscribe(() => {}, false), offB = shared.subscribe(() => {}, false);
  assert.equal(subscriptions, 1); listener({ type: 'connection', status: 'disconnected' });
  assert.equal(shared.getState().connected, false);
  offA(); assert.equal(unsubscriptions, 0); offB(); assert.equal(unsubscriptions, 1); shared.dispose();
});

test('continuous controller output cannot starve the scheduled catalog refresh', async () => {
  let requests = 0;
  const f = monitorFixture(async () => {
    requests++;
    return { items: [task('task_a', 'running')], controllers: [controller('task_a', 'running')] };
  });
  const stop = f.monitor.subscribe(() => {}); await f.tick();
  const output = () => f.monitor.handleEvent({ type: 'tool.output', workspaceId: 'a', id: 'controller_task_a', data: 'SYNTHETIC stdout\n' });
  output();
  await f.tick(50); output();
  await f.tick(50); output();
  assert.equal(requests, 1);
  await f.tick(50);
  assert.equal(requests, 2, 'A live stream must not postpone the earliest refresh indefinitely');
  stop(); f.monitor.dispose();
});

test('events failure retains selected evidence and recovers independently of the catalog', async () => {
  let failEvents = false;
  const f = monitorFixture(async method => {
    if (method === 'phantom.list') return { items: [task('task_a', 'blocked')] };
    if (failEvents) throw new Error('SYNTHETIC events unavailable');
    return { items: [{ id: 'synthetic-evidence', type: 'synthetic.blocked' }] };
  });
  const stop = f.monitor.subscribe(() => {}); await f.tick();
  f.monitor.select('task_a'); await f.tick();
  const good = f.monitor.getState().events;
  failEvents = true; await f.tick(4000);
  assert.equal(f.monitor.getState().error, '');
  assert.match(f.monitor.getState().eventsError, /events unavailable/);
  assert.strictEqual(f.monitor.getState().events, good);
  assert.equal(f.monitor.getState().eventsId, 'task_a');
  failEvents = false; await f.tick(4000);
  assert.equal(f.monitor.getState().eventsError, '');
  stop(); f.monitor.dispose();
});

test('disabling during a catalog request prevents selected event reads and discards the late catalog', async () => {
  const gate = deferred(), calls = [];
  let hold = false;
  const f = monitorFixture(async method => {
    calls.push(method);
    if (hold) await gate.promise;
    return { items: [task('task_a', hold ? 'completed' : 'blocked')] };
  });
  let stop = f.monitor.subscribe(() => {}); await f.tick();
  const good = f.monitor.getState().tasks;
  hold = true; f.monitor.select('task_a'); await f.tick();
  stop(); stop = f.monitor.subscribe(() => {}, false);
  gate.resolve(); await drain(); await f.tick(10000);
  assert.strictEqual(f.monitor.getState().tasks, good);
  assert.equal(f.monitor.getState().eventsId, null);
  assert.deepEqual(calls, ['phantom.list', 'phantom.list']);
  stop(); f.monitor.dispose();
});

test('deactivation when publishing a catalog also prevents a subsequent event read', async () => {
  const calls = [];
  const f = monitorFixture(async method => {
    calls.push(method);
    return { items: [task('task_a', 'blocked')] };
  });
  let stop = f.monitor.subscribe(() => {}); await f.tick();
  f.monitor.select('task_a');
  // A consumer can synchronously deactivate on a new snapshot. Authorization
  // to continue reading must be checked again after notifying consumers.
  let watching = true;
  const off = f.monitor.subscribe(state => {
    if (watching && state.loading && calls.length === 2) {
      watching = false;
      stop(); off();
    }
  });
  await f.tick();
  assert.deepEqual(calls, ['phantom.list', 'phantom.list']);
  assert.equal(f.monitor.getState().eventsId, null);
  f.monitor.dispose();
});

test('an old selected event response cannot replace the newly selected evidence', async () => {
  const gate = deferred(), reads = [];
  const f = monitorFixture(async (method, payload) => {
    if (method === 'phantom.list') return { items: [task('task_a', 'blocked'), task('task_b', 'running')] };
    reads.push(payload.id);
    if (payload.id === 'task_a') await gate.promise;
    return { items: [{ taskId: payload.id, message: `SYNTHETIC evidence for ${payload.id}` }] };
  });
  const stop = f.monitor.subscribe(() => {}); await f.tick();
  f.monitor.select('task_a'); await f.tick();
  assert.deepEqual(reads, ['task_a']);
  f.monitor.select('task_b');
  gate.resolve(); await drain();
  assert.equal(f.monitor.getState().eventsId, null);
  assert.deepEqual(f.monitor.getState().events, []);
  await f.tick(150);
  assert.deepEqual(reads, ['task_a', 'task_b']);
  assert.equal(f.monitor.getState().eventsId, 'task_b');
  assert.equal(f.monitor.getState().events[0].taskId, 'task_b');
  stop(); f.monitor.dispose();
});
