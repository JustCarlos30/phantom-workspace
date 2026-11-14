import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

// Optional real-application regression: no prompt is submitted to a provider.
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp('/tmp/opencode/phantom-opencode-');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: temp, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/usr/bin/fish' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const executable = process.env.PHANTOM_TEST_EXECUTABLE;
const app = await electron.launch({ ...(executable ? { executablePath: executable, args: ['--ozone-platform=headless'] } : { args: [root, '--ozone-platform=headless'] }), env });
const page = await app.firstWindow();
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  const end = Date.now() + 20000;
  do { if (await fn()) return; await delay(100); } while (Date.now() < end);
  throw new Error('OpenCode terminal condition timed out');
}
let hostPid;
try {
  await page.waitForSelector('.app-shell');
  hostPid = (await invoke('system.info')).pid;
  const workspace = await invoke('workspace.open', { path: temp });
  await page.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.locator('.status-dot.running').waitFor();
  const [session] = await invoke('terminal.list', { workspaceId: workspace.id });
  await until(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')));
  await page.keyboard.type('opencode');
  await page.keyboard.press('Enter');
  await until(async () => (await invoke('terminal.attach', { sessionId: session.id })).data.includes('\x1b[?1049h'));
  await delay(3000);
  assert.ok((await invoke('terminal.attach', { sessionId: session.id })).session.rows >= 16);
  await page.keyboard.type('VISIBLE_INPUT_7429');
  await until(async () => (await invoke('terminal.attach', { sessionId: session.id })).data.includes('VISIBLE_INPUT_7429'));
  console.log('PASS: unsubmitted OpenCode input is visible in the terminal screen');
  await invoke('node.update', { workspaceId: workspace.id, id: session.nodeId, patch: { height: 400 } });
  await page.getByRole('button', { name: 'Enfocar para escribir', exact: true }).click();
  await page.locator('.canvas-node.focused').waitFor();
  await until(async () => (await invoke('terminal.attach', { sessionId: session.id })).session.rows > 7);
  await until(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')));
  await page.keyboard.type('_RECOVERED');
  await until(async () => (await invoke('terminal.attach', { sessionId: session.id })).data.includes('_RECOVERED'));
  await page.screenshot({ path: '/tmp/opencode/terminal-opencode-verified.png' });
  console.log('PASS: existing small terminals recover visible OpenCode input through focus');
  await page.getByLabel('Cerrar terminal', { exact: true }).click();
  await until(async () => !(await invoke('terminal.list', { workspaceId: workspace.id })).length);
  await until(async () => (await page.locator('.canvas-node').count()) === 0);
  console.log('PASS: Fish + OpenCode close removes the terminal and process tree');
} finally {
  await Promise.race([invoke('host.shutdown').catch(() => {}), delay(5000)]);
  killElectronGroup(app.process());
  if (hostPid) { try { process.kill(hostPid, 'SIGTERM'); } catch {} }
  await fs.rm(temp, { recursive: true, force: true });
}
