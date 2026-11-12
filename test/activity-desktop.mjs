import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, _electron } from 'playwright';

// Test-only bridge injected before the real React application. No production
// fixture switches, user profile, host daemon, shell or Git mutations.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const evidence = await mkdtemp('/tmp/opencode/activity-desktop-');
const report = { evidence, checks: [], console: [], pageErrors: [], launchAttempts: [], screenshots: [] };
let server, browser, desktop, page;
async function poll(fn, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(r => setTimeout(r, 40)); }
  throw new Error(`Timeout: ${label}`);
}
async function check(name, fn) {
  try { await fn(); report.checks.push({ name, status: 'passed' }); }
  catch (error) { report.checks.push({ name, status: 'failed', error: error.stack }); throw error; }
}
function installFixture() {
  const copy = x => structuredClone(x);
  const workspace = (id, name) => ({ id, name, path: `/fixture/${id}`, canonicalPath: `/fixture/${id}`, nodes: [], tasks: [], missions: [], attention: [], workflows: [], contextRefs: [], camera: { x: 30, y: 30, zoom: 0.8 } });
  const a = workspace('a', 'Proyecto Alfa'), b = workspace('b', 'Proyecto Beta');
  a.nodes = [
    { id: 'hidden', title: 'Terminal oculta', type: 'terminal', x: 20, y: 20, width: 640, height: 400, data: { hidden: true, sessionId: 's-hidden', worktree: { branch: 'feature', path: '/fixture/tree' } } },
    { id: 'shell', title: 'Shell abierta', type: 'terminal', x: 20, y: 20, width: 640, height: 400, data: { sessionId: 's-shell' } },
    { id: 'web', title: 'Navegador prueba', type: 'browser', x: 720, y: 20, width: 640, height: 400, data: { url: 'https://example.test/' } },
  ];
  a.attention = [{ id: 'notice', title: `Decisión pendiente · ${'contexto/largo/'.repeat(16)}`, source: 'fixture de aviso', status: 'awaiting_approval', ref: { kind: 'card', id: 'task' } }];
  const f = window.__activityFixture = {
    state: { activeWorkspaceId: 'a', workspaces: [a, b], settings: {} },
    sessions: { a: [{ id: 's-hidden', workspaceId: 'a', nodeId: 'hidden', status: 'running', cols: 80, rows: 24 }, { id: 's-shell', workspaceId: 'a', nodeId: 'shell', status: 'running', cols: 80, rows: 24 }], b: [] },
    tasks: { a: [{ id: 'task', title: 'Tarea bloqueada', status: 'blocked', source: 'phantom', raw: { sessionId: 's-hidden' } }], b: [] },
    calls: [], listeners: new Set(), failTasks: false, deferTasks: false, pending: [], nativeVisible: false,
    emit(event) { for (const callback of [...this.listeners]) callback(event); },
    release() { for (const finish of this.pending.splice(0)) finish(); },
  };
  window.phantom = {
    onEvent(callback) { f.listeners.add(callback); return () => f.listeners.delete(callback); },
    async invoke(method, p = {}) {
      f.calls.push({ method, p: copy(p) });
      const w = f.state.workspaces.find(w => w.id === (p.workspaceId || f.state.activeWorkspaceId));
      if (method === 'state.get') return copy(f.state);
      if (method === 'workspace.select') { f.state.activeWorkspaceId = p.id; return {}; }
      if (method === 'node.update') { const n = w.nodes.find(n => n.id === p.id); Object.assign(n, copy(p.patch)); return copy(n); }
      if (method === 'workspace.update') return {};
      if (method === 'terminal.list') return copy(f.sessions[p.workspaceId]);
      if (method === 'terminal.attach') { const s = Object.values(f.sessions).flat().find(s => s.id === p.sessionId); return { session: copy(s), data: 'Fixture de terminal\r\n$ ', seq: 0 }; }
      if (method === 'terminal.resize' || method === 'terminal.write') return {};
      if (method === 'phantom.list') {
        const result = { available: true, items: copy(f.tasks[p.workspaceId]), observedAt: new Date().toISOString() };
        if (f.deferTasks) await new Promise(resolve => f.pending.push(resolve));
        if (f.failTasks) throw new Error('Fallo de tareas de prueba');
        return result;
      }
      if (method === 'git.inspect') return { available: true, observedAt: new Date().toISOString(), ...(p.base ? { base: p.base, comparison: { baseOid: 'abc' } } : {}), branches: p.workspaceId === 'a' ? [{ name: 'main', current: true, ...(p.base ? { merged: true, ahead: 0, behind: 0 } : {}) }, { name: 'feature', ...(p.base ? { merged: false, ahead: 2, behind: 1 } : {}) }] : [], worktrees: [], changes: [] };
      if (method === 'attention.ack') { w.attention.find(n => n.id === p.id).acknowledgedAt = new Date().toISOString(); return {}; }
      if (method === 'attention.list') return copy(w.attention);
      if (method === 'browser.attach') { f.nativeVisible = true; return { attached: true }; }
      if (method === 'browser.bounds') { f.nativeVisible = p.visible; return {}; }
      if (method === 'browser.detach' || method === 'browser.navigate') return {};
      if (method === 'browser.capture') return {};
      if (method.endsWith('.list')) return { available: true, items: [] };
      throw new Error(`Método inesperado en fixture: ${method}`);
    },
  };
}
const fixture = fn => page.evaluate(fn);
const tray = () => page.getByRole('dialog', { name: 'Actividad del proyecto' });
const notch = () => page.getByRole('button', { name: 'Actividad del proyecto', exact: true });
async function open() { await notch().click(); await tray().waitFor(); await tray().getByRole('button', { name: 'Todo', exact: true }).click(); }
async function close() { await tray().getByLabel('Cerrar bandeja de actividad').click(); await tray().waitFor({ state: 'hidden' }); }
async function settled() { await poll(() => fixture(() => { const text = document.querySelector('.activity-notch')?.textContent || ''; return !!text && !/Recuperando|desconectado|sin confirmar/.test(text); }), 'fuentes recuperadas'); }
async function viewport(width, height) {
  if (desktop) await desktop.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
  await page.setViewportSize({ width, height });
}

try {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const candidates = [process.env.PHANTOM_TEST_CHROMIUM, chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
  for (const executablePath of [...new Set(candidates)]) {
    try { await access(executablePath); browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'], timeout: 12000 }); report.runtime = executablePath; break; }
    catch (error) { report.launchAttempts.push({ executablePath, error: error.message }); }
  }
  if (browser) { const context = await browser.newContext({ viewport: { width: 1520, height: 980 }, reducedMotion: 'reduce' }); await context.addInitScript(installFixture); page = await context.newPage(); }
  else {
    const main = path.join(evidence, 'electron-fixture.cjs');
    // Main runs inside Electron, where require('electron') is the built-in.
    await writeFile(main, "const {app,BrowserWindow}=require('electron');app.setPath('userData'," + JSON.stringify(path.join(evidence, 'profile')) + ");app.whenReady().then(()=>{const w=new BrowserWindow({width:1520,height:980,show:false,webPreferences:{contextIsolation:true}});w.loadURL('about:blank')});");
    const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1' }; delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({ args: [main, '--no-sandbox'], cwd: root, env, timeout: 15000 });
    page = await desktop.firstWindow(); await page.context().addInitScript(installFixture); report.runtime = 'Electron + Vite';
  }
  page.setDefaultTimeout(8000);
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.console.push({ type: message.type(), text: message.text(), location: message.location() }); });
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  // The desktop has no favicon request. Supply only that browser-only asset;
  // all application requests and console errors remain observable.
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(url);
  await viewport(1520, 980);
  await settled();
  await check('Notch persistente con necesidades reales, sesiones ocultas y estados desconocidos', async () => {
    assert.match(await notch().innerText(), /2 necesitan de ti/);
     assert.equal(await page.locator('.create-dock .activity-notch').count(), 1);
    assert.match(await page.locator('.rail-panel-label').filter({ hasText: 'Shell abierta' }).innerText(), /agente sin señal/);
    await open();
     assert.match(await tray().innerText(), /Vista oculta/);
     assert.match(await tray().getByRole('heading', { name: /^Sesiones/ }).innerText(), /2/);
    assert.match(await tray().innerText(), /Integración desconocida/);
    assert.equal(await tray().getByRole('heading', { name: /Necesitan de ti/ }).count(), 1);
    await close();
   });
   await check('Dock: filtros directos, límites honestos y cierre sin resolver pendientes', async () => {
     await notch().click();
     assert.equal(await tray().getByRole('button', { name: 'Tu atención', exact: true }).getAttribute('aria-pressed'), 'true');
     assert.equal(await tray().getByRole('heading', { name: /^Integración/ }).count(), 0);
     await tray().getByRole('button', { name: 'Ir a sesión', exact: true }).click();
     await page.locator('.canvas-node.focused').filter({ hasText: 'Terminal oculta' }).waitFor();
     assert.match(await notch().innerText(), /2 necesitan de ti/);
     await page.locator('.activity-strip').getByRole('button', { name: 'Integraciones', exact: true }).click();
     await tray().getByRole('heading', { name: /^Integración/ }).waitFor();
     assert.equal(await tray().getByRole('button', { name: 'Revisar incorporaciones', exact: true }).count(), 1);
     await page.locator('.activity-strip').getByRole('button', { name: 'Límites', exact: true }).click();
     assert.match(await tray().innerText(), /El host todavía no recibe las cuotas/);
     assert.equal(await tray().getByRole('heading', { name: /^Integración/ }).count(), 0);
     await page.locator('.activity-strip').getByRole('button', { name: 'Límites', exact: true }).click();
     await tray().waitFor({ state: 'hidden' });
     await notch().click(); await page.getByRole('button', { name: 'Cerrar actividad', exact: true }).click({ position: { x: 5, y: 5 } });
     await tray().waitFor({ state: 'hidden' });
     assert.match(await notch().innerText(), /2 necesitan de ti/);
   });
  await check('Base explícita, comparación real del bridge y asociaciones verificables', async () => {
    await open(); await tray().getByLabel('Base de integración').fill('main'); await tray().getByRole('button', { name: 'Comparar', exact: true }).click();
    await poll(async () => (await tray().innerText()).includes('adelante 2 / detrás 1'), 'comparación Git');
    assert.match(await tray().innerText(), /No integrada/);
    assert.equal(await tray().getByRole('button', { name: /Terminal vinculada: Terminal oculta/ }).count(), 1);
    const writes = await fixture(() => window.__activityFixture.calls.filter(c => c.method === 'terminal.write').length);
    await tray().getByLabel('Base de integración').fill('main'); await page.keyboard.type('x');
    assert.equal(await fixture(() => window.__activityFixture.calls.filter(c => c.method === 'terminal.write').length), writes, 'Los campos no escriben en PTY');
    await close();
  });
  await check('Marcar leído no aprueba ni resuelve una intervención', async () => {
    await open(); await tray().getByRole('button', { name: 'Marcar leído', exact: true }).click();
    await poll(async () => (await tray().innerText()).includes('0 sin leer'), 'aviso leído');
    assert.match(await notch().innerText(), /2 necesitan de ti/);
    assert.equal(await fixture(() => window.__activityFixture.calls.some(c => /approve|merge/.test(c.method))), false);
    await close();
  });
   await check('Navegación directa recupera terminal oculta y mantiene notch en foco', async () => {
     await fixture(() => { const f = window.__activityFixture; f.state.workspaces[0].nodes.find(n => n.id === 'hidden').data.hidden = true; f.emit({ type: 'state.changed', workspaceId: 'a' }); });
     await poll(async () => (await page.locator('.rail-panel-label').filter({ hasText: 'Terminal oculta' }).count()) === 0, 'vista oculta de nuevo');
    await open();
    await tray().locator('.activity-row').filter({ hasText: 'Terminal oculta' }).filter({ hasText: 'Vista oculta' }).getByRole('button', { name: 'Ir a terminal', exact: true }).click();
    await page.locator('.canvas-node.focused').filter({ hasText: 'Terminal oculta' }).waitFor();
    await poll(() => fixture(() => window.__activityFixture.state.workspaces[0].nodes.find(n => n.id === 'hidden').data.hidden === false), 'vista recuperada guardada');
    assert.equal(await notch().isVisible(), true);
    await poll(() => fixture(() => !!document.activeElement?.closest('.xterm')), 'foco xterm');
    await open(); await page.keyboard.press('Escape'); await tray().waitFor({ state: 'hidden' });
    await poll(() => notch().evaluate(el => el === document.activeElement), 'retorno de foco al notch');
  });
  await check('Teclado: Tab contenido en bandeja y Escape retorna al disparador', async () => {
    await open();
    const buttons = tray().getByRole('button'); await buttons.last().focus(); await page.keyboard.press('Tab');
    assert.equal(await tray().getByLabel('Cerrar bandeja de actividad').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab'); assert.equal(await buttons.last().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); await tray().waitFor({ state: 'hidden' });
  });
  await check('Eventos pertinentes coalescidos; ningún refresco por byte PTY', async () => {
    const before = await fixture(() => window.__activityFixture.calls.filter(c => c.method === 'terminal.list').length);
    await fixture(() => { const f = window.__activityFixture; for (let i = 0; i < 200; i++) f.emit({ type: 'terminal.output', workspaceId: 'a', sessionId: 'unused', data: 'x', seq: i }); });
    await page.waitForTimeout(400);
    assert.equal(await fixture(() => window.__activityFixture.calls.filter(c => c.method === 'terminal.list').length), before);
    await fixture(() => { const f = window.__activityFixture; f.tasks.a[0].status = 'completed'; for (let i = 0; i < 30; i++) f.emit({ type: 'tool.status', workspaceId: 'a' }); });
    await poll(async () => (await notch().innerText()).includes('1 necesita de ti'), 'actualización por evento');
    assert.equal(await fixture(() => window.__activityFixture.calls.filter(c => c.method === 'terminal.list').length), before + 1);
  });
  await check('Errores de fuente visibles y retry recupera datos sin falsa confianza', async () => {
    await fixture(() => { const f = window.__activityFixture; f.failTasks = true; f.emit({ type: 'task.changed', workspaceId: 'a' }); });
    await open(); await tray().getByText('Fallo de tareas de prueba', { exact: true }).waitFor();
    assert.match(await tray().innerText(), /lectura fallida/);
    await fixture(() => { window.__activityFixture.failTasks = false; });
    await tray().getByRole('button', { name: 'Reintentar fuente', exact: true }).click();
    await tray().getByText('Fallo de tareas de prueba', { exact: true }).waitFor({ state: 'hidden' });
    await close();
  });
  await check('Acciones navegan al inspector de tareas y Git', async () => {
    await open(); await tray().getByRole('button', { name: 'Ir a tareas', exact: true }).first().click();
    await poll(async () => await page.getByLabel('Herramienta contextual').inputValue() === 'tasks', 'inspector tareas');
    await page.locator('.inspector-switcher').getByLabel('Cerrar inspector', { exact: true }).click();
    await open(); await tray().getByRole('button', { name: 'Ir a Git', exact: true }).first().click();
    await poll(async () => await page.getByLabel('Herramienta contextual').inputValue() === 'git', 'inspector Git');
    await page.locator('.inspector-switcher').getByLabel('Cerrar inspector', { exact: true }).click();
  });
  await check('Browser nativo se oculta bajo la bandeja (ownership del bridge)', async () => {
    await page.getByRole('button', { name: 'Enfocar Navegador prueba', exact: true }).click();
    await poll(() => fixture(() => window.__activityFixture.nativeVisible), 'browser visible');
    await open(); await poll(() => fixture(() => !window.__activityFixture.nativeVisible), 'browser oculto');
    await close(); await poll(() => fixture(() => window.__activityFixture.nativeVisible), 'browser recuperado');
  });
  await check('Desktop y narrow sin overflow; capturas reales', async () => {
    for (const [name, width, height] of [['desktop', 1520, 980], ['narrow', 760, 760]]) {
      await viewport(width, height); await open(); await page.waitForTimeout(150);
       const bounds = await tray().boundingBox(); assert(bounds.x >= 0 && bounds.y >= 52 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1);
       const dock = await page.locator('.activity-dock').boundingBox(); assert(dock.x >= 0 && dock.x + dock.width <= width + 1 && bounds.y + bounds.height < dock.y);
       assert(Math.abs(bounds.x + bounds.width / 2 - dock.x - dock.width / 2) < 1, 'Bandeja alineada con el dock');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await tray().evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      assert.equal(await tray().evaluate(el => [...el.querySelectorAll('.activity-tray-scroll,.activity-row,.activity-base')].some(row => row.scrollWidth > row.clientWidth + 1)), false);
      const screenshot = path.join(evidence, `${name}.png`); await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot); await close();
    }
    await viewport(1520, 980);
  });
  await check('Resultados antiguos no cruzan workspace; estados vacíos y loading', async () => {
    await fixture(() => { const f = window.__activityFixture; f.deferTasks = true; f.tasks.a = [{ id: 'stale', title: 'RESULTADO OBSOLETO', status: 'blocked' }]; f.emit({ type: 'task.changed', workspaceId: 'a' }); });
    await poll(() => fixture(() => window.__activityFixture.pending.length > 0), 'lectura diferida');
    await page.getByRole('button', { name: /Proyecto Beta/ }).click();
    await poll(() => fixture(() => document.querySelector('.workspace-identity')?.textContent.includes('Proyecto Beta')), 'workspace Beta');
    await open(); assert.match(await tray().innerText(), /actualizando/);
    await fixture(() => { const f = window.__activityFixture; f.deferTasks = false; f.release(); });
    await poll(async () => !(await tray().innerText()).includes('actualizando'), 'fin lectura');
    assert.equal((await tray().innerText()).includes('RESULTADO OBSOLETO'), false);
    assert.match(await tray().innerText(), /Sin sesiones ni vistas/);
    assert.match(await tray().innerText(), /No hay avisos registrados/);
    await close();
  });
  await check('Desconexión invalida respuestas pendientes y reconexión recupera fuentes', async () => {
    await fixture(() => { const f = window.__activityFixture; f.deferTasks = true; f.tasks.b = [{ id: 'offline', title: 'NO PUBLICAR DESCONECTADA', status: 'blocked' }]; f.emit({ type: 'task.changed', workspaceId: 'b' }); });
    await poll(() => fixture(() => window.__activityFixture.pending.length > 0), 'lectura antes de desconexión');
    await fixture(() => { const f = window.__activityFixture; f.emit({ type: 'connection', status: 'disconnected' }); f.release(); });
    await poll(async () => (await notch().innerText()).includes('Host desconectado'), 'desconexión visible');
    await open(); assert.equal((await tray().innerText()).includes('NO PUBLICAR DESCONECTADA'), false); await close();
    await fixture(() => { const f = window.__activityFixture; f.deferTasks = false; f.tasks.b = []; f.emit({ type: 'connection', status: 'connected' }); });
    await settled();
  });
  await check('Sin errores de consola ni excepciones de renderer', async () => { assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.console.filter(m => m.type === 'error'), []); });
} catch (error) {
  report.error = error.stack;
  if (page) await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await desktop?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await server?.close();
  report.summary = { passed: report.checks.filter(c => c.status === 'passed').length, failed: report.checks.filter(c => c.status === 'failed').length, status: process.exitCode ? 'failed' : 'passed' };
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
