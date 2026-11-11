import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SYNTHETIC fixtures only: real Electron, isolated host and real /bin/sh PTY.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/phantom-canvas-');
const home = path.join(temp, 'profile');
const evidence = path.join(root, '.test-artifacts/canvas');
await mkdir(evidence, { recursive: true });
const folders = ['SYNTHETIC-Canvas', 'SYNTHETIC-Second'].map(name => path.join(temp, name));
await Promise.all(folders.map(folder => mkdir(folder)));
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: home, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ args: [root], cwd: root, env });
const page = await app.firstWindow();
page.setDefaultTimeout(12000);
const errors = [], checks = [];
let failure, ownedHost = false;
page.on('pageerror', error => errors.push(error.message));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
async function poll(fn, message) {
  const end = Date.now() + 12000;
  do { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 80)); } while (Date.now() < end);
  throw new Error(`Timeout: ${message}`);
}
async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function size(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(580, 580); // Test-only: production desktop minimum is untouched.
    window.setContentSize(w, h);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
  await settle();
}
async function capture(name) { await settle(); await page.screenshot({ path: path.join(evidence, name) }); }
async function controlsFit() {
  const bounds = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
    return { width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth, dock: rect('.dock-main'), zoom: rect('.canvas-navigation') };
  });
  assert.ok(bounds.scroll <= bounds.width, 'No document horizontal overflow');
  for (const r of [bounds.dock, bounds.zoom]) assert.ok(r.x >= 0 && r.right <= bounds.width && r.y >= 0 && r.bottom <= bounds.height, 'Floating controls inside viewport');
  assert.ok(bounds.dock.y >= bounds.zoom.bottom || bounds.dock.right <= bounds.zoom.x || bounds.zoom.right <= bounds.dock.x, 'Dock and zoom do not overlap');
}
const trigger = () => page.locator('.rail-toggle');
async function drawerClosed() {
  await poll(() => trigger().getAttribute('aria-expanded').then(value => value === 'false'), 'Drawer closed');
  assert.equal(await page.locator('#project-navigation').evaluate(el => el.inert), true);
  assert.equal(await trigger().evaluate(el => el === document.activeElement), true, 'Drawer returns focus to trigger');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('#project-navigation')), false, 'Hidden drawer is not tabbable');
}
try {
  await page.waitForSelector('.app-shell');
  const info = await invoke('system.info');
  assert.equal(info.dataDir, home); ownedHost = true;
  await size(1520, 980);
  await invoke('workspace.open', { path: folders[0] });
  const first = (await invoke('state.get')).workspaces.find(w => w.path === folders[0]);
  const terminal = await invoke('node.create', { workspaceId: first.id, type: 'terminal', title: 'SYNTHETIC Terminal', x: 30, y: 50, width: 620, height: 420, data: {} });
  const created = await invoke('terminal.create', { workspaceId: first.id, nodeId: terminal.id, cols: 80, rows: 24 });
  const sid = created.session.id;
  await invoke('node.update', { workspaceId: first.id, id: terminal.id, patch: { data: { sessionId: sid } } });
  const note = await invoke('node.create', { workspaceId: first.id, type: 'note', title: 'SYNTHETIC Contexto', x: 710, y: 50, width: 350, height: 310, data: { text: 'SYNTHETIC · Contexto persistente\nContinuidad de terminal, nota y mapa.' } });
  await invoke('terminal.write', { sessionId: sid, data: "printf 'SYNTHETIC_%s_READY\\n' CANVAS\r" });
  const initial = await poll(async () => { const a = await invoke('terminal.attach', { sessionId: sid }); return a.data.includes('SYNTHETIC_CANVAS_READY') && a; }, 'Initial PTY output');
  assert.ok(initial.session.pid > 0);
  await invoke('workspace.open', { path: folders[1] });
  await invoke('workspace.select', { id: first.id });
  await page.reload(); await page.waitForSelector('.xterm-screen'); await settle();
  const node = page.locator(`[data-node-id="${terminal.id}"]`);
  const workspace = async () => (await invoke('state.get')).workspaces.find(w => w.id === first.id);
  const durable = w => ({ camera: w.camera, nodes: w.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, data: n.data })) });
  const stable = durable(await workspace());
  async function continuity() {
    const attached = await invoke('terminal.attach', { sessionId: sid });
    assert.equal(attached.session.id, sid); assert.equal(attached.session.pid, initial.session.pid);
    assert.equal(attached.session.status, 'running'); assert.ok(attached.data.includes('SYNTHETIC_CANVAS_READY'));
    assert.deepEqual(durable(await workspace()), stable, 'Camera, node identity, geometry and note remain stable');
  }
  async function typeInTerminal(marker) {
    await node.locator('.xterm-screen').click({ position: { x: 45, y: 35 } });
    await page.keyboard.type(`printf 'SYNTHETIC_%s_OK\\n' ${marker}`);
    await page.keyboard.press('Enter');
    await poll(async () => (await invoke('terminal.attach', { sessionId: sid })).data.includes(`SYNTHETIC_${marker}_OK`), 'xterm owns normal input');
  }
  await typeInTerminal('EXPANDED');
  await page.evaluate(() => { window.__canvasTerminal = document.querySelector('.xterm'); });
  await capture('desktop.png'); await controlsFit();
  const expandedWidth = (await page.locator('.canvas').boundingBox()).width;
  await trigger().click(); await settle();
  const collapsedWidth = (await page.locator('.canvas').boundingBox()).width;
  assert.ok(collapsedWidth - expandedWidth >= 140, 'Collapse releases at least 140px');
  assert.equal(await trigger().getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => window.__canvasTerminal === document.querySelector('.xterm')), true, 'Collapse retains mounted xterm');
  await continuity(); await typeInTerminal('COLLAPSED');
  await capture('collapsed.png'); await controlsFit();
  checks.push({ name: 'Collapse preserves live PTY, mounted xterm, camera, geometry and note', gain: collapsedWidth - expandedWidth });
  await page.reload(); await page.waitForSelector('.xterm-screen');
  assert.equal(await trigger().getAttribute('aria-expanded'), 'false');
  await page.locator('.project-item').filter({ hasText: 'SYNTHETIC-Second' }).click();
  await page.waitForSelector('.canvas-empty');
  assert.equal(await trigger().getAttribute('aria-expanded'), 'false');
  await page.locator('.project-item').filter({ hasText: 'SYNTHETIC-Canvas' }).click();
  await page.waitForSelector('.xterm-screen'); await continuity();
  checks.push({ name: 'Collapsed preference survives reload and project changes' });
  for (const collapsed of [true, false]) {
    if (!collapsed) { await trigger().click(); await settle(); }
    await page.getByRole('button', { name: 'Personalizar espacio', exact: true }).click();
    await page.waitForSelector('.appearance-panel');
    await typeInTerminal(collapsed ? 'INSPECTOR_COLLAPSED' : 'INSPECTOR_EXPANDED');
    await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill('personalizar');
    await page.keyboard.press('Enter'); await page.waitForSelector('.appearance-panel');
    await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
    await continuity();
  }
  checks.push({ name: 'Inspector is nonmodal and palette works in both rail states' });
  await page.locator('.rail-panel-row').filter({ hasText: terminal.title }).getByRole('button').first().click();
  await poll(async () => (await workspace()).camera.x !== stable.camera.x, 'Panel navigation saves camera');
  await settle();
  const returnCamera = (await workspace()).camera;
  await node.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
  await page.waitForSelector('.canvas.focus-mode');
  await capture('focused.png');
  await page.locator('.focus-return button').click(); await settle();
  assert.deepEqual((await workspace()).camera, returnCamera);
  assert.ok((await node.getAttribute('class')).includes('selected'));
  assert.equal(await page.locator(`[data-node-id="${note.id}"] textarea`).inputValue(), stable.nodes.find(n => n.id === note.id).data.text);
  checks.push({ name: 'Panel navigation, focus and return retain camera, selection and note' });
  await size(1100, 760); await controlsFit(); await capture('narrow.png');
  await size(800, 700);
  assert.equal(await page.locator('#project-navigation').evaluate(el => el.inert), true);
  await trigger().click(); await page.waitForSelector('.rail-open'); await capture('drawer.png');
  await page.keyboard.press('Escape'); await drawerClosed();
  await trigger().click(); await page.locator('.rail-scrim').click({ position: { x: 600, y: 350 } }); await drawerClosed();
  await trigger().click(); await page.locator('.project-item.active').click(); await drawerClosed();
  await trigger().click();
  await page.locator('.rail-panel-row').filter({ hasText: terminal.title }).getByRole('button').first().click(); await drawerClosed();
  await controlsFit();
  await trigger().click(); await size(1100, 760);
  assert.equal(await page.locator('#project-navigation').evaluate(el => el.inert), false);
  assert.equal(await page.locator('.rail-open').count(), 0);
  await settle(); assert.equal(await page.locator('.rail-scrim').count(), 0);
  await typeInTerminal('BREAKPOINT');
  await size(800, 700);
  assert.equal(await trigger().getAttribute('aria-expanded'), 'false', 'Crossing back does not reopen drawer');
  await size(1520, 980);
  checks.push({ name: 'Drawer Escape, scrim, project/panel selection restore focus; breakpoint clears input blocking' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger().click(); await settle();
  const reduced = await page.evaluate(() => ({ matches: matchMedia('(prefers-reduced-motion: reduce)').matches, rail: getComputedStyle(document.querySelector('.project-rail')).transitionDuration, background: getComputedStyle(document.querySelector('.app-shell'), '::before').transitionDuration }));
  assert.ok(reduced.matches); assert.equal(reduced.rail, '0s'); assert.equal(reduced.background, '0s');
  await typeInTerminal('REDUCED'); await controlsFit();
  const final = await invoke('terminal.attach', { sessionId: sid });
  assert.equal(final.session.pid, initial.session.pid);
  assert.deepEqual(errors, []);
  checks.push({ name: 'Reduced motion, live terminal after transitions and no renderer exceptions', reduced });
} catch (error) {
  failure = error;
} finally {
  await writeFile(path.join(evidence, 'checks.json'), JSON.stringify({ fixture: 'SYNTHETIC', profile: temp, checks, errors, failure: failure?.stack || null, capturedAt: new Date().toISOString() }, null, 2));
  if (ownedHost) await invoke('host.shutdown').catch(() => {});
  await app.close();
}
if (failure) throw failure;
console.log(JSON.stringify({ checks, errors, evidence }, null, 2));
