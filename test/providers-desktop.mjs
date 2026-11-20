// Desktop UI check for providers and engines (docs/provider-engines.md). Isolated Phantom home and a STUB
// Phantom CLI that only serves fixed JSON to the UI. It proves what the UI shows and persists; it does NOT
// prove any live Claude Code / OpenCode execution (no model is ever run here).
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-providers-'));
const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-providers-evidence-'));
const home = path.join(temp, 'WorkspaceHome'), data = path.join(temp, 'PhantomData'), project = path.join(temp, 'project');
const stub = path.join(temp, 'stub-phantom.mjs');
const results = { fixtureOnly: true, liveExecutionProved: false, note: 'CLI stub + isolated state: proves UI rendering and persistence only, not a live engine run.', checks: [], screenshots: [] };
const errors = [];
let app, electronProcess, page, hostPid, failure = null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const pass = (name, detail) => results.checks.push({ name, ok: true, ...(detail ? { detail } : {}) });
const shot = async name => { const file = path.join(evidence, `${name}.png`); await page.screenshot({ path: file }); results.screenshots.push(file); };
async function palette(title) {
  const back = page.locator('.focus-return').getByRole('button', { name: 'Volver al mapa', exact: true });
  if (await back.isVisible()) await back.click();
  const owned = await page.evaluate(() => Boolean(document.activeElement?.closest('.xterm')));
  if (owned) await page.locator('.search-command').click(); else await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Paleta del workspace' });
  await dialog.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill(title);
  await dialog.getByRole('button', { name: new RegExp(`^${title}(\\s|$)`) }).first().click();
  await dialog.waitFor({ state: 'hidden' });
}
async function openSettings() {
  await palette('Configuración');
  if (await page.locator('.st-pane').isHidden()) await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  await page.getByRole('heading', { name: 'Agentes', exact: true }).waitFor();
}
// Nothing inside Configuración may be wider than its own box.
async function assertNoOverflow(label) {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.st, .st-body, .st-pane, .st-group, .st-row')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => `${el.className}:${el.scrollWidth}>${el.clientWidth}`));
  assert.deepEqual(overflow, [], `overflow horizontal (${label})`);
}
const sw = name => page.getByRole('switch', { name, exact: true });

try {
  for (const dir of [home, data, project]) await fs.mkdir(dir, { recursive: true });
  await exec('git', ['init', '-b', 'main', project], { shell: false, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  await fs.writeFile(path.join(project, 'fixture.txt'), 'Disposable desktop fixture\n');
  const workspacePath = await fs.realpath(project);
  const task = (id, goal, model) => ({ id, kind: 'card', status: 'ready', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', contract: { goal, workspace: workspacePath, scope: ['fixture.txt'], checks: [{ name: 'ok', argv: ['node', '-e', '0'] }], model } });
  await fs.writeFile(path.join(temp, 'fixture.json'), JSON.stringify([task('task_open_model', 'Contrato con modelo OpenCode', 'openai/gpt-5')]));
  await fs.writeFile(stub, `import fs from 'node:fs';
const tasks = JSON.parse(fs.readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));
const [command, id] = process.argv.slice(2);
const out = value => console.log(JSON.stringify(value));
if (command === 'list') out(tasks);
else if (command === 'show') { const found = tasks.find(item => item.id === id); if (!found) { console.error('unknown task'); process.exit(1); } out(found); }
else if (command === 'events' || command === 'skill-list' || command === 'memory-list') out([]);
else { console.error('stub: unsupported command ' + command); process.exit(2); }
`);

  const env = { ...process.env, PHANTOM_WORKSPACE_HOME: home, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/bash' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
  app = await electron.launch({ ...(process.env.PHANTOM_TEST_EXECUTABLE ? { executablePath: process.env.PHANTOM_TEST_EXECUTABLE, args: ['--ozone-platform=headless'] } : { args: [root, '--ozone-platform=headless'] }), env, timeout: 15000 });
  electronProcess = app.process();
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.type()}: ${message.text()}`); });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('.app-shell').waitFor();
  hostPid = (await invoke('system.info')).pid;
  const workspace = await invoke('workspace.open', { path: project });
  await invoke('plugins.update', { workspaceId: workspace.id, id: 'phantom', patch: { enabled: true, config: { phantomPath: stub, phantomData: data } } });
  await page.reload();
  await page.locator('.app-shell').waitFor();

  // 1. Default: only Claude Code is enabled and it cannot be disabled.
  await openSettings();
  const pane = page.locator('.st-pane');
  await pane.getByRole('heading', { name: 'Proveedores', exact: true }).waitFor();
  await pane.getByRole('heading', { name: 'Motor por área', exact: true }).waitFor();
  const agent = page.getByRole('radiogroup', { name: 'Agente por defecto', exact: true });
  assert.deepEqual(await agent.getByRole('radio').allInnerTexts(), ['Claude Code', 'Terminal vacía']);
  assert.equal(await sw('Habilitar Claude Code').getAttribute('aria-checked'), 'true');
  assert.equal(await sw('Habilitar Claude Code').isDisabled(), true, 'Claude no se puede deshabilitar si es el único');
  assert.equal(await sw('Habilitar OpenCode').getAttribute('aria-checked'), 'false');
  assert.equal(await page.getByRole('radiogroup', { name: /^Motor de / }).count(), 0, 'sin otro proveedor no hay selector de motor');
  pass('predeterminado: solo Claude Code, interruptor bloqueado, sin selector de motor');

  // Detection is read from the host: either real statuses or a visible error with retry, never invented data.
  const detection = await Promise.race([
    pane.locator('.st-status').filter({ hasText: /Sesión iniciada|Sin sesión|No disponible|Error al detectar/ }).first().waitFor().then(() => 'estados'),
    pane.getByRole('alert').filter({ hasText: 'No se pudieron detectar los proveedores' }).waitFor().then(() => 'error'),
  ]);
  if (detection === 'error') await pane.getByRole('button', { name: 'Reintentar', exact: true }).waitFor();
  results.detection = detection;
  pass(`detección de proveedores: ${detection === 'error' ? 'error visible con reintento' : 'estado real por proveedor'}`);
  await assertNoOverflow('desktop, solo Claude');
  await shot('01-settings-claude-only');
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();

  // 2. A non-Claude contract is blocked with an actionable message while OpenCode is disabled.
  await palette('Trabajo');
  const cards = page.locator('.plugin-cards').first();
  await cards.waitFor();
  const openCard = async () => {
    await cards.getByText('Contrato con modelo OpenCode', { exact: false }).first().click();
    const sheet = page.locator('[aria-label="Detalle task_open_model"]');
    await sheet.waitFor();
    return sheet;
  };
  let sheet = await openCard();
  const alert = await sheet.getByRole('alert').filter({ hasText: /no es Claude Code/ }).innerText();
  assert.match(alert, /OpenCode no está habilitado/); assert.match(alert, /Configuración > Agentes/);
  assert.equal(await sheet.getByRole('button', { name: 'Ejecutar', exact: true }).isDisabled(), true);
  pass('contrato OpenCode con OpenCode deshabilitado: bloqueo accionable', alert);
  await shot('02-card-blocked');
  await sheet.getByRole('button', { name: 'Cerrar detalle' }).click();

  // 3. Enable OpenCode (saves on change) and route Encargos through it.
  await openSettings();
  await sw('Habilitar OpenCode').click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Habilitar OpenCode"]')?.getAttribute('aria-checked') === 'true');
  assert.deepEqual(await agent.getByRole('radio').allInnerTexts(), ['Claude Code', 'OpenCode', 'Terminal vacía']);
  assert.equal(await sw('Habilitar Claude Code').isDisabled(), false);
  const handoff = page.getByRole('radiogroup', { name: 'Motor de Encargos', exact: true });
  await handoff.getByRole('radio', { name: 'OpenCode', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="radiogroup"][aria-label="Motor de Encargos"] [aria-checked="true"]')?.textContent === 'OpenCode');
  let stored = (await invoke('state.get')).settings;
  assert.equal(stored.providers.opencode.enabled, true);
  assert.equal(stored.executionDefaults.handoff.client, 'opencode');
  assert.equal(stored.executionDefaults.task.client, 'claude', 'Tareas conserva Claude Code');
  pass('OpenCode habilitado y motor de Encargos persistido', stored);
  await assertNoOverflow('desktop, OpenCode habilitado');
  await shot('03-settings-opencode-enabled');

  // 4. Keyboard: switch toggles with Space and keeps its focus ring; the default moves back by itself; Escape closes.
  const opencodeSwitch = sw('Habilitar OpenCode');
  await opencodeSwitch.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Habilitar OpenCode', 'Tab vuelve al interruptor');
  assert.equal(await opencodeSwitch.evaluate(el => el.matches(':focus-visible')), true, 'foco visible en el interruptor');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Habilitar OpenCode"]')?.getAttribute('aria-checked') === 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Habilitar OpenCode', 'el foco no se pierde al guardar');
  assert.equal(await page.getByRole('radiogroup', { name: 'Motor de Encargos' }).count(), 0);
  stored = (await invoke('state.get')).settings;
  assert.equal(stored.executionDefaults.handoff.client, 'claude', 'al deshabilitar, el área vuelve a Claude Code');
  pass('teclado: Espacio alterna, el foco persiste y el área vuelve a Claude Code');
  await page.keyboard.press('Escape');
  await page.locator('.st').waitFor({ state: 'hidden' });
  pass('Escape cierra Configuración');

  // 5. Re-enable and check the card now runs through OpenCode with the right engine.
  await openSettings();
  await sw('Habilitar OpenCode').click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Habilitar OpenCode"]')?.getAttribute('aria-checked') === 'true');
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await palette('Trabajo');
  sheet = await openCard();
  const facts = await sheet.locator('.pc-execution').innerText();
  assert.match(facts, /Cliente\s*opencode/); assert.match(facts, /Motor\s*opencode/); assert.match(facts, /openai\/gpt-5/); assert.match(facts, /origen: contrato/);
  assert.equal(await sheet.getByRole('alert').filter({ hasText: /no es Claude Code/ }).count(), 0);
  assert.equal(await sheet.getByRole('button', { name: 'Ejecutar', exact: true }).isDisabled(), false);
  pass('card con OpenCode habilitado: motor opencode, sin bloqueo', facts);
  await shot('04-card-opencode-enabled');
  await sheet.getByRole('button', { name: 'Cerrar detalle' }).click();

  // 6. Narrow viewport: categories first, then the pane, without horizontal overflow.
  await page.setViewportSize({ width: 420, height: 900 });
  await openSettings();
  await page.getByRole('heading', { name: 'Proveedores', exact: true }).waitFor();
  await assertNoOverflow('estrecho');
  await shot('05-settings-narrow');
  pass('ancho estrecho sin overflow horizontal');

  assert.deepEqual((await invoke('phantom.controllers', { workspaceId: workspace.id })).items, [], 'no run was started');
  assert.deepEqual(errors, [], 'unexpected renderer errors');
  pass('sin ejecuciones ni errores de renderer');
} catch (error) {
  failure = error;
  results.error = String(error?.stack || error);
  if (page) { results.body = (await page.locator('body').innerText().catch(() => '')).slice(-4000); await shot('failure').catch(() => {}); }
  results.rendererMessages = errors;
} finally {
  results.ok = !failure;
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  if (hostPid) {
    const command = await fs.readFile(`/proc/${hostPid}/cmdline`, 'utf8').catch(() => '');
    if (command.includes(home)) {
      await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2500)]);
      try { process.kill(hostPid, 'SIGTERM'); } catch {}
    }
  }
  if (app) await Promise.race([app.close().catch(() => {}), delay(2500)]);
  killElectronGroup(electronProcess);
  await fs.rm(temp, { recursive: true, force: true });
}
if (failure) { console.error(failure); console.error(`Evidence: ${evidence}`); process.exitCode = 1; }
else console.log(`PASS: providers and engines desktop UI (fixture/stub only, no live execution). Evidence: ${evidence}`);
