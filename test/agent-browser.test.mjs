import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createBrowserClient, provisionBrowserTerminal, waitForHTTP, privateJSON, endpointFile } from '../host/agent-browser.mjs';
import { startAgentBrowser, saveBrowserArtifact } from '../desktop/agent-browser.mjs';

test('HTTP readiness shares a bounded deadline, retries unhealthy responses and supports cancellation', async t => {
  let requests = 0, healthy = false;
  const server = http.createServer((request, response) => {
    requests++;
    if (request.url === '/hang') return;
    response.writeHead(healthy ? 200 : 503); response.end('fixture');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const timer = setTimeout(() => { healthy = true; }, 180);
  t.after(() => clearTimeout(timer));
  assert.equal((await waitForHTTP(url, { timeoutMs: 1500 })).ready, true);
  assert.ok(requests >= 2);
  const start = Date.now();
  await assert.rejects(waitForHTTP(url + '/hang', { timeoutMs: 150 }), /HTTP readiness timeout/);
  assert.ok(Date.now() - start < 1200);
  await assert.rejects(waitForHTTP(url + '/hang', { timeoutMs: 2000, signal: AbortSignal.timeout(100) }), /abort|timeout/i);
  for (const value of ['file:///tmp/x', 'javascript:alert(1)', 'http://user:pass@localhost/', 'http://localhost/\n']) await assert.rejects(waitForHTTP(value));
});

test('private RPC binds a capability to a live terminal, workspace and restricted command surface', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-browser-unit-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workspaceId = randomUUID(), sessionId = randomUUID(), nodeId = randomUUID(), browserId = randomUUID();
  const capability = provisionBrowserTerminal(dataDir, { workspaceId, sessionId, nodeId });
  let running = true, active = workspaceId, creations = 0;
  const node = { id: browserId, type: 'browser', data: { agentTerminal: sessionId, agentKey: 'preview', url: 'http://localhost/' } };
  const bridge = await startAgentBrowser({ dataDir, emit() {}, focusWindow() {},
    getManager: () => ({ agentStatus: id => ({ id, webContentsId: 91, visible: true }), agentInvoke: async () => ({ text: 'same view' }) }),
    hostInvoke: async method => {
      if (method === 'terminal.list') return [{ id: sessionId, workspaceId, nodeId, status: running ? 'running' : 'exited' }];
      if (method === 'state.get') return { activeWorkspaceId: active, workspaces: [{ id: workspaceId, nodes: [node] }] };
      if (method === 'node.create') { creations++; throw new Error('unexpected creation'); }
      throw new Error('unexpected RPC');
    } });
  t.after(() => bridge.close());
  const client = createBrowserClient({ env: capability.env });
  assert.equal((await client.invoke('context')).sessionId, sessionId);
  assert.equal((await client.invoke('status')).webContentsId, 91);
  assert.equal((await client.invoke('read')).text, 'same view');
  for (const [command, payload] of [['evaluate', { source: '1+1' }], ['fill', { selector: '#x', value: 12 }],
    ['screenshot', { path: '/tmp/out.png' }], ['status', { key: '../other' }], ['click', { selector: '' }], ['open', { url: 'file:///tmp/x' }]]) {
    await assert.rejects(client.invoke(command, payload));
  }
  await assert.rejects(createBrowserClient({ env: { ...capability.env, PHANTOM_BROWSER_TOKEN: 'invalid' } }).invoke('status'), /no autorizado/);
  await assert.rejects(createBrowserClient({ env: { ...capability.env, PHANTOM_BROWSER_WORKSPACE: randomUUID() } }).invoke('status'), /no autorizado/);
  active = randomUUID(); await assert.rejects(client.invoke('status'), /proyecto activo/); active = workspaceId;
  running = false; await assert.rejects(client.invoke('context'), /no activa/); running = true;
  await assert.rejects(client.invoke('preview', { url: 'http://127.0.0.1:1/', timeoutMs: 100 }), /HTTP readiness timeout/);
  assert.equal(creations, 0);
  capability.revoke(); await assert.rejects(client.invoke('status'));
  const descriptor = privateJSON(endpointFile(dataDir)); assert.equal(descriptor.socketPath, bridge.socketPath);
});

test('artifacts are bounded, private and reject symlink escapes and oversized captures', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-browser-artifacts-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workspaceId = randomUUID();
  let artifact;
  for (let i = 0; i < 20; i++) artifact = saveBrowserArtifact(dataDir, workspaceId, Buffer.from('fixture-png'));
  const dir = path.dirname(artifact.path);
  assert.equal((await fs.readdir(dir)).length, 16);
  assert.equal((await fs.stat(artifact.path)).mode & 0o077, 0);
  assert.throws(() => saveBrowserArtifact(dataDir, workspaceId, Buffer.alloc(8 * 1024 * 1024 + 1)), /8MiB/);
  const victim = path.join(dataDir, 'victim'); await fs.mkdir(victim);
  const otherId = randomUUID(); await fs.symlink(victim, path.join(dataDir, 'browser-artifacts', otherId));
  assert.throws(() => saveBrowserArtifact(dataDir, otherId, Buffer.from('x')), /no autorizada/);
  assert.deepEqual(await fs.readdir(victim), []);
});
