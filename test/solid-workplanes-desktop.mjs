import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

// Controller-owned execution. Built renderer, isolated real host and PTYs;
// only conversation responses are synthetic, with no provider invocation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const evidence = await mkdtemp('/tmp/opencode/solid-workplanes-');
const temp = await mkdtemp('/tmp/phantom-solid-');
const profile = path.join(temp, 'profile');
const env = { ...process.env };
// The controller can run inside Phantom: never reuse its host, capabilities,
// shims, renderer, profile or runtime configuration in this fixture.
for (const key of Object.keys(env)) {
  if (key.startsWith('PHANTOM_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV'].includes(key)) delete env[key];
}
Object.assign(env, {
  PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath,
  HOME: temp, XDG_CONFIG_HOME: path.join(temp, 'config'),
  XDG_DATA_HOME: path.join(temp, 'data'), XDG_STATE_HOME: path.join(temp, 'state'),
  XDG_CACHE_HOME: path.join(temp, 'cache'), SHELL: '/bin/sh',
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const captures = [], errors = [];
let app, child, page, host;
let requestedSize;
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const windowGeometry = async () => {
  const native = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { content: win.getContentSize(), outer: win.getBounds(), zoom: win.webContents.getZoomFactor() };
  });
  const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
  return { requested: requestedSize, ...native, viewport,
    expectedViewport: requestedSize?.map(size => Math.round(size / native.zoom)) };
};
const sizeWindow = async (width, height) => {
  requestedSize = [width, height];
  await app.evaluate(({ BrowserWindow }, [width, height]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show(); win.unmaximize(); win.setResizable(true);
    const [outerWidth, outerHeight] = win.getSize();
    const [contentWidth, contentHeight] = win.getContentSize();
    const outer = [width + outerWidth - contentWidth, height + outerHeight - contentHeight];
    // Lock measured outer constraints so a smaller controller desktop cannot
    // clamp the requested native content area to the WM work area.
    win.setMaximumSize(10000, 10000);
    win.setMinimumSize(...outer);
    win.setMaximumSize(...outer);
    win.setContentSize(width, height);
  }, requestedSize);
  const deadline = Date.now() + 5000;
  let geometry;
  do {
    geometry = await windowGeometry();
    // Chromium exposes integer CSS viewport dimensions after native zoom;
    // native/compositor quantization need not match Math.round (observed:
    // 1100 / 1.15 = 956.5217..., innerWidth = 956). Require the exact native
    // content size and one of the two adjacent CSS integers, not an assumed
    // rounding direction. This does not relax workplane containment checks.
    if (Number.isFinite(geometry.zoom) && geometry.zoom > 0
      && geometry.content.every((size, i) => size === requestedSize[i])
      && geometry.viewport.every((size, i) => {
        const cssSize = requestedSize[i] / geometry.zoom;
        return size === Math.floor(cssSize) || size === Math.ceil(cssSize);
      })) return;
    await delay(50);
  } while (Date.now() < deadline);
  assert.fail(`Window geometry did not settle within 5000ms: ${JSON.stringify(geometry)}`);
};
const shot = async name => {
  const file = path.join(evidence, `${name}.png`);
  await page.screenshot({ path: file }); captures.push(file);
};
const exposed = async locator => {
  await locator.waitFor({ state: 'visible' });
  assert.equal(await locator.isEnabled(), true);
  assert.deepEqual(await locator.evaluate(el => {
    const r = el.getBoundingClientRect(), misses = [];
    for (const x of [.15, .5, .85]) for (const y of [.15, .5, .85]) {
      if (!el.contains(document.elementFromPoint(r.x + r.width * x, r.y + r.height * y))) misses.push([x, y]);
    }
    return misses;
  }), [], 'Control has an unobscured hit target');
};
const materials = async () => {
  const result = await page.evaluate(() => {
    const bad = [], reading = [];
    let focusGeometry;
    if (document.querySelector('.app-shell.studio-focused')) {
      const regionElement = document.querySelector('.canvas-region');
      const panelElement = document.querySelector('.canvas-node.focused');
      const region = regionElement.getBoundingClientRect();
      const panel = panelElement.getBoundingClientRect();
      const vv = window.visualViewport;
      // At native 1520x980 / zoom 1.15, inner/client dimensions round to
      // 1322x852 while visualViewport is 1321.7391357421875x852.1739501953125.
      // The region bottom equals the latter exactly; its right differs by
      // only 0.000091552734375 CSS px (rect accumulation at native zoom).
      // Compare to the actual visible bounds, allowing only floating-point
      // noise, rather than accepting an integer-pixel overflow allowance.
      const viewport = { left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0,
        right: (vv?.offsetLeft ?? 0) + (vv?.width ?? innerWidth),
        bottom: (vv?.offsetTop ?? 0) + (vv?.height ?? innerHeight) };
      const rectEpsilon = .001;
      if (region.left < viewport.left - rectEpsilon || region.right > viewport.right + rectEpsilon
        || region.top < viewport.top - rectEpsilon || region.bottom > viewport.bottom + rectEpsilon) bad.push('focused region outside viewport');
      if (panel.left < region.left || panel.right > region.right || panel.top < region.top || panel.bottom > region.bottom) bad.push('focused workplane outside region');
      if (bad.length) {
        const measure = el => {
          if (!el) return null;
          const style = getComputedStyle(el);
          return {
            tag: el.tagName, className: el.className,
            rect: el.getBoundingClientRect().toJSON(),
            client: [el.clientWidth, el.clientHeight],
            scroll: [el.scrollWidth, el.scrollHeight, el.scrollLeft, el.scrollTop],
            offsetParent: el.offsetParent?.className || el.offsetParent?.tagName || null,
            style: Object.fromEntries([
              'position', 'display', 'box-sizing', 'width', 'height', 'min-width', 'max-width',
              'min-height', 'max-height', 'left', 'right', 'top', 'bottom',
              'margin-left', 'margin-right', 'padding-left', 'padding-right',
              'border-left-width', 'border-right-width', 'overflow-x', 'overflow-y',
              'flex', 'flex-basis', 'align-self', 'transform', 'translate', 'scale',
              'zoom', 'contain', 'transition-property', 'transition-duration',
              '--gutter', '--rail-width', '--inspector-width',
            ].map(key => [key, style.getPropertyValue(key)])),
          };
        };
        const ancestors = [];
        for (let el = panelElement; el; el = el.parentElement) ancestors.push(measure(el));
        focusGeometry = {
          viewport: { inner: [innerWidth, innerHeight], client: [document.documentElement.clientWidth, document.documentElement.clientHeight],
            devicePixelRatio, visual: vv ? { width: vv.width, height: vv.height, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale } : null },
          region: measure(regionElement), stage: measure(document.querySelector('.canvas-stage')),
          panel: measure(panelElement), rail: measure(document.querySelector('.project-rail')),
          inspector: measure(document.querySelector('.inspector-host')), ancestors,
          outsideViewport: { left: -region.left, right: region.right - innerWidth, top: -region.top, bottom: region.bottom - innerHeight },
          outsideVisualViewport: { left: viewport.left - region.left, right: region.right - viewport.right,
            top: viewport.top - region.top, bottom: region.bottom - viewport.bottom },
        };
      }
    }
    const alpha = color => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3];
    };
    const objectMaterial = el => {
      const s = getComputedStyle(el), ring = getComputedStyle(el, '::before');
      const probe = document.createElement('div'); el.append(probe);
      probe.style.backgroundImage = 'var(--object-fill)';
      probe.style.boxShadow = 'var(--shadow-chrome)';
      const expected = getComputedStyle(probe);
      if (alpha(s.backgroundColor) !== 255) bad.push(`translucent object ${el.className}`);
      if (!s.backgroundImage.startsWith('linear-gradient(') || s.backgroundImage !== expected.backgroundImage) bad.push(`incorrect vertical material ${el.className}`);
      if (s.boxShadow !== expected.boxShadow) bad.push(`incorrect contact shadow ${el.className}`);
      if (s.backdropFilter !== 'none') bad.push(`blurred object ${el.className}`);
      if (['Top', 'Right', 'Bottom', 'Left'].some(side => s[`border${side}Width`] !== '0px')) bad.push(`second object edge ${el.className}`);
      if (el.matches('.canvas-node') && s.outlineWidth !== '0px') bad.push('selection has a second contour');
      probe.style.backgroundImage = el.matches('.canvas-node.selected')
        ? 'linear-gradient(var(--selected-edge-top), var(--selected-edge-bottom))'
        : 'linear-gradient(var(--object-edge-top), var(--object-edge-bottom))';
      if (ring.backgroundImage !== getComputedStyle(probe).backgroundImage) bad.push(`incorrect ring gradient ${el.className}`);
      if (ring.content === 'none' || ring.position !== 'absolute' || ring.zIndex !== '3'
        || ring.pointerEvents !== 'none' || ring.maskComposite !== 'exclude'
        || ring.maskImage.split('linear-gradient(').length !== 3
        || ring.borderRadius !== s.borderRadius
        || ['top', 'right', 'bottom', 'left'].some(side => ring[side] !== '0px')
        || Math.abs(parseFloat(ring.paddingTop) - (el.matches('.overview') ? Number(s.getPropertyValue('--ov')) : 1)) > .01) bad.push(`invalid masked ring ${el.className}`);
      probe.remove();
    };
    for (const panel of document.querySelectorAll('.canvas-node[data-type="terminal"]')) {
      objectMaterial(panel);
      for (const child of panel.querySelectorAll(':scope > .node-header,:scope > .node-body')) {
        if (alpha(getComputedStyle(child).backgroundColor) !== 0) bad.push(`object material covered by ${child.className}`);
      }
      for (const el of [panel, ...panel.querySelectorAll('.node-body,.pc,.pc-thread,.pc-composer,.pc-field,.pt-card,.pt-card-screen,.pt-output,.terminal-wrap,.terminal-host')]) {
        const style = getComputedStyle(el);
        if (style.backdropFilter !== 'none') bad.push(`blur ${el.className}`);
      }
      for (const well of panel.querySelectorAll('.pc-thread,.pc-field,.pt-card-screen,.terminal-host')) {
        const style = getComputedStyle(well);
        if (alpha(style.backgroundColor) !== 255) bad.push(`translucent reading/writing well: ${well.className}`);
      }
      const text = panel.querySelector('.pc-message.is-agent,.pt-output,.terminal-wrap') || panel.querySelector('.node-body');
      const chain = [];
      for (let el = text; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        chain.push([style.filter, style.opacity]);
        if (style.filter !== 'none' || style.opacity !== '1') bad.push(`attenuated reading ${el.className}`);
      }
      reading.push({ id: panel.dataset.nodeId, color: getComputedStyle(text).color, chain });
    }
    const canvas = document.querySelector('.canvas');
    if (alpha(getComputedStyle(canvas).backgroundColor) !== 0) bad.push('canvas hides environmental art');
    const art = getComputedStyle(document.querySelector('.canvas-region'), '::after');
    if (art.backgroundImage === 'none' || Number(art.opacity) <= 0 || Number(getComputedStyle(canvas).zIndex) <= Number(art.zIndex)) bad.push('art missing or above workplanes');
    for (const el of document.querySelectorAll('.project-rail,.canvas-navigation,.activity-dock,.inspector-host,.phantom-chat,.context-menu-panel')) {
      if (el.getClientRects().length) objectMaterial(el);
    }
    for (const el of document.querySelectorAll('.rail-panel-row.selected')) {
      const style = getComputedStyle(el), probe = document.createElement('span'); el.append(probe);
      probe.style.backgroundColor = 'var(--surface-3)'; probe.style.color = 'var(--ink)';
      if (style.backgroundColor !== getComputedStyle(probe).backgroundColor || style.color !== getComputedStyle(probe).color) bad.push('rail selection lost neutral plane/ink');
      probe.remove();
    }
    for (const el of document.querySelectorAll('.dock-action.active,.canvas-navigation button[aria-pressed="true"]:not(.view-toggle,.phantom-launcher),.pc-send:not(:disabled):not(.is-stop),.pd-tabs button[aria-selected="true"]')) {
      if (!el.getClientRects().length) continue;
      const style = getComputedStyle(el);
      const probe = document.createElement('span'); el.append(probe);
      probe.style.backgroundColor = 'var(--on)'; probe.style.color = 'var(--on-ink)';
      const expected = getComputedStyle(probe);
      if (style.backgroundColor !== expected.backgroundColor || style.color !== expected.color) bad.push(`active key lost solid light fill/dark ink: ${el.className}`);
      probe.remove();
    }
    for (const el of document.querySelectorAll('.pc-modes')) {
      const probe = document.createElement('span'); el.append(probe); probe.style.backgroundColor = 'var(--on)';
      if (getComputedStyle(el, '::before').backgroundColor !== getComputedStyle(probe).backgroundColor) bad.push('provider segment lost solid light fill');
      probe.remove();
    }
    return { bad, reading, focusGeometry };
  });
  assert.deepEqual(result.bad, [], `Workplane materials/containment: ${JSON.stringify(result.focusGeometry ?? null)}`);
  return result.reading;
};
try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env, timeout: 10000 });
  child = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor();
  const system = await invoke('system.info');
  assert.equal(system.dataDir, profile, 'host uses the private fixture profile');
  host = system.pid;
  const project = path.join(temp, 'SYNTHETIC-solid'); await mkdir(project);
  const workspace = await invoke('workspace.open', { path: project });
  const nodes = [], sessions = [];
  for (let i = 0; i < 4; i++) {
    const geometry = { x: (i % 2) * 560, y: Math.floor(i / 2) * 440, width: 540, height: 420 };
    const node = await invoke('node.create', { workspaceId: workspace.id, type: 'terminal', title: `SYNTHETIC · ${i < 2 ? 'Conversación' : 'Terminal'} ${i + 1}`, ...geometry, data: i < 2 ? { chat: { provider: 'claude' } } : {} });
    await invoke('node.update', { workspaceId: workspace.id, id: node.id, patch: geometry }); nodes.push(node);
    if (i >= 2) {
      const { session } = await invoke('terminal.create', { workspaceId: workspace.id, nodeId: node.id, cols: 80, rows: 24 });
      sessions.push(session);
      await invoke('node.update', { workspaceId: workspace.id, id: node.id, patch: { data: { sessionId: session.id } } });
    }
  }
  await app.evaluate(({ ipcMain }, ids) => {
    const original = ipcMain._invokeHandlers?.get('phantom:invoke');
    if (!original) throw new Error('Electron IPC fixture seam unavailable');
    const chats = Object.fromEntries(ids.map(id => [id, { provider: 'claude', running: false, queue: [], meta: {}, messages: [
      { id: 'question', role: 'user', status: 'done', parts: [{ type: 'text', text: 'SYNTHETIC · Revisa la legibilidad del plano de trabajo.' }] },
      { id: 'reply', role: 'assistant', status: 'done', parts: [{ type: 'text', text: '## Lectura estable\n\nObjetos degradados, pozos opacos y controles claros. Seleccionar un vecino conserva esta lectura.' }] },
    ] }]));
    globalThis.solidFixture = { calls: [] };
    ipcMain.removeHandler('phantom:invoke');
    ipcMain.handle('phantom:invoke', (event, method, payload = {}) => {
      if (method === 'chat.models') return { items: [], note: 'SYNTHETIC' };
      const chat = chats[payload.nodeId];
      if (chat && method === 'chat.get') return chat;
      if (chat && ['chat.send', 'chat.stop'].includes(method)) {
        globalThis.solidFixture.calls.push({ method, payload });
        chat.running = method === 'chat.send';
        event.sender.send('phantom:event', { type: 'chat.update', reset: true, workspaceId: payload.workspaceId, nodeId: payload.nodeId });
        return chat;
      }
      if (method.startsWith('chat.') && method !== 'chat.get') throw new Error(`Unexpected provider call: ${method}`);
      return original(event, method, payload);
    });
  }, nodes.slice(0, 2).map(node => node.id));
  await page.evaluate(ids => ids.forEach(id => localStorage.setItem(`phantom.chatSeen.${id}`, 'reply')), nodes.slice(0, 2).map(node => node.id));
  await page.reload();
  await page.locator('.pc-message.is-agent').first().waitFor();
  const card = i => page.locator(`.canvas-node[data-node-id="${nodes[i].id}"]`);
  const map = async () => {
    const settled = () => page.evaluate(async () => {
      const start = performance.now();
      let previous, stableSince = start;
      while (performance.now() - start < 4000) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const region = document.querySelector('.canvas-region');
        const stage = document.querySelector('.canvas-stage');
        const world = document.querySelector('.canvas-world');
        const focused = document.querySelector('.studio-focused,.canvas.focus-mode,.canvas-node.focused');
        const geometry = [region, stage].map(el => {
          const r = el.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        });
        const snapshot = JSON.stringify([geometry, getComputedStyle(world).transform]);
        const now = performance.now();
        if (focused || snapshot !== previous) stableSince = now;
        previous = snapshot;
        // Allow the stage ResizeObserver and its 260ms reframe debounce to
        // commit before fitting; also wait out the resulting camera motion.
        if (!focused && now - stableSince >= 320) return;
      }
      throw new Error('Map geometry/camera did not settle after leaving focus or fitting');
    });
    await page.locator('.canvas').focus();
    await page.keyboard.press('Escape');
    await settled();
    await page.keyboard.press('0');
    await settled();
  };
  for (const [width, height] of [[1520, 980], [1100, 760]]) {
    await sizeWindow(width, height);
    await map();
    assert.equal(await page.locator('.canvas-node').count(), 4);
    const before = await materials(); await shot(`${width}-map-rest`);
    await card(1).locator('.node-glyph').click(); await delay(300);
    assert.equal(await card(1).evaluate(el => el.classList.contains('selected')), true);
    assert.deepEqual(await materials(), before, 'Selecting a neighbour leaves text color and ancestor compositing stable');
    await shot(`${width}-selected`);
    await card(0).locator('.node-glyph').click();
    await page.locator('.canvas').focus(); await page.keyboard.press('Control+Shift+Enter');
    await card(0).and(page.locator('.focused')).waitFor(); await delay(350);
    await materials();
    const input = card(0).getByRole('textbox', { name: 'Mensaje para Claude' });
    await input.fill('SYNTHETIC · control usable');
    const send = card(0).getByRole('button', { name: 'Enviar mensaje', exact: true });
    await exposed(send); await send.click();
    const stop = card(0).getByRole('button', { name: 'Detener respuesta', exact: true });
    await exposed(stop); await stop.focus(); await page.keyboard.press('Enter');
    await send.waitFor(); await shot(`${width}-focus-chat`);
    await map(); await card(2).locator('.node-glyph').click();
    await page.locator('.canvas').focus(); await page.keyboard.press('Control+Shift+Enter');
    await card(2).and(page.locator('.focused')).waitFor(); await delay(350);
    const terminal = card(2).locator('.xterm-helper-textarea');
    await terminal.focus(); await page.keyboard.type(`echo SOLID_${width}`); await page.keyboard.press('Enter');
    await page.waitForFunction(async ({ sessionId, marker }) => (await window.phantom.invoke('terminal.attach', { sessionId })).data.includes(marker), { sessionId: sessions[0].id, marker: `SOLID_${width}` });
    await materials(); await shot(`${width}-focus-terminal`);
  }
  await map();
  await page.evaluate(() => {
    const region = document.querySelector('.canvas-region');
    region.style.setProperty('--personal-background', 'linear-gradient(#fff, #fff)');
    region.style.setProperty('--background-intensity', '1');
  });
  await materials(); await shot('white-image');
  const media = await page.context().newCDPSession(page);
  for (const [name, value] of [['prefers-contrast', 'more'], ['prefers-reduced-transparency', 'reduce']]) {
    await media.send('Emulation.setEmulatedMedia', { features: [{ name, value }] });
    assert.equal(await page.evaluate(query => matchMedia(query).matches, `(${name}: ${value})`), true);
    await materials(); await shot(name);
  }
  await media.send('Emulation.setEmulatedMedia', { features: [] });
  await media.detach();
  const calls = await app.evaluate(() => globalThis.solidFixture.calls);
  assert.deepEqual(calls.map(call => call.method), ['chat.send', 'chat.stop', 'chat.send', 'chat.stop']);
  assert.deepEqual(errors, [], 'No renderer errors');
  console.log(JSON.stringify({ captures, errors, fixture: 'Two synthetic conversations and two isolated real terminals', checks: ['opaque vertical object material without backdrop blur', 'opaque reading/writing wells', 'single masked ring with brighter selection', 'stable neighbour reading', 'shared black contact shadow', 'environmental art below transparent canvas', 'white image, increased contrast and reduced transparency', 'send/stop pointer and keyboard', 'real PTY input', 'two sizes, map/selection/chat focus/terminal focus'] }, null, 2));
} catch (error) {
  const failure = path.join(evidence, 'failure.png');
  await page?.screenshot({ path: failure }).then(() => captures.push(failure)).catch(() => {});
  const geometry = app && page ? await windowGeometry().catch(() => null) : null;
  console.error(JSON.stringify({ error: error.stack, geometry, captures, errors })); process.exitCode = 1;
} finally {
  try {
    if (host && (await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '')).includes(profile)) {
      await Promise.race([invoke('host.shutdown').catch(() => {}), delay(1000)]);
      try { process.kill(host, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  } finally {
    if (app) await Promise.race([app.close().catch(() => {}), delay(1000)]);
    killElectronGroup(child);
    await rm(temp, { recursive: true, force: true });
  }
}
