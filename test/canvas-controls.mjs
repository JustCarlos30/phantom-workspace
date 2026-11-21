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
  // Mount/ResizeObserver can still reframe the initial camera after the first
  // card appears. Start input checks from a settled, fully visible fixture.
  await page.getByRole('button', { name: 'Ajustar todos los paneles', exact: true }).click();
  await page.waitForTimeout(850);
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
  // The painted translate is snapped to device pixels; allow one screen pixel of drift.
  assert.ok(Math.abs((px - bounds.x - old.x) / old.zoom - (px - bounds.x - zoomed.x) / zoomed.zoom) * zoomed.zoom <= 1);
  assert.ok(Math.abs((py - bounds.y - old.y) / old.zoom - (py - bounds.y - zoomed.y) / zoomed.zoom) * zoomed.zoom <= 1);
  await page.waitForTimeout(400);
  assert.deepEqual(await matrix(), zoomed, 'Mount reframe must not override deliberate zoom');
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
  // Empty stage below the fitted cards; the top-left corner belongs to the project rail.
  await page.mouse.move(bounds.x + 760, bounds.y + 650); await page.mouse.down(); await page.mouse.move(bounds.x + 800, bounds.y + 675); await page.mouse.up(); await page.keyboard.up('Space');
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
  const panel = page.locator('.canvas-node').first();
  const panelId = await panel.getAttribute('data-node-id');
  const panelTitle = await panel.locator('.title-button').innerText();
  const geometry = node => [node.x, node.y, node.width, node.height];
  const savedGeometry = geometry((await invoke('state.get')).workspaces.find(w => w.id === workspace.id).nodes.find(node => node.id === panelId));
  await page.evaluate(() => {
    window.canvasFlips = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      const animation = animate.call(this, frames, options);
      if (options?.id === 'focus-flip') {
        animation.pause();
        const rects = [0, 160, 320].map(time => { animation.currentTime = time; const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        window.canvasFlips.push({ duration: options.duration, rects });
        animation.currentTime = 0; animation.play();
      }
      return animation;
    };
  });
  for (const reduced of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.getByRole('button', { name: `Ver ${panelTitle} en el mapa`, exact: true }).click();
    assert.equal(await page.locator('.canvas-node.focused').count(), 0, 'Map navigation never maximizes');
    if (!reduced) {
      await page.waitForFunction(id => document.querySelector(`[data-node-id="${id}"]`)?.getAnimations({ subtree: true }).some(a => a.animationName === 'map-flash'), panelId);
      const flash = await panel.evaluate(el => {
        const animation = el.getAnimations({ subtree: true }).find(a => a.animationName === 'map-flash');
        animation.pause();
        const opacity = [0, 162, 900].map(time => { animation.currentTime = time; return Number(getComputedStyle(el, '::after').opacity); });
        animation.finish();
        return { opacity, duration: animation.effect.getTiming().duration, iterations: animation.effect.getTiming().iterations };
      });
      assert.deepEqual(flash, { opacity: [0, 1, 0], duration: 900, iterations: 1 });
    }
    await page.waitForTimeout(1000);
    assert.equal(await panel.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.animationName === 'map-flash').length), 0, 'The ring highlight is finite');
    const origin = await panel.boundingBox(), before = await page.evaluate(() => window.canvasFlips.length);
    await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
    await page.locator('.canvas-node.focused').waitFor(); await page.waitForTimeout(400);
    const destination = await panel.boundingBox();
    await panel.locator('.note-editor').focus(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.canvas-node.focused').count(), 1, 'Editor keeps keyboard ownership');
    await canvas.focus(); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const flips = await page.evaluate(before => window.canvasFlips.slice(before), before);
    assert.equal(flips.length, reduced ? 0 : 2);
    const near = (a, b) => { for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(a[key] - b[key]) <= 2, `${key}: ${a[key]} vs ${b[key]}`); };
    near(await panel.boundingBox(), origin);
    if (!reduced) {
      assert.ok(flips.every(flip => flip.duration === 320));
      near(flips[0].rects[0], origin); near(flips[0].rects[2], destination);
      near(flips[1].rects[0], destination); near(flips[1].rects[2], origin);
      assert.notDeepEqual(flips[0].rects[1], flips[0].rects[0]);
    }
    assert.equal(await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).evaluate(el => document.activeElement === el), true);
    assert.deepEqual(geometry((await invoke('state.get')).workspaces.find(w => w.id === workspace.id).nodes.find(node => node.id === panelId)), savedGeometry, 'FLIP never persists animated geometry');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  checks.push('Finite map ring highlight, FLIP origin/destination/return, focus restoration, reduced motion and persisted geometry');
  await page.getByRole('button', { name: 'Ajustar todos los paneles', exact: true }).click(); await page.waitForTimeout(250);
  const fitDestination = await matrix();

  // Exercise real momentum with normal motion. Observe multiple post-release
  // frames before issuing navigation in the same renderer turn, so these cannot
  // accidentally pass by waiting for the glide to finish first.
  const navigateDuringGlide = async action => {
    await page.getByRole('button', { name: 'Herramienta de mano', exact: true }).click();
    const r = await canvas.boundingBox();
    await page.mouse.move(r.x + r.width - 120, r.y + 200);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width - 720, r.y + 200, { steps: 6 });
    await page.mouse.up();
    return page.evaluate(async action => {
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const read = () => {
        const m = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);
        return { x: m.e, y: m.f, zoom: m.a };
      };
      await frame(); await frame();
      const before = read();
      await frame(); await frame();
      const moving = read();
      if (Math.abs(moving.x - before.x) < 1) throw new Error('Fixture must still be gliding at navigation');
      let expected;
      if (action === 'zoom') {
        const stage = document.querySelector('.canvas-stage').getBoundingClientRect();
        const zoom = Math.min(1.8, moving.zoom * 1.2);
        expected = { x: stage.width / 2 - (stage.width / 2 - moving.x) * zoom / moving.zoom, y: stage.height / 2 - (stage.height / 2 - moving.y) * zoom / moving.zoom, zoom };
        document.querySelector('button[aria-label="Acercar"]').click();
      } else if (action === 'fit') {
        document.querySelector('button[aria-label="Ajustar todos los paneles"]').click();
      } else {
        const editor = document.querySelector('.note-editor');
        const panel = editor.closest('.canvas-node').getBoundingClientRect();
        const stage = document.querySelector('.canvas-stage').getBoundingClientRect();
        if (panel.left >= stage.left && panel.right <= stage.right && panel.top >= stage.top + 72 && panel.bottom <= stage.bottom - 16) throw new Error('Frame fixture must be outside the safe area');
        editor.focus({ preventScroll: true });
      }
      return expected;
    }, action);
  };
  const assertDestination = async expected => {
    await page.waitForTimeout(850);
    const actual = await matrix();
    assert.ok(Math.abs(actual.x - expected.x) <= 1, `x: ${actual.x} vs ${expected.x}`);
    assert.ok(Math.abs(actual.y - expected.y) <= 1, `y: ${actual.y} vs ${expected.y}`);
    assert.ok(Math.abs(actual.zoom - expected.zoom) < .00001);
    const saved = (await invoke('state.get')).workspaces.find(w => w.id === workspace.id).camera;
    assert.ok(Math.abs(saved.x - actual.x) <= 1 && Math.abs(saved.y - actual.y) <= 1);
    assert.ok(Math.abs(saved.zoom - expected.zoom) < .000000001);
    await page.waitForTimeout(120);
    assert.deepEqual(await matrix(), actual, 'Navigation must remain settled after the former glide');
    assert.deepEqual((await invoke('state.get')).workspaces.find(w => w.id === workspace.id).camera, saved);
    return actual;
  };
  await assertDestination(await navigateDuringGlide('zoom'));
  await navigateDuringGlide('fit'); await assertDestination(fitDestination);

  // Establish the single-card framing destination independently of momentum.
  await canvas.evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { deltaX: 2000, bubbles: true, cancelable: true })));
  await page.waitForTimeout(30);
  await note.evaluate(el => el.focus({ preventScroll: true }));
  await page.waitForTimeout(250);
  const frameDestination = await matrix();
  await navigateDuringGlide('frame');
  const framed = await assertDestination(frameDestination);
  await page.reload(); await page.locator('.canvas-node').first().waitFor();
  assert.deepEqual(await matrix(), framed);
  checks.push('Normal-motion zoom, fit and card framing interrupt active inertia, settle exactly and persist through reload');
  await page.getByRole('button', { name: 'Ajustar todos los paneles', exact: true }).click(); await page.waitForTimeout(250);
  bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + 15, bounds.y + 80); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 15, bounds.y + bounds.height - 100, { steps: 10 }); await page.mouse.up();
  assert.equal(await page.locator('.canvas-node.selected').count(), 2);
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
// Playwright can keep handles open after the fixture is torn down; finish once the result is reported.
process.exit(0);
