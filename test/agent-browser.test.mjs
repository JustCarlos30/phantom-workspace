import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateBrowserAgentRequest } from '../desktop/security.mjs';
import { waitForHTTP, terminalBrowserEnvironment, revokeTerminalBrowser, requestBrowser, browserSocket } from '../host/agent-browser.mjs';
import { createAgentBrowserBridge } from '../desktop/agent-browser.mjs';

test('agent boundary rejects source code, unsafe URLs, paths and unbounded inputs', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com', 'http://localhost/\n']) assert.throws(() => validateBrowserAgentRequest('preview', { url }));
  for (const name of ['../capture.png', '/tmp/capture.png', 'a/b.png', '.hidden.png', 'a.jpg']) assert.throws(() => validateBrowserAgentRequest('screenshot', { name }));
  for (const command of ['evaluate', 'cdp', '__proto__', 'constructor']) assert.throws(() => validateBrowserAgentRequest(command, {}));
  assert.throws(() => validateBrowserAgentRequest('click', { selector: '#x', script: 'alert(1)' }));
  assert.throws(() => validateBrowserAgentRequest('fill', { selector: '#x', value: 'a'.repeat(16001) }));
  assert.throws(() => validateBrowserAgentRequest('fill', { selector: '#x', value: '\x1b[31m' }));
  validateBrowserAgentRequest('fill', { selector: 'textarea[name="notes"]', value: 'line 1\nline 2' });
  validateBrowserAgentRequest('screenshot', { name: 'fixture.png' });
});

test('HTTP readiness retries errors, does not follow redirects, and bounds a hanging response', async t => {
  let attempts = 0, followed = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/hang') return;
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/forbidden' }); return res.end(); }
    if (req.url === '/forbidden') followed = true;
    res.writeHead(++attempts < 3 ? 503 : 200); res.end('ready');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await waitForHTTP(origin, { timeoutMs: 3000 })).status, 200);
  assert.equal(attempts, 3);
  assert.equal((await waitForHTTP(`${origin}/redirect`)).status, 302);
  assert.equal(followed, false);
  const start = Date.now();
  await assert.rejects(waitForHTTP(`${origin}/hang`, { timeoutMs: 150 }), { code: 'HTTP_TIMEOUT' });
  assert.ok(Date.now() - start < 1500);
});

test('real private socket authenticates workspace/live terminal, revokes and rejects foreign panel access', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-browser-unit-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const workspaceId = randomUUID(), terminalId = randomUUID();
  const env = terminalBrowserEnvironment(dir, workspaceId, terminalId);
  const identity = { socketPath: browserSocket(dir), token: env.PHANTOM_BROWSER_TOKEN, workspaceId, terminalId };
  let running = true;
  const bridge = await createAgentBrowserBridge({ dataDir: dir,
    hostInvoke: async method => method === 'terminal.list' ? [{ id: terminalId, status: running ? 'running' : 'exited' }] : { activeWorkspaceId: workspaceId, workspaces: [{ id: workspaceId, nodes: [] }] },
    getManager: () => ({}), focusWindow() {}, emit() {},
  });
  t.after(() => bridge.close());
  assert.equal((await fs.stat(path.dirname(identity.socketPath))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(identity.socketPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(dir, 'agent-browser', `${terminalId}.json`))).mode & 0o777, 0o600);
  assert.equal((await requestBrowser(identity, 'context')).terminalId, terminalId);
  await assert.rejects(requestBrowser({ ...identity, token: '0'.repeat(64) }, 'context'), { code: 'ACCESS_DENIED' });
  await assert.rejects(requestBrowser({ ...identity, workspaceId: randomUUID() }, 'context'), { code: 'ACCESS_DENIED' });
  await assert.rejects(requestBrowser(identity, 'status', { id: randomUUID() }), { code: 'ACCESS_DENIED' });
  await assert.rejects(requestBrowser(identity, 'evaluate', { source: '1+1' }), { code: 'INVALID_INPUT' });
  running = false;
  await assert.rejects(requestBrowser(identity, 'context'), { code: 'ACCESS_DENIED' });
  running = true; revokeTerminalBrowser(dir, terminalId);
  await assert.rejects(requestBrowser(identity, 'context'), { code: 'ACCESS_DENIED' });
});
