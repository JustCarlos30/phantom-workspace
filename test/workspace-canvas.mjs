import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real Electron/PTY; every project and profile belongs to this fixture.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/phantom-canvas-');
const evidence = path.join(root, '.test-artifacts/canvas');
await mkdir(evidence, { recursive: true });
const folder = path.join(temp, 'SYNTHETIC-Canvas');
const otherFolder = path.join(temp, 'SYNTHETIC-Second');
await mkdir(folder); await mkdir(otherFolder);
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile'), SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ args: [root], cwd: root, env });
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const rail = page.locator('#workspace-navigation');
const trigger = page.locator('.rail-toggle');
const terminalView = page.locator('.canvas-node').filter({ has: page.locator('.xterm') });
let first, session, baseline, failure;
async function poll(fn, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await page.waitForTimeout(60); }
  throw new Error(`Timed out: ${label}`);
}
async function settle() {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function size(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(580, 580); // Fixture only; production window stays untouched.
    window.setContentSize(w, h);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
  await settle();
}
async function snapshot(name) { await settle(); await page.screenshot({ path: path.join(evidence, name) }); }
async function workspace() { return (await invoke('state.get')).workspaces.find(w => w.id === first.id); }
function durable(w) {
  return { camera: w.camera, nodes: w.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, title: n.title, data: n.data })) };
}
async function continuity(expected = baseline, mounted = true) {
  assert.deepEqual(durable(await workspace()), expected, 'Camera, geometry, note and session references survive');
  const attached = await invoke('terminal.attach', { sessionId: session.id });
  assert.equal(attached.session.id, session.id); assert.equal(attached.session.pid, session.pid);
  assert.equal(attached.session.status, 'running');
  assert.ok(attached.data.includes('CANVAS_READY_42'));
  if (mounted) assert.ok(await page.evaluate(() => window.__canvasTerminal === document.querySelector('.xterm')), 'xterm remains mounted');
}
async function typeTerminal(marker) {
  await terminalView.locator('.node-header').click({ position: { x: 8, y: 12 } });
  await terminalView.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type(`printf '\\n%s_%s\\n' '${marker}' 'OK'`);
  await page.keyboard.press('Enter');
  await poll(async () => (await invoke('terminal.attach', { sessionId: session.id })).data.includes(`${marker}_OK`), `real xterm input ${marker}`);
}
async function layout() {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
  assert.equal(overflow, false, 'No document overflow');
  const dock = await page.locator('.dock-main').boundingBox();
  const zoom = await page.locator('.canvas-navigation').boundingBox();
  assert.ok(dock && zoom);
  assert.ok(dock.y >= zoom.y + zoom.height || dock.x >= zoom.x + zoom.width || zoom.x >= dock.x + dock.width, 'Dock and zoom do not overlap');
  const viewport = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const box of [dock, zoom]) assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'Controls remain inside viewport');
}
async function toolsInRailState() {
  await rail.getByRole('button', { name: 'Personalizar espacio', exact: true }).click();
  await page.locator('.appearance-panel').waitFor();
  await typeTerminal(`INSPECTOR_${checks.length}`);
  await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  await rail.getByRole('button', { name: 'Buscar o ejecutar comandos', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Buscar paneles y herramientas' });
  await search.fill('personalizar'); await search.press('Enter');
  await page.locator('.appearance-panel').waitFor();
  await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  await rail.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.locator('.inspector-host').waitFor();
  await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
}
async function drawerClosed() {
  await poll(() => trigger.getAttribute('aria-expanded').then(v => v === 'false'), 'drawer closed');
  assert.equal(await rail.evaluate(el => el.inert), true);
  await poll(() => trigger.evaluate(el => document.activeElement === el), 'focus returned to drawer trigger');
  await page.keyboard.press('Tab');
  assert.equal(await rail.evaluate(el => el.contains(document.activeElement)), false, 'Hidden drawer is not tabbable');
}
try {
  await page.waitForSelector('.app-shell'); await size(1520, 980);
  assert.equal((await invoke('state.get')).workspaces.length, 0, 'Isolated profile');
  first = await invoke('workspace.open', { path: folder });
  const terminal = await invoke('node.create', { workspaceId: first.id, type: 'terminal', title: 'SYNTHETIC Terminal', x: 30, y: 60, width: 620, height: 430, data: {} });
  session = (await invoke('terminal.create', { workspaceId: first.id, nodeId: terminal.id, cols: 80, rows: 24 })).session;
  assert.ok(session.pid > 0);
  await invoke('node.update', { workspaceId: first.id, id: terminal.id, patch: { data: { sessionId: session.id } } });
  await invoke('terminal.write', { sessionId: session.id, data: "printf '\\nCANVAS_READY_%s\\n' '42'\r" });
  await invoke('node.create', { workspaceId: first.id, type: 'note', title: 'SYNTHETIC Contexto', x: 690, y: 60, width: 350, height: 310, data: { text: 'SYNTHETIC · Continuidad del lienzo\n\nTerminal, cámara y contexto conservan su identidad.' } });
  await page.reload(); await page.locator('.xterm').waitFor();
  await page.getByLabel('Nota: SYNTHETIC Contexto', { exact: true }).fill('SYNTHETIC · Contexto editado y persistido\n\nVolver al trabajo sin perder el lugar.');
  await poll(async () => (await workspace()).nodes.some(n => n.data?.text?.includes('Contexto editado')), 'note saved');
  await typeTerminal('EXPANDED');
  await poll(async () => (await invoke('terminal.attach', { sessionId: session.id })).data.includes('CANVAS_READY_42'), 'initial PTY output');
  baseline = durable(await workspace());
  await page.evaluate(() => { window.__canvasTerminal = document.querySelector('.xterm'); });
  await toolsInRailState(); await continuity(); await layout();
  await snapshot('desktop.png');
  checks.push('1520×980: real PTY/note, expanded inspector/palette, no overflow or control overlap');
  const expanded = await page.locator('.canvas').boundingBox();
  await trigger.click(); await settle();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  const collapsed = await page.locator('.canvas').boundingBox();
  assert.ok(collapsed.width - expanded.width >= 140, `Canvas gained ${collapsed.width - expanded.width}px`);
  assert.equal(await terminalView.evaluate(el => el.classList.contains('selected')), true, 'Selection survives collapse');
  await continuity(); await typeTerminal('COLLAPSED'); await toolsInRailState();
  await continuity(); await layout(); await snapshot('collapsed.png');
  checks.push('Collapse frees ≥140px; selection, mounted xterm, PID, output, camera and geometry stable; tools accessible');
  await page.reload(); await page.locator('.xterm').waitFor();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await continuity(baseline, false);
  const second = await invoke('workspace.open', { path: otherFolder });
  await poll(() => invoke('state.get').then(s => s.activeWorkspaceId === second.id), 'second workspace');
  await rail.getByRole('button', { name: /SYNTHETIC-Canvas/ }).click();
  await poll(() => invoke('state.get').then(s => s.activeWorkspaceId === first.id), 'return workspace');
  await page.locator('.xterm').waitFor();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await continuity(baseline, false);
  await page.evaluate(() => { window.__canvasTerminal = document.querySelector('.xterm'); });
  await trigger.click(); await settle(); await continuity();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  await rail.locator('.rail-panel-row').first().getByRole('button').first().click();
  await settle();
  await poll(async () => (await workspace()).camera.zoom !== undefined, 'camera available');
  const camera = await page.locator('.canvas-world').getAttribute('style');
  await page.getByRole('button', { name: 'Enfocar SYNTHETIC Terminal', exact: true }).click();
  await page.locator('.canvas.focus-mode').waitFor();
  await snapshot('focused.png'); await typeTerminal('FOCUSED');
  await page.locator('.focus-return button').click(); await settle();
  assert.equal(await page.locator('.canvas-world').getAttribute('style'), camera);
  assert.equal(await terminalView.evaluate(el => el.classList.contains('selected')), true);
  // Jump deliberately changes camera; all subsequent continuity checks use that camera.
  await poll(async () => {
    const saved = (await workspace()).camera;
    const visible = await page.evaluate(() => {
    const transform = document.querySelector('.canvas-world').style.transform;
    const values = transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
    return values ? { x: +values[1], y: +values[2], zoom: +values[3] } : null;
    });
    return visible && ['x', 'y', 'zoom'].every(key => Math.abs(saved[key] - visible[key]) < .001);
  }, 'jump camera saved');
  baseline = durable(await workspace());
  await continuity();
  checks.push('Preference survives reload/project switch; navigation and focus/return preserve live session and map');
  await size(1100, 760); await layout(); await snapshot('narrow.png');
  await size(800, 700);
  assert.equal(await rail.evaluate(el => el.inert), true);
  await trigger.click(); await settle();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await rail.evaluate(el => el.inert), false);
  assert.equal(await page.locator('.main-workspace').evaluate(el => el.inert), true);
  await snapshot('drawer.png');
  await page.keyboard.press('Escape'); await drawerClosed();
  await trigger.click(); await page.locator('.rail-scrim').click({ position: { x: 600, y: 300 } }); await drawerClosed();
  await trigger.click(); await rail.getByRole('button', { name: /SYNTHETIC-Canvas/ }).click(); await drawerClosed();
  await layout(); await continuity();
  await trigger.click(); await size(1100, 760);
  assert.equal(await page.locator('.main-workspace').evaluate(el => el.inert), false);
  await page.locator('.rail-scrim').waitFor({ state: 'hidden' });
  await typeTerminal('BREAKPOINT'); await continuity();
  await size(800, 700); assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  checks.push('1100/800: drawer Escape, scrim, selection and focus return; inert hidden navigation; breakpoint clears PTY blocking');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.click(); await settle(); await page.keyboard.press('Escape'); await drawerClosed();
  await size(1520, 980); await trigger.click(); await settle(); await typeTerminal('REDUCED'); await continuity();
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.deepEqual(errors, []);
  checks.push('Reduced-motion interactions retain terminal input and identity; no pageerrors');
} catch (error) {
  failure = error;
  await snapshot('failure.png').catch(() => {});
} finally {
  await writeFile(path.join(evidence, 'checks.json'), JSON.stringify({ checks, errors, failure: failure?.stack || null, profile: temp, finishedAt: new Date().toISOString() }, null, 2));
  // This host is owned exclusively by PHANTOM_WORKSPACE_HOME above.
  await invoke('host.shutdown').catch(() => {});
  await app.close();
}
if (failure) throw failure;
console.log(JSON.stringify({ checks, errors, evidence }, null, 2));
