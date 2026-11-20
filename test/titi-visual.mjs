import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, sep, extname, join } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const root = resolve('storybook-static');
const evidence = '/tmp/phantom-titi-evidence';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.gif': 'image/gif' };
const MOODS = ['calm', 'working', 'grin', 'unsure', 'asleep'];
const results = { status: 'incompleto', checks: [], pageErrors: [], externalRequests: [] };
const record = (name, data = {}) => results.checks.push({ name, ...data });

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
let failure;
try {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => results.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) results.pageErrors.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base || url.pathname.startsWith('/api/')) { results.externalRequests.push(url.href); return route.abort(); }
    return route.continue();
  });

  await page.goto(`${base}/iframe.html?id=identidad--titi&viewMode=story`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.catalogRendered === 'identidad--titi');
  await page.waitForFunction(() => document.querySelector('canvas[data-mood-sample="calm"]')?.dataset.motion === 'running');

  // Lee los píxeles reales del canvas: hash del buffer RGBA y cantidad de píxeles con alfa > 0.
  const probe = selector => page.locator(selector).evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let hash = 2166136261, lit = 0;
    for (let i = 0; i < data.length; i += 1) { hash = Math.imul(hash ^ data[i], 16777619); if (i % 4 === 3 && data[i] > 0) lit += 1; }
    const box = canvas.getBoundingClientRect();
    return { hash: hash >>> 0, lit, motion: canvas.dataset.motion, ariaHidden: canvas.getAttribute('aria-hidden'), bufferWidth: canvas.width, bufferHeight: canvas.height, cssWidth: box.width, cssHeight: box.height };
  });
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const moodSel = mood => `canvas[data-mood-sample="${mood}"]`;
  // Tras cambiar motion, media, concentración o clases, el atributo puede publicarse antes que el dibujo: esperar píxeles.
  const waitLit = selector => page.waitForFunction(sel => {
    const canvas = document.querySelector(sel);
    if (!canvas) return false;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit += 1;
    return lit >= 40;
  }, selector);
  const stage = '[data-story="identidad--titi"]';

  // 1. Cinco moods: píxeles visibles, canvas HiDPI aria-hidden y estados distintos.
  const moodProbes = {};
  for (const mood of MOODS) {
    const p = await probe(moodSel(mood));
    moodProbes[mood] = p;
    assert.ok(p.lit >= 40, `${mood}: canvas vacío (lit=${p.lit})`);
    assert.equal(p.ariaHidden, 'true', `${mood}: debe ser aria-hidden`);
    assert.equal(p.bufferWidth, Math.round(44 * dpr), `${mood}: buffer HiDPI`);
    assert.equal(p.cssWidth, 32, `${mood}: tamaño CSS 32px`);
    record(`mood-${mood}`, p);
  }
  assert.equal(new Set(MOODS.map(m => moodProbes[m].hash)).size, MOODS.length, 'Los cinco moods deben dibujar estados distintos');
  await page.locator('[data-titi-shell] .catalog-grid').screenshot({ path: join(evidence, 'moods-running.png') });

  // 2. Con movimiento habilitado el rAF cambia píxeles.
  const before = (await probe(moodSel('calm'))).hash;
  let after = before;
  for (let waited = 0; waited < 4000 && after === before; waited += 200) {
    await page.waitForTimeout(200);
    after = (await probe(moodSel('calm'))).hash;
  }
  const afterProbe = await probe(moodSel('calm'));
  assert.equal(afterProbe.motion, 'running');
  assert.notEqual(after, before, 'Con movimiento el canvas debe cambiar de píxeles en 4 s');
  record('motion-running-changes-pixels', { before, after });

  // 3. Movimiento reducido: se detiene y los píxeles se mantienen.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('canvas[data-mood-sample="calm"]')?.dataset.motion === 'stopped');
  for (const mood of MOODS) {
    await waitLit(moodSel(mood));
    const h1 = await probe(moodSel(mood));
    await page.waitForTimeout(800);
    const h2 = await probe(moodSel(mood));
    assert.equal(h2.motion, 'stopped', `${mood}: debe quedar parado con reduced motion`);
    assert.equal(h2.hash, h1.hash, `${mood}: reduced motion no debe cambiar píxeles`);
    assert.ok(h2.lit >= 40, `${mood}: canvas estático vacío`);
    record(`reduced-motion-${mood}`, { hash: h2.hash, lit: h2.lit });
  }
  await page.locator('[data-titi-shell] .catalog-grid').screenshot({ path: join(evidence, 'moods-reduced-motion.png') });

  // 4. Cambios de mood estando parado: cada mood nuevo debe dibujar un estado distinto.
  const harness = 'canvas.titi-live';
  const seen = [(await probe(harness)).hash];
  for (const label of ['Trabajando', 'Necesita', 'Falló', 'Dormido']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(200);
    await waitLit(harness);
    const p = await probe(harness);
    assert.equal(p.motion, 'stopped', `cambio a ${label}: debe seguir parado`);
    assert.ok(p.lit >= 40, `cambio a ${label}: canvas vacío`);
    assert.ok(!seen.includes(p.hash), `cambio a ${label}: el canvas no representa un estado nuevo`);
    seen.push(p.hash);
    record(`mood-change-${label}`, { hash: p.hash, lit: p.lit });
    await page.locator('[data-titi-live]').screenshot({ path: join(evidence, `harness-${label.toLowerCase()}.png`) });
  }

  // 5. Concentración detiene el movimiento aunque reduced motion esté apagado.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.querySelector('canvas[data-mood-sample="calm"]')?.dataset.motion === 'running');
  await page.evaluate(stageSel => document.querySelector(stageSel).classList.add('studio-concentration'), stage);
  await page.waitForFunction(() => document.querySelector('canvas[data-mood-sample="calm"]')?.dataset.motion === 'stopped');
  await waitLit(moodSel('calm'));
  const c1 = await probe(moodSel('calm'));
  await page.waitForTimeout(800);
  const c2 = await probe(moodSel('calm'));
  assert.equal(c2.hash, c1.hash, 'Concentración debe mantener píxeles estáticos');
  record('concentration-stops', { hash: c2.hash, lit: c2.lit });
  await page.evaluate(stageSel => document.querySelector(stageSel).classList.remove('studio-concentration'), stage);
  await page.waitForFunction(() => document.querySelector('canvas[data-mood-sample="calm"]')?.dataset.motion === 'running');
  await waitLit(moodSel('calm'));

  // 6. Marca, notch y chat con contenedores reales, con studio-character apagado, encendido y apagado de nuevo.
  assert.equal(await page.locator('.gengar-mascot, .studio-character').count(), 0, 'No debe haber studio-character al inicio de la historia');
  const slots = [['marca', '.brand-mark', 32], ['notch', '.activity-notch', 28], ['chat', '.phantom-chat-toggle', 28]];
  const checkSlots = async label => {
    for (const [slot, container, size] of slots) {
      const sel = `[data-titi-slot="${slot}"] ${container} canvas.titi-ghost:not(.brand-state-fallback)`;
      await waitLit(sel);
      assert.ok(await page.locator(sel).isVisible(), `${label} ${slot}: visible`);
      const p = await probe(sel);
      assert.ok(p.lit >= 40, `${label} ${slot}: canvas vacío (lit=${p.lit})`);
      assert.equal(p.cssWidth, size, `${label} ${slot}: ancho ${size}px`);
      assert.equal(p.cssHeight, size, `${label} ${slot}: alto ${size}px`);
      const fallbackHidden = await page.locator(`[data-titi-slot="${slot}"] ${container} .brand-state-fallback, [data-titi-slot="${slot}"] ${container} .notch-state-fallback`).evaluateAll(els => els.every(el => getComputedStyle(el).display === 'none'));
      assert.ok(fallbackHidden, `${label} ${slot}: fallback debe estar oculto`);
      record(`slot-${label}-${slot}`, { ...p, fallbackHidden });
    }
  };
  await checkSlots('off');
  await page.locator(stage).evaluate(el => el.classList.add('studio-character'));
  await checkSlots('on');
  await page.locator(stage).evaluate(el => el.classList.remove('studio-character'));
  await checkSlots('off-again');
  await page.locator('[data-titi-shell] .catalog-grid').screenshot({ path: join(evidence, 'marca-notch-chat.png') });

  assert.deepEqual(results.pageErrors, [], 'Errores de página o consola');
  assert.deepEqual(results.externalRequests, [], 'La historia no debe pedir servicios externos');
  results.status = 'pass';
  console.log(`Titi visual: ${results.checks.length} comprobaciones`);
} catch (error) {
  failure = error;
  results.status = 'fail';
  results.failure = error.message;
} finally {
  await writeFile(join(evidence, 'titi-visual.json'), JSON.stringify(results, null, 2));
  try {
    await browser?.close();
  } finally {
    if (server.listening) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
  }
}
if (failure) { console.error(failure); process.exitCode = 1; }
