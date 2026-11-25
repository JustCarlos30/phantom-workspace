import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
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
after(async () => { await browser?.close(); });

async function render() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body class="app-shell"><div id="fixture"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.evaluate(() => window.mountPanel());
  await page.locator('.tf-badge').waitFor();
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
