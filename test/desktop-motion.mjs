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
  const workspaceId = (await invoke('state.get')).activeWorkspaceId;
  await invoke('terminal.create', { workspaceId, cols: 80, rows: 24 });
  await page.locator('.pt-card').waitFor();
  await wait(async () => (await invoke('terminal.list', { workspaceId: (await invoke('state.get')).activeWorkspaceId })).length === 1, 'terminal created');
  assert.equal(await page.locator('.canvas-node.focused').count(), 0);
  const session = (await invoke('terminal.list', { workspaceId: (await invoke('state.get')).activeWorkspaceId }))[0];
  assert.notEqual(session.cwd, workspacePath);
  const panel = page.locator(`[data-node-id="${session.nodeId}"]`);
  const mapGeometry = await panel.evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height]);
  await page.waitForTimeout(800);
  const origin = await panel.boundingBox();
  await page.evaluate(() => {
    window.flipLog = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      const animation = animate.call(this, frames, options);
      if (options?.id === 'focus-flip') {
        animation.pause();
        const rects = [0, 160, 320].map(time => { animation.currentTime = time; const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        window.flipLog.push({ rects, duration: options.duration, id: this.dataset.nodeId });
        animation.currentTime = 0; animation.play();
      }
      return animation;
    };
  });
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers?.get('phantom:invoke');
    if (!original) throw new Error('Electron IPC fixture seam unavailable');
    globalThis.motionWrites = [];
    ipcMain.removeHandler('phantom:invoke');
    ipcMain.handle('phantom:invoke', (event, method, payload) => {
      if (method === 'terminal.write') globalThis.motionWrites.push(payload);
      return original(event, method, payload);
    });
  });
  await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
  await page.locator('.canvas-node.focused').waitFor();
  await page.waitForTimeout(400);
  const opening = await page.evaluate(() => window.flipLog[0]);
  assert.equal(opening.duration, 320); assert.equal(opening.id, session.nodeId);
  const near = (a, b) => { for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(a[key] - b[key]) < 2, `${key}: ${a[key]} vs ${b[key]}`); };
  near(opening.rects[0], origin); near(opening.rects[2], await panel.boundingBox());
  assert.notDeepEqual(opening.rects[1], opening.rects[0]); assert.notDeepEqual(opening.rects[1], opening.rects[2]);
  await panel.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Escape');
  await wait(async () => (await app.evaluate(() => globalThis.motionWrites)).some(write => write.sessionId === session.id && write.data === '\x1b'), 'PTY owns Escape');
  assert.equal(await page.locator('.canvas-node.focused').count(), 1, 'PTY Escape cannot restore the map');
  await page.locator('.canvas').focus(); await page.keyboard.press('Escape');
  await wait(async () => !(await page.locator('.canvas-node.focused').count()), 'return to map');
  await page.waitForTimeout(400);
  const closing = await page.evaluate(() => window.flipLog[1]);
  near(closing.rects[0], opening.rects[2]); near(closing.rects[2], origin);
  assert.deepEqual(await panel.evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height]), mapGeometry);
  assert.equal(await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).evaluate(el => document.activeElement === el), true);
  assert.equal(await panel.locator('.xterm').count(), 0, 'Map uses the existing terminal card, not a second PTY');
  await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
  await panel.locator('.xterm-screen').waitFor();
  const screen = await panel.locator('.xterm-screen').elementHandle();

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
   const reduced = await page.evaluate(() => window.motionLog.filter(entry => entry.className === 'tool-picker' && entry.duration === 0));
   assert.ok(reduced.length >= 2 && reduced.every(entry => entry.frames.every(frame => frame.translate === '0 0')), 'reduced motion applies presence immediately');
  assert.equal(await screen.evaluate(element => element.isConnected), true, 'overlays must preserve xterm');
  const live = (await invoke('terminal.list', { workspaceId: session.workspaceId })).find(value => value.id === session.id);
  assert.equal(live.pid, session.pid);
  assert.equal(live.status, 'running');
  const count = await page.evaluate(() => window.flipLog.length);
  await page.locator('.focus-return button').click();
  await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.flipLog.length), count, 'Reduced motion has no FLIP or fallback fade');
  await page.locator('.focus-return button').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await invoke('terminal.create', { workspaceId, cols: 80, rows: 24 });
  await wait(async () => (await invoke('terminal.list', { workspaceId: session.workspaceId })).length === 2, 'second terminal');
  const second = page.locator('.canvas-node').last();
  const secondElement = await second.elementHandle();
  await second.getByRole('button', { name: 'Opciones del panel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ocultar vista · conservar sesión' }).click();
  await wait(async () => !(await secondElement.evaluate(element => element.isConnected)), 'hidden terminal exit');
  const panelExit = await page.evaluate(() => window.motionLog.some(entry => entry.className.includes('canvas-node') && entry.frames[0].opacity === 1 && entry.inert));
  assert.ok(panelExit, 'terminal exit is animated and inert');
  assert.equal((await invoke('terminal.list', { workspaceId: session.workspaceId })).filter(value => value.status === 'running').length, 2, 'hiding retains both processes');
  assert.equal(await panel.count(), 1, 'removing a sibling preserves the first panel');
  assert.equal((await invoke('terminal.list', { workspaceId })).find(value => value.id === session.id).pid, session.pid, 'Map/focus and sibling removal preserve the PTY');
  await page.getByRole('button', { name: /Ver todo el mapa/ }).click();
  await page.locator('.toast-stack .toast').getByRole('button', { name: 'Cerrar aviso' }).click();
  await page.locator('.toast-stack .toast').waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(temp, 'workspace.png') });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.screenshot({ path: path.join(temp, 'narrow.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['terminal worktree + map creation', 'FLIP origin/destination/return and keyboard focus', 'PTY owns Escape', 'entrance + inert exit animations', 'inspector', 'palette', 'voice dialog', 'reduced motion', 'same live terminal PID', 'terminal exit retains processes and sibling identity', 'no renderer errors'], evidence: temp }));
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
