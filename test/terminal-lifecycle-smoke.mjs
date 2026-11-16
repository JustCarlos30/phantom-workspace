import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp('/tmp/opencode/phantom-terminal-lifecycle-');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: temp, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/bash' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const executable = process.env.PHANTOM_TEST_EXECUTABLE;
const app = await electron.launch({ ...(executable ? { executablePath: executable, args: ['--ozone-platform=headless'] } : { args: [root, '--ozone-platform=headless'] }), env, timeout: 15000 });
const page = await app.firstWindow();
page.setDefaultTimeout(8000);
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) {
  const end = Date.now() + 8000;
  do { if (await fn()) return; await delay(80); } while (Date.now() < end);
  throw new Error('Terminal lifecycle condition timed out');
}
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let hostPid;
try {
  console.log('Checking terminal lifecycle in isolated Electron window');
  await page.waitForSelector('.app-shell');
  hostPid = (await invoke('system.info')).pid;
  const w = await invoke('workspace.open', { path: temp });
  console.log('Fixture workspace opened');
  await until(() => page.locator('.create-dock').count());
  await page.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click();
  console.log('Terminal creation requested');
  await page.locator('.canvas-node .status-dot.running').waitFor();
  await until(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')));
  const session = (await invoke('terminal.list', { workspaceId: w.id }))[0];
  const bounds = () => page.locator('.canvas-node .terminal-host').boundingBox();
  await delay(500);
  const before = await bounds();
  const sizeBefore = (await invoke('terminal.attach', { sessionId: session.id })).session;
  await delay(5000);
  assert.deepEqual(await bounds(), before, 'idle terminal stays the same size');
  const sizeAfter = (await invoke('terminal.attach', { sessionId: session.id })).session;
  assert.deepEqual([sizeAfter.cols, sizeAfter.rows], [sizeBefore.cols, sizeBefore.rows]);
  await page.keyboard.type("printf 'IDLE_%s\\n' 'WRITABLE'");
  await page.keyboard.press('Enter');
  await until(async () => (await invoke('terminal.attach', { sessionId: session.id })).data.includes('IDLE_WRITABLE'));
  console.log('PASS: new terminal owns input, idle size is stable, typing works after idle');

  // A pending jump must not be replayed by an unrelated canvas ResizeObserver.
  await page.locator('.canvas-node').getByLabel('Enfocar panel', { exact: true }).click();
  await page.locator('.canvas-node.focused').waitFor();
  await page.locator('.focus-return button').click();
  await until(async () => !(await page.locator('.canvas-node.focused').count()));
  await page.keyboard.press('Control+Shift+f');
  await page.locator('.index-item').first().locator('button').first().click();
  await delay(500);
  const camera = (await invoke('state.get')).workspaces.find(item => item.id === w.id).camera;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; const [width, height] = win.getSize(); win.setSize(width + 80, height + 40); });
  await delay(800);
  assert.deepEqual((await invoke('state.get')).workspaces.find(item => item.id === w.id).camera, camera);
  console.log('PASS: canvas resize does not replay an old jump or change map zoom');

  await page.getByLabel('Cerrar terminal', { exact: true }).click();
  await until(async () => !(await invoke('terminal.list', { workspaceId: w.id })).length);
  await until(async () => !(await page.locator('.canvas-node').count()));
  assert.throws(() => process.kill(session.pid, 0), /ESRCH/);
  assert.deepEqual(errors, []);
  console.log('PASS: close button removes panel, session and shell process');
} catch (error) {
  console.error(error.message, errors);
  console.error(await page.locator('body').innerText().catch(() => 'Window unavailable'));
  throw error;
} finally {
  console.log('Cleaning up isolated terminal fixture');
  await Promise.race([invoke('host.shutdown').catch(() => {}), delay(4000)]);
  // This fixture deliberately stops its host first; bypass the save dialog for
  // the isolated test window after that shutdown, including assertion failures.
  killElectronGroup(app.process());
  if (hostPid) { try { process.kill(hostPid, 'SIGTERM'); } catch {} }
  await fs.rm(temp, { recursive: true, force: true });
}
