import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { validateSessionDefaults } from '../host/store.mjs';

let browser, bundle;
const measurements = [];
const results = [];
const artifacts = '.test-artifacts';
const checkboxName = 'Usar estos permisos en nuevas conversaciones de este proyecto';
const barPermission = '.pc-selectors > .pc-permission';
const barModel = '.pc-selectors > .pc-model-picker > .pc-model';
const barReasoning = '.pc-selectors > .pc-effort > .pc-reasoning';
const barModels = '.pc-selectors > .pc-model-picker > .pc-models';
const barEffortMenu = '.pc-selectors > .pc-effort > .pc-effort-menu';

before(async () => {
  await mkdir(artifacts, { recursive: true });
  bundle = await build({ entryPoints: ['test/fixtures/composer-ux.jsx'], bundle: true, write: false, outdir: '.test-artifacts/composer-bundle', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' } });
  let executablePath = chromium.executablePath();
  if (!existsSync(executablePath) && existsSync('/ms-playwright')) {
    const installed = readdirSync('/ms-playwright').filter(name => name.startsWith('chromium-'));
    executablePath = installed.flatMap(name => ['chrome-linux', 'chrome-linux64'].map(dir => `/ms-playwright/${name}/${dir}/chrome`)).find(path => existsSync(path));
    assert.ok(executablePath, 'Chromium preinstalado en la imagen declarada');
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
});

after(async () => {
  await browser?.close();
  await mkdir(artifacts, { recursive: true });
  await writeFile(`${artifacts}/composer-geometry.json`, JSON.stringify(measurements, null, 2));
  const rows = measurements.map(m => `| ${m.surface} | ${m.width} | ${m.state} | ${m.controls.length} | ${m.overflow.toFixed(2)} | ${m.overlaps.length} | ${m.occluded.length} |`);
  await writeFile(`${artifacts}/composer-ux-verification.md`, [
    '# Verificación renderizada del compositor', '',
    `Generado por \`node --test test/composer-ux.test.mjs\` el ${new Date().toISOString()}.`,
    'React productivo: ChatCard y PhantomChat completos, con sus estilos reales. Chromium headless, bundle local esbuild y page.setContent; sin servidor HTTP ni agentes/PTY.',
    'Audio: MediaStream generado, sin micrófono físico ni altavoz; ASR sintético. Esto verifica la UI y el recorder, no reconocimiento nativo ni aprobación visual humana.', '',
    '## Aceptaciones observadas',
    ...(results.length ? results.map(result => `- ${result}`) : ['Ninguna aceptación completada. Este informe no acredita éxito.']), '',
    '## Mediciones DOM reales',
    'Overflow horizontal en px; solapes entre controles hermanos y oclusiones en el centro (hit-test). Un check fallido conserva sus mediciones, no acredita aceptación.',
    '| Superficie | Ancho | Estado | Controles | Overflow px | Solapes | Oclusiones |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: |', ...rows, '',
    'Rectángulos completos, límites y hit-tests: `.test-artifacts/composer-geometry.json`. Capturas PNG: `.test-artifacts/composer-*.png`.',
    'Build frontend y revisión del servicio compose Storybook: los informa el controlador por separado.', '',
  ].join('\n'));
});

async function render(options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width || 480, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.exposeFunction('validateProjectUpdate', payload => {
    assert.equal(payload.id, 'storybook-project');
    assert.deepEqual(Object.keys(payload.patch), ['sessionDefaults']);
    if (payload.patch.sessionDefaults !== null) validateSessionDefaults(payload.patch.sessionDefaults);
    return true;
  });
  await page.setContent('<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body class="app-shell"><div id="fixture"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: 'body.app-shell { margin: 0; min-width: 0; display: block; } #fixture { height: 850px; position: relative; container-type: inline-size; } #fixture > .phantom-chat { position: relative; inset: auto; width: 100%; height: 100%; }' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.evaluate(options => window.mountComposer(options), options);
  await page.locator(barModel).waitFor();
  page.checkFixture = async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [], 'Render estrictamente offline');
    assert.deepEqual(await page.evaluate(() => window.fixture.unknown), []);
  };
  return page;
}

async function close(page) { await page.evaluate(() => window.disposeComposer()); await page.checkFixture(); await page.close(); }
async function openContext(page) { await page.locator('.pc-session-chip').click(); await page.getByRole('checkbox', { name: checkboxName }).waitFor(); }
async function saved(page, text) { await page.locator('.pc-project-permissions [role=status]').filter({ hasText: text }).waitFor(); }

async function focusAt(page, selector, surface, width, step, visible = false) {
  const context = `${surface}/${width}px/${step}`;
  assert.equal(await page.locator(selector).count(), 1, `${context}: destino de foco único: ${selector}`);
  try {
    await page.waitForFunction(({ selector, visible }) => {
      const elements = document.querySelectorAll(selector);
      return elements.length === 1 && elements[0] === document.activeElement && (!visible || elements[0].matches(':focus-visible'));
    }, { selector, visible }, { timeout: 2000 });
  } catch (error) {
    const diagnostic = await page.evaluate(selector => {
      const describe = el => el && ({ tag: el.tagName, class: el.className, label: el.getAttribute('aria-label'), disabled: el.disabled, visible: el.checkVisibility(), focusVisible: el.matches(':focus-visible') });
      return { active: describe(document.activeElement), targets: [...document.querySelectorAll(selector)].map(describe), contextOpen: document.querySelector('.pc-session-settings')?.open };
    }, selector);
    assert.fail(`${context}: foco esperado en ${selector}; ${JSON.stringify(diagnostic)}; ${error.message}`);
  }
  assert.equal(await page.locator(selector).evaluate((el, visible) => el === document.activeElement && (!visible || el.matches(':focus-visible')), visible), true, `${context}: foco en ${selector}`);
}

async function geometry(page, surface, width, state, menu = null) {
  const data = await page.evaluate(({ surface, width, state, menu }) => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const visible = el => el.checkVisibility() && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    const field = document.querySelector('.pc-field'), bounds = rect(field);
    const targets = [...field.querySelectorAll('.pc-selectors > .pc-session-settings > summary, .pc-selectors > .pc-permission, .pc-selectors > .pc-model-picker > button, .pc-selectors > .pc-effort > button, .pc-composer-actions button')].filter(visible);
    const controls = targets.map(el => ({ name: el.getAttribute('aria-label') || el.title || el.textContent, ...rect(el), disabled: el.disabled }));
    const overlaps = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > .5) overlaps.push([a.name, b.name]);
    }
    const occluded = targets.filter(el => {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !el.contains(hit) && el !== hit;
    }).map(el => el.getAttribute('aria-label') || el.title);
    const outside = controls.filter(r => r.x < bounds.x - .5 || r.right > bounds.right + .5 || r.y < bounds.y - .5 || r.bottom > bounds.bottom + .5);
    const overflow = Math.max(0, field.scrollWidth - field.clientWidth, document.documentElement.scrollWidth - innerWidth);
    let popup = null;
    if (menu) {
      const el = document.querySelector(menu), r = rect(el);
      const points = [[r.x + 16, r.y + 16], [r.right - 16, r.y + 16], [r.x + 16, r.bottom - 16], [r.right - 16, r.bottom - 16]];
      popup = { rect: r, clipped: points.some(([x, y]) => !el.contains(document.elementFromPoint(x, y))), overflow: el.scrollWidth - el.clientWidth };
    }
    return { surface, width, state, bounds, controls, overlaps, occluded, outside, overflow, popup };
  }, { surface, width, state, menu });
  measurements.push(data);
  await page.screenshot({ path: `${artifacts}/composer-${surface}-${width}-${state}.png` });
  assert.ok(data.controls.length >= 5, 'Controles productivos visibles');
  assert.equal(data.overflow, 0, JSON.stringify(data));
  assert.deepEqual(data.overlaps, [], JSON.stringify(data));
  // An open menu deliberately covers the controls behind it; test the menu hit targets instead.
  if (!menu) assert.deepEqual(data.occluded, [], JSON.stringify(data));
  assert.deepEqual(data.outside, [], JSON.stringify(data));
  if (menu) {
    assert.equal(data.popup.clipped, false, JSON.stringify(data));
    assert.ok(data.popup.overflow <= 1, JSON.stringify(data));
  }
  return data;
}

test('Permisos: guardar/quitar explícitos contra el validador productivo, sin cambiar sesiones existentes', async () => {
  assert.throws(() => validateSessionDefaults({ permissionMode: null }));
  for (const surface of ['card', 'dock']) {
    const page = await render({ surface, width: 480 });
    try {
      await openContext(page);
      const checkbox = page.getByRole('checkbox', { name: checkboxName });
      assert.equal(await checkbox.isChecked(), false);
      await checkbox.click();
      await saved(page, 'Guardado para nuevas conversaciones: Pregunta todo.');
      await page.locator('.pc-session-context .pc-permission').click();
      await page.getByRole('button', { name: 'Guardar permisos actuales: Autónomo' }).waitFor();
      let calls = await page.evaluate(() => window.fixture.calls.filter(call => call.method === 'workspace.update'));
      assert.equal(calls.length, 1, 'Cambiar permisos actuales no guarda defaults');
      await page.getByRole('button', { name: 'Guardar permisos actuales: Autónomo' }).click();
      await saved(page, 'Guardado para nuevas conversaciones: Autónomo.');
      await checkbox.click();
      await saved(page, 'Sin permisos recordados');
      calls = await page.evaluate(() => window.fixture.calls.filter(call => call.method === 'workspace.update'));
      assert.deepEqual(calls.map(call => call.payload.patch), [{ sessionDefaults: { permissionMode: 'ask' } }, { sessionDefaults: { permissionMode: 'auto' } }, { sessionDefaults: null }]);
      assert.equal(await checkbox.isChecked(), false);
      const configure = await page.evaluate(() => window.fixture.calls.filter(call => call.method === 'chat.configure'));
      assert.equal(configure.length, 1, 'Solo la acción explícita de permiso modifica la sesión');
      await page.screenshot({ path: `${artifacts}/composer-${surface}-permissions.png` });
      results.push(`${surface}: guardar ask, cambiar permiso actual sin guardar implícitamente, guardar auto y quitar con sessionDefaults:null; validador host real.`);
    } finally { await close(page); }
  }
});

test('Permisos: fallo visible, estado conservado y reintento desde checkbox real', async () => {
  for (const surface of ['card', 'dock']) {
    const page = await render({ surface, width: 320, failSaves: 1 });
    try {
      await openContext(page);
      const checkbox = page.getByRole('checkbox', { name: checkboxName });
      await checkbox.click();
      await page.getByRole('alert').filter({ hasText: 'Fallo sintético de guardado' }).waitFor();
      assert.equal(await checkbox.isChecked(), false);
      await page.screenshot({ path: `${artifacts}/composer-${surface}-permissions-error.png` });
      await checkbox.click();
      await saved(page, 'Guardado para nuevas conversaciones');
      assert.equal(await page.getByRole('alert').count(), 0);
      await page.evaluate(() => { window.fixture.failSaves = 1; });
      await checkbox.click();
      await page.getByRole('alert').waitFor();
      assert.equal(await checkbox.isChecked(), true, 'Fallo al quitar conserva guardado');
      await checkbox.click();
      await saved(page, 'Sin permisos recordados');
      results.push(`${surface}: fallo y reintento de guardado y borrado, error visible y estado anterior conservado.`);
    } finally { await close(page); }
  }
});

test('Geometría: 320/480/640/960, menús completos, controles clicables y foco por teclado', async () => {
  for (const surface of ['card', 'dock']) for (const width of [320, 480, 640, 960]) {
    const page = await render({ surface, width });
    try {
      await geometry(page, surface, width, 'idle');
      await page.locator('textarea').focus();
      await page.keyboard.press('Tab');
      await focusAt(page, '.pc-session-chip', surface, width, 'Tab desde mensaje', true);
      assert.notEqual(await page.locator('.pc-session-chip').evaluate(el => getComputedStyle(el).outlineStyle), 'none', `${surface}/${width}px/Tab desde mensaje: contorno de foco`);
      await page.keyboard.press('Enter');
      await page.getByRole('checkbox', { name: checkboxName }).waitFor();
      await geometry(page, surface, width, 'context-menu', '.pc-session-pop');
      await page.locator('.pc-project-permissions input').focus();
      await page.keyboard.press('Space');
      await saved(page, 'Guardado para nuevas conversaciones');
      await focusAt(page, '.pc-project-permissions input', surface, width, 'retorno tras guardar con Space');
      await page.keyboard.press('Escape');
      await focusAt(page, '.pc-session-chip', surface, width, 'Escape desde contexto');
      await page.keyboard.press('Tab');
      await focusAt(page, barPermission, surface, width, 'Tab desde contexto a permisos');
      await page.keyboard.press('Tab');
      await focusAt(page, barModel, surface, width, 'Tab desde permisos a modelo');
      await page.keyboard.press('Enter');
      await page.getByRole('textbox', { name: 'Buscar modelo' }).waitFor();
      await focusAt(page, `${barModels} input`, surface, width, 'Enter abre búsqueda de modelo');
      await geometry(page, surface, width, 'model-menu', barModels);
      await page.keyboard.press('Escape');
      await focusAt(page, barModel, surface, width, 'Escape desde modelo');
      await page.keyboard.press('Enter');
      await page.getByRole('textbox', { name: 'Buscar modelo' }).waitFor();
      await focusAt(page, `${barModels} input`, surface, width, 'reabrir búsqueda de modelo');
      await page.locator(barModels).getByRole('option').last().click();
      await focusAt(page, barModel, surface, width, 'elegir modelo');
      await page.locator(barReasoning).click();
      await focusAt(page, barEffortMenu, surface, width, 'abrir effort');
      await geometry(page, surface, width, 'effort-menu', barEffortMenu);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await focusAt(page, barReasoning, surface, width, 'Enter elige effort');
      await page.locator('textarea').fill('Mensaje sintético');
      await page.locator('.pc-send').click({ trial: true });
      await page.locator('.phantom-chat-mic').click({ trial: true });
      results.push(`${surface}/${width}px: geometría, hit-test, menús de contexto/modelo/effort, Tab, Enter, Space, Escape y foco de retorno.`);
    } finally { await close(page); }
  }
});

test('Voz: recorder real con audio sintético, grabación/transcripción/revisión estables a todos los anchos', async () => {
  for (const surface of ['card', 'dock']) for (const width of [320, 480, 640, 960]) {
    const page = await render({ surface, width, running: true });
    try {
      const initial = await geometry(page, surface, width, 'voice-idle');
      await page.getByRole('button', { name: /^Dictar/ }).click();
      await page.locator('.voice-activity[data-state=recording]').waitFor();
      const recording = await geometry(page, surface, width, 'recording');
      await page.getByRole('button', { name: 'Descartar dictado' }).click({ trial: true });
      await page.getByRole('button', { name: 'Terminar dictado', exact: true }).click();
      await page.locator('.voice-activity[data-state=transcribing]').waitFor();
      const transcribing = await geometry(page, surface, width, 'transcribing');
      await page.waitForFunction(() => typeof window.fixture.finish === 'function');
      await page.evaluate(() => window.fixture.finish());
      await page.waitForFunction(() => document.querySelector('textarea').value === 'Texto sintético revisable.');
      const review = await geometry(page, surface, width, 'review');
      for (const sample of [recording, transcribing, review]) {
        assert.ok(Math.abs(sample.bounds.height - initial.bounds.height) <= 1, 'La isla conserva altura durante voz');
        assert.ok(Math.abs(sample.bounds.y - initial.bounds.y) <= 1, 'La isla no salta');
        assert.deepEqual(sample.controls.slice(0, 3).map(({ x, y, width, height }) => ({ x, y, width, height })), initial.controls.slice(0, 3).map(({ x, y, width, height }) => ({ x, y, width, height })), 'Selectores estables');
      }
      assert.equal(await page.locator('textarea').getAttribute('readonly'), null);
      assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.method === 'chat.send').length), 0, 'Revisión no envía automáticamente');
      await page.getByRole('button', { name: 'Poner mensaje en espera' }).click({ trial: true });
      results.push(`${surface}/${width}px: grabando → transcribiendo → revisión, sin salto de isla/selectores, con respuesta concurrente y botones de detener/enviar; audio/ASR sintéticos.`);
    } finally { await close(page); }
  }
});
