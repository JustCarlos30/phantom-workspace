import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import path from 'node:path';

// Controller-run smoke after the production build: node --test test/interface-scale-desktop.mjs
// Real UI, native zoom, private profile and synthetic projects; needs a desktop display.
test('Electron laptop scale: 115/125%, controls, canvas, live terminal and restart', {
  skip: !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
  timeout: 90_000,
}, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const temporary = await mkdtemp(path.join(tmpdir(), 'phantom-interface-scale-'));
  const profile = path.join(temporary, 'profile');
  const folders = [path.join(temporary, 'First'), path.join(temporary, 'Second')];
  for (const folder of folders) await mkdir(folder);
  let app, page;
  const errors = [];
  const invoke = (method, payload = {}) => page.evaluate(([method, payload]) => window.phantom.invoke(method, payload), [method, payload]);
  async function stopUI() {
    if (!app) return;
    const child = app.process();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
    }
    app = null;
  }
  t.after(async () => {
    await stopUI();
    await new Promise(resolve => {
      const socket = createConnection(path.join(profile, 'host.sock'));
      const timer = setTimeout(() => { socket.destroy(); resolve(); }, 2000);
      socket.on('error', () => {});
      socket.once('connect', () => socket.write(`${JSON.stringify({ id: 'scale-cleanup', method: 'host.shutdown', payload: {} })}\n`));
      socket.on('data', () => socket.end());
      socket.once('close', () => { clearTimeout(timer); resolve(); });
    });
    await rm(temporary, { recursive: true, force: true });
  });
  async function launch() {
    const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, SHELL: '/bin/sh' };
    for (const key of ['ELECTRON_RUN_AS_NODE', 'PHANTOM_RENDERER_URL', 'NODE_OPTIONS', 'PHANTOM_NODE_BINARY']) delete env[key];
    const executablePath = path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(root, 'node_modules/electron/dist'), 'electron');
    app = await _electron.launch({ executablePath, args: [root], cwd: root, env, timeout: 15_000 });
    page = await app.firstWindow();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.app-shell');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 768));
  }
  async function nativeScale(scale) {
    const factor = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
    assert.ok(Math.abs(factor - scale / 100) < .001);
    await page.waitForFunction(factor => Math.abs(innerWidth - 1366 / factor) < 2 && Math.abs(innerHeight - 768 / factor) < 2, scale / 100);
  }
  async function appearance() {
    if (!await page.getByLabel('Herramienta contextual').count()) await page.getByLabel('Herramientas del proyecto', { exact: true }).click();
    await page.getByLabel('Herramienta contextual').selectOption('appearance');
    await page.waitForFunction(() => document.querySelector('#interface-scale')?.disabled === false);
  }
  async function withinViewport(selector) {
    const box = await page.locator(selector).boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(box && box.width > 0 && box.height > 0, selector);
    assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} within viewport`);
  }
  await launch();
  await nativeScale(115);
  const first = await invoke('workspace.open', { path: folders[0] });
  const terminal = await invoke('node.create', { workspaceId: first.id, type: 'terminal', title: 'Scale terminal', x: 30, y: 30, width: 500, height: 350 });
  const { session } = await invoke('terminal.create', { workspaceId: first.id, nodeId: terminal.id, shell: '/bin/sh', cols: 80, rows: 24 });
  await invoke('node.update', { workspaceId: first.id, id: terminal.id, patch: { data: { sessionId: session.id } } });
  await page.locator(`[data-node-id="${terminal.id}"]`).waitFor();
  await appearance();
  for (const scale of [115, 125]) {
    const before = await page.locator('.canvas-world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
    await page.getByLabel('Escala de la interfaz', { exact: true }).selectOption(String(scale));
    await page.waitForFunction(scale => document.querySelector('#interface-scale')?.value === String(scale) && !document.querySelector('#interface-scale').disabled, scale);
    await nativeScale(scale);
    assert.equal(await page.locator('.canvas-world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a), before, 'global scale preserves spatial zoom');
    await withinViewport('#interface-scale');
    await page.getByLabel('Cerrar inspector', { exact: true }).click();
    for (const selector of ['.dock-main', '.canvas-navigation', '.canvas']) await withinViewport(selector);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1), false, 'no document overflow');
    const node = page.locator(`[data-node-id="${terminal.id}"]`);
    await node.getByLabel('Enfocar panel', { exact: true }).click();
    await page.locator('.xterm-screen').waitFor();
    await page.waitForFunction(() => {
      const host = document.querySelector('.terminal-host')?.getBoundingClientRect();
      const screen = document.querySelector('.xterm-screen')?.getBoundingClientRect();
      return host && screen && screen.width > 100 && screen.height > 50 && screen.right <= host.right + 2 && screen.bottom <= host.bottom + 2;
    });
    await withinViewport('.canvas-node.focused');
    await page.locator('.xterm').click();
    await page.keyboard.type(`printf 'SCALE_%s_OK\\n' '${scale}'`);
    await page.keyboard.press('Enter');
    const marker = `SCALE_${scale}_OK`;
    await page.waitForFunction(async ({ sessionId, marker }) => (await window.phantom.invoke('terminal.attach', { sessionId })).data.includes(marker), { sessionId: session.id, marker });
    await node.getByLabel('Volver al mapa', { exact: true }).click();
    await appearance();
  }
  assert.equal((await invoke('desktop.interfaceScale.get')).scale, 125);
  for (const payload of [{ scale: 116 }, { scale: '125' }, { scale: 150, workspaceId: first.id }]) {
    await assert.rejects(invoke('desktop.interfaceScale.set', payload));
    await nativeScale(125);
  }
  await invoke('workspace.open', { path: folders[1] });
  await nativeScale(125);
  await invoke('workspace.select', { id: first.id });
  await page.reload();
  await page.waitForSelector('.app-shell');
  await nativeScale(125);
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'electron/interface-scale.json'), 'utf8')), { scale: 125 });
  await stopUI();
  await launch();
  await nativeScale(125);
  await appearance();
  assert.equal(await page.getByLabel('Escala de la interfaz', { exact: true }).inputValue(), '125');
  assert.deepEqual(errors, []);
});
