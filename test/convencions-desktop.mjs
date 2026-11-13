import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Real Electron + current renderer sources + isolated host for routes and layout. Only
// future read responses are synthetic IPC fixtures. No agents/models are run.
const root = fileURLToPath(new URL('..', import.meta.url));
await mkdir('/tmp/opencode', { recursive: true });
const evidence = await mkdtemp('/tmp/opencode/convencions-');
const temp = await mkdtemp('/tmp/convencions-desktop-');
const profile = path.join(temp, 'profile');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
let app, appProcess, page, hostPid;
let renderer;
const errors = [], captures = [];
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, name) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await fn()) return; await delay(60); }
  throw new Error(`Timed out: ${name}`);
}
async function shot(name) {
  await delay(200);
  const target = path.join(evidence, `${name}.png`);
  await page.screenshot({ path: target }); captures.push(target);
}
async function overflow(surface) {
  await until(() => surface.evaluate(el => {
    const node = el.closest('.canvas-node'), region = el.closest('.canvas-region');
    if (!node || !region) return false;
    const r = node.getBoundingClientRect(), area = region.getBoundingClientRect();
    return r.left >= area.left && r.right <= Math.min(area.right, innerWidth);
  }), 'focused panel fits the available region');
  const bad = await surface.evaluate(el => [el, ...el.querySelectorAll('*')]
    .filter(child => child.clientWidth && child.getClientRects().length && child.scrollWidth > child.clientWidth)
    .map(child => `${child.tagName}.${child.className}: ${child.scrollWidth} > ${child.clientWidth}`));
  assert.deepEqual(bad, [], 'No horizontal overflow, including long paths and evidence');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
}
async function center() {
  const back = page.locator('.focus-return').getByRole('button', { name: 'Volver al mapa', exact: true });
  if (await back.isVisible()) await back.click();
  await button(page.getByRole('complementary', { name: 'Navegación del espacio', exact: true }), 'Centro de Plugins').click();
  const result = page.locator('.canvas-node.focused .plugin-center');
  await result.waitFor(); return result;
}
const surface = () => page.locator('.canvas-node.focused .convencions');
async function mode(value) { await app.evaluate((_, value) => { globalThis.convencionsFixture.mode = value; }, value); }
async function refresh() {
  const retry = button(surface(), 'Reintentar lectura');
  await until(() => retry.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth;
  }), 'read control fits viewport after focus transition');
  await retry.scrollIntoViewIfNeeded();
  const geometry = await retry.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const scroller = el.closest('.plugin-surface');
    const bounds = scroller.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    return { exposed: rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && el.contains(document.elementFromPoint(x, y)),
      button: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      ancestors: ['.plugin-surface', '.node-body', '.canvas-node', '.canvas-world', '.canvas-stage', '.canvas', '.canvas-region'].map(selector => {
        const ancestor = el.closest(selector), r = ancestor?.getBoundingClientRect();
        return { selector, x: r?.x, y: r?.y, width: r?.width, height: r?.height, scrollTop: ancestor?.scrollTop, scrollLeft: ancestor?.scrollLeft };
      }) };
  });
  assert.equal(geometry.exposed, true, `Read control is inside the panel and hit-testable: ${JSON.stringify(geometry)}`);
  await retry.click();
}

// All conventions here are explicitly SYNTHETIC, exclusively in test code.
function fullSnapshot(workspace) {
  const at = '2026-11-13T12:00:00.000Z';
  const sources = [{ label: 'SYNTHETIC · evidencia controlada', reference: `fixture://convencions/${'long-reference-'.repeat(30)}/evidence`, observedAt: at }];
  const conventions = ['adopted', 'observed', 'proposed', 'excepted'].map((state, index) => ({ id: `synthetic-${state}`, title: `SYNTHETIC · ${['Obligación de ejemplo', 'Patrón observado', 'Propuesta en revisión', 'Excepción documentada'][index]}`, state,
    scope: { kind: ['project', 'path', 'file', 'path'][index], target: index ? `src/${'ruta-larga-'.repeat(25)}/synthetic-only.mjs` : '.' },
    what: 'SYNTHETIC · qué declara la fuente', when: 'SYNTHETIC · al revisar el cambio', why: 'SYNTHETIC · motivo explícito del operador', verification: 'SYNTHETIC · contrastar con evidencia de prueba', sources,
    exception: state === 'excepted' ? { reason: 'SYNTHETIC · compatibilidad temporal', until: null } : null }));
  return { contractVersion: 1, workspaceId: workspace.id, repository: workspace.canonicalPath, state: 'ready', available: true, reason: null, observedAt: at,
    bases: [{ id: 'synthetic-base', name: 'SYNTHETIC · Base madre', versions: ['1.0.0', '2.0.0'].map(version => ({ version, publishedAt: at, description: `SYNTHETIC · versión ${version}, consultar no adopta`, conventions })) }],
    project: { registration: { registeredAt: at, source: 'SYNTHETIC · registro independiente' }, integration: { baseId: 'synthetic-base', version: '1.0.0', profile: 'SYNTHETIC · Perfil de prueba', integratedAt: at, reason: 'SYNTHETIC · integración explícita' }, conventions,
      decisions: [{ id: 'decision-1', title: 'SYNTHETIC · Adaptación documentada', kind: 'adaptation', at, scope: { kind: 'path', target: 'src/' }, reason: 'SYNTHETIC · compatibilidad con una decisión previa', sources }],
      checks: ['not_run', 'passed', 'failed', 'unavailable'].map((status, index) => ({ id: `check-${index}`, title: `SYNTHETIC · Comprobación ${index}`, status, at: ['passed', 'failed'].includes(status) ? at : null, detail: 'SYNTHETIC · resultado del fixture, no comprobación real', sources: ['passed', 'failed'].includes(status) ? sources : [] })) } };
}

try {
  const firstPath = path.join(temp, 'SYNTHETIC-repository-one'), secondPath = path.join(temp, 'SYNTHETIC-repository-two');
  await mkdir(firstPath); await mkdir(secondPath);
  // Resolve the current source on every standalone/repaired run; a previous
  // dist build must not silently turn a CSS repair into a stale-renderer test.
  // The separate declared build check still validates the production bundle.
  renderer = await createServer({ root, configFile: false, base: '/', cacheDir: path.join(evidence, 'vite-cache'),
    server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  await renderer.listen();
  env.PHANTOM_RENDERER_URL = renderer.resolvedUrls.local[0];
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
  appProcess = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1520, height: 980 });
  await page.locator('.app-shell').waitFor(); hostPid = (await invoke('system.info')).pid;
  const a = await invoke('workspace.open', { path: firstPath });
  const b = await invoke('workspace.open', { path: secondPath });
  await invoke('workspace.select', { id: a.id }); await page.reload();
  const registry = await center();
  const card = registry.locator('[data-plugin-id="convencions"]');
  await button(card, 'Activar Convencions').waitFor();
  await card.getByText('Plugin desactivado', { exact: true }).waitFor();
  assert.equal(await button(card, 'Abrir Proyecto · Convencions').isDisabled(), true);
  assert.equal(await card.locator('input,select').count(), 0, 'No fabricated connection settings');
  await button(card, 'Activar Convencions').click();
  await button(card, 'Desactivar Convencions').waitFor();
  await card.getByText('Backend aún no disponible', { exact: true }).waitFor();
  assert.equal((await invoke('plugins.list', { workspaceId: b.id })).items.find(item => item.id === 'convencions').enabled, false);
  await button(card, 'Abrir Proyecto · Convencions').click();
  await surface().getByRole('heading', { name: 'Backend aún no disponible' }).waitFor();
  assert.match(await surface().innerText(), /Falta conectar.*MCP/);
  await refresh(); await surface().getByRole('heading', { name: 'Backend aún no disponible' }).waitFor();
  for (const [width, height] of [[1520, 980], [1100, 760]]) {
    await page.setViewportSize({ width, height }); await delay(300);
    await surface().getByRole('heading', { name: 'Backend aún no disponible' }).scrollIntoViewIfNeeded();
    await overflow(surface()); await shot(`${width}-backend-unavailable`);
  }

  const full = fullSnapshot(a);
  // Existing test seam used by spectral-ui: preserve the real handler for all
  // non-fixture calls. No production test hook or on-disk backend is introduced.
  await app.evaluate(({ ipcMain }, { full, workspaceId }) => {
    const original = ipcMain._invokeHandlers?.get('phantom:invoke');
    if (!original) throw new Error('Electron IPC fixture seam unavailable');
    const f = globalThis.convencionsFixture = { original, full, workspaceId, mode: 'full', reads: 0, release: null };
    ipcMain.removeHandler('phantom:invoke');
    ipcMain.handle('phantom:invoke', (event, method, payload = {}) => {
      if (method === 'plugins.status' && payload.id === 'convencions' && payload.workspaceId === f.workspaceId && f.mode !== 'real') {
        f.reads++;
        if (f.mode === 'error') throw new Error('SYNTHETIC · lectura interrumpida');
        if (f.mode === 'pending') return new Promise(resolve => { f.release = () => resolve(structuredClone(f.full)); });
        const data = structuredClone(f.full);
        if (f.mode === 'invalid') data.workspaceId = 'foreign-project';
        if (f.mode === 'empty') { data.bases = []; data.project = null; }
        if (f.mode === 'registered') { data.project.integration = null; data.project.conventions = []; }
        if (f.mode === 'missing-version') data.bases[0].versions = data.bases[0].versions.slice(0, 1);
        return data;
      }
      if (['chat.send', 'phantom.control', 'terminal.create', 'automation.start', 'playground.run'].includes(method)) throw new Error(`No real execution permitted: ${method}`);
      return original(event, method, payload);
    });
  }, { full, workspaceId: a.id });
  await mode('invalid');
  const capabilityCenter = await center();
  const capabilityCard = capabilityCenter.locator('[data-plugin-id="convencions"]');
  // The restored Center can retain its earlier real-backend read. Focusing it
  // does not request again: explicitly read through the user-facing control
  // after installing the foreign-ownership fixture.
  await button(capabilityCard, 'Consultar capacidad de lectura').click();
  await capabilityCard.getByRole('alert').getByText(/ownership/).waitFor();
  assert.equal(await capabilityCard.locator('.plugin-status').count(), 0, 'The Center also rejects foreign snapshots');
  assert.equal(await capabilityCard.getByText('Resultado observado de lectura', { exact: true }).count(), 0);
  await mode('full');
  await button(capabilityCard.getByRole('alert'), 'Reintentar').click();
  await capabilityCard.getByText('Lectura disponible', { exact: true }).waitFor();
  await button(capabilityCard, 'Abrir Proyecto · Convencions').click();
  await refresh(); await surface().getByText('SYNTHETIC · Perfil de prueba', { exact: true }).waitFor();

  for (const [width, height] of [[1520, 980], [1100, 760]]) {
    await page.setViewportSize({ width, height }); await delay(300);
    const panel = surface();
    await panel.getByRole('heading', { name: 'Registro e integración', exact: true }).scrollIntoViewIfNeeded();
    await overflow(panel); await shot(`${width}-project-integration`);
    await panel.getByLabel('Buscar convenciones', { exact: true }).fill('compatibilidad temporal');
    await until(async () => await panel.locator('.cv-list button').count() === 1, 'search by exception reason');
    await panel.locator('.cv-list button').click();
    await panel.getByRole('heading', { name: 'Excepción y motivo', exact: true }).waitFor();
    await panel.getByLabel('Buscar convenciones', { exact: true }).fill('');
    await panel.getByLabel('Estado', { exact: true }).selectOption('observed');
    await panel.getByLabel('Alcance', { exact: true }).selectOption('path');
    await until(async () => await panel.locator('.cv-list button').count() === 1, 'intersecting filters');
    await panel.locator('.cv-list button').focus(); await page.keyboard.press('Enter');
    const detail = panel.getByRole('article', { name: 'Detalle de convención' });
    await detail.getByText('Patrón con evidencia. No constituye una obligación.', { exact: true }).waitFor();
    for (const name of ['Qué', 'Cuándo', 'Por qué', 'Cómo comprobar', 'Fuentes y evidencia']) await detail.getByRole('heading', { name, exact: true }).waitFor();
    await detail.scrollIntoViewIfNeeded(); await overflow(panel); await shot(`${width}-observed-detail`);
    await panel.getByLabel('Alcance', { exact: true }).selectOption('file');
    await panel.getByText('Ninguna convención coincide con los filtros.', { exact: true }).waitFor();
    await button(panel, 'Limpiar filtros').click();
    await until(async () => await panel.locator('.cv-list button').count() === 4, 'clear filters');
    await panel.getByRole('heading', { name: 'Comprobaciones', exact: true }).scrollIntoViewIfNeeded();
    assert.match(await panel.locator('.cv-checks').innerText(), /Sin ejecutar/);
    assert.match(await panel.locator('.cv-checks').innerText(), /Superada/);
    assert.match(await panel.locator('.cv-checks').innerText(), /Fallida/);
    assert.match(await panel.locator('.cv-checks').innerText(), /No disponible/);
    await overflow(panel); await shot(`${width}-checks-evidence`);
  }

  await button(surface(), 'Ver Base madre / versiones').click();
  await surface().getByLabel('Versión consultada', { exact: true }).selectOption('2.0.0');
  for (const [width, height] of [[1520, 980], [1100, 760]]) {
    await page.setViewportSize({ width, height }); await delay(300);
    await surface().getByLabel('Base madre', { exact: true }).scrollIntoViewIfNeeded();
    await overflow(surface()); await shot(`${width}-base-version-2`);
  }
  await mode('missing-version'); await refresh();
  await surface().getByText(/La base o versión consultada ya no está en esta lectura/).waitFor();
  assert.equal(await surface().getByLabel('Versión consultada', { exact: true }).inputValue(), '2.0.0');
  assert.equal(await surface().locator('.cv-list button').count(), 0, 'A missing version is never silently replaced');
  await mode('full'); await refresh();
  await until(async () => await surface().locator('.cv-list button').count() === 4, 'selected version returns');
  await button(surface(), 'Ver Proyecto / integración').click();
  await surface().getByText('1.0.0', { exact: true }).waitFor();
  assert.equal(await surface().getByText('2.0.0', { exact: true }).count(), 0, 'No silent pin update');

  await mode('error'); await refresh(); await surface().getByRole('alert').waitFor();
  await shot('1100-read-error');
  await mode('full'); await button(surface().getByRole('alert'), 'Reintentar').click();
  await surface().getByText('SYNTHETIC · Perfil de prueba', { exact: true }).waitFor();
  await mode('invalid'); await refresh();
  await surface().getByRole('alert').getByText(/ownership/).waitFor();
  assert.equal(await surface().locator('.cv-list button').count(), 0, 'Foreign snapshot is never rendered');
  await mode('empty'); await button(surface().getByRole('alert'), 'Reintentar').click();
  await surface().getByRole('heading', { name: 'Repositorio sin registrar', exact: true }).waitFor();
  assert.equal(await surface().getByRole('heading', { name: 'Backend aún no disponible' }).count(), 0);
  await shot('1100-empty');
  await mode('registered'); await refresh();
  await surface().getByText('Sin integración. Registrar no implica adoptar convenciones.', { exact: true }).waitFor();
  await mode('full'); await refresh();
  await surface().getByText('SYNTHETIC · Perfil de prueba', { exact: true }).waitFor();

  // Real host preferences and nodes survive reload; fixtures never reach Store.
  const before = (await invoke('state.get')).workspaces.find(w => w.id === a.id);
  assert.equal(before.nodes.filter(n => n.type.startsWith('convencions-')).length, 2);
  assert.ok(before.nodes.filter(n => n.type.startsWith('convencions-')).every(n => Object.keys(n.data).every(key => ['pluginId', 'panelId', 'hidden', 'spaceId'].includes(key))));
  await page.reload(); await page.locator('.app-shell').waitFor();
  const reopened = await center(); const restoredCard = reopened.locator('[data-plugin-id="convencions"]');
  await button(restoredCard, 'Desactivar Convencions').click();
  await button(restoredCard, 'Activar Convencions').waitFor();
  const saved = (await invoke('state.get')).workspaces.find(w => w.id === a.id);
  assert.deepEqual(saved.nodes.filter(n => n.type.startsWith('convencions-')).map(n => n.id), before.nodes.filter(n => n.type.startsWith('convencions-')).map(n => n.id));
  // Opening an existing panel via node focus exercises its disabled gate.
  const projectNode = saved.nodes.find(n => n.type === 'convencions-project');
  const back = page.locator('.focus-return').getByRole('button', { name: 'Volver al mapa', exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: 'Comandos', exact: false }).first().click();
  const palette = page.getByRole('dialog', { name: 'Paleta del workspace' });
  await palette.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill(projectNode.title);
  await palette.getByRole('option').filter({ hasText: projectNode.title }).first().click();
  await page.locator('.canvas-node.focused .plugin-gate').waitFor();
  await shot('1100-disabled');
  await button(page.locator('.canvas-node.focused .plugin-gate'), 'Abrir Centro').click();
  const gateCard = page.locator('.canvas-node.focused [data-plugin-id="convencions"]');
  await button(gateCard, 'Activar Convencions').click();
  await button(gateCard, 'Abrir Proyecto · Convencions').click();
  await surface().getByText('SYNTHETIC · Perfil de prueba', { exact: true }).waitFor();
  assert.equal((await invoke('state.get')).workspaces.find(w => w.id === a.id).nodes.filter(n => n.type.startsWith('convencions-')).length, 2, 'Normal navigation reuses restored nodes');

  await mode('pending'); await refresh();
  await surface().getByText('Cargando Convencions…', { exact: true }).waitFor();
  await shot('1100-loading');
  await until(() => app.evaluate(() => Boolean(globalThis.convencionsFixture.release)), 'pending fixture');
  await invoke('workspace.select', { id: b.id });
  await until(async () => await surface().count() === 0, 'project changed before response');
  await app.evaluate(() => { globalThis.convencionsFixture.release(); globalThis.convencionsFixture.release = null; });
  const otherCenter = await center();
  await button(otherCenter.locator('[data-plugin-id="convencions"]'), 'Activar Convencions').waitFor();
  assert.equal(await page.getByText('SYNTHETIC · Perfil de prueba', { exact: true }).count(), 0, 'Late response cannot leak across projects');
  assert.equal((await invoke('state.get')).workspaces.find(w => w.id === b.id).nodes.some(n => n.type.startsWith('convencions-')), false);
  assert.deepEqual(errors, [], 'No renderer errors');
  console.log(JSON.stringify({ fixture: 'SYNTHETIC read-only snapshots; real isolated Electron/host', captures, evidence }, null, 2));
} finally {
  if (page && hostPid) { try { await invoke('host.shutdown'); } catch {} }
  try { await app?.close(); } catch {}
  if (appProcess && appProcess.exitCode === null) appProcess.kill('SIGTERM');
  if (hostPid) { try { process.kill(hostPid, 'SIGTERM'); } catch {} }
  await renderer?.close();
  await rm(temp, { recursive: true, force: true });
}
