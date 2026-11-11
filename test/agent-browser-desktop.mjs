import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Real Electron, real PTY credentials, real CLI and native WebContentsView.
// DISPLAY follows existing desktop fixtures (:1 default), with no silent skip.
// Every launched process/profile belongs to this fixture; no user window closes.
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'pw-browser-e2e-'));
const profile = path.join(temp, 'profile'), folder = path.join(temp, 'workspace');
await mkdir(folder);
const run = promisify(execFile), cli = path.join(root, 'scripts/workspace-browser.mjs');
const fixture = http.createServer((req, res) => {
  if (req.url === '/down') { res.writeHead(503); res.end('not ready'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>Browser bridge fixture</title><body style="background:#eef;padding:40px;font:22px sans-serif">
    <h1>VISIBLE_SAME_SESSION</h1><input id="name" aria-label="Name"><button id="act">Apply</button>
    <p id="result">Waiting</p><button id="popup">Popup</button>
    <script>window.sessionSentinel=crypto.randomUUID();console.log('FIXTURE_CONSOLE_READY');
    document.querySelector('#act').onclick=()=>{document.querySelector('#result').textContent='Applied '+document.querySelector('#name').value;console.log('FIXTURE_ACTION')};
    document.querySelector('#popup').onclick=()=>window.open('/popup','_blank');</script></body>`);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${fixture.address().port}/`;
let app, page, hostPid, vite;
const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1', PHANTOM_WORKSPACE_HOME: profile,
  PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'PHANTOM_RENDERER_URL', 'PHANTOM_BROWSER_TOKEN', 'PHANTOM_BROWSER_ENDPOINT']) delete env[name];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, label, ms = 10000) {
  const end = Date.now() + ms;
  do { const value = await fn(); if (value) return value; await delay(50); } while (Date.now() < end);
  throw new Error(`Timeout: ${label}`);
}
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
async function command(args, terminalEnv, expectedError) {
  try {
    const result = await run(process.execPath, [cli, ...args], { env: { ...env, ...terminalEnv }, cwd: folder, timeout: 35000, maxBuffer: 2 * 1024 * 1024 });
    if (expectedError) assert.fail(`Expected CLI error ${expectedError}: ${result.stdout}`);
    return JSON.parse(result.stdout);
  } catch (error) {
    if (!expectedError) throw error;
    assert.equal(error.code, 1, error.stderr);
    const reply = JSON.parse(error.stderr);
    assert(expectedError.test(reply.error.code), JSON.stringify(reply)); return reply;
  }
}

try {
  // E2E runs before the declared build check, so serve the actual source UI via
  // Vite rather than relying on pre-existing dist or synthesizing a renderer.
  vite = await createServer({ configFile: false, root, base: './', server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await vite.listen(); env.PHANTOM_RENDERER_URL = `http://127.0.0.1:${vite.httpServer.address().port}/`;
  app = await electron.launch({ args: [root], cwd: root, env, timeout: 20000 });
  page = await app.firstWindow(); page.setDefaultTimeout(10000);
  const rendererErrors = []; page.on('pageerror', error => rendererErrors.push(error.message));
  await page.waitForSelector('.app-shell');
  const info = await invoke('system.info'); assert.equal(info.dataDir, profile); hostPid = info.pid;
  const workspace = await invoke('workspace.open', { path: folder });
  const terminal = await invoke('terminal.create', { workspaceId: workspace.id, cols: 80, rows: 24 });
  // Discovery is taken from the actual spawned shell, not constructed tokens.
  const shellEnv = Object.fromEntries((await readFile(`/proc/${terminal.session.pid}/environ`, 'utf8')).split('\0').filter(Boolean).map(item => {
    const index = item.indexOf('='); return [item.slice(0, index), item.slice(index + 1)];
  }));
  const terminalEnv = Object.fromEntries(Object.entries(shellEnv).filter(([key]) => /^PHANTOM_(BROWSER_|WORKSPACE_ID|TERMINAL_)/.test(key)));
  assert.equal(terminalEnv.PHANTOM_TERMINAL_ID, terminal.node.id);
  assert.equal(terminalEnv.PHANTOM_TERMINAL_SESSION_ID, terminal.session.id);
  assert.equal(terminalEnv.PHANTOM_BROWSER_CLI, cli);
  const help = await run(process.execPath, [cli, 'help'], { env, timeout: 5000 }); assert.match(help.stdout, /preview\|open/);
  const context = await poll(async () => {
    try { return await command(['context'], terminalEnv); } catch { return false; }
  }, 'private bridge startup');
  assert.equal(context.connected, true); assert.equal(context.workspaceId, workspace.id);
  await app.evaluate(({ shell }) => {
    globalThis.__browserBridgeExternal = [];
    shell.openExternal = async url => { globalThis.__browserBridgeExternal.push(url); throw new Error('Unexpected external open'); };
  });
  const opened = await command(['preview', url, '--timeout', '12000'], terminalEnv);
  assert.equal(opened.visible, true); assert.equal(opened.url, url);
  await page.locator(`.canvas-node.focused [data-browser-id="${opened.id}"]`).waitFor();
  const native = () => app.evaluate(({ BrowserWindow }, id) => {
    const views = BrowserWindow.getAllWindows()[0].contentView.children;
    const view = views.find(v => v.webContents.id === id);
    return view && { visible: view.getVisible(), url: view.webContents.getURL(), bounds: view.getBounds() };
  }, opened.webContentsId);
  assert.equal((await native()).visible, true); assert((await native()).bounds.width > 100);
  const sentinel = await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('window.sessionSentinel'), opened.webContentsId);
  assert.equal(typeof sentinel, 'string');
  const read = await command(['read'], terminalEnv); assert.match(read.text, /VISIBLE_SAME_SESSION/);
  const input = `a'\"\\);window.injected=true;// café 🧪`;
  await command(['fill', '#name', input], terminalEnv);
  await command(['click', '#act'], terminalEnv);
  assert.equal((await command(['read', '#result'], terminalEnv)).text, `Applied ${input}`);
  const observed = await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('({text:document.querySelector("#result").textContent,session:window.sessionSentinel,injected:window.injected===true})'), opened.webContentsId);
  assert.equal(observed.text, `Applied ${input}`); assert.equal(observed.session, sentinel); assert.equal(observed.injected, false);
  const second = await command(['preview', url], terminalEnv);
  assert.equal(second.id, opened.id); assert.equal(second.webContentsId, opened.webContentsId);
  assert.equal((await command(['read', '#result'], terminalEnv)).text, `Applied ${input}`);
  const state = await invoke('state.get');
  assert.equal(state.workspaces.find(w => w.id === workspace.id).nodes.filter(n => n.type === 'browser').length, 1);
  const shot = await command(['screenshot'], terminalEnv);
  assert(shot.path.startsWith(path.join(profile, 'automation', workspace.id, 'browser', 'artifacts') + path.sep));
  const png = await readFile(shot.path); assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]); assert(png.length > 1000);
  assert.equal((await stat(shot.path)).mode & 0o777, 0o600);
  const logs = await command(['console'], terminalEnv);
  assert(logs.messages.some(item => item.message.includes('FIXTURE_CONSOLE_READY')));
  assert(logs.messages.some(item => item.message.includes('FIXTURE_ACTION')));
  await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('for(let i=0;i<240;i++)console.log("BOUNDED_"+i)'), opened.webContentsId);
  assert.equal((await command(['console'], terminalEnv)).messages.length, 200);
  const started = Date.now();
  await command(['preview', `${url}down`, '--timeout', '350'], terminalEnv, /^(HTTP_TIMEOUT|TIMEOUT)$/);
  assert(Date.now() - started < 4000); assert.equal((await command(['status'], terminalEnv)).webContentsId, opened.webContentsId);
  await command(['context'], { ...terminalEnv, PHANTOM_BROWSER_TOKEN: '0'.repeat(64) }, /^ACCESS_DENIED$/);
  await command(['context'], { ...terminalEnv, PHANTOM_WORKSPACE_ID: '00000000-0000-4000-8000-000000000000' }, /^ACCESS_DENIED$/);
  await command(['read', '--id', terminal.node.id], terminalEnv, /^ACCESS_DENIED$/);
  await command(['eval', 'window.injected=true'], terminalEnv, /^INVALID_INPUT$/);
  await command(['screenshot', '--path', '/tmp/escape.png'], terminalEnv, /^INVALID_INPUT$/);
  await command(['open', 'javascript:alert(1)'], terminalEnv, /^BROWSER_ERROR$/);
  // A changed preview URL must reach the existing view even while already focused.
  const changed = await command(['open', `${url}?changed=1`], terminalEnv);
  assert.equal(changed.webContentsId, opened.webContentsId); assert.equal(changed.url, `${url}?changed=1`);
  await command(['click', '#popup'], terminalEnv);
  await poll(async () => (await command(['status'], terminalEnv)).url === `${url}popup`, 'popup retained in same native view');
  assert.equal((await command(['status'], terminalEnv)).webContentsId, opened.webContentsId);
  assert.deepEqual(await app.evaluate(() => globalThis.__browserBridgeExternal), []);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.deepEqual(rendererErrors, []);
  console.log(JSON.stringify({ passed: true, profile, panelId: opened.id, webContentsId: opened.webContentsId,
    screenshot: shot.path, checks: ['real CLI/private RPC', 'visible same DOM/session', 'read/click/fill/PNG/console',
      'idempotent preview', 'changed URL', 'bounded readiness failure', 'access validation', 'no external browser'] }));
} finally {
  if (app) {
    try { await invoke('desktop.quit', { stopHost: true }); await delay(500); } catch { /* owned-process cleanup below */ }
    const child = app.process(); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  if (hostPid) {
    try {
      const args = (await readFile(`/proc/${hostPid}/cmdline`, 'utf8')).split('\0');
      if (args.includes(profile) && args.some(arg => arg.endsWith('/host/server.mjs'))) process.kill(hostPid, 'SIGTERM');
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
  }
  await vite?.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
}
