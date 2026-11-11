import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Isolated test-only bridge. Production still uses the real Electron bridge.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.mkdir('/tmp/opencode', { recursive: true });
const evidence = await fs.mkdtemp('/tmp/opencode/phantom-activity-');
const result = { evidence, checks: [], console: [], pageErrors: [], screenshots: [] };
let browser, server, page;
async function check(name, fn) {
  try { await fn(); result.checks.push({ name, status: 'passed' }); }
  catch (error) { result.checks.push({ name, status: 'failed', error: error.stack || error.message }); throw error; }
}
async function capture(name) {
  const file = path.join(evidence, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true }); result.screenshots.push(file);
}
try {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.PHANTOM_TEST_BROWSER) launch.executablePath = process.env.PHANTOM_TEST_BROWSER;
  try { browser = await chromium.launch(launch); }
  catch (initialError) {
    // Some desktop CI images provide Chromium without Playwright's download.
    let executable;
    for (const candidate of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
      if (await fs.access(candidate).then(() => true, () => false)) { executable = candidate; break; }
    }
    if (!executable || launch.executablePath) throw initialError;
    browser = await chromium.launch({ ...launch, executablePath: executable });
  }
  page = await browser.newPage({ viewport: { width: 1520, height: 980 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(8000);
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) result.console.push({ type: message.type(), text: message.text() }); });
  page.on('pageerror', error => result.pageErrors.push(error.stack || error.message));
  await page.addInitScript(() => {
    const listeners = new Set();
    const node = (id, sessionId, hidden) => ({ id, type: 'terminal', title: hidden ? 'Terminal oculta' : 'Shell visible', x: 40, y: 80, width: 640, height: 400, data: { sessionId, hidden } });
    const workspace = (id, name) => ({ id, name, path: `/fixture/${id}`, canonicalPath: `/fixture/${id}`, camera: { x: 0, y: 0, zoom: 1 }, nodes: [], tasks: [], attention: [], missions: [], workflows: [], contextRefs: [], services: [] });
    const a = workspace('a', 'Proyecto A'), b = workspace('b', 'Proyecto B');
    a.nodes = [node('n1', 's1', false), node('n2', 's2', true)];
    a.attention = [{ id: 'notice', title: 'Proceso finalizado · lectura pendiente', source: 'phantom', status: 'completed', createdAt: '2026-11-11T12:00:00Z' }];
    const state = { activeWorkspaceId: 'a', workspaces: [a, b], settings: {} };
    const sessions = [{ id: 's1', nodeId: 'n1', workspaceId: 'a', status: 'running', cols: 80, rows: 24, cwd: '/fixture/a' }, { id: 's2', nodeId: 'n2', workspaceId: 'a', status: 'running', cols: 80, rows: 24, cwd: '/fixture/feature' }];
    const fixture = window.activityFixture = {
      fail: {}, calls: [], taskState: 'blocked', hold: false, pending: [],
      emit: event => [...listeners].forEach(fn => fn(event)),
      release: () => { fixture.pending.splice(0).forEach(resolve => resolve({ available: true, items: [{ id: 'stale', title: 'STALE_RESULT_FORBIDDEN', status: 'failed' }] })); fixture.hold = false; },
    };
    window.phantom = {
      onEvent: callback => { listeners.add(callback); return () => listeners.delete(callback); },
      invoke: async (method, payload = {}) => {
        fixture.calls.push({ method, payload });
        if (fixture.fail[method]) throw new Error(`Fallo de prueba: ${method}`);
        const w = state.workspaces.find(w => w.id === payload.workspaceId) || state.workspaces.find(w => w.id === state.activeWorkspaceId);
        switch (method) {
          case 'state.get': return structuredClone(state);
          case 'workspace.select': state.activeWorkspaceId = payload.id; fixture.emit({ type: 'state.changed', workspaceId: payload.id }); return structuredClone(state.workspaces.find(w => w.id === payload.id));
          case 'node.update': { const n = w.nodes.find(n => n.id === payload.id); Object.assign(n, payload.patch); fixture.emit({ type: 'state.changed', workspaceId: w.id }); return structuredClone(n); }
          case 'terminal.list': return structuredClone(sessions.filter(s => s.workspaceId === payload.workspaceId));
          case 'terminal.attach': return { session: structuredClone(sessions.find(s => s.id === payload.sessionId)), data: 'Fixture shell\r\n$ ', seq: 0 };
          case 'terminal.resize': case 'terminal.write': return { ok: true };
          case 'phantom.list':
            if (payload.topic !== 'tasks') return { available: true, items: [] };
            if (fixture.hold) return new Promise(resolve => fixture.pending.push(resolve));
            return { available: true, items: payload.workspaceId === 'a' ? [{ id: 'task-a', title: 'Decisión de Carlos', status: fixture.taskState, raw: { branch: 'feature' } }] : [], observedAt: new Date().toISOString() };
          case 'git.inspect': return { available: true, branch: 'main', root: '/fixture/a', branches: [{ name: 'main', current: true, ...(payload.base ? { ahead: 0, behind: 0, merged: true } : {}) }, { name: 'feature', ...(payload.base ? { ahead: 3, behind: 1, merged: false } : {}) }], worktrees: [{ path: '/fixture/feature', branch: 'feature' }], changes: [], ...(payload.base ? { base: payload.base, comparison: { baseOid: 'abc' } } : {}), observedAt: new Date().toISOString() };
          case 'attention.ack': w.attention.find(item => item.id === payload.id).acknowledgedAt = new Date().toISOString(); fixture.emit({ type: 'state.changed', workspaceId: w.id }); return { ok: true };
          case 'attention.list': return structuredClone(w.attention);
          case 'playground.list': case 'automation.list': return { items: [] };
          default: throw new Error(`Unexpected fixture call: ${method}`);
        }
      },
    };
  });
  const emit = event => page.evaluate(event => window.activityFixture.emit(event), event);
  const notch = () => page.getByRole('button', { name: 'Actividad del proyecto', exact: true });
  const tray = () => page.getByRole('dialog', { name: 'Actividad del proyecto', exact: true });
  const open = async () => { if (!await tray().count()) await notch().click(); await tray().waitFor(); };
  const close = async () => { if (await tray().count()) { await page.keyboard.press('Escape'); await tray().waitFor({ state: 'detached' }); } };
  const ready = () => page.waitForFunction(() => document.querySelector('.activity-notch')?.textContent.includes('1 necesitan de ti') && !document.querySelector('.activity-notch .spinning'));
  await page.goto(server.resolvedUrls.local[0]);

  await check('notch persistente y estados reales, sesiones ocultas y base desconocida', async () => {
    await ready();
    assert.match(await notch().innerText(), /2 sesiones/);
    assert.match(await notch().innerText(), /sin base/);
    await open();
    assert.match(await tray().innerText(), /Terminal oculta · Vista oculta/);
    assert.match(await tray().innerText(), /Conectada · sin señal del agente/);
    assert.match(await tray().innerText(), /integración y pendientes desconocidos/);
  });
  await check('Escape, retorno de foco, Enter y ciclo de Tab', async () => {
    await close();
    assert.equal(await notch().evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Enter'); await tray().waitFor();
    const controls = tray().locator('button:not(:disabled),input');
    await controls.last().focus(); await page.keyboard.press('Tab');
    assert.equal(await controls.first().evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await controls.last().evaluate(el => document.activeElement === el), true);
    await close();
  });
  await check('eventos pertinentes coalescidos; bytes PTY no refrescan actividad', async () => {
    const before = await page.evaluate(() => window.activityFixture.calls.filter(c => c.method === 'phantom.list').length);
    await emit({ type: 'terminal.output', sessionId: 's1', workspaceId: 'a', seq: 1, data: 'output\r\n' });
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => window.activityFixture.calls.filter(c => c.method === 'phantom.list').length), before);
    await page.evaluate(() => { window.activityFixture.taskState = 'awaiting_approval'; for (let i = 0; i < 12; i++) window.activityFixture.emit({ type: 'tool.status', workspaceId: 'a', status: 'completed' }); });
    await open();
    await page.getByText('Espera aprobación', { exact: true }).waitFor();
    const after = await page.evaluate(() => window.activityFixture.calls.filter(c => c.method === 'phantom.list').length);
    assert.equal(after, before + 1);
  });
  await check('comparación explícita, vínculos acreditados y captura desktop', async () => {
    await tray().getByLabel('Base de comparación explícita').fill('main');
    await tray().getByRole('button', { name: 'Comparar', exact: true }).click();
    await tray().getByText('No integrada · ahead 3 / behind 1', { exact: true }).waitFor();
    assert.match(await tray().innerText(), /Sesión: Terminal oculta/);
    assert.match(await tray().innerText(), /Tarea: Decisión de Carlos/);
    await capture('desktop');
  });
  await check('recuperar terminal oculta, foco xterm y notch en modo enfocado', async () => {
    await tray().getByRole('button', { name: 'Recuperar terminal', exact: true }).click();
    await page.locator('.canvas-node.focused').waitFor();
    assert.equal(await page.locator('.canvas-node.focused .title-button').innerText(), 'Terminal oculta');
    assert.equal(await notch().isVisible(), true);
    await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'));
    assert.equal(await page.evaluate(() => window.activityFixture.calls.some(c => c.method === 'node.update' && c.payload.id === 'n2' && c.payload.patch.data.hidden === false)), true);
    await open();
    const before = await page.evaluate(() => window.activityFixture.calls.filter(c => c.method === 'terminal.write').length);
    await page.keyboard.type('guard');
    assert.equal(await page.evaluate(() => window.activityFixture.calls.filter(c => c.method === 'terminal.write').length), before);
    await capture('focused-terminal');
  });
  await check('leer aviso no elimina aprobación pendiente; navegación directa a tareas y Git', async () => {
    await tray().getByRole('button', { name: 'Marcar leído', exact: true }).click();
    await tray().getByRole('button', { name: 'Leído', exact: true }).waitFor();
    assert.match(await notch().innerText(), /1 necesitan de ti/);
    await tray().getByRole('button', { name: 'Abrir tareas', exact: true }).click();
    await page.getByLabel('Herramienta contextual').waitFor();
    assert.equal(await page.getByLabel('Herramienta contextual').inputValue(), 'tasks');
    await open(); await tray().getByRole('button', { name: 'Abrir Git', exact: true }).click();
    assert.equal(await page.getByLabel('Herramienta contextual').inputValue(), 'git');
    await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  });
  await check('fallo de fuente y retry conservan semántica y frescura', async () => {
    await page.evaluate(() => { window.activityFixture.fail['phantom.list'] = true; });
    await emit({ type: 'task.changed', workspaceId: 'a' }); await open();
    await tray().getByText('Fallo de prueba: phantom.list', { exact: true }).waitFor();
    assert.match(await tray().innerText(), /error \/ no disponible/);
    await page.evaluate(() => { delete window.activityFixture.fail['phantom.list']; });
    await tray().getByRole('button', { name: 'Reintentar', exact: true }).click();
    await tray().getByText('Fallo de prueba: phantom.list', { exact: true }).waitFor({ state: 'detached' });
    await page.waitForFunction(() => !document.querySelector('.activity-notch .spinning'));
  });
  await check('respuestas obsoletas al cambiar workspace son descartadas', async () => {
    await page.evaluate(() => { window.activityFixture.hold = true; });
    await tray().getByRole('button', { name: 'Actualizar actividad', exact: true }).click();
    await page.waitForFunction(() => window.activityFixture.pending.length > 0);
    await close();
    // Only the old request is held; the next workspace must load independently.
    await page.evaluate(() => { window.activityFixture.hold = false; });
    await page.getByRole('button', { name: /Proyecto B/ }).click();
    await page.waitForFunction(() => document.querySelector('.workspace-path')?.textContent.includes('/fixture/b'));
    await page.evaluate(() => window.activityFixture.release());
    await open();
    await tray().getByText('Sin sesiones observadas en este proyecto.', { exact: true }).waitFor();
    assert.equal(await page.getByText('STALE_RESULT_FORBIDDEN', { exact: true }).count(), 0);
    assert.match(await notch().innerText(), /0 sesiones/);
  });
  await check('desconexión invalida lecturas en vuelo y reconexión actualiza', async () => {
    await page.waitForFunction(() => !document.querySelector('.activity-notch .spinning'));
    await page.evaluate(() => { window.activityFixture.hold = true; });
    await tray().getByRole('button', { name: 'Actualizar actividad', exact: true }).click();
    await page.waitForFunction(() => window.activityFixture.pending.length > 0);
    await emit({ type: 'connection', status: 'disconnected', message: 'Desconexión de prueba' });
    await page.getByText('Host desconectado', { exact: true }).waitFor();
    await page.evaluate(() => window.activityFixture.release());
    assert.equal(await page.getByText('STALE_RESULT_FORBIDDEN', { exact: true }).count(), 0);
    assert.equal(await tray().getByRole('button', { name: 'Actualizar actividad', exact: true }).isDisabled(), true);
    await emit({ type: 'connection', status: 'connected' });
    await page.waitForFunction(() => document.querySelector('.activity-notch')?.textContent.includes('Sin intervención señalada'));
  });
  await check('layout narrow sin overflow y evidencia de teclado', async () => {
    await page.setViewportSize({ width: 760, height: 760 });
    await open();
    const bounds = await tray().boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 760);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 760);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await tray().evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await capture('narrow');
    await close();
    assert.equal(await notch().evaluate(el => document.activeElement === el), true);
  });
  await check('sin errores de consola ni excepciones de interfaz', async () => {
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.console.filter(item => item.type === 'error'), []);
  });
} catch (error) {
  result.error = error.stack || error.message; process.exitCode = 1;
  if (page) await capture('failure').catch(() => {});
} finally {
  await browser?.close(); await server?.close();
  result.summary = { passed: result.checks.filter(c => c.status === 'passed').length, failed: result.checks.filter(c => c.status === 'failed').length, success: !result.error };
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
