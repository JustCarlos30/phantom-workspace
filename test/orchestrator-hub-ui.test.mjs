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
  await page.addStyleTag({ content: 'body.app-shell { margin: 0; min-width: 0; display: block; } #fixture { height: 860px; max-width: 100%; position: relative; container-type: inline-size; overflow: hidden; } #fixture .oh-surface { position: absolute; inset: 0; }' });
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
  assert.match(broken, /feat\/landing[\s\S]*Incorporación/);
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
  const [limit, attention] = await page.evaluate(() => {
    const state = [...document.querySelectorAll('.oh-sup-state')].find(el => el.textContent === 'Límite por hora alcanzado');
    const probe = document.createElement('i'); probe.style.color = 'var(--attention)'; document.body.append(probe);
    const out = [getComputedStyle(state).color, getComputedStyle(probe).color]; probe.remove(); return out;
  });
  assert.notEqual(limit, attention, 'el límite por hora no usa el color de atención');
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
    await until(async () => await page.getByRole('button', { name: /^Enviar al orquestador/ }).isEnabled());
    await page.screenshot({ path: `${artifacts}/orchestrator-hub-${width}.png` });
    await close(page);
  }
  results.push(`Sin desborde horizontal a 320 y 1600 px, composer siempre visible y borrador conservado; capturas en ${artifacts}/.`);
});

// Resolves a design token to the computed value of a property, so assertions compare real rendered styles.
const resolve = (page, token, property = 'color') => page.evaluate(([token, property]) => {
  const probe = document.createElement('i'); probe.style[property] = `var(${token})`; document.body.append(probe);
  const value = getComputedStyle(probe)[property]; probe.remove(); return value;
}, [token, property]);

test('filas planas en reposo con disco de 32 px y glifo en el tono del estado', async () => {
  const page = await render({ width: 900 });
  const rows = page.locator('.oh-row');
  assert.ok(await rows.count() >= 3);
  const transparent = 'rgba(0, 0, 0, 0)';
  for (const state of await rows.evaluateAll(list => list.map(row => { const style = getComputedStyle(row); return { background: style.backgroundColor, padding: style.paddingLeft, shadow: style.boxShadow, border: style.borderTopWidth }; })))
    assert.deepEqual(state, { background: transparent, padding: '0px', shadow: 'none', border: '0px' }, 'fila plana sin caja en reposo');
  assert.equal(await page.locator('.oh-fine-item').first().evaluate(el => getComputedStyle(el).backgroundColor), transparent, 'proyecto plano');
  const fill2 = await resolve(page, '--fill-2', 'backgroundColor');
  for (const [tone, token] of [['danger', '--danger'], ['attention', '--attention']]) {
    const disc = page.locator(`.oh-row[data-tone="${tone}"] .oh-disc`).first();
    const box = await disc.boundingBox();
    assert.deepEqual([Math.round(box.width), Math.round(box.height)], [32, 32]);
    assert.equal(await disc.evaluate(el => getComputedStyle(el).backgroundColor), fill2);
    assert.equal(await disc.evaluate(el => getComputedStyle(el).color), await resolve(page, token), `glifo en ${token}`);
    const svg = disc.locator('svg');
    assert.equal(await svg.getAttribute('width'), '18');
    assert.equal(await svg.getAttribute('stroke-width'), '1.75');
  }
  assert.equal(await page.locator('.oh-kind').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'sin píldora de tipo');
  await close(page);
  results.push('Filas planas sin relleno, borde ni sombra en reposo; disco de 32 px en --fill-2 con glifo Lucide de 18 px (trazo 1,75) en rojo/ámbar según el estado; sin píldora de tipo.');
});

test('una sola acción primaria marfil y encabezados de grupo sin color de estado', async () => {
  const page = await render({ width: 900 });
  const actions = await page.locator('.oh-action').evaluateAll(list => list.map(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, height: el.getBoundingClientRect().height, shadow: getComputedStyle(el).boxShadow, border: getComputedStyle(el).borderTopWidth })));
  const primary = await resolve(page, '--primary', 'backgroundColor'), secondary = await resolve(page, '--control-fill', 'backgroundColor');
  assert.equal(actions.filter(action => action.background === primary).length, 1, 'exactamente una primaria');
  assert.equal(actions[0].background, primary, 'la primera acción del grupo más urgente es la primaria');
  assert.equal(actions[0].color, await resolve(page, '--primary-ink'));
  for (const action of actions.slice(1)) assert.equal(action.background, secondary);
  for (const action of actions) { assert.ok(action.height >= 40, 'objetivo mínimo de 40 px'); assert.equal(action.shadow, 'none'); assert.equal(action.border, '0px'); }
  const [danger, attention, ink3] = await Promise.all(['--danger', '--attention', '--ink-3'].map(token => resolve(page, token)));
  const titles = await page.locator('.oh-group-title').evaluateAll(list => list.map(el => getComputedStyle(el).color));
  assert.equal(titles.length, 3);
  for (const color of titles) { assert.equal(color, ink3); assert.notEqual(color, danger); assert.notEqual(color, attention); }
  assert.ok(await page.getByRole('heading', { name: /^Se rompió/ }).isVisible());
  await close(page);
  results.push('Una única acción primaria marfil (primera del grupo más urgente), el resto en --control-fill, todas ≥ 40 px sin sombra ni borde; encabezados de grupo en --ink-3, sin rojo ni ámbar.');
});

test('compositor: isla de 720 px centrada, Enviar marfil con borrador y campo de al menos 40 px', async () => {
  const page = await render({ width: 1600 });
  const field = page.locator('.oh-field'), box = page.getByRole('textbox', { name: /^Mensaje para el orquestador/ });
  const send = page.getByRole('button', { name: /^Enviar al orquestador/ });
  const primary = await resolve(page, '--primary', 'backgroundColor');
  assert.notEqual(await send.evaluate(el => getComputedStyle(el).backgroundColor), primary, 'sin borrador Enviar no es marfil');
  assert.equal(await field.evaluate(el => getComputedStyle(el).backgroundColor), await resolve(page, '--composer-fill', 'backgroundColor'), 'reposo');
  await box.fill('Revisa la rama de pagos');
  await until(async () => await send.isEnabled());
  await until(async () => await send.evaluate(el => getComputedStyle(el).backgroundColor) === primary, 2000).catch(() => {});
  assert.equal(await send.evaluate(el => getComputedStyle(el).backgroundColor), primary, 'con borrador Enviar es marfil');
  const geometry = await page.evaluate(() => {
    const field = document.querySelector('.oh-field').getBoundingClientRect(), surface = document.querySelector('.oh-surface').getBoundingClientRect();
    return { width: field.width, left: field.left - surface.left, right: surface.right - field.right };
  });
  assert.equal(await field.evaluate(el => getComputedStyle(el).maxWidth), '720px');
  assert.ok(geometry.width <= 720 && geometry.width > 700, `isla de 720 px (${geometry.width})`);
  assert.ok(Math.abs(geometry.left - geometry.right) <= 1, 'isla centrada');
  assert.ok(await box.evaluate(el => el.getBoundingClientRect().height) >= 40, 'campo mínimo de 40 px');
  await box.focus();
  assert.equal(await field.evaluate(el => getComputedStyle(el).backgroundColor), await resolve(page, '--composer-fill-lit', 'backgroundColor'), 'foco «luz»');
  assert.equal(await field.evaluate(el => getComputedStyle(el, '::after').transitionDuration), '0s', 'sin transición con movimiento reducido');
  const sizes = await page.locator('.oh-controls button').evaluateAll(list => list.map(el => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]));
  assert.ok(sizes.length >= 2);
  for (const [width, height] of sizes) assert.deepEqual([Math.round(width), Math.round(height)], [36, 36]);
  assert.equal(await page.getByRole('combobox', { name: 'Proyecto destino' }).evaluate(el => el.tagName), 'SELECT');
  assert.ok(await field.locator('.oh-target').count() === 1, 'el selector «Para» está dentro de la isla');
  await close(page);
  results.push('Compositor: isla de máx. 720 px centrada con --composer-fill y foco «luz», campo ≥ 40 px, controles circulares de 36 px, selector «Para» nativo dentro de la isla y Enviar marfil solo con borrador.');
});

const thread = (page, project = 'Alfa') => region(page, new RegExp(`^Conversación con el orquestador de ${project}`));

test('el hilo del orquestador del proyecto destino muestra su respuesta, es colapsable y conserva la última lectura sin conexión', async () => {
  const page = await render({ width: 900 });
  const box = thread(page);
  await box.getByText(/La rama choca con main en el esquema de facturas/).waitFor();
  assert.match(await box.innerText(), /Revisa por qué se bloqueó la migración/);
  const toggle = box.getByRole('button', { name: /^Conversación/ });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'abierto por defecto con mensajes');
  assert.match(await toggle.innerText(), /2 mensajes/);
  assert.equal(await page.locator('.oh-thread .pc-thread').evaluate(el => getComputedStyle(el).backgroundColor), await resolve(page, '--well-terminal', 'backgroundColor'), 'pozo opaco');
  assert.equal(await page.locator('.oh-thread .pc-column').evaluate(el => getComputedStyle(el).maxWidth), '720px', 'columna de 720 px');
  await page.evaluate(() => window.hub.connect(false));
  await page.getByText(/Sin conexión con el host/).first().waitFor();
  assert.match(await thread(page).innerText(), /La rama choca con main/, 'se conserva la última lectura');
  await page.evaluate(() => window.hub.connect(true));
  await until(async () => await page.getByRole('textbox', { name: /^Mensaje para el orquestador/ }).isEnabled());
  await thread(page).getByRole('button', { name: /^Conversación/ }).click();
  assert.equal(await thread(page).getByRole('button', { name: /^Conversación/ }).getAttribute('aria-expanded'), 'false');
  assert.equal(await thread(page).getByRole('log').count(), 0, 'colapsado oculta los mensajes');
  await page.screenshot({ path: `${artifacts}/orchestrator-hub-thread-900.png` });
  await close(page);
  results.push('Hilo con la respuesta del orquestador de Alfa sobre pozo opaco y columna de 720 px, botón colapsable con aria-expanded y contador, y última lectura conservada sin conexión.');
});

test('enviar con un orquestador de chat usa chat.send al nodo y el mensaje aparece en el hilo', async () => {
  const page = await render({ width: 900 });
  await thread(page).getByText(/La rama choca/).waitFor();
  const box = page.getByRole('textbox', { name: /^Mensaje para el orquestador/ });
  await box.fill('Resuelve primero el conflicto de facturas');
  await box.press('Enter');
  await until(async () => (await box.inputValue()) === '');
  await thread(page).getByText('Resuelve primero el conflicto de facturas', { exact: true }).waitFor();
  await thread(page).getByText(/Recibido: Resuelve primero/).waitFor();
  const calls = await page.evaluate(() => window.hub.calls.filter(call => /send$/.test(call.method)));
  assert.deepEqual(calls.map(call => [call.method, call.payload]), [['chat.send', { workspaceId: 'hub-alfa', nodeId: 'n-alfa-orch', text: 'Resuelve primero el conflicto de facturas' }]]);
  await close(page);
  results.push('Con nodo de chat, el compositor envía con chat.send { workspaceId, nodeId, text } (sin orchestrator.send) y el mensaje y la respuesta aparecen en el hilo.');
});

test('un permiso pendiente del orquestador se responde desde el hub', async () => {
  const page = await render({ width: 900 });
  const box = thread(page);
  await box.getByRole('group', { name: /write pide permiso/ }).waitFor();
  await box.getByRole('button', { name: 'Aprobar' }).click();
  await until(async () => (await box.getByRole('button', { name: 'Aprobar' }).count()) === 0);
  await box.getByText('Aprobado').waitFor();
  const answers = await page.evaluate(() => window.hub.calls.filter(call => call.method === 'chat.permission.answer').map(call => call.payload));
  assert.deepEqual(answers, [{ workspaceId: 'hub-alfa', nodeId: 'n-alfa-orch', requestId: 'hub-perm', decision: 'allow' }]);
  await close(page);
  results.push('Permiso pendiente en el hilo con Rechazar/Siempre/Aprobar; Aprobar llama chat.permission.answer al nodo y la fila pasa a «Aprobado».');
});

test('cambiar de destino cambia de hilo: terminal con «Abrir sesión», sin orquestador con estado vacío, y el borrador sigue', async () => {
  const page = await render({ width: 900 });
  const draft = page.getByRole('textbox', { name: /^Mensaje para el orquestador/ });
  await draft.fill('Borrador entre proyectos');
  await page.evaluate(() => window.hub.select('hub-beta'));
  await page.getByText('El orquestador de Beta · web corre como terminal').waitFor();
  assert.equal(await thread(page).count(), 0, 'sin hilo de chat para un PTY');
  await page.getByRole('button', { name: 'Abrir sesión' }).click();
  assert.deepEqual(await page.evaluate(() => window.hub.selections.at(-1)), { workspaceId: 'hub-beta', focus: { nodeId: 'n-beta-orch' } });
  await page.evaluate(() => window.hub.select('hub-gamma'));
  await page.getByText('Aún no hay orquestador en Gamma · docs. Tu primer mensaje lo crea.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Abrir sesión' }).count(), 0);
  assert.equal(await draft.inputValue(), 'Borrador entre proyectos');
  await page.evaluate(() => window.hub.select('hub-alfa'));
  await thread(page).getByText(/La rama choca/).waitFor();
  assert.equal(await draft.inputValue(), 'Borrador entre proyectos');
  await close(page);
  results.push('Destino Beta: línea «corre como terminal» con «Abrir sesión» (onSelectWorkspace con nodeId); Gamma: «Aún no hay orquestador… Tu primer mensaje lo crea.»; volver a Alfa recupera el hilo y el borrador nunca se pierde.');
});

test('con el hilo abierto no hay desborde horizontal a 320 px y la lista y el compositor siguen a la vista', async () => {
  const page = await render({ width: 320 });
  await thread(page).getByText(/La rama choca/).waitFor();
  const found = await page.evaluate(() => {
    const size = selector => { const el = document.querySelector(selector); return { over: el.scrollWidth - el.clientWidth, height: el.getBoundingClientRect().height }; };
    return { page: document.documentElement.scrollWidth - window.innerWidth, thread: size('.oh-thread'), column: size('.oh-thread .pc-column'), body: size('.oh-body'), hub: size('.oh') };
  });
  measurements.push({ width: '320 con hilo', overflow: Math.max(found.page, found.thread.over, found.column.over, found.body.over, found.hub.over, 0) });
  assert.ok(found.page <= 0 && found.thread.over <= 1 && found.column.over <= 1 && found.body.over <= 1 && found.hub.over <= 1, `overflow ${JSON.stringify(found)}`);
  assert.ok(found.thread.height <= 161, `el hilo limita su alto (${found.thread.height})`);
  assert.ok(found.body.height >= 200, `la lista conserva espacio (${found.body.height})`);
  assert.ok(await page.getByRole('textbox', { name: /^Mensaje para el orquestador/ }).isVisible());
  await page.screenshot({ path: `${artifacts}/orchestrator-hub-thread-320.png` });
  await close(page);
  results.push('A 320 px con el hilo abierto: sin desborde horizontal, hilo limitado a 160 px, lista con espacio propio y compositor visible.');
});

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!await check()) {
    if (Date.now() > end) throw new Error('Condición no cumplida a tiempo');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
