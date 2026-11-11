import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, stat, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { browserContext, requestBrowser, terminalBrowserEnv, waitForHTTP } from '../host/agent-browser.mjs';
import { createAgentBrowserBridge, operateBrowserEntry, validateBrowserRequest } from '../desktop/agent-browser.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const stop = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };

test('HTTP readiness waits for success, bounds hung requests, rejects executable URLs and supports cancellation', async () => {
  let count = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/hang') return;
    res.writeHead(++count < 3 ? 503 : 200); res.end('ready');
  });
  await listen(server);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await waitForHTTP(url, { timeoutMs: 2000 }), `${url}/`);
    assert(count >= 3);
    const started = Date.now();
    await assert.rejects(waitForHTTP(`${url}/hang`, { timeoutMs: 200 }), { code: 'HTTP_TIMEOUT' });
    assert(Date.now() - started < 1500);
    await assert.rejects(waitForHTTP('javascript:alert(1)'), /HTTP/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(waitForHTTP(url, { signal: controller.signal }), { code: 'HTTP_TIMEOUT' });
  } finally { await stop(server); }
});

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pw-ab-'));
  const workspaceId = randomUUID(), terminalId = randomUUID(), sessionId = randomUUID();
  const env = terminalBrowserEnv(dir, workspaceId, terminalId, sessionId);
  const workspace = { id: workspaceId, nodes: [{ id: terminalId, type: 'terminal', data: {} }] };
  const state = { activeWorkspaceId: workspaceId, workspaces: [workspace] };
  const sessions = [{ id: sessionId, nodeId: terminalId, status: 'running' }];
  const manager = { entries: new Map() };
  let creates = 0;
  const bridge = createAgentBrowserBridge({ dataDir: dir, getManager: () => manager, focus: () => {},
    hostInvoke: async (method, p) => {
      if (method === 'terminal.list') return sessions;
      if (method === 'state.get') return state;
      if (method === 'node.create') { creates++; const node = { id: randomUUID(), type: p.type, data: p.data }; workspace.nodes.push(node); return node; }
      throw new Error(`Unexpected fixture method: ${method}`);
    } });
  await bridge.start();
  t.after(async () => { bridge.close(); await rm(dir, { recursive: true, force: true }); });
  return { bridge, dir, env, state, workspace, sessions, manager, creates: () => creates };
}

test('private real RPC binds capability to workspace, terminal and live session; context never reveals token', async t => {
  const f = await fixture(t);
  assert.equal((await stat(f.env.PHANTOM_BROWSER_ENDPOINT)).mode & 0o777, 0o600);
  const result = await requestBrowser('context', {}, { env: f.env });
  assert.equal(result.connected, true);
  assert(!JSON.stringify(result).includes(f.env.PHANTOM_BROWSER_TOKEN));
  assert(!JSON.stringify(browserContext(f.env)).includes(f.env.PHANTOM_BROWSER_TOKEN));
  for (const patch of [{ PHANTOM_BROWSER_TOKEN: '0'.repeat(64) }, { PHANTOM_TERMINAL_ID: randomUUID() },
    { PHANTOM_WORKSPACE_ID: randomUUID() }, { PHANTOM_TERMINAL_SESSION_ID: randomUUID() }]) {
    await assert.rejects(requestBrowser('context', {}, { env: { ...f.env, ...patch } }), { code: 'ACCESS_DENIED' });
  }
  f.sessions[0].status = 'exited';
  await assert.rejects(requestBrowser('context', {}, { env: f.env }), { code: 'ACCESS_DENIED' });
  await assert.rejects(requestBrowser('status', {}, { env: {} }), { code: 'NO_CONTEXT' });
});

test('RPC rejects arbitrary execution, paths, malformed identity, inputs and ambiguous options', async t => {
  const f = await fixture(t);
  for (const [method, params] of [['eval', { code: 'process.exit()' }], ['screenshot', { path: '/tmp/out.png' }],
    ['click', { selector: '#a\n' }], ['fill', { selector: '#a', value: '\0' }], ['read', { timeoutMs: 30001 }],
    ['open', { url: 'https://u:p@example.com' }], ['open', { url: 'file:///etc/passwd' }], ['status', { key: '../escape' }]]) {
    await assert.rejects(requestBrowser(method, params, { env: f.env }));
  }
  assert.throws(() => validateBrowserRequest({ version: 1, method: 'status', params: {}, workspaceId: '../escape' }));
  await assert.rejects(requestBrowser('status', { id: randomUUID() }, { env: f.env }), { code: 'ACCESS_DENIED' });
  f.state.activeWorkspaceId = randomUUID();
  await assert.rejects(requestBrowser('status', {}, { env: f.env }), { code: 'WORKSPACE_INACTIVE' });
  assert.equal(f.creates(), 0);
});

test('HTTP timeout creates no panel and cannot mutate after deadline; overlapping work is rejected', async t => {
  const f = await fixture(t);
  const server = http.createServer((_req, res) => { res.writeHead(503); res.end(); });
  await listen(server); t.after(() => stop(server));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const pending = requestBrowser('preview', { url, timeoutMs: 200 }, { env: f.env });
  const rejection = assert.rejects(pending, error => ['TIMEOUT', 'HTTP_TIMEOUT'].includes(error.code));
  await new Promise(resolve => setTimeout(resolve, 60));
  await assert.rejects(requestBrowser('context', {}, { env: f.env }), { code: 'BUSY' });
  await rejection;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(f.creates(), 0);
  assert.equal((await requestBrowser('context', {}, { env: f.env })).connected, true);
});

test('capture artifacts are private PNGs; symlinked path components cannot redirect writes', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pw-shot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspaceId = randomUUID(), bytes = Buffer.from('fixture-png-bytes');
  const entry = { id: randomUUID(), workspaceId, view: { webContents: { capturePage: async () => ({ isEmpty: () => false, toPNG: () => bytes }) } } };
  const options = { dataDir: dir, signal: new AbortController().signal };
  const shot = await operateBrowserEntry(entry, 'screenshot', {}, options);
  assert(shot.path.startsWith(path.join(dir, 'automation', workspaceId, 'browser', 'artifacts') + path.sep));
  assert.deepEqual(await readFile(shot.path), bytes);
  assert.equal((await stat(shot.path)).mode & 0o777, 0o600);
  const other = randomUUID(), outside = path.join(dir, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(dir, 'automation', other));
  await assert.rejects(operateBrowserEntry({ ...entry, workspaceId: other }, 'screenshot', {}, options), { code: 'ACCESS_DENIED' });
});
