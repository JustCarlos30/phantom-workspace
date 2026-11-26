import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createAgentTraceStore } from '../host/agent-traces.mjs';
import { createWorkspaceSupervisor } from '../host/workspace-supervisor.mjs';
import { adaptTraceEvent, adaptTurnTrace, createTraceState } from '../host/agent-trace-adapters.mjs';
import { publicTraceAgent, traceParams } from '../host/workspace-events.mjs';

// Offline acceptance of the agent history and supervisor UI. Productive React (ChatCard, PhantomChat, PhantomOrchestrator) with its
// real CSS runs in headless Chromium through esbuild + page.setContent. Its API is backed by the REAL agent-traces and
// workspace-supervisor modules over a temp dir, using the host's own param validators. The provider is a FIXTURE: Claude
// stream-json shaped events and a fake summarizer. This proves the UI against real module data; it does not prove host
// security (test/workspace-events-host.test.mjs does, with the real host) nor any real provider behaviour.
const WS = 'ws-obs';
const artifacts = '.test-artifacts';
const T1 = 'task_11111111-1111-4111-8111-111111111111';
const results = [], measurements = [];
let browser, bundle;

before(async () => {
  await mkdir(artifacts, { recursive: true });
  bundle = await build({ entryPoints: ['test/fixtures/agent-observability.jsx'], bundle: true, write: false, outdir: '.test-artifacts/agent-observability-bundle', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' } });
  let executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath) && fs.existsSync('/ms-playwright')) {
    const installed = fs.readdirSync('/ms-playwright').filter(name => name.startsWith('chromium-'));
    executablePath = installed.flatMap(name => ['chrome-linux', 'chrome-linux64'].map(dir => `/ms-playwright/${name}/${dir}/chrome`)).find(file => fs.existsSync(file));
    assert.ok(executablePath, 'Chromium preinstalado en la imagen declarada');
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  await mkdir(artifacts, { recursive: true });
  await writeFile(`${artifacts}/agent-observability-geometry.json`, JSON.stringify(measurements, null, 2));
  await writeFile(`${artifacts}/agent-observability-verification.md`, [
    '# Verificación renderizada de historial de agentes y supervisor', '',
    `Generado por \`node --test test/agent-observability-ui.test.mjs\` el ${new Date().toISOString()}.`,
    'React productivo (ChatCard, PhantomChat y PhantomOrchestrator) con su CSS real, Chromium headless, bundle esbuild y page.setContent; sin servidor HTTP.',
    'Backend de la fixture: módulos reales `agent-traces` y `workspace-supervisor` sobre un directorio temporal. **El proveedor es una fixture** (eventos con forma de Claude stream-json y resumidor falso); no se ejecutó ningún proveedor real ni se activó el supervisor en proyectos del usuario.',
    'No acredita seguridad del host ni el montaje de `App.jsx` completo: comparte con ella `useAgentOpener`, pero el `Provider` y el estado de pestaña del dock están reproducidos (ver docs/agent-observability.md).', '',
    '## Aceptaciones observadas', ...(results.length ? results.map(result => `- ${result}`) : ['Ninguna aceptación completada. Este informe no acredita éxito.']), '',
    '## Geometría', '| Superficie | Ancho | Estado | Overflow horizontal px |', '| --- | ---: | --- | ---: |', ...measurements.map(m => `| ${m.surface} | ${m.width} | ${m.state} | ${m.overflow} |`), '',
  ].join('\n'));
});

// --- Real module data ----------------------------------------------------------------------------------------------
function createWorld(t, { summarize } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-obs-ui-'));
  t.after(() => { world.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const world = {
    dir,
    open() {
      world.traces = createAgentTraceStore({ dataDir: dir });
      world.supervisor = createWorkspaceSupervisor({ dataDir: dir, summarize });
    },
    close() { world.traces?.close(); world.supervisor?.close(); },
    // A host restart: the same directory, new instances. Open agents come back as interrupted, never as finished.
    restart() { world.close(); world.open(); },
    async rpc(method, payload) {
      const q = traceParams(method, payload);
      if (method === 'agent.traces.list') { const list = world.traces.list(q); return { ...list, items: list.items.map(publicTraceAgent) }; }
      if (method === 'agent.traces.detail') { const detail = world.traces.detail(q); return { ...detail, agent: detail.agent ? publicTraceAgent(detail.agent) : null }; }
      if (method === 'supervisor.read') return world.supervisor.read(q);
      if (method === 'supervisor.configure') return world.supervisor.configure(q);
      if (method === 'supervisor.refresh') return world.supervisor.refresh(q);
      throw new Error(`Método no soportado: ${method}`);
    },
  };
  world.open();
  return world;
}

function claudeTurn(world, nodeId, events, end = null) {
  const state = createTraceState(), base = { workspaceId: WS, nodeId, provider: 'claude', state, turnId: `turn-${nodeId}`, model: 'claude-sonnet-5-5' };
  const put = records => records.forEach(record => world.traces.record(record));
  put(adaptTurnTrace({ ...base, phase: 'start', message: `Trabaja en ${nodeId}`, instructions: 'Instrucciones sintéticas' }));
  for (const event of events) put(adaptTraceEvent({ ...base, event }));
  if (end) put(adaptTurnTrace({ ...base, phase: 'end', status: end }));
}
const agentUse = (id, description, prompt) => ({ type: 'tool_use', id, name: 'Agent', input: { description, prompt } });
const childTool = (parent, callId, name, input) => ({ type: 'assistant', parent_tool_use_id: parent, message: { id: `m-${callId}`, content: [{ type: 'tool_use', id: callId, name, input }] } });
const childResult = (parent, callId, content) => ({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: callId, content }] } });
const rootResult = (callId, content) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: callId, content }] } });

// Two chat cards (node-x, node-y). Card X: root + A1 (done), A2 (running, MCP tool), A3 (done, long history). Card Y: root + B1.
function populate(world) {
  const longRun = Array.from({ length: 60 }, (_, index) => ({ type: 'assistant', parent_tool_use_id: 'toolu_A3', message: { id: `ma3-${index}`, content: [{ type: 'text', text: `Paso largo ${index + 1}` }] } }));
  claudeTurn(world, 'node-x', [
    { type: 'system', subtype: 'init', session_id: 'sx', model: 'claude-sonnet-5-5' },
    { type: 'assistant', message: { id: 'mx1', model: 'claude-sonnet-5-5', content: [agentUse('toolu_A1', 'Explorar', 'Lee a.txt'), agentUse('toolu_A2', 'Probar', 'Registra la tarea'), agentUse('toolu_A3', 'Revisar mucho', 'Revisa cada archivo')] } },
    childTool('toolu_A1', 'toolu_C1', 'Read', { file_path: 'a.txt' }),
    childTool('toolu_A2', 'toolu_C2', 'mcp__phantom_workspace__phantom', { cli: 'agent', args: ['bind', T1] }),
    childResult('toolu_A1', 'toolu_C1', 'contenido de a.txt'),
    ...longRun,
    rootResult('toolu_A1', 'Exploración terminada'),
    rootResult('toolu_A3', 'Revisión terminada'),
  ]);
  claudeTurn(world, 'node-y', [
    { type: 'system', subtype: 'init', session_id: 'sy', model: 'claude-sonnet-5-5' },
    { type: 'assistant', message: { id: 'my1', model: 'claude-sonnet-5-5', content: [agentUse('toolu_B1', 'Auditar', 'Audita pagos')] } },
    childTool('toolu_B1', 'toolu_D1', 'Grep', { pattern: 'pagos' }),
    childResult('toolu_B1', 'toolu_D1', 'tres coincidencias'),
    rootResult('toolu_B1', 'Auditoría terminada'),
  ]);
}

// --- Browser ------------------------------------------------------------------------------------------------------
async function render(world, options = {}) {
  const page = await browser.newPage({ viewport: { width: Math.max(options.width ?? 900, 320), height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.exposeFunction('hostCall', (method, payload) => world.rpc(method, payload));
  await page.setContent('<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body class="app-shell"><div id="fixture"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: `body.app-shell { margin: 0; min-width: 0; display: block; }
    #fixture { height: 860px; position: relative; container-type: inline-size; overflow: hidden; }
    .ao-layout { display: flex; height: 100%; min-width: 0; }
    .ao-canvas { display: flex; flex-direction: column; gap: 8px; flex: none; width: 360px; overflow: auto; }
    .ao-card { flex: none; width: 100%; height: 420px; position: relative; overflow: hidden; }
    .ao-card > * { height: 100%; }
    .ao-layout > .phantom-chat { position: relative; inset: auto; flex: 1 1 0; width: auto; min-width: 0; height: 100%; overflow: auto; }` });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.evaluate(options => window.mountObservability(options), options);
  page.checkFixture = async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [], 'Render estrictamente offline');
    const unknown = await page.evaluate(() => window.fixture.unknown);
    assert.deepEqual(unknown.filter(method => /^(agent\.|supervisor\.)/.test(method)), [], 'solo se usan los RPC de observabilidad declarados');
  };
  return page;
}
async function close(page) { await page.evaluate(() => window.disposeObservability()); await page.checkFixture(); await page.close(); }
const detail = page => page.locator('section.pd-agent');
const historyText = page => page.getByRole('list', { name: 'Historial del agente' }).innerText();
const overflow = page => page.evaluate(() => {
  const fixture = document.getElementById('fixture'), dock = document.querySelector('.ao-dock .pd-orchestrator') ?? document.querySelector('.pd-orchestrator');
  return { page: document.documentElement.scrollWidth - window.innerWidth, fixture: fixture.scrollWidth - fixture.clientWidth, dock: dock ? dock.scrollWidth - dock.clientWidth : 0 };
});
async function measure(page, surface, width, state) {
  const found = await overflow(page);
  measurements.push({ surface, width, state, overflow: Math.max(found.page, found.fixture, found.dock, 0) });
  assert.ok(found.page <= 0 && found.fixture <= 1 && found.dock <= 1, `${surface} ${width}px ${state}: overflow horizontal ${JSON.stringify(found)}`);
}

test('the right-hand tab is «Agentes» and offers «Abrir orquestador» for the global section', async t => {
  const world = createWorld(t); populate(world);
  const page = await render(world, { surface: 'both', width: 900 });
  await page.getByRole('tab', { name: 'Agentes' }).waitFor();
  assert.equal(await page.getByRole('tab', { name: /^Orquestador/ }).count(), 0);
  await page.getByRole('button', { name: 'Abrir orquestador' }).click();
  assert.equal(await page.evaluate(() => window.fixture.hubOpened), 1);
  await close(page);
});

test('clicking a sub-agent in any canvas card opens that agent in the dock, with no mixing between cards', async t => {
  const world = createWorld(t); populate(world);
  const page = await render(world, { surface: 'both', width: 900 });
  await page.locator('[data-card="node-x"] [aria-label^="Subagente"][aria-label*="Explorar"] .pc-phantom-open').click();
  await detail(page).waitFor();
  assert.equal(await detail(page).getAttribute('aria-label'), 'Detalle de Explorar');
  const first = await historyText(page);
  assert.match(first, /Read/);
  assert.doesNotMatch(first, /mcp__phantom_workspace__phantom|Grep|Paso largo/, 'the history is that agent\'s only');
  assert.match(await detail(page).innerText(), /Padre\s*Agente principal/);
  // The assignment text sits in a collapsed <details>: it is real content, shown once the user opens it.
  await detail(page).getByRole('region', { name: 'Contexto' }).getByText('Ver texto').first().click();
  assert.match(await detail(page).innerText(), /Lee a\.txt/, 'the assignment is shown as the child\'s own context');
  // Instructions are not inherited by the child: the UI says so instead of copying the root's.
  assert.match(await detail(page).getByRole('region', { name: 'Contexto' }).innerText(), /Instrucciones[\s\S]*No disponible/);
  // The parent link leads to card X's root: its children are X's, never card Y's.
  await detail(page).getByRole('button', { name: 'Agente principal' }).click();
  // The agent selector lists every agent of the project by design; ownership is judged on the children block only.
  const rootChildren = await detail(page).locator('.pd-agent-children').innerText();
  assert.match(rootChildren, /Explorar/);
  assert.match(rootChildren, /Probar/);
  assert.doesNotMatch(rootChildren, /Auditar/);
  assert.match(await detail(page).getByRole('region', { name: 'Contexto' }).innerText(), /Instrucciones[\s\S]*Ver texto/);
  await detail(page).getByRole('button', { name: 'Volver' }).click();
  // Card Y: another workspace node, another root; nothing of A1 survives.
  await page.locator('[data-card="node-y"] [aria-label^="Subagente"][aria-label*="Auditar"] .pc-phantom-open').click();
  await detail(page).waitFor();
  assert.equal(await detail(page).getAttribute('aria-label'), 'Detalle de Auditar');
  const second = await historyText(page);
  assert.match(second, /Grep/);
  assert.doesNotMatch(second, /Read|Paso largo|mcp__/);
  assert.deepEqual(await page.evaluate(() => window.fixture.requests), [
    { workspaceId: WS, nodeId: 'node-x', id: 'toolu_A1' },
    { workspaceId: WS, nodeId: 'node-y', id: 'toolu_B1' },
  ]);
  const detailCalls = await page.evaluate(() => window.fixture.calls.filter(call => call.method === 'agent.traces.detail').map(call => call.payload));
  assert.ok(detailCalls.every(call => call.workspaceId === WS && typeof call.id === 'string'));
  // A request that names another project is dropped before it reaches the dock.
  const before = await page.evaluate(() => window.fixture.requests.length);
  await page.evaluate(() => window.fixture.open({ workspaceId: 'otro-proyecto', nodeId: 'node-x', id: 'toolu_A2' }));
  assert.equal(await page.evaluate(() => window.fixture.requests.length), before);
  // The MCP tool call of the second child stays on its own history.
  await detail(page).getByRole('button', { name: 'Volver' }).click();
  await page.locator('[data-card="node-x"] [aria-label^="Subagente"][aria-label*="Probar"] .pc-phantom-open').click();
  await detail(page).waitFor();
  const third = await historyText(page);
  assert.match(third, /mcp__phantom_workspace__phantom/);
  assert.doesNotMatch(third, /Read|Grep/);
  await close(page);
  results.push('Clic desde dos tarjetas del canvas abre el detalle de su subagente con identidad workspace/node/id; sin mezcla de historiales ni de padre.');
});

test('long histories paginate with a continuable cursor and finished or restarted agents are not shown as running', async t => {
  const world = createWorld(t); populate(world);
  world.restart();
  const page = await render(world, { surface: 'dock', width: 480 });
  const list = page.getByRole('list', { name: 'Árbol de agentes' });
  await list.waitFor();
  const listText = await list.innerText();
  assert.match(listText, /Sesión: Conversación X/);
  assert.match(listText, /Sesión: Conversación Y/);
  const row = id => page.locator(`[data-agent-row="${id}"]`);
  assert.match(await row('toolu_A1').innerText(), /Terminó/);
  assert.match(await row('toolu_A2').innerText(), /Interrumpido/);
  assert.doesNotMatch(await row('toolu_A2').innerText(), /Trabajando|Terminó/);
  // The interrupted agent keeps its history, says the outcome is unknown, and offers no invented result.
  await row('toolu_A2').click();
  await detail(page).waitFor();
  assert.match(await historyText(page), /El host se reinició; el estado final es desconocido\./);
  assert.match(await detail(page).getByRole('region', { name: 'Resultado' }).innerText(), /./);
  assert.doesNotMatch(await detail(page).getByRole('region', { name: 'Resultado' }).innerText(), /Revisión terminada|Exploración terminada/);
  await detail(page).getByRole('button', { name: 'Volver' }).click();
  // Pagination: the first page is bounded, the next one continues from the host cursor and nothing repeats.
  await row('toolu_A3').click();
  await detail(page).waitFor();
  const items = detail(page).getByRole('list', { name: 'Historial del agente' }).getByRole('listitem');
  await until(async () => (await items.count()) > 0);
  const firstPage = await items.count();
  assert.equal(firstPage, 50, 'the first page holds one bounded page of events');
  const more = detail(page).getByRole('button', { name: 'Cargar más historial' });
  await more.click();
  await until(async () => (await items.count()) > firstPage);
  const total = await items.count();
  assert.ok(total >= 60 && total <= 70, `the second page continues the history (${total})`);
  const texts = await items.allInnerTexts();
  assert.equal(new Set(texts.map(text => text.replace(/\d{2}:\d{2}:\d{2}/g, ''))).size, texts.length, 'no event is shown twice');
  assert.equal(await more.count(), 0, 'no more pages once the cursor is exhausted');
  const pages = await page.evaluate(() => window.fixture.calls.filter(call => call.method === 'agent.traces.detail' && call.payload.id === 'toolu_A3').map(call => call.payload));
  assert.ok(pages.some(call => call.cursor && /^\d+$/.test(call.cursor)), 'the continuation request carries the host cursor');
  assert.ok(pages.every(call => call.limit <= 200));
  await close(page);
  results.push('Paginación de 50 eventos con cursor continuable sin duplicados; agentes terminados e interrumpidos tras reinicio con su estado real y sin resultado inventado.');
});

test('supervisor off, on, summary, proposal and provider errors are shown honestly and local feed stays', async t => {
  let mode = 'ok';
  const world = createWorld(t, { summarize: async ({ input }) => {
    if (mode === 'unavailable') throw Object.assign(new Error('Claude Code no tiene una sesión válida.'), { code: 'SUPERVISOR_PROVIDER_UNAVAILABLE' });
    if (mode === 'error') throw new Error('Proveedor sin respuesta');
    assert.ok(input.allowedEvidenceIds.includes('ev-blocked'));
    return { summary: 'Un agente espera credenciales.', proposals: [
      { kind: 'unblock', title: 'Desbloquear al agente', reason: 'Lleva tiempo esperando una decisión.', evidenceIds: ['ev-blocked'] },
      { kind: 'unblock', title: 'Cita inventada', reason: 'No existe.', evidenceIds: ['no-existe'] }] };
  } });
  populate(world);
  world.supervisor.ingest({ workspaceId: WS, kind: 'terminal', entityId: 'node-x', status: 'blocked', title: 'Esperando credenciales', eventId: 'ev-blocked' });
  const page = await render(world, { surface: 'dock', width: 480 });
  const section = page.getByRole('region', { name: 'Supervisor' });
  const toggle = section.getByRole('switch');
  await section.getByText('Desactivado: solo se conserva la actividad local.').waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.equal(await toggle.getAttribute('aria-label'), 'Activar supervisor');
  assert.match(await section.locator('.pd-sup-feed summary').innerText(), /Actividad reciente · 1/);
  assert.equal(await section.getByRole('button', { name: 'Actualizar resumen' }).count(), 0, 'no summary button while disabled');
  assert.equal(world.supervisor.read({ workspaceId: WS }).status, 'disabled');
  // On: nothing is summarized until asked; no cost is invented.
  await toggle.click();
  await section.getByText('Aún sin resumen.').waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  assert.match(await section.innerText(), /Coste: No disponible/);
  assert.deepEqual(await page.evaluate(() => window.fixture.calls.filter(call => call.method === 'supervisor.configure').map(call => call.payload)), [{ workspaceId: WS, patch: { enabled: true } }]);
  await section.getByRole('button', { name: 'Actualizar resumen' }).click();
  await section.getByText('Un agente espera credenciales.').waitFor();
  const proposals = section.getByRole('list', { name: 'Propuestas del supervisor' });
  assert.equal(await proposals.getByRole('listitem').count(), 1, 'only the proposal with real evidence survives validation');
  const proposal = await proposals.innerText();
  assert.match(proposal, /Desbloquear al agente/);
  assert.match(proposal, /Evidencia:/);
  assert.doesNotMatch(proposal, /Cita inventada/);
  assert.equal(await proposals.getByRole('button').count(), 0, 'a proposal executes nothing from the UI');
  // A failing provider keeps the last good summary and shows the error.
  mode = 'error';
  await section.getByRole('button', { name: 'Actualizar resumen' }).click();
  await section.getByRole('alert').getByText(/Proveedor sin respuesta/).waitFor();
  assert.match(await section.innerText(), /Un agente espera credenciales\./);
  // A provider that is not available says so; the feed is still there.
  mode = 'unavailable';
  await section.getByRole('button', { name: 'Actualizar resumen' }).click();
  await section.getByRole('alert').getByText(/no tiene una sesión válida/).waitFor();
  assert.match(await section.locator('.pd-deleg-head').first().innerText(), /No disponible/);
  assert.match(await section.locator('.pd-sup-feed summary').innerText(), /Actividad reciente · 1/);
  // Off again: the switch returns to its initial state and the local feed is kept.
  await toggle.click();
  await section.getByText('Desactivado: solo se conserva la actividad local.').waitFor();
  assert.equal(await toggle.getAttribute('aria-label'), 'Activar supervisor');
  assert.match(await section.locator('.pd-sup-feed summary').innerText(), /Actividad reciente · 1/);
  await close(page);
  results.push('Supervisor: desactivado por defecto, activar, resumen y propuesta validada sin acciones, error de proveedor conserva el último resumen, proveedor no disponible visible y feed local intacto.');
});

test('keyboard reaches an agent, opens its detail, moves focus and Escape returns; no horizontal overflow at 320 and 900 px', async t => {
  const world = createWorld(t); populate(world);
  world.traces.record({ workspaceId: WS, nodeId: 'node-x', id: 'toolu_LONG', parentId: 'toolu_A1', provider: 'claude', name: 'Un subagente con un nombre extraordinariamente largo para comprobar el truncado en una columna estrecha sin desbordar nunca', status: 'running', event: { id: 'long:1', kind: 'message', text: 'Texto '.repeat(80) } });
  const dock = await render(world, { surface: 'dock', width: 320 });
  await dock.getByRole('list', { name: 'Árbol de agentes' }).waitFor();
  await measure(dock, 'dock', 320, 'lista');
  // Tab order reaches the agent rows; Enter opens; focus lands on Volver; Escape closes and restores the row.
  let focused = '';
  for (let step = 0; step < 80 && !/^toolu_/.test(focused); step++) {
    await dock.keyboard.press('Tab');
    focused = await dock.evaluate(() => document.activeElement?.dataset?.agentRow ?? '');
  }
  assert.match(focused, /^toolu_/, 'an agent row is reachable by keyboard');
  await dock.keyboard.press('Enter');
  await detail(dock).waitFor();
  await until(async () => (await dock.evaluate(() => document.activeElement?.textContent ?? '')).includes('Volver'));
  await measure(dock, 'dock', 320, 'detalle');
  await dock.keyboard.press('Escape');
  await dock.locator('section.pd-agent').waitFor({ state: 'detached' });
  await until(async () => (await dock.evaluate(() => document.activeElement?.dataset?.agentRow ?? '')) === focused);
  // The long name never widens the column, in the list or in the detail.
  await dock.locator('[data-agent-row="toolu_LONG"]').click();
  await detail(dock).waitFor();
  await measure(dock, 'dock', 320, 'detalle con nombre largo');
  await close(dock);
  const both = await render(world, { surface: 'both', width: 900 });
  await both.getByRole('list', { name: 'Árbol de agentes' }).waitFor();
  await measure(both, 'canvas + dock', 900, 'lista');
  await both.locator('[data-card="node-x"] [aria-label^="Subagente"][aria-label*="Explorar"] .pc-phantom-open').click();
  await detail(both).waitFor();
  await measure(both, 'canvas + dock', 900, 'detalle');
  await both.screenshot({ path: `${artifacts}/agent-observability-900.png` });
  await close(both);
  results.push('Teclado: Tab llega a una fila de agente, Enter abre, el foco va a «Volver» y Escape lo devuelve a la fila; sin overflow horizontal a 320 y 900 px, incluido un nombre larguísimo.');
});

test('a project with no recorded agents says so and the supervisor starts off with nothing invented', async t => {
  const world = createWorld(t);
  const page = await render(world, { surface: 'dock', width: 480 });
  const agents = page.getByRole('region', { name: 'Agentes' });
  await agents.getByText('Aún no hay agentes registrados en este proyecto.').waitFor();
  assert.equal(await agents.getByRole('list', { name: 'Árbol de agentes' }).count(), 0);
  const supervisor = page.getByRole('region', { name: 'Supervisor' });
  await supervisor.getByText('Desactivado: solo se conserva la actividad local.').waitFor();
  assert.equal(await supervisor.locator('.pd-sup-feed').count(), 0, 'no feed without events');
  assert.equal(await supervisor.getByRole('list', { name: 'Propuestas del supervisor' }).count(), 0, 'no proposals without a summary');
  assert.match(await supervisor.innerText(), /Coste: No disponible/);
  await measure(page, 'dock', 480, 'sin agentes');
  await close(page);
  results.push('Proyecto sin agentes: la lista vacía lo dice, el supervisor aparece desactivado sin feed, propuestas ni coste inventados (fixture: mundo vacío).');
});

test('an agent whose provider reported nothing shows model, context, history and result as unavailable', async t => {
  const world = createWorld(t);
  world.traces.record({ workspaceId: WS, nodeId: 'node-x', id: 'bare', name: 'Sin datos', status: 'running' });
  const page = await render(world, { surface: 'dock', width: 480 });
  const row = page.locator('[data-agent-row="bare"]');
  await row.waitFor();
  assert.match(await row.innerText(), /Modelo: No disponible/);
  await row.click();
  await detail(page).waitFor();
  assert.match(await detail(page).innerText(), /Modelo\s*No disponible/);
  assert.match(await detail(page).innerText(), /Padre\s*Ninguno · agente raíz/);
  const context = await detail(page).getByRole('region', { name: 'Contexto' }).innerText();
  assert.match(context, /Instrucciones[\s\S]*No disponible · No expuesto por el proveedor/);
  assert.match(context, /Encargo[\s\S]*No disponible · No expuesto por el proveedor/);
  assert.match(context, /Tokens medidos[\s\S]*No disponible · Sin medición del proveedor/);
  assert.match(await detail(page).getByRole('region', { name: 'Historial' }).innerText(), /Sin eventos registrados todavía\./);
  assert.match(await detail(page).getByRole('region', { name: 'Resultado' }).innerText(), /Aún sin resultado registrado\./);
  await close(page);
  results.push('Agente sin datos del proveedor: modelo, instrucciones, encargo, tokens, historial y resultado se declaran no disponibles en lugar de heredarse o estimarse (fixture).');
});

test('an active supervisor with a long summary and proposal keeps the narrow dock free of horizontal overflow', async t => {
  const long = Array.from({ length: 40 }, (_, index) => `palabra${index}`).join(' ');
  const world = createWorld(t, { summarize: async () => ({ summary: long, proposals: [{ kind: 'unblock', title: long.slice(0, 110), reason: long.slice(0, 290), evidenceIds: ['ev-wide'] }] }) });
  world.supervisor.ingest({ workspaceId: WS, kind: 'terminal', entityId: 'node-x', status: 'blocked', title: 'Esperando una decisión del operador sobre credenciales', eventId: 'ev-wide' });
  const page = await render(world, { surface: 'dock', width: 320 });
  const section = page.getByRole('region', { name: 'Supervisor' });
  await section.getByRole('switch').click();
  await section.getByText('Aún sin resumen.').waitFor();
  await section.getByRole('button', { name: 'Actualizar resumen' }).click();
  await section.getByRole('list', { name: 'Propuestas del supervisor' }).waitFor();
  assert.ok((await section.innerText()).includes('palabra39'), 'the whole summary is shown');
  await measure(page, 'dock', 320, 'supervisor activo con resumen largo');
  await close(page);
  results.push('Supervisor activo con resumen y propuesta largos a 320 px sin overflow horizontal (resumidor falso).');
});

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!await check()) {
    if (Date.now() > end) throw new Error('Condición no cumplida a tiempo');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
