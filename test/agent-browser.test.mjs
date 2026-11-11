import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, stat, symlink, mkdir } from 'node:fs/promises';
import { waitForHTTP, previewURL, timeoutValue, terminalBrowserEnvironment, requestBrowser, browserContext } from '../host/agent-browser.mjs';
import { validateAgentRequest } from '../desktop/security.mjs';
import { startAgentBrowserBridge } from '../desktop/agent-browser.mjs';

test('readiness retries HTTP failures, accepts redirects without following, and enforces total timeout', async t => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/hang') return;
    if (req.url === '/redirect') { res.writeHead(302, { location: 'file:///etc/passwd' }); res.end(); return; }
    res.writeHead(++requests < 3 ? 503 : 200); res.end('ready');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await waitForHTTP(`${url}/`, { timeoutMs: 2000 })).ready, true);
  assert.equal(requests, 3);
  assert.equal((await waitForHTTP(`${url}/redirect`)).ready, true);
  const start = Date.now();
  await assert.rejects(waitForHTTP(`${url}/hang`, { timeoutMs: 150 }), /HTTP no disponible tras 150ms/);
  assert(Date.now() - start < 1000);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(waitForHTTP(url, { signal: controller.signal }), /abort/i);
});

test('agent validation rejects URLs, source code, path traversal and unbounded inputs', () => {
  for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'http://user:pass@localhost', 'http://localhost/\n', 'data:text/html,a', 'about:blank']) assert.throws(() => previewURL(url));
  assert.equal(previewURL('http://localhost:3000'), 'http://localhost:3000/');
  for (const value of [0, 99, 30001, Infinity, '1000', 100.5]) assert.throws(() => timeoutValue(value));
  assert.throws(() => validateAgentRequest('eval', { script: '1' }));
  assert.throws(() => validateAgentRequest('read', { script: '1' }), /Campo/);
  for (const name of ['../a.png', '/tmp/a.png', 'a/b.png', '.hidden.png', 'a.jpg']) assert.throws(() => validateAgentRequest('screenshot', { name }));
  assert.throws(() => validateAgentRequest('fill', { selector: '#a', value: 'x'.repeat(16001) }));
  assert.throws(() => validateAgentRequest('click', { selector: '\n' }));
  assert.throws(() => validateAgentRequest('status', { key: '../x' }));
  assert.throws(() => validateAgentRequest('preview', { url: 'https://user:secret@localhost/' }));
  validateAgentRequest('fill', { selector: '[data-x="\"; throw 1; //"]', value: 'hola 👋\n"; globalThis.bad = true; //' });
});

test('private RPC authenticates live terminal identity, limits access and safely writes artifacts', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'phantom-bridge-unit-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const workspaceId = randomUUID(), terminalId = randomUUID(), browserId = randomUUID();
  const env = terminalBrowserEnvironment(dataDir, workspaceId, terminalId);
  const auth = JSON.parse(await readFile(env.PHANTOM_BROWSER_CREDENTIAL, 'utf8'));
  assert.equal((await stat(env.PHANTOM_BROWSER_CREDENTIAL)).mode & 0o077, 0);
  assert.equal(browserContext(env).workspaceId, workspaceId);
  assert(!JSON.stringify(browserContext(env)).includes(auth.token));
  const node = { id: browserId, type: 'browser', data: { agentBrowser: { terminalId, key: 'default' } } };
  const workspace = { id: workspaceId, nodes: [{ id: terminalId, type: 'terminal' }, node] };
  let running = true, captures = 0;
  // Unit fixture for transport/authorization; real Electron DOM is tested in the
  // mandatory separate test/agent-browser-desktop.mjs, not imitated here.
  const entry = { workspaceId, console: [{ message: 'fixture' }], view: { webContents: {
    capturePage: async () => { captures++; return { isEmpty: () => false, toPNG: () => Buffer.from('unit fixture image') }; },
  } } };
  const manager = { agentEntry: id => { assert.equal(id, browserId); return entry; },
    agentStatus: () => ({ id: browserId, workspaceId }) };
  const bridge = await startAgentBrowserBridge({ dataDir, getManager: () => manager,
    hostInvoke: async method => method === 'state.get' ? { activeWorkspaceId: workspaceId, workspaces: [workspace] }
      : [{ nodeId: terminalId, status: running ? 'running' : 'exited' }], emit() {}, focusWindow() {} });
  t.after(() => bridge.close());
  assert.equal((await stat(bridge.socketPath)).mode & 0o077, 0);
  assert.equal((await requestBrowser('status', {}, { env })).id, browserId);
  await assert.rejects(requestBrowser('status', { id: randomUUID() }, { env }), /no autorizado/);
  await assert.rejects(requestBrowser('read', { script: 'process.exit()' }, { env }), /Campo/);
  assert.deepEqual((await requestBrowser('console', {}, { env })).messages, entry.console);
  const shot = await requestBrowser('screenshot', { name: 'unit.png' }, { env });
  assert.equal(shot.path, path.join(dataDir, 'automation', workspaceId, 'artifacts', 'unit.png'));
  assert.equal((await stat(shot.path)).mode & 0o077, 0);
  await assert.rejects(requestBrowser('screenshot', { name: 'unit.png' }, { env }), /EEXIST/);
  await assert.rejects(requestBrowser('screenshot', { name: '../escape.png' }, { env }), /rutas no permitidas/);
  const external = path.join(dataDir, 'outside'); await mkdir(external);
  await rm(path.dirname(shot.path), { recursive: true });
  await symlink(external, path.dirname(shot.path));
  await assert.rejects(requestBrowser('screenshot', { name: 'escape.png' }, { env }), /no autorizado/);
  assert.equal(captures, 2, 'symlink/traversal rejected before capture');
  const wrongCredential = path.join(dataDir, 'wrong.json');
  await writeFile(wrongCredential, JSON.stringify({ ...auth, token: '0'.repeat(64) }));
  await assert.rejects(requestBrowser('status', {}, { env: { ...env, PHANTOM_BROWSER_CREDENTIAL: wrongCredential } }), /no autorizado/);
  await writeFile(wrongCredential, JSON.stringify({ ...auth, workspaceId: randomUUID() }));
  await assert.rejects(requestBrowser('status', {}, { env: { ...env, PHANTOM_BROWSER_CREDENTIAL: wrongCredential } }), /no autorizado/);
  running = false;
  await assert.rejects(requestBrowser('status', {}, { env }), /Terminal no activa/);
  await assert.rejects(requestBrowser('status', {}, { env: {} }), /no descubierto/);
  await new Promise((resolve, reject) => {
    const client = net.createConnection(bridge.socketPath);
    client.on('error', reject); client.on('close', resolve);
    client.on('connect', () => client.write('x'.repeat(33 * 1024)));
  });
});
