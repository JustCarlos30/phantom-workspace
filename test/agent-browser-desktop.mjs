import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Real Electron + real PTY environment + real CLI socket + native view.
// Missing DISPLAY/dependencies fail the test; there is no mock/skip fallback.
// Only the application and daemon launched with this temporary profile are closed.
const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-browser-e2e-'));
const home = path.join(temp, 'profile'), project = path.join(temp, 'workspace');
await fs.mkdir(project);
const server = http.createServer((req, res) => {
  if (req.url === '/hang') return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>Bridge E2E</title><style>body{font:22px sans-serif;padding:40px;background:#eef}input,button{font:inherit}</style>
    <h1>REAL_ELECTRON_BRIDGE_FIXTURE</h1><p id="session"></p>
    <input id="name" aria-label="Name"><button id="commit">Commit</button><p id="result"></p>
    <button id="popup">Popup</button><button id="unsafe">Unsafe scheme</button>
    <script>
      document.querySelector('#session').textContent='SESSION_'+crypto.randomUUID();
      document.querySelector('#commit').onclick=()=>{document.querySelector('#result').textContent='COMMITTED: '+document.querySelector('#name').value;console.log('BRIDGE_CLICK_CONFIRMED');};
      document.querySelector('#popup').onclick=()=>window.open('/popup');
      document.querySelector('#unsafe').onclick=()=>window.open('file:///etc/passwd');
      console.log('BRIDGE_FIXTURE_READY');
    </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  do { const result = await fn(); if (result) return result; await delay(80); } while (Date.now() < end);
  throw new Error(`Timeout: ${label}`);
}
let app, page, hostPid, cliEnv;
const cliPath = path.join(root, 'scripts/workspace-browser.mjs');
const invoke = (method, payload = {}) => page.evaluate(([method, payload]) => window.phantom.invoke(method, payload), [method, payload]);
async function cli(args, env = cliEnv) {
  const { stdout } = await execute(process.execPath, [cliPath, ...args], { env, cwd: project, timeout: 35000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}
async function cliError(args, env = cliEnv) {
  try { await cli(args, env); assert.fail('CLI debía rechazar la petición'); }
  catch (error) { assert.equal(error.code, 1, error.stderr || error.message); return JSON.parse(error.stderr).error; }
}
async function native(id) {
  return app.evaluate(async ({ BrowserWindow }, id) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.webContents.id === id);
    if (!view) return null;
    return { visible: view.getVisible(), url: view.webContents.getURL(), bounds: view.getBounds(),
      dom: await view.webContents.executeJavaScript('({text:document.body.innerText,value:document.querySelector("#name")?.value,session:document.querySelector("#session")?.textContent,phantom:typeof window.phantom,node:typeof require})') };
  }, id);
}

try {
  // Declared acceptance runs this before the standalone build check. Build the
  // actual UI explicitly rather than assuming stale dist assets already exist.
  await execute(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1', SHELL: '/bin/sh', PHANTOM_WORKSPACE_HOME: home };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PHANTOM_RENDERER_URL', 'PHANTOM_NODE_BINARY', 'NODE_OPTIONS', 'NODE_PATH', 'PHANTOM_BROWSER_TOKEN', 'PHANTOM_BROWSER_SOCKET', 'PHANTOM_TERMINAL_ID', 'PHANTOM_WORKSPACE_ID']) delete env[key];
  app = await electron.launch({ executablePath: electronExecutable, args: [root], cwd: root, env, timeout: 20000 });
  page = await app.firstWindow(); page.setDefaultTimeout(10000);
  await page.waitForSelector('.app-shell');
  const info = await invoke('system.info'); assert.equal(info.dataDir, home); hostPid = info.pid;
  await app.evaluate(({ shell }) => {
    globalThis.__bridgeExternalCalls = [];
    shell.openExternal = async (...args) => { globalThis.__bridgeExternalCalls.push(args); throw new Error('Unexpected external browser'); };
  });
  const workspace = await invoke('workspace.open', { path: project });
  const terminal = await invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' });
  const environment = (await fs.readFile(`/proc/${terminal.session.pid}/environ`, 'utf8')).split('\0').filter(Boolean);
  cliEnv = Object.fromEntries(environment.map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  assert.equal(cliEnv.PHANTOM_WORKSPACE_ID, workspace.id);
  assert.equal(cliEnv.PHANTOM_TERMINAL_ID, terminal.session.id);
  assert.equal(cliEnv.PHANTOM_BROWSER_CLI, cliPath);
  assert.match(cliEnv.PHANTOM_BROWSER_HELP, /preview/);
  assert.equal((await cli(['context'])).terminalId, terminal.session.id);
  const help = await execute(process.execPath, [cliPath, 'help'], { env, timeout: 5000 });
  assert.match(help.stdout, /preview\|open/);
  assert.equal((await cliError(['context'], env)).code, 'CONTEXT_REQUIRED');

  const preview = await cli(['preview', url, '--timeout-ms', '15000']);
  assert.equal(preview.visible, true); assert.equal(preview.workspaceId, workspace.id);
  await poll(() => page.locator(`.canvas-node.focused [data-browser-node-id="${preview.id}"]`).count(), 'CLI opened/focused BrowserPanel');
  const initial = await native(preview.webContentsId);
  assert.equal(initial.visible, true); assert.ok(initial.bounds.width > 100 && initial.bounds.height > 100);
  assert.match(initial.dom.text, /REAL_ELECTRON_BRIDGE_FIXTURE/);
  assert.equal(initial.dom.phantom, 'undefined'); assert.equal(initial.dom.node, 'undefined');
  const read = await cli(['read']); assert.ok(read.text.includes(initial.dom.session));
  const value = 'Alice "quoted" ${notJavaScript}';
  await cli(['fill', '#name', value]); await cli(['click', '#commit']);
  assert.equal((await native(preview.webContentsId)).dom.value, value);
  assert.match((await cli(['read', '#result'])).text, /COMMITTED: Alice/);
  assert.ok((await native(preview.webContentsId)).dom.text.includes(`COMMITTED: ${value}`));
  await poll(async () => (await cli(['console'])).messages.some(message => message.message.includes('BRIDGE_CLICK_CONFIRMED')), 'native console buffered');
  const capture = await cli(['screenshot', 'fixture.png']);
  assert.ok(capture.path.startsWith(path.join(home, 'agent-browser', 'artifacts', workspace.id, terminal.session.id) + path.sep));
  assert.deepEqual((await fs.readFile(capture.path)).subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal((await fs.stat(capture.path)).mode & 0o777, 0o600);
  assert.equal((await cliError(['screenshot', '../escape.png'])).code, 'INVALID_INPUT');
  assert.equal((await cliError(['screenshot', 'fixture.png'])).code, 'EEXIST');
  const symlinkPath = path.join(path.dirname(capture.path), 'symlink.png');
  await fs.symlink(path.join(temp, 'outside.png'), symlinkPath);
  assert.equal((await cliError(['screenshot', 'symlink.png'])).code, 'EEXIST');
  await assert.rejects(fs.stat(path.join(temp, 'outside.png')), { code: 'ENOENT' });

  const second = await cli(['open', url]);
  assert.equal(second.id, preview.id); assert.equal(second.webContentsId, preview.webContentsId);
  assert.equal((await native(preview.webContentsId)).dom.session, initial.dom.session);
  assert.equal((await native(preview.webContentsId)).dom.value, value);
  const state = await invoke('state.get');
  assert.equal(state.workspaces.find(item => item.id === workspace.id).nodes.filter(node => node.type === 'browser').length, 1);
  assert.equal((await cli(['status'])).webContentsId, preview.webContentsId);
  console.log('PASS real CLI preview, visible native session, read/click/fill/screenshot/console, idempotent open');

  const beforeTimeout = Date.now();
  const timeout = await cliError(['preview', `${url}hang`, '--timeout-ms', '600']);
  assert.match(timeout.code, /TIMEOUT/); assert.ok(Date.now() - beforeTimeout < 4000);
  assert.equal((await cli(['status'])).url, url);
  assert.equal((await cliError(['preview', 'javascript:alert(1)'])).code, 'INVALID_INPUT');
  assert.equal((await cliError(['click', '#absent'])).code, 'BROWSER_ERROR');
  assert.equal((await cliError(['context'], { ...cliEnv, PHANTOM_BROWSER_TOKEN: '0'.repeat(64) })).code, 'ACCESS_DENIED');
  const otherWorkspace = await invoke('workspace.open', { path: temp });
  assert.equal((await cliError(['status'])).code, 'WORKSPACE_INACTIVE');
  await invoke('workspace.select', { id: workspace.id });
  assert.equal((await cliError(['context'], { ...cliEnv, PHANTOM_WORKSPACE_ID: otherWorkspace.id })).code, 'ACCESS_DENIED');
  const secondTerminal = await invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' });
  const raw = (await fs.readFile(`/proc/${secondTerminal.session.pid}/environ`, 'utf8')).split('\0').filter(Boolean);
  const otherEnv = Object.fromEntries(raw.map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  assert.equal((await cliError(['read', '--id', preview.id], otherEnv)).code, 'ACCESS_DENIED');
  await cli(['preview', url]);
  await cli(['click', '#unsafe']);
  await cli(['click', '#popup']);
  await poll(async () => (await native(preview.webContentsId)).url === `${url}popup`, 'popup stays in same native view');
  assert.equal(await app.evaluate(() => globalThis.__bridgeExternalCalls.length), 0);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length), 1);
  await invoke('terminal.stop', { sessionId: terminal.session.id });
  await poll(async () => (await cliError(['context'])).code === 'ACCESS_DENIED', 'terminal capability revoked');
  console.log('PASS bounded readiness failure, access isolation/revocation, validated paths, no external browser or duplicate native view');
} finally {
  if (app) {
    // Stop only the isolated profile we created, never attach to user windows.
    try { await invoke('desktop.quit', { stopHost: true }); } catch {}
    const child = app.process();
    try { await poll(() => child.exitCode !== null || child.signalCode !== null, 'fixture Electron exits', 10000); }
    catch { child.kill('SIGKILL'); }
  }
  if (hostPid) {
    try {
      const args = (await fs.readFile(`/proc/${hostPid}/cmdline`, 'utf8')).split('\0');
      if (args.includes(home) && args.some(arg => arg.endsWith('/host/server.mjs'))) process.kill(hostPid, 'SIGTERM');
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
  }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
}
