import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

// Controller-run smoke after the production build: node --test test/interface-scale-desktop.mjs
// Real UI, native zoom, private profile and synthetic projects; needs a desktop display.
test('Electron laptop scale: 115/125%, controls, terminal, native browser and restart', {
  timeout: 150_000,
}, async t => {
  assert.ok(process.env.DISPLAY || process.env.WAYLAND_DISPLAY, 'Electron acceptance requires a desktop display');
  const root = path.resolve(import.meta.dirname, '..');
  const temporary = await mkdtemp(path.join(tmpdir(), 'phantom-interface-scale-'));
  const profile = path.join(temporary, 'profile');
  const folders = [path.join(temporary, 'First'), path.join(temporary, 'Second')];
  for (const folder of folders) await mkdir(folder);
  let app, page, hostPid;
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Scale fixture</title><h1>NATIVE_SCALE_FIXTURE</h1><input aria-label="Scale fixture input">');
  });
  const errors = [];
  const invoke = (method, payload = {}) => page.evaluate(([method, payload]) => window.phantom.invoke(method, payload), [method, payload]);
  async function poll(read, label) {
    const deadline = Date.now() + 10_000;
    do {
      const value = await read();
      if (value) return value;
      await delay(50);
    } while (Date.now() < deadline);
    assert.fail(`Timed out: ${label}`);
  }
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
    try {
      await stopUI();
      await new Promise(resolve => {
        const socket = createConnection(path.join(profile, 'host.sock'));
        const timer = setTimeout(() => { socket.destroy(); resolve(); }, 2000);
        let buffer = '';
        socket.setEncoding('utf8');
        socket.on('error', () => {});
        socket.once('connect', () => socket.write(`${JSON.stringify({ id: 'scale-cleanup', method: 'host.shutdown', payload: {} })}\n`));
        socket.on('data', chunk => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const message = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (message.id === 'scale-cleanup') socket.end();
          }
        });
        socket.once('close', () => { clearTimeout(timer); resolve(); });
      });
      if (hostPid) await poll(async () => {
        try { return /^State:\s+Z/m.test(await readFile(`/proc/${hostPid}/status`, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return true; throw error; }
      }, 'isolated host exits before removing its profile');
      await rm(temporary, { recursive: true, force: true });
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const fixtureURL = `http://127.0.0.1:${server.address().port}/`;
  async function launch() {
    const env = { ...process.env };
    // A controller may itself run inside a Phantom terminal. Never inherit its
    // socket, capability, shims, renderer URL, profile or runtime selection.
    for (const key of Object.keys(env)) {
      if (key.startsWith('PHANTOM_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV'].includes(key)) delete env[key];
    }
    Object.assign(env, {
      PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath,
      HOME: temporary, XDG_CONFIG_HOME: path.join(temporary, 'config'),
      XDG_DATA_HOME: path.join(temporary, 'data'), XDG_STATE_HOME: path.join(temporary, 'state'),
      XDG_CACHE_HOME: path.join(temporary, 'cache'), SHELL: '/bin/sh',
    });
    const executablePath = path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(root, 'node_modules/electron/dist'), 'electron');
    app = await _electron.launch({ executablePath, args: [root], cwd: temporary, env, timeout: 20_000 });
    page = await app.firstWindow();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.app-shell');
    const host = await invoke('system.info');
    assert.equal(host.dataDir, profile, 'host uses the private fixture profile');
    if (hostPid) assert.equal(host.pid, hostPid, 'UI restart reconnects to the same isolated host');
    hostPid = host.pid;
    assert.equal(await realpath(`/proc/${hostPid}/exe`), await realpath(process.execPath), 'host uses the test Node runtime, not Electron');
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), path.join(profile, 'electron'));
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.unmaximize();
      window.setResizable(true);
      const [outerWidth, outerHeight] = window.getSize();
      const [contentWidth, contentHeight] = window.getContentSize();
      const width = 1366 + outerWidth - contentWidth;
      const height = 768 + outerHeight - contentHeight;
      // The controller's desktop can be smaller than the laptop fixture. Lock
      // outer constraints using measured window decorations so the WM cannot
      // shrink the requested content area to its available work area.
      window.setMaximumSize(10000, 10000);
      window.setMinimumSize(width, height);
      window.setMaximumSize(width, height);
      window.setContentSize(1366, 768);
    });
    await poll(() => app.evaluate(({ BrowserWindow }) => {
      const [width, height] = BrowserWindow.getAllWindows()[0].getContentSize();
      return width === 1366 && height === 768;
    }), 'window manager applies the exact 1366x768 native content size');
    await page.bringToFront();
  }
  async function nativeScale(scale) {
    const { factor, size } = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { factor: window.webContents.getZoomFactor(), size: window.getContentSize() };
    });
    assert.deepEqual(size, [1366, 768], 'native laptop content size');
    assert.ok(Math.abs(factor - scale / 100) < .001);
    await page.waitForFunction(factor => Math.abs(innerWidth - 1366 / factor) < 2 && Math.abs(innerHeight - 768 / factor) < 2, scale / 100);
  }
  async function appearance() {
    if (!await page.getByLabel('Herramienta contextual').count()) await page.getByLabel('Herramientas del proyecto', { exact: true }).click();
    await page.getByLabel('Herramienta contextual').selectOption('appearance');
    await page.waitForFunction(() => document.querySelector('#interface-scale')?.disabled === false);
  }
  async function withinViewport(selector) {
    // Focus animates the panel's appearance for 220ms; the canvas region also
    // transitions when focus/inspector state changes. Assert settled geometry,
    // rather than a transient animation frame before ResizeObserver catches up.
    let previous, stableSince = Date.now();
    const box = await poll(async () => {
      // Both sides of this assertion must use renderer CSS pixels. CDP-backed
      // boundingBox() is not our coordinate oracle for Electron native UI zoom.
      const current = await page.locator(selector).evaluate(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      });
      if (JSON.stringify(current) !== JSON.stringify(previous)) stableSince = Date.now();
      previous = current;
      return current && Date.now() - stableSince >= 250 && current;
    }, `${selector} geometry settles`);
    const { viewport, layout, stylesheets } = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      layout: Object.fromEntries(['.app-shell', '.main-workspace', '.workspace-body', '.canvas-region', '.canvas', '.canvas-stage', '.canvas-world', '.canvas-node.focused', '.project-rail', '.inspector-host'].map(selector => {
        const element = document.querySelector(selector);
        if (!element) return [selector, null];
        const { x, y, width, height } = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        return [selector, { x, y, width, height, position: css.position, display: css.display,
          left: css.left, right: css.right, cssWidth: css.width, flex: css.flex, transform: css.transform,
          inlineWidth: element.style.width }];
      })),
      stylesheets: [...document.styleSheets].map(sheet => sheet.href),
    }));
    const geometry = JSON.stringify({ box, viewport, layout, stylesheets });
    assert.ok(box && box.width > 0 && box.height > 0, selector);
    assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
      `${selector} within viewport: ${geometry}`);
    assert.equal(layout['.workspace-body'].position, 'absolute', `desktop workspace layout: ${geometry}`);
    assert.equal(layout['.canvas-region'].position, 'absolute', `desktop canvas layout: ${geometry}`);
  }
  const nodeView = id => page.locator(`[data-node-id="${id}"]`);
  async function focusPanel({ id, title }) {
    try {
      // Fitting beside the inspector can put the map into overview, whose
      // header icon buttons are intentionally display:none (terminal.css).
      // The rail exposes the same focus action at every spatial zoom tier.
      const button = page.locator('.project-rail').getByLabel(`Enfocar ${title}`, { exact: true });
      await button.hover();
      await button.click();
    } catch (error) {
      const geometry = await page.evaluate(({ id, title }) => {
        const node = document.querySelector(`[data-node-id="${id}"]`);
        const elements = { node, mapButton: node?.querySelector('[aria-label="Enfocar panel"]'),
          railButton: [...document.querySelectorAll('.rail-panel-focus')].find(button => button.getAttribute('aria-label') === `Enfocar ${title}`),
          region: document.querySelector('.canvas-region'), stage: document.querySelector('.canvas-stage'),
          world: document.querySelector('.canvas-world'), rail: document.querySelector('.project-rail') };
        return { id, viewport: { width: innerWidth, height: innerHeight }, elements: Object.fromEntries(Object.entries(elements).map(([name, element]) => {
          if (!element) return [name, null];
          const { x, y, width, height } = element.getBoundingClientRect(), css = getComputedStyle(element);
          return [name, { x, y, width, height, position: css.position, transform: css.transform, left: css.left, right: css.right }];
        })) };
      }, { id, title });
      error.message += `\nFocus geometry: ${JSON.stringify(geometry)}`;
      throw error;
    }
  }
  async function browserGeometry(browser, workspaceId, scale) {
    const node = nodeView(browser.id);
    await focusPanel(browser);
    await withinViewport('.canvas-node.focused');
    const readBounds = () => node.locator('.browser-content').evaluate(element => {
      const r = element.getBoundingClientRect();
      const x = Math.max(0, Math.ceil(r.x)), y = Math.max(0, Math.ceil(r.y));
      return { x, y, width: Math.floor(Math.min(r.right, innerWidth) - x), height: Math.floor(Math.min(r.bottom, innerHeight) - y) };
    });
    let previous, stableSince = Date.now();
    const bounds = await poll(async () => {
      const current = await readBounds();
      if (JSON.stringify(current) !== JSON.stringify(previous)) stableSince = Date.now();
      previous = current;
      return Date.now() - stableSince >= 250 && current;
    }, 'browser DOM slot settles after focus/layout transitions');
    assert.ok(bounds.width > 100 && bounds.height > 100);
    // Independent oracle: convert CSS edges to native DIPs, rounding inward.
    function expected(rect) {
      const factor = scale / 100;
      const x = Math.max(0, Math.min(1366, Math.ceil(rect.x * factor)));
      const y = Math.max(0, Math.min(768, Math.ceil(rect.y * factor)));
      return { x, y, width: Math.max(x, Math.min(1366, Math.floor((rect.x + rect.width) * factor))) - x,
        height: Math.max(y, Math.min(768, Math.floor((rect.y + rect.height) * factor))) - y };
    }
    async function nativeBounds(rect, label) {
      const wanted = expected(rect);
      await poll(() => app.evaluate(({ BrowserWindow }, { wanted, fixtureURL }) => {
        const views = BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible());
        if (views.length !== 1) return false;
        const view = views[0], actual = view.getBounds();
        return view.webContents.getURL() === fixtureURL && !view.webContents.isLoading()
          && Object.keys(wanted).every(key => actual[key] === wanted[key]);
      }, { wanted, fixtureURL }), label);
    }
    await nativeBounds(bounds, `UI browser attach at ${scale}% aligns with DOM`);
    const content = await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.getVisible());
      return view.webContents.executeJavaScript('({ text: document.body.innerText, phantom: typeof window.phantom, require: typeof require })');
    });
    assert.ok(content.text.includes('NATIVE_SCALE_FIXTURE'), 'real local fixture loaded in native browser');
    assert.equal(content.phantom, 'undefined');
    assert.equal(content.require, 'undefined');
    const attached = await invoke('browser.attach', { id: browser.id, workspaceId, url: fixtureURL, bounds, visible: true });
    assert.equal(attached.attached, true);
    assert.deepEqual(attached.bounds, expected(bounds), 'attach returns native coordinates');
    // Nonzero, fractional origins and changed sizes detect missing or double zoom
    // on browser.bounds independently of initial attach and canvas transforms.
    const inset = { x: bounds.x + 13.25, y: bounds.y + 17.5, width: bounds.width - 43.75, height: bounds.height - 61.25 };
    const moved = await invoke('browser.bounds', { id: browser.id, bounds: inset, visible: true });
    assert.equal(moved.attached, true);
    assert.deepEqual(moved.bounds, expected(inset), 'bounds update returns native coordinates');
    await nativeBounds(inset, `native bounds update at ${scale}%`);
    await invoke('browser.bounds', { id: browser.id, bounds, visible: true });
    await nativeBounds(bounds, 'browser restored to its DOM slot');
    await node.getByLabel('Volver al mapa', { exact: true }).click();
    await poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.every(view => !view.getVisible())), 'map hides native browser');
  }
  await launch();
  assert.equal((await invoke('state.get')).workspaces.length, 0, 'isolated host starts empty');
  await nativeScale(115);
  const first = await invoke('workspace.open', { path: folders[0] });
  const terminal = await invoke('node.create', { workspaceId: first.id, type: 'terminal', title: 'Scale terminal', x: 30, y: 30, width: 500, height: 350 });
  const { session } = await invoke('terminal.create', { workspaceId: first.id, nodeId: terminal.id, shell: '/bin/sh', cols: 80, rows: 24 });
  assert.equal(session.status, 'running');
  const browser = await invoke('node.create', { workspaceId: first.id, type: 'browser', title: 'Scale browser', x: 550, y: 30, width: 400, height: 350, data: { url: fixtureURL } });
  await nodeView(terminal.id).waitFor();
  await nodeView(browser.id).waitFor();
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
    const node = nodeView(terminal.id);
    await focusPanel(terminal);
    await page.locator('.xterm-screen').waitFor();
    await page.waitForFunction(() => {
      const host = document.querySelector('.terminal-host')?.getBoundingClientRect();
      const screen = document.querySelector('.xterm-screen')?.getBoundingClientRect();
      return host && screen && screen.width > 100 && screen.height > 50 && screen.right <= host.right + 2 && screen.bottom <= host.bottom + 2;
    });
    await withinViewport('.canvas-node.focused');
    await node.locator('.xterm-helper-textarea').focus();
    assert.equal(await node.locator('.xterm-helper-textarea').evaluate(element => document.activeElement === element), true, 'keyboard targets the focused terminal');
    await page.keyboard.type(`printf 'SCALE_%s_OK\\n' '${scale}'`);
    await page.keyboard.press('Enter');
    const marker = `SCALE_${scale}_OK`;
    await page.waitForFunction(async ({ sessionId, marker }) => (await window.phantom.invoke('terminal.attach', { sessionId })).data.includes(marker), { sessionId: session.id, marker });
    await node.getByLabel('Volver al mapa', { exact: true }).click();
    await browserGeometry(browser, first.id, scale);
    assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'electron/interface-scale.json'), 'utf8')), { scale }, 'each scale is persisted');
    await appearance();
  }
  assert.equal((await invoke('desktop.interfaceScale.get')).scale, 125);
  for (const payload of [{ scale: 116 }, { scale: '125' }, { scale: 150, workspaceId: first.id }]) {
    await assert.rejects(invoke('desktop.interfaceScale.set', payload));
    await nativeScale(125);
  }
  await page.getByLabel('Cerrar inspector', { exact: true }).click();
  const second = await invoke('workspace.open', { path: folders[1] });
  await nodeView(terminal.id).waitFor({ state: 'hidden' });
  assert.equal((await invoke('state.get')).activeWorkspaceId, second.id);
  await nativeScale(125);
  await appearance();
  assert.equal(await page.getByLabel('Escala de la interfaz', { exact: true }).inputValue(), '125', 'scale shared by projects');
  await invoke('workspace.select', { id: first.id });
  await nodeView(terminal.id).waitFor();
  await nativeScale(125);
  await page.reload();
  await page.waitForSelector('.app-shell');
  await nativeScale(125);
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'electron/interface-scale.json'), 'utf8')), { scale: 125 });
  await stopUI();
  await launch();
  await nativeScale(125);
  await nodeView(terminal.id).waitFor();
  const reattached = await invoke('terminal.attach', { sessionId: session.id });
  assert.equal(reattached.session.status, 'running', 'UI restart preserves the live isolated terminal');
  for (const scale of [115, 125]) assert.ok(reattached.data.includes(`SCALE_${scale}_OK`));
  await appearance();
  assert.equal(await page.getByLabel('Escala de la interfaz', { exact: true }).inputValue(), '125');
  assert.deepEqual(errors, []);
});
