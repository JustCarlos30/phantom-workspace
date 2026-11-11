import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SYNTHETIC content, real Electron and real PTY. No user profile or tracked ledger.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/phantom-canvas-');
const evidence = path.join(root, '.test-artifacts/canvas');
await mkdir(evidence, { recursive: true });
const folder = path.join(temp, 'SYNTHETIC-Canvas');
const other = path.join(temp, 'SYNTHETIC-Second');
await mkdir(folder); await mkdir(other);
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile'), SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ args: [root], cwd: root, env });
const page = await app.firstWindow();
page.setDefaultTimeout(12000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const button = name => page.getByRole('button', { name, exact: true });
const toggle = () => page.locator('.rail-toggle');
const settled = () => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
const shot = async name => { await settled(); await page.screenshot({ path: path.join(evidence, name) }); };
async function size(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(580, 500); // Test only: production window policy is untouched.
    win.setContentSize(w, h);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
  await settled();
}
async function poll(fn, label) {
  const until = Date.now() + 12000;
  do { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 80)); } while (Date.now() < until);
  assert.fail(`Timed out: ${label}`);
}
async function layout() {
  const bounds = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width }; };
    return { width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth, dock: rect('.dock-main'), zoom: rect('.canvas-navigation') };
  });
  assert.ok(bounds.scroll <= bounds.width, 'No document horizontal overflow');
  for (const r of [bounds.dock, bounds.zoom].filter(Boolean)) {
    assert.ok(r.x >= 0 && r.right <= bounds.width && r.y >= 0 && r.bottom <= bounds.height, 'Floating controls fit viewport');
  }
  if (bounds.zoom) assert.ok(bounds.dock.y >= bounds.zoom.bottom || bounds.dock.right <= bounds.zoom.x || bounds.zoom.right <= bounds.dock.x, 'Dock and zoom do not overlap');
}
let failure;
try {
  await page.waitForSelector('.app-shell'); await size(1520, 980);
  await invoke('workspace.open', { path: folder });
  const first = (await invoke('state.get')).workspaces.find(w => w.path === folder);
  await invoke('workspace.open', { path: other });
  await invoke('workspace.select', { id: first.id });
  const terminal = await invoke('node.create', { workspaceId: first.id, type: 'terminal', title: 'SYNTHETIC Terminal', x: 32, y: 50, width: 650, height: 440, data: {} });
  const { session } = await invoke('terminal.create', { workspaceId: first.id, nodeId: terminal.id, cols: 80, rows: 24 });
  assert.ok(session.pid > 0);
  await invoke('node.update', { workspaceId: first.id, id: terminal.id, patch: { data: { sessionId: session.id } } });
  const note = await invoke('node.create', { workspaceId: first.id, type: 'note', title: 'SYNTHETIC Contexto', x: 725, y: 50, width: 350, height: 310, data: { text: 'SYNTHETIC · Contexto persistente del lienzo' } });
  await invoke('terminal.write', { sessionId: session.id, data: "printf 'SYNTHETIC_%s\\n' 'BASE_READY'\r" });
  const attach = () => invoke('terminal.attach', { sessionId: session.id });
  await poll(async () => (await attach()).data.includes('SYNTHETIC_BASE_READY'), 'initial PTY output');
  await page.reload(); await page.waitForSelector('.xterm'); await settled();
  const workspace = async () => (await invoke('state.get')).workspaces.find(w => w.id === first.id);
  const noteText = 'SYNTHETIC · Nota editada desde el lienzo y recuperada tras cambiar de proyecto';
  await page.locator('.note-editor').fill(noteText);
  await poll(async () => (await workspace()).nodes.find(n => n.id === note.id).data.text === noteText, 'note persisted');
  const durable = w => ({ camera: w.camera, nodes: w.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, data: n.data })) });
  const baseline = durable(await workspace());
  const terminalNode = page.locator('.canvas-node').filter({ has: page.locator('.terminal-panel') });
  await terminalNode.locator('.node-header').click({ position: { x: 10, y: 15 } });
  await page.waitForSelector('.canvas-node.selected .xterm');
  const xterm = await terminalNode.locator('.xterm').elementHandle();
  const beforeBox = await terminalNode.boundingBox();
  const expanded = (await page.locator('.canvas').boundingBox()).width;
  await layout(); await shot('desktop.png');
  await toggle().click(); await settled();
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  const collapsedWidth = (await page.locator('.canvas').boundingBox()).width;
  assert.ok(collapsedWidth - expanded >= 140, 'Collapse frees at least 140px');
  assert.ok(await xterm.evaluate(el => el.isConnected), 'Collapse retains mounted xterm');
  assert.equal(await terminalNode.evaluate(el => el.classList.contains('selected')), true);
  const afterBox = await terminalNode.boundingBox();
  assert.equal(afterBox.width, beforeBox.width); assert.equal(afterBox.height, beforeBox.height);
  assert.deepEqual(durable(await workspace()), baseline);
  assert.equal((await attach()).session.pid, session.pid);
  assert.ok((await attach()).data.includes('SYNTHETIC_BASE_READY'));
  await layout(); await shot('collapsed.png');
  checks.push({ name: 'collapse continuity', gain: collapsedWidth - expanded, pid: session.pid, sessionId: session.id });

  async function typeTerminal(marker) {
    await terminalNode.locator('.xterm-screen').click({ position: { x: 40, y: 40 } });
    await page.keyboard.type(`printf 'SYNTHETIC_%s\\n' '${marker}'`);
    await page.keyboard.press('Enter');
    await poll(async () => (await attach()).data.includes(`SYNTHETIC_${marker}`), `xterm input ${marker}`);
    assert.equal((await attach()).session.pid, session.pid);
  }
  await typeTerminal('COLLAPSED_INPUT');
  for (const collapsed of [true, false]) {
    if (!collapsed) { await toggle().click(); await settled(); }
    await button('Personalizar espacio').click(); await page.waitForSelector('.appearance-panel');
    await typeTerminal(collapsed ? 'INSPECTOR_COLLAPSED' : 'INSPECTOR_EXPANDED');
    await button('Cerrar inspector').click();
    await button('Comandos').click();
    await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill('personalizar');
    await page.keyboard.press('Enter'); await page.waitForSelector('.appearance-panel');
    await button('Cerrar inspector').click();
  }
  checks.push('Inspector nonmodal and command palette work in both desktop states; real xterm writes');
  await toggle().click(); await settled();
  await page.reload(); await page.waitForSelector('.xterm');
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  await page.locator('.project-item').filter({ hasText: 'SYNTHETIC-Second' }).click();
  await page.waitForFunction(() => document.querySelector('.workspace-path')?.textContent.includes('SYNTHETIC-Second'));
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  await page.locator('.project-item').filter({ hasText: 'SYNTHETIC-Canvas' }).click(); await page.waitForSelector('.xterm');
  assert.deepEqual(durable(await workspace()), baseline);
  assert.equal((await attach()).session.id, session.id); assert.equal((await attach()).session.pid, session.pid);
  assert.equal(await page.locator('.note-editor').inputValue(), noteText);
  await toggle().click(); await settled();
  await page.locator('.rail-panel-row').filter({ hasText: 'SYNTHETIC Terminal' }).getByRole('button').first().click();
  await poll(async () => !(await page.locator('.save-state').innerText()).includes('Guardando'), 'camera saved');
  const camera = await page.locator('.canvas-world').getAttribute('style');
  await button('Enfocar SYNTHETIC Terminal').click(); await page.waitForSelector('.canvas.focus-mode');
  await shot('focused.png'); await layout();
  await page.locator('.focus-return button').click();
  assert.equal(await page.locator('.canvas-world').getAttribute('style'), camera);
  assert.equal(await terminalNode.evaluate(el => el.classList.contains('selected')), true);
  await typeTerminal('FOCUS_RETURN');
  checks.push('Reload/project switch preserve preference, note, identity and geometry; focus return preserves camera/selection');
  await size(1100, 760); await layout(); await shot('narrow.png');
  await size(800, 700);
  assert.equal(await page.locator('#workspace-sidebar').evaluate(el => el.inert), true);
  await toggle().click(); await settled(); await shot('drawer.png');
  await page.keyboard.press('Escape'); await settled();
  assert.equal(await toggle().evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#workspace-sidebar').evaluate(el => el.inert), true);
  await toggle().click(); await page.locator('.rail-scrim').click({ position: { x: 700, y: 350 } }); await settled();
  assert.equal(await toggle().evaluate(el => el === document.activeElement), true);
  await toggle().click();
  await page.locator('.rail-panel-row').filter({ hasText: 'SYNTHETIC Terminal' }).getByRole('button').first().click();
  await settled();
  assert.equal(await page.locator('#workspace-sidebar').evaluate(el => el.inert), true);
  assert.equal(await toggle().evaluate(el => el === document.activeElement), true);
  await layout(); await typeTerminal('DRAWER_CLOSED');
  await toggle().click(); await size(1100, 760);
  assert.equal(await page.locator('.rail-scrim').count(), 0);
  assert.equal(await page.locator('#workspace-sidebar').evaluate(el => el.inert), false);
  await typeTerminal('BREAKPOINT_CLEAR');
  await size(800, 700); await settled();
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#workspace-sidebar').evaluate(el => el.inert), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#workspace-sidebar').evaluate(el => el.contains(document.activeElement)), false);
  checks.push('Drawer Escape/scrim/selection restore trigger focus; hidden inert; breakpoint clears input blockade');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await size(1520, 980); await toggle().click(); await settled();
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.ok(await page.locator('#workspace-sidebar').evaluate(el => getComputedStyle(el).transitionDuration.split(',').every(value => parseFloat(value) <= .001)), 'Reduced motion removes perceptible sidebar transition');
  await typeTerminal('REDUCED_MOTION'); await layout();
  assert.deepEqual(errors, []);
  checks.push('Reduced motion preserves operation; no pageerrors or control overlap');
} catch (error) {
  failure = error;
} finally {
  await writeFile(path.join(evidence, 'checks.json'), JSON.stringify({ fixture: 'SYNTHETIC', profile: temp, checks, errors, failure: failure?.stack || null, capturedAt: new Date().toISOString() }, null, 2));
  await invoke('host.shutdown').catch(() => {});
  await app.close();
}
if (failure) throw failure;
console.log(JSON.stringify({ checks, errors, evidence }, null, 2));
