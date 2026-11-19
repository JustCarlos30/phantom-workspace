import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PHANTOM_PLUGIN, validatePluginManifest, validatePluginPreferences } from '../shared/plugins.mjs';
import { Store, validateState, NODE_TYPES } from '../host/store.mjs';
import { createHost } from '../host/server.mjs';
import { handleIntegration } from '../integrations/index.mjs';
import { discoverPhantomCLI, shutdownPhantom } from '../integrations/phantom.mjs';
import { validateInvocation } from '../desktop/security.mjs';

const exec = promisify(execFile);

test('Phantom activity pairs actions and exposes only compact latest-run targets', async t => {
  const f = await fixture(t);
  const cli = path.join(f.home, 'inert.mjs');
  await writeFile(cli, '// Not executed');
  await f.call('plugins.update', { id: 'phantom', patch: { config: { phantomPath: cli } } });
  let foreign = false;
  const event = (type, callID, data = {}, run_id = 'new') => ({ type, run_id, at: '2026-11-16T00:00:00Z', data: { ...(callID ? { callID } : {}), ...data } });
  const events = [
    event('action.intended', 'old', { tool: 'read', args: { path: 'old' } }, 'old'),
    event('model.requested', undefined, { model: 'provider/model' }),
    event('action.intended', 'read', { tool: 'read', args: { filePath: '/work/a' } }),
    event('action.observed', 'read', { output: 'SECRET' }),
    event('action.intended', 'patch', { tool: 'apply_patch', args: { patchText: '*** Begin Patch\n*** Update File: a\n+SECRET\n*** Add File: b\n*** Delete File: c\n*** End Patch' } }),
    event('action.observed', 'patch', { status: 'error', output: 'SECRET' }),
    event('action.intended', 'search', { tool: 'grep', args: { pattern: 'needle', path: 'src' } }),
    event('action.observed', 'failure', { tool: 'bash', error: 'SECRET', args: { command: 'false' } }),
  ];
  f.context.execFile = async (_file, args) => {
    if (args.includes('show')) return { stdout: JSON.stringify({ id: 'task_activity', contract: { workspace: f.roots[foreign ? 1 : 0] } }) };
    if (args.includes('events')) return { stdout: JSON.stringify(events) };
    throw new Error('Not a Git workspace');
  };
  assert.doesNotThrow(() => validateInvocation('phantom.events', { view: 'activity' }));
  const result = await f.call('phantom.events', { id: 'task_activity', view: 'activity' });
  assert.equal(result.total, 4);
  assert.equal(result.model, 'provider/model');
  assert.equal(result.runId, 'new');
  assert.deepEqual(result.items.map(item => item.status), ['done', 'error', 'running', 'error']);
  assert.deepEqual(result.items.map(item => item.target), ['/work/a', 'a, b, c', 'needle en src', 'false']);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|patchText|output|args/);
  assert.deepEqual((await f.call('phantom.events', { id: 'task_activity' })).events, events);
  for (let index = 0; index < 45; index++) events.push(event('action.intended', `extra-${index}`, { tool: 'read', args: { path: 'x'.repeat(300) } }));
  const capped = await f.call('phantom.events', { id: 'task_activity', view: 'activity' });
  assert.equal(capped.total, 49);
  assert.equal(capped.items.length, 40);
  assert.equal(capped.truncated, true);
  assert.equal(capped.items[0].id, 'extra-5');
  assert.equal(capped.items.at(-1).target.length, 240);
  await assert.rejects(f.call('phantom.events', { id: 'task_activity', view: 'invalid' }), /Invalid Phantom events view/);
  foreign = true;
  await assert.rejects(f.call('phantom.events', { id: 'task_activity', view: 'activity' }), /another workspace/);
});
async function fixture(t, cleanup = true) {
  const home = await mkdtemp(path.join(tmpdir(), 'workspace-plugins-'));
  if (cleanup) t.after(() => rm(home, { recursive: true, force: true }));
  const roots = [path.join(home, 'project one'), path.join(home, 'project two')];
  for (const root of roots) { await mkdir(root); await writeFile(path.join(root, 'README.md'), '# Temporary project\n'); }
  const store = new Store(path.join(home, 'host'));
  const workspaces = roots.map(root => store.transaction(() => store.open(root)));
  const context = { dataDir: store.dir, state: store.state, getWorkspace: id => store.getWorkspace(id), persist: () => store.persist() };
  const call = async (method, payload = {}, index = 0) => {
    const response = await handleIntegration(method, { workspaceId: workspaces[index].id, ...payload }, context);
    assert.equal(response.handled, true); return response.result;
  };
  return { home, roots, store, context, workspaces, call };
}

test('first-party manifests are portable JSON, validate identity/schema and reject executable values', () => {
  assert.deepEqual(validatePluginManifest(JSON.parse(JSON.stringify(PHANTOM_PLUGIN))), PHANTOM_PLUGIN);
  for (const patch of [
    { id: '../phantom' }, { version: 'latest' }, { name: '' }, { description: null },
    { panels: [{ id: 'cards', name: 'Cards', nodeType: 'phantom-cards' }, { id: 'cards', name: 'Duplicate', nodeType: 'phantom-cards' }] },
    { actions: [{ id: 'open', name: 'Open', panelId: 'absent' }] },
    { configuration: { model: { type: 'function', default: '', label: 'Model' } } },
    { execute: () => true }, { panels: undefined },
  ]) assert.throws(() => validatePluginManifest({ ...PHANTOM_PLUGIN, ...patch }));
  const cycle = { ...PHANTOM_PLUGIN }; cycle.configuration = cycle;
  assert.throws(() => validatePluginManifest(cycle), /JSON serializable/);
  assert.throws(() => validatePluginPreferences({ phantom: { enabled: 'yes', config: {} } }), /enabled/);
});

test('project activation, partial preferences and panel immutable refs survive reload and reactivation', async t => {
  const f = await fixture(t);
  const initial = await f.call('plugins.list');
  assert.equal(initial.items[0].enabled, false); assert.equal(initial.items[0].source, 'builtin');
  assert.deepEqual(initial.items[0].config, { phantomPath: '', phantomData: '', model: '' });
  const ref = { id: 'fixture/skill', scope: 'workspace', version: '1.0.0', sha256: 'a'.repeat(64) };
  f.workspaces[0].nodes.push({ id: randomUUID(), type: 'phantom-skills', title: 'Skills', x: 0, y: 0, width: 640, height: 400, data: { pluginId: 'phantom', panelId: 'skills', ref } });
  await f.call('plugins.update', { id: 'phantom', patch: { enabled: true, config: { model: 'claude-code/opus' } } });
  await f.call('plugins.update', { id: 'phantom', patch: { config: { phantomData: path.join(f.home, 'native') } } });
  assert.equal((await f.call('plugins.list', {}, 1)).items[0].enabled, false);
  assert.equal((await f.call('plugins.list', {}, 1)).items[0].config.model, '');
  await f.call('plugins.update', { id: 'phantom', patch: { enabled: false } });
  const reloaded = new Store(f.store.dir);
  assert.equal(reloaded.getWorkspace(f.workspaces[0].id).plugins.phantom.enabled, false);
  assert.deepEqual(reloaded.getWorkspace(f.workspaces[0].id).nodes[0].data.ref, ref);
  assert.equal(reloaded.getWorkspace(f.workspaces[0].id).plugins.phantom.config.model, 'claude-code/opus');
  await f.call('plugins.update', { id: 'phantom', patch: { enabled: true } });
  assert.equal((await f.call('plugins.list')).items[0].config.model, 'claude-code/opus');
  const exported = validateState(JSON.parse(await readFile(f.store.filename, 'utf8')));
  assert.deepEqual(exported.workspaces[0].nodes[0].data.ref, ref);
  assert.ok(['plugins', 'phantom-cards', 'phantom-skills'].every(type => NODE_TYPES.includes(type)));
});

test('plugin payload/path validation, imports and failed saves do not corrupt preferences', async t => {
  const f = await fixture(t);
  for (const patch of [null, [], { unknown: true }, { enabled: 1 }, { config: null }, { config: { phantomPath: 'relative/cli.mjs' } }, { config: { phantomData: 'relative' } }, { config: { model: '\0bad' } }, { config: { command: 'anything' } }, { config: { phantomData: f.roots[0] } }]) {
    await assert.rejects(f.call('plugins.update', { id: 'phantom', patch }));
  }
  await symlink(f.roots[0], path.join(f.home, 'alias'));
  await assert.rejects(f.call('plugins.update', { id: 'phantom', patch: { config: { phantomData: path.join(f.home, 'alias', 'data') } } }), /outside workspace/);
  for (const method of ['plugins.status', 'plugins.models', 'plugins.update']) await assert.rejects(f.call(method, { id: 'external', patch: {} }));
  await assert.rejects(f.call('plugins.list', { unexpected: true }), /payload/);
  await assert.rejects(f.call('plugins.list', { workspaceId: randomUUID() }), /Workspace not found/);
  const before = structuredClone(f.workspaces[0].plugins);
  f.context.persist = () => { throw new Error('disk full'); };
  await assert.rejects(f.call('plugins.update', { id: 'phantom', patch: { enabled: true } }), /disk full/);
  assert.deepEqual(f.workspaces[0].plugins, before);
  const invalid = structuredClone(f.store.state); invalid.workspaces[0].plugins.phantom.config.phantomData = path.join(f.roots[0], 'state');
  assert.throws(() => validateState(invalid), /outside workspace/);
  invalid.workspaces[0].plugins.phantom.config.phantomData = ''; invalid.workspaces[0].plugins.phantom.config.model = false;
  assert.throws(() => validateState(invalid), /model/);
});

test('host routes plugins, recovers panel metadata and preserves preferences when importing old UI snapshots', async t => {
  const f = await fixture(t, false);
  const host = await createHost({ dataDir: path.join(f.home, 'server'), handleIntegration });
  t.after(async () => {
    try { await host.close(); }
    finally { await rm(f.home, { recursive: true, force: true }); }
  });
  const workspace = await host.invoke('workspace.open', { path: f.roots[0] });
  const oldSnapshot = await host.invoke('storage.export');
  delete oldSnapshot.workspaces[0].plugins;
  const update = { workspaceId: workspace.id, id: 'phantom', patch: { enabled: true, config: { model: 'claude-code/haiku' } } };
  await host.invoke('plugins.update', update);
  await host.invoke('storage.import', { data: oldSnapshot });
  const preferences = (await host.invoke('plugins.list', { workspaceId: workspace.id })).items[0];
  assert.equal(preferences.enabled, true); assert.equal(preferences.config.model, 'claude-code/haiku');
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'phantom-cards' });
  assert.deepEqual(node.data, { pluginId: 'phantom', panelId: 'cards' });
  await host.invoke('plugins.update', { workspaceId: workspace.id, id: 'phantom', patch: { enabled: false } });
  assert.equal((await host.invoke('state.get')).workspaces[0].nodes[0].id, node.id);
  for (const method of ['plugins.list', 'plugins.update', 'plugins.status', 'plugins.models', 'phantom.events', 'phantom.controllers']) assert.doesNotThrow(() => validateInvocation(method, {}));
});

test('disabled surfaces reject native writes, while unavailable CLI and models remain configurable', async t => {
  const f = await fixture(t);
  await f.call('plugins.update', { id: 'phantom', patch: { config: { phantomPath: path.join(f.home, 'missing.mjs') } } });
  for (const method of ['phantom.create', 'phantom.update', 'phantom.control']) await assert.rejects(f.call(method, { pluginId: 'phantom' }), /disabled/);
  const status = await f.call('plugins.status', { id: 'phantom' });
  assert.equal(status.available, false); assert.equal(status.source, 'phantom'); assert.match(status.reason, /Configure phantomPath or PHANTOM_CLI/);
  // Legacy writes reach their backend even when the new Plugin Center is disabled.
  await assert.rejects(f.call('phantom.create', {}), /CLI not found/);
  // Model catalog is static Claude Code: a missing OpenCode binary is irrelevant and never spawned.
  f.context.state.settings.opencodePath = path.join(f.home, 'missing-opencode');
  const models = await f.call('plugins.models', { id: 'phantom' });
  assert.equal(models.available, true); assert.equal(models.engine, 'claude-code'); assert.equal(models.defaultModel, 'claude-code/sonnet');
  await assert.rejects(discoverPhantomCLI(path.join(f.home, 'missing')), /CLI not found/);
  f.context.execFile = async () => { throw new Error('native transport failure'); };
  await writeFile(path.join(f.home, 'inert.mjs'), '// Never executed');
  await f.call('plugins.update', { id: 'phantom', patch: { config: { phantomPath: path.join(f.home, 'inert.mjs') } } });
  assert.match((await f.call('plugins.status', { id: 'phantom' })).reason, /native transport failure/);
});

test('plugins.models offers only Claude Code models and never starts opencode models', async t => {
  const f = await fixture(t);
  let spawned = 0;
  f.context.execFile = async () => { spawned++; throw new Error('must not run'); };
  const result = await f.call('plugins.models', { id: 'phantom' });
  assert.equal(spawned, 0);
  assert.deepEqual(result.models, ['claude-code/fable', 'claude-code/opus', 'claude-code/sonnet', 'claude-code/haiku']);
  assert.ok(result.models.every(model => model.startsWith('claude-code/')));
  await assert.rejects(f.call('plugins.models', { id: 'convencions' }), /no utiliza modelos/);
});

test('plugin configuration rejects non-Claude models but keeps a stored legacy value readable', async t => {
  const f = await fixture(t);
  for (const model of ['provider/model', 'openai/gpt-5', 'gpt-test', 'opencode/free']) await assert.rejects(f.call('plugins.update', { id: 'phantom', patch: { config: { model } } }), /no es Claude Code/);
  assert.equal((await f.call('plugins.list')).items[0].config.model, '');
  f.workspaces[0].plugins.phantom.config.model = 'provider/legacy';
  assert.equal((await f.call('plugins.list')).items[0].config.model, 'provider/legacy');
  await f.call('plugins.update', { id: 'phantom', patch: { config: { model: 'claude-code/sonnet' } } });
  assert.equal((await f.call('plugins.list')).items[0].config.model, 'claude-code/sonnet');
  assert.match(PHANTOM_PLUGIN.configuration.model.label, /Claude Code/);
  assert.doesNotMatch(PHANTOM_PLUGIN.configuration.model.label, /OpenCode/);
});

test('installed native CLI: isolated cards/replacements, events ownership, immutable skills and errors', async t => {
  let cli;
  try { cli = await discoverPhantomCLI(); } catch (error) { t.skip(`Native CLI unavailable: ${error.message}`); return; }
  const f = await fixture(t), native = path.join(f.home, 'native-data');
  // Workspace-scoped Skills require a real Git project identity in the native CLI.
  for (const root of f.roots) await exec('git', ['init', '-b', 'main', root], { shell: false });
  await f.call('plugins.update', { id: 'phantom', patch: { enabled: true, config: { phantomPath: cli, phantomData: native, model: 'claude-code/haiku' } } });
  // Every native process gets an explicit isolated data directory; never touch personal DBs.
  const nativeCall = async args => JSON.parse((await exec(process.execPath, [cli, ...args, '--data', native, '--json'], { cwd: f.roots[0], shell: false, timeout: 15000 })).stdout);
  assert.equal((await f.call('plugins.status', { id: 'phantom' })).available, true);
  const input = { goal: 'Temporary plugin card', lane: 'coordinated', scope: ['README.md'], checks: [{ name: 'not-run', argv: [process.execPath, '--version'] }] };
  const card = await f.call('phantom.create', { pluginId: 'phantom', kind: 'card', input });
  assert.equal(card.raw.kind, 'card'); assert.match(card.id, /^task_/);
  assert.equal((await f.call('phantom.detail', { topic: 'tasks', id: card.id })).contract.workspace, f.roots[0]);
  const events = await f.call('phantom.events', { id: card.id });
  assert.deepEqual(events.events, await nativeCall(['events', card.id]));
  assert.equal(events.source, 'phantom');
  await assert.rejects(f.call('phantom.update', { pluginId: 'phantom', id: card.id, kind: 'card', input }), /immutable/);
  const replacement = await f.call('phantom.update', { pluginId: 'phantom', id: card.id, kind: 'card', replace: true, input: { ...input, goal: 'Replacement card' } });
  assert.equal(replacement.replaces, card.id); assert.notEqual(replacement.id, card.id);
  const otherFile = path.join(f.home, 'foreign-contract.json');
  await writeFile(otherFile, JSON.stringify({ ...input, workspace: f.roots[1] }));
  const foreign = await nativeCall(['create', otherFile]);
  await assert.rejects(f.call('phantom.events', { id: foreign.id }), /another workspace/);
  assert.ok(!(await f.call('phantom.list', { topic: 'tasks' })).items.some(item => item.id === foreign.id));
  const skillInput = { id: 'fixture/plugin', version: '1.0.0', description: 'Temporary native skill', actions: ['fixture.read'], body: 'Read temporary files only.' };
  const skill = await f.call('phantom.create', { pluginId: 'phantom', kind: 'skill', input: skillInput });
  const next = await f.call('phantom.update', { pluginId: 'phantom', kind: 'skill', id: skill.id, ref: skill.ref, revision: skill.ref.version, input: { ...skillInput, version: '1.0.1', body: 'New immutable body.' } });
  assert.equal(next.semantic, 'new-version'); assert.notEqual(next.ref.sha256, skill.ref.sha256);
  const original = await f.call('phantom.detail', { topic: 'skills', id: skill.id, ref: skill.ref });
  assert.equal(original.manifest.body, skillInput.body); assert.deepEqual(original.ref, skill.ref); assert.ok(Array.isArray(original.manifest.resources));
  await assert.rejects(f.call('phantom.detail', { topic: 'skills', id: skill.id, ref: { ...skill.ref, sha256: '0'.repeat(64) } }), /not visible/);
  await assert.rejects(f.call('phantom.create', { pluginId: 'phantom', kind: 'card', input: { ...input, scope: ['../escape'] } }), /outside workspace|ruta exacta dentro del workspace/);
  await assert.rejects(f.call('phantom.create', { pluginId: 'phantom', kind: 'card', input: { ...input, unknown: true } }));
  // Verify is a real controller process, never a model run. Process exit is not task completion.
  t.after(() => shutdownPhantom());
  const descriptor = await f.call('phantom.control', { pluginId: 'phantom', id: card.id, action: 'verify' });
  assert.equal(descriptor.taskId, card.id); assert.ok(descriptor.pid);
  const deadline = Date.now() + 20000;
  let controllers;
  do {
    controllers = await f.call('phantom.controllers');
    if (!controllers.items.some(item => item.id === descriptor.id && item.status === 'running')) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  const finished = controllers.items.find(item => item.id === descriptor.id);
  assert.ok(['failed', 'completed'].includes(finished.status), JSON.stringify(finished));
  assert.equal(typeof finished.exitCode, 'number');
  const taskAfterVerify = await nativeCall(['show', card.id]);
  assert.equal((await f.call('phantom.detail', { topic: 'tasks', id: card.id })).status, taskAfterVerify.status);
  const persisted = new Store(f.store.dir).getWorkspace(f.workspaces[0].id).phantomControllers;
  assert.equal(persisted.find(item => item.id === descriptor.id).status, finished.status);
  // Simulate a descriptor surviving a host crash; its PID grants no stop authority.
  f.workspaces[0].phantomControllers.push({ ...finished, id: randomUUID(), status: 'running' });
  assert.equal((await f.call('phantom.controllers')).items.at(-1).status, 'lost');
  await assert.rejects(f.call('phantom.control', { id: descriptor.id, action: 'stop' }), /No active controller/);
  await f.call('plugins.update', { id: 'phantom', patch: { enabled: false } });
  assert.equal((await f.call('plugins.status', { id: 'phantom' })).available, true);
  assert.equal((await f.call('phantom.controllers')).items.length, 2);
  // Global legacy config remains intact; project two explicitly uses it on separate native data.
  f.context.state.settings.phantomPath = cli; f.context.state.settings.phantomData = path.join(f.home, 'legacy-data');
  assert.equal((await f.call('phantom.list', { topic: 'tasks' }, 1)).items.length, 0);
  assert.equal((await f.call('phantom.list', { topic: 'tasks' })).items.length, 2);
});

test('command-center preferences and native plugin config share durable state without overwriting each other', async t => {
  const f = await fixture(t, false);
  const host = await createHost({ dataDir: f.store.dir, handleIntegration });
  t.after(async () => { await host.close(); await rm(f.home, { recursive: true, force: true }); });
  const workspaceId = f.workspaces[0].id;
  await host.invoke('plugins.update', { workspaceId, id: 'phantom', patch: { enabled: true, config: { model: 'claude-code/haiku' } } });
  await host.invoke('plugin.update', { workspaceId, id: 'phantom', settings: { enabled: true, refreshMs: 3000 } });
  let saved = (await host.invoke('state.get')).workspaces.find(w => w.id === workspaceId).plugins.phantom;
  assert.equal(saved.config.model, 'claude-code/haiku'); assert.equal(saved.refreshMs, 3000);
  await host.invoke('plugins.update', { workspaceId, id: 'phantom', patch: { enabled: false, config: { model: 'claude-code/opus' } } });
  saved = (await host.invoke('state.get')).workspaces.find(w => w.id === workspaceId).plugins.phantom;
  assert.equal(saved.config.model, 'claude-code/opus'); assert.equal(saved.refreshMs, 3000); assert.equal(saved.enabled, false);
  assert.deepEqual(await host.invoke('plugin.get', { workspaceId, id: 'phantom' }), { enabled: false, refreshMs: 3000 });
});
