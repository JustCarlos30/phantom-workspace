import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { connectHost } from '../desktop/host-client.mjs';

const settle = () => new Promise(resolve => setTimeout(resolve, 80));

test('mutations in the same tick emit one state.changed per workspace', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-events-')), dataDir = path.join(root, 'state'), project = path.join(root, 'project');
  fs.mkdirSync(project);
  const host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  const events = []; let client;
  t.after(async () => { client?.close(); await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  client = await connectHost({ dataDir, onEvent: event => events.push(event) });
  const workspace = await client.invoke('workspace.open', { path: project });
  await settle(); events.length = 0;
  const changed = () => events.filter(event => event.type === 'state.changed');

  await Promise.all(Array.from({ length: 10 }, () => client.invoke('node.create', { workspaceId: workspace.id, type: 'note' })));
  await settle();
  assert.ok(changed().length >= 1 && changed().length < 10, `expected coalesced events, got ${changed().length}`);
  assert.ok(changed().every(event => event.workspaceId === workspace.id));
});

test('close flushes pending state to disk', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-events-')), dataDir = path.join(root, 'state'), project = path.join(root, 'project');
  fs.mkdirSync(project);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  const workspace = await host.invoke('workspace.open', { path: project });
  await host.invoke('node.create', { workspaceId: workspace.id, type: 'note' });
  await host.close();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(saved.workspaces[0].nodes.length, 1);
});
