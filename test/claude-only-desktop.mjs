// Desktop UI check for the Claude-only policy. It uses an isolated Phantom home and a STUB Phantom CLI
// that only serves fixed JSON to the UI. It proves what the UI shows; it does NOT prove any live
// Claude Code / harness execution (no model is ever run here).
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const evidence = '/tmp/phantom-claude-only-evidence';
await fs.mkdir(evidence, { recursive: true });
await fs.mkdir('/tmp/opencode', { recursive: true });
const temp = await fs.mkdtemp('/tmp/opencode/phantom-claude-only-');
const home = path.join(temp, 'WorkspaceHome'), data = path.join(temp, 'PhantomData'), project = path.join(temp, 'project');
const stub = path.join(temp, 'stub-phantom.mjs');
const results = { fixtureOnly: true, liveExecutionProved: false, note: 'CLI stub + isolated state: proves UI rendering only, not a live Claude Code run.', checks: [], screenshots: [] };
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

try {
  for (const dir of [home, data, project]) await fs.mkdir(dir, { recursive: true });
  await exec('git', ['init', '-b', 'main', project], { shell: false, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  await fs.writeFile(path.join(project, 'fixture.txt'), 'Disposable desktop fixture\n');
  const workspacePath = await fs.realpath(project);
  const contract = (goal, extra) => ({ goal, workspace: workspacePath, scope: ['fixture.txt'], checks: [{ name: 'ok', argv: ['node', '-e', '0'] }], ...extra });
  const task = (id, status, goal, extra) => ({ id, kind: 'card', status, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', contract: contract(goal, extra) });
  const tasks = [
    task('task_fixed_haiku', 'ready', 'Contrato fija Haiku', { model: 'claude-code/haiku' }),
    task('task_legacy_judge', 'ready', 'Contrato antiguo con juez OpenAI', { model: 'claude-code/sonnet', judge: { model: 'openai/gpt-5-mini' } }),
    task('task_history_openai', 'completed', 'Historial OpenAI completado', { model: 'openai/gpt-5' }),
  ];
  await fs.writeFile(path.join(temp, 'fixture.json'), JSON.stringify(tasks));
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

  // 1. Default-agent selector offers only Claude Code and an empty terminal.
  await palette('Configuración');
  const group = page.getByRole('radiogroup', { name: 'Agente por defecto', exact: true });
  await group.waitFor();
  const names = await group.getByRole('radio').allInnerTexts();
  assert.deepEqual(names, ['Claude Code', 'Terminal vacía']);
  assert.equal(await page.getByRole('radio', { name: /opencode|codex/i }).count(), 0);
  pass('selector de agente: solo Claude Code y Terminal vacía', names);
  await shot('01-settings-agent-selector');
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();

  // 2. Cards: requested model with provenance, observed unknown, blocked legacy contract, readable history.
  await palette('Trabajo');
  const cards = page.locator('.plugin-cards').first();
  await cards.waitFor();
  const open = async (goal, id) => {
    await cards.getByText(goal, { exact: false }).first().click();
    const sheet = page.locator(`[aria-label="Detalle ${id}"]`);
    await sheet.waitFor();
    return sheet;
  };
  const facts = sheet => sheet.locator('.pc-execution');
  // The whole execution section must be visible (not cut by the viewport) and no error toast may be shown.
  const settle = async sheet => {
    const section = facts(sheet);
    await section.scrollIntoViewIfNeeded();
    await delay(300);
    const box = await section.boundingBox(), view = page.viewportSize();
    assert.ok(box && box.y >= 0 && box.y + box.height <= view.height, `.pc-execution cortada por el viewport: ${JSON.stringify(box)}`);
    assert.equal(await page.locator('.toast.error').count(), 0, `aviso de error: ${await page.locator('.toast.error').allInnerTexts()}`);
    assert.equal(await page.getByText(/Invalid panelId|No se pudo guardar la referencia/).count(), 0);
  };

  let sheet = await open('Contrato fija Haiku', 'task_fixed_haiku');
  await sheet.getByLabel('Modelo para ejecutar', { exact: true }).fill('claude-code/sonnet');
  let text = await facts(sheet).innerText();
  assert.match(text, /claude-code\/haiku/); assert.match(text, /origen: contrato/); assert.doesNotMatch(text, /origen: solicitud/);
  assert.match(text, /Modelo observado\s*Desconocido/); assert.match(text, /Cliente\s*claude/); assert.match(text, /Motor\s*claude-code/);
  await sheet.getByText(/se ignora/).waitFor();
  assert.equal(await sheet.getByRole('button', { name: 'Ejecutar', exact: true }).isDisabled(), false);
  pass('contrato claude-code/haiku + escrito sonnet: solicitado=haiku, origen contrato, observado Desconocido', text);
  await settle(sheet);
  await shot('02-card-contract-model-precedence');

  sheet = await open('Contrato antiguo con juez OpenAI', 'task_legacy_judge');
  await sheet.getByRole('alert').filter({ hasText: /no es Claude Code/ }).waitFor();
  assert.equal(await sheet.getByRole('button', { name: 'Ejecutar', exact: true }).isDisabled(), true);
  pass('contrato antiguo con juez no-Claude: ejecución bloqueada', await sheet.getByRole('alert').innerText());
  await shot('03-card-legacy-contract-blocked');

  sheet = await open('Historial OpenAI completado', 'task_history_openai');
  text = await facts(sheet).innerText();
  assert.match(text, /openai\/gpt-5/); assert.match(text, /Cliente\s*desconocido/); assert.match(text, /Motor\s*desconocido/); assert.match(text, /Modelo observado\s*Desconocido/);
  assert.doesNotMatch(text, /Motor\s*claude-code/);
  await sheet.getByText('Historial OpenAI completado').first().waitFor();
  pass('historial OpenAI legible y sin etiqueta Claude', text);
  await settle(sheet);
  await shot('04-card-history-readable');

  assert.equal(await page.locator('.toast.error').count(), 0, 'sin avisos de error al seleccionar cards');
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
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(`PASS: Claude-only desktop UI (fixture/stub only, no live execution). Evidence: ${evidence}`);
