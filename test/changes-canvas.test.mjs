import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
let browser, probeBundle, realBundle;
before(async () => {
  const options = { absWorkingDir: root, entryPoints: ['test/fixtures/changes-canvas.jsx'], bundle: true, write: false, outdir: '.changes-canvas-bundle', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' } };
  [probeBundle, realBundle] = await Promise.all([
    build({ ...options, plugins: [{ name: 'review-context-probe', setup(builder) {
      builder.onLoad({ filter: /[/\\]TouchedFiles\.jsx$/ }, () => ({ contents: "export { ChangesProbe as default } from './test/fixtures/changes-canvas.jsx';", resolveDir: root, loader: 'jsx' }));
    } }] }),
    build(options),
  ]);
  let executablePath = chromium.executablePath();
  if (!existsSync(executablePath) && existsSync('/ms-playwright')) {
    executablePath = readdirSync('/ms-playwright').filter(name => name.startsWith('chromium-')).flatMap(name => ['chrome-linux', 'chrome-linux64'].map(dir => `/ms-playwright/${name}/${dir}/chrome`)).find(path => existsSync(path));
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); });

async function render({ real = false, width = 1900, terminal = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(6000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body class="app-shell rail-collapsed"><div id="fixture"></div></body></html>');
  const bundle = real ? realBundle : probeBundle;
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: 'body.app-shell { margin: 0; min-width: 0; display: block; } #fixture { width: 100vw; height: 100vh; position: relative; } [data-probe] { background: var(--surface); color: var(--ink); font: var(--t-body); }' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.evaluate(options => window.mountChangesCanvas(options), { terminal });
  await page.locator('[data-node-id="a"]').waitFor();
  if (!real) await page.waitForFunction(() => window.fixture.contexts.get('a')?.host && window.fixture.contexts.get('a')?.expandedHost);
  await page.waitForTimeout(300);
  page.checkFixture = async () => {
    assert.deepEqual(errors, [], 'Sin errores de React/DOM');
    assert.deepEqual(requests, [], 'Fixture offline');
    assert.deepEqual(await page.evaluate(() => window.fixture.unknown), []);
    const methods = await page.evaluate(() => window.fixture.calls.map(call => call.method));
    assert.equal(methods.some(method => ['chat.send', 'chat.queue.send', 'terminal.write', 'terminal.input'].includes(method)), false, 'La revisión nunca envía mensajes ni escribe en PTY');
  };
  return page;
}
async function dispose(page) { await page.evaluate(() => window.disposeChangesCanvas()); await page.checkFixture(); await page.close(); }
const camera = page => page.locator('.canvas-world').evaluate(el => { const m = new DOMMatrix(getComputedStyle(el).transform); return { x: m.e, y: m.f, zoom: m.a }; });
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const dialog = page => page.getByRole('dialog', { name: 'Revisión a', exact: true });
async function open(page) {
  const commits = await page.evaluate(() => window.fixture.cameras.length);
  await page.getByRole('button', { name: 'Revisar a', exact: true }).click();
  await dialog(page).waitFor();
  await page.waitForFunction(commits => window.fixture.contexts.get('a')?.expandedId === 'a' || window.fixture.cameras.length > commits, commits);
  await frames(page);
}
async function wheel(page, deltaX, deltaY, ctrlKey = false) {
  const before = await camera(page);
  await page.locator('.canvas-stage').dispatchEvent('wheel', { deltaX, deltaY, ctrlKey, clientX: 400, clientY: 800, bubbles: true, cancelable: true });
  const expected = ctrlKey ? { zoom: Math.min(1.8, before.zoom * 1.2 ** -Math.sign(deltaY)) } : { x: before.x - deltaX, y: before.y - deltaY, zoom: before.zoom };
  await page.waitForFunction(expected => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);
    return Object.entries(expected).every(([key, value]) => Math.abs(({ x: m.e, y: m.f, zoom: m.a })[key] - value) < .001);
  }, expected);
  await frames(page);
}
async function nearFocus(page, label) { await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, label); }
async function gap(page) {
  return page.evaluate(() => {
    const source = document.querySelector('[data-node-id="a"]').getBoundingClientRect(), companion = document.querySelector('[data-probe="a"]').getBoundingClientRect(), stage = document.querySelector('.canvas-stage').getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);
    return { gap: companion.left - source.right, top: companion.top - source.top, zoom: m.a, left: source.left - stage.left, right: companion.right - stage.left, bottom: companion.bottom - stage.top, stageWidth: stage.width, stageHeight: stage.height };
  });
}

test('Canvas real: capa mundo, separación, safeArea y pan/zoom sin desacoplar el acompañante', async () => {
  const page = await render();
  try {
    await open(page);
    assert.equal(await dialog(page).evaluate(el => el.parentElement.classList.contains('changes-canvas-world') && !!el.closest('.canvas-world')), true);
    let g = await gap(page);
    assert.ok(Math.abs(g.gap - 24 * g.zoom) < .1);
    assert.ok(Math.abs(g.top) < .1);
    assert.ok(g.left >= 0 && g.right <= g.stageWidth && g.bottom <= g.stageHeight - 16);
    const before = await camera(page);
    await wheel(page, 95, 45);
    const panned = await camera(page);
    assert.equal(panned.x, before.x - 95);
    assert.equal(panned.y, before.y - 45);
    await wheel(page, 0, -70, true);
    assert.ok((await camera(page)).zoom > panned.zoom);
    g = await gap(page);
    assert.ok(Math.abs(g.gap - 24 * g.zoom) < .1);
    assert.ok(Math.abs(g.top) < .1);
    const held = await camera(page);
    await dialog(page).dispatchEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    await frames(page);
    assert.deepEqual(await camera(page), held, 'Scroll del visor conserva la cámara');
  } finally { await dispose(page); }
});

test('Canvas real: el preview de arrastre sigue al nodo en el mismo frame', async () => {
  const page = await render();
  try {
    await open(page);
    const header = await page.locator('[data-node-id="a"] .node-header').boundingBox();
    const before = await page.locator('[data-probe="a"]').boundingBox();
    await page.mouse.move(header.x + 8, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(header.x + 104, header.y + header.height / 2 + 48, { steps: 4 });
    await frames(page);
    const during = await page.locator('[data-probe="a"]').boundingBox();
    assert.ok(Math.abs(during.x - before.x - 96) <= 1);
    assert.ok(Math.abs(during.y - before.y - 48) <= 1);
    assert.equal(await page.locator('[data-node-id="a"]').evaluate(el => el.classList.contains('is-dragging')), true);
    const g = await gap(page);
    assert.ok(Math.abs(g.gap - 24 * g.zoom) < .1);
    await page.mouse.up();
    await frames(page);
    assert.equal(await page.evaluate(() => window.fixture.workspace.nodes[0].x), 136);
  } finally { await dispose(page); }
});

test('Canvas real: abrir una sola vez, polling y segundo acompañante no recuperan la cámara', async () => {
  const page = await render();
  try {
    await open(page);
    await wheel(page, 130, 20);
    const deliberate = await camera(page);
    await page.evaluate(() => {
      window.fixture.contexts.get('a').open('a');
      window.fixture.update(value => ({ ...value, nodes: value.nodes.map(node => ({ ...node, data: { ...node.data } })) }));
    });
    await page.waitForTimeout(300);
    assert.deepEqual(await camera(page), deliberate);
    await page.evaluate(() => window.fixture.contexts.get('b').open('b'));
    await page.getByRole('dialog', { name: 'Revisión b', exact: true }).waitFor();
    assert.equal(await page.locator('[data-probe]').count(), 1);
    await page.evaluate(() => { const context = window.fixture.contexts.get('a'); context.close('a'); context.expand('a'); context.restore('a'); context.open('missing'); });
    assert.equal(await page.getByRole('dialog', { name: 'Revisión b', exact: true }).count(), 1, 'Callbacks del acompañante anterior no controlan el actual');
  } finally { await dispose(page); }
});

for (const committed of [false, true]) test(`Canvas real: ampliar/restaurar conserva cámara, panel, selección, scroll y foco; cerrar vuelve al origen (${committed ? 'zoom confirmado' : 'zoom recién pintado'})`, async () => {
  const page = await render();
  try {
    const original = await camera(page);
    await open(page);
    await page.getByRole('textbox', { name: 'Selección de prueba' }).fill('src/seleccionado.jsx');
    await page.locator('[data-probe-scroll]').evaluate(el => { el.scrollTop = 320; el.dispatchEvent(new Event('scroll', { bubbles: true })); });
    const prior = await camera(page);
    await page.getByRole('button', { name: 'Ampliar revisión', exact: true }).click();
    await frames(page);
    assert.equal(await dialog(page).evaluate(el => el.parentElement.classList.contains('changes-canvas-expanded') && !el.closest('.canvas-world')), true);
    assert.deepEqual(await camera(page), prior);
    await page.locator('.canvas-navigation .zoom-value').click();
    await page.getByRole('button', { name: '150%', exact: true }).click();
    await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform).a === 1.5);
    assert.notDeepEqual(await camera(page), prior);
    if (committed) await page.waitForFunction(() => window.fixture.workspace.camera.zoom === 1.5);
    await page.getByRole('button', { name: 'Restaurar revisión', exact: true }).click();
    await nearFocus(page, 'Ampliar revisión');
    assert.deepEqual(await page.evaluate(() => window.fixture.cameras.at(-1).camera), prior, 'Restaurar persiste la cámara previa exacta');
    assert.deepEqual(await page.evaluate(() => window.fixture.workspace.camera), prior, 'El callback conserva la cámara restaurada en las props');
    assert.deepEqual(await camera(page), prior, 'El mundo pinta la cámara restaurada exacta');
    assert.equal(await page.locator('.canvas-world').evaluate(el => el.getAnimations().some(animation => animation instanceof CSSTransition && animation.transitionProperty === 'transform')), false, 'La transición CSS no interpone otra cámara sobre la restaurada');
    assert.equal(await page.getByRole('textbox', { name: 'Selección de prueba' }).inputValue(), 'src/seleccionado.jsx');
    assert.equal(await page.locator('[data-probe-scroll]').evaluate(el => el.scrollTop), 320);
    assert.equal(await dialog(page).evaluate(el => el.parentElement.classList.contains('changes-canvas-world')), true);
    await page.waitForTimeout(300);
    assert.deepEqual(await camera(page), prior, 'Restaurar conserva la cámara tras los timers de zoom');
    assert.deepEqual(await page.evaluate(() => window.fixture.workspace.camera), prior);
    assert.deepEqual(await page.evaluate(() => window.fixture.selected), ['a']);
    assert.equal(await page.evaluate(() => window.fixture.focused), null);
    await page.getByRole('button', { name: 'Cerrar revisión', exact: true }).click();
    await nearFocus(page, 'Revisar a');
    assert.deepEqual(await camera(page), original);
    assert.deepEqual(await page.evaluate(() => window.fixture.workspace.camera), original);
    assert.deepEqual(await page.evaluate(() => window.fixture.cameras.at(-1).camera), original);
    await page.waitForTimeout(300);
    assert.deepEqual(await camera(page), original, 'Ningún settle pendiente recupera la cámara ampliada al cerrar');
    assert.equal(await page.locator('[data-probe]').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.fixture.selected), ['a']);
  } finally { await dispose(page); }
});

test('Canvas real: ventana estrecha y foco usan capa ampliada, sin reducir texto', async () => {
  const page = await render({ width: 780 });
  try {
    const original = await camera(page);
    await open(page);
    assert.equal(await dialog(page).evaluate(el => el.parentElement.classList.contains('changes-canvas-expanded')), true);
    assert.deepEqual(await camera(page), original);
    const box = await dialog(page).boundingBox(), stage = await page.locator('.canvas-stage').boundingBox();
    assert.ok(box.x >= stage.x && box.x + box.width <= stage.x + stage.width + 1);
    assert.ok(box.y >= stage.y + 72 && box.y + box.height <= stage.y + stage.height - 15);
    await page.getByRole('button', { name: 'Cerrar revisión', exact: true }).click();
    await page.setViewportSize({ width: 1900, height: 1100 });
    await page.waitForTimeout(300);
    await open(page);
    const prior = await camera(page);
    await page.evaluate(() => window.fixture.focus('a'));
    await page.waitForFunction(() => window.fixture.contexts.get('a')?.expandedId === 'a');
    await page.getByRole('button', { name: 'Restaurar revisión', exact: true }).click();
    await page.waitForFunction(() => window.fixture.focused === null);
    await frames(page);
    assert.deepEqual(await camera(page), prior);
    assert.equal(await dialog(page).evaluate(el => el.parentElement.classList.contains('changes-canvas-world')), true);
    await page.setViewportSize({ width: 780, height: 1100 });
    await page.waitForFunction(() => window.fixture.contexts.get('a')?.expandedId === 'a');
    assert.deepEqual(await camera(page), prior, 'Estrechar amplía, no escala el texto con otro encuadre');
  } finally { await dispose(page); }
});

test('Canvas real: eliminar sesión, cambiar destino/espacio/proyecto y desmontar limpia portales y callbacks', async () => {
  for (const change of ['remove', 'session', 'space', 'workspace']) {
    const page = await render();
    try {
      await open(page);
      await page.evaluate(change => {
        window.staleReview = window.fixture.contexts.get('a');
        if (change === 'remove') window.fixture.update(value => ({ ...value, nodes: value.nodes.filter(node => node.id !== 'a') }));
        if (change === 'session') window.fixture.update(value => ({ ...value, nodes: value.nodes.map(node => node.id === 'a' ? { ...node, data: { ...node.data, worktree: { path: '/synthetic/different-session' } } } : node) }));
        if (change === 'space') window.fixture.space('space-b');
        if (change === 'workspace') window.fixture.update(value => ({ ...value, id: 'workspace-b', path: '/synthetic/project-b', camera: { x: 70, y: 90, zoom: 1 } }));
      }, change);
      await page.waitForFunction(() => document.querySelectorAll('[data-probe]').length === 0);
      await page.evaluate(() => { window.staleReview.open('a'); window.staleReview.close('a'); window.staleReview.expand('a'); window.staleReview.restore('a'); });
      await frames(page);
      assert.equal(await page.locator('[data-probe]').count(), 0, change);
      await page.evaluate(() => window.disposeChangesCanvas());
      await page.evaluate(() => window.staleReview.open('a'));
      await frames(page);
      assert.equal(await page.locator('.changes-canvas-world,.changes-canvas-expanded,[data-probe]').count(), 0);
    } finally { await dispose(page); }
  }
});

test('ChatCard real añade cita al borrador existente, enfoca compositor y no envía; terminal no ofrece comentar', async () => {
  const page = await render();
  try {
    const composer = page.locator('[data-node-id="a"] .pc-input textarea');
    await composer.fill('Borrador existente');
    await open(page);
    await page.getByRole('button', { name: 'Comentar selección de prueba', exact: true }).click();
    await nearFocus(page, 'Mensaje para Claude');
    assert.equal(await composer.inputValue(), 'Borrador existente\n\nRevisión de src/example.jsx:L4-L7\n> Revisar estas líneas\n> Sin enviar');
    assert.equal(await page.locator('[data-probe]').count(), 0);
  } finally { await dispose(page); }
  const terminal = await render({ terminal: true });
  try {
    await open(terminal);
    assert.equal(await terminal.getByRole('button', { name: 'Comentar selección de prueba', exact: true }).count(), 0);
  } finally { await dispose(terminal); }
});

test('Fixture Canvas + TouchedFiles reales: lista/diff y fallo de lectura conservan revisión sin envío', async () => {
  const page = await render({ real: true });
  try {
    const badge = page.locator('[data-node-id="a"] .tf-badge');
    await badge.waitFor();
    await badge.click();
    await page.locator('.tf-panel[role="dialog"]').waitFor();
    await page.getByText('revisable', { exact: true }).waitFor();
    const call = await page.evaluate(() => window.fixture.calls.find(call => call.method === 'repo.diff'));
    assert.equal(call.payload.workspaceId, 'workspace-a');
    assert.equal(call.payload.tree, '/synthetic/worktree-a');
    assert.equal(call.payload.path, 'src/example.jsx');
  } finally { await dispose(page); }
  const failure = await render({ real: true });
  try {
    await failure.evaluate(() => { window.fixture.failDiff = true; });
    await failure.locator('[data-node-id="a"] .tf-badge').click();
    await failure.getByRole('alert').filter({ hasText: 'Fallo sintético de diff' }).waitFor();
    assert.equal(await failure.locator('.tf-panel').count(), 1);
  } finally { await dispose(failure); }
});
