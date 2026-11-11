import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, _electron } from 'playwright';
import electronBinary from 'electron';
import { createServer } from 'vite';

// Real React/xterm UI served by Vite. Only this isolated test installs a bridge.
const root = fileURLToPath(new URL('..', import.meta.url));
await fs.mkdir('/tmp/opencode', { recursive: true });
const artifacts = await fs.mkdtemp('/tmp/opencode/activity-desktop-');
const report = { artifacts, checks: [], console: [], pageErrors: [], screenshots: [], startedAt: new Date().toISOString() };
let server, browser, app, page;
const poll = async (fn, message, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`Timed out: ${message}`);
};
const check = async (name, fn) => {
  try { await fn(); report.checks.push({ name, status: 'passed' }); }
  catch (error) { report.checks.push({ name, status: 'failed', error: error.stack || error.message }); throw error; }
};
const fixture = (fn, arg) => page.evaluate(fn, arg);
const notch = () => page.locator('.activity-notch');
const tray = () => page.getByRole('dialog', { name: 'Actividad del proyecto', exact: true });
const open = async () => { if (!await tray().count()) await notch().click(); await tray().waitFor(); };
const close = async () => { if (await tray().count()) await page.keyboard.press('Escape'); await tray().waitFor({ state: 'hidden' }); };
const settled = () => poll(() => fixture(() => !document.querySelector('.activity-tray .activity-heading .spinning')), 'activity query settled');

try {
  server = await createServer({ root, configFile: false, base: '/', server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    page = await browser.newPage({ viewport: { width: 1520, height: 980 }, reducedMotion: 'reduce' });
    report.engine = 'Playwright Chromium + Vite';
  } catch (error) {
    report.chromiumLaunchError = error.message;
    const main = path.join(artifacts, 'electron-smoke.cjs');
    await fs.writeFile(main, "const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:1520,height:980,webPreferences:{contextIsolation:true,nodeIntegration:false}});w.loadURL('about:blank')});");
    const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1' }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: electronBinary, args: ['--no-sandbox', main], cwd: root, env });
    page = await app.firstWindow(); await page.setViewportSize({ width: 1520, height: 980 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    report.engine = 'Playwright Electron + Vite';
  }
  page.setDefaultTimeout(10000);
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.addInitScript(() => {
    const clone = value => structuredClone(value);
    const node = (id, sessionId, hidden = false) => ({ id, type: 'terminal', title: hidden ? 'Sesión oculta' : 'Shell visible', x: 24, y: 55, width: 640, height: 400, data: { sessionId, hidden, cwd: '/fixture/tree' } });
    const workspace = (id, name, nodes) => ({ id, name, path: `/fixture/${id}`, canonicalPath: `/fixture/${id}`, nodes, camera: { x: 24, y: 24, zoom: .75 }, tasks: [], attention: [], missions: [], contextRefs: [], workflows: [], services: [] });
    const a = workspace('a', 'Proyecto Alfa', [node('visible', 's1'), node('hidden', 's2', true)]);
    const b = workspace('b', 'Proyecto Beta', []);
    a.attention.push({ id: 'notice', title: 'Proceso finalizado, no aprobado', source: 'terminal', sessionId: 's2', createdAt: '2026-11-11T10:00:00Z' });
    const task = { id: 'task-a', title: 'Revisar contrato real de prueba', status: 'blocked', source: 'phantom', raw: { contract: { workspace: '/fixture/tree' } } };
    const listeners = new Set();
    const state = { activeWorkspaceId: 'a', settings: {}, workspaces: [a, b] };
    const sessions = [
      { id: 's1', nodeId: 'visible', workspaceId: 'a', cwd: '/fixture/a', status: 'running', cols: 80, rows: 24, pid: 101 },
      { id: 's2', nodeId: 'hidden', workspaceId: 'a', cwd: '/fixture/tree', status: 'running', cols: 80, rows: 24, pid: 102 },
    ];
    const f = window.__activityFixture = { state, sessions, tasks: [task], calls: [], writes: [], errorRead: false, errorTasks: false, unavailableTasks: false, delayNextTasks: false, pending: [], emit: event => { for (const callback of [...listeners]) callback(event); }, release: () => { for (const callback of f.pending.splice(0)) callback(); } };
    window.phantom = {
      onEvent: callback => { listeners.add(callback); return () => listeners.delete(callback); },
      invoke: async (method, payload = {}) => {
        f.calls.push({ method, payload: clone(payload) });
        const w = state.workspaces.find(item => item.id === (payload.workspaceId || state.activeWorkspaceId));
        if (method === 'state.get') return clone(state);
        if (method === 'workspace.select') { state.activeWorkspaceId = payload.id; f.emit({ type: 'state.changed' }); return {}; }
        if (method === 'node.update') { const n = w.nodes.find(item => item.id === payload.id); Object.assign(n, payload.patch); return clone(n); }
        if (method === 'workspace.update') { Object.assign(w, payload.patch); return clone(w); }
        if (method === 'terminal.list') return clone(sessions.filter(s => s.workspaceId === payload.workspaceId));
        if (method === 'terminal.attach') return { seq: 0, data: 'Fixture shell\r\n$ ', session: clone(sessions.find(s => s.id === payload.sessionId)) };
        if (method === 'terminal.resize') return {};
        if (method === 'terminal.write') { f.writes.push(payload); return {}; }
        if (method === 'attention.list') return clone(w.attention);
        if (method === 'attention.ack') { if (f.errorRead) throw new Error('No se pudo registrar lectura (fixture)'); w.attention.find(item => item.id === payload.id).acknowledgedAt = new Date().toISOString(); f.emit({ type: 'state.changed', workspaceId: w.id }); return {}; }
        if (method === 'phantom.list') {
          if (f.errorTasks) throw new Error('Fuente Phantom interrumpida (fixture)');
          if (f.unavailableTasks) return { available: false, items: [], reason: 'Phantom no disponible (fixture)' };
          const result = { available: true, items: clone(payload.workspaceId === 'a' ? f.tasks : []), observedAt: new Date().toISOString() };
          if (f.delayNextTasks) { f.delayNextTasks = false; await new Promise(resolve => f.pending.push(resolve)); }
          return result;
        }
        if (method === 'git.inspect') return { available: true, root: w.path, branch: 'trunk', observedAt: new Date().toISOString(), ...(payload.base ? { base: payload.base, comparison: { baseOid: 'abc123def456' } } : {}), branches: payload.workspaceId === 'a' ? [{ name: 'trunk', ...(payload.base ? { ahead: 0, behind: 0, merged: true } : {}) }, { name: 'feature/' + 'rama-larga-'.repeat(15), ...(payload.base ? { ahead: 3, behind: 2, merged: false } : {}) } ] : [], worktrees: [{ path: '/fixture/tree', branch: 'feature/' + 'rama-larga-'.repeat(15) }], changes: [] };
        if (['playground.list', 'automation.list'].includes(method)) return [];
        throw new Error(`Unexpected fixture API: ${method}`);
      },
    };
  });
  await page.goto(url);
  await page.locator('.app-shell').waitFor();
  await check('notch persistente, estados reales y bandeja con fuentes', async () => {
    await poll(async () => (await notch().innerText()).includes('1 necesitan de ti'), 'explicit blocked task');
    assert.match(await notch().innerText(), /2.*ramas/s);
    assert.match(await page.locator('.node-header .terminal-activity').first().innerText(), /sin señal/);
    assert.match(await page.locator('.rail-terminal-status').first().innerText(), /sin señal/);
    await open();
    for (const name of ['Necesitan de ti', 'Integración', 'Sesiones', 'Avisos']) assert.equal(await tray().getByRole('heading', { name: new RegExp(name) }).count(), 1);
    assert.match(await tray().innerText(), /Sin observación|desde lectura/);
    assert.match(await tray().innerText(), /Integración desconocida/);
    await page.screenshot({ path: path.join(artifacts, 'desktop.png') }); report.screenshots.push('desktop.png');
  });
  await check('teclado, ciclo de foco, Escape y retorno al origen', async () => {
    const controls = tray().locator('button:not(:disabled),input:not(:disabled)');
    await controls.last().focus(); await page.keyboard.press('Tab');
    assert.equal(await controls.first().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await controls.last().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); await tray().waitFor({ state: 'hidden' });
    assert.equal(await notch().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter'); await tray().waitFor();
  });
  await check('base explícita, ahead/behind y asociaciones acreditadas', async () => {
    await tray().getByLabel('Base de integración').fill('trunk');
    await tray().getByRole('button', { name: 'Comparar', exact: true }).click();
    await poll(async () => (await tray().innerText()).includes('1 pendientes de integración'), 'base comparison');
    assert.match(await tray().innerText(), /adelante 3 \/ detrás 2/);
    assert.match(await tray().innerText(), /No integrada/);
    assert.match(await tray().locator('.activity-branch').last().innerText(), /Sesión oculta/);
  });
  await check('leído no aprueba ni resuelve tarea bloqueada', async () => {
    await fixture(() => { window.__activityFixture.errorRead = true; });
    await tray().getByRole('button', { name: 'Marcar leído', exact: true }).click();
    await tray().getByText('No se pudo registrar lectura (fixture)', { exact: false }).waitFor();
    assert.equal(await fixture(() => Boolean(window.__activityFixture.state.workspaces[0].attention[0].acknowledgedAt)), false);
    await fixture(() => { window.__activityFixture.errorRead = false; });
    await tray().getByRole('button', { name: 'Marcar leído', exact: true }).click();
    await poll(async () => (await tray().getByRole('heading', { name: /Avisos/ }).innerText()).includes('0 sin leer'), 'notice read');
    assert.match(await notch().innerText(), /1 necesitan de ti/);
    const mutations = await fixture(() => window.__activityFixture.calls.filter(c => /control|merge|approv/.test(c.method)));
    assert.deepEqual(mutations, []);
  });
  await check('navegación recupera terminal oculta, foco xterm y notch en enfoque', async () => {
    await tray().getByRole('button', { name: 'Recuperar terminal', exact: true }).click();
    await page.locator('[data-node-id="hidden"].focused').waitFor();
    await poll(() => page.locator('[data-node-id="hidden"] .xterm-helper-textarea').evaluate(el => el === document.activeElement), 'xterm gets focus');
    assert.equal(await notch().isVisible(), true);
    await poll(() => fixture(() => !window.__activityFixture.state.workspaces[0].nodes[1].data.hidden), 'hidden flag saved');
    await open();
    const before = await fixture(() => window.__activityFixture.writes.length);
    await page.keyboard.type('no-pty-input');
    assert.equal(await fixture(() => window.__activityFixture.writes.length), before);
    await close();
    await page.screenshot({ path: path.join(artifacts, 'focused-terminal.png') }); report.screenshots.push('focused-terminal.png');
  });
  await check('eventos coalescidos; bytes PTY no disparan consultas', async () => {
    await open(); await settled();
    await fixture(() => { const f = window.__activityFixture; f.calls.length = 0; for (let i = 0; i < 40; i++) f.emit({ type: 'terminal.output', workspaceId: 'a', sessionId: 's1', seq: i + 1, data: '' }); });
    await page.waitForTimeout(450);
    assert.equal(await fixture(() => window.__activityFixture.calls.filter(c => c.method === 'phantom.list').length), 0);
    await fixture(() => { const f = window.__activityFixture; f.tasks[0].status = 'needs_input'; for (let i = 0; i < 30; i++) f.emit({ type: 'tool.status', workspaceId: 'a', status: 'running' }); });
    await poll(async () => (await tray().innerText()).includes('Necesita respuesta'), 'event refresh');
    assert.equal(await fixture(() => window.__activityFixture.calls.filter(c => c.method === 'phantom.list').length), 1);
    await close();
  });
  await check('navegación directa a tareas y Git', async () => {
    await open(); await tray().getByRole('button', { name: 'Ver tarea', exact: true }).click();
    assert.equal(await page.getByLabel('Herramienta contextual').inputValue(), 'tasks');
    await page.locator('.inspector-switcher').getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
    await open(); await tray().getByRole('button', { name: 'Ver Git', exact: true }).first().click();
    assert.equal(await page.getByLabel('Herramienta contextual').inputValue(), 'git');
    await page.locator('.inspector-switcher').getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  });
  await check('errores, retry y fuente no disponible', async () => {
    await open();
    await fixture(() => { const f = window.__activityFixture; f.errorTasks = true; f.emit({ type: 'task.changed', workspaceId: 'a' }); });
    await tray().getByText('Fuente Phantom interrumpida (fixture)', { exact: false }).waitFor();
    await fixture(() => { window.__activityFixture.errorTasks = false; });
    await tray().getByRole('button', { name: 'Reintentar', exact: true }).click();
    await poll(async () => !await tray().getByRole('button', { name: 'Reintentar', exact: true }).count(), 'retry cleared error');
    await fixture(() => { const f = window.__activityFixture; f.unavailableTasks = true; f.emit({ type: 'task.changed', workspaceId: 'a' }); });
    await tray().getByText('Phantom no disponible (fixture)', { exact: false }).waitFor();
    await fixture(() => { window.__activityFixture.unavailableTasks = false; });
    await tray().getByRole('button', { name: 'Reintentar', exact: true }).click();
    await poll(async () => !await tray().getByRole('button', { name: 'Reintentar', exact: true }).count(), 'availability recovered');
  });
  await check('loading y descarte de resultados al cambiar workspace', async () => {
    await fixture(() => { const f = window.__activityFixture; f.delayNextTasks = true; f.emit({ type: 'task.changed', workspaceId: 'a' }); });
    await poll(() => fixture(() => window.__activityFixture.pending.length === 1), 'delayed task request');
    assert.match(await tray().innerText(), /Actualizando fuentes/);
    await close();
    await page.getByRole('button', { name: /Proyecto Beta/ }).click();
    await poll(async () => (await notch().innerText()).includes('0'), 'new project snapshot');
    await fixture(() => window.__activityFixture.release());
    await open(); await settled();
    assert.equal((await tray().innerText()).includes('Revisar contrato real de prueba'), false);
    assert.match(await tray().innerText(), /No hay sesiones observadas/);
    assert.equal(await tray().getByRole('button', { name: 'Ver tarea', exact: true }).count(), 0);
    await close(); await page.getByRole('button', { name: /Proyecto Alfa/ }).click();
    await poll(async () => (await notch().innerText()).includes('1 necesitan de ti'), 'back to Alfa');
  });
  await check('desconexión invalida lecturas pendientes y reconecta', async () => {
    await open();
    await fixture(() => { const f = window.__activityFixture; f.tasks[0].title = 'RESULTADO OBSOLETO SIN CONEXIÓN'; f.delayNextTasks = true; f.emit({ type: 'task.changed', workspaceId: 'a' }); });
    await poll(() => fixture(() => window.__activityFixture.pending.length === 1), 'pending before disconnect');
    await fixture(() => { const f = window.__activityFixture; f.tasks[0].title = 'Revisar contrato real de prueba'; f.emit({ type: 'connection', status: 'disconnected' }); });
    await poll(async () => (await notch().innerText()).includes('Sin conexión'), 'disconnected source');
    await fixture(() => window.__activityFixture.release());
    await page.waitForTimeout(100);
    assert.equal((await tray().innerText()).includes('RESULTADO OBSOLETO SIN CONEXIÓN'), false);
    assert.equal(await tray().getByRole('button', { name: 'Actualizar actividad', exact: true }).isDisabled(), true);
    assert.match(await tray().innerText(), /última observación|Host desconectado/);
    await fixture(() => window.__activityFixture.emit({ type: 'connection', status: 'connected' }));
    await poll(async () => !(await notch().innerText()).includes('Sin conexión'), 'reconnected');
    await settled();
  });
  await check('layout desktop/narrow sin overflow y contenido largo con scroll propio', async () => {
    for (const [name, width, height] of [['desktop', 1520, 980], ['narrow', 760, 760], ['compact-desktop', 600, 700]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const geometry = await tray().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, viewportHeight: innerHeight, contentScroll: el.querySelector('.activity-scroll').scrollHeight > el.querySelector('.activity-scroll').clientHeight }; });
      assert(geometry.x >= 0 && geometry.right <= geometry.viewportWidth + 1, JSON.stringify(geometry));
      assert(geometry.bottom <= geometry.viewportHeight && geometry.y >= 0, JSON.stringify(geometry));
      assert(geometry.scrollWidth <= geometry.clientWidth + 1, JSON.stringify(geometry));
      assert(geometry.documentWidth <= width, JSON.stringify(geometry));
      assert(geometry.contentScroll, 'tray owns overflow scroll');
      await page.screenshot({ path: path.join(artifacts, `${name}-tray.png`) }); report.screenshots.push(`${name}-tray.png`);
    }
  });
  await check('sin errores de consola ni excepciones React', async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.console.filter(message => message.type === 'error'), []);
  });
} catch (error) {
  report.failure = error.stack || error.message; process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app) await app.close().catch(() => {});
  if (server) await server.close();
  report.summary = { passed: report.checks.filter(c => c.status === 'passed').length, failed: report.checks.filter(c => c.status === 'failed').length + (report.failure && !report.checks.some(c => c.status === 'failed') ? 1 : 0) };
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
