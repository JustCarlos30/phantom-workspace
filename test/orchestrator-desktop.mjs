import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// SYNTHETIC: real components and callbacks, no host, Git or agent operations.
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = '/tmp/opencode/orchestrator-review';
await mkdir(evidence, { recursive: true });
const oid = 'a'.repeat(40), baseOid = 'b'.repeat(40);
const request = (id, status, position, extra = {}) => ({ id, nodeId: id, title: `SYNTHETIC · ${id}`, branch: `phantom/${id}`,
  status, position, headOid: oid, behind: 2, requestedAt: '2026-11-13T10:00:00Z', summary: `Cambios de ${id} para el proyecto.`,
  inspection: { available: true, headOid: oid, baseOid, files: ['src/shared.jsx'], fileCount: 1 }, ...extra });
const branch = (nodeId, status, extra = {}) => ({ nodeId, title: `SYNTHETIC · ${nodeId}`, branch: `phantom/${nodeId}`,
  status, ahead: 2, behind: 0, uncommitted: 0, running: true, step: `Trabajo de ${nodeId}.`, files: ['src/shared.jsx'], ...extra });
const data = { available: true, enabled: true, base: { branch: 'main', uncommitted: 1 },
  guard: { installed: false, reason: 'SYNTHETIC · Hook no instalado.' }, checks: { command: 'npm test' },
  orchestrator: { nodeId: 'orchestrator', title: 'Orquestador' }, plan: 'Revisar primero las devoluciones y después la cola.',
  planUpdatedAt: '2026-11-13T11:00:00Z',
  // Deliberately interleaved: attention first, queue order stays as received.
  queue: [request('cola-z', 'queued', 1, { cardId: 'card-z', stale: true, overlaps: [{ path: 'src/shared.jsx', with: ['cola-a'] }] }),
    request('conflicto', 'conflict', null, { conflicts: ['src/shared.jsx'], note: 'Resolver conflicto antes de reenviar.' }),
    request('cola-a', 'queued', 2), request('checks', 'failed', null, { note: 'Falló la prueba del contrato.', checks: { headOid: oid, baseOid, ok: false, command: 'npm test', code: 1 } })],
  active: [branch('sin-solicitar', 'review'), branch('trabajando', 'working', { uncommitted: 3 }), branch('bloqueada', 'blocked', { step: 'Necesita decisión sobre el alcance.' })],
  history: [request('historial', 'merged', null, { mergedOid: oid, finishedAt: '2026-11-13T09:00:00Z' })] };
const workspace = { id: 'synthetic-orchestrator', integration: {}, nodes: [...data.queue, ...data.active, ...data.history].map(item => ({ id: item.nodeId, type: 'terminal' })) };
workspace.nodes.push({ id: 'orchestrator', type: 'terminal' });

const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import PhantomOrchestrator from '/src/components/PhantomOrchestrator.jsx';
import Incorporaciones from '/src/components/Incorporaciones.jsx';
import '/src/styles.css';
import '/src/studio.css';
import '/src/phantom-chat.css';
const root = createRoot(document.getElementById('root'));
const seed = structuredClone(window.fixture);
window.calls = []; window.opened = []; window.notices = [];
const api = async (method, payload = {}) => {
  window.calls.push({ method, payload });
  if (method === 'merge.status') {
    const value = structuredClone(window.fixture.data);
    if (payload.requestId) {
      const item = value.queue.find(item => item.id === payload.requestId);
      if (item) item.inspection = { ...item.inspection, diff: 'diff --git a/src/shared.jsx b/src/shared.jsx\\n+SYNTHETIC', diffTruncated: false };
    }
    return value;
  }
  if (method === 'merge.configure') { window.fixture.data.enabled = payload.enabled; return {}; }
  if (method === 'phantom.detail') return { id: payload.id, contract: { goal: 'SYNTHETIC · Objetivo de Card', scope: ['src/shared.jsx'], checks: [], dependencies: [] } };
  if (method === 'chat.get') return { messages: [], running: false };
  if (method === 'chat.send') { if (window.failSend) throw new Error('SYNTHETIC · No se pudo enviar.'); return {}; }
  throw new Error('Unexpected fixture API: ' + method);
};
const onOpenPanel = (...args) => window.opened.push(args);
window.renderFixture = (mode = 'normal') => {
  window.fixture = structuredClone(seed);
  const data = window.fixture.data;
  if (mode === 'empty' || mode === 'disabled') { data.queue = []; data.active = []; data.history = []; data.plan = ''; data.base.uncommitted = 0; data.guard.installed = true; }
  if (mode === 'disabled') data.enabled = false;
  if (mode === 'no-session') data.orchestrator = null;
  const session = mode === 'no-session' ? null : { id: 'orchestrator', title: 'SYNTHETIC · Orquestador', agent: 'idle', chat: mode !== 'terminal' };
  const props = { workspace: window.fixture.workspace, api, onOpenPanel, notify: (...args) => window.notices.push(args) };
  root.render(React.createElement('main', { key: mode, className: 'fixture', 'data-mode': mode },
    React.createElement('h1', null, 'SYNTHETIC · Orquestador'),
    mode === 'standalone' ? React.createElement(Incorporaciones, props) : React.createElement(PhantomOrchestrator, { ...props, connected: true, status: { orchestrator: session, tone: 'idle' } })));
};
window.renderFixture();
`;
const server = await createServer({ root, configFile: false, base: '/', cacheDir: path.join(evidence, 'vite-cache'),
  plugins: [{ name: 'synthetic-orchestrator',
    resolveId(id) { if (id === '/orchestrator-fixture.jsx') return '\0orchestrator-fixture'; },
    load(id) { if (id === '\0orchestrator-fixture') return source; },
    configureServer(server) {
      server.middlewares.use('/orchestrator-fixture.html', async (_req, res, next) => {
        try {
          const html = await server.transformIndexHtml('/orchestrator-fixture.html', '<!doctype html><html><head><meta charset="UTF-8"><title>Synthetic orchestrator</title><style>html:root,html body,body #root{height:auto;min-height:100%;overflow:auto}.fixture{width:100%;max-width:1000px;margin:0 auto;padding:16px}h1{font-size:14px;color:var(--muted);margin-bottom:16px}</style></head><body><div id="root"></div><script type="module" src="/orchestrator-fixture.jsx"></script></body></html>');
          res.setHeader('Content-Type', 'text/html'); res.end(html);
        } catch (error) { next(error); }
      });
    } }], server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ data, workspace }) => {
    window.fixture = { data, workspace };
    window.phantom = { onEvent() { return () => {}; } };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new Error('SYNTHETIC · Micrófono no disponible.'); } });
  }, { data, workspace });
  await page.goto(`${server.resolvedUrls.local[0]}orchestrator-fixture.html`);
  const inc = page.locator('.inc');
  await inc.locator('.inc-item').first().waitFor();
  const titles = () => inc.locator('section.inc-section > .inc-list > .inc-item .inc-row-title').allTextContents();
  assert.deepEqual(await titles(), ['conflicto', 'checks', 'bloqueada', 'cola-z', 'cola-a', 'sin-solicitar', 'trabajando'].map(id => `SYNTHETIC · ${id}`));
  assert.equal(await inc.locator('.inc-stat').count(), 3);
  assert.equal(await inc.getByText('Listas para mergear', { exact: true }).count(), 0);
  assert.equal(await inc.locator('.inc-fold[open]').count(), 0);
  assert.equal(await inc.getByRole('button', { name: 'Desactivar', exact: true }).isVisible(), false);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.payload.requestId || call.method === 'phantom.detail' || call.method === 'chat.send').length), 0);
  assert.match(await inc.innerText(), /Hook no instalado/);
  assert.match(await inc.innerText(), /Falló la prueba del contrato/);
  await inc.getByText('Plan del orquestador', { exact: false }).click();
  await inc.locator('.inc-plan').waitFor();
  await inc.getByText('Plan del orquestador', { exact: false }).click();
  const history = inc.locator('details.inc-fold').filter({ has: page.locator('summary', { hasText: /^Historial/ }) });
  await history.locator(':scope > summary').click();
  await history.getByText('SYNTHETIC · historial', { exact: true }).waitFor();
  await history.locator(':scope > summary').click();
  await page.screenshot({ path: path.join(evidence, 'wide.png'), fullPage: true });

  for (const name of ['Necesitan atención', 'Para revisar', 'En curso']) {
    const stat = inc.getByRole('button', { name: new RegExp(name) });
    await stat.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(name => document.activeElement?.querySelector('h3')?.textContent.startsWith(name), name), true);
  }
  const queued = inc.locator('.inc-item').filter({ has: page.getByText('SYNTHETIC · cola-z', { exact: true }) });
  const unrequested = inc.locator('.inc-item').filter({ has: page.getByText('SYNTHETIC · sin-solicitar', { exact: true }) });
  assert.match(await unrequested.innerText(), /Sin solicitar/);
  assert.match(await unrequested.innerText(), /Enviar la solicitud de integración/);
  assert.match(await queued.innerText(), /turno 1/);
  await queued.getByRole('button', { name: 'Ir a terminal' }).click();
  assert.deepEqual(await page.evaluate(() => window.opened.at(-1)), ['terminal', { focusNodeId: 'cola-z' }]);
  await queued.getByRole('button', { name: 'Ver Card' }).click();
  assert.deepEqual(await page.evaluate(() => window.opened.at(-1)), ['phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId: 'card-z' }, 'Card']);
  await queued.locator('summary').filter({ hasText: /^Revisar$/ }).focus(); await page.keyboard.press('Enter');
  await queued.getByRole('heading', { name: 'Lo pedido en la Card' }).waitFor();
  assert.match(await queued.innerText(), /sin evidencia registrada para el commit enviado/);
  assert.match(await queued.innerText(), /src\/shared.jsx \(cola-a\)/);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.payload.requestId).length), 0);
  await queued.getByText('Camino completo de incorporación', { exact: true }).click();
  await queued.locator('.mp-steps').waitFor();
  await queued.getByText('Ver diff del commit enviado', { exact: true }).click();
  await queued.locator('.inc-diff').waitFor();
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.payload.requestId === 'cola-z').length), 1);
  await page.screenshot({ path: path.join(evidence, 'review-wide.png'), fullPage: true });

  const layout = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page must fit viewport');
    assert.deepEqual(await inc.locator('button, summary, .inc-title, .inc-review-body, .mp').evaluateAll(elements => elements.filter(el => el.getClientRects().length && (el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1)).map(el => el.textContent)), [], 'visible controls/details must fit');
  };
  await layout();
  await page.setViewportSize({ width: 360, height: 900 });
  await layout();
  await page.screenshot({ path: path.join(evidence, 'review-360.png'), fullPage: true });
  await queued.getByText('Revisar', { exact: true }).click();
  await layout();
  await page.screenshot({ path: path.join(evidence, 'compact-360.png'), fullPage: true });
  const polls = await page.evaluate(() => window.calls.filter(call => call.method === 'merge.status' && !call.payload.requestId).length);
  await page.waitForFunction(count => window.calls.filter(call => call.method === 'merge.status' && !call.payload.requestId).length > count, polls, { timeout: 8000 });

  await page.getByRole('button', { name: 'Abrir conversación', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.opened.at(-1)), ['terminal', { focusNodeId: 'orchestrator' }]);
  const composer = page.getByRole('textbox', { name: 'Mensaje para SYNTHETIC · Orquestador' });
  await composer.fill('SYNTHETIC · mensaje explícito');
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'chat.send').length), 0);
  await composer.press('Shift+Enter');
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'chat.send').length), 0);
  await composer.press('Enter');
  await page.waitForFunction(() => window.calls.some(call => call.method === 'chat.send'));
  await page.evaluate(() => { window.failSend = true; });
  await composer.fill('SYNTHETIC · fallará'); await composer.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'No se pudo enviar' }).waitFor();
  assert.equal(await composer.inputValue(), 'SYNTHETIC · fallará');
  await page.getByRole('button', { name: 'Dictar al orquestador' }).click();
  await page.getByRole('alert').filter({ hasText: 'Micrófono no disponible' }).waitFor();
  await layout();
  await page.screenshot({ path: path.join(evidence, 'composer-errors-360.png'), fullPage: true });

  const render = async mode => {
    await page.evaluate(mode => window.renderFixture(mode), mode);
    await page.waitForFunction(mode => document.querySelector('main')?.dataset.mode === mode, mode);
    await inc.waitFor();
  };
  await render('terminal');
  await page.getByRole('button', { name: 'Abrir terminal', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.opened.at(-1)), ['terminal', { focusNodeId: 'orchestrator' }]);
  assert.equal(await page.locator('.pd-composer').count(), 0);
  await render('standalone');
  await inc.getByRole('button', { name: 'Ver Orquestador', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.opened.at(-1)), ['terminal', { focusNodeId: 'orchestrator' }]);
  await layout();
  await render('no-session');
  await inc.getByRole('button', { name: 'Abrir sesión orquestadora' }).click();
  const opened = await page.evaluate(() => window.opened.at(-1));
  assert.equal(opened[0], 'terminal'); assert.equal(opened[1].role, 'orchestrator');
  assert.equal(opened[2], 'Orquestador');
  assert.match(await inc.innerText(), /Abrir la sesión orquestadora/);
  await render('empty');
  await inc.getByText('Todo al día.', { exact: false }).waitFor();
  assert.equal(await inc.locator('.inc-item').count(), 0);
  assert.equal(await inc.locator('.inc-empty').count(), 1);
  await layout();
  await page.screenshot({ path: path.join(evidence, 'empty-360.png'), fullPage: true });
  await render('disabled');
  await inc.getByRole('button', { name: 'Activar Incorporaciones' }).waitFor();
  assert.equal(await inc.locator('details[open]').count(), 0);
  await inc.getByText('Cómo funciona · hooks', { exact: true }).click();
  assert.match(await inc.innerText(), /reference-transaction/);
  await layout();
  await page.screenshot({ path: path.join(evidence, 'disabled-360.png'), fullPage: true });
  await inc.getByRole('button', { name: 'Activar Incorporaciones' }).click();
  await inc.locator('.inc-stats').waitFor();
  assert.deepEqual(await page.evaluate(() => window.calls.filter(call => call.method === 'merge.configure').at(-1).payload), { workspaceId: workspace.id, enabled: true });
  await inc.getByText('Configuración', { exact: true }).click();
  await inc.getByRole('button', { name: 'Desactivar', exact: true }).click();
  await inc.getByRole('button', { name: 'Activar Incorporaciones' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.calls.filter(call => call.method === 'merge.configure').at(-1).payload), { workspaceId: workspace.id, enabled: false });
  assert.deepEqual(errors, []);
  console.log(`PASS orchestrator interactions · captures in ${evidence}`);
} finally {
  await browser?.close();
  await server.close();
}
