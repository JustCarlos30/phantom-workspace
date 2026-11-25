import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const sheets = ['src/canvas-ui.css', 'src/studio.css', 'src/shell.css'].map(file => `file://${resolve(root, file)}`);
const MIN_RATIO = 4.5;

let browser;
let dir;
let fixture;

before(async () => {
  const candidates = [process.env.PHANTOM_TEST_CHROMIUM, chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
  const errors = [];
  for (const executablePath of [...new Set(candidates)]) {
    try {
      await access(executablePath);
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'], timeout: 12000 });
      break;
    } catch (error) { errors.push(`${executablePath}: ${error.message}`); }
  }
  if (!browser) throw new Error(`Sin navegador Chromium disponible: ${errors.join(' | ')}`);
  dir = await mkdtemp(join(tmpdir(), 'dock-kbd-contrast-'));
  fixture = join(dir, 'fixture.html');
  const links = sheets.map(href => `<link rel="stylesheet" href="${href}">`).join('');
  await writeFile(fixture, `<!doctype html><html><head><meta charset="utf-8">${links}</head><body>
<div class="app-shell"><div class="activity-dock"><div class="dock-main">
<button class="dock-action dock-primary" type="button"><span>Nueva sesión</span><kbd class="dock-kbd">Ctrl+Shift+T</kbd></button>
</div></div></div></body></html>`);
});

after(async () => {
  await browser?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function measure(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.dock-primary');
    const kbd = btn.querySelector('kbd');
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = color => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    let opacity = 1;
    for (let el = kbd; el; el = el.parentElement) opacity *= parseFloat(getComputedStyle(el).opacity);
    const button = rgba(getComputedStyle(btn).backgroundColor);
    const chip = rgba(getComputedStyle(kbd).backgroundColor);
    const text = rgba(getComputedStyle(kbd).color);
    const chipAlpha = chip[3] / 255;
    const background = [0, 1, 2].map(i => chip[i] * chipAlpha + button[i] * (1 - chipAlpha));
    const textAlpha = (text[3] / 255) * opacity;
    const ink = [0, 1, 2].map(i => text[i] * textAlpha + background[i] * (1 - textAlpha));
    return { ink, background };
  });
}

function luminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

async function openFixture() {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 480, height: 200 } });
  const page = await context.newPage();
  await page.goto(`file://${fixture}`);
  await page.waitForLoadState('load');
  return { context, page };
}

test('Ctrl+Shift+T sobre el botón primario conserva contraste WCAG AA en reposo (tema oscuro)', async () => {
  const { context, page } = await openFixture();
  try {
    const { ink, background } = await measure(page);
    const ratio = contrast(ink, background);
    assert.ok(ratio >= MIN_RATIO, `contraste ${ratio.toFixed(2)}:1 < ${MIN_RATIO}:1`);
  } finally {
    await context.close();
  }
});

test('Ctrl+Shift+T sobre el botón primario conserva contraste WCAG AA en hover (tema oscuro)', async () => {
  const { context, page } = await openFixture();
  try {
    await page.hover('.dock-primary');
    await page.waitForTimeout(300);
    const { ink, background } = await measure(page);
    const ratio = contrast(ink, background);
    assert.ok(ratio >= MIN_RATIO, `contraste ${ratio.toFixed(2)}:1 < ${MIN_RATIO}:1`);
  } finally {
    await context.close();
  }
});
