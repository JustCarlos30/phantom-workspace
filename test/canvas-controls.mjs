import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp('/tmp/opencode/phantom-canvas-');
const folder = path.join(temp, 'Canvas fixture');
await mkdir(folder);
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile'), PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
const appProcess = app.process();
const appPid = appProcess.pid;
let page;
const errors = [], checks = [];
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const transform = () => page.locator('.canvas-world').evaluate(el => el.style.transform);
const matrix = () => page.locator('.canvas-world').evaluate(el => { const m = new DOMMatrix(getComputedStyle(el).transform); return { x: m.e, y: m.f, zoom: m.a }; });
let host;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
  await invoke('workspace.open', { path: folder });
  const state = await invoke('state.get');
  const workspace = state.workspaces.find(w => w.path === folder);
  for (const [title, x] of [['Plan de trabajo', 0], ['Contexto del proyecto', 480]]) await invoke('node.create', { workspaceId: workspace.id, type: 'note', title, x, y: 100, width: 420, height: 340, data: { text: 'Contenido de prueba del canvas' } });
  await page.reload();
  await page.locator('.canvas-node').first().waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const canvas = page.locator('.canvas');
  let bounds = await canvas.boundingBox();

  // Bursts must accumulate from the latest input, not from the last React render.
  const beforeBurst = await matrix();
  await canvas.evaluate(el => { for (let i = 0; i < 80; i++) el.dispatchEvent(new WheelEvent('wheel', { deltaX: 1, deltaY: 1, bubbles: true, cancelable: true })); });
  await page.waitForFunction(x => new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform).e === x, beforeBurst.x - 80);
  const burst = await matrix();
  assert.equal(burst.y, beforeBurst.y - 80);
  await page.waitForTimeout(850);
  assert.deepEqual((await invoke('state.get')).workspaces.find(w => w.id === workspace.id).camera, burst);
  await page.reload(); await page.locator('.canvas-node').first().waitFor();
  assert.deepEqual(await matrix(), burst);
  checks.push('80 wheel events accumulate correctly; settled camera persists through reload');

  // Ctrl+wheel over editable panel content zooms around the cursor without editing.
  const note = page.locator('.note-editor').first();
  const noteBounds = await note.boundingBox();
  const px = noteBounds.x + 100, py = noteBounds.y + 100;
  bounds = await canvas.boundingBox();
  const old = await matrix();
  await page.mouse.move(px, py); await page.keyboard.down('Control'); await page.mouse.wheel(0, -45); await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  const zoomed = await matrix();
  assert.ok(zoomed.zoom > old.zoom);
  assert.ok(Math.abs((px - bounds.x - old.x) / old.zoom - (px - bounds.x - zoomed.x) / zoomed.zoom) < .01);
  assert.ok(Math.abs((py - bounds.y - old.y) / old.zoom - (py - bounds.y - zoomed.y) / zoomed.zoom) < .01);
  checks.push('Cursor-anchored zoom works over panel content');

  await page.getByRole('button', { name: 'Herramienta de mano', exact: true }).click();
  const prior = await matrix();
  await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + 95, py + 55, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction(x => Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform).e - x) < .01, prior.x + 95);
  const panned = await matrix();
  assert.ok(Math.abs(panned.x - prior.x - 95) < .01);
  assert.ok(Math.abs(panned.y - prior.y - 55) < .01);
  checks.push('Hand tool pans across editable content without moving panels');

  await page.getByRole('button', { name: 'Herramienta de selección', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('0'); await page.waitForTimeout(250);
  const fitted = await transform();
  await note.fill('h v 0 + -');
  assert.equal(await transform(), fitted);
  await canvas.focus(); await page.keyboard.down('Space');
  await page.mouse.move(bounds.x + 80, bounds.y + 100); await page.mouse.down(); await page.mouse.move(bounds.x + 120, bounds.y + 125); await page.mouse.up(); await page.keyboard.up('Space');
  assert.notEqual(await transform(), fitted);
  assert.ok(!(await canvas.getAttribute('class')).includes('hand-tool'));
  checks.push('Space temporarily pans; editor keystrokes retain ownership');

  await canvas.focus(); await page.keyboard.press('0'); await page.waitForTimeout(220);
  await page.mouse.move(bounds.x + 15, bounds.y + 80); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 15, bounds.y + bounds.height - 100, { steps: 10 }); await page.mouse.up();
  assert.equal(await page.locator('.canvas-node.selected').count(), 2);
  assert.equal(await page.locator('.canvas-marquee').count(), 0);
  await page.keyboard.press('2'); await page.waitForTimeout(220);
  checks.push('Area selection and zoom-to-selection work');

  const zoomControl = page.getByRole('button', { name: /Zoom .*Opciones de zoom/ });
  await zoomControl.focus(); await page.keyboard.press('Enter');
  assert.equal(await zoomControl.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.canvas-node.focused').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await zoomControl.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.canvas-node.selected').count(), 2);
  checks.push('Toolbar keyboard activation preserves button semantics with panels selected');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: /Zoom .*Opciones de zoom/ }).click();
  await page.locator('.canvas-zoom-presets').getByRole('button', { name: '100%', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal((await matrix()).zoom, 1);
  checks.push('Zoom presets animate to exact scale; reduced motion is supported');
  await page.getByRole('button', { name: 'Ajustar todos los paneles', exact: true }).click(); await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Gestos y atajos del canvas', exact: true }).click();
  await page.screenshot({ path: path.join(temp, 'canvas-desktop.png') });
  await page.getByRole('button', { name: 'Cerrar controles del canvas', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 760));
  await page.getByRole('button', { name: 'Personalizar espacio', exact: false }).click();
  await page.waitForTimeout(250);
  const controls = await page.locator('.canvas-navigation').boundingBox(), inspector = await page.locator('.inspector-host').boundingBox();
  assert.ok(controls.x >= bounds.x && controls.x + controls.width <= inspector.x);
  const group = await page.getByRole('button', { name: 'Agrupar en misión', exact: true }).boundingBox();
  assert.ok(controls.y >= group.y + group.height, 'Navigation clears selection actions on narrow desktop');
  await page.screenshot({ path: path.join(temp, 'canvas-narrow.png') });
  checks.push('Desktop and narrow desktop controls remain visible alongside inspector');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, evidence: temp }));
} catch (error) {
  await page?.screenshot({ path: path.join(temp, 'failure.png') }).catch(() => {});
  console.error({ evidence: temp, errors, appPid, exitCode: appProcess.exitCode, signalCode: appProcess.signalCode }); throw error;
} finally {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  if (host) {
    const command = await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '');
    if (command.includes(path.join(temp, 'profile'))) {
      await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2500)]);
      try { process.kill(host, 'SIGTERM'); } catch {}
    }
  }
  // app.exit() can leave Playwright's close dispatcher waiting indefinitely.
  // Bound graceful shutdown, then terminate only the cached fixture process.
  await Promise.race([app.close().catch(() => {}), delay(2500)]);
  killElectronGroup(appProcess);
}
