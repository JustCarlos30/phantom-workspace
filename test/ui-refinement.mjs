import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const fields = '.st-input, .st-select, .pc-root .tw-field > input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), .pc-root .tw-field > textarea, .pc-root .tw-field > select, .sk-root .tw-field > input, .sk-root .tw-field > textarea, .sk-root .tw-field > select';
const searches = '.pc-search input, .sk-search input, .pc-select select';

export async function assertFormGeometry(page, context) {
  const report = await page.locator(`${fields}, ${searches}`).evaluateAll(elements => elements.filter(el => el.checkVisibility()).map(el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const search = el.closest('.pc-search, .sk-search, .pc-select');
    const box = search || el, b = box.getBoundingClientRect(), bs = getComputedStyle(box);
    const clips = [];
    for (let p = box.parentElement; p; p = p.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) {
        const pr = p.getBoundingClientRect();
        if (b.left < pr.left - 1 || b.right > pr.right + 1) clips.push(p.className);
      }
    }
    const label = el.getAttribute('aria-label') || [...(el.labels || [])].map(l => l.textContent.trim()).join(' ');
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'); ctx.font = getComputedStyle(el, '::placeholder').font;
    return { label, tag: el.tagName, type: el.type, settings: Boolean(el.closest('.st')), search: Boolean(search), width: b.width, height: b.height, left: b.left, right: b.right, clips,
      background: bs.backgroundColor, borderWidth: bs.borderTopWidth, borderColor: bs.borderTopColor, radius: bs.borderRadius,
      padding: bs.padding, fontSize: s.fontSize, align: s.textAlign, shadow: bs.boxShadow,
      innerBackground: s.backgroundColor, innerBorder: s.borderTopWidth,
      placeholderFits: !el.placeholder || el.tagName === 'TEXTAREA' || ctx.measureText(el.placeholder).width + (el.type === 'search' ? 16 : 0) <= el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) + 1,
      placeholderWidth: ctx.measureText(el.placeholder || '').width, contentWidth: el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
      described: (el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean).every(id => Boolean(document.getElementById(id))),
    };
  }));
  assert.ok(report.length, `${context}: faltan campos visibles`);
  const viewport = page.viewportSize();
  for (const control of report) {
    const name = `${context}: ${control.label || control.tag}`;
    assert.ok(control.label, `${name}: sin etiqueta accesible`);
    assert.ok(control.described, `${name}: ayuda ARIA inexistente`);
    assert.deepEqual(control.clips, [], `${name}: recorte horizontal`);
    assert.ok(control.left >= 0 && control.right <= viewport.width + 1, `${name}: fuera del viewport`);
    assert.ok(control.width >= 70 && control.height >= 38, `${name}: tamaño insuficiente ${control.width}×${control.height}`);
    assert.equal(control.background, control.settings ? 'rgba(255, 255, 255, 0.08)' : 'rgb(17, 17, 19)', `${name}: superficie`);
    assert.equal(control.borderWidth, control.settings ? '0px' : '1px', `${name}: borde`);
    assert.equal(control.radius, '12px', `${name}: radio`);
    assert.equal(control.shadow, 'none', `${name}: relieve decorativo`);
    assert.ok(['12px', '14px'].includes(control.fontSize), `${name}: tipo`);
    assert.ok(['left', 'start', ...(control.type === 'number' ? ['right'] : [])].includes(control.align), `${name}: alineación`);
    assert.ok(control.placeholderFits, `${name}: placeholder truncado (${control.placeholderWidth} > ${control.contentWidth})`);
    if (control.search) { assert.equal(control.innerBackground, 'rgba(0, 0, 0, 0)', `${name}: doble fondo`); assert.equal(control.innerBorder, '0px'); }
  }
  const overflow = await page.locator('.st-pane, .pc-side, .sk-detail, .pc-form, .pc-head, .sk-toolbar').evaluateAll(els => els.filter(el => el.checkVisibility()).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className));
  assert.deepEqual(overflow, [], `${context}: overflow horizontal en formularios`);
  const rhythm = await page.locator('.pc-form .tw-field').evaluateAll(els => els.filter(el => el.checkVisibility()).map(el => ({ gap: getComputedStyle(el).gap, width: el.getBoundingClientRect().width })));
  for (const field of rhythm) { assert.equal(field.gap, '8px', `${context}: ritmo label/campo/ayuda`); assert.ok(field.width <= 641, `${context}: columna de lectura demasiado ancha`); }
  const corners = await page.locator('.st-list > .st-row:first-child, .st-list > .st-row:last-child, .st-list > .st-details:last-child > :last-child').evaluateAll(els => els.filter(el => el.checkVisibility()).map(el => ({ name: el.className, radius: getComputedStyle(el).borderRadius })));
   for (const corner of corners) assert.ok(corner.radius.includes('12px'), `${context}: extremos sin redondear (${corner.name}: ${corner.radius})`);
  return report;
}

export async function assertVisibleFocus(page, control, context) {
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.ok(await control.evaluate(el => document.activeElement === el && el.matches(':focus-visible')), `${context}: foco de teclado`);
  const focus = await control.evaluate(el => {
    const box = el.closest('.pc-search, .sk-search, .pc-select') || el;
    const s = getComputedStyle(box), r = box.getBoundingClientRect(), inset = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
    const clips = [];
    for (let p = box.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p), pr = p.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(ps.overflowX) && (r.left - inset < pr.left - 1 || r.right + inset > pr.right + 1)) clips.push(`${p.className}:x`);
      if (/(auto|scroll|hidden|clip)/.test(ps.overflowY) && (r.top - inset < pr.top - 1 || r.bottom + inset > pr.bottom + 1)) clips.push(`${p.className}:y`);
    }
    return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor, clips };
  });
  assert.equal(focus.width, '2px', `${context}: contorno de foco`);
  assert.equal(focus.style, 'solid', `${context}: foco sólido`);
  assert.notEqual(focus.color, 'rgba(0, 0, 0, 0)', `${context}: foco invisible`);
  assert.deepEqual(focus.clips, [], `${context}: foco recortado`);
  return focus;
}

export async function assertActionsReachable(page, container, context) {
  const buttons = container.locator('button');
  assert.ok(await buttons.count() >= 2, `${context}: faltan acciones`);
  const first = buttons.first();
  await assertVisibleFocus(page, first, `${context}: acción primaria`);
  for (let i = 0; i < await buttons.count(); i++) {
    const button = buttons.nth(i);
    if (i) await page.keyboard.press('Tab');
    assert.ok(await button.evaluate(el => document.activeElement === el), `${context}: orden de acciones por Tab`);
    const hit = await button.evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    assert.ok(hit, `${context}: acción oculta o interceptada`);
  }
}

async function checkNativeStates(page, control, name, screenshot) {
  const style = () => control.evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, border: s.borderColor, color: s.color, opacity: s.opacity }; });
  const original = await control.inputValue();
  const filled = !original && await control.evaluate(el => el.tagName !== 'SELECT');
  if (filled) await control.fill('proyecto/revision-ui');
  await control.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await control.evaluate(el => el.blur());
  await page.waitForTimeout(200);
  const normal = await style();
  await control.hover();
  await page.waitForTimeout(180);
  const hover = await style();
  const feedback = await control.evaluate(el => el.closest('.st') ? 'background' : 'border');
  assert.notEqual(hover[feedback], normal[feedback], `${name}: falta hover`);
  await assertVisibleFocus(page, control, name);
  await page.screenshot({ path: `${screenshot}-focus.png` });
  // Native attributes on the real mounted control isolate CSS states from host timing.
  await control.evaluate(el => { el.blur(); el.disabled = true; });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const disabled = await style();
  await control.hover({ force: true });
  await page.waitForTimeout(180);
  assert.deepEqual(await style(), disabled, `${name}: disabled conserva hover activo`);
  assert.ok(Number(disabled.opacity) < 1, `${name}: disabled indistinguible`);
  await control.focus();
  assert.equal(await control.evaluate(el => el === document.activeElement), false, `${name}: disabled enfocable`);
  await page.screenshot({ path: `${screenshot}-disabled.png` });
  await control.evaluate(el => { el.disabled = false; });
  if (await control.evaluate(el => 'readOnly' in el)) {
    await control.evaluate(el => { el.readOnly = true; });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    const readonly = await style();
    await control.hover();
    await page.waitForTimeout(180);
    assert.deepEqual(await style(), readonly, `${name}: readonly conserva hover activo`);
    assert.notEqual(readonly.color, normal.color, `${name}: readonly indistinguible`);
    await assertVisibleFocus(page, control, name);
    const value = await control.inputValue();
    await page.keyboard.type('no debe editarse');
    assert.equal(await control.inputValue(), value, `${name}: readonly editable`);
    await page.screenshot({ path: `${screenshot}-readonly.png` });
    await control.evaluate(el => { el.readOnly = false; });
  }
  if (filled) await control.fill(original);
}

async function main() {

const root = resolve('storybook-static');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    let file = resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Ruta inválida');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
let browser;
try {
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cache = resolve(process.env.HOME || '', '.cache/ms-playwright');
  const versions = await readdir(cache).catch(() => []);
  const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', ...versions.filter(name => name.startsWith('chromium_headless_shell-')).map(name => resolve(cache, name, 'chrome-headless-shell-linux64/chrome-headless-shell'))];
  const available = (await Promise.all(candidates.map(async path => await stat(path).then(() => path).catch(() => null)))).find(Boolean);
  browser = await chromium.launch({ headless: true, ...(available ? { executablePath: available } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await mkdir('.test-artifacts', { recursive: true });
   page.setDefaultTimeout(6000);
   await page.emulateMedia({ reducedMotion: 'reduce' });
   const results = {}, failures = [], errors = [];
   page.on('pageerror', error => errors.push(error.message));
   const ids = ['ajustes--configuracion', 'ajustes--git', 'ajustes--voz', 'ajustes--conexiones', 'phantom--cards', 'phantom--nueva-card', 'phantom--skills', 'phantom--nueva-skill', 'phantom--contrato-card', 'phantom--detalle-skill', 'phantom--catalogo-skills'];
   const visit = async (id, host) => {
     await page.goto(`${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&args=host:${host}`);
     await page.waitForFunction(id => document.documentElement.dataset.catalogRendered === id, id);
     if (id === 'ajustes--configuracion' && await page.locator('.st-pane').isHidden()) await page.getByRole('button', { name: 'Agentes', exact: true }).click();
   };
   for (const width of [1440, 390, 320]) {
     await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
     for (const id of ids) for (const host of ['catalog', 'canvas', id.startsWith('ajustes') ? 'sheet' : 'inspector']) {
       const key = `${id}-${host}-${width}`, screenshot = `.test-artifacts/refinement-${key}`;
       try {
         await visit(id, host);
         const hostSelector = { catalog: '.catalog-panel', canvas: '.canvas-node .node-body .tw-tool-panel', sheet: '.settings-sheet .tw-inspector', inspector: '.tw-inspector .plugin-surface' }[host];
         assert.ok(await page.locator(hostSelector).count(), `${key}: composición no montada`);
         if (id === 'phantom--detalle-skill') await page.getByRole('button', { name: 'Preparar nueva versión' }).click();
         await page.screenshot({ path: `${screenshot}.png` });
         for (const details of await page.locator('.st-details, .pc-advanced').all()) await details.evaluate(el => { el.open = true; });
         results[key] = { controls: await assertFormGeometry(page, key) };
         const first = page.locator(`${fields}, ${searches}`).filter({ visible: true }).first();
         results[key].focus = await assertVisibleFocus(page, first, key);
         await page.screenshot({ path: `${screenshot}-focus.png` });
         if (id.startsWith('ajustes')) {
           const input = page.locator('.st-input:not([type=number])').filter({ visible: true }).first();
           const original = await input.inputValue();
           await input.fill('Borrador visual');
           await assertActionsReachable(page, page.locator('.st-save').first(), key);
           await page.screenshot({ path: `${screenshot}-actions.png` });
           await page.locator('.st-save').first().getByRole('button', { name: 'Descartar' }).click();
           assert.equal(await input.inputValue(), original, `${key}: descartar restaura el borrador`);
         } else if (await page.locator('.pc-form-actions').count()) {
           await assertActionsReachable(page, page.locator('.pc-form-actions'), key);
           await page.screenshot({ path: `${screenshot}-actions.png` });
         }
         if (id === 'phantom--contrato-card') {
           const model = await page.locator('.pc-root .pc-model').boundingBox(), actions = await page.locator('.pc-next-actions').boundingBox();
           assert.ok(actions.y >= model.y + model.height, `${key}: modelo solapa acciones`);
           await page.getByRole('button', { name: 'Preparar reemplazo' }).click();
           const checkbox = page.getByRole('checkbox', { name: /Confirmo crear un reemplazo/ });
           const submit = page.getByRole('button', { name: 'Crear reemplazo', exact: true });
           assert.ok(await submit.isDisabled(), `${key}: reemplazo requiere confirmación`);
           await checkbox.scrollIntoViewIfNeeded();
           const size = await checkbox.boundingBox();
           assert.ok(size.width <= 24 && size.height <= 24, `${key}: checkbox convertido en campo de texto`);
           await checkbox.focus();
           await page.keyboard.press('Space');
           assert.ok(await submit.isEnabled(), `${key}: confirmación por teclado`);
           await assertActionsReachable(page, page.locator('.pc-form-actions'), key);
           await page.screenshot({ path: `${screenshot}-replacement-actions.png` });
         }
         if (host === 'canvas' && ['ajustes--voz', 'phantom--nueva-skill'].includes(id)) {
           for (const selector of id.startsWith('ajustes') ? ['input.st-input:not([type=number])', '.st-select', 'textarea.st-input'] : ['.pc-form input', '.pc-form textarea']) {
             const control = page.locator(selector).filter({ visible: true }).first();
             const tag = await control.evaluate(el => el.tagName.toLowerCase());
             await checkNativeStates(page, control, `${key}: ${tag}`, `${screenshot}-${tag}-synthetic`);
           }
           if (id === 'phantom--nueva-skill') {
             await page.locator('.pc-form fieldset').evaluate(el => { el.disabled = true; });
             const input = page.getByLabel('ID de Skill', { exact: true });
             assert.ok(await input.isDisabled(), `${key}: fieldset disabled`);
             await input.scrollIntoViewIfNeeded();
             await page.mouse.move(0, 0);
             const resting = await input.evaluate(el => getComputedStyle(el).borderColor);
             await input.hover({ force: true });
             assert.equal(await input.evaluate(el => getComputedStyle(el).borderColor), resting, `${key}: hover heredado de fieldset disabled`);
             await page.screenshot({ path: `${screenshot}-fieldset-disabled-synthetic.png` });
             await page.locator('.pc-form fieldset').evaluate(el => { el.disabled = false; });
           }
         }
         if (id === 'phantom--detalle-skill') {
           const identity = page.getByLabel('ID de Skill', { exact: true });
           assert.ok(await identity.evaluate(el => el.readOnly), `${key}: identidad inmutable`);
           await assertVisibleFocus(page, identity, key);
           const original = await identity.inputValue();
           assert.equal(original, 'skill-demo', `${key}: identidad de la revisión leída`);
           await page.keyboard.type('no debe editarse');
           assert.equal(await identity.inputValue(), original, `${key}: identidad de versión editable`);
           await page.screenshot({ path: `${screenshot}-readonly.png` });
         }
         assert.deepEqual(await page.evaluate(() => window.__storybookHost.unknown), [], `${key}: llamadas sin fixture`);
         console.log(`PASS ${key}`);
       } catch (error) {
         failures.push(`${key}: ${error.message}`);
         await page.screenshot({ path: `${screenshot}-failure.png` });
       }
     }
   }
   await writeFile('.test-artifacts/ui-refinement-styles.json', JSON.stringify({ results, failures, errors }, null, 2));
   assert.deepEqual(errors, [], 'Errores de página');
   assert.deepEqual(failures, [], failures.join('\n'));
   console.log(`${Object.keys(results).length} composiciones verificadas a 1440/390/320; estados nativos y acciones por teclado.`);
} finally {
  await browser?.close();
  if (server.listening) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
