import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Explicit SYNTHETIC fixtures: this checks the shipping renderer, not a native
// Phantom database or a model. No screenshots or reports enter the repository.
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = '/tmp/opencode/phantom-command-center-review';
await mkdir(evidence, { recursive: true });
const server = await createServer({ root, configFile: false, base: '/',
  cacheDir: path.join(evidence, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const results = [], errors = [];
try {
  await server.listen();
  // Match the shipping automation adapter: packaged installs include full
  // Chromium, not necessarily Playwright's separate headless-shell download.
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const workspace = { id: 'synthetic-project-a', name: 'SYNTHETIC · Centro de mando',
      path: '/synthetic/project', canonicalPath: '/synthetic/project', camera: { x: 64, y: 64, zoom: 1 },
      nodes: [], tasks: [], contextRefs: [], missions: [], workflows: [], services: [], attention: [] };
    const listeners = new Set();
    const state = { schemaVersion: 1, settings: {}, activeWorkspaceId: workspace.id, workspaces: [workspace] };
    const raw = (id, status, goal, extra = {}) => ({ id, kind: 'card', status,
      contract: { goal, workspace: `/synthetic/worktrees/${id}`, scope: ['src/synthetic-only.js'],
        checks: [{ name: 'SYNTHETIC acceptance', argv: ['node', '--test', 'synthetic.test.mjs'] }] },
      createdAt: '2026-01-01T09:00:00Z', updatedAt: '2026-01-01T10:00:00Z',
      evidence: ['SYNTHETIC evidence · not production'], ...extra });
    const tasks = [raw('task_active', 'running', 'SYNTHETIC · ejecución en curso'),
      raw('task_blocked', 'blocked', 'SYNTHETIC · confirmar decisión de alcance', { blockedReason: 'SYNTHETIC · falta decisión del operador' })]
      .map(raw => ({ id: raw.id, title: raw.contract.goal, source: 'phantom', status: raw.status, raw }));
    const controller = { id: 'synthetic-controller', taskId: 'task_blocked', source: 'phantom',
      workspaceId: workspace.id, status: 'running', action: 'run', output: 'SYNTHETIC stdout inicial\n', createdAt: '2026-01-01T10:00:00Z' };
     const fixture = window.__commandCenterFixture = { state, calls: [], fail: false, failSave: false, tasks, controller,
      emit(event) { for (const listener of listeners) listener(event); } };
    window.phantom = {
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async invoke(method, payload = {}) {
        fixture.calls.push({ method, payload: structuredClone(payload) });
        if (method === 'state.get') return structuredClone(state);
         if (method === 'plugin.update') {
           if (fixture.failSave) throw new Error('SYNTHETIC · guardado no disponible');
          workspace.plugins = { phantom: structuredClone(payload.settings) };
          fixture.emit({ type: 'state.changed', workspaceId: workspace.id });
          return structuredClone(payload.settings);
        }
        if (method === 'plugin.get') return structuredClone(workspace.plugins?.phantom || { enabled: false, refreshMs: 4000 });
        if (method === 'node.create') {
          const node = { id: crypto.randomUUID(), title: 'Centro de mando', x: 0, y: 0, width: 800, height: 620, data: {}, ...payload };
          workspace.nodes.push(node); return structuredClone(node);
        }
        if (method === 'node.update') {
          const node = workspace.nodes.find(node => node.id === payload.id);
          Object.assign(node, payload.patch); return structuredClone(node);
        }
        if (method === 'workspace.update') { Object.assign(workspace, payload.patch); return structuredClone(workspace); }
        if (method === 'phantom.list' || method === 'phantom.events') {
          if (fixture.fail) throw new Error('SYNTHETIC · conexión interrumpida');
          if (method === 'phantom.list') return { available: true, items: structuredClone(tasks), controllers: [structuredClone(controller)], observedAt: new Date().toISOString() };
          return { items: [{ id: 'synthetic-event', type: 'synthetic.blocked', taskId: payload.id, message: 'SYNTHETIC · evento nativo seleccionado' }], observedAt: new Date().toISOString() };
        }
        throw new Error(`Unexpected fixture API: ${method}`);
      },
    };
  });
  const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
  const wait = async (fn, label) => {
    const until = Date.now() + 12000;
    while (Date.now() < until) { if (await fn()) return; await page.waitForTimeout(50); }
    throw new Error(`Timed out: ${label}`);
  };
  const count = () => page.evaluate(() => window.__commandCenterFixture.calls.filter(c => ['phantom.list', 'phantom.events'].includes(c.method)).length);
  const shot = async name => {
    const target = path.join(evidence, name);
    await page.screenshot({ path: target, fullPage: true });
    console.log(`SCREENSHOT ${target}`);
  };
  const assertNoOverflow = async center => {
    const overflow = await center.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth,
      pageWidth: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth,
      outside: [...el.querySelectorAll('button,input,select,pre')].filter(child => child.getBoundingClientRect().right > el.getBoundingClientRect().right + 2).map(child => child.tagName) }));
    assert.ok(overflow.width > 0);
    assert.ok(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow));
    assert.ok(overflow.pageScroll <= overflow.pageWidth + 1, JSON.stringify(overflow));
    assert.deepEqual(overflow.outside, []);
  };
  await page.goto(server.resolvedUrls.local[0]);
  const center = page.locator('.canvas-node.focused .command-center');
  await check('activar plugin y guardar preferencia por proyecto', async () => {
    await page.keyboard.press('Control+k');
    await page.getByRole('button', { name: /Abrir Centro de mando/ }).click();
    await center.waitFor();
    await page.evaluate(() => { window.__commandCenterFixture.failSave = true; });
    await center.getByRole('button', { name: 'Reactivar Phantom', exact: true }).click();
    await center.getByRole('alert').waitFor();
    assert.match(await center.getByRole('alert').innerText(), /guardado no disponible/);
    assert.equal(await count(), 0, 'A failed activation must not start native reads');
    await page.evaluate(() => { window.__commandCenterFixture.failSave = false; });
    await center.getByRole('button', { name: 'Reintentar guardado', exact: true }).click();
    await wait(() => center.getByRole('button', { name: 'Pausar', exact: true }).isEnabled(), 'activation');
    await center.getByLabel('Frecuencia de actualización').selectOption('3000');
    await wait(() => page.evaluate(() => window.__commandCenterFixture.state.workspaces[0].plugins.phantom.refreshMs === 3000), 'persisted interval');

    await wait(async () => await center.locator('.cc-task').count() === 2, 'catalog');
    assert.equal(await page.evaluate(() => window.__commandCenterFixture.calls.filter(c => c.method === 'phantom.events').length), 0);
  });
  await check('bloqueadas primero, estados separados, detalle y salida real', async () => {
    const first = center.locator('.cc-task').first();
    assert.match(await first.innerText(), /confirmar decisión de alcance/);
    assert.match(await first.innerText(), /Fuente: blocked · Controlador: running/);
    assert.match(await first.innerText(), /falta decisión del operador/);
    await first.click();
    await center.getByText('SYNTHETIC · evento nativo seleccionado', { exact: false }).waitFor();
    for (const heading of ['Objetivo', 'Worktree exacto', 'Alcance', 'Checks declarados', 'Evidencias de la fuente', 'Últimos eventos']) {
      await center.getByRole('heading', { name: heading, exact: true }).waitFor();
    }
    await page.evaluate(() => {
      const f = window.__commandCenterFixture;
      f.controller.output += 'SYNTHETIC · progreso real recibido por stdout\n';
      f.emit({ type: 'tool.output', workspaceId: f.state.activeWorkspaceId, id: f.controller.id, data: 'SYNTHETIC · progreso real recibido por stdout\n' });
    });
    await wait(async () => (await center.getByLabel('Salida real del controlador').innerText()).includes('progreso real recibido'), 'actual stdout');
    assert.match(await first.innerText(), /Fuente: blocked · Controlador: running/);
    assert.doesNotMatch(await center.innerText(), /\d+\s*%/);
    const ids = await page.evaluate(() => window.__commandCenterFixture.calls.filter(c => c.method === 'phantom.events').map(c => c.payload.id));
    assert.ok(ids.length > 0 && ids.every(id => id === 'task_blocked'), 'No event fan-out');
    await assertNoOverflow(center);
    await shot('desktop-blocked.png');
  });
  await check('búsqueda, filtros, refresco automático y foco/cámara estables', async () => {
    const input = center.getByLabel('Buscar tareas');
    await input.fill('no-existe-synthetic');
    await center.getByText('No hay tareas que coincidan con estos filtros.').waitFor();
    await input.fill('SYNTHETIC');
    await center.getByLabel('Filtrar tareas').selectOption('blocked');
    assert.equal(await center.locator('.cc-task').count(), 1);
    await center.getByLabel('Filtrar tareas').selectOption('all');
    await input.focus();
    const before = await count();
    const camera = await page.evaluate(() => structuredClone(window.__commandCenterFixture.state.workspaces[0].camera));
    await wait(async () => await count() > before, 'automatic refresh within 3–5s');
    assert.equal(await input.evaluate(el => el === document.activeElement), true);
    assert.deepEqual(await page.evaluate(() => window.__commandCenterFixture.state.workspaces[0].camera), camera);
    assert.equal(await input.inputValue(), 'SYNTHETIC');
    await input.fill('');
  });
  await check('fallo conserva datos, marca stale y permite recuperar', async () => {
    await page.evaluate(() => { window.__commandCenterFixture.fail = true; });
    await center.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await center.getByText('No se pudo actualizar', { exact: true }).waitFor();
    assert.equal(await center.locator('.cc-task').count(), 2);
    assert.match(await center.locator('.cc-freshness').innerText(), /Datos desactualizados/);
    await shot('desktop-error.png');
    await page.evaluate(() => { window.__commandCenterFixture.fail = false; });
    await center.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await wait(async () => await center.getByText('No se pudo actualizar', { exact: true }).count() === 0, 'recovery');
  });
  await check('pausa, refresco manual y reanudación', async () => {
    await center.getByRole('button', { name: 'Pausar', exact: true }).click();
    const before = await count();
    await page.waitForTimeout(3400);
    assert.equal(await count(), before);
    await center.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await wait(async () => await count() > before, 'manual while paused');
    await wait(() => center.getByRole('button', { name: 'Actualizar', exact: true }).isEnabled(), 'manual completed');
    const manual = await count();
    await center.getByRole('button', { name: 'Reanudar', exact: true }).click();
    await wait(async () => await count() > manual, 'resumed');
  });
  await check('desactivar conserva panel/datos y reactivar consulta de nuevo', async () => {
    await center.getByRole('button', { name: 'Desactivar Phantom', exact: true }).click();
    await center.getByRole('button', { name: 'Reactivar Phantom', exact: true }).waitFor();
    const before = await count();
    await page.waitForTimeout(3400);
    assert.equal(await count(), before);
    assert.equal(await center.locator('.cc-task').count(), 2);
    assert.equal(await center.getByRole('button', { name: 'Actualizar', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__commandCenterFixture.state.workspaces[0].nodes.length), 1);
    await center.getByRole('button', { name: 'Reactivar Phantom', exact: true }).click();
    await wait(async () => await count() > before, 'reactivated');
  });
  await check('desconexión detiene consultas y reconexión recupera', async () => {
    await page.evaluate(() => window.__commandCenterFixture.emit({ type: 'connection', status: 'disconnected' }));
    const before = await count();
    await page.waitForTimeout(3400);
    assert.equal(await count(), before);
    assert.match(await center.locator('.cc-freshness').innerText(), /Datos desactualizados/);
    await page.evaluate(() => window.__commandCenterFixture.emit({ type: 'connection', status: 'connected' }));
    await wait(async () => await count() > before, 'reconnected');
  });
  await check('catálogo vacío real y recuperación conservan el panel', async () => {
    await wait(() => center.getByRole('button', { name: 'Actualizar', exact: true }).isEnabled(), 'connected and idle');
    await page.evaluate(() => {
      const f = window.__commandCenterFixture;
      f.savedTasks = f.tasks.splice(0);
    });
    await center.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await center.getByText('No hay tareas de Phantom en esta familia de worktrees.', { exact: true }).waitFor();
    assert.equal(await center.locator('.cc-task').count(), 0);
    assert.equal(await center.getByRole('article', { name: 'Detalle de tarea' }).count(), 0);
    await page.evaluate(() => {
      const f = window.__commandCenterFixture;
      f.tasks.push(...f.savedTasks); delete f.savedTasks;
    });
    await center.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await wait(async () => await center.locator('.cc-task').count() === 2, 'catalog restored');
    await center.locator('.cc-task').first().click();
    await center.getByLabel('Salida real del controlador').waitFor();
  });
  await check('canvas compacto sin desbordamiento horizontal', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    await assertNoOverflow(center);
    await shot('compact-blocked.png');
  });
  await check('buscador abre inspector y panel compartido sin duplicarlo', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Buscar o ejecutar' }).click();
    await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill('Centro de mando');
    await page.getByRole('option').filter({ has: page.getByText('Centro de mando', { exact: true }) }).filter({ has: page.getByText('Herramientas', { exact: true }) }).click();
    await page.locator('.inspector-host .command-center').waitFor();
    assert.equal(await page.getByLabel('Herramienta contextual').inputValue(), 'command-center');
    await page.getByLabel('Herramienta contextual').selectOption('plugins');
    await page.getByRole('button', { name: 'Abrir Centro de mando', exact: true }).click();
    await center.waitFor();
    assert.equal(await page.evaluate(() => window.__commandCenterFixture.state.workspaces[0].nodes.length), 1);
  });
  assert.deepEqual(errors, [], 'No renderer exceptions');
  console.log(JSON.stringify({ fixture: 'SYNTHETIC · mock window.phantom + real Vite renderer', passed: results.length, results, screenshots: evidence }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
