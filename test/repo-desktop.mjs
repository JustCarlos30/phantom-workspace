import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { createHost } from '../host/server.mjs';

// Historial panel on the canvas against a real host. By default it reads a
// SYNTHETIC repository built in /tmp; REPO_REAL=<repo> reads that repository
// instead (read-only: file writes are refused). Captures stay outside the repo.
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = '/tmp/opencode/phantom-repo-review';
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-repo-ui-')));
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PHANTOM_')));
const run = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: clean() }).trim();
let repository = process.env.REPO_REAL || '';
if (!repository) {
  repository = path.join(scratch, 'synthetic'); fs.mkdirSync(repository);
  run(repository, 'init', '-b', 'main'); run(repository, 'config', 'user.name', 'SYNTHETIC'); run(repository, 'config', 'user.email', 'synthetic@localhost');
  fs.writeFileSync(path.join(repository, 'app.js'), 'export const value = 1;\n'); run(repository, 'add', '.'); run(repository, 'commit', '-m', 'SYNTHETIC base');
  const tree = path.join(scratch, 'feature'); run(repository, 'worktree', 'add', '-b', 'feature', tree, 'HEAD');
  fs.writeFileSync(path.join(tree, 'app.js'), 'export const value = 2;\n'); run(tree, 'commit', '-am', 'SYNTHETIC feature');
  fs.writeFileSync(path.join(repository, 'readme.md'), '# SYNTHETIC\n'); run(repository, 'add', '.'); run(repository, 'commit', '-m', 'SYNTHETIC main moves');
  run(repository, 'merge', '--no-ff', '-m', 'SYNTHETIC merge feature', 'feature');
  fs.writeFileSync(path.join(tree, 'app.js'), 'export const value = 3;\nexport const extra = true;\n');
}
const readOnly = Boolean(process.env.REPO_REAL);
const host = await createHost({ dataDir: path.join(scratch, 'state'), handleIntegration: () => ({ handled: false }) });
const workspace = await host.invoke('workspace.open', { path: repository });
await host.invoke('node.create', { workspaceId: workspace.id, type: 'repo', title: 'Repositorio', x: 270, y: 70, width: 1360, height: 800, data: {} });
await host.invoke('workspace.update', { id: workspace.id, patch: { camera: { x: 20, y: 30, zoom: 1 } } }).catch(() => {});

const server = await createServer({ root, configFile: false, base: '/', cacheDir: path.join(evidence, 'vite-cache'), server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 980 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('__host', async (method, payload) => {
    if (readOnly && ['repo.file.write', 'branch.commit', 'branch.integrate', 'branch.update', 'branch.remove', 'merge.configure'].includes(method)) throw new Error('Solo lectura en revisión real');
    return host.invoke(method, payload);
  });
  await page.addInitScript(() => { window.phantom = { onEvent() { return () => {}; }, invoke: (method, payload = {}) => window.__host(method, payload) }; });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForSelector('.rp-root .rp-graph-row', { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(evidence, '01-graph.png') });

  // Commit detail and its diff tab.
  await page.locator('.rp-graph-row[data-oid]').nth(1).click();
  await page.waitForSelector('.rp-detail .rp-filerow');
  await page.locator('.rp-detail .rp-filerow-main').first().click();
  await page.waitForSelector('.rp-diff-row');
  await page.screenshot({ path: path.join(evidence, '02-commit-diff.png') });

  // A session with unsaved work: diff, then editor.
  const dirty = page.locator('.rp-side-item', { has: page.locator('.rp-pill.is-dirty') }).first();
  if (await dirty.count()) {
    await dirty.click();
    await page.waitForSelector('.rp-detail .rp-filerow');
    await page.locator('.rp-detail .rp-filerow-main').first().click();
    await page.waitForSelector('.rp-tab-panel:not([hidden]) .rp-diff-row.is-add');
    await page.screenshot({ path: path.join(evidence, '03-worktree-diff.png') });
    await page.locator('.rp-tab-panel:not([hidden]) .rp-file-bar .rp-button', { hasText: 'Editar' }).click();
    await page.waitForSelector('.rp-textarea');
    if (!readOnly) {
      await page.locator('.rp-textarea').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('// SYNTHETIC edit\n');
      await page.waitForSelector('.rp-tab .rp-dirty-dot');
      await page.keyboard.press('Control+s');
      await page.waitForFunction(() => !document.querySelector('.rp-tab .rp-dirty-dot'));
      assert.match(fs.readFileSync(path.join(scratch, 'feature', 'app.js'), 'utf8'), /SYNTHETIC edit/);
    }
    await page.screenshot({ path: path.join(evidence, '04-editor.png') });
  }
  // The queue lives in Git › Cola: Historial has no tab or sidebar section for it.
  assert.equal(await page.locator('.rp-tab', { hasText: 'Incorporaciones' }).count(), 0);
  assert.deepEqual(await page.locator('.rp-side-head').allTextContents().then(items => items.map(text => text.replace(/\d+$/, ''))), ['Sesiones']);
  assert.deepEqual(errors, []);
  console.log(`Repositorio review OK · ${evidence}`);
} finally {
  await browser?.close(); await server.close(); await host.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
