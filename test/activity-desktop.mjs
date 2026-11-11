import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, _electron as electron } from 'playwright';

// Production React UI served by Vite. Only this test installs a synthetic bridge;
// no fixture switch, data or fallback is shipped in the renderer/host.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/activity-desktop-');
const report = { temp, checks: [], consoleErrors: [], pageErrors: [], screenshots: [], backend: '', lifecycle: [], electronStderr: '' };
let vite, browser, app, page;
let cleaningUp = false;
function fixtureBridge() {
  const listeners = new Set(), calls = [], events = [], failures = {}, holds = {}, pending = [];
  const stamp = () => new Date().toISOString();
  const node = (id, sessionId, hidden = false) => ({ id, type: 'terminal', title: hidden ? 'Agente oculto' : 'Shell local', x: 40, y: 40, width: 640, height: 400, data: { sessionId, hidden } });
  const workspaces = [
    { id: 'w1', name: 'Proyecto Uno', path: '/fixture/uno', canonicalPath: '/fixture/uno', camera: { x: 30, y: 25, zoom: .85 }, nodes: [node('n1', 's1'), node('n2', 's2', true)], tasks: [], missions: [], contextRefs: [], workflows: [], attention: [], phantomControllers: [] },
    { id: 'w2', name: 'Proyecto Dos', path: '/fixture/dos', canonicalPath: '/fixture/dos', camera: { x: 30, y: 25, zoom: 1 }, nodes: [], tasks: [], missions: [], contextRefs: [], workflows: [], attention: [], phantomControllers: [] },
  ];
  const state = { version: 1, activeWorkspaceId: 'w1', workspaces, settings: {} };
  const sessions = {
    w1: [{ id: 's1', workspaceId: 'w1', nodeId: 'n1', status: 'running', cols: 80, rows: 24, generation: 'g1', seq: 0, cwd: '/fixture/uno', provider: 'shell' }, { id: 's2', workspaceId: 'w1', nodeId: 'n2', status: 'running', cols: 80, rows: 24, generation: 'g2', seq: 0, cwd: '/fixture/feature', worktree: { branch: 'feature/real', path: '/fixture/feature' } }],
    w2: [],
  };
  const tasks = { w1: [{ id: 'task-1', title: 'Revisar contrato real de prueba', status: 'blocked', source: 'phantom', raw: { id: 'task-1', sessionId: 's2', contract: { workspace: '/fixture/feature' } } }], w2: [] };
  const notices = { w1: [{ id: 'notice-1', title: 'Proceso finalizado · no implica aceptación', status: 'completed', source: 'phantom', observedAt: stamp() }], w2: [] };
  const emit = event => { events.push({ type: event.type, workspaceId: event.workspaceId, at: performance.now() }); for (const listener of listeners) listener(event); };
  window.__activityTest = {
    calls, events, emit,
    idleFor() {
      const relevant = events.filter(event => event.type !== 'terminal.output').at(-1)?.at || 0;
      const catalog = calls.filter(call => ['terminal.list', 'phantom.list', 'git.inspect', 'attention.list', 'node.update'].includes(call.method)).at(-1)?.at || 0;
      return performance.now() - Math.max(relevant, catalog);
    },
    pendingCount() { return pending.length; },
    taskStatus(status) { tasks.w1[0].status = status; emit({ type: 'tool.status', workspaceId: 'w1', status }); },
    fail(method, value) { failures[method] = value; },
    hold(method, workspaceId) { holds[`${method}:${workspaceId}`] = true; },
    release() { for (const key of Object.keys(holds)) delete holds[key]; for (const resolve of pending.splice(0)) resolve(); },
  };
  window.phantom = {
    onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async invoke(method, payload = {}) {
      calls.push({ method, payload, at: performance.now() });
      if (failures[method]) throw new Error(`Fallo de prueba en ${method}`);
      const workspace = workspaces.find(w => w.id === (payload.workspaceId || payload.id || state.activeWorkspaceId));
      let result;
      switch (method) {
        case 'state.get': result = state; break;
        case 'terminal.list': result = sessions[payload.workspaceId]; break;
        case 'phantom.list': result = { available: true, items: tasks[payload.workspaceId], observedAt: stamp() }; break;
        case 'attention.list': result = notices[payload.workspaceId]; break;
        case 'git.inspect': result = { available: true, observedAt: stamp(), root: '/fixture/uno', branch: 'main', branches: [{ name: 'main', current: true, ...(payload.base ? { merged: true, ahead: 0, behind: 0 } : {}) }, { name: 'feature/real', ...(payload.base ? { merged: false, ahead: 2, behind: 1 } : {}) }, { name: `sin-vinculo-${'largo'.repeat(30)}`, ...(payload.base ? { merged: false, ahead: 1, behind: 0 } : {}) }], worktrees: [{ branch: 'feature/real', path: '/fixture/feature' }], ...(payload.base ? { base: payload.base, comparison: { baseOid: 'abcdef123456789' } } : {}) }; break;
        case 'workspace.select': state.activeWorkspaceId = payload.id; emit({ type: 'state.changed' }); result = workspace; break;
        case 'workspace.update': Object.assign(workspace, payload.patch); emit({ type: 'state.changed', workspaceId: workspace.id }); result = workspace; break;
        case 'node.update': { const n = workspace.nodes.find(n => n.id === payload.id); Object.assign(n, payload.patch); emit({ type: 'state.changed', workspaceId: workspace.id }); result = n; break; }
        case 'terminal.attach': { const session = Object.values(sessions).flat().find(s => s.id === payload.sessionId); result = { session, seq: 0, data: 'Terminal de prueba\r\n$ ' }; break; }
        case 'terminal.resize': case 'terminal.write': result = { ok: true }; break;
        case 'attention.ack': { const notice = notices[payload.workspaceId].find(n => n.id === payload.id); notice.acknowledgedAt = stamp(); emit({ type: 'state.changed', workspaceId: payload.workspaceId }); result = notice; break; }
        case 'playground.list': case 'automation.list': result = { available: true, items: [] }; break;
        default: throw new Error(`Método de bridge no declarado en el test: ${method}`);
      }
      // Capture at request time so held answers genuinely represent stale data.
      result = structuredClone(result);
      if (holds[`${method}:${payload.workspaceId}`]) await new Promise(resolve => pending.push(resolve));
      return result;
    },
  };
}
async function check(name, fn) {
  try { await fn(); report.checks.push({ name, passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack || error.message }); throw error; }
}
async function until(predicate, timeout = 8000) {
  const end = Date.now() + timeout;
  do { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < end);
  throw new Error('Se agotó el tiempo de espera de la condición de UI');
}
const fixture = (fn, arg) => page.evaluate(fn, arg);
const notch = () => page.getByRole('button', { name: 'Actividad del proyecto', exact: true });
const tray = () => page.getByRole('dialog', { name: 'Actividad del proyecto' });
async function capture(name) { const file = path.join(temp, `${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file); }
async function viewport(width, height) {
  if (app) await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
  else await page.setViewportSize({ width, height });
}
async function noOverflow() {
  const layout = await page.evaluate(() => {
    const selectors = ['.activity-notch', '.activity-tray', '.activity-scroll', '.activity-section', '.activity-row', '.activity-branch'];
    return { document: document.documentElement.scrollWidth > innerWidth, elements: selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(el => el.scrollWidth > el.clientWidth + 2).map(el => ({ selector, width: el.clientWidth, scroll: el.scrollWidth }))) };
  });
  assert.equal(layout.document, false); assert.deepEqual(layout.elements, []);
}
try {
  vite = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await vite.listen();
  const address = vite.httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.PHANTOM_TEST_CHROMIUM ? { executablePath: process.env.PHANTOM_TEST_CHROMIUM } : {}) });
    page = await browser.newPage(); report.backend = 'Playwright Chromium + Vite';
  } catch (error) {
    report.chromiumUnavailable = error.message;
    const main = path.join(temp, 'activity-electron.cjs');
    await mkdir(path.join(temp, 'electron-profile'), { recursive: true });
    // Electron windows need a strong module-level reference for their entire
    // lifetime. A callback-local wrapper can be collected and close the target
    // while Playwright is waiting between UI operations.
    await writeFile(main, `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(temp, 'electron-profile'))});
app.disableHardwareAcceleration();
let mainWindow;
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({ width: 1440, height: 960, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  mainWindow.webContents.on('render-process-gone', (_event, details) => console.error('activity-render-process-gone', JSON.stringify(details)));
  mainWindow.on('closed', () => { console.error('activity-window-closed'); mainWindow = null; });
  mainWindow.loadURL('about:blank');
});
app.on('window-all-closed', () => { mainWindow = null; app.quit(); });
`);
    const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1' }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', main], cwd: root, env });
    const child = app.process();
    child.stderr?.on('data', chunk => { report.electronStderr = (report.electronStderr + chunk.toString()).slice(-24000); });
    child.on('exit', (code, signal) => report.lifecycle.push({ event: 'electron-exit', code, signal, cleaningUp }));
    app.on('close', () => report.lifecycle.push({ event: 'electron-close', cleaningUp }));
    page = await app.firstWindow(); report.backend = 'Playwright Electron + Vite';
  }
  page.setDefaultTimeout(8000);
  page.on('crash', () => report.lifecycle.push({ event: 'renderer-crash', cleaningUp }));
  page.on('close', () => report.lifecycle.push({ event: 'page-close', cleaningUp }));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.addInitScript(fixtureBridge);
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  await viewport(1440, 960);
  await page.goto(url);
  await check('Notch persistente y semántica real de fuentes', async () => {
    await notch().waitFor();
    await until(async () => (await notch().innerText()).includes('1 necesita de ti'));
    assert.match(await notch().innerText(), /2.*sesiones/s);
    assert.match(await page.locator('.node-header .terminal-activity').innerText(), /sin señal del agente/);
    assert.match(await page.locator('.rail-panel-label .terminal-activity').innerText(), /sin señal del agente/);
    await notch().click();
    await tray().waitFor();
    for (const name of ['Necesitan de ti', 'Integración', 'Sesiones', 'Avisos']) await tray().getByRole('heading', { name: new RegExp(name) }).waitFor();
    assert.match(await tray().innerText(), /phantom\.list/);
    assert.match(await tray().innerText(), /Vista oculta/);
    assert.match(await tray().innerText(), /Desconocida/);
    await noOverflow(); await capture('desktop');
  });
  await check('Teclado, Escape y retorno de foco', async () => {
    const first = tray().locator('button:not(:disabled)').first();
    await first.focus(); await page.keyboard.press('Shift+Tab');
    assert.equal(await tray().locator('button:not(:disabled)').last().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab'); assert.equal(await first.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); await tray().waitFor({ state: 'detached' });
    await until(() => notch().evaluate(el => el === document.activeElement));
    await page.keyboard.press('Enter'); await tray().waitFor();
  });
  await check('Recuperar terminal oculta conserva sesión, foco y notch', async () => {
    await tray().getByRole('button', { name: 'Recuperar terminal', exact: false }).click();
    await tray().waitFor({ state: 'detached' });
    await page.locator('.canvas-node.focused .title-button').filter({ hasText: 'Agente oculto' }).waitFor();
    await notch().waitFor({ state: 'visible' });
    await until(() => page.locator('.canvas-node.focused .xterm-helper-textarea').evaluate(el => el === document.activeElement));
    assert.equal(await fixture(() => window.__activityTest.calls.some(c => c.method === 'terminal.create')), false);
    await notch().click();
    assert.equal(await tray().getByRole('button', { name: 'Recuperar terminal', exact: false }).count(), 0);
  });
  await check('Comparación explícita, vínculos y teclado sin escribir al PTY', async () => {
    const before = await fixture(() => window.__activityTest.calls.filter(c => c.method === 'terminal.write').length);
    await tray().getByLabel('Base explícita de comparación').fill('main');
    await tray().getByRole('button', { name: 'Comparar', exact: true }).click();
    await until(async () => (await tray().innerText()).includes('2 pendientes frente a base'));
    assert.match(await tray().innerText(), /Ahead 2 \/ behind 1/);
    assert.match(await tray().innerText(), /No integrada/);
    assert.match(await tray().innerText(), /vínculo worktree/);
    assert.match(await tray().innerText(), /Sin asociación de sesión o tarea acreditada/);
    assert.equal(await fixture(() => window.__activityTest.calls.filter(c => c.method === 'terminal.write').length), before);
    await tray().getByRole('button', { name: 'Marcar leído', exact: true }).click();
    await until(async () => (await tray().innerText()).includes('0 sin leer'));
    assert.match(await notch().innerText(), /1 necesita de ti/);
    assert.equal(await fixture(() => window.__activityTest.calls.some(c => /approve|merge/.test(c.method))), false);
  });
  await check('Eventos pertinentes coalescidos; salida PTY no refresca catálogos', async () => {
    // Recovering the hidden view queues node.update for 350 ms; its legitimate
    // state.changed invalidation must finish before isolating PTY-only traffic.
    await until(() => fixture(() => window.__activityTest.idleFor() >= 650));
    await until(() => tray().getByRole('button', { name: 'Reintentar / actualizar' }).isEnabled());
    const reads = () => fixture(() => window.__activityTest.calls.filter(c => c.method === 'phantom.list').length);
    const before = await reads();
    await fixture(() => { for (let i = 0; i < 100; i++) window.__activityTest.emit({ type: 'terminal.output', workspaceId: 'w1', sessionId: 's1', data: '', seq: 0 }); });
    await new Promise(resolve => setTimeout(resolve, 350)); assert.equal(await reads(), before);
    await fixture(() => { for (let i = 0; i < 12; i++) window.__activityTest.taskStatus('running'); });
    await until(async () => !(await notch().innerText()).includes('de ti'));
    assert.equal(await reads(), before + 1);
    assert.match(await page.locator('.canvas-node.focused .terminal-activity').innerText(), /agente/);
  });
  await check('Errores por fuente y retry operativo', async () => {
    await fixture(() => { window.__activityTest.fail('git.inspect', true); window.__activityTest.emit({ type: 'git.changed', workspaceId: 'w1' }); });
    await tray().getByText('Fallo de prueba en git.inspect', { exact: true }).waitFor();
    assert.match(await notch().innerText(), /Fuentes por revisar/);
    await fixture(() => window.__activityTest.fail('git.inspect', false));
    await tray().getByRole('button', { name: 'Reintentar / actualizar' }).click();
    await until(async () => !(await tray().innerText()).includes('Fallo de prueba'));
    await viewport(720, 760); await noOverflow();
    await tray().locator('.activity-scroll').evaluate(el => { el.scrollTop = 0; });
    await capture('narrow');
  });
  await check('Navegación directa al inspector Git y tareas', async () => {
    await tray().getByRole('button', { name: 'Abrir Git', exact: false }).click();
    await page.locator('.inspector-switcher select').waitFor();
    assert.equal(await page.locator('.inspector-switcher select').inputValue(), 'git');
    await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
    await fixture(() => window.__activityTest.taskStatus('blocked'));
    await until(async () => (await notch().innerText()).includes('necesita de ti'));
    await notch().click(); await tray().getByRole('button', { name: 'Revisar Revisar contrato real de prueba', exact: true }).click();
    assert.equal(await page.locator('.inspector-switcher select').inputValue(), 'tasks');
    await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  });
  await check('Cambio de workspace ignora respuestas antiguas y muestra vacío', async () => {
    await viewport(1440, 960);
    await fixture(() => { window.__activityTest.hold('phantom.list', 'w1'); window.__activityTest.emit({ type: 'task.updated', workspaceId: 'w1' }); });
    await until(() => fixture(() => window.__activityTest.pendingCount() > 0));
    await page.locator('.project-item').filter({ hasText: 'Proyecto Dos' }).click();
    await until(async () => (await page.locator('.workspace-identity').innerText()).includes('Proyecto Dos'));
    await fixture(() => window.__activityTest.release());
    await notch().click();
    await tray().getByText('No hay sesiones registradas en este proyecto.', { exact: true }).waitFor();
    assert.equal((await tray().innerText()).includes('Revisar contrato real de prueba'), false);
    assert.match(await notch().innerText(), /0.*sesiones/s);
  });
  await check('Desconexión invalida lecturas pendientes y reconexión recupera', async () => {
    await fixture(() => { window.__activityTest.hold('terminal.list', 'w2'); window.__activityTest.emit({ type: 'state.changed', workspaceId: 'w2' }); });
    await until(() => fixture(() => window.__activityTest.pendingCount() > 0));
    assert.match(await tray().locator('.activity-toolbar').innerText(), /Consultando fuentes/);
    await fixture(() => window.__activityTest.emit({ type: 'connection', status: 'disconnected' }));
    await until(async () => (await notch().innerText()).includes('Host desconectado'));
    await fixture(() => window.__activityTest.release());
    assert.equal(await tray().getByRole('button', { name: 'Reintentar / actualizar' }).isDisabled(), true);
    await fixture(() => window.__activityTest.emit({ type: 'connection', status: 'connected' }));
    await until(() => tray().getByRole('button', { name: 'Reintentar / actualizar' }).isEnabled());
    await noOverflow();
  });
  await check('Sin errores de consola o ejecución', async () => {
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
    assert.deepEqual(report.lifecycle.filter(event => !event.cleaningUp), []);
  });
} catch (error) {
  report.error = error.stack || error.message; process.exitCode = 1;
  if (page) await capture('failure').catch(() => {});
} finally {
  if (page) report.bridge = await fixture(() => ({ calls: window.__activityTest?.calls, events: window.__activityTest?.events })).catch(() => null);
  cleaningUp = true;
  await browser?.close().catch(error => { report.cleanupError = error.message; });
  await app?.close().catch(error => { report.cleanupError = error.message; });
  await vite?.close();
  report.passed = report.checks.filter(c => c.passed).length;
  report.failed = report.checks.filter(c => !c.passed).length + (report.error && !report.checks.some(c => !c.passed) ? 1 : 0);
  await writeFile(path.join(temp, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
