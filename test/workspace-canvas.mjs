import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Dependency provisioning belongs to the controller. Avoid Electron's implicit
// synchronous downloader consuming the entire behavioral-check timeout.
const executablePath = path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(root, 'node_modules/electron/dist'), 'electron');
try { await access(executablePath, constants.X_OK); }
catch { throw new Error(`Electron no está preparado: ${executablePath}. El controlador debe completar la instalación antes del smoke.`); }
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/phantom-canvas-');
const evidence = path.join(root, '.test-artifacts/canvas');
await mkdir(evidence, { recursive: true });
const folder = path.join(temp, 'SYNTHETIC-Canvas');
const secondFolder = path.join(temp, 'SYNTHETIC-Second');
await mkdir(folder); await mkdir(secondFolder);
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile'), SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ executablePath, args: [root], cwd: root, env, timeout: 15000 });
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const toggle = () => page.locator('.rail-toggle');
const rail = () => page.locator('#project-sidebar');
const settled = () => page.waitForTimeout(300);
async function size(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(580, 580); win.setContentSize(w, h);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
  await settled();
}
async function capture(name) { await settled(); await page.screenshot({ path: path.join(evidence, name) }); }
async function poll(fn) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await fn()) return; await page.waitForTimeout(100); }
  assert.fail('Timed out waiting for fixture state');
}
async function layout() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false, 'No document overflow');
  const dock = await page.locator('.dock-main').boundingBox();
  const zoom = await page.locator('.canvas-navigation').boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const box of [dock, zoom]) {
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, 'Floating controls within viewport');
  }
  assert.ok(dock.y >= zoom.y + zoom.height || zoom.x >= dock.x + dock.width || dock.x >= zoom.x + zoom.width, 'Dock and zoom do not overlap');
}
try {
  await page.waitForSelector('.app-shell'); await size(1520, 980);
  await invoke('workspace.open', { path: folder });
  const first = (await invoke('state.get')).workspaces.find(w => w.path === folder);
  const terminal = await invoke('node.create', { workspaceId: first.id, type: 'terminal', title: 'SYNTHETIC Terminal', x: 50, y: 75, width: 640, height: 410, data: {} });
  const { session } = await invoke('terminal.create', { workspaceId: first.id, nodeId: terminal.id, cols: 80, rows: 24 });
  assert.ok(session.pid > 0);
  await invoke('node.update', { workspaceId: first.id, id: terminal.id, patch: { data: { sessionId: session.id } } });
  await invoke('node.create', { workspaceId: first.id, type: 'note', title: 'SYNTHETIC Contexto', x: 730, y: 75, width: 340, height: 310, data: { text: 'SYNTHETIC · Continuidad de trabajo\n\nTerminal real y nota persistente.' } });
  await page.reload(); await page.waitForSelector('.xterm');
  const noteText = 'SYNTHETIC · Nota editada desde el lienzo\nContexto persistente junto a la terminal real.';
  await page.getByLabel('Nota: SYNTHETIC Contexto', { exact: true }).fill(noteText);
  await poll(async () => (await invoke('state.get')).workspaces.find(w => w.id === first.id).nodes.some(n => n.type === 'note' && n.data.text === noteText));
  const snapshot = async () => {
    const w = (await invoke('state.get')).workspaces.find(w => w.id === first.id);
    return { camera: w.camera, nodes: w.nodes.map(({ id, x, y, width, height, data }) => ({ id, x, y, width, height, data })) };
  };
  const before = await snapshot();
  const terminalElement = await page.locator('.xterm').elementHandle();
  const selectedBefore = await page.locator('.canvas-node.selected .title-button').allTextContents();
  const cameraBeforeCollapse = await page.locator('.canvas-world').getAttribute('style');
  const expandedWidth = (await page.locator('.canvas').boundingBox()).width;
  await layout(); await capture('desktop.png');
  await toggle().click(); await settled();
  assert.ok((await page.locator('.canvas').boundingBox()).width - expandedWidth >= 140);
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.xterm').evaluate((el, previous) => el === previous, terminalElement), true, 'Collapse keeps the mounted xterm');
  assert.deepEqual(await page.locator('.canvas-node.selected .title-button').allTextContents(), selectedBefore);
  assert.equal(await page.locator('.canvas-world').getAttribute('style'), cameraBeforeCollapse);
  await layout(); await capture('collapsed.png');
  assert.deepEqual(await snapshot(), before);
  await page.reload(); await page.waitForSelector('.xterm');
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  await invoke('workspace.open', { path: secondFolder }); await page.reload();
  await page.waitForSelector('.app-shell');
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  await rail().getByRole('button', { name: /SYNTHETIC-Canvas/ }).click();
  await page.waitForSelector('.xterm');
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  assert.deepEqual(await snapshot(), before);
  checks.push('Collapse gains >=140px; local preference survives reload and project switch; node data and camera stable');

  async function typeTerminal(marker) {
    await page.locator('.xterm').click();
    // The complete marker is absent from the echoed command: only PTY execution produces it.
    await page.keyboard.type(`printf '%s%s\\n' '${marker.slice(0, 10)}' '${marker.slice(10)}'`); await page.keyboard.press('Enter');
    await poll(async () => (await invoke('terminal.attach', { sessionId: session.id })).data.includes(marker));
    const live = (await invoke('terminal.list', { workspaceId: first.id })).find(s => s.id === session.id);
    assert.equal(live.pid, session.pid); assert.equal(live.status, 'running');
  }
  for (const collapsed of [true, false]) {
    assert.equal(await toggle().getAttribute('aria-expanded'), String(!collapsed));
    await rail().getByTitle('SYNTHETIC Terminal · Ver en el mapa', { exact: true }).click();
    await page.waitForSelector('.canvas-node.selected');
    await typeTerminal(`SYNTHETIC_INPUT_${collapsed}`);
    const camera = await page.locator('.canvas-world').getAttribute('style');
    const selectedTitle = await page.locator('.canvas-node.selected .title-button').textContent();
    await page.locator('.canvas-node.selected').getByRole('button', { name: 'Enfocar panel', exact: true }).click();
    await page.waitForSelector('.focus-mode');
    if (!collapsed) await capture('focused.png');
    await page.locator('.focus-return button').click();
    assert.equal(await page.locator('.canvas-world').getAttribute('style'), camera);
    assert.equal(await page.locator('.canvas-node.selected .title-button').textContent(), selectedTitle);
    await rail().getByRole('button', { name: /Personalizar espacio/ }).click();
    await page.waitForSelector('.appearance-panel');
    await typeTerminal(`SYNTHETIC_INSPECTOR_${collapsed}`);
    await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill('personalizar');
    await page.keyboard.press('Enter'); await page.waitForSelector('.appearance-panel');
    await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
    if (collapsed) await toggle().click();
  }
  checks.push('Both desktop states: real xterm writes, same PID, panel navigation/focus/return, inspector and palette');
  await size(1100, 760); await layout(); await capture('narrow.png');
  await size(800, 700); await layout();
  assert.equal(await rail().evaluate(el => el.inert), true);
  await toggle().click(); await capture('drawer.png');
  await page.keyboard.press('Escape'); await settled();
  assert.equal(await toggle().evaluate(el => el === document.activeElement), true);
  assert.equal(await rail().evaluate(el => el.inert), true);
  await toggle().click(); await page.locator('.rail-scrim').click({ position: { x: 600, y: 300 } });
  assert.equal(await toggle().evaluate(el => el === document.activeElement), true);
  await toggle().click(); await rail().getByTitle('SYNTHETIC Terminal · Ver en el mapa', { exact: true }).click();
  assert.equal(await rail().evaluate(el => el.inert), true);
  assert.equal(await toggle().evaluate(el => el === document.activeElement), true);
  await toggle().click(); await size(1100, 760);
  assert.equal(await page.locator('.rail-scrim').count(), 0);
  await typeTerminal('SYNTHETIC_BREAKPOINT');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle().click(); await layout();
  assert.ok(await rail().evaluate(el => getComputedStyle(el).transitionDuration.split(',').every(t => parseFloat(t) <= .001)));
  await typeTerminal('SYNTHETIC_REDUCED');
  const final = await snapshot();
  assert.deepEqual(final.nodes, before.nodes);
  checks.push('800px drawer: inert, Escape/scrim/selection focus return; desktop crossing clears input block; reduced motion');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(path.join(evidence, 'checks.json'), JSON.stringify({ checks, errors, profile: temp, recordedAt: new Date().toISOString() }, null, 2));
  await invoke('host.shutdown').catch(() => {});
  try { await app.close(); } finally { killElectronGroup(app.process()); }
}
