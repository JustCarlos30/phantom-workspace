import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { createServer as createViteServer } from 'vite';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// Mandatory REAL Electron/Playwright integration. Uses only its freshly created
// profile, host and windows. DISPLAY follows desktop-smoke.mjs (:1 by default).
// Missing Electron/display/dependencies is a failure, never a simulated pass/skip.
const execute = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-agent-e2e-'));
const home = path.join(temp, 'profile'), workspacePath = path.join(temp, 'workspace');
await fs.mkdir(workspacePath);
let app, page, vite, hostPID;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, description, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(50); }
  throw new Error(`Timeout: ${description}`);
}
const fixture = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>Agent bridge fixture</title>
    <body style="background:#edf6f1;font:24px system-ui;padding:30px">
    <h1>REAL_ELECTRON_BRIDGE_FIXTURE</h1><p id="route">${req.url === '/popup' ? 'POPUP_IN_SAME_VIEW' : 'INITIAL_ROUTE'}</p>
    <input id="name" aria-label="Fixture name"><button id="apply">Apply</button>
    <p id="result">No action yet</p><button id="popup">Popup</button><button id="burst">Console burst</button>
    <script>
      console.log('FIXTURE_CONSOLE_READY');
      document.querySelector('#apply').onclick = () => {
        document.querySelector('#result').textContent = 'DOM_ACTION:' + document.querySelector('#name').value;
        console.log('FIXTURE_CLICKED');
      };
      document.querySelector('#popup').onclick = () => window.open('/popup', '_blank');
      document.querySelector('#burst').onclick = () => { for (let i=0;i<150;i++) console.log('BOUNDED_LOG_' + i); };
      document.querySelector('#name').oninput = () => document.body.dataset.inputEvent = 'received';
    </script>`);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${fixture.address().port}/`;
const invoke = (method, payload = {}) => page.evaluate(([method, payload]) => window.phantom.invoke(method, payload), [method, payload]);
async function nativeState(id) {
  return app.evaluate(async ({ BrowserWindow }, id) => {
    const views = BrowserWindow.getAllWindows()[0].contentView.children;
    const view = views.find(v => v.webContents.id === id);
    if (!view) return null;
    return { id: view.webContents.id, visible: view.getVisible(), bounds: view.getBounds(),
      url: view.webContents.getURL(), dom: await view.webContents.executeJavaScript(`({text:document.body.innerText,value:document.querySelector('#name')?.value,inputEvent:document.body.dataset.inputEvent,require:typeof require,phantom:typeof window.phantom,injected:globalThis.AGENT_INJECTED})`) };
  }, id);
}
async function terminalEnv(session) {
  const raw = await fs.readFile(`/proc/${session.pid}/environ`, 'utf8');
  const inherited = Object.fromEntries(raw.split('\0').filter(Boolean).map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
  assert.equal(inherited.PHANTOM_TERMINAL_ID, session.nodeId);
  assert.equal(inherited.PHANTOM_WORKSPACE_ID, session.workspaceId);
  assert.equal(inherited.PHANTOM_BROWSER_CLI, path.join(root, 'scripts/workspace-browser.mjs'));
  assert(inherited.PHANTOM_BROWSER_HELP.includes('preview'));
  delete inherited.ELECTRON_RUN_AS_NODE;
  return inherited;
}
async function cli(env, ...args) {
  const result = await execute(process.execPath, [env.PHANTOM_BROWSER_CLI, ...args], { env, cwd: workspacePath, timeout: 35_000, maxBuffer: 512 * 1024 });
  return JSON.parse(result.stdout);
}
async function cliError(env, args, pattern) {
  await assert.rejects(cli(env, ...args), error => { assert.match(error.stderr || error.message, pattern); return true; });
}

try {
  // Vite serves the actual source UI so this check doesn't depend on a previous
  // build (the controller deliberately runs e2e before its build check).
  vite = await createViteServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await vite.listen();
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1', SHELL: '/bin/sh', PHANTOM_WORKSPACE_HOME: home,
    PHANTOM_RENDERER_URL: `http://127.0.0.1:${vite.httpServer.address().port}/`, PHANTOM_NODE_BINARY: process.execPath };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'PHANTOM_BROWSER_SOCKET', 'PHANTOM_BROWSER_CREDENTIAL']) delete env[key];
  app = await electron.launch({ args: [root], cwd: root, env, timeout: 20_000 });
  page = await app.firstWindow(); page.setDefaultTimeout(10_000);
  await page.waitForSelector('.app-shell');
  const host = await invoke('system.info'); assert.equal(host.dataDir, home); hostPID = host.pid;
  await app.evaluate(({ shell }) => {
    globalThis.__agentExternalCalls = [];
    shell.openExternal = async (...args) => { globalThis.__agentExternalCalls.push(args); throw new Error('Unexpected external open in bridge test'); };
  });
  const workspace = await invoke('workspace.open', { path: workspacePath });
  const terminal = await invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh', cols: 80, rows: 24 });
  const terminalEnvironment = await terminalEnv(terminal.session);
  await poll(() => fs.stat(terminalEnvironment.PHANTOM_BROWSER_SOCKET).then(s => s.isSocket()).catch(() => false), 'private socket started');
  const context = await cli(terminalEnvironment, 'context');
  assert.equal(context.workspaceId, workspace.id); assert.equal(context.terminalId, terminal.node.id);
  assert.equal(context.available, true);
  const help = await execute(process.execPath, [terminalEnvironment.PHANTOM_BROWSER_CLI, 'help'], { env: terminalEnvironment });
  assert.match(help.stdout, /preview/); assert.match(help.stdout, /Electron/);

  const opened = await cli(terminalEnvironment, 'preview', url, '--timeout', '15000');
  assert.equal(opened.visible, true); assert.equal(opened.workspaceId, workspace.id);
  await page.locator(`.canvas-node.focused [data-browser-id="${opened.id}"]`).waitFor();
  const native = await nativeState(opened.webContentsId);
  assert(native.visible && native.bounds.width > 0 && native.bounds.height > 0);
  assert.match(native.dom.text, /REAL_ELECTRON_BRIDGE_FIXTURE/);
  assert.equal(native.dom.require, 'undefined'); assert.equal(native.dom.phantom, 'undefined');
  assert.match((await cli(terminalEnvironment, 'read', 'h1')).text, /REAL_ELECTRON_BRIDGE_FIXTURE/);
  console.log('PASS CLI preview focuses a real isolated Electron WebContentsView');

  const value = 'Hola 👋 " ); globalThis.AGENT_INJECTED = true; //';
  await cli(terminalEnvironment, 'fill', '#name', value);
  await cli(terminalEnvironment, 'click', '#apply');
  const changed = await nativeState(opened.webContentsId);
  assert.equal(changed.dom.value, value); assert.equal(changed.dom.inputEvent, 'received');
  assert.equal(changed.dom.injected, undefined); assert(changed.dom.text.includes(`DOM_ACTION:${value}`));
  assert.equal((await cli(terminalEnvironment, 'read', '#result')).text, `DOM_ACTION:${value}`);
  await cliError(terminalEnvironment, ['click', '['], /Selector CSS no válido/);
  await cliError(terminalEnvironment, ['read', '#missing-element'], /Elemento no encontrado/);
  await cliError(terminalEnvironment, ['fill', 'h1', 'x'], /Input no editable/);
  assert.equal((await cli(terminalEnvironment, 'status')).webContentsId, opened.webContentsId, 'DOM validation errors preserve the existing view');
  assert((await cli(terminalEnvironment, 'console')).messages.some(m => m.message.includes('FIXTURE_CLICKED')));
  const screenshot = await cli(terminalEnvironment, 'screenshot', 'real-view.png');
  assert(screenshot.path.startsWith(path.join(home, 'automation', workspace.id, 'artifacts') + path.sep));
  const bytes = await fs.readFile(screenshot.path);
  assert(bytes.length > 1000); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  console.log('PASS read/click/fill/console/screenshot reflect the SAME visible DOM session');

  const twice = await Promise.all([cli(terminalEnvironment, 'preview', url), cli(terminalEnvironment, 'open', url)]);
  for (const result of twice) { assert.equal(result.id, opened.id); assert.equal(result.webContentsId, opened.webContentsId); }
  assert.equal((await cli(terminalEnvironment, 'read', '#result')).text, `DOM_ACTION:${value}`, 'repeat preview does not reload the session');
  let state = await invoke('state.get');
  assert.equal(state.workspaces.find(w => w.id === workspace.id).nodes.filter(n => n.type === 'browser').length, 1);
  await cli(terminalEnvironment, 'preview', url, '--key', 'second');
  state = await invoke('state.get');
  assert.equal(state.workspaces.find(w => w.id === workspace.id).nodes.filter(n => n.type === 'browser').length, 2);
  const resumed = await cli(terminalEnvironment, 'preview', url);
  assert.equal(resumed.webContentsId, opened.webContentsId);
  assert.equal((await cli(terminalEnvironment, 'read', '#result')).text, `DOM_ACTION:${value}`);
  console.log('PASS concurrent/repeated previews reuse one node and session per terminal/key');

  const down = http.createServer(); await new Promise(resolve => down.listen(0, '127.0.0.1', resolve));
  const downURL = `http://127.0.0.1:${down.address().port}/`;
  await new Promise(resolve => down.close(resolve));
  const started = Date.now();
  await cliError(terminalEnvironment, ['preview', downURL, '--timeout', '500'], /HTTP no disponible|Timeout de preview/);
  assert(Date.now() - started < 3000);
  assert.equal((await cli(terminalEnvironment, 'status')).webContentsId, opened.webContentsId);
  assert.equal((await cli(terminalEnvironment, 'status')).url, url);
  assert.equal((await invoke('state.get')).workspaces.find(w => w.id === workspace.id).nodes.filter(n => n.type === 'browser').length, 2);
  console.log('PASS unavailable HTTP fails within a bounded timeout before navigation/node creation');

  const auth = JSON.parse(await fs.readFile(terminalEnvironment.PHANTOM_BROWSER_CREDENTIAL, 'utf8'));
  const badCredential = path.join(temp, 'bad-credential.json');
  await fs.writeFile(badCredential, JSON.stringify({ ...auth, token: '0'.repeat(64) }));
  await cliError({ ...terminalEnvironment, PHANTOM_BROWSER_CREDENTIAL: badCredential }, ['status'], /no autorizado/);
  await fs.writeFile(badCredential, JSON.stringify({ ...auth, workspaceId: randomUUID() }));
  await cliError({ ...terminalEnvironment, PHANTOM_BROWSER_CREDENTIAL: badCredential }, ['status'], /no autorizado/);
  const otherTerminal = await invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' });
  await cliError(await terminalEnv(otherTerminal.session), ['status', '--id', opened.id], /no autorizado/);
  await cliError(terminalEnvironment, ['screenshot', '../escape.png'], /rutas no permitidas/);
  await cliError(terminalEnvironment, ['preview', 'javascript:alert(1)'], /HTTP|URL/);
  await cliError(terminalEnvironment, ['eval', 'document.body'], /Argumentos no válidos/);
  await cli(terminalEnvironment, 'click', '#burst');
  const logs = await poll(async () => {
    const result = await cli(terminalEnvironment, 'console');
    return result.messages.some(m => m.message.includes('BOUNDED_LOG_149')) && result;
  }, 'bounded console delivery');
  assert.equal(logs.messages.length, 100); assert(logs.messages.every(m => m.message.length <= 2000));
  assert(logs.messages.some(m => m.message.includes('BOUNDED_LOG_149')));
  await cli(terminalEnvironment, 'click', '#popup');
  await poll(async () => { const status = await cli(terminalEnvironment, 'status'); return status.url.endsWith('/popup') && !status.loading; }, 'popup kept in same view');
  assert.match((await cli(terminalEnvironment, 'read', '#route')).text, /POPUP_IN_SAME_VIEW/);
  assert.equal((await cli(terminalEnvironment, 'status')).webContentsId, opened.webContentsId);
  assert.deepEqual(await app.evaluate(() => globalThis.__agentExternalCalls), []);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await invoke('terminal.stop', { sessionId: terminal.session.id });
  await poll(async () => (await invoke('terminal.list', { workspaceId: workspace.id })).find(s => s.id === terminal.session.id).status === 'exited', 'terminal stopped');
  await cliError(terminalEnvironment, ['status'], /Terminal no activa/);
  console.log('PASS authentication, ownership, bounded console, input validation, no external opening');
  console.log(`Real screenshot artifact: ${screenshot.path}`);
} finally {
  if (page && !page.isClosed()) {
    try { await invoke('desktop.quit', { stopHost: true }); await poll(() => app.process().exitCode !== null || app.process().signalCode !== null, 'fixture Electron shutdown', 5000); } catch { /* cleanup only below */ }
  }
  // Never app.close() another instance or enumerate/close user windows. Only the
  // child process and isolated host whose exact profile we created may be killed.
  if (app?.process().exitCode === null && app.process().signalCode === null) app.process().kill('SIGKILL');
  if (hostPID) {
    try {
      const argv = (await fs.readFile(`/proc/${hostPID}/cmdline`, 'utf8')).split('\0');
      if (argv.includes(home) && argv.some(arg => arg.endsWith('/host/server.mjs'))) process.kill(hostPID, 'SIGTERM');
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
  }
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await vite?.close();
  // Profile/artifacts retained for controller inspection, never reused by tests.
  console.log(`Isolated e2e profile: ${home}`);
}
