import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp('/tmp/opencode/phantom-motion-');
const workspacePath = path.join(temp, 'repository'), profile = path.join(temp, 'profile');
await fs.mkdir(workspacePath);
const git = (...args) => execFileSync('git', ['-C', workspacePath, ...args], { encoding: 'utf8' });
git('init', '-b', 'main');
await fs.writeFile(path.join(workspacePath, 'README.md'), '# Motion fixture\n');
git('add', 'README.md');
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Fixture base');
const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1', PHANTOM_WORKSPACE_HOME: profile, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ args: [root], cwd: root, env, timeout: 20000 });
const page = await app.firstWindow();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const invoke = (method, payload = {}) => page.evaluate(([method, payload]) => window.phantom.invoke(method, payload), [method, payload]);
let ownedHost;
const wait = async (fn, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await fn()) return; await page.waitForTimeout(30); }
  throw new Error(`Timed out: ${label}`);
};
try {
  await page.locator('.app-shell').waitFor();
  ownedHost = (await invoke('system.info')).pid;
  await invoke('workspace.open', { path: workspacePath });
  await page.reload();
  await page.locator('.create-dock').waitFor();
  await page.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.locator('.terminal-panel').filter({ hasText: 'Worktree' }).waitFor();
  await wait(async () => (await invoke('terminal.list', { workspaceId: (await invoke('state.get')).activeWorkspaceId })).length === 1, 'terminal created');
  assert.equal(await page.locator('.canvas-node.focused').count(), 0);
  const session = (await invoke('terminal.list', { workspaceId: (await invoke('state.get')).activeWorkspaceId }))[0];
  assert.notEqual(session.cwd, workspacePath);
  const screen = await page.locator('.xterm-screen').elementHandle();
  await page.locator('.canvas-node').getByRole('button', { name: 'Enfocar panel', exact: true }).click();
  await page.locator('.canvas-node.focused').waitFor();
  await page.locator('.focus-return').getByRole('button', { name: 'Volver al mapa' }).click();
  await wait(async () => !(await page.locator('.canvas-node.focused').count()), 'return to map');
  assert.equal(await screen.evaluate(element => element.isConnected), true, 'focus must not remount xterm');

  // Observe actual Web Animations, including the retained inert exit frame.
  await page.evaluate(() => {
    window.motionLog = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      window.motionLog.push({ className: this.className, frames, duration: options.duration, inert: !!this.closest('[inert]') });
      return animate.call(this, frames, options);
    };
  });
  await page.locator('.create-dock').getByRole('button', { name: 'Herramientas' }).click();
  await page.locator('.tool-picker').waitFor();
  await page.locator('.tool-picker').getByRole('button', { name: 'Cerrar herramientas' }).click();
  await page.locator('.tool-picker').waitFor({ state: 'detached' });
  const pickerMotion = await page.evaluate(() => window.motionLog.filter(entry => entry.className === 'tool-picker'));
  assert.ok(pickerMotion.some(entry => entry.frames[0].opacity === 0 && entry.duration === 200), 'picker enters');
  assert.ok(pickerMotion.some(entry => entry.frames[0].opacity === 1 && entry.duration === 120 && entry.inert), 'picker exits without accepting input');

  await page.getByRole('button', { name: 'Herramientas del proyecto', exact: true }).click();
  await page.locator('.inspector-host').waitFor();
  await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  await page.locator('.inspector-host').waitFor({ state: 'detached' });
  await page.locator('.search-command').click();
  await page.getByRole('dialog', { name: 'Paleta del workspace' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.tw-palette').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Capturar por voz', exact: true }).click();
  await page.getByRole('dialog', { name: 'Voz e intención' }).waitFor();
  await page.getByRole('button', { name: 'Cancelar y cerrar captura' }).click();
  await page.locator('.tw-voice').waitFor({ state: 'detached' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.create-dock').getByRole('button', { name: 'Herramientas' }).click();
  await page.locator('.tool-picker').waitFor();
  await page.locator('.tool-picker').getByRole('button', { name: 'Cerrar herramientas' }).click();
  await page.locator('.tool-picker').waitFor({ state: 'detached' });
  const reduced = await page.evaluate(() => window.motionLog.filter(entry => entry.className === 'tool-picker' && entry.duration === 60));
  assert.ok(reduced.length >= 2 && reduced.every(entry => entry.frames.every(frame => frame.translate === '0 0')), 'reduced motion fades without spatial movement');
  assert.equal(await screen.evaluate(element => element.isConnected), true, 'overlays must preserve xterm');
  const live = (await invoke('terminal.list', { workspaceId: session.workspaceId })).find(value => value.id === session.id);
  assert.equal(live.pid, session.pid);
  assert.equal(live.status, 'running');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click();
  await wait(async () => (await invoke('terminal.list', { workspaceId: session.workspaceId })).length === 2, 'second terminal');
  const second = page.locator('.canvas-node').last();
  const secondElement = await second.elementHandle();
  await second.getByRole('button', { name: 'Opciones del panel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ocultar vista · conservar sesión' }).click();
  await wait(async () => !(await secondElement.evaluate(element => element.isConnected)), 'hidden terminal exit');
  const panelExit = await page.evaluate(() => window.motionLog.some(entry => entry.className.includes('canvas-node') && entry.frames[0].opacity === 1 && entry.inert));
  assert.ok(panelExit, 'terminal exit is animated and inert');
  assert.equal((await invoke('terminal.list', { workspaceId: session.workspaceId })).filter(value => value.status === 'running').length, 2, 'hiding retains both processes');
  assert.equal(await screen.evaluate(element => element.isConnected), true, 'removing a sibling preserves the first xterm');
  await page.getByRole('button', { name: /Ver todo el mapa/ }).click();
  await page.locator('.toast-stack .toast').getByRole('button', { name: 'Cerrar aviso' }).click();
  await page.locator('.toast-stack .toast').waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(temp, 'workspace.png') });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.screenshot({ path: path.join(temp, 'narrow.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['terminal worktree + map creation', 'focus preserves xterm', 'entrance + inert exit animations', 'inspector', 'palette', 'voice dialog', 'reduced motion', 'same live terminal PID', 'terminal exit retains processes and sibling identity', 'no renderer errors'], evidence: temp }));
} catch (error) {
  console.error(error);
  console.error(JSON.stringify({ evidence: temp, errors, text: await page.locator('body').innerText().catch(() => ''), state: await invoke('state.get').catch(() => null) }));
  await page.screenshot({ path: path.join(temp, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  // Fixture-only shutdown, without opening the real application's close/save UI.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  killElectronGroup(app.process());
  if (ownedHost) { try { process.kill(ownedHost, 'SIGTERM'); } catch {} }
}
