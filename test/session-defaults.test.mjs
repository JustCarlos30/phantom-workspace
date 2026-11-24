import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { Store } from '../host/store.mjs';
import { chatMode } from '../host/chats.mjs';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-defaults-'));
  const dataDir = path.join(root, 'state');
  let host;
  t.after(async () => { try { await host?.close(); } finally { fs.rmSync(root, { recursive: true, force: true }); } });
  const start = async () => { host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) }); return host; };
  await start();
  const w = await host.invoke('workspace.open', { path: root });
  return { root, w, get host() { return host; }, restart: async () => { await host.close(); return start(); } };
}
const remember = (host, id, permissionMode) => host.invoke('workspace.update', { id, patch: { sessionDefaults: { permissionMode } } });
const createChat = (host, workspaceId, chat = { provider: 'claude' }) => host.invoke('node.create', { workspaceId, type: 'terminal', data: { chat } });
const workspace = (host, id) => host.store.getWorkspace(id);

test('explicit project defaults persist across host restart and seed only new chats', async t => {
  const f = await fixture(t), { w } = f;
  const existing = await createChat(f.host, w.id);
  for (const mode of ['ask', 'auto', 'full']) {
    const updated = await remember(f.host, w.id, mode);
    assert.deepEqual(updated.sessionDefaults, { permissionMode: mode });
    await f.restart();
    const restored = (await f.host.invoke('state.get')).workspaces.find(item => item.id === w.id);
    assert.deepEqual(restored.sessionDefaults, { permissionMode: mode });
    const node = await createChat(f.host, w.id);
    assert.deepEqual(node.data.chat, { provider: 'claude', permissionMode: mode, autoApprove: mode !== 'ask' });
    assert.equal(chatMode(node, f.root), mode);
    assert.deepEqual(restored.nodes.find(item => item.id === existing.id).data.chat, { provider: 'claude' });
  }
});

test('defaults are isolated by canonical project identity', async t => {
  const f = await fixture(t), otherPath = path.join(f.root, 'other');
  fs.mkdirSync(otherPath);
  const other = await f.host.invoke('workspace.open', { path: otherPath });
  await remember(f.host, f.w.id, 'full');
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.root, alias);
  const reopened = await f.host.invoke('workspace.open', { path: alias });
  assert.equal(reopened.id, f.w.id);
  assert.deepEqual(reopened.sessionDefaults, { permissionMode: 'full' });
  assert.deepEqual((await createChat(f.host, other.id)).data.chat, { provider: 'claude' });
  await remember(f.host, other.id, 'ask');
  await f.restart();
  assert.equal((await createChat(f.host, f.w.id)).data.chat.permissionMode, 'full');
  assert.equal((await createChat(f.host, other.id)).data.chat.permissionMode, 'ask');
});

test('explicit permissionMode or legacy autoApprove wins over project defaults', async t => {
  const f = await fixture(t);
  await remember(f.host, f.w.id, 'full');
  for (const choice of [{ permissionMode: 'ask' }, { permissionMode: 'auto' }, { autoApprove: false }, { autoApprove: true }, { permissionMode: 'ask', autoApprove: true }]) {
    const chat = { provider: 'claude', ...choice };
    const node = await createChat(f.host, f.w.id, chat);
    assert.deepEqual(node.data.chat, chat);
    assert.equal(chatMode(node, f.root), choice.permissionMode ?? (choice.autoApprove ? 'auto' : 'ask'));
  }
  await assert.rejects(createChat(f.host, f.w.id, { provider: 'claude', permissionMode: 'invalid' }));
  await assert.rejects(createChat(f.host, f.w.id, { provider: 'claude', autoApprove: 'yes' }));
  assert.deepEqual(workspace(f.host, f.w.id).sessionDefaults, { permissionMode: 'full' });
});

test('null clears the saved preference durably without rewriting existing sessions', async t => {
  const f = await fixture(t);
  await remember(f.host, f.w.id, 'full');
  const existing = await createChat(f.host, f.w.id);
  const cleared = await f.host.invoke('workspace.update', { id: f.w.id, patch: { sessionDefaults: null } });
  assert.equal(Object.hasOwn(cleared, 'sessionDefaults'), false);
  await f.restart();
  assert.equal(Object.hasOwn(workspace(f.host, f.w.id), 'sessionDefaults'), false);
  assert.equal(workspace(f.host, f.w.id).nodes.find(n => n.id === existing.id).data.chat.permissionMode, 'full');
  const node = await createChat(f.host, f.w.id);
  assert.deepEqual(node.data.chat, { provider: 'claude' });
  assert.equal(chatMode(node, f.root), 'ask');
});

test('invalid updates and imports reject atomically and preserve the durable preference', async t => {
  const f = await fixture(t);
  await remember(f.host, f.w.id, 'auto');
  f.host.store.flush();
  const durable = fs.readFileSync(f.host.store.filename, 'utf8');
  for (const value of [undefined, [], 'full', true, 1, {}, { permissionMode: null }, { permissionMode: 'FULL' }, { permissionMode: 'full', autoApprove: true }]) {
    await assert.rejects(f.host.invoke('workspace.update', { id: f.w.id, patch: { name: 'Rejected', sessionDefaults: value } }));
    assert.deepEqual(workspace(f.host, f.w.id).sessionDefaults, { permissionMode: 'auto' });
    assert.equal(workspace(f.host, f.w.id).name, f.w.name);
    const incoming = structuredClone(f.host.store.state);
    incoming.workspaces[0].sessionDefaults = value === undefined ? null : value;
    await assert.rejects(f.host.invoke('storage.import', { data: incoming }));
  }
  assert.equal(fs.readFileSync(f.host.store.filename, 'utf8'), durable);
  await f.restart();
  assert.deepEqual(workspace(f.host, f.w.id).sessionDefaults, { permissionMode: 'auto' });
});

test('store rejects invalid defaults when reading persisted data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-defaults-store-'));
  const store = new Store(path.join(root, 'state'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.transaction(() => store.open(root));
  store.close();
  const saved = JSON.parse(fs.readFileSync(store.filename, 'utf8'));
  for (const value of [null, [], {}, { permissionMode: 'invalid' }, { permissionMode: 'full', unknown: true }]) {
    const input = structuredClone(saved);
    input.workspaces[0].sessionDefaults = value;
    fs.writeFileSync(store.filename, JSON.stringify(input));
    assert.throws(() => new Store(store.dir));
  }
});

test('configuration does not remember permissions or apply defaults to shells or later provider selection', async t => {
  const f = await fixture(t);
  const existing = await createChat(f.host, f.w.id);
  await f.host.invoke('chat.configure', { workspaceId: f.w.id, nodeId: existing.id, permissionMode: 'full' });
  assert.equal(Object.hasOwn(workspace(f.host, f.w.id), 'sessionDefaults'), false);
  assert.deepEqual((await createChat(f.host, f.w.id)).data.chat, { provider: 'claude' });
  await remember(f.host, f.w.id, 'full');
  const shell = await f.host.invoke('node.create', { workspaceId: f.w.id, type: 'terminal' });
  assert.deepEqual(shell.data, {});
  const unselected = await createChat(f.host, f.w.id, { provider: null });
  assert.deepEqual(unselected.data.chat, { provider: null });
  const configured = await f.host.invoke('chat.configure', { workspaceId: f.w.id, nodeId: unselected.id, provider: 'claude' });
  assert.deepEqual(configured.data.chat, { provider: 'claude' });
  await f.host.invoke('chat.configure', { workspaceId: f.w.id, nodeId: existing.id, permissionMode: 'ask' });
  assert.deepEqual(workspace(f.host, f.w.id).sessionDefaults, { permissionMode: 'full' });
});

test('without a preference legacy worktree defaults remain and saved permissions cannot bypass provider policy', async t => {
  const f = await fixture(t);
  const node = await f.host.invoke('node.create', { workspaceId: f.w.id, type: 'terminal', data: { chat: { provider: 'claude' }, worktree: { path: f.root } } });
  assert.deepEqual(node.data.chat, { provider: 'claude' });
  assert.equal(chatMode(node, f.root), 'auto');
  await remember(f.host, f.w.id, 'ask');
  const chosen = await f.host.invoke('node.create', { workspaceId: f.w.id, type: 'terminal', data: { chat: { provider: 'claude' }, worktree: { path: f.root } } });
  assert.equal(chatMode(chosen, f.root), 'ask');
  await remember(f.host, f.w.id, 'full');
  for (const provider of ['codex', 'opencode', 'unknown']) await assert.rejects(createChat(f.host, f.w.id, { provider }));
  assert.equal(workspace(f.host, f.w.id).nodes.length, 2);
});
