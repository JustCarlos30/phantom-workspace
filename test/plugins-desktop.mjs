import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
await fs.mkdir('/tmp/opencode', { recursive: true });
const temp = await fs.mkdtemp('/tmp/opencode/phantom-plugins-desktop-');
const home = path.join(temp, 'WorkspaceHome');
const data = path.join(temp, 'PhantomData');
const project = path.join(temp, 'project-one');
const second = path.join(temp, 'project-two');
const cli = path.join(os.homedir(), '.local/lib/node_modules/phantom-harness/bin/phantom.mjs');
const errors = [];
let app, electronProcess, page, hostPid;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 12000;
  do { if (await fn()) return; await delay(80); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const workspaceState = async id => (await invoke('state.get')).workspaces.find(w => w.id === id);
async function palette(title) {
  const back = page.locator('.focus-return').getByRole('button', { name: 'Volver al mapa', exact: true });
  if (await back.isVisible()) await back.click();
  // xterm owns editing keys while its textarea has focus (Ctrl+K clears the
  // shell line). Open the workspace palette through its visible launcher in
  // that case, preserving the terminal ownership exercised below.
  const terminalOwnsKeys = await page.evaluate(() => Boolean(document.activeElement?.closest('.xterm')));
  if (terminalOwnsKeys) await page.locator('.search-command').click();
  else await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Paleta del workspace' });
  await dialog.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill(title);
  await dialog.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`) }).click();
  await dialog.waitFor({ state: 'hidden' });
}
async function focusSurface(selector) {
  const node = page.locator('.canvas-node').filter({ has: page.locator(selector) });
  await node.waitFor({ state: 'visible' });
  if (!(await node.evaluate(el => el.classList.contains('focused')))) await node.getByLabel('Enfocar panel', { exact: true }).click();
  await page.locator('.canvas-node.focused').waitFor();
  return node.locator(selector);
}
async function openCenter() {
  await palette('Abrir Centro de Plugins');
  return focusSurface('.plugin-center');
}
async function saveConfig(center, cliPath = cli) {
  await center.getByLabel('CLI Phantom (ruta absoluta)', { exact: true }).fill(cliPath);
  await center.getByLabel('Datos Phantom (fuera del proyecto)', { exact: true }).fill(data);
  await button(center, 'Guardar preferencias').click();
  await until(() => button(center, 'Guardar preferencias').isDisabled(), 'preferences saved');
}
async function connection(center, available) {
  await button(center, 'Probar conexión').click();
  await until(() => center.locator('.plugin-status').innerText().then(text => text.startsWith(available ? 'Conexión disponible' : 'Conexión no disponible')), 'observed native connection');
}
try {
  await fs.access(cli); // A missing real installation is a failure, never a synthetic success.
  for (const dir of [home, data, project, second]) await fs.mkdir(dir, { recursive: true });
  for (const dir of [project, second]) {
    await exec('git', ['init', '-b', 'main', dir], { shell: false, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    await fs.writeFile(path.join(dir, 'fixture.txt'), 'Disposable desktop fixture\n');
    await fs.writeFile(path.join(dir, 'check.mjs'), "import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nassert.match(fs.readFileSync('fixture.txt','utf8'), /Disposable/);\n");
  }
  const env = { ...process.env, PHANTOM_WORKSPACE_HOME: home, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/bash' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PHANTOM_RENDERER_URL;
  app = await electron.launch({ ...(process.env.PHANTOM_TEST_EXECUTABLE ? { executablePath: process.env.PHANTOM_TEST_EXECUTABLE, args: ['--ozone-platform=headless'] } : { args: [root, '--ozone-platform=headless'] }), env, timeout: 15000 });
  // Cache while the Playwright dispatcher is alive: host.shutdown may close it.
  electronProcess = app.process();
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('.app-shell').waitFor();
  hostPid = (await invoke('system.info')).pid;
  const workspace = await invoke('workspace.open', { path: project });
  await page.reload();
  await page.locator('.app-shell').waitFor();
  let center = await openCenter();
  await button(center, 'Activar Phantom').click();
  await button(center, 'Desactivar Phantom').waitFor();
  await saveConfig(center);
  await connection(center, true);
  await page.screenshot({ path: '/tmp/opencode/phantom-plugins-desktop.png' });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.screenshot({ path: '/tmp/opencode/phantom-plugins-narrow.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await palette('Abrir Cards');
  let cards = await focusSurface('.plugin-cards');
  await button(cards, 'Nueva Card').click();
  let form = cards.locator('.plugin-card-form');
  await form.getByLabel('Objetivo', { exact: true }).fill('Desktop fixture original');
  await form.getByLabel('Scope · una ruta por línea', { exact: true }).fill('fixture.txt\ncheck.mjs');
  await form.getByLabel('Nombre del check 1', { exact: true }).fill('fixture-acceptance');
  await form.getByLabel('argv JSON', { exact: true }).fill(JSON.stringify([process.execPath, 'check.mjs']));
  await button(form, 'Guardar Card').click();
  await form.getByText('Guardado en Phantom. No se ha iniciado una ejecución.', { exact: true }).waitFor();
  await button(form, 'Cerrar formulario').click();
  await cards.getByLabel('Buscar por objetivo o ID', { exact: true }).fill('Desktop fixture original');
  await button(cards, 'Desktop fixture original').click();
  await button(cards, 'Preparar reemplazo').waitFor();
  await cards.getByText('Origen de consulta: Phantom · Revisión: desconocida', { exact: true }).waitFor();
  assert.equal(await button(cards, 'Ejecutar').isDisabled(), true, 'no run without an observed explicit/configured model');
  const list = await invoke('phantom.list', { workspaceId: workspace.id, topic: 'tasks' });
  const original = list.items.find(item => (item.raw?.contract?.goal || item.title || item.goal) === 'Desktop fixture original');
  assert.ok(original?.id, 'UI-created card exists in native catalog');
  const before = await invoke('phantom.detail', { workspaceId: workspace.id, topic: 'tasks', id: original.id });
  assert.deepEqual(before.contract.scope, ['fixture.txt', 'check.mjs']);
  assert.deepEqual(before.contract.checks[0].argv, [process.execPath, 'check.mjs']);
  await button(cards, 'Tablero').click();
  await cards.locator('.plugin-board-column').first().waitFor();
  await page.screenshot({ path: '/tmp/opencode/phantom-plugins-cards.png' });
  await button(cards, 'Preparar reemplazo').click();
  form = cards.locator('.plugin-card-form');
  assert.equal(await button(form, 'Crear reemplazo').isDisabled(), true);
  await form.getByLabel('Objetivo', { exact: true }).fill('Desktop fixture replacement');
  await form.getByRole('checkbox').check();
  await button(form, 'Crear reemplazo').click();
  await form.getByText('Guardado en Phantom. No se ha iniciado una ejecución.', { exact: true }).waitFor();
  const after = await invoke('phantom.detail', { workspaceId: workspace.id, topic: 'tasks', id: original.id });
  assert.deepEqual(after.contract, before.contract, 'replacement preserves original contract');
  const replaced = (await invoke('phantom.list', { workspaceId: workspace.id, topic: 'tasks' })).items;
  assert.equal(replaced.length, 2);
  const replacement = replaced.find(item => item.id !== original.id);
  assert.equal((await invoke('phantom.detail', { workspaceId: workspace.id, topic: 'tasks', id: replacement.id })).contract.goal, 'Desktop fixture replacement');

  await palette('Abrir Skills');
  let skills = await focusSurface('.plugin-skills');
  await button(skills, 'Nueva Skill').click();
  form = skills.locator('.plugin-skill-form');
  await form.getByLabel('ID de Skill', { exact: true }).fill('fixture/desktop');
  await form.getByLabel('Descripción', { exact: true }).fill('Desktop fixture skill');
  await form.getByLabel('Acciones · una por línea', { exact: true }).fill('fixture.read');
  await form.getByLabel('Instrucciones (body)', { exact: true }).fill('Read only the disposable fixture. Version one.');
  await button(form, 'Añadir recurso').click();
  await form.getByLabel('Nombre del recurso 1', { exact: true }).fill('example.txt');
  await form.getByLabel('Contenido del recurso 1', { exact: true }).fill('Disposable resource content');
  await button(form, 'Publicar Skill').click();
  await button(skills, 'Preparar nueva versión').waitFor();
  const first = await invoke('phantom.detail', { workspaceId: workspace.id, topic: 'skills', id: 'fixture/desktop' });
  assert.equal(first.ref.version, '1.0.0');
  assert.equal(first.manifest.resources[0].content, 'Disposable resource content');
  assert.match(first.ref.sha256, /^[a-f0-9]{64}$/);
  await skills.getByLabel('Buscar Skills por ID, descripción, scope o versión', { exact: true }).fill('fixture/desktop');
  await skills.locator('.plugin-skill-list .plugin-skill').waitFor();
  await button(skills, 'Preparar nueva versión').click();
  form = skills.locator('.plugin-skill-form');
  await form.getByLabel('Versión semver', { exact: true }).fill('1.0.1');
  await form.getByLabel('Instrucciones (body)', { exact: true }).fill('Read only the disposable fixture. Version two.');
  await button(form, 'Publicar nueva versión').click();
  await until(async () => (await invoke('phantom.detail', { workspaceId: workspace.id, topic: 'skills', id: first.ref.id })).ref.version === '1.0.1', 'native skill publication');
  await skills.getByLabel('Historial de versiones', { exact: true }).selectOption('all');
  await until(async () => await skills.locator('.plugin-skill-list .plugin-skill').count() === 2, 'immutable skill history');
  const preserved = await invoke('phantom.detail', { workspaceId: workspace.id, topic: 'skills', id: first.ref.id, ref: first.ref });
  assert.deepEqual(preserved, first, 'previous skill revision remains exact');
  await button(skills, 'Abrir referencia exacta en otro panel').click();
  await until(async () => (await workspaceState(workspace.id)).nodes.some(n => n.type === 'phantom-skills' && n.data.ref?.version === '1.0.1'), 'exact ref persisted');
  await page.screenshot({ path: '/tmp/opencode/phantom-plugins-skills.png' });

  center = await openCenter();
  const saved = await workspaceState(workspace.id);
  await button(center, 'Desactivar Phantom').click();
  await button(center, 'Activar Phantom').waitFor();
  await page.reload();
  center = await openCenter();
  assert.equal((await workspaceState(workspace.id)).plugins.phantom.enabled, false);
  assert.deepEqual((await workspaceState(workspace.id)).nodes.map(n => [n.id, n.data]), saved.nodes.map(n => [n.id, n.data]));
  await button(center, 'Activar Phantom').click();
  await button(center, 'Desactivar Phantom').waitFor();
  await saveConfig(center, path.join(temp, 'absent-phantom.mjs'));
  await connection(center, false);
  await saveConfig(center);
  await connection(center, true);
  await page.reload();
  center = await openCenter();
  assert.deepEqual((await workspaceState(workspace.id)).plugins.phantom, saved.plugins.phantom);
  const other = await invoke('workspace.open', { path: second });
  await page.reload();
  center = await openCenter();
  await button(center, 'Activar Phantom').waitFor();
  assert.equal((await workspaceState(other.id)).plugins.phantom.config.phantomPath, '');
  await button(center, 'Activar Phantom').click();
  await button(center, 'Desactivar Phantom').waitFor();
  await saveConfig(center);
  await connection(center, true);
  await palette('Abrir Cards');
  cards = await focusSurface('.plugin-cards');
  await cards.getByText('No hay tareas ni Cards nativas para este proyecto.', { exact: true }).waitFor();
  assert.deepEqual((await invoke('phantom.list', { workspaceId: other.id, topic: 'tasks' })).items, []);
  assert.deepEqual((await invoke('phantom.list', { workspaceId: other.id, topic: 'skills', allVersions: true })).items, []);
  assert.deepEqual((await workspaceState(workspace.id)).plugins.phantom, saved.plugins.phantom);

  await palette('Crear terminal');
  const terminal = await focusSurface('.terminal-host');
  await terminal.locator('.xterm-screen').click();
  await until(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')), 'terminal owns keyboard');
  await page.keyboard.type("printf 'PLUGIN_BEFORE_%s\\n' tool");
  await page.keyboard.press('Enter');
  await until(async () => (await terminal.innerText()).includes('PLUGIN_BEFORE_tool'), 'terminal input before tool');
  const sessions = await invoke('terminal.list', { workspaceId: other.id });
  await openCenter();
  await palette('Terminal');
  const restoredTerminal = await focusSurface('.terminal-host');
  await restoredTerminal.locator('.xterm-screen').click();
  await until(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')), 'terminal restores keyboard ownership');
  await page.keyboard.type("printf 'PLUGIN_AFTER_%s\\n' tool");
  await page.keyboard.press('Enter');
  await until(async () => (await restoredTerminal.innerText()).includes('PLUGIN_AFTER_tool'), 'terminal input after tool');
  assert.deepEqual((await invoke('terminal.list', { workspaceId: other.id })).map(s => s.id), sessions.map(s => s.id), 'tool navigation preserves PTY');
  assert.deepEqual((await invoke('phantom.controllers', { workspaceId: workspace.id })).items, [], 'no model/controller run');
  assert.deepEqual(errors, [], 'unexpected renderer console/errors');
  console.log('PASS: native plugin UI, immutable Cards/Skills, persistence, isolation, recovery and terminal ownership');
} catch (error) {
  console.error('Unexpected renderer messages:', JSON.stringify(errors));
  if (page) console.error((await page.locator('body').innerText().catch(() => '')).slice(-12000));
  throw error;
} finally {
  // This data home is unique; never stop a host merely because its PID is known.
  if (hostPid) {
    const command = await fs.readFile(`/proc/${hostPid}/cmdline`, 'utf8').catch(() => '');
    if (command.includes(home)) {
      await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2500)]);
      try { process.kill(hostPid, 'SIGTERM'); } catch {}
    }
  }
  if (app) await Promise.race([app.close().catch(() => {}), delay(2500)]);
  if (electronProcess?.exitCode === null && electronProcess.signalCode === null) electronProcess.kill('SIGKILL');
  await fs.rm(temp, { recursive: true, force: true });
}
