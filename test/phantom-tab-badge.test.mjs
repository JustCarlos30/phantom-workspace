import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The queued-count badge on the Phantom "Agentes" tab must keep its digit
// centred inside its pill and stay inside the tab, even in a narrow panel.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Agentes tab label is a truncating span next to the badge', async () => {
  const jsx = await readFile(path.join(root, 'src/components/PhantomChat.jsx'), 'utf8');
  assert.match(jsx, /<span className="pd-tab-label">Agentes<\/span>/);
  assert.match(jsx, /<span className="pd-tab-label">Chat<\/span>/);
});

test('badge digit is centred and stays inside the tab', { timeout: 60000 }, async () => {
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  const { chromium } = await import('playwright');
  const css = (await readdir(path.join(root, 'src'))).filter(f => f.endsWith('.css')).sort();
  const links = css.map(f => `<link rel="stylesheet" href="${pathToFileURL(path.join(root, 'src', f))}">`).join('');
  const tabs = [400, 340, 260, 200].map(w => `<aside class="phantom-chat pc" data-w="${w}" style="position:relative;inset:auto;margin:8px;width:${w}px;height:60px"><div class="pd-tabs control-segmented" role="tablist">`
    + `<button type="button" role="tab" aria-selected="true"><svg width="14" height="14"></svg><span class="pd-tab-label">Chat</span><i class="pd-tab-live"></i></button>`
    + `<button type="button" role="tab" aria-selected="false" data-tone="waiting"><svg width="14" height="14"></svg><span class="pd-tab-label">Agentes</span><b>2</b></button>`
    + `</div></aside>`).join('');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 460, height: 400 } });
    // file:// stylesheets only load from a file:// document, not about:blank.
    const dir = await mkdtemp(path.join(tmpdir(), 'pd-tab-badge-'));
    const html = path.join(dir, 'index.html');
    await writeFile(html, `<!doctype html><html><head><meta charset="utf-8">${links}</head><body><div class="app-shell" style="display:block">${tabs}</div></body></html>`);
    await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
    await rm(dir, { recursive: true, force: true });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pd-tabs')).display), 'flex', 'project CSS did not load');
    const rows = await page.evaluate(() => [...document.querySelectorAll('aside')].map(aside => {
      const b = aside.querySelector('.pd-tabs b');
      const button = b.parentElement;
      const range = document.createRange(); range.selectNodeContents(b);
      const glyph = range.getBoundingClientRect(), pill = b.getBoundingClientRect(), tab = button.getBoundingClientRect(), list = button.parentElement.getBoundingClientRect();
      return { w: aside.dataset.w, width: aside.getBoundingClientRect().width, glyph: { x: glyph.x + glyph.width / 2, y: glyph.y + glyph.height / 2 }, pill: { x: pill.x + pill.width / 2, y: pill.y + pill.height / 2, left: pill.left, right: pill.right, width: pill.width }, tab: { left: tab.left, right: tab.right, y: tab.y + tab.height / 2 }, list: { left: list.left, right: list.right } };
    }));
    for (const r of rows) {
      assert.equal(r.width, Number(r.w), `${r.w}px: fixture retains its declared width`);
      assert.ok(Math.abs(r.glyph.x - r.pill.x) <= 1, `${r.w}px: digit off-centre horizontally`);
      assert.ok(Math.abs(r.glyph.y - r.pill.y) <= 1, `${r.w}px: digit off-centre vertically (${r.glyph.y} vs ${r.pill.y})`);
      assert.ok(Math.abs(r.pill.y - r.tab.y) <= 1, `${r.w}px: badge not vertically centred in tab`);
      assert.ok(r.pill.width >= 16, `${r.w}px: badge squashed`);
      assert.ok(r.tab.right <= r.list.right + 0.5, `${r.w}px: Agentes tab overflows the tab bar (${r.tab.right} > ${r.list.right})`);
      assert.ok(r.pill.right <= r.list.right + 0.5, `${r.w}px: badge overflows the tab bar`);
      assert.ok(r.pill.left >= r.tab.left && r.pill.right <= r.tab.right, `${r.w}px: badge overflows the tab`);
    }
  } finally { await browser.close(); }
});
