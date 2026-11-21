import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp('/tmp/opencode/phantom-sidebar-');
const folder = path.join(temp, 'Proyecto de desarrollo');
await fs.mkdir(folder);
const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1', PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile'), SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron'), args: [root], cwd: root, env, timeout: 20000 });
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
let host;
try {
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  await invoke('workspace.open', { path: folder });
  const workspaceId = (await invoke('state.get')).activeWorkspaceId;
  const terminal = await invoke('node.create', { workspaceId, type: 'terminal', title: 'Revisar navegación', x: 330, y: 120, width: 640, height: 600, data: {} });
  const { session } = await invoke('terminal.create', { workspaceId, nodeId: terminal.id, cols: 80, rows: 24 });
  await invoke('node.update', { workspaceId, id: terminal.id, patch: { data: { sessionId: session.id } } });
  for (const title of ['Contexto del proyecto', 'Decisiones de arquitectura y continuidad del desarrollo con un nombre muy largo']) {
    await invoke('node.create', { workspaceId, type: 'note', title, x: 1020, y: 120, width: 320, height: 300, data: { text: 'Contenido sintético para verificar navegación.' } });
  }
  await page.reload();
  await page.locator('.xterm').waitFor();
  const resize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]);
    await page.waitForTimeout(400);
  };
  await resize(1520, 980);
  if (process.env.SIDEBAR_BASELINE) {
    await page.screenshot({ path: path.join(temp, 'before.png') });
  } else {
    const rail = page.locator('.project-rail');
    assert.equal(await rail.locator('.rail-panel-group').count(), 2);
    assert.equal(await rail.getByRole('navigation', { name: 'Sesiones' }).locator('.rail-panel-row').count(), 1);
    assert.equal(await rail.getByRole('navigation', { name: 'En el mapa' }).locator('.rail-panel-row').count(), 2);
    assert.ok(Math.abs((await rail.boundingBox()).width - 272) <= 1 / 64);
    const row = rail.locator('.rail-session-row').first();
    assert.ok(Math.abs((await row.boundingBox()).height - 56) <= 1 / 64);
    assert.ok(Math.abs((await row.locator('.rail-agent-mark').boundingBox()).width - 32) <= 1 / 64);
    assert.ok(Math.abs((await row.locator('.rail-agent-mark svg').boundingBox()).width - 18) <= 1 / 64);
    assert.equal(await rail.locator('.rail-session-dot').count(), 0);
    const rest = await row.boundingBox();
    await row.locator('button').first().hover(); await page.mouse.down();
    assert.deepEqual(await row.boundingBox(), rest, 'Press keeps the full rectangular row still');
    assert.equal(await row.evaluate(el => getComputedStyle(el).borderRadius), '12px');
    await page.mouse.up();
    await rail.getByTitle('Revisar navegación · Ver en el mapa', { exact: true }).click();
    await page.locator('.canvas-node.selected').waitFor();
    const screen = await page.locator('.xterm-screen').elementHandle();
    await rail.getByRole('button', { name: 'Enfocar Revisar navegación', exact: true }).click();
    await page.locator('.canvas-node.focused').waitFor();
    await rail.getByRole('button', { name: 'Ver todo el mapa' }).click();
    await page.locator('.canvas-node.focused').waitFor({ state: 'detached' });
    assert.ok(await screen.evaluate(el => el.isConnected), 'Navigation preserves terminal instance');
    await rail.locator('.rail-attention').click();
    await page.locator('#activity-tray').waitFor();
    await page.getByRole('button', { name: 'Cerrar bandeja de actividad', exact: true }).click();
    await page.locator('#activity-tray').waitFor({ state: 'detached' });
    await rail.locator('.project-switcher > summary').click();
    await rail.getByRole('navigation', { name: 'Proyectos recientes' }).waitFor();
    await rail.locator('.project-switcher > summary').click();
    await page.screenshot({ path: path.join(temp, 'desktop.png') });
    for (const [width, height] of [[1100, 760], [1000, 600]]) {
      await resize(width, height);
      const bottom = await rail.locator('.rail-bottom').boundingBox();
      assert.ok(bottom.y + bottom.height <= height, 'Utilities stay within the window');
      assert.ok(await rail.locator('.rail-panel-scroll').evaluate(el => el.clientHeight > 40), 'Panel navigation retains usable space');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await rail.locator('.rail-session-status').evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= el.closest('.rail-panel-label').getBoundingClientRect().right + 1), true, 'Status remains readable');
      await page.screenshot({ path: path.join(temp, `desktop-${width}.png`) });
    }
    await rail.getByRole('button', { name: 'Contraer barra lateral', exact: true }).click();
    await page.reload();
    await page.locator('.rail-collapsed').waitFor();
    await page.getByRole('button', { name: 'Expandir barra lateral', exact: true }).click();
    await page.locator('.rail-panel-group').first().waitFor();
    assert.deepEqual(errors, []);
  }
  console.log(JSON.stringify({ evidence: temp, errors, baseline: !!process.env.SIDEBAR_BASELINE }));
} finally {
  try { await app.close(); } finally { killElectronGroup(app.process()); }
  if (host) { try { process.kill(host, 'SIGTERM'); } catch {} }
}
