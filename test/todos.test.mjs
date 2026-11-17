import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

test('Pendientes: interacción y persistencia por proyecto con fixture SYNTHETIC', { timeout: 90000 }, async () => {
  const evidence = '/tmp/phantom-todos-review';
  await mkdir(evidence, { recursive: true });
  let fixtureModule;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixtureId = '\0synthetic-todos-entry';
  const server = await createServer({
    root, configFile: false,
    cacheDir: path.join(evidence, 'vite-cache'), logLevel: 'error',
    optimizeDeps: { include: ['react', 'react-dom/client'] },
    plugins: [{
      name: 'synthetic-todos-fixture',
      configureServer(server) { server.middlewares.use(serveFixture); },
      resolveId(id) { if (id === '/synthetic-todos-entry.js') return fixtureId; },
      load(id) { if (id === fixtureId) return fixtureModule; },
    }],
    server: { host: '127.0.0.1', port: 0 },
  });
  // Explicit SYNTHETIC adapter: real shipping React component, localStorage
  // stands in for the task API's durable project store. No native Phantom data.
  function serveFixture(req, res, next) {
    if (req.url?.split('?')[0] !== '/synthetic-todos') return next();
    res.setHeader('Content-Type', 'text/html');
    fixtureModule = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import '/src/styles.css';
      import { Todos, ToolContent } from '/src/components/ToolPanels.jsx';
      const seed = { a: [{ id: 'native', title: 'SYNTHETIC native', kind: 'phantom', status: 'doing', refs: [] },
        { id: 'steps', title: 'SYNTHETIC checklist', kind: 'checklist', status: 'doing', description: 'Paso conservado', refs: [] }], b: [] };
      const read = () => JSON.parse(localStorage.getItem('synthetic-todos') || JSON.stringify(seed));
      window.fixture = { fail: false, calls: [] };
      function App() {
        const [project, setProject] = React.useState('a'), [data, setData] = React.useState(read);
        const [hub, setHub] = React.useState(false);
        window.fixture.openHub = () => setHub(true);
        const api = async (method, payload) => {
          window.fixture.calls.push({ method, payload });
          if (method === 'phantom.list') return { available: true, items: [] };
          if (window.fixture.fail) throw Error('SYNTHETIC fallo de escritura');
          const store = read(), tasks = store[payload.workspaceId];
          if (method === 'task.create') tasks.push({ ...payload, id: crypto.randomUUID() });
          else if (method === 'task.update') Object.assign(tasks.find(t => t.id === payload.id), payload.patch);
          else if (method === 'task.remove') store[payload.workspaceId] = tasks.filter(t => t.id !== payload.id);
          else throw Error('Unexpected API ' + method);
          localStorage.setItem('synthetic-todos', JSON.stringify(store));
        };
        return React.createElement(React.Fragment, null,
          React.createElement('button', { onClick: () => setProject(project === 'a' ? 'b' : 'a') }, 'Cambiar proyecto'),
          React.createElement('main', { className: 'tw-content' }, React.createElement(hub ? ToolContent : Todos, { key: project + hub, type: 'tasks', node: { data: { hubTab: 'tasks' } }, workspace: { id: project, tasks: data[project] }, api, refresh: async () => setData(read()) })));
      }
      createRoot(document.getElementById('root')).render(React.createElement(App));
    `;
    res.end('<html><body><div id="root"></div><script type="module" src="/synthetic-todos-entry.js"></script></body></html>');
  }
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('/synthetic-todos', server.resolvedUrls.local[0]).href);
    const input = page.getByLabel('Añadir pendiente');
    await input.fill('SYNTHETIC nuevo');
    await input.press('Enter');
    const row = page.getByRole('article', { name: 'SYNTHETIC nuevo', exact: true });
    await row.waitFor();
    assert.equal(await input.inputValue(), '');
    assert.equal(await input.evaluate(el => el === document.activeElement), true);
    await page.evaluate(() => { window.fixture.fail = true; });
    await row.getByRole('checkbox').click();
    await page.getByRole('alert').waitFor();
    assert.equal(await row.getByRole('checkbox').isChecked(), false);
    await page.evaluate(() => { window.fixture.fail = false; });
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Completados', exact: true }).click();
    await row.waitFor();
    assert.equal(await page.getByRole('article').count(), 1);
    assert.equal(await row.getByRole('checkbox').isChecked(), true);
    await page.reload();
    await row.waitFor();
    assert.equal(await row.getByRole('checkbox').isChecked(), true);
    await page.getByText('1 pendientes · 1 completados · 2 en total', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Todos', exact: true }).click();
    assert.equal(await page.getByRole('article').count(), 2);
    await page.getByRole('button', { name: 'Pendientes', exact: true }).click();
    await row.waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('article').count(), 1);
    await page.getByRole('button', { name: 'Completados', exact: true }).click();
    await row.getByRole('checkbox').click();
    await row.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Pendientes', exact: true }).click();
    await row.waitFor();
    assert.equal(await row.getByRole('checkbox').isChecked(), false);
    await page.screenshot({ path: path.join(evidence, 'pending.png'), fullPage: true });
    await row.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByLabel('Título del pendiente').fill('SYNTHETIC editado');
    await page.evaluate(() => { window.fixture.fail = true; });
    await row.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Título del pendiente').inputValue(), 'SYNTHETIC editado');
    await page.screenshot({ path: path.join(evidence, 'write-error.png'), fullPage: true });
    await page.evaluate(() => { window.fixture.fail = false; });
    await row.getByRole('button', { name: 'Guardar', exact: true }).click();
    const edited = page.getByRole('article', { name: 'SYNTHETIC editado', exact: true });
    await edited.waitFor();
    await page.getByRole('button', { name: 'Cambiar proyecto' }).click();
    assert.equal(await page.getByRole('article').count(), 0);
    await page.getByRole('button', { name: 'Cambiar proyecto' }).click();
    await edited.waitFor();
    await page.reload();
    await edited.waitFor();
    await page.getByText('2 pendientes · 0 completados · 2 en total', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'persisted.png'), fullPage: true });
    await page.evaluate(() => { window.fixture.fail = true; });
    await edited.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await edited.count(), 1);
    await page.evaluate(() => { window.fixture.fail = false; });
    await edited.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await edited.waitFor({ state: 'detached' });
    await page.reload();
    await input.waitFor();
    assert.equal(await edited.count(), 0);
    await page.evaluate(() => { window.fixture.fail = true; });
    await input.fill('SYNTHETIC conservar borrador');
    await input.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(await input.inputValue(), 'SYNTHETIC conservar borrador');
    assert.equal(await page.getByRole('article').count(), 1);
    await page.evaluate(() => { window.fixture.fail = false; });
    await input.press('Enter');
    const retried = page.getByRole('article', { name: 'SYNTHETIC conservar borrador', exact: true });
    await retried.waitFor();
    assert.equal(await input.inputValue(), '');
    await page.reload();
    await retried.waitFor();
    assert.equal(await page.getByRole('article').count(), 2);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('synthetic-todos')));
    assert.equal(stored.a.find(t => t.id === 'native').status, 'doing');
    assert.equal(stored.a.find(t => t.id === 'steps').kind, 'checklist');
    assert.equal(stored.a.find(t => t.id === 'steps').status, 'doing');
    assert.equal(stored.a.find(t => t.id === 'steps').description, 'Paso conservado');
    assert.equal(stored.a.filter(t => t.title === 'SYNTHETIC conservar borrador').length, 1);
    assert.deepEqual(stored.b, []);
    await page.evaluate(() => window.fixture.openHub());
    const tab = page.getByRole('tab', { name: 'Pendientes', exact: true });
    await tab.waitFor();
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    const panel = page.getByRole('tabpanel', { name: 'Pendientes', exact: true });
    await panel.getByRole('heading', { name: 'Borradores', exact: true }).waitFor();
    await panel.getByText('SYNTHETIC native', { exact: true }).waitFor();
    await panel.getByLabel('Añadir pendiente').fill('SYNTHETIC desde Trabajo');
    await panel.getByLabel('Añadir pendiente').press('Enter');
    const integrated = panel.getByRole('article', { name: 'SYNTHETIC desde Trabajo', exact: true });
    await integrated.waitFor();
    await integrated.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Completados', exact: true }).click();
    await integrated.waitFor();
    assert.equal(await integrated.getByRole('checkbox').isChecked(), true);
    await page.screenshot({ path: path.join(evidence, 'work-hub.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); }
    finally { await server.close(); }
  }
});
