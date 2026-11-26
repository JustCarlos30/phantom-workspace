import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

let browser, bundle;
const artifacts = '.test-artifacts';

before(async () => {
  await mkdir(artifacts, { recursive: true });
  bundle = await build({ entryPoints: ['test/fixtures/touched-files-panel.jsx'], bundle: true, write: false, outdir: '.test-artifacts/touched-panel-bundle', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' } });
  let executablePath = chromium.executablePath();
  if (!existsSync(executablePath) && existsSync('/ms-playwright')) {
    const installed = readdirSync('/ms-playwright').filter(name => name.startsWith('chromium-'));
    executablePath = installed.flatMap(name => ['chrome-linux', 'chrome-linux64'].map(dir => `/ms-playwright/${name}/${dir}/chrome`)).find(path => existsSync(path));
    assert.ok(executablePath, 'Chromium preinstalado en la imagen declarada');
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});

async function openPanel(page) {
  await page.locator('.tf-badge').first().click();
  await page.locator('.tf-diff code').first().waitFor();
  return page.getByRole('dialog', { name: 'Archivos tocados' });
}

test('canvas usa el host y las coordenadas mundo incluso al mover cámara y viewport', async t => {
  const page = await render({ canvas: true });
  t.after(() => page.close());
  await page.screenshot({ path: `${artifacts}/touched-files-synthetic-before-open.png` });
  const panel = await openPanel(page);
  const geometry = await panel.evaluate(el => ({
    position: getComputedStyle(el).position, left: el.style.left, top: el.style.top,
    width: el.clientWidth, inWorld: !!el.closest('.canvas-world .fixture-host'),
    inBodyPortal: el.parentElement.parentElement === document.body,
    rect: { x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, width: el.getBoundingClientRect().width },
  }));
  assert.equal(geometry.position, 'absolute');
  assert.equal(geometry.left, '460px');
  assert.equal(geometry.top, '40px');
  assert.equal(geometry.width, 760);
  assert.equal(geometry.inWorld, true);
  assert.equal(geometry.inBodyPortal, false);
  assert.equal(geometry.rect.x, 80 + 460 * .75);
  assert.equal(geometry.rect.y, 50 + 40 * .75);
  assert.equal(geometry.rect.width, 760 * .75);
  await page.screenshot({ path: `${artifacts}/touched-files-synthetic-after-open.png` });
  await page.evaluate(() => window.fixture.setCamera({ x: -200, y: 20, zoom: .5 }));
  await page.waitForFunction(() => document.querySelector('.tf-panel')?.getBoundingClientRect().x === 30);
  await page.setViewportSize({ width: 1100, height: 760 });
  assert.equal(await panel.evaluate(el => el.style.left), '460px');
  assert.equal(await panel.evaluate(el => el.clientWidth), 760);
  assert.equal(await panel.evaluate(el => el.classList.contains('is-compact')), false, 'el zoom no se confunde con ancho de lectura');
  assert.deepEqual(await page.evaluate(() => window.fixture.events), [['open', 'n1']]);
});

test('compacto conserva búsqueda y selección con selector nativo y sin lista horizontal', async t => {
  const page = await render({ canvas: true, placement: { width: 420, height: 650 } });
  t.after(() => page.close());
  const panel = await openPanel(page);
  await page.waitForFunction(() => document.querySelector('.tf-panel')?.classList.contains('is-compact'));
  assert.equal(await page.locator('.tf-list').isVisible(), false);
  assert.equal(await page.getByRole('separator').count(), 0);
  const search = page.getByRole('searchbox', { name: 'Buscar archivos' });
  await search.fill('MATH');
  const select = page.getByRole('combobox', { name: 'Archivo seleccionado' });
  assert.deepEqual(await select.locator('option:not([disabled])').allTextContents(), ['src/util/math.js']);
  await select.selectOption('src/util/math.js');
  await page.waitForFunction(() => document.querySelector('.tf-path')?.textContent === 'src/util/math.js');
  assert.match(await page.locator('.tf-file-state').innerText(), /sin commit/);
  assert.doesNotMatch(await panel.innerText(), /sin guardar|guardado\s*guardado/);
  await search.fill('ningún-archivo');
  assert.equal(await select.locator('option:not([disabled])').count(), 0);
  assert.equal(await page.locator('.tf-path').innerText(), 'src/util/math.js', 'buscar no cambia el archivo en revisión');
  await search.fill('');
  assert.equal(await select.inputValue(), 'src/util/math.js');
  const overflow = await panel.evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, detail: el.querySelector('.tf-scroll').clientHeight }));
  assert.ok(overflow.scrollWidth <= overflow.width);
  assert.ok(overflow.detail >= 64);
  await page.screenshot({ path: `${artifacts}/touched-files-synthetic-compact.png` });
});

test('lista redimensionable con teclado y puntero respeta 220–260 en un mundo escalado', async t => {
  const page = await render({ canvas: true });
  t.after(() => page.close());
  await openPanel(page);
  const separator = page.getByRole('separator', { name: 'Ancho de la lista de archivos' });
  await separator.focus();
  await page.keyboard.press('Home');
  assert.equal(await separator.getAttribute('aria-valuenow'), '220');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await separator.getAttribute('aria-valuenow'), '220');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  assert.equal(await separator.getAttribute('aria-valuenow'), '260');
  await page.keyboard.press('Home');
  await page.waitForFunction(() =>
    document.querySelector('.tf-resize')?.getAttribute('aria-valuenow') === '220'
    && document.querySelector('.tf-browser')?.getBoundingClientRect().width === 220 * .75);
  const protocolBox = await separator.boundingBox();
  const geometry = await separator.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return {
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + 30) === el,
      browserWidth: el.previousElementSibling.getBoundingClientRect().width,
    };
  });
  const box = geometry.box;
  assert.equal(geometry.hit, true, 'el separador recibe el puntero en el punto que se usará para arrastrar');
  assert.equal(geometry.browserWidth, 220 * .75, 'la geometría ya refleja el ancho elegido por teclado');
  const errors = [], samples = [];
  page.on('pageerror', error => errors.push(error.message));
  await separator.evaluate(el => {
    const portal = el.closest('.tf-portal');
    window.fixture.resizeEvents = [];
    window.fixture.resizeSeparator = el;
    const record = source => event => {
      window.fixture.resizeEvents.push({
        source, type: event.type, trusted: event.isTrusted, pointerId: event.pointerId,
        clientX: event.clientX, buttons: event.buttons, target: event.target.className,
        captured: el.hasPointerCapture(event.pointerId), connected: el.isConnected,
        value: el.getAttribute('aria-valuenow'), parent: portal.parentElement.className,
      });
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      document.addEventListener(type, record('document-capture'), true);
      el.addEventListener(type, record('separator'));
      portal.addEventListener(type, record('portal-bubble'));
    }
  });
  const sample = async phase => samples.push(await separator.evaluate((el, phase) => {
    const panel = el.closest('.tf-panel');
    return {
      phase, value: el.getAttribute('aria-valuenow'), sameElement: el === window.fixture.resizeSeparator,
      rectWidth: panel.getBoundingClientRect().width, offsetWidth: panel.offsetWidth,
      browserWidth: panel.querySelector('.tf-browser').getBoundingClientRect().width,
      listWidth: panel.style.getPropertyValue('--tf-list-width'),
      gridColumns: getComputedStyle(panel.querySelector('.tf-body')).gridTemplateColumns,
    };
  }, phase));
  try {
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.down();
    await sample('down');
    await page.mouse.move(box.x + box.width / 2 + 15, box.y + 30);
    await sample('move');
    await page.mouse.up();
    await sample('up');
    await page.waitForFunction(() =>
      document.querySelector('.tf-resize')?.getAttribute('aria-valuenow') === '240'
      && document.querySelector('.tf-browser')?.getBoundingClientRect().width === 240 * .75);
    assert.equal(await separator.getAttribute('aria-valuenow'), '240', '15 px de viewport son 20 px mundo con zoom .75');
    assert.equal(await page.locator('.tf-browser').evaluate(el => el.getBoundingClientRect().width), 240 * .75);
    const events = await page.evaluate(() => window.fixture.resizeEvents);
    const down = events.find(event => event.source === 'separator' && event.type === 'pointerdown');
    assert.ok(down?.trusted, 'el ratón real inicia el drag en el separador');
    assert.ok(events.some(event => event.source === 'separator' && event.type === 'gotpointercapture' && event.pointerId === down.pointerId), 'el separador captura el puntero');
    assert.ok(events.some(event => event.source === 'separator' && event.type === 'pointermove' && event.captured && event.buttons === 1 && event.clientX === down.clientX + 15), 'el desplazamiento real se entrega con captura activa');
    assert.deepEqual(errors, [], 'no hay errores al capturar ni al procesar el drag');
  } finally {
    await sample('final');
    const events = await page.evaluate(() => window.fixture.resizeEvents);
    const trace = JSON.stringify({ fixture: 'synthetic', zoom: .75, protocolBox, geometry, box, samples, events, errors }, null, 2);
    await writeFile(`${artifacts}/touched-files-resize-trace.json`, trace);
    t.diagnostic(trace);
  }
});

test('ampliar y volver mantiene DOM, selección, borrador, scroll y encuadre previo', async t => {
  const page = await render({ canvas: true, comment: true, many: true, longDiff: true });
  t.after(() => page.close());
  const panel = await openPanel(page);
  await page.locator('.tf-file[data-path="src/app.js"]').click();
  await page.getByRole('button', { name: 'Seleccionar línea 4', exact: true }).click();
  await page.getByRole('button', { name: 'Seleccionar línea 5', exact: true }).click({ modifiers: ['Shift'] });
  await page.getByRole('textbox', { name: 'Comentario sobre las líneas' }).fill('Conservar este comentario');
  await page.getByRole('separator').focus();
  await page.keyboard.press('End');
  const saved = await page.evaluate(() => {
    const detail = document.querySelector('.tf-scroll'), list = document.querySelector('.tf-list');
    detail.scrollTop = 500; list.scrollTop = 200;
    window.fixture.detailElement = detail;
    return { detail: detail.scrollTop, list: list.scrollTop, camera: window.fixture.camera, rect: document.querySelector('.tf-panel').getBoundingClientRect().toJSON() };
  });
  await page.getByRole('button', { name: 'Ampliar cambios' }).click();
  await page.waitForFunction(() => !!document.querySelector('.fixture-expanded-host .tf-panel'));
  assert.equal(await page.evaluate(() => document.querySelector('.tf-scroll') === window.fixture.detailElement), true);
  assert.equal(await page.locator('.tf-scroll').evaluate(el => el.scrollTop), saved.detail);
  assert.equal(await page.locator('.tf-list').evaluate(el => el.scrollTop), saved.list);
  assert.equal(await page.getByRole('button', { name: 'Seleccionar línea 4', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('textbox', { name: 'Comentario sobre las líneas' }).inputValue(), 'Conservar este comentario');
  assert.equal(await page.getByRole('separator').getAttribute('aria-valuenow'), '260');
  assert.equal(await page.evaluate(() => window.fixture.references.length), 0);
  await page.screenshot({ path: `${artifacts}/touched-files-synthetic-expanded.png` });
  await page.locator('.tf-scroll').evaluate(el => { el.scrollTop = 700; });
  await page.getByRole('button', { name: 'Volver al canvas' }).click();
  await page.waitForFunction(() => !!document.querySelector('.fixture-host .tf-panel'));
  assert.equal(await page.locator('.tf-scroll').evaluate(el => el.scrollTop), saved.detail);
  assert.equal(await page.locator('.tf-list').evaluate(el => el.scrollTop), saved.list);
  assert.deepEqual(await page.evaluate(() => window.fixture.camera), saved.camera);
  assert.deepEqual(await panel.evaluate(el => el.getBoundingClientRect().toJSON()), saved.rect);
  assert.equal(await page.locator('.tf-file[aria-current="true"]').getAttribute('data-path'), 'src/app.js');
  assert.deepEqual(await page.evaluate(() => window.fixture.events), [['open', 'n1'], ['expand', 'n1'], ['restore', 'n1']]);
});

test('referencia por rango solo se añade explícitamente al borrador y permite reintentar un fallo', async t => {
  const page = await render({ canvas: true, comment: true });
  t.after(() => page.close());
  await openPanel(page);
  await page.getByRole('button', { name: 'Seleccionar línea 4', exact: true }).click();
  await page.getByRole('button', { name: 'Seleccionar línea 5', exact: true }).click({ modifiers: ['Shift'] });
  assert.equal(await page.evaluate(() => window.fixture.references.length), 0);
  assert.equal(await page.getByRole('textbox', { name: 'Borrador de la sesión' }).inputValue(), 'Borrador existente');
  await page.getByRole('textbox', { name: 'Comentario sobre las líneas' }).fill('Revisar el caso vacío');
  await page.evaluate(() => { window.fixture.commentError = 'Borrador ocupado'; });
  await page.getByRole('button', { name: 'Añadir al borrador' }).click();
  await page.getByText('No se pudo añadir la referencia: Borrador ocupado', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.references.length), 0);
  await page.evaluate(() => { window.fixture.commentError = ''; });
  await page.getByRole('button', { name: 'Añadir al borrador' }).click();
  await page.getByText('Referencia añadida al borrador. No se ha enviado.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixture.references), [{ path: 'README.md', startLine: 4, endLine: 5, text: 'Revisar el caso vacío' }]);
  assert.equal(await page.getByRole('textbox', { name: 'Borrador de la sesión' }).inputValue(), 'Borrador existente\n\nREADME.md:4-5\nRevisar el caso vacío');
  assert.deepEqual(await page.evaluate(() => window.fixture.sent), []);
  assert.deepEqual(await page.evaluate(() => [...new Set(window.fixture.calls.map(call => call.method))].sort()), ['repo.changes', 'repo.diff']);
});

test('terminal sin callback mantiene selección sin ofrecer comentario; cerrar devuelve foco y cámara', async t => {
  const page = await render({ canvas: true });
  t.after(() => page.close());
  const camera = await page.evaluate(() => window.fixture.camera);
  await openPanel(page);
  await page.getByRole('button', { name: 'Seleccionar línea 4', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Añadir al borrador' }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: 'Comentario sobre las líneas' }).count(), 0);
  await page.getByRole('button', { name: 'Ampliar cambios' }).click();
  await page.getByRole('button', { name: 'Cerrar archivos tocados' }).click();
  await page.locator('.tf-panel').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.tf-badge').evaluate(el => el === document.activeElement), true);
  assert.deepEqual(await page.evaluate(() => window.fixture.camera), camera);
  assert.equal(await page.evaluate(() => window.fixture.activeId), null);
  assert.equal(await page.locator('.fixture-expanded-host .tf-panel').count(), 0);
});

test('solo el acompañante activo se monta y el vínculo sesión recupera el foco correcto', async t => {
  const page = await render({ canvas: true, two: true });
  t.after(() => page.close());
  await openPanel(page);
  await page.locator('[data-session="n2"] .tf-badge').click();
  await page.waitForFunction(() => window.fixture.activeId === 'n2');
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await page.locator('[data-session="n1"] .tf-badge').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('[data-session="n2"] .tf-badge').getAttribute('aria-expanded'), 'true');
  await page.getByRole('button', { name: 'Sesión · Otra sesión · feature/review' }).click();
  assert.equal(await page.locator('[data-session="n2"] .tf-badge').evaluate(el => el === document.activeElement), true);
  await page.getByRole('button', { name: 'Ampliar cambios' }).click();
  await page.getByRole('button', { name: 'Sesión · Otra sesión · feature/review' }).click();
  await page.waitForFunction(() => window.fixture.expandedId === null);
  assert.equal(await page.locator('[data-session="n2"] .tf-badge').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.fixture-host .tf-panel').count(), 1);
  await page.locator('.tf-panel').focus();
  await page.keyboard.press('Escape');
  await page.locator('.tf-panel').waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-session="n2"] .tf-badge').evaluate(el => el === document.activeElement), true);
});

test('diff numerado navega bloques, expande contexto, compara en paralelo y previsualiza Markdown seguro', async t => {
  const page = await render({ canvas: true });
  t.after(() => page.close());
  await openPanel(page);
  assert.equal(await page.locator('.tf-hunk').count(), 2);
  assert.equal(await page.getByRole('button', { name: 'Seleccionar línea 2', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Mostrar 1 línea de contexto' }).click();
  assert.equal(await page.getByRole('button', { name: 'Seleccionar línea 2', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Bloque siguiente' }).click();
  assert.equal(await page.locator('.tf-hunk-count').innerText(), '2/2 bloques');
  await page.getByRole('button', { name: 'Bloque anterior' }).click();
  assert.equal(await page.locator('.tf-hunk-count').innerText(), '1/2 bloques');
  await page.getByRole('button', { name: 'Ampliar cambios' }).click();
  await page.getByRole('button', { name: 'Paralela', exact: true }).click();
  assert.equal(await page.locator('.tf-diff.is-parallel').count(), 1);
  const pair = page.locator('.tf-pair').filter({ hasText: 'old line of README.md' });
  assert.match(await pair.locator('.tf-side').nth(0).innerText(), /old line/);
  assert.match(await pair.locator('.tf-side').nth(1).innerText(), /new line/);
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  await page.locator('.tf-preview .md strong').waitFor();
  assert.equal(await page.locator('.tf-preview .md strong').innerText(), 'Texto seguro');
  assert.equal(await page.locator('.tf-preview img, .tf-preview script, .tf-preview a[href^="javascript:"]').count(), 0);
  assert.match(await page.locator('.tf-preview').innerText(), /<img src=x/);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await page.getByRole('button', { name: 'Contexto completo', exact: true }).click();
  await page.locator('.tf-source').waitFor();
  assert.match(await page.locator('.tf-scroll').innerText(), /Versión actual en disco/);
  assert.ok((await page.locator('.tf-source .tf-ln').count()) > 3);
});

test('errores de lista y diff son recuperables sin borrar la última lectura ni falsear un archivo binario', async t => {
  const page = await render({ canvas: true, comment: true, fixture: { failures: { 'repo.changes': 'Repositorio ocupado' } } });
  t.after(() => page.close());
  await page.locator('.tf-badge').click();
  await page.getByRole('alert').filter({ hasText: 'Repositorio ocupado' }).waitFor();
  await page.evaluate(() => { delete window.fixture.failures['repo.changes']; });
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await page.locator('.tf-diff code').first().waitFor();
  await page.getByRole('button', { name: 'Seleccionar línea 4', exact: true }).click();
  await page.evaluate(() => { window.fixture.failures['repo.diff'] = 'Lectura interrumpida'; });
  await page.getByRole('button', { name: 'Releer archivo' }).click();
  await page.getByRole('alert').filter({ hasText: 'Lectura interrumpida' }).waitFor();
  assert.match(await page.locator('.tf-diff').innerText(), /new line of README/);
  assert.equal(await page.getByRole('button', { name: 'Añadir al borrador' }).isDisabled(), true);
  await page.evaluate(() => { delete window.fixture.failures['repo.diff']; });
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  await page.evaluate(() => { window.fixture.failures['repo.changes'] = 'Sin conexión'; });
  await page.getByRole('button', { name: 'Actualizar lista' }).click();
  await page.getByRole('alert').filter({ hasText: 'Se conserva la última lista' }).waitFor();
  assert.equal(await page.locator('.tf-file').count(), 3);
  await page.evaluate(() => {
    delete window.fixture.failures['repo.changes'];
    window.fixture.files = window.fixture.files.slice(1);
    window.fixture.diffs['src/app.js'] = 'diff --git a/src/app.js b/src/app.js\nBinary files a/src/app.js and b/src/app.js differ\n';
  });
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await page.getByText('Archivo binario: no hay diff de texto.', { exact: true }).waitFor();
  assert.equal(await page.locator('.tf-file[aria-current="true"]').getAttribute('data-path'), 'src/app.js');
  assert.equal(await page.getByRole('button', { name: /^Seleccionar línea/ }).count(), 0);
  assert.match(await page.locator('.tf-file-state').innerText(), /Sin cambios pendientes de commit/);
});

test('respuestas fuera de orden no sustituyen el archivo elegido y el aislamiento descarta lecturas del workspace anterior', async t => {
  const page = await render({ canvas: true, fixture: { defer: { 'repo.diff': true } } });
  t.after(() => page.close());
  await page.locator('.tf-badge').click();
  await page.waitForFunction(() => window.fixture.pending.some(item => item.args.path === 'README.md'));
  await page.locator('.tf-file[data-path="src/app.js"]').click();
  await page.waitForFunction(() => window.fixture.pending.some(item => item.args.path === 'src/app.js'));
  await page.evaluate(() => {
    window.fixture.pending.find(item => item.args.path === 'src/app.js').resolve({ text: '@@ -1 +1 @@\n-old\n+APP actual\n' });
    window.fixture.pending.find(item => item.args.path === 'README.md').resolve({ text: '@@ -1 +1 @@\n-old\n+README obsoleto\n' });
  });
  await page.getByText('APP actual', { exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('.tf-diff').innerText(), /README obsoleto/);
  await page.evaluate(() => {
    window.fixture.defer['repo.changes'] = true;
    window.fixture.setIdentity({ workspaceId: 'w2', tree: '/tmp/otro-tree' });
  });
  await page.locator('.tf-panel').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.fixture.pending.some(item => item.method === 'repo.changes' && item.args.workspaceId === 'w2'));
  assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.method === 'repo.diff' && call.workspaceId === 'w2')), false, 'no se pide un diff con una selección heredada');
  await page.evaluate(() => {
    window.fixture.pending.find(item => item.method === 'repo.changes' && item.args.workspaceId === 'w2').resolve({ files: [], base: 'other' });
  });
  await page.locator('.tf-badge').click();
  await page.getByText('No hay cambios contra la base.', { exact: true }).first().waitFor();
  assert.equal(await page.locator('.tf-file').count(), 0);
});

test('polling no se solapa, se pausa al ocultar o deshabilitar y descarta respuestas tras desmontar', async t => {
  const page = await render({ canvas: true, clock: true });
  t.after(() => page.close());
  await openPanel(page);
  await page.evaluate(() => { window.fixture.defer['repo.changes'] = true; });
  await page.clock.runFor(21000);
  assert.equal(await page.evaluate(() => window.fixture.pending.filter(item => item.method === 'repo.changes').length), 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByText('Actualización suspendida · se conserva la última lectura.', { exact: true }).waitFor();
  const paused = await page.evaluate(() => window.fixture.calls.length);
  await page.clock.runFor(15000);
  assert.equal(await page.evaluate(() => window.fixture.calls.length), paused);
  await page.evaluate(() => {
    window.fixture.pending[0].resolve({ files: [], base: 'stale' });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.fixture.setEnabled(false);
  });
  await page.clock.runFor(15000);
  assert.equal(await page.locator('.tf-file').count(), 3, 'la respuesta anterior a la pausa no borra la lista');
  const disabled = await page.evaluate(() => window.fixture.calls.length);
  await page.clock.runFor(15000);
  assert.equal(await page.evaluate(() => window.fixture.calls.length), disabled);
  await page.evaluate(() => { window.fixture.setEnabled(true); });
  await page.waitForFunction(() => window.fixture.pending.length >= 2);
  await page.evaluate(() => window.disposePanel());
  await page.evaluate(() => window.fixture.pending.at(-1).resolve({ files: [], base: 'late' }));
  await page.clock.runFor(15000);
  assert.equal(await page.locator('.tf-panel, .tf-portal').count(), 0);
  assert.equal(await page.evaluate(() => window.fixture.calls.length), disabled + 2, 'solo se reanudan lista y diff antes de desmontar');
});

test('un diff lento no se solapa ni se descarta continuamente con cada tick de la lista', async t => {
  const page = await render({ canvas: true, clock: true });
  t.after(() => page.close());
  await openPanel(page);
  await page.evaluate(() => { window.fixture.defer['repo.diff'] = true; });
  await page.clock.runFor(21000);
  assert.equal(await page.evaluate(() => window.fixture.pending.filter(item => item.method === 'repo.diff').length), 1);
  assert.match(await page.locator('.tf-diff').innerText(), /new line of README/);
  await page.evaluate(() => window.fixture.pending.find(item => item.method === 'repo.diff').resolve({ text: '@@ -1 +1 @@\n-old\n+Diff renovado\n' }));
  await page.getByText('Diff renovado', { exact: true }).waitFor();
  await page.waitForFunction(() => window.fixture.pending.filter(item => item.method === 'repo.diff').length === 2);
  await page.evaluate(() => { window.fixture.setEnabled(false); });
  await page.getByText('Actualización suspendida · se conserva la última lectura.', { exact: true }).waitFor();
  await page.evaluate(() => window.fixture.pending.at(-1).resolve({ text: '@@ -1 +1 @@\n-old\n+Respuesta tras pausa\n' }));
  await page.clock.runFor(10000);
  assert.equal(await page.locator('.tf-diff').getByText('Diff renovado', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Respuesta tras pausa', { exact: true }).count(), 0);
});
after(async () => { await browser?.close(); });

async function render(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  if (options.clock) await page.clock.install();
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body class="app-shell"><div id="fixture"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.evaluate(options => {
    Object.assign(window.fixture, options.fixture || {});
    window.mountPanel(options);
  }, options);
  await page.locator('.tf-badge').first().waitFor();
  return page;
}

test('abrir muestra el panel dentro del viewport con el primer archivo y su diff', async () => {
  const page = await render();
  await page.locator('.tf-badge').click();
  const panel = page.getByRole('dialog', { name: 'Archivos tocados' });
  await panel.waitFor();
  const box = await panel.boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1400 && box.y + box.height <= 800, JSON.stringify(box));
  assert.ok(box.x >= 440, 'acoplado fuera del borde derecho de la card');
  const current = page.locator('.tf-file[aria-current="true"]');
  assert.equal(await current.getAttribute('data-path'), 'README.md');
  await page.locator('.tf-diff').waitFor();
  assert.match(await page.locator('.tf-diff').innerText(), /new line of README\.md/);
  await page.screenshot({ path: `${artifacts}/touched-files-panel.png` });
  await page.close();
});

test('clic fuera no cierra; Escape dentro cierra y devuelve el foco a la insignia', async () => {
  const page = await render();
  await page.locator('.tf-badge').click();
  const panel = page.getByRole('dialog', { name: 'Archivos tocados' });
  await panel.waitFor();
  await page.mouse.click(700, 790);
  await page.mouse.click(5, 790);
  assert.equal(await panel.count(), 1);
  await page.locator('.tf-file').first().focus();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'tf-badge');
  await page.close();
});

test('flecha abajo cambia el archivo seleccionado y el diff', async () => {
  const page = await render();
  await page.locator('.tf-badge').click();
  await page.locator('.tf-diff').waitFor();
  await page.locator('.tf-file[aria-current="true"]').focus();
  await page.keyboard.press('ArrowDown');
  const path = await page.locator('.tf-file[aria-current="true"]').getAttribute('data-path');
  assert.notEqual(path, 'README.md');
  await page.getByText(`new line of ${path}`).waitFor();
  await page.keyboard.press('End');
  assert.equal(await page.locator('.tf-file[aria-current="true"]').getAttribute('data-path'), 'src/util/math.js');
  await page.close();
});
