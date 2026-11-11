import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
const wait = async (fn, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await fn()) return; await page.waitForTimeout(30); }
  throw new Error(`Timed out: ${label}`);
};
try {
  await page.locator('.app-shell').waitFor();
  await invoke('workspace.open', { path: workspacePath });
  await page.reload();
  await page.locator('.create-dock').waitFor();
  await page.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.locator('.terminal-location').filter({ hasText: 'Worktree' }).waitFor();
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
      window.motionLog.push({ className: this.className, frames, duration: options.duration });
      return animate.call(this, frames, options);
    };
  });
  await page.locator('.create-dock').getByRole('button', { name: 'Herramientas' }).click();
  await page.locator('.tool-picker').waitFor();
  await page.locator('.tool-picker').getByRole('button', { name: 'Cerrar herramientas' }).click();
  await page.locator('.tool-picker').waitFor({ state: 'detached' });
  const pickerMotion = await page.evaluate(() => window.motionLog.filter(entry => entry.className === 'tool-picker'));
  assert.ok(pickerMotion.some(entry => entry.frames[0].opacity === 0 && entry.duration === 200), 'picker enters');
  assert.ok(pickerMotion.some(entry => entry.frames[0].opacity === 1 && entry.duration === 120), 'picker exits');

  await page.getByRole('button', { name: 'Herramientas del proyecto', exact: true }).click();
  await page.locator('.inspector-host').waitFor();
  await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  await page.locator('.inspector-host').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Buscar o ejecutar' }).click();
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
  await page.screenshot({ path: path.join(temp, 'workspace.png') });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.screenshot({ path: path.join(temp, 'narrow.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['terminal worktree + map creation', 'focus preserves xterm', 'entrance + exit animations', 'inspector', 'palette', 'voice dialog', 'reduced motion', 'same live terminal PID', 'no renderer errors'], evidence: temp }));
} finally {
  await invoke('host.shutdown').catch(() => {});
  await app.close();
}
