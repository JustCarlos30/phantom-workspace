import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Rendered acceptance of the global Orquestador section. Productive OrchestratorHub with its real CSS in headless
// Chromium (esbuild + page.setContent, no HTTP server). Data: the catalog's SYNTHETIC host (scenario
// 'orchestrator-hub'), read through the real useOrchestratorInbox/buildInbox. It does not prove the host, App mounting
// nor a real orchestrator receiving the message. Screenshots and the report go outside the Git tree.
const artifacts = '/tmp/phantom-orchestrator-recovery';
const results = [], measurements = [];
let browser, bundle;

before(async () => {
  await mkdir(artifacts, { recursive: true });
  bundle = await build({ entryPoints: ['test/fixtures/orchestrator-hub.jsx'], bundle: true, write: false, outdir: `${artifacts}/bundle`, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' } });
  let executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath) && fs.existsSync('/ms-playwright')) {
    const installed = fs.readdirSync('/ms-playwright').filter(name => name.startsWith('chromium-'));
    executablePath = installed.flatMap(name => ['chrome-linux', 'chrome-linux64'].map(dir => `/ms-playwright/${name}/${dir}/chrome`)).find(file => fs.existsSync(file));
    assert.ok(executablePath, 'Chromium preinstalado en la imagen declarada');
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  await mkdir(artifacts, { recursive: true });
  await writeFile(`${artifacts}/orchestrator-hub-verification.md`, [
    '# Verificación renderizada del Orquestador global', '',
    `Generado por \`node --test test/orchestrator-hub-ui.test.mjs\` el ${new Date().toISOString()}.`,
    'OrchestratorHub productivo con su CSS real, Chromium headless, bundle esbuild y page.setContent; sin servidor HTTP. Datos: host sintético del catálogo (escenario `orchestrator-hub`). No acredita el host, el montaje en App ni la entrega real al orquestador.', '',
    '## Aceptaciones observadas', ...(results.length ? results.map(result => `- ${result}`) : ['Ninguna aceptación completada. Este informe no acredita éxito.']), '',
    '## Geometría', '| Ancho | Overflow horizontal px |', '| ---: | ---: |', ...measurements.map(m => `| ${m.width} | ${m.overflow} |`), '',
  ].join('\n'));
});

async function render(options = {}) {
  const width = Math.max(options.width ?? 900, 320);
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body class="app-shell"><div id="fixture"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: 'body.app-shell { margin: 0; min-width: 0; display: block; } #fixture { height: 860px; max-width: 100%; position: relative; container-type: inline-size; overflow: hidden; }' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.evaluate(options => window.mountHub(options), { ...options, width });
  await page.getByRole('heading', { name: options.ready || /^Se rompió/ }).waitFor();
  page.checkFixture = async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [], 'Render estrictamente offline');
    assert.deepEqual(await page.evaluate(() => window.hub.unknown), [], 'solo se usan métodos con fixture');
  };
  return page;
}
async function close(page) { await page.evaluate(() => window.disposeHub()); await page.checkFixture(); await page.close(); }
const region = (page, name) => page.getByRole('region', { name });

test('agrupa «Se rompió» y «Te necesita» por proyecto arriba, lo que va bien en una línea, y el teclado recorre las acciones', async () => {
  const page = await render({ width: 900 });
  const headings = await page.locator('.oh-group-title').allInnerTexts();
  assert.deepEqual(headings.map(text => text.replace(/\d+/g, '').trim()), ['Se rompió', 'Te necesita', 'Por proyecto']);
  const broken = await region(page, /^Se rompió/).innerText();
  assert.match(broken, /Alfa · pagos/);
  assert.match(broken, /Beta · web/);
  assert.match(broken, /Incorporación[\s\S]*feat\/landing/);
  assert.doesNotMatch(broken, /Gamma/);
  const needs = await region(page, /^Te necesita/).innerText();
  assert.match(needs, /Alfa · pagos[\s\S]*Sesión/);
  assert.doesNotMatch(needs, /Beta|Gamma/);
  const projects = await region(page, 'Por proyecto').innerText();
  assert.match(projects, /Gamma · docs[\s\S]*cosa en marcha, nada que revisar/);
  // Each row offers exactly one action button.
  const rows = page.locator('.oh-row');
  for (let index = 0; index < await rows.count(); index++) assert.equal(await rows.nth(index).getByRole('button').count(), 1);
  // Tab reaches the first action; arrows move between actions; Escape closes.
  let focused = '';
  for (let step = 0; step < 20 && !focused; step++) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => document.activeElement?.matches('.oh-action') ? document.activeElement.getAttribute('aria-label') : '');
  }
  assert.ok(focused, 'una acción de fila es alcanzable con Tab');
  await page.keyboard.press('ArrowDown');
  const next = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  assert.notEqual(next, focused, 'la flecha mueve el foco a la siguiente acción');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), focused);
  assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', 'foco visible');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.hub.closed), 1);
  await page.screenshot({ path: `${artifacts}/orchestrator-hub-900.png` });
  await close(page);
  results.push('«Se rompió», «Te necesita» y «Por proyecto» en ese orden, agrupados por proyecto, una acción por fila; Tab y flechas recorren acciones con foco visible y Escape llama onClose.');
});

test('una card sin terminal aparece con su motivo, ubicación y una acción que abre su panel', async () => {
  const page = await render({ width: 900 });
  const row = region(page, /^Se rompió/).locator('.oh-row', { hasText: 'Migrar el esquema de facturas' });
  const text = await row.innerText();
  assert.match(text, /Card/);
  assert.match(text, /Bloqueada/);
  assert.match(text, /Rama\/ruta: feat\/facturas · \/synthetic\/alfa/);
  assert.match(text, /hace 30 min/);
  await row.getByRole('button', { name: /^Abrir tarea/ }).click();
  const opened = await page.evaluate(() => window.hub.opened);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].type, 'phantom-cards');
  assert.equal(opened[0].data.cardId, 'task_alfa_card');
  assert.equal(opened[0].workspaceId, 'hub-alfa');
  assert.deepEqual(await page.evaluate(() => window.hub.selections), [{ workspaceId: 'hub-alfa', focus: null }]);
  await close(page);
  results.push('Card bloqueada sin terminal: tipo, estado, motivo con rama/ruta, hace cuánto y «Abrir tarea» que selecciona el proyecto y abre phantom-cards con su id.');
});

test('la línea del supervisor muestra su estado real, llamadas y resumen con hora, sin coste', async () => {
  const page = await render({ width: 900 });
  const projects = region(page, 'Por proyecto');
  const alfa = projects.locator('.oh-fine-item', { hasText: 'Alfa · pagos' });
  await alfa.getByText('Una sesión espera permiso para escribir en la base de datos de cobros.').waitFor();
  assert.match(await alfa.innerText(), /Supervisor: Esperando para resumir · 3 de 12 llamadas en la última hora · resumen hace 6 min/);
  assert.equal(await alfa.locator('.oh-sup-summary time').count(), 1, 'el resumen lleva su hora');
  const beta = await projects.locator('.oh-fine-item', { hasText: 'Beta · web' }).innerText();
  assert.match(beta, /Límite por hora alcanzado · 12 de 12 llamadas/);
  assert.match(await projects.locator('.oh-fine-item', { hasText: 'Gamma · docs' }).innerText(), /Aún sin resumen\.[\s\S]*Supervisor: Desactivado/);
  const all = await page.locator('.oh').innerText();
  assert.doesNotMatch(all, /Coste|coste|USD|\$/);
  assert.doesNotMatch(all, /claude-|modelo/i, 'modelo y límites no se muestran aquí');
  await close(page);
  results.push('Supervisor por proyecto: «Esperando para resumir» y «Límite por hora alcanzado» con N de M llamadas, resumen como texto principal con hora; sin coste ni modelo.');
});

test('cambiar el proyecto seleccionado mueve el destino sin perder el borrador, y se envía a ese proyecto', async () => {
  const page = await render({ width: 900 });
  const target = page.getByRole('combobox', { name: 'Proyecto destino' });
  assert.equal(await target.inputValue(), 'hub-alfa');
  const box = page.getByRole('textbox', { name: /^Mensaje para el orquestador de/ });
  await box.fill('Prioriza la landing antes del cierre');
  await page.evaluate(() => window.hub.select('hub-beta'));
  await until(async () => (await target.inputValue()) === 'hub-beta');
  assert.equal(await box.inputValue(), 'Prioriza la landing antes del cierre', 'el borrador sobrevive al cambio de proyecto');
  assert.match(await box.getAttribute('aria-label'), /Beta · web/);
  await page.evaluate(() => window.hub.select('hub-gamma'));
  await until(async () => (await target.inputValue()) === 'hub-gamma');
  await target.selectOption('hub-beta');
  assert.equal(await box.inputValue(), 'Prioriza la landing antes del cierre');
  await box.press('Enter');
  await until(async () => (await box.inputValue()) === '');
  const sends = await page.evaluate(() => window.hub.calls.filter(call => call.method === 'orchestrator.send').map(call => call.payload));
  assert.deepEqual(sends, [{ workspaceId: 'hub-beta', text: 'Prioriza la landing antes del cierre' }]);
  await close(page);
  results.push('Borrador global: sobrevive a cambiar el proyecto seleccionado; el destino sigue al seleccionado o al elegido y orchestrator.send recibe { workspaceId, text }.');
});

test('lecturas con error, entrada malformada y desconexión se muestran sin romper la UI ni perder el borrador', async () => {
  // Every read fails: visible error with retry.
  let page = await render({ width: 900, scenario: 'error', ready: 'Por proyecto' });
  await page.getByRole('alert').filter({ hasText: /No se pudo leer/ }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Reintentar' }).isVisible());
  await close(page);

  // Unusable shapes from the host: no crash, projects still listed, composer usable.
  page = await render({ width: 900, malformed: true, ready: 'Por proyecto' });
  assert.equal(await page.locator('.oh-fine-item').count(), 3);
  assert.ok(await page.getByRole('textbox', { name: /^Mensaje para el orquestador/ }).isEnabled());
  await close(page);

  // Disconnection keeps the last reading and the draft, and blocks sending.
  page = await render({ width: 900 });
  const box = page.getByRole('textbox', { name: /^Mensaje para el orquestador/ });
  await box.fill('Borrador que no se pierde');
  await page.evaluate(() => window.hub.connect(false));
  await page.getByText(/Sin conexión con el host/).first().waitFor();
  assert.ok(await box.isDisabled());
  assert.equal(await box.inputValue(), 'Borrador que no se pierde');
  assert.ok(await page.getByRole('button', { name: /^Enviar al orquestador/ }).isDisabled());
  await page.evaluate(() => window.hub.connect(true));
  await until(async () => await box.isEnabled());
  assert.equal(await box.inputValue(), 'Borrador que no se pierde');
  assert.deepEqual(await page.evaluate(() => window.hub.calls.filter(call => call.method === 'orchestrator.send')), []);
  await close(page);
  results.push('Error de lectura con «Reintentar», entrada malformada sin fallo de render, y desconexión con aviso, envío bloqueado y borrador intacto.');
});

test('sin desborde horizontal a 320 px ni a 1600 px', async () => {
  for (const width of [320, 1600]) {
    const page = await render({ width });
    await region(page, 'Por proyecto').getByText(/Esperando para resumir/).waitFor();
    const found = await page.evaluate(() => {
      const fixture = document.getElementById('fixture'), hub = document.querySelector('.oh'), body = document.querySelector('.oh-body');
      return { page: document.documentElement.scrollWidth - window.innerWidth, fixture: fixture.scrollWidth - fixture.clientWidth, hub: hub.scrollWidth - hub.clientWidth, body: body.scrollWidth - body.clientWidth };
    });
    measurements.push({ width, overflow: Math.max(found.page, found.fixture, found.hub, found.body, 0) });
    assert.ok(found.page <= 0 && found.fixture <= 1 && found.hub <= 1 && found.body <= 1, `${width}px: overflow horizontal ${JSON.stringify(found)}`);
    const box = page.getByRole('textbox', { name: /^Mensaje para el orquestador/ });
    assert.ok(await box.isVisible(), `${width}px: composer visible`);
    await box.fill(`Borrador a ${width}px`);
    assert.equal(await box.inputValue(), `Borrador a ${width}px`, `${width}px: borrador conservado`);
    await page.screenshot({ path: `${artifacts}/orchestrator-hub-${width}.png` });
    await close(page);
  }
  results.push(`Sin desborde horizontal a 320 y 1600 px, composer siempre visible y borrador conservado; capturas en ${artifacts}/.`);
});

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!await check()) {
    if (Date.now() > end) throw new Error('Condición no cumplida a tiempo');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
