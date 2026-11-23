import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { catalog } from '../src/stories/catalog.mjs';
import { assertFormGeometry, assertVisibleFocus, assertActionsReachable } from './ui-refinement.mjs';

const root = resolve('storybook-static');
const index = JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8'));
const stories = Object.values(index.entries).filter((entry) => entry.type === 'story');
assert.ok(stories.length, 'El build no contiene stories');
assert.equal(stories.length, 101, 'Conservar las 101 stories (99 previas, Procesos y Servicios se unieron en Entorno, más 2 de herramientas frecuentes)');
assert.equal(catalog.length, 64, 'Conservar las 64 fuentes del catálogo');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.gif': 'image/gif' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Ruta inválida');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('No encontrado');
  }
});
let browser;
let timeout;
try {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
  const failures = [];
  const externalRequests = [];
  await mkdir('.test-artifacts', { recursive: true });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base || url.pathname.startsWith('/api/')) { externalRequests.push(url.href); return route.abort(); }
    return route.continue();
  });
  await Promise.race([(async () => {
  for (const story of stories) {
    errors.length = 0;
    try {
    await page.goto(`${base}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, { waitUntil: 'load' });
    await page.waitForSelector('#storybook-root > *', { state: 'attached', timeout: 15_000 });
    await page.waitForFunction(() => document.body.classList.contains('sb-show-main'), null, { timeout: 15_000 });
    await page.waitForFunction(id => document.documentElement.dataset.catalogRendered === id, story.id, { timeout: 15_000 });
    await page.waitForTimeout(120);
    assert.ok(await page.locator('#storybook-root button, #storybook-root input, #storybook-root svg, #storybook-root canvas, #storybook-root p, #storybook-root h1, #storybook-root table, #storybook-root summary, [role="dialog"]').count(), `${story.id}: sin render de contenido`);
    for (const entry of catalog.filter(entry => entry.story === story.id)) await page.locator(entry.selector).first().waitFor({ state: 'visible', timeout: 2000 });
    assert.equal(await page.locator('#storybook-error-message').isVisible(), false, `${story.id}: error de render`);
    assert.deepEqual(await page.evaluate(() => window.__storybookHost?.unknown), [], `${story.id}: llamadas sin fixture`);
    assert.deepEqual(errors, [], `${story.id}: errores de página`);
    await page.screenshot({ path: `.test-artifacts/${story.id}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.screenshot({ path: `.test-artifacts/${story.id}-compacto.png` });
    assert.deepEqual(errors, [], `${story.id}: errores en compacto`);
    console.log(`PASS ${story.id}`);
    } catch (error) {
      failures.push(`${story.id}: ${error.message}\n${errors.join('\n')}\n${(await page.locator('body').innerText()).slice(0, 1600)}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  assert.equal(failures.length, 0, failures.join('\n\n'));
  const action = stories.find((entry) => entry.exportName === 'Accion');
  assert.ok(action, 'Falta la story de interacción');
  await page.goto(`${base}/iframe.html?id=${encodeURIComponent(action.id)}&viewMode=story`);
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await page.getByText('Intentos: 1').waitFor();
  const visit = async id => {
    await page.goto(`${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`);
    await page.waitForFunction(id => document.documentElement.dataset.catalogRendered === id, id);
  };
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const id of ['ajustes--configuracion', 'ajustes--git', 'ajustes--voz', 'ajustes--conexiones', 'phantom--nueva-card', 'phantom--nueva-skill']) {
      await visit(id);
      if (id === 'ajustes--configuracion' && await page.locator('.st-pane').isHidden()) await page.getByRole('button', { name: 'Agentes', exact: true }).click();
      for (const details of await page.locator('.st-details, .pc-advanced').all()) await details.evaluate(el => { el.open = true; });
      const context = `${id}/${width}`;
      await assertFormGeometry(page, context);
      const input = page.locator('.st-input:not([type=number]), .pc-form input, .pc-form textarea').filter({ visible: true }).first();
      await assertVisibleFocus(page, input, context);
      if (id.startsWith('ajustes')) await input.fill('Borrador visual');
      await assertActionsReachable(page, page.locator(id.startsWith('ajustes') ? '.st-save' : '.pc-form-actions').first(), context);
      await page.screenshot({ path: `.test-artifacts/smoke-form-${id}-${width}-actions.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit('catálogo--inventario');
  assert.equal(await page.locator('.catalog-stage').evaluate(el => getComputedStyle(el).fontSize), '14px');
  assert.equal(await page.locator('.catalog-page h1').evaluate(el => getComputedStyle(el).fontSize), '24px');
  assert.equal(await page.locator('.catalog-table tr').nth(1).evaluate(el => getComputedStyle(el).display), 'table-row');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await visit('catálogo--inventario');
    assert.equal(await page.locator('.catalog-page h1').evaluate(el => getComputedStyle(el).fontSize), '24px');
    const cells = await page.locator('.catalog-table tbody tr').first().locator('td').evaluateAll(els => els.map(el => ({ width: el.getBoundingClientRect().width, display: getComputedStyle(el).display, label: getComputedStyle(el, '::before').content, fontSize: parseFloat(getComputedStyle(el).fontSize) })));
    assert.equal(cells.length, 3);
    for (const cell of cells) { assert.equal(cell.display, 'block'); assert.ok(cell.width >= width - 60); assert.ok(cell.fontSize >= 12); assert.notEqual(cell.label, 'none'); }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px: overflow horizontal`);
    const search = page.getByRole('searchbox', { name: 'Buscar fuente, símbolo o escenario' });
    await search.fill('EmptyState.jsx');
    assert.equal(await page.locator('.catalog-table tbody tr').count(), 1);
    const family = page.getByLabel('Familia');
    const selectedFamily = await page.locator('.catalog-table tbody tr td').first().locator('p').innerText();
    await family.selectOption({ label: selectedFamily });
    assert.equal(await page.locator('.catalog-table tbody tr').count(), 1);
    const otherFamily = await family.locator('option').evaluateAll((options, selected) => options.find(option => option.value && option.value !== selected)?.value, selectedFamily);
    assert.ok(otherFamily);
    await family.selectOption(otherFamily);
    assert.equal(await page.locator('.catalog-table tbody tr').count(), 0);
    await family.selectOption('');
    await search.fill('');
    await page.screenshot({ path: `.test-artifacts/catalogo-inventario-${width}.png` });
    await page.locator('.catalog-stage').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await page.getByRole('heading', { name: 'Propuestas pendientes de aprobación' }).isVisible());
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit('herramientas--centro-de-mando');
  await page.locator('.cc-task').first().click();
  await page.getByRole('heading', { name: 'Objetivo', exact: true }).waitFor();
  await page.getByLabel('Buscar tareas').fill('no existe');
  await page.getByText('No hay tareas que coincidan con estos filtros.').waitFor();
  await page.getByLabel('Buscar tareas').fill('');
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await page.getByRole('button', { name: 'Reanudar', exact: true }).waitFor();
  await visit('primitivas--controles');
  const toggle = page.getByRole('switch', { name: 'Activar ejemplo' });
  await toggle.focus();
  await page.keyboard.press('Space');
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await visit('navegación--lienzo');
  const note = page.getByRole('textbox', { name: 'Nota: Contexto del catálogo' });
  await note.fill('Nota editada desde el smoke');
  assert.equal(await note.inputValue(), 'Nota editada desde el smoke');
  await visit('voz--dictado');
  await page.getByRole('button', { name: 'Grabar dictado' }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(() => window.__storybookHost.calls.some(c => c.method.startsWith('voice.stream'))), false, 'No se debe iniciar audio nativo');
  await visit('conversaciones--chat');
  await page.locator('.pc-composer textarea').fill('Borrador que no debe filtrarse');
  await page.evaluate(() => {
    window.__oldHost = window.__storybookHost;
    window.__oldHost.model.settings.syntheticMutation = true;
    window.__STORYBOOK_ADDONS_CHANNEL__.emit('setCurrentStory', { storyId: 'primitivas--panel' });
  });
  await page.waitForFunction(() => document.documentElement.dataset.catalogRendered === 'primitivas--panel');
  assert.deepEqual(await page.evaluate(() => ({ disposed: window.__oldHost.disposed, listeners: window.__oldHost.subscriptions, same: window.__oldHost === window.__storybookHost, mutation: Boolean(window.__storybookHost.model.settings.syntheticMutation) })), { disposed: true, listeners: 0, same: false, mutation: false });
  await page.evaluate(() => window.__STORYBOOK_ADDONS_CHANNEL__.emit('setCurrentStory', { storyId: 'conversaciones--chat' }));
  await page.waitForFunction(() => document.documentElement.dataset.catalogRendered === 'conversaciones--chat');
  assert.equal(await page.locator('.pc-composer textarea').inputValue(), '', 'El borrador de voz/chat se aísla por montaje');
  const blocked = await page.evaluate(async () => {
    try { await window.__storybookHost.invoke('unregistered.method'); return false; }
    catch (error) { return error.message.includes('desconocido'); }
  });
  assert.equal(blocked, true, 'El host debe rechazar métodos no registrados');
  assert.equal(await page.evaluate(async () => { try { await fetch('https://example.invalid/host'); return false; } catch (error) { return error.message.includes('aislada'); } }), true, 'Fetch externo bloqueado antes de red');
  await visit('catálogo--inventario');
  await page.getByRole('searchbox', { name: 'Buscar fuente, símbolo o escenario' }).fill('EmptyState.jsx');
  await page.getByRole('link', { name: 'Panel · principal', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('path') === '/story/primitivas--panel');
  await page.frameLocator('#storybook-preview-iframe').locator('.empty-state').waitFor();
  assert.deepEqual(externalRequests, [], 'Las stories no deben intentar acceder a servicios externos');
  await mkdir('.test-artifacts', { recursive: true });
  await page.screenshot({ path: '.test-artifacts/storybook-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.test-artifacts/storybook-compacto.png' });
  assert.deepEqual(errors, [], 'Errores de página');
  console.log(`${stories.length} stories comprobadas`);
  })(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('El smoke excedió el tiempo límite')), 240_000); })]);
} finally {
  clearTimeout(timeout);
  let cleanupTimeout;
  try {
    await Promise.race([(async () => {
      await browser?.close();
      if (server.listening) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
    })(), new Promise((_, reject) => { cleanupTimeout = setTimeout(() => { server.closeAllConnections(); reject(new Error('Timeout al cerrar el smoke')); }, 10_000); })]);
  } finally { clearTimeout(cleanupTimeout); }
}
