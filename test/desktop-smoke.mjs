import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Real packaged UI, fresh fixtures only. No replacement bridge or user profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.PHANTOM_TEST_EXECUTABLE || path.join(root, 'out/Phantom Workspace-linux-x64/phantom-workspace');
const resources = path.join(path.dirname(executable), 'resources');
const evidence = path.join(root, '.impeccable/review');
const ledger = path.join(evidence, 'desktop-checks.final.json');
if (process.argv.includes('--recapture')) {
  await runRecapture();
  process.exit(process.exitCode || 0);
}
const temp = await fs.mkdtemp('/tmp/opencode/phantom-packaged-e2e-');
const home = path.join(temp, 'profile'), workspacePath = path.join(temp, 'SYNTHETIC-E2E-workspace');
await fs.mkdir(workspacePath, { recursive: true });
await fs.mkdir(path.join(evidence, 'before-fix'), { recursive: true });
const archive = path.join(evidence, `before-FR02-FR03-${Date.now()}`);
await fs.mkdir(archive);
for (const name of ['desktop-checks.final.json', 'E2E-final-report.md', 'desktop.png', 'narrow.png', 'browser-native.png', 'focused-terminal.png', 'tools.png']) {
  try { await fs.copyFile(path.join(evidence, name), path.join(archive, name), 1); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
try { await fs.copyFile(ledger, path.join(evidence, `packaged-attempt-${Date.now()}.json`), 1); } catch (e) { if (e.code !== 'ENOENT') throw e; }
for (const name of ['desktop-checks.json', 'desktop.png', 'narrow.png', 'browser-native.png', 'E2E-report.md']) {
  try { await fs.copyFile(path.join(evidence, name), path.join(evidence, 'before-fix', name), 1); } catch (e) { if (!['ENOENT', 'EEXIST'].includes(e.code)) throw e; }
}
await fs.writeFile(path.join(workspacePath, 'E2E.md'), '# SYNTHETIC E2E fixture\nIndependent context scan sentinel.\n');
execFileSync('git', ['init', '-b', 'fixture-main', workspacePath]);
execFileSync('git', ['-C', workspacePath, 'add', 'E2E.md']);
execFileSync('git', ['-C', workspacePath, '-c', 'user.name=E2E Fixture', '-c', 'user.email=e2e@localhost', 'commit', '-m', 'Synthetic fixture base']);
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Synthetic local E2E fixture</title><body style="background:#edf6f1;color:#173e32;font:24px system-ui;padding:48px"><h1>SYNTHETIC LOCAL FIXTURE</h1><p>REAL_NATIVE_BROWSER_SENTINEL</p><input aria-label="Fixture input"><button>Fixture action</button></body>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const result = {
  startedAt: new Date().toISOString(), executable, resources, temp, home, workspacePath, fixtureURL: url, priorEvidenceArchive: archive,
  build: JSON.parse(await fs.readFile(path.join(path.dirname(executable), 'BUILD.json'), 'utf8')),
  checks: [], console: [], pageErrors: [], screenshots: [], launchAttempts: [],
  notes: ['Fresh isolated packaged test; original ledger retained unchanged.', 'No microphone/cloud/model calls, Docker mutations, source changes, user profiles, or real repository commits.', 'One final batched capture round; native browser image captured directly because renderer screenshots can exclude native layers.'],
};
let app, page, workspaceId, noteId, browserId, traceBrowserId, automationId, sandboxFlag = false;
const sessions = [], ownedHosts = new Set(), ownedShells = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, label = 'condition', timeout = 6000) {
  const deadline = Date.now() + timeout;
  do { const value = await fn(); if (value) return value; await delay(60); } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const state = () => invoke('state.get');
const workspace = async () => (await state()).workspaces.find(w => w.id === workspaceId);
const focused = () => page.locator('.canvas-node.focused');
const tools = () => page.locator('.inspector-host');
async function save() { result.summary = { passed: result.checks.filter(c => c.status === 'passed').length, failed: result.checks.filter(c => c.status === 'failed').length }; await fs.writeFile(ledger, JSON.stringify(result, null, 2)); }
async function check(name, fn, critical = false) {
  const start = Date.now();
  try { const details = await fn(); result.checks.push({ name, status: 'passed', durationMs: Date.now() - start, details }); console.log(`PASS ${name}`); }
  catch (error) {
    result.lastFailureFocus = await page?.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 700), activeTag: document.activeElement?.tagName, documentFocused: document.hasFocus(), inlineNames: [...document.querySelectorAll('.inline-name-input')].map(e => ({ value: e.value, readOnly: e.readOnly })), focusedTitle: document.querySelector('.canvas-node.focused .title-button')?.textContent })).catch(() => null);
    result.checks.push({ name, status: 'failed', durationMs: Date.now() - start, error: error.message, stack: error.stack, focus: result.lastFailureFocus, visibleErrors: await page?.locator('.tw-error,.inline-error,.recovery-error').allTextContents().catch(() => []), nativeViews: await app?.evaluate(async ({ BrowserWindow }) => Promise.all((BrowserWindow.getAllWindows()[0]?.contentView.children || []).map(async v => ({ visible: v.getVisible(), url: v.webContents.getURL(), loading: v.webContents.isLoading(), text: await v.webContents.executeJavaScript('document.body?.innerText').catch(() => '') })))).catch(() => []) });
    console.error(`FAIL ${name}: ${error.message}`);
    await save(); if (critical) throw error;
    if (await page?.getByLabel('Cerrar paleta', { exact: true }).count()) await page.getByLabel('Cerrar paleta', { exact: true }).click();
    if (page && !page.isClosed() && !await page.locator('.app-shell').count()) throw new Error(`Renderer unavailable after ${name}; stopping instead of bypassing core checks`);
  }
  await save();
}
async function hostInfo() { const info = await invoke('system.info'); assert.equal(info.dataDir, home); ownedHosts.add(info.pid); return info; }
async function launch() {
  const env = { ...process.env, DISPLAY: ':1', SHELL: '/bin/sh', PHANTOM_WORKSPACE_HOME: home };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PHANTOM_RENDERER_URL', 'PHANTOM_NODE_BINARY', 'PHANTOM_CLI', 'PHANTOM_HOME', 'PLAYWRIGHT_BROWSERS_PATH', 'NODE_PATH', 'NODE_OPTIONS']) delete env[key];
  const attempt = { sandboxFlag, executable, cwd: temp };
  result.launchAttempts.push(attempt);
  try { app = await electron.launch({ executablePath: executable, args: [], cwd: temp, env, timeout: 15000 }); }
  catch (error) {
    attempt.error = error.message;
    result.checks.push({ name: 'packaged launch without test sandbox flags', status: 'failed', error: error.message }); await save();
    throw error;
  }
  attempt.started = true;
  page = await app.firstWindow(); page.setDefaultTimeout(5000);
  page.on('console', msg => { if (['warning', 'error'].includes(msg.type())) result.console.push({ type: msg.type(), text: msg.text() }); });
  page.on('pageerror', error => result.pageErrors.push(error.stack || error.message));
  await page.waitForSelector('.app-shell'); await hostInfo();
  await poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), 'native window shown');
  await viewport(1520, 980);
}
async function map() { if (await page.locator('.focus-return button').count()) await page.locator('.focus-return button').click(); }
async function inspector(tab) { if (!await page.getByLabel('Herramienta contextual').count()) await page.getByRole('button', { name: 'Herramientas del proyecto', exact: true }).click(); await page.getByLabel('Herramienta contextual').selectOption(tab); }
async function closeInspector() { if (await page.locator('.inspector-switcher').count()) await page.locator('.inspector-switcher button').click(); }
async function palette(title) {
  await page.bringToFront(); await map(); await page.locator('.canvas').focus(); await page.keyboard.press('Control+k');
  await poll(() => page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).evaluate(el => document.activeElement === el), 'palette opening effect and keyboard focus ready');
  await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill(title);
  const results = page.getByRole('dialog', { name: 'Paleta del workspace' }).getByRole('option');
  await poll(async () => await results.count() === 1 && (await results.innerText()).includes(title), `palette unique filtered result ${title}`);
  await page.keyboard.press('Enter');
  await poll(async () => (await focused().locator('.title-button').textContent()) === title, 'focused title');
}
async function renameFocused(title) {
  await focused().locator('.title-button').click(); await focused().getByLabel('Nombre del panel', { exact: true }).fill(title); await focused().getByLabel('Nombre del panel', { exact: true }).press('Enter');
  await poll(async () => (await workspace()).nodes.some(n => n.title === title), 'renamed panel persisted');
  await focused().getByLabel('Nombre del panel', { exact: true }).waitFor({ state: 'hidden' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function nativeViews() { return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(v => ({ visible: v.getVisible(), bounds: v.getBounds(), url: v.webContents.getURL(), loading: v.webContents.isLoading() }))); }
async function viewport(width, height) {
  await app.evaluate(({ BrowserWindow }, [width, height]) => {
    const w = BrowserWindow.getAllWindows()[0]; w.setResizable(true); w.setMinimumSize(1000, 700); w.setMaximumSize(10000, 10000); w.setContentSize(width, height);
    const b = w.getBounds(); w.setMinimumSize(b.width, b.height); w.setMaximumSize(b.width, b.height); w.setResizable(false);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
}
async function terminalGeometry() {
  return focused().evaluate(node => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    const elements = Object.fromEntries(['.terminal-host', '.xterm', '.xterm-viewport', '.xterm-screen', '.xterm-cursor'].map(s => { const el = node.querySelector(s); return [s, el ? { bounds: rect(el), background: getComputedStyle(el).backgroundColor, clientHeight: el.clientHeight } : null]; }));
    return { viewport: { width: innerWidth, height: innerHeight }, elements, rows: [...node.querySelectorAll('.xterm-rows>div')].map(el => ({ text: el.textContent, bounds: rect(el) })) };
  });
}
async function settledTerminal(label) {
  await delay(500); let last, since;
  await poll(async () => {
    const a = await invoke('terminal.attach', { sessionId: sessions[1].id }); const screen = await focused().locator('.xterm-screen').boundingBox(); const key = JSON.stringify([a.session.cols, a.session.rows, a.seq, screen]);
    if (key !== last) { last = key; since = Date.now(); }
    return a.session.status === 'running' && Date.now() - since >= 300;
  }, `stable terminal dimensions/output/paint: ${label}`);
  return { label, native: await invoke('terminal.attach', { sessionId: sessions[1].id }), dom: await terminalGeometry() };
}
async function nativePage(target, sentinel, viewer = false) {
  return poll(async () => app.evaluate(async ({ webContents }, [target, sentinel, viewer]) => {
    const wc = webContents.getAllWebContents().find(w => (w.getURL() === target || (viewer && w.getURL().startsWith(new URL(target).origin + '/'))) && !w.isLoading());
    if (!wc) return false;
    const data = await wc.executeJavaScript('({url:location.href,text:document.body?.innerText,ready:document.readyState,phantom:typeof window.phantom,require:typeof require})');
    // Trace Viewer hydrates after document load. Wait for its actual UI, not
    // merely the HTTP document's complete state and an empty sentinel.
    return data.ready === 'complete' && data.text?.includes(sentinel)
      && (!viewer || /trace|actions|metadata|source|playwright/i.test(data.text)) ? data : false;
  }, [target, sentinel, viewer]), `settled native page ${target}`, 10000);
}
async function savedUI() { await poll(async () => await page.locator('.save-state').textContent() === 'Guardado', 'UI saved state'); }
async function closeUI(stopHost = false) {
  const closed = page.waitForEvent('close', { timeout: 10000 });
  if (stopHost) await invoke('desktop.quit', { stopHost: true });
  else await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  const child = app.process();
  // Debugger attachment can retain a windowless Electron. Only terminate our debug process after renderer close.
  if (child.exitCode === null) { child.kill('SIGKILL'); await poll(() => child.exitCode !== null || child.signalCode !== null, 'owned Electron exits'); }
  app = null;
}
async function signalOwnedHost(pid, signal) {
  assert(ownedHosts.has(pid));
  try { const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0'); assert(args.includes(home) && args.some(a => a.endsWith('/host/server.mjs')), 'only this fixture daemon may be signalled'); process.kill(pid, signal); }
  catch (e) { if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e; }
}
function assertNoOverlap(nodes) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j]; assert(!(a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1), `Panels overlap: ${a.title} / ${b.title}`);
  }
}
async function fitAndReady(width, height) {
  await viewport(width, height);
  await page.getByLabel('Ajustar todos los paneles', { exact: true }).click(); await savedUI();
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
}
const watchdog = setTimeout(() => { result.checks.push({ name: '120-second deadline', status: 'failed' }); finish().finally(() => process.exit(1)); }, 120000);
let finishing;
function finish() { return finishing ||= (async () => {
  clearTimeout(watchdog);
  if (app) { try { await Promise.race([invoke('desktop.quit', { stopHost: true }), delay(1000)]); } catch {} try { app.process().kill('SIGKILL'); } catch {} }
  for (const pid of ownedHosts) await signalOwnedHost(pid, 'SIGTERM').catch(error => { result.notes.push(`Cleanup host ${pid}: ${error.message}`); });
  for (const pid of ownedShells) { try { const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0'); const cwd = await fs.readlink(`/proc/${pid}/cwd`); if (cwd === workspacePath && args[0]?.endsWith('/sh')) process.kill(pid, 'SIGKILL'); } catch {} }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  result.finishedAt = new Date().toISOString(); await save();
})(); }

try {
  await launch();
  await check('packaged binary, bundled runtime/CLI/browser paths, isolated empty state', async () => {
    const info = await invoke('desktop.info'), host = await hostInfo();
    assert.equal(info.packaged, true); assert.equal(info.dataDir, home); assert.equal((await state()).workspaces.length, 0);
    assert(await page.getByRole('heading', { name: 'Un espacio para cada proyecto' }).isVisible());
    const execPath = await fs.readlink(`/proc/${host.pid}/exe`); assert.equal(execPath, path.join(resources, 'runtime/node'));
    const environment = Object.fromEntries((await fs.readFile(`/proc/${host.pid}/environ`, 'utf8')).split('\0').filter(s => /^(PHANTOM_CLI|PLAYWRIGHT_BROWSERS_PATH)=/.test(s)).map(s => { const n = s.indexOf('='); return [s.slice(0, n), s.slice(n + 1)]; }));
    assert.equal(environment.PHANTOM_CLI, path.join(resources, 'app/vendor/phantom/bin/phantom.mjs'));
    assert.equal(environment.PLAYWRIGHT_BROWSERS_PATH, path.join(resources, 'browsers'));
    const uiURL = page.url(); assert(fileURLToPath(uiURL).startsWith(path.join(resources, 'app/dist/')));
    result.packaged = { info, execPath, environment, uiURL, sandboxFlag }; return result.packaged;
  }, true);
  await check('open synthetic workspace via real authorized chooser bypass', async () => {
    workspaceId = (await invoke('workspace.open', { path: workspacePath })).id; await page.waitForSelector('.create-dock'); assert.equal((await workspace()).canonicalPath, workspacePath);
  }, true);
  await check('settings UI isolates Phantom data; bundled CLI remains default', async () => {
    await inspector('settings'); assert.equal(await tools().getByLabel('Ruta del ejecutable Phantom', { exact: false }).inputValue(), '');
    await tools().getByLabel('Datos nativos de Phantom', { exact: false }).fill(path.join(temp, 'native-phantom'));
    await tools().getByLabel('Shell opcional', { exact: true }).fill('/bin/sh');
    await tools().getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
    await poll(async () => (await state()).settings.phantomData === path.join(temp, 'native-phantom'), 'isolated native data');
    assert(!(await state()).settings.phantomPath); await closeInspector();
  }, true);
  for (let i = 0; i < 3; i++) await check(`UI terminal ${i + 1}: real xterm printf, independent native output/PID/ID`, async () => {
    await page.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click();
    await poll(async () => (await workspace()).nodes.filter(n => n.type === 'terminal').length === i + 1, 'new terminal node');
    await focused().getByRole('button', { name: 'Terminal', exact: true }).waitFor(); await focused().locator('.status-dot.running').waitFor(); await renameFocused(`E2E T${i + 1}`);
    const node = (await workspace()).nodes.find(n => n.title === `E2E T${i + 1}`);
    await focused().locator('.xterm-helper-textarea').focus(); await page.keyboard.type(`printf '\\nE2E_${i}_%s\\n' '${20 + i}'`); await page.keyboard.press('Enter');
    const attached = await poll(async () => { const a = await invoke('terminal.attach', { sessionId: node.data.sessionId }); return a.data.includes(`E2E_${i}_${20 + i}`) && a; }, 'PTY output');
    assert.equal(attached.session.status, 'running'); assert(attached.session.pid > 0); sessions.push(attached.session); ownedShells.add(attached.session.pid);
    assert.equal(new Set(sessions.map(s => s.id)).size, sessions.length); assert.equal(new Set(sessions.map(s => s.pid)).size, sessions.length); return attached;
  }, true);
  await check('shell exit 7 and explicit UI stop remain separate', async () => {
    await focused().locator('.xterm-helper-textarea').focus(); await page.keyboard.type('exit 7'); await page.keyboard.press('Enter');
    const exited = await poll(async () => { const a = await invoke('terminal.attach', { sessionId: sessions[2].id }); return a.session.status === 'exited' && a; }, 'shell exit'); assert.equal(exited.session.exitCode, 7);
    await palette('E2E T1'); await focused().getByLabel('Terminar proceso', { exact: true }).click();
    await poll(async () => (await invoke('terminal.attach', { sessionId: sessions[0].id })).session.status === 'exited', 'explicit stop'); return exited.session;
  });
  await check('note UI and text editing do not move camera', async () => {
    await page.locator('.create-dock').getByRole('button', { name: 'Nota', exact: true }).click(); await focused().getByRole('button', { name: 'Nota', exact: true }).waitFor(); await renameFocused('E2E Note'); noteId = (await workspace()).nodes.find(n => n.title === 'E2E Note').id;
    await map(); await savedUI(); const camera = (await workspace()).camera;
    const editor = page.getByLabel('Nota: E2E Note', { exact: true }); await editor.fill('SYNTHETIC E2E continuity note'); await editor.press('End'); await page.keyboard.type(' 0 wasd');
    await poll(async () => (await workspace()).nodes.find(n => n.id === noteId).data.text?.endsWith('0 wasd'), 'note saved'); assert.deepEqual((await workspace()).camera, camera);
  });
  await check('canvas arrange, resize, zoom, keyboard palette find/focus/return', async () => {
    await page.getByLabel('Ajustar todos los paneles', { exact: true }).click(); await savedUI();
    const before = (await workspace()).nodes.find(n => n.id === noteId); const node = page.locator('.canvas-node').filter({ has: page.getByLabel('Nota: E2E Note', { exact: true }) });
    const header = await node.locator('.node-header').boundingBox(); await page.mouse.move(header.x + 8, header.y + 8); await page.mouse.down(); await page.mouse.move(header.x + 3, header.y + 3, { steps: 3 }); await page.mouse.up();
    await poll(async () => (await workspace()).nodes.find(n => n.id === noteId).x !== before.x, 'drag persisted');
    await node.getByLabel('Cambiar tamaño del panel').focus(); await page.keyboard.press('ArrowRight');
    await poll(async () => (await workspace()).nodes.find(n => n.id === noteId).width === before.width + 24, 'resize persisted');
    const zoom = (await workspace()).camera.zoom; await page.getByLabel('Alejar', { exact: true }).click(); await poll(async () => (await workspace()).camera.zoom < zoom, 'zoom persisted');
    await palette('E2E Note'); assert(await focused().locator('.note-editor').isVisible()); await map(); assert.equal(await focused().count(), 0);
  });
  await check('FR03 panel context Renombrar inline: Enter/blur persist, Escape+blur cancel, header focus restored', async () => {
    await palette('E2E Note');
    const start = async () => { await focused().getByLabel('Opciones del panel', { exact: true }).click(); await page.getByRole('menuitem', { name: 'Renombrar', exact: true }).click(); await focused().locator('.node-header').getByLabel('Nombre del panel', { exact: true }).waitFor(); assert.equal(await page.locator('.app-modal-backdrop').count(), 0); };
    const input = () => focused().locator('.node-header').getByLabel('Nombre del panel', { exact: true });
    const observations = []; result.fr03PanelFocus = observations;
    const restored = async phase => { try { await poll(() => focused().locator('.title-button').evaluate(el => document.activeElement === el), 'panel header keyboard focus restored', 1800); observations.push({ phase, restored: true }); } catch { observations.push({ phase, restored: false, activeTag: await page.evaluate(() => document.activeElement?.tagName), activeElement: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 700)) }); } };
    await start(); await input().fill('E2E Note FR03'); await input().press('Enter');
    await poll(async () => (await workspace()).nodes.find(n => n.id === noteId).title === 'E2E Note FR03', 'inline panel Enter persisted'); await restored('Enter');
    await start(); await input().fill('DO NOT SAVE PANEL ESCAPE'); await input().press('Escape'); await restored('Escape'); await page.locator('.focus-return span').click();
    assert.equal((await workspace()).nodes.find(n => n.id === noteId).title, 'E2E Note FR03'); assert.equal(await input().count(), 0);
    await start(); await input().fill('E2E Note Blur'); await page.locator('.focus-return span').click();
    await poll(async () => (await workspace()).nodes.find(n => n.id === noteId).title === 'E2E Note Blur', 'panel blur persisted');
    await input().waitFor({ state: 'hidden' }); await renameFocused('E2E Note'); await restored('restore original via Enter'); assert(observations.every(o => o.restored), `Panel header focus restoration failed: ${JSON.stringify(observations)}`); return { enterPersisted: true, escapeThenBlurCancelled: true, blurPersisted: true, modalBackdrops: 0, keyboardFocus: observations };
  });
  await check('FR03 breadcrumb project rename inline: Enter/blur persist, Escape+blur cancel, focus restored', async () => {
    const before = await workspace(); const editor = page.locator('.project-name-editor'); const button = () => editor.locator('button'); const input = () => editor.getByLabel('Nombre del proyecto', { exact: true });
    const start = async () => { await button().click(); await input().waitFor(); assert.equal(await page.locator('.app-modal-backdrop').count(), 0); };
    const observations = []; result.fr03ProjectFocus = observations;
    const restored = async phase => { try { await poll(() => button().evaluate(el => document.activeElement === el), 'project breadcrumb keyboard focus restored', 1800); observations.push({ phase, restored: true }); } catch { observations.push({ phase, restored: false, activeTag: await page.evaluate(() => document.activeElement?.tagName), activeElement: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 700)), projectEditor: await editor.innerHTML() }); } };
    await start(); await input().fill('SYNTHETIC FR03 Project'); await input().press('Enter'); await poll(async () => (await workspace()).name === 'SYNTHETIC FR03 Project', 'project Enter persisted'); await restored('Enter');
    await start(); await input().fill('DO NOT SAVE PROJECT ESCAPE'); await input().press('Escape'); await restored('Escape'); await page.locator('.focus-return span').click(); assert.equal((await workspace()).name, 'SYNTHETIC FR03 Project'); assert.equal(await input().count(), 0);
    await start(); await input().fill(before.name); await page.locator('.focus-return span').click(); await poll(async () => (await workspace()).name === before.name, 'project blur persisted');
    await input().waitFor({ state: 'hidden' }); assert.equal((await workspace()).canonicalPath, before.canonicalPath); assert(observations.every(o => o.restored), `Project header focus restoration failed: ${JSON.stringify(observations)}`); return { enterPersisted: true, escapeThenBlurCancelled: true, blurPersisted: true, modalBackdrops: 0, canonicalPath: before.canonicalPath, keyboardFocus: observations };
  });
  await check('local task actual form and persisted doing status', async () => {
    await inspector('tasks'); await tools().getByLabel('Título', { exact: true }).fill('SYNTHETIC E2E task'); await tools().getByLabel('Descripción / checklist').fill('Actual packaged UI form'); await tools().getByRole('button', { name: 'Crear tarea local', exact: true }).click();
    await poll(async () => (await workspace()).tasks.some(t => t.title === 'SYNTHETIC E2E task'), 'task creation'); await tools().getByLabel('Estado local').selectOption('doing'); await poll(async () => (await workspace()).tasks[0].status === 'doing', 'task status');
  });
  await check('context real scan/read/pin optional hash regression', async () => {
    await inspector('context'); const article = tools().locator('article.tw-item').filter({ has: page.getByRole('button', { name: 'Leer documento', exact: true }) });
    await article.getByRole('button', { name: 'Leer documento', exact: true }).click(); await tools().getByText('Independent context scan sentinel.', { exact: false }).first().waitFor();
    await article.getByRole('button', { name: 'Fijar referencia', exact: true }).click(); await poll(async () => (await workspace()).contextRefs.some(r => r.path?.endsWith('E2E.md')), 'pinned reference'); return (await workspace()).contextRefs;
  });
  await check('bundled Phantom CLI actual decision creation through native form', async () => {
    await inspector('context'); await tools().getByRole('button', { name: 'Decisiones / memorias', exact: true }).click();
    await tools().getByLabel('Decisión JSON', { exact: false }).fill(JSON.stringify({ key: 'synthetic-e2e', kind: 'decision', title: 'SYNTHETIC E2E decision', body: 'Bundled CLI isolated native decision', scope: '.', space: 'workspace', evidence: [] }));
    await tools().getByRole('button', { name: 'Crear decisión en Phantom', exact: true }).click();
    return poll(async () => { const r = await invoke('phantom.list', { workspaceId, topic: 'memories' }); return r.items?.some(i => i.title === 'SYNTHETIC E2E decision') && r; }, 'native decision catalog');
  }, true);
  await check('bundled Phantom CLI native coordinated card via UI, never execute model', async () => {
    await inspector('tasks'); await tools().getByLabel('Tipo de entrada').selectOption('card');
    await tools().getByLabel('Contrato JSON', { exact: false }).fill(JSON.stringify({ goal: 'SYNTHETIC E2E card — no model', lane: 'coordinated', workspace: workspacePath, scope: ['E2E.md'], checks: [{ name: 'not-run', argv: [path.join(resources, 'runtime/node'), '--version'] }] }));
    await tools().getByRole('button', { name: 'Crear card en Phantom', exact: true }).click();
    return poll(async () => { const r = await invoke('phantom.list', { workspaceId, topic: 'tasks' }); return r.items?.length && r; }, 'native card catalog');
  }, true);
  await check('bundled Phantom CLI actual native skill via UI', async () => {
    await inspector('context'); await tools().getByRole('button', { name: 'Skills', exact: true }).click();
    await tools().getByLabel('Manifiesto JSON de skill', { exact: false }).fill(JSON.stringify({ id: 'fixture/synthetic-e2e', version: '1.0.0', description: 'Synthetic bundled native skill', actions: ['fixture.read'], body: 'Fixture instruction', requiresTools: [], resources: [] }));
    await tools().getByRole('button', { name: 'Crear skill en Phantom', exact: true }).click();
    return poll(async () => { const r = await invoke('phantom.list', { workspaceId, topic: 'skills' }); return r.items?.length && r; }, 'native skill catalog');
  }, true);
  await check('native integration validation error stays visible, host remains connected', async () => {
    await inspector('tasks'); await tools().getByLabel('Tipo de entrada').selectOption('decision');
    await tools().getByLabel('Decisión JSON', { exact: false }).fill(JSON.stringify({ key: 'invalid-test', kind: 'decision', title: '', body: 'SYNTHETIC validation fixture', scope: '.', evidence: [] }));
    await tools().getByRole('button', { name: 'Crear decisión en Phantom', exact: true }).click(); await tools().locator('.tw-error').waitFor();
    const text = await tools().locator('.tw-error').innerText(); assert.equal((await invoke('desktop.info')).host.connected, true); await state(); assert(await tools().locator('.tw-error').isVisible()); assert.equal(await page.locator('.connection-error').count(), 0); return text;
  });
  await check('Git actual fixture branch/list via UI and API', async () => { await inspector('git'); await tools().getByText('fixture-main', { exact: true }).first().waitFor(); const git = await invoke('git.inspect', { workspaceId }); assert.equal(git.branch, 'fixture-main'); assert(git.branches.some(b => b.current)); return git; });
  await check('Docker actual readonly availability/owned list', async () => { await inspector('docker'); const docker = await invoke('docker.list', { workspaceId }); assert.equal(typeof docker.available, 'boolean'); assert(Array.isArray(docker.items)); return docker; });
  await check('Services owner formatting regression, pin and scoped open via real UI', async () => {
    await inspector('services'); await tools().getByLabel('URL', { exact: true }).fill(url); await tools().getByLabel('Nombre opcional').fill('E2E Local Web'); await tools().getByRole('button', { name: 'Fijar URL', exact: true }).click();
    const pinned = tools().locator('article.tw-item').filter({ has: page.locator('strong', { hasText: /^E2E Local Web$/ }) });
    await pinned.getByRole('button', { name: 'Abrir en navegador', exact: true }).click();
    browserId = (await poll(async () => (await workspace()).nodes.find(n => n.title === 'E2E Local Web'), 'service browser node')).id;
    const remote = await nativePage(url, 'REAL_NATIVE_BROWSER_SENTINEL'); const services = await invoke('services.list', { workspaceId }); assert(services.items.some(i => i.source === 'pinned' && i.url === url)); return { remote, services };
  }, true);
  await check('native browser real URL editing/settled content and remote sandbox', async () => {
    await focused().getByLabel('Dirección web').fill(`${url}?ui-navigation=1`); await focused().getByLabel('Dirección web').press('Enter');
    const data = await nativePage(`${url}?ui-navigation=1`, 'REAL_NATIVE_BROWSER_SENTINEL'); assert.equal(data.phantom, 'undefined'); assert.equal(data.require, 'undefined'); return data;
  }, true);
  await check('native browser hides beneath inspector and keyboard palette', async () => {
    await inspector('context'); await poll(async () => (await nativeViews()).every(v => !v.visible), 'native hidden under inspector'); await closeInspector(); await poll(async () => (await nativeViews()).some(v => v.visible), 'native restored');
    await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: 'Paleta del workspace' }).waitFor(); await poll(async () => (await nativeViews()).every(v => !v.visible), 'native hidden under palette'); await page.keyboard.press('Escape'); await poll(async () => (await nativeViews()).some(v => v.visible), 'native restored after palette');
  });
  for (const tab of ['tasks', 'context']) await check(`FR02 ${tab} inspector: terminal click routes Space/Ctrl+C correctly; fields isolate PTY/camera; browser hidden`, async () => {
    await palette('E2E T2'); await inspector(tab); await settledTerminal(`FR02 ${tab} inspector opened`);
    await focused().locator('.terminal-host').click({ position: { x: 30, y: 45 } });
    await poll(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')), 'clicked terminal owns keyboard focus');
    const otherBefore = await Promise.all(sessions.filter(s => s.id !== sessions[1].id).map(s => invoke('terminal.attach', { sessionId: s.id })));
    await page.keyboard.type('printf'); await page.keyboard.press('Space'); await page.keyboard.type(`'FR02_${tab}_%s\\n'`); await page.keyboard.press('Space'); await page.keyboard.type("'PTY_OK'"); await page.keyboard.press('Enter');
    await poll(async () => (await invoke('terminal.attach', { sessionId: sessions[1].id })).data.includes(`FR02_${tab}_PTY_OK`), 'Space-delimited printf reaches selected PTY');
    await page.keyboard.type('sleep 30'); await page.keyboard.press('Enter');
    const sleeper = await poll(async () => {
      const childPids = (await fs.readFile(`/proc/${sessions[1].pid}/task/${sessions[1].pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean);
      for (const pid of childPids) { try { if ((await fs.readFile(`/proc/${pid}/comm`, 'utf8')).trim() === 'sleep') return Number(pid); } catch {} }
      return false;
    }, 'actual owned sleep subprocess started');
    await page.keyboard.press('Control+c');
    await poll(async () => { try { const stat = await fs.readFile(`/proc/${sleeper}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z'); } catch (e) { if (e.code === 'ENOENT') return true; throw e; } }, 'Ctrl+C interrupts actual correct PTY child');
    await page.keyboard.type(`printf 'FR02_${tab}_CTRL_C_%s\\n' 'OK'`); await page.keyboard.press('Enter');
    await poll(async () => (await invoke('terminal.attach', { sessionId: sessions[1].id })).data.includes(`FR02_${tab}_CTRL_C_OK`), 'shell resumed after Ctrl+C');
    assert.equal(await page.getByLabel('Herramienta contextual').inputValue(), tab); assert(await tools().isVisible()); assert((await nativeViews()).every(v => !v.visible));
    const otherAfter = await Promise.all(sessions.filter(s => s.id !== sessions[1].id).map(s => invoke('terminal.attach', { sessionId: s.id })));
    for (let i = 0; i < otherBefore.length; i++) { assert.equal(otherAfter[i].data, otherBefore[i].data); assert.equal(otherAfter[i].seq, otherBefore[i].seq); }
    await settledTerminal(`FR02 ${tab} before inspector typing`); const camera = (await workspace()).camera;
    const baseline = await Promise.all(sessions.map(s => invoke('terminal.attach', { sessionId: s.id })));
    const field = tools().getByLabel(tab === 'tasks' ? 'Título' : 'Buscar en fuentes permitidas', { exact: true }); await field.click(); await field.fill('FR02_FIELD_SENTINEL'); await field.press('End'); await page.keyboard.press('Space'); await page.keyboard.type('0 wasd'); await page.keyboard.press('Control+c');
    assert(await field.evaluate(el => el === document.activeElement)); let negativeSince = Date.now();
    await poll(async () => { const current = await Promise.all(sessions.map(s => invoke('terminal.attach', { sessionId: s.id }))); for (let i = 0; i < current.length; i++) { assert.equal(current[i].seq, baseline[i].seq, 'inspector input must not produce PTY traffic'); assert.equal(current[i].data, baseline[i].data); } assert.deepEqual((await workspace()).camera, camera); return Date.now() - negativeSince >= 350; }, 'bounded no-PTY/no-camera inspector field observation');
    assert.equal(await page.getByLabel('Herramienta contextual').inputValue(), tab); assert((await nativeViews()).every(v => !v.visible));
    await field.fill(''); return { correctSession: sessions[1].id, interruptedOwnedChild: sleeper, otherSessionsUnchanged: true, inspectorStayedOpen: true, inspectorInputPTYTraffic: 0, cameraUnchanged: true, nativeBrowserHidden: true };
  });
  await check('packaged Node playground deterministic UI run', async () => {
    await inspector('playground'); await tools().getByLabel('Código / comandos').fill('console.log("SYNTHETIC_NODE_RESULT", 6 * 7)'); await tools().getByRole('button', { name: 'Ejecutar entrada', exact: true }).click();
    const run = await poll(async () => (await invoke('playground.list', { workspaceId })).items.find(r => r.status === 'completed' && /SYNTHETIC_NODE_RESULT 42/.test(r.output || '')), 'Node output'); assert.equal(run.executable, path.join(resources, 'runtime/node')); return run;
  });
  await check('bundled Playwright real live browser, completed/stopped trace and internal viewer UI', async () => {
    await inspector('playwright'); await tools().getByLabel('URL inicial').fill(url); await tools().getByLabel('Mantener ventana al terminar', { exact: true }).check();
    await tools().getByRole('button', { name: /^Iniciar/ }).click();
    const run = await poll(async () => (await invoke('automation.list', { workspaceId })).items.find(r => r.url === url && r.status === 'completed' && r.browserOpen && r.tracePath), 'live completion with trace', 15000); automationId = run.id;
    const host = await hostInfo();
    const children = (await fs.readFile(`/proc/${host.pid}/task/${host.pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean);
    const commands = await Promise.all(children.map(async pid => { try { return (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0'); } catch { return []; } }));
    assert(commands.some(argv => argv[0]?.startsWith(path.join(resources, 'browsers'))), 'real launched Chromium must be from packaged resources/browsers');
    await page.bringToFront(); const row = tools().locator('article.tw-item').filter({ hasText: run.id }); await row.getByRole('button', { name: 'Detener ejecución', exact: true }).click();
    await poll(async () => !(await invoke('automation.list', { workspaceId })).items.find(r => r.id === run.id).browserOpen, 'live browser stopped');
    const trace = await invoke('automation.trace', { workspaceId, id: run.id }); assert((await fs.stat(trace.path)).size > 0);
    await row.getByRole('button', { name: 'Ver trace grabado en canvas', exact: true }).click();
    const node = await poll(async () => (await workspace()).nodes.find(n => n.type === 'browser' && n.title.startsWith('Trace ·')), 'trace canvas panel'); traceBrowserId = node.id;
    const viewer = await nativePage(node.data.url, '', true); assert(/trace|actions|metadata|source|playwright/i.test(viewer.text), 'actual trace viewer UI content must load');
    return { run, chromiumCommands: commands.filter(argv => argv[0]?.startsWith(resources)), trace, viewer };
  }, true);
  await check('typed voice transcript -> reviewed explicit local task without mic/cloud', async () => {
    await closeInspector(); await page.getByLabel('Capturar por voz', { exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Voz e intención' });
    await dialog.getByLabel('Transcripción editable / texto escrito').fill('Crear tarea SYNTHETIC voice task'); await dialog.getByRole('button', { name: 'Interpretar como borrador editable', exact: true }).click();
    await dialog.getByLabel('Acción explícita').selectOption('task'); await dialog.getByLabel('Título editable').fill('SYNTHETIC voice task'); await dialog.getByRole('button', { name: 'Crear borrador local revisado', exact: true }).click();
    await poll(async () => (await workspace()).tasks.some(t => t.title === 'SYNTHETIC voice task'), 'voice local task'); await dialog.getByLabel('Cancelar y cerrar captura').click();
  });
  await check('auto-placement actual native rectangles nonoverlapping', async () => { const nodes = (await workspace()).nodes.filter(n => !n.data?.hidden); assertNoOverlap(nodes); return nodes.map(({ id, title, x, y, width, height }) => ({ id, title, x, y, width, height })); });
  await check('FINAL batched screenshots: settled native page, desktop/narrow overview, terminal/tools', async () => {
    if (process.argv.includes('--functional-only')) {
      const captured = JSON.parse(await fs.readFile(path.join(archive, 'desktop-checks.final.json'), 'utf8'));
      assert.deepEqual(captured.build, result.build, 'reuse only the same repackaged build, never older images');
      assert.equal(captured.screenshots.length, 5); result.screenshots = captured.screenshots; result.focusedTerminalEvidence = captured.focusedTerminalEvidence; result.focusedTerminalPixels = captured.focusedTerminalPixels;
      result.imageProvenance = { reason: 'One current-build image batch already captured and directly reviewed; functional completion rerun performs no additional capture', sourceLedger: path.join(archive, 'desktop-checks.final.json'), sourceFixture: captured.temp, sameBuild: captured.build };
      for (const shot of result.screenshots) assert((await fs.stat(shot.path)).size > 3000);
      return result.imageProvenance;
    }
    await closeInspector(); await palette('E2E Local Web'); await nativePage(`${url}?ui-navigation=1`, 'REAL_NATIVE_BROWSER_SENTINEL');
    await poll(async () => (await nativeViews()).some(v => v.visible && !v.loading && v.url === `${url}?ui-navigation=1`), 'visible settled native viewport');
    await poll(async () => await page.locator('.toast-stack .toast').count() === 0, 'transient toasts dismissed', 9000);
    const capture = await invoke('browser.capture', { id: browserId }); const bytes = Buffer.from(capture.dataUrl.split(',')[1], 'base64'); assert(bytes.length > 3000, 'native page capture unexpectedly empty');
    await fs.writeFile(path.join(evidence, 'browser-native.png'), bytes); result.screenshots.push({ path: path.join(evidence, 'browser-native.png'), surface: 'settled real native local page', bytes: bytes.length });
    await map();
    for (const [name, width, height] of [['desktop.png', 1520, 980], ['narrow.png', 1100, 760]]) {
      await fitAndReady(width, height);
      const geometry = await page.locator('.canvas-node').evaluateAll(nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').map(n => { const r = n.getBoundingClientRect(), title = n.querySelector('.title-button'), t = title.getBoundingClientRect(); return { title: title.textContent, x: r.x, y: r.y, width: r.width, height: r.height, titleHeight: t.height, titleWidth: t.width, font: getComputedStyle(title).fontFamily }; }));
      assertNoOverlap(geometry); assert(geometry.every(n => n.titleHeight >= 9 && n.titleWidth > 20), 'map titles must have legible physical size');
      const target = path.join(evidence, name); await page.screenshot({ path: target }); result.screenshots.push({ path: target, width, height, surface: 'real app renderer overview, SYNTHETIC fixture', geometry });
    }
    await viewport(1520, 980); await palette('E2E T2'); await focused().locator('.status-dot.running').waitFor();
    await settledTerminal('current-build overview -> terminal focus before output');
    await focused().locator('.terminal-host').click({ position: { x: 30, y: 45 } });
    await page.keyboard.type("i=1; while [ \"$i\" -le 50 ]; do printf 'BUILD_LINE_%02d__LOWER_REGION_OK\\n' \"$i\"; i=$((i+1)); done; printf 'BUILD_FINAL_%s\\n' 'CURSOR'"); await page.keyboard.press('Enter');
    const output = await poll(async () => { const a = await invoke('terminal.attach', { sessionId: sessions[1].id }); return a.data.includes('BUILD_FINAL_CURSOR') && a; }, '50 current-build lower-region lines');
    for (let i = 1; i <= 50; i++) assert(output.data.includes(`BUILD_LINE_${String(i).padStart(2, '0')}__LOWER_REGION_OK`));
    result.focusedTerminalEvidence = await settledTerminal('>=500ms paint and stable actual viewport/PTY after 50-line output');
    const terminal = result.focusedTerminalEvidence;
    assert.equal(terminal.dom.viewport.width, 1520); assert.equal(terminal.dom.viewport.height, 980); assert(terminal.native.session.rows > 30);
    assert(terminal.dom.elements['.xterm-screen'].bounds.height >= terminal.dom.elements['.xterm-viewport'].bounds.height - 32);
    assert(terminal.dom.rows.filter(r => r.bounds.y > 508 && /BUILD_LINE_/.test(r.text)).length > 10, 'real labelled DOM rows cross previous lower-region boundary');
    const focusedBytes = await page.screenshot();
    result.focusedTerminalPixels = await app.evaluate(({ nativeImage }, { base64, bounds }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64')), size = image.getSize(), data = image.toBitmap();
      const left = Math.ceil(bounds.x + 20), right = Math.floor(bounds.x + bounds.width - 20), top = Math.ceil(Math.max(520, bounds.y + bounds.height / 2)), bottom = Math.floor(bounds.bottom - 10);
      let count = 0, black = 0, background = 0, bright = 0;
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const i = (y * size.width + x) * 4, b = data[i], g = data[i + 1], r = data[i + 2]; count++; if (r < 4 && g < 4 && b < 4) black++; if (Math.abs(r - 19) < 4 && Math.abs(g - 29) < 4 && Math.abs(b - 44) < 4) background++; if (r > 100 && g > 100 && b > 100) bright++; }
      return { image: size, region: { left, right, top, bottom }, pixels: count, blackRatio: black / count, expectedBackgroundRatio: background / count, brightPixels: bright };
    }, { base64: focusedBytes.toString('base64'), bounds: terminal.dom.elements['.xterm-screen'].bounds });
    assert(result.focusedTerminalPixels.blackRatio < 0.005); assert(result.focusedTerminalPixels.expectedBackgroundRatio > 0.8); assert(result.focusedTerminalPixels.brightPixels > 200);
    await fs.writeFile(path.join(evidence, 'focused-terminal.png'), focusedBytes); result.screenshots.push({ path: path.join(evidence, 'focused-terminal.png'), surface: 'settled real running PTY, 50 verified lines and lower-region cursor/output', width: 1520, height: 980 });
    await inspector('tasks'); await tools().locator('article.tw-item').filter({ has: page.locator('strong', { hasText: /^SYNTHETIC E2E task$/ }) }).getByLabel('Estado local').waitFor();
    await settledTerminal('tools capture terminal resized and paint stable');
    await page.screenshot({ path: path.join(evidence, 'tools.png') }); result.screenshots.push({ path: path.join(evidence, 'tools.png'), surface: 'real persisted task inspector' });
    result.visualInspection = 'Pending agent image reads; screenshot write alone is not a visual pass';
  });
  await check('immediate native window.close handshake drains note+geometry edits; disk and live PTY', async () => {
    await closeInspector(); await palette('E2E Note'); await focused().locator('.note-editor').fill('SYNTHETIC final close-handshake durable note'); await map();
    const node = page.locator('.canvas-node').filter({ has: page.getByLabel('Nota: E2E Note', { exact: true }) }); const before = (await workspace()).nodes.find(n => n.id === noteId);
    await node.getByLabel('Cambiar tamaño del panel').focus(); await page.keyboard.press('ArrowDown'); await closeUI();
    const disk = JSON.parse(await fs.readFile(path.join(home, 'state.json'), 'utf8')); const saved = disk.workspaces.find(w => w.id === workspaceId); const note = saved.nodes.find(n => n.id === noteId);
    assert.equal(note.data.text, 'SYNTHETIC final close-handshake durable note'); assert.equal(note.height, before.height + 24); process.kill(sessions[1].pid, 0); result.savedWorkspace = saved; return { note, alivePid: sessions[1].pid, sessionId: sessions[1].id };
  }, true);
  await check('warm restart same profile reattaches exact SAME PID/session, no new shell, task continuity', async () => {
    await launch(); const list = await invoke('terminal.list', { workspaceId }); assert.equal(list.length, 3); const live = list.find(s => s.id === sessions[1].id); assert.equal(live.pid, sessions[1].pid); assert.equal(live.status, 'running');
    assert((await invoke('terminal.attach', { sessionId: live.id })).data.includes('E2E_1_21')); assert((await workspace()).tasks.some(t => t.title === 'SYNTHETIC voice task')); assert.equal((await workspace()).tasks.find(t => t.title === 'SYNTHETIC E2E task').status, 'doing');
    await palette('E2E T2'); await focused().locator('.status-dot.running').waitFor(); return list;
  }, true);
  await check('explicit host shutdown -> exited/null PID, retained history/layout, no auto shells', async () => {
    const before = await workspace(); await closeUI(true); await launch(); const after = await workspace(); assert.deepEqual(after.nodes, before.nodes);
    const list = await invoke('terminal.list', { workspaceId }); assert.equal(list.length, 3); assert(list.every(s => s.status === 'exited' && s.pid === null));
    const a = await invoke('terminal.attach', { sessionId: sessions[1].id }); assert.equal(a.session.status, 'exited'); assert(a.data.includes('E2E_1_21')); return { list, history: a.data };
  }, true);
  await check('unexpected crash of ONLY known fixture daemon -> lost/null PID and no restored shell', async () => {
    await page.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click(); await focused().getByRole('button', { name: 'Terminal', exact: true }).waitFor(); await focused().locator('.status-dot.running').waitFor(); await renameFocused('E2E Crash Fixture');
    const node = (await workspace()).nodes.find(n => n.title === 'E2E Crash Fixture'); await focused().locator('.xterm-helper-textarea').focus(); await page.keyboard.type("printf '\\nCRASH_%s\\n' 'PERSISTED'"); await page.keyboard.press('Enter');
    const a = await poll(async () => { const a = await invoke('terminal.attach', { sessionId: node.data.sessionId }); return a.data.includes('CRASH_PERSISTED') && a; }, 'crash fixture output'); ownedShells.add(a.session.pid);
    await poll(async () => JSON.parse(await fs.readFile(path.join(home, 'terminals.json'), 'utf8')).some(s => s.id === a.session.id && s.status === 'running' && s.snapshot?.includes('CRASH_PERSISTED')), 'running history persisted before crash');
    const host = await hostInfo(); await closeUI(); await signalOwnedHost(host.pid, 'SIGKILL');
    await poll(async () => { try { const stat = await fs.readFile(`/proc/${host.pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z'); } catch (e) { if (e.code === 'ENOENT') return true; throw e; } }, 'only owned host crash');
    await launch(); const list = await invoke('terminal.list', { workspaceId }); assert.equal(list.length, 4); assert(!list.some(s => s.status === 'running' || s.pid));
    const restored = await invoke('terminal.attach', { sessionId: a.session.id }); assert.equal(restored.session.status, 'lost'); assert.equal(restored.session.pid, null); assert(restored.data.includes('CRASH_PERSISTED')); return restored;
  });
  await check('no uncaught renderer errors or tool error boundary crashes', async () => { assert.deepEqual(result.pageErrors, []); assert.equal(await page.locator('.recovery-screen').count(), 0); return result.console; });
} catch (error) { result.blocker = { message: error.message, stack: error.stack }; console.error(`BLOCKER ${error.message}`); }
finally { await finish(); }
console.log(JSON.stringify(result.summary));
process.exitCode = result.summary.failed || result.blocker ? 1 : 0;

// RC-01 only: no rerun of the core suite or mutation of its execution ledger.
async function runRecapture() {
  const fixture = await fs.mkdtemp('/tmp/opencode/phantom-rc01-');
  const profile = path.join(fixture, 'profile'), folder = path.join(fixture, 'SYNTHETIC-RC01');
  await fs.mkdir(folder); await fs.mkdir(evidence, { recursive: true });
  try { await fs.copyFile(path.join(evidence, 'recapture-checks.json'), path.join(evidence, `recapture-setup-attempt-${Date.now()}.json`), 1); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const report = { finding: 'RC-01', startedAt: new Date().toISOString(), executable, build: JSON.parse(await fs.readFile(path.join(path.dirname(executable), 'BUILD.json'), 'utf8')), fixture, profile, checks: [], measurements: [], screenshots: [], console: [], pageErrors: [], resizeDescription: 'One keyboard width resize of the terminal panel in overview between focus cycles; window remains 1520x980.', priorLedgerModified: false };
  let desktop, window, wid, sid, daemon;
  const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label, timeout = 7000) => { const end = Date.now() + timeout; do { const value = await fn(); if (value) return value; await snooze(60); } while (Date.now() < end); throw new Error(`Timed out: ${label}`); };
  const api = (method, payload = {}) => window.evaluate(([m, p]) => globalThis.phantom.invoke(m, p), [method, payload]);
  const ws = async () => (await api('state.get')).workspaces.find(w => w.id === wid);
  const focus = () => window.locator('.canvas-node.focused');
  const flush = () => wait(async () => await window.locator('.save-state').textContent() === 'Guardado', 'UI saved');
  const returnToMap = async () => { await window.locator('.focus-return button').click(); await window.locator('.canvas').focus(); };
  const selectTarget = async () => {
    await window.locator('.canvas').focus(); await window.keyboard.press('Control+k'); await window.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill('RC01 T2');
    assert.equal(await window.getByRole('option').count(), 1); await window.keyboard.press('Enter'); await focus().getByRole('button', { name: 'RC01 T2', exact: true }).waitFor();
  };
  const check = async (name, fn) => {
    try { const details = await fn(); report.checks.push({ name, status: 'passed', details }); console.log(`PASS RC01 ${name}`); return true; }
    catch (error) { report.checks.push({ name, status: 'failed', error: error.message, stack: error.stack }); console.error(`FAIL RC01 ${name}: ${error.message}`); return false; }
  };
  const measure = async stage => {
    const session = (await api('terminal.attach', { sessionId: sid })).session;
    const dom = await focus().evaluate(node => {
      const selectors = ['.terminal-host', '.xterm', '.xterm-viewport', '.xterm-screen', '.xterm-rows', '.xterm-helper-textarea', '.xterm-cursor'];
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      const elements = Object.fromEntries(selectors.map(selector => { const el = node.querySelector(selector); if (!el) return [selector, null]; const css = getComputedStyle(el); return [selector, { bounds: rect(el), clientWidth: el.clientWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, css: { backgroundColor: css.backgroundColor, height: css.height, paddingTop: css.paddingTop, paddingBottom: css.paddingBottom, overflow: css.overflow, position: css.position, lineHeight: css.lineHeight }, childCount: el.childElementCount }]; }));
      return { viewport: { width: innerWidth, height: innerHeight }, elements, visibleRows: [...node.querySelectorAll('.xterm-rows>div')].map(el => ({ text: el.textContent, bounds: rect(el) })), canvases: [...node.querySelectorAll('.xterm canvas')].map(el => ({ width: el.width, height: el.height, bounds: rect(el) })) };
    });
    const measurement = { stage, at: new Date().toISOString(), session, dom }; report.measurements.push(measurement); return measurement;
  };
  const settle = async stage => {
    // Requested minimum paint/fit interval is explicit; actual readiness also requires stable host + DOM geometry.
    await snooze(500);
    let previous, stableSince;
    await wait(async () => {
      const a = await api('terminal.attach', { sessionId: sid });
      const d = await focus().locator('.xterm-screen').boundingBox();
      const signature = JSON.stringify([a.session.cols, a.session.rows, d]);
      if (signature !== previous) { previous = signature; stableSince = Date.now(); }
      return a.session.status === 'running' && Date.now() - stableSince >= 300;
    }, 'host cols/rows + screen bounds stable');
    return measure(stage);
  };
  const pixels = async (bytes, measurement) => desktop.evaluate(({ nativeImage }, { base64, box, viewport }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64')), size = image.getSize(), bitmap = image.toBitmap();
    const sx = size.width / viewport.width, sy = size.height / viewport.height;
    const left = Math.ceil((box.x + 20) * sx), right = Math.floor((box.x + box.width - 20) * sx);
    const top = Math.ceil(Math.max(520, box.y + box.height / 2) * sy), bottom = Math.floor((box.bottom - 10) * sy);
    let count = 0, black = 0, background = 0, bright = 0, minRowBackground = 1;
    for (let y = top; y < bottom; y++) { let rowBackground = 0;
      for (let x = left; x < right; x++) { const i = (y * size.width + x) * 4, b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2]; count++;
        if (r < 4 && g < 4 && b < 4) black++;
        if (Math.abs(r - 19) <= 3 && Math.abs(g - 29) <= 3 && Math.abs(b - 44) <= 3) { background++; rowBackground++; }
        if (r > 100 && g > 100 && b > 100) bright++;
      }
      minRowBackground = Math.min(minRowBackground, rowBackground / (right - left));
    }
    return { image: size, region: { left, right, top, bottom }, samples: count, blackRatio: black / count, expectedBackground: '#131d2c', expectedBackgroundRatio: background / count, brightPixels: bright, minRowBackgroundRatio: minRowBackground };
  }, { base64: bytes.toString('base64'), box: measurement.dom.elements['.xterm-screen'].bounds, viewport: measurement.dom.viewport });
  const timeout = setTimeout(() => { desktop?.process().kill('SIGKILL'); }, 110000);
  try {
    const env = { ...process.env, DISPLAY: ':1', SHELL: '/bin/sh', PHANTOM_WORKSPACE_HOME: profile };
    for (const key of ['ELECTRON_RUN_AS_NODE', 'PHANTOM_RENDERER_URL', 'PHANTOM_NODE_BINARY', 'PHANTOM_CLI', 'PHANTOM_HOME', 'PLAYWRIGHT_BROWSERS_PATH', 'NODE_PATH', 'NODE_OPTIONS']) delete env[key];
    desktop = await electron.launch({ executablePath: executable, args: [], cwd: fixture, env, timeout: 15000 });
    window = await desktop.firstWindow(); window.setDefaultTimeout(5000);
    window.on('pageerror', error => report.pageErrors.push(error.stack || error.message)); window.on('console', message => { if (['warning', 'error'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
    await window.waitForSelector('.app-shell'); daemon = (await api('system.info')).pid;
    await wait(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), 'native window shown before viewport setup');
    report.nativeWindowConstraint = await desktop.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1520, 980); const b = w.getBounds(); w.setMinimumSize(b.width, b.height); w.setMaximumSize(b.width, b.height); w.setResizable(false); return { bounds: w.getBounds(), contentSize: w.getContentSize(), reason: 'Prevent compositor shrinking the diagnostic surface to native minimum while testing fixed 1520x980 viewport' }; }); await window.waitForFunction(() => innerWidth === 1520 && innerHeight === 980);
    await check('same packaged executable and build; isolated profile; no sandbox flag', async () => { const info = await api('desktop.info'); assert.equal(info.packaged, true); assert.equal(info.dataDir, profile); assert.equal(report.build.builtAt, '2026-11-11T06:49:14.687Z'); return info; });
    wid = (await api('workspace.open', { path: folder })).id; await window.waitForSelector('.create-dock');
    // Configure only isolated native data before opening any task tools.
    await window.getByRole('button', { name: 'Herramientas del proyecto', exact: true }).click(); await window.getByLabel('Herramienta contextual').selectOption('settings');
    await window.getByLabel('Datos nativos de Phantom', { exact: false }).fill(path.join(fixture, 'native-phantom')); await window.getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
    await wait(async () => (await api('state.get')).settings.phantomData === path.join(fixture, 'native-phantom'), 'native isolation'); await window.locator('.inspector-switcher button').click();
    for (let i = 1; i <= 3; i++) {
      await window.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click(); await focus().getByRole('button', { name: 'Terminal', exact: true }).waitFor(); await focus().locator('.status-dot.running').waitFor();
      await focus().locator('.title-button').click(); await focus().getByLabel('Nombre del panel', { exact: true }).fill(`RC01 T${i}`); await focus().getByLabel('Nombre del panel', { exact: true }).press('Enter'); await wait(async () => (await ws()).nodes.some(n => n.title === `RC01 T${i}`), 'terminal rename');
    }
    for (let i = 0; i < 3; i++) { await window.locator('.create-dock').getByRole('button', { name: 'Nota', exact: true }).click(); await focus().getByRole('button', { name: 'Nota', exact: true }).waitFor(); await focus().locator('.note-editor').fill('SYNTHETIC RC-01 layout fixture'); await flush(); }
    sid = (await ws()).nodes.find(n => n.title === 'RC01 T2').data.sessionId;
    await returnToMap(); await window.getByLabel('Ajustar todos los paneles', { exact: true }).click(); await flush(); report.overviewCamera = (await ws()).camera;
    await selectTarget(); const initial = await settle('initial overview -> focused, >=500ms and dimensions stable');
    await check('active terminal viewport and screen fill focused host height', async () => {
      const e = initial.dom.elements, host = e['.terminal-host'], viewport = e['.xterm-viewport'], screen = e['.xterm-screen'];
      assert.equal(initial.dom.viewport.width, 1520); assert.equal(initial.dom.viewport.height, 980);
      assert(viewport.bounds.height >= host.clientHeight - 20, 'viewport should fill host minus padding');
      assert(screen.bounds.height >= viewport.bounds.height - 32, 'screen must fit viewport minus 12px padding and less than one 18px cell, not old overview rows'); assert(initial.session.rows > 30, 'focused PTY should have >30 rows'); return initial;
    });
    const initialBytes = await window.screenshot(); const initialPath = path.join(evidence, 'recapture-initial.png'); await fs.writeFile(initialPath, initialBytes); report.screenshots.push({ path: initialPath, purpose: 'one initial settled diagnostic, before 50-line stimulus' }); report.initialPixels = await pixels(initialBytes, initial);
    await check('50 portable shell lines independently verified in native history', async () => {
      await focus().locator('.xterm-helper-textarea').focus();
      await window.keyboard.type("i=1; while [ \"$i\" -le 50 ]; do printf 'RC01_LINE_%02d__LOWER_REGION_OK\\n' \"$i\"; i=$((i+1)); done; printf 'RC01_END_%s\\n' 'CURSOR'"); await window.keyboard.press('Enter');
      const a = await wait(async () => { const a = await api('terminal.attach', { sessionId: sid }); return a.data.includes('RC01_END_CURSOR') && a; }, '50-line PTY output');
      for (let i = 1; i <= 50; i++) assert(a.data.includes(`RC01_LINE_${String(i).padStart(2, '0')}__LOWER_REGION_OK`)); report.output = a; return { session: a.session, verifiedLabels: 50, seq: a.seq };
    });
    await measure('after 50-line output before focus cycle');
    // One unfocus/refocus cycle, with exactly one real terminal-panel resize in overview.
    await returnToMap(); const node = window.locator('.canvas-node').filter({ has: window.getByRole('button', { name: 'RC01 T2', exact: true }) });
    const before = (await ws()).nodes.find(n => n.title === 'RC01 T2'); await node.getByLabel('Cambiar tamaño del panel').focus(); await window.keyboard.press('ArrowRight');
    await wait(async () => (await ws()).nodes.find(n => n.id === before.id).width === before.width + 24, 'one panel resize persisted'); await selectTarget();
    await settle('one unfocus/refocus plus one panel resize, settled');
    await focus().locator('.xterm-helper-textarea').focus(); await window.keyboard.type("printf 'RC01_FINAL_%s\\n' 'CURSOR'"); await window.keyboard.press('Enter');
    await wait(async () => (await api('terminal.attach', { sessionId: sid })).data.includes('RC01_FINAL_CURSOR'), 'final cursor marker');
    await wait(async () => await window.locator('.toast-stack .toast').count() === 0, 'toasts dismissed', 9000);
    const final = await settle('final output, focused viewport settled');
    const finalBytes = await window.screenshot(); report.finalPixels = await pixels(finalBytes, final);
    const lowerPass = await check('lower region has continuous expected background and rendered output after cycle/resize', async () => {
      const p = report.finalPixels; assert(p.samples > 100000); assert(p.blackRatio < 0.005, `black lower ratio ${p.blackRatio}`); assert(p.expectedBackgroundRatio > 0.8, `expected background ratio ${p.expectedBackgroundRatio}`); assert(p.minRowBackgroundRatio > 0.6, 'every lower scanline should have continuous expected background'); assert(p.brightPixels > 200, 'actual glyphs/cursor must exist below y520');
      const lowerRows = final.dom.visibleRows.filter(row => row.bounds.y > 508 && /RC01_LINE_|RC01_FINAL_|RC01_END_/.test(row.text));
      if (final.dom.visibleRows.length) assert(lowerRows.length > 10, 'labelled DOM rows should cross previous black boundary');
      return { pixelEvidence: p, labelledLowerRows: lowerRows, cursor: final.dom.elements['.xterm-cursor'] };
    });
    const target = path.join(evidence, lowerPass ? 'focused-terminal.png' : 'recapture-final-diagnostic.png');
    if (lowerPass) { try { await fs.copyFile(path.join(evidence, 'focused-terminal.png'), path.join(evidence, 'focused-terminal.before-RC01.png'), 1); } catch (e) { if (!['ENOENT', 'EEXIST'].includes(e.code)) throw e; } }
    await fs.writeFile(target, finalBytes); report.screenshots.push({ path: target, purpose: lowerPass ? 'single final required replacement after diagnostics' : 'single final diagnostic; required image not replaced' });
    report.diagnosis = lowerPass ? { status: 'settled full-height terminal and lower-region output verified', initialArtifact: report.initialPixels.blackRatio < 0.005 ? 'Prior image was consistent with pre-fit capture: settled initial recovery already has full-height fit and no lower black rectangle. Timing cause inferred from evidence, not a source fix or proof that waiting solves every case.' : 'Initial settled recovery still showed black pixels; after output/focus cycle/panel resize final image passed. Review measurements for exact differences; no source fix claimed.', dimensions: { initial: initial.session, final: final.session }, noAppChanges: true } : { status: 'RC-01 persists or recurs', sourceOwnership: 'src/components/TerminalPanel.jsx resize/fit/paint integration; DOM/pixel/native dimensions recorded, no source patch', noAppChanges: true };
    await check('optional tools screenshot uses scoped task target; prior failure was diagnostic, not core', async () => {
      await window.getByRole('button', { name: 'Herramientas del proyecto', exact: true }).click(); await window.getByLabel('Herramienta contextual').selectOption('tasks'); const inspector = window.locator('.inspector-host');
      await inspector.getByLabel('Título', { exact: true }).fill('SYNTHETIC RC01 task'); await inspector.getByLabel('Descripción / checklist').fill('Targeted optional evidence recovery only'); await inspector.getByRole('button', { name: 'Crear tarea local', exact: true }).click();
      const row = inspector.locator('article.tw-item').filter({ has: window.locator('strong', { hasText: /^SYNTHETIC RC01 task$/ }) }); await row.getByLabel('Estado local').waitFor();
      await wait(async () => await window.locator('.toast-stack .toast').count() === 0, 'task toast dismissed', 9000);
      const p = path.join(evidence, 'tools.png'); await window.screenshot({ path: p }); report.screenshots.push({ path: p, purpose: 'optional tools capture completed with scoped locator' }); return { task: (await ws()).tasks.find(t => t.title === 'SYNTHETIC RC01 task') };
    });
    await check('no renderer errors in targeted recovery', async () => { assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.console, []); });
  } catch (error) { report.blocker = { message: error.message, stack: error.stack, windowGeometry: await desktop?.evaluate(({ BrowserWindow, screen }) => ({ windows: BrowserWindow.getAllWindows().map(w => ({ bounds: w.getBounds(), contentSize: w.getContentSize(), visible: w.isVisible() })), displays: screen.getAllDisplays().map(d => ({ bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor })) })).catch(() => null), rendererGeometry: await window?.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })).catch(() => null) }; console.error(error.stack); }
  finally {
    clearTimeout(timeout);
    if (desktop) { try { await Promise.race([api('desktop.quit', { stopHost: true }), snooze(1500)]); } catch {} try { desktop.process().kill('SIGKILL'); } catch {} }
    if (daemon) { try { const args = (await fs.readFile(`/proc/${daemon}/cmdline`, 'utf8')).split('\0'); if (args.includes(profile) && args.some(a => a.endsWith('/host/server.mjs'))) process.kill(daemon, 'SIGTERM'); } catch {} }
    report.finishedAt = new Date().toISOString(); report.summary = { passed: report.checks.filter(c => c.status === 'passed').length, failed: report.checks.filter(c => c.status === 'failed').length }; report.agentImageReview = 'Pending image reads; pixel checks alone do not substitute for review';
    await fs.writeFile(path.join(evidence, 'recapture-checks.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report.summary)); process.exitCode = report.summary.failed || report.blocker ? 1 : 0;
}
