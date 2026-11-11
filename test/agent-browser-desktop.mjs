import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { _electron } from 'playwright';
import electronExecutable from 'electron';
import { createServer } from 'vite';
import { createHost } from '../host/server.mjs';
import { createBrowserClient } from '../host/agent-browser.mjs';

// Real Electron + real CLI + HTTP fixture. No skips, user profiles, external
// browsers, mock WebContents or public debugger. Vite avoids a prebuilt-dist
// dependency: this acceptance check intentionally runs before the build check.
const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-browser-e2e-'));
const dataDir = path.join(temp, 'profile'), project = path.join(temp, 'project');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  do { const result = await fn(); if (result) return result; await delay(80); } while (Date.now() < end);
  throw new Error(`Timeout: ${label}`);
}
function shellQuote(value) { return "'" + value.replaceAll("'", "'\\''") + "'"; }
let host, vite, app, page, electronProcess;
const owned = new Map();
let healthy = true, fixtureRequests = 0;
const fixture = http.createServer((request, response) => {
  fixtureRequests++;
  response.setHeader('Content-Type', 'text/html');
  response.writeHead(healthy ? 200 : 503);
  response.end(`<!doctype html><title>Agent browser fixture</title>
    <body style="background:#e7f4ef;color:#142d25;font:22px sans-serif;padding:30px">
    <h1>VISIBLE_DOM_FIXTURE</h1><p id="session"></p><input id="name" aria-label="Fixture name">
    <button id="apply">Apply fixture</button><output id="result">untouched</output>
    <button id="spam">Console burst</button><button id="popup">Popup</button>
    <script>
      const token = sessionStorage.token ||= crypto.randomUUID();
      document.cookie = 'fixture_session=' + token + '; path=/';
      document.querySelector('#session').textContent = 'SESSION:' + token;
      document.body.dataset.clicks = '0';
      console.log('FIXTURE_READY', token);
      document.querySelector('#apply').onclick = () => {
        document.body.dataset.clicks = String(Number(document.body.dataset.clicks) + 1);
        document.querySelector('#result').textContent = 'APPLIED:' + document.querySelector('#name').value;
        setTimeout(() => console.warn('FIXTURE_ASYNC_APPLIED', document.body.dataset.clicks), 35);
      };
      document.querySelector('#spam').onclick = () => {
        for (let i=0;i<125;i++) console.log('BOUNDED_CONSOLE_' + i, 'x'.repeat(3000));
        setTimeout(() => console.error('BOUNDED_CONSOLE_END'), 35);
      };
      document.querySelector('#popup').onclick = () => window.open('/popup', '_blank');
    </script>`);
});

// Track only descendants of the Electron process returned by this launch. Linux
// start-time identities prevent cleanup from ever signaling a reused/user PID.
async function processes() {
  const names = await fs.readdir('/proc');
  return (await Promise.all(names.filter(name => /^\d+$/.test(name)).map(async name => {
    try {
      const text = await fs.readFile(`/proc/${name}/stat`, 'utf8');
      const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
      return { pid: Number(name), parent: Number(fields[1]), state: fields[0], start: fields[19] };
    } catch { return null; }
  }))).filter(Boolean);
}
async function rememberElectronTree() {
  if (!electronProcess) return;
  const rows = await processes(), ids = new Set([electronProcess.pid, ...owned.keys()]);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if (!ids.has(row.pid) && ids.has(row.parent)) { ids.add(row.pid); changed = true; }
  }
  for (const row of rows) if (ids.has(row.pid) && !owned.has(row.pid)) owned.set(row.pid, row.start);
}
async function signalOwned(signal) {
  for (const row of await processes()) if (owned.get(row.pid) === row.start && row.state !== 'Z') {
    try { process.kill(row.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
const cleanEnv = { ...process.env, DISPLAY: process.env.DISPLAY || ':1', SHELL: '/bin/sh', PHANTOM_WORKSPACE_HOME: dataDir };
for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'PHANTOM_NODE_BINARY', 'PHANTOM_RENDERER_URL',
  'PHANTOM_BROWSER_CLI', 'PHANTOM_BROWSER_ENDPOINT', 'PHANTOM_BROWSER_TOKEN', 'PHANTOM_BROWSER_SESSION', 'PHANTOM_BROWSER_WORKSPACE']) delete cleanEnv[name];
const invoke = (method, payload = {}) => page.evaluate(([method, payload]) => window.phantom.invoke(method, payload), [method, payload]);
async function terminalEnvironment(workspaceId, suffix) {
  const { session } = await host.invoke('terminal.create', { workspaceId, shell: '/bin/sh', cols: 80, rows: 24 });
  const destination = path.join(temp, `terminal-${suffix}.json`);
  const source = `require('node:fs').writeFileSync(${JSON.stringify(destination)},JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith('PHANTOM_BROWSER_')))),{mode:0o600})`;
  host.invoke('terminal.write', { sessionId: session.id, data: `${shellQuote(process.execPath)} -e ${shellQuote(source)}\r` });
  const env = await poll(async () => {
    try { return JSON.parse(await fs.readFile(destination, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
  }, 'browser env inherited by real PTY shell');
  assert.equal(env.PHANTOM_BROWSER_SESSION, session.id);
  assert.equal(env.PHANTOM_BROWSER_WORKSPACE, workspaceId);
  assert.equal(env.PHANTOM_BROWSER_CLI, path.join(root, 'scripts/workspace-browser.mjs'));
  assert.ok(!JSON.stringify(session).includes(env.PHANTOM_BROWSER_TOKEN));
  assert.ok(!JSON.stringify(host.store.state).includes(env.PHANTOM_BROWSER_TOKEN));
  return { env: { ...cleanEnv, ...env }, session };
}
async function cli(env, ...args) {
  const result = await execute(process.execPath, [env.PHANTOM_BROWSER_CLI, ...args], { env, cwd: project, timeout: 25000, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout);
}
async function nativeState(id) {
  return app.evaluate(async ({ webContents, BrowserWindow }, id) => {
    const wc = webContents.fromId(id);
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents.id === id);
    return { id: wc.id, url: wc.getURL(), visible: view.getVisible(), bounds: view.getBounds(),
      dom: await wc.executeJavaScript(`({text:document.body.innerText,value:document.querySelector('#name').value,
        clicks:document.body.dataset.clicks,token:sessionStorage.token,cookie:document.cookie,
        phantom:typeof window.phantom,require:typeof require})`) };
  }, id);
}

let failed = false;
try {
  await fs.mkdir(project, { recursive: true });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  // In-process owned host prevents detached daemon leftovers, including launch failures.
  host = await createHost({ dataDir });
  vite = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await vite.listen();
  cleanEnv.PHANTOM_RENDERER_URL = `http://127.0.0.1:${vite.httpServer.address().port}/`;
  app = await _electron.launch({ executablePath: electronExecutable, args: [...(process.getuid() === 0 ? ['--no-sandbox'] : []), root],
    cwd: root, env: cleanEnv, timeout: 20000 });
  electronProcess = app.process();
  await rememberElectronTree();
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.waitForSelector('.app-shell');
  const workspace = await invoke('workspace.open', { path: project });
  const { env, session } = await terminalEnvironment(workspace.id, 'first');
  const help = await execute(process.execPath, [env.PHANTOM_BROWSER_CLI, 'help'], { env: cleanEnv, timeout: 5000 });
  assert.match(help.stdout, /PHANTOM_BROWSER_CLI/);
  const context = await cli(env, 'context');
  assert.equal(context.workspaceId, workspace.id);
  assert.equal(context.sessionId, session.id);
  assert.equal(context.available, true);

  const first = await cli(env, 'preview', url, '--timeout-ms', '3000');
  assert.equal(first.ready, true); assert.equal(first.reused, false);
  assert.equal(first.visible, true); assert.equal(first.attached, true);
  assert.ok(fixtureRequests >= 2, 'readiness HTTP and native navigation both hit fixture');
  await page.locator(`.canvas-node.focused [data-browser-id="${first.id}"]`).waitFor();
  const initial = await nativeState(first.webContentsId);
  assert.equal(initial.visible, true); assert.ok(initial.bounds.width > 100 && initial.bounds.height > 100);
  assert.equal(initial.dom.phantom, 'undefined'); assert.equal(initial.dom.require, 'undefined');
  assert.match(initial.dom.cookie, /fixture_session=/);
  const read = await cli(env, 'read');
  assert.equal(read.webContentsId, initial.id);
  assert.match(read.text, /VISIBLE_DOM_FIXTURE/); assert.ok(read.text.includes(initial.dom.token));
  const value = 'visible session "quoted" \\ value';
  await cli(env, 'fill', '--selector', '#name', '--value', value);
  await cli(env, 'click', '--selector', '#apply');
  assert.equal((await nativeState(first.webContentsId)).dom.value, value);
  assert.match((await cli(env, 'read', '--selector', '#result')).text, /APPLIED:visible session/);
  // console-message arrives asynchronously: bounded poll retains every assertion.
  const messages = await poll(async () => {
    const result = await cli(env, 'console');
    return result.messages.some(message => message.message.includes('FIXTURE_ASYNC_APPLIED')) ? result.messages : false;
  }, 'Electron 45 async console-message details');
  assert.ok(messages.some(message => message.message.includes('FIXTURE_READY')));
  assert.ok(messages.some(message => message.level === 'warning' && message.message.includes('FIXTURE_ASYNC_APPLIED')));

  const capture = await cli(env, 'screenshot');
  const png = await fs.readFile(capture.path);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(capture.id, first.id); assert.equal(capture.bytes, png.length);
  assert.ok(capture.path.startsWith(path.join(dataDir, 'browser-artifacts', workspace.id) + path.sep));
  assert.equal((await fs.stat(capture.path)).mode & 0o077, 0);

  const second = await cli(env, 'preview', url, '--timeout-ms', '3000');
  assert.equal(second.id, first.id); assert.equal(second.webContentsId, first.webContentsId); assert.equal(second.reused, true);
  const unchanged = await nativeState(second.webContentsId);
  assert.equal(unchanged.dom.token, initial.dom.token); assert.equal(unchanged.dom.clicks, '1'); assert.equal(unchanged.dom.value, value);
  assert.equal((await host.invoke('state.get')).workspaces.find(w => w.id === workspace.id).nodes.filter(n => n.type === 'browser').length, 1);

  // A second key navigates in its own visible panel; open has the same readiness API.
  const keyed = await cli(env, 'open', url, '--key', 'secondary', '--timeout-ms', '3000');
  assert.notEqual(keyed.id, first.id); assert.notEqual(keyed.webContentsId, first.webContentsId);
  const refocused = await cli(env, 'preview', url);
  assert.equal(refocused.id, first.id); assert.equal((await nativeState(first.webContentsId)).dom.clicks, '1');
  assert.equal((await cli(env, 'status')).webContentsId, first.webContentsId);

  const secondTerminal = await terminalEnvironment(workspace.id, 'second');
  await assert.rejects(cli(secondTerminal.env, 'read'), error => /Sin panel/.test(error.stderr));
  const isolatedPanel = await cli(secondTerminal.env, 'preview', url);
  assert.notEqual(isolatedPanel.id, first.id);
  assert.notEqual(isolatedPanel.webContentsId, first.webContentsId);
  await cli(env, 'preview', url);

  await assert.rejects(cli({ ...env, PHANTOM_BROWSER_TOKEN: 'invalid' }, 'status'), error => /no autorizado/.test(error.stderr));
  await assert.rejects(cli({ ...env, PHANTOM_BROWSER_WORKSPACE: randomUUID() }, 'status'), error => /no autorizado/.test(error.stderr));
  await assert.rejects(createBrowserClient({ env }).invoke('evaluate', { code: '1+1' }), /no permitido/);
  await assert.rejects(cli(env, 'open', 'file:///etc/passwd'), error => /HTTP/.test(error.stderr));
  await assert.rejects(createBrowserClient({ env }).invoke('screenshot', { path: '../escape.png' }), /no válidas/);
  await assert.rejects(cli(env, 'fill', '--selector', '#apply', '--value', 'invalid'), error => /no admite fill/.test(error.stderr));
  await assert.rejects(cli(env, 'click', '--selector', 'button'), error => /exactamente un elemento/.test(error.stderr));

  await cli(env, 'click', '--selector', '#spam');
  const bounded = await poll(async () => {
    const result = await cli(env, 'console');
    return result.messages.some(message => message.message === 'BOUNDED_CONSOLE_END') ? result : false;
  }, 'console bounded burst');
  assert.equal(bounded.messages.length, 100);
  assert.ok(bounded.messages.every(message => message.message.length <= 2048));
  assert.ok(bounded.messages.some(message => message.level === 'error' && message.message === 'BOUNDED_CONSOLE_END'));

  healthy = false;
  const nodesBefore = (await host.invoke('state.get')).workspaces.find(w => w.id === workspace.id).nodes.length;
  const timeoutStart = Date.now();
  await assert.rejects(cli(env, 'preview', url, '--key', 'unhealthy', '--timeout-ms', '200'), error => /HTTP readiness timeout/.test(error.stderr));
  assert.ok(Date.now() - timeoutStart < 4000);
  assert.equal((await host.invoke('state.get')).workspaces.find(w => w.id === workspace.id).nodes.length, nodesBefore);
  const deadURL = url.replace(`:${fixture.address().port}`, ':1');
  await assert.rejects(cli(env, 'preview', deadURL, '--timeout-ms', '200'), error => /HTTP readiness timeout/.test(error.stderr));
  assert.equal((await cli(env, 'status')).url, url);
  healthy = true;

  await cli(env, 'click', '--selector', '#popup');
  await poll(async () => (await cli(env, 'status')).url === url + 'popup', 'popup stays in same WebContents');
  assert.equal((await cli(env, 'status')).webContentsId, first.webContentsId);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  // Playwright's windows() includes WebContentsView pages as well as native
  // BrowserWindows. Every page must still belong to our renderer/fixture URLs.
  const allowedPages = new Set([cleanEnv.PHANTOM_RENDERER_URL, url, url + 'popup']);
  assert.ok(app.windows().every(window => allowedPages.has(window.url())));
  await rememberElectronTree();
  console.log('PASS agent-browser Electron + CLI: visible DOM/session, controls, PNG, async bounded console, reuse, readiness, authentication, no external windows');
} catch (error) {
  failed = true;
  console.error(error.stack || error);
} finally {
  // Kill only this isolated launch if graceful drain fails; stop the owned host
  // after Electron to prevent its reconnect loop from spawning another daemon.
  try {
    await rememberElectronTree();
    if (app) {
      let timer;
      try { await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron cleanup timeout')), 5000); })]); }
      catch { await signalOwned('SIGTERM'); await delay(250); }
      finally { clearTimeout(timer); }
    }
    await signalOwned('SIGKILL');
    await poll(async () => !(await processes()).some(row => owned.get(row.pid) === row.start && row.state !== 'Z'), 'owned Electron processes exited', 5000);
  } catch (error) { failed = true; console.error('Process cleanup:', error); }
  try { await host?.close(); } catch (error) { failed = true; console.error('Host cleanup:', error); }
  try { await vite?.close(); } catch (error) { failed = true; console.error(error); }
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
