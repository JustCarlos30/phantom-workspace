import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { cardDraft, cardInput, skillDraft, skillInput } from '../src/plugins/phantom.js';
import { validatePluginSettings } from '../src/plugins/registry.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

async function fixture(t, integration) {
  const home = await mkdtemp('/tmp/opencode/phantom-plugins-');
  const folder = path.join(home, 'project'); await mkdir(folder);
  const dataDir = path.join(home, 'profile');
  let host = await createHost({ dataDir, handleIntegration: integration });
  t.after(async () => { await host.close(); await rm(home, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: folder });
  const call = (method, payload = {}) => host.invoke(method, { workspaceId: workspace.id, pluginId: 'phantom', ...payload });
  return { home, workspace, call, get host() { return host; }, restart: async () => { await host.close(); host = await createHost({ dataDir, handleIntegration: integration }); } };
}

test('disabled Phantom plugin rejects new Cards panels at the host boundary', async t => {
  const home = await mkdtemp('/tmp/opencode/phantom-plugins-contract-');
  const folder = path.join(home, 'project');
  await mkdir(folder);
  const host = await createHost({ dataDir: path.join(home, 'profile') });
  t.after(async () => { await host.close(); await rm(home, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: folder });
  await assert.rejects(host.invoke('node.create', { workspaceId: workspace.id, type: 'phantom-cards', title: 'Cards' }), /desactivado|disabled/i);
});

test('activation, view and model survive restart, are project scoped and retain disabled panels', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('plugins.get')).enabled, false);
  await f.call('plugins.update', { patch: { enabled: true, preferences: { cardsView: 'board', model: 'provider/model' } } });
  const panel = await f.host.invoke('node.create', { workspaceId: f.workspace.id, type: 'phantom-cards' });
  await f.call('plugins.update', { patch: { enabled: false } });
  await f.restart();
  assert.deepEqual((await f.call('plugins.get')).preferences, { cardsView: 'board', model: 'provider/model' });
  assert.equal((await f.call('plugins.get')).enabled, false);
  assert.equal((await f.host.invoke('state.get')).workspaces[0].nodes[0].id, panel.id);
  const other = path.join(f.home, 'other'); await mkdir(other);
  const w = await f.host.invoke('workspace.open', { path: other });
  assert.equal((await f.call('plugins.get', { workspaceId: w.id })).enabled, false);
  await f.call('plugins.update', { patch: { enabled: true } });
  assert.equal((await f.call('plugins.get')).preferences.cardsView, 'board');
});

test('plugin boundary validates requests and never forwards disabled or injected operations', async t => {
  const requests = [];
  const f = await fixture(t, async (method, payload) => { requests.push({ method, payload }); return { handled: true, result: { available: true, items: [] } }; });
  await assert.rejects(f.call('plugins.invoke', { operation: 'list', payload: { topic: 'tasks' } }), /desactivado/);
  await assert.rejects(f.call('plugins.get', { pluginId: 'unknown' }), /Unknown plugin/);
  await assert.rejects(f.call('plugins.update', { patch: { enabled: 'yes' } }), /inválida/);
  await f.call('plugins.update', { patch: { enabled: true } });
  for (const payload of [{ operation: 'run', payload: {} }, { operation: 'list', payload: { topic: 'memories' } }, { operation: 'list', payload: { topic: 'tasks', workspaceId: 'injected' } }, { operation: 'control', payload: { id: 'task-test', action: 'run', model: '' } }]) await assert.rejects(f.call('plugins.invoke', payload));
  assert.equal(requests.length, 0);
  await f.call('plugins.invoke', { operation: 'list', payload: { topic: 'tasks' } });
  assert.equal(requests[0].method, 'phantom.list');
  assert.equal(requests[0].payload.workspaceId, f.workspace.id);
});

test('host connection is explicit and shared; malformed paths and preferences are rejected', async t => {
  const f = await fixture(t);
  await f.call('plugins.update', { patch: { enabled: true } });
  await assert.rejects(f.call('plugins.configure', { patch: { phantomPath: 'relative' } }), /absolute/);
  await assert.rejects(f.call('plugins.configure', { patch: { phantomPath: '/valid', surprise: '/invalid' } }), /Invalid connection/);
  assert.equal((await f.call('plugins.get')).connection.phantomPath, '');
  await f.call('plugins.configure', { patch: { phantomPath: '/absolute/phantom.mjs' } });
  assert.equal((await f.call('plugins.get')).connection.scope, 'host');
  assert.equal((await f.host.invoke('state.get')).settings.phantomPath, '/absolute/phantom.mjs');
  for (const value of [{ phantom: { enabled: true, preferences: { cardsView: 'grid' } } }, { phantom: { enabled: true, preferences: { model: 'bad\nmodel' } } }, { external: { enabled: true, preferences: {} } }]) assert.throws(() => validatePluginSettings(value));
});

test('project skill references retain scope, exact version and hash at the plugin boundary', async t => {
  let received;
  const f = await fixture(t, async (_method, payload) => { received = payload; return { handled: true, result: {} }; });
  await f.call('plugins.update', { patch: { enabled: true } });
  const ref = { scope: `project:${'a'.repeat(64)}`, id: 'review/test', version: '1.0.0', sha256: 'b'.repeat(64) };
  await f.call('plugins.invoke', { operation: 'detail', payload: { topic: 'skills', id: ref.id, ref } });
  assert.deepEqual(received.ref, ref);
  await assert.rejects(f.call('plugins.invoke', { operation: 'detail', payload: { topic: 'skills', id: ref.id, ref: { ...ref, id: 'other' } } }), /differs/);
});

test('card form transformation preserves argument spaces and native coordination fields', () => {
  const original = { contract: { goal: 'Real objective', lane: 'coordinated', scope: ['src/with spaces.js'], checks: [{ name: 'acceptance', argv: ['node', '--test', 'test/with spaces.test.mjs'], timeoutMs: 120000 }], budget: { maxTurns: 10 }, coordination: { maxConcurrency: 1, children: [] } } };
  const draft = cardDraft(original); draft.goal = 'Changed objective';
  const input = cardInput(draft);
  assert.equal(original.contract.goal, 'Real objective');
  assert.equal(input.checks[0].argv[2], 'test/with spaces.test.mjs');
  assert.deepEqual(input.coordination, original.contract.coordination);
  assert.deepEqual(input.budget, original.contract.budget);
  for (const scope of [[], ['../escape'], ['/absolute'], ['src/*.js']]) assert.throws(() => cardInput({ ...draft, scope }));
});

test('skill version form preserves resources and provenance and rejects immutable/global edits', () => {
  const source = { ref: { scope: `project:${'a'.repeat(64)}`, id: 'review/test', version: '1.0.0', sha256: 'b'.repeat(64) }, manifest: { id: 'review/test', version: '1.0.0', description: 'Review', body: 'Instructions', bodySource: 'guide.md', actions: ['code.review'], requiresTools: ['read'], resources: [{ name: 'ref.md', mediaType: 'text/markdown', content: 'Original', sha256: 'c'.repeat(64), source: 'ref.md' }] } };
  const draft = skillDraft(source);
  assert.throws(() => skillInput(draft, source), /nueva versión/);
  draft.version = '1.1.0';
  assert.deepEqual(skillInput(draft, source).resources, source.manifest.resources);
  assert.equal(skillInput(draft, source).bodySource, 'guide.md');
  assert.throws(() => skillInput(draft, { ...source, ref: { ...source.ref, scope: 'global' } }), /solo lectura/);
  assert.throws(() => skillInput({ ...draft, version: 'latest' }, source), /semántica/);
  assert.equal(source.manifest.version, '1.0.0');
});

test('real Phantom CLI creates cards, publishes versions and preserves exact resources through the plugin', async t => {
  const f = await fixture(t);
  await promisify(execFile)('git', ['init', '-b', 'main'], { cwd: f.workspace.path });
  await f.call('plugins.update', { patch: { enabled: true } });
  await f.call('plugins.configure', { patch: { phantomPath: process.env.PHANTOM_CLI || fileURLToPath(new URL('../../harness_engineer/bin/phantom.mjs', import.meta.url)), phantomData: path.join(f.home, 'native-data') } });
  const input = cardInput({ goal: 'SYNTHETIC · real native card', lane: 'coordinated', scope: ['src/test.js'], checks: [] });
  const card = await f.call('plugins.invoke', { operation: 'create', payload: { kind: 'card', input } });
  assert.ok(card.id);
  const cards = await f.call('plugins.invoke', { operation: 'list', payload: { topic: 'tasks' } });
  assert.ok(cards.items.some(item => item.id === card.id && item.kind === 'card'));
  const skill = { id: 'synthetic/test', version: '1.0.0', description: 'SYNTHETIC native fixture', actions: ['test.review'], body: 'SYNTHETIC instructions', requiresTools: [], resources: [{ name: 'ref.md', mediaType: 'text/markdown', content: 'Exact resource' }] };
  const first = await f.call('plugins.invoke', { operation: 'create', payload: { kind: 'skill', input: skill } });
  const detail = await f.call('plugins.invoke', { operation: 'detail', payload: { topic: 'skills', id: first.id, ref: first.ref } });
  const next = skillDraft(detail); next.version = '1.1.0';
  const second = await f.call('plugins.invoke', { operation: 'update', payload: { kind: 'skill', input: skillInput(next, detail), id: first.id, ref: first.ref, revision: first.ref.version } });
  assert.equal(second.ref.version, '1.1.0');
  const original = await f.call('plugins.invoke', { operation: 'detail', payload: { topic: 'skills', id: first.id, ref: first.ref } });
  assert.equal(original.manifest.version, '1.0.0');
  assert.equal(original.manifest.resources[0].content, 'Exact resource');
});
