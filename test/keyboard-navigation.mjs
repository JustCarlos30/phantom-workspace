import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = path.resolve(process.env.PHANTOM_KEYBOARD_EVIDENCE || '/tmp/phantom-keyboard-e2e');
assert.equal(evidenceRoot, '/tmp/phantom-keyboard-e2e', 'La evidencia debe quedar en la ruta autorizada');
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(path.join(evidenceRoot, 'run-'));
const fixture = await mkdtemp('/tmp/phantom-keyboard-fixture-');
const profile = path.join(fixture, 'profile');
const executablePath = path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(root, 'node_modules/electron/dist'), 'electron');
const result = { startedAt: new Date().toISOString(), evidence, checks: [], keys: [], console: [], errors: [], screenshots: [], cleanup: [] };
let app, page, hostPid;
const sessions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (method, payload = {}) => page.evaluate(([method, payload]) => window.phantom.invoke(method, payload), [method, payload]);
const state = () => invoke('state.get');
const activeWorkspace = async () => { const value = await state(); return value.workspaces.find(w => w.id === value.activeWorkspaceId); };
const selected = () => page.locator('.canvas-node.selected');
const focused = () => page.locator('.canvas-node.focused');
const dialog = () => page.getByRole('dialog').filter({ visible: true });
async function poll(fn, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(60); }
  throw new Error(`Tiempo agotado: ${label}`);
}
async function press(key) {
  result.keys.push({ key, at: Date.now(), focus: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 600)) });
  await page.keyboard.press(key);
}
async function type(text) { result.keys.push({ text, at: Date.now() }); await page.keyboard.type(text); }
async function capture(name) {
  const file = path.join(evidence, `${name}.png`);
  await page.screenshot({ path: file }); result.screenshots.push(file);
}
async function save() { await writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`); }
async function check(name, fn) {
  const start = Date.now();
  try { const details = await fn(); result.checks.push({ name, status: 'passed', durationMs: Date.now() - start, details }); console.log(`PASS ${name}`); }
  catch (error) { result.checks.push({ name, status: 'failed', durationMs: Date.now() - start, error: error.stack }); throw error; }
  finally { await save(); }
}
async function canvasOwnsFocus() {
  await page.waitForFunction(() => document.activeElement === document.querySelector('.canvas') && document.querySelector('.app-shell')?.dataset.keyboardMode === 'navigation');
}
async function selectedId(id) { await poll(async () => await selected().getAttribute('data-node-id') === id, `selección ${id}`); await canvasOwnsFocus(); }
async function tabTo(locator, label, max = 90) {
  for (let i = 0; i < max; i++) {
    if (await locator.evaluateAll(elements => elements.some(element => element === document.activeElement))) return;
    await press('Tab');
  }
  throw new Error(`Tab no alcanzó ${label}`);
}
async function chooseProject(name, id) {
  await press('Control+Shift+p');
  await dialog().waitFor();
  const search = dialog().locator('input').first();
  await tabTo(search, 'buscador de proyectos');
  await type(name);
  await poll(async () => await dialog().getByRole('option').count() === 1, `proyecto filtrado ${name}`);
  await press('Enter');
  await poll(async () => (await activeWorkspace())?.id === id, `proyecto ${name}`);
  await dialog().waitFor({ state: 'hidden' });
  await poll(async () => (await page.locator('.project-name-editor > button').first().textContent())?.includes(name), `título visible ${name}`);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function choosePanel(title, id) {
  await press('Control+Shift+f');
  const input = page.getByLabel('Buscar panel por nombre, tipo o misión');
  await poll(() => input.evaluate(element => element === document.activeElement), 'foco del índice de paneles');
  await type(title);
  const button = page.locator('.panel-index-items button').filter({ has: page.locator('strong', { hasText: title }) });
  await button.waitFor();
  await tabTo(button, `panel ${title}`);
  await press('Enter'); await selectedId(id);
}
async function terminalOwnsFocus(id) {
  await poll(async () => await focused().getAttribute('data-node-id') === id, `enfoque ${id}`);
  await page.waitForFunction(() => !!document.activeElement?.closest('.xterm') && document.querySelector('.app-shell')?.dataset.keyboardMode === 'interaction');
  await focused().locator('.pt-session .status-dot.running').waitFor();
  await poll(async () => (await invoke('terminal.attach', { sessionId: sessions.find(s => s.nodeId === id).id })).session.status === 'running', 'PTY listo');
}
async function stableTerminal(sessionId) {
  let previous, since;
  return poll(async () => {
    const snapshot = await invoke('terminal.attach', { sessionId });
    const signature = JSON.stringify([snapshot.seq, snapshot.session.cols, snapshot.session.rows, snapshot.data]);
    if (signature !== previous) { previous = signature; since = Date.now(); }
    return Date.now() - since >= 350 ? snapshot : false;
  }, 'salida PTY estable');
}
async function assertFramed(id) {
  await poll(() => page.locator(`[data-node-id="${id}"]`).evaluate(element => {
    const panel = element.getBoundingClientRect();
    const stage = document.querySelector('.canvas-stage').getBoundingClientRect();
    const rail = document.querySelector('.project-rail').getBoundingClientRect();
    return panel.left >= Math.max(stage.left, rail.right) - 2 && panel.top >= stage.top + 70 && panel.right <= stage.right + 2 && panel.bottom <= stage.bottom - 14;
  }), 'panel dentro de cámara segura');
}
async function shortcuts() {
  await press('Control+,'); await dialog().waitFor();
}
async function shortcutControl(title, binding) {
  const button = { name: `Editar atajo: ${title}`, exact: true };
  const row = dialog().locator('.tw-shortcut-row').filter({ has: page.getByRole('button', button) });
  const control = row.getByRole('button', button);
  await control.waitFor();
  await poll(async () => await row.locator('kbd').innerText() === binding, `atajo visible de ${title}`);
  return control;
}
async function storedBindings() { return page.evaluate(() => JSON.parse(localStorage.getItem('phantom:workspace:shortcuts') || '{}')); }
async function bounded(operation, label, timeout) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout ${label}`)), timeout); })]); }
  finally { clearTimeout(timer); }
}
function cleanupError(error) { result.errors.push(`Cleanup: ${error.stack || error.message}`); process.exitCode = 1; }
async function processArgs(pid) {
  try { return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

const watchdog = setTimeout(() => {
  process.exitCode = 1;
  result.errors.push('Límite de 180 segundos agotado');
  result.checks.push({ name: 'Límite de tiempo', status: 'failed' });
  finish().finally(() => process.exit(1));
}, 180000);
const interrupted = signal => {
  process.exitCode = 1; result.errors.push(`Interrumpido por ${signal}`);
  finish().finally(() => process.exit(1));
};
process.once('SIGTERM', () => interrupted('SIGTERM'));
process.once('SIGINT', () => interrupted('SIGINT'));
let finishing;
function finish() { return finishing ||= (async () => {
  clearTimeout(watchdog);
  if (app) {
    for (const session of sessions) {
      try {
        await bounded(invoke('terminal.stop', { sessionId: session.id }), `terminal.stop ${session.id}`, 1500);
        await poll(async () => (await bounded(invoke('terminal.attach', { sessionId: session.id }), 'estado PTY', 1500)).session.status === 'exited', 'cierre PTY', 3500);
        result.cleanup.push(`terminal.stop ${session.id}`);
      } catch (error) { cleanupError(error); }
    }
    try {
      await bounded(invoke('desktop.quit', { stopHost: true }), 'desktop.quit', 1800);
      await poll(() => page.isClosed(), 'cierre de ventana', 10000);
      result.cleanup.push('desktop.quit');
    } catch (error) { cleanupError(error); }
    try {
      const child = app.process();
      killElectronGroup(child);
      await poll(() => {
        try { process.kill(-child.pid, 0); return false; }
        catch (error) { if (error.code === 'ESRCH') return true; throw error; }
      }, 'cierre del grupo Electron', 5000);
      result.cleanup.push(`Grupo Electron ${child.pid} cerrado`);
    } catch (error) { cleanupError(error); }
  }
  if (hostPid) {
    try {
      const args = await processArgs(hostPid);
      if (args.length) {
        assert.ok(args.includes(profile) && args.some(arg => arg.endsWith('/host/server.mjs')), 'Solo se limpia el host del fixture');
        process.kill(hostPid, 'SIGTERM'); result.cleanup.push(`SIGTERM host ${hostPid}`);
        await poll(async () => !(await processArgs(hostPid)).includes(profile), 'cierre del host sintético', 7000);
      }
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) {
        cleanupError(error);
        try {
          const args = await processArgs(hostPid);
          if (args.includes(profile) && args.some(arg => arg.endsWith('/host/server.mjs'))) {
            process.kill(hostPid, 'SIGKILL'); result.cleanup.push(`SIGKILL host ${hostPid}`);
            await poll(async () => !(await processArgs(hostPid)).includes(profile), 'host terminado', 3000);
          }
        } catch (error) { if (error.code !== 'ESRCH') cleanupError(error); }
      }
    }
  }
  for (const session of sessions) {
    try {
      const args = await processArgs(session.pid);
      if (!args.length) continue;
      const cwd = await readlink(`/proc/${session.pid}/cwd`);
      assert.ok(cwd.startsWith(`${fixture}/`) && args[0] === '/bin/sh', 'Solo se limpia el shell sintético');
      cleanupError(new Error(`El shell ${session.pid} sobrevivió al cierre del host`));
      process.kill(session.pid, 'SIGKILL'); result.cleanup.push(`SIGKILL shell ${session.pid}`);
      await poll(async () => !(await processArgs(session.pid)).length, 'shell terminado', 3000);
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) cleanupError(error); }
  }
  try { await rm(fixture, { recursive: true, force: true }); result.cleanup.push('Fixture eliminado'); }
  catch (error) { cleanupError(error); }
  result.finishedAt = new Date().toISOString();
  result.summary = { passed: result.checks.filter(check => check.status === 'passed').length, failed: result.checks.filter(check => check.status === 'failed').length, errors: result.errors.length };
  if (result.summary.failed || result.summary.errors) process.exitCode = 1;
  await save(); console.log(JSON.stringify({ ...result.summary, evidence }));
})(); }

try {
  await save();
  await access(executablePath, constants.X_OK); await access(path.join(root, 'dist/index.html'));
  const home = path.join(fixture, 'home'); await mkdir(home);
  const env = { PATH: process.env.PATH, DISPLAY: process.env.DISPLAY, XAUTHORITY: process.env.XAUTHORITY,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS, LANG: 'C.UTF-8', HOME: home, SHELL: '/bin/sh',
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
    PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath };
  app = await electron.launch({ executablePath, args: [root], cwd: root, chromiumSandbox: false, env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)), timeout: 20000 });
  page = await app.firstWindow(); page.setDefaultTimeout(10000);
  page.on('console', message => result.console.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => result.errors.push(error.stack || error.message));
  app.process().stderr?.on('data', data => { result.console.push({ type: 'electron-stderr', text: String(data) }); });
  await page.locator('.app-shell').waitFor();
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1520, 980); });
  const info = await invoke('system.info'); assert.equal(info.dataDir, profile); hostPid = info.pid;
  assert.equal((await state()).workspaces.length, 0);
  const firstPath = path.join(fixture, 'SYNTHETIC-Keyboard-A'), secondPath = path.join(fixture, 'SYNTHETIC-Keyboard-B');
  await mkdir(firstPath); await mkdir(secondPath);
  await writeFile(path.join(firstPath, 'README.md'), '# Fixture sintética de teclado\n');
  await invoke('settings.update', { patch: { shell: '/bin/sh' } });
  const first = await invoke('workspace.open', { path: firstPath });
  const make = (type, title, x, y, data = {}) => invoke('node.create', { workspaceId: first.id, type, title, x, y, width: 600, height: 400, data });
  const left = await make('terminal', 'SYNTHETIC Terminal izquierda', 0, 0);
  const right = await make('terminal', 'SYNTHETIC Terminal derecha', 800, 0);
  const note = await make('note', 'SYNTHETIC Nota inferior', 800, 700, { text: 'Contexto sintético' });
  await make('note', 'SYNTHETIC Nota oculta', 650, 0, { hidden: true });
  await make('zone', 'SYNTHETIC Zona', 0, 0);
  const otherSpace = '3f2b8c1e-5a47-4d9e-8b6a-1c2d3e4f5a6b';
  await invoke('workspace.update', { id: first.id, patch: { spaces: [{ id: otherSpace, name: 'Otro espacio', camera: { x: 0, y: 0, zoom: 1 } }] } });
  await make('terminal', 'SYNTHETIC Sesión en otro espacio', 650, 0, { spaceId: otherSpace });
  for (const node of [left, right]) {
    const { session } = await invoke('terminal.create', { workspaceId: first.id, nodeId: node.id, shell: '/bin/sh', cols: 80, rows: 24 });
    assert.ok(session.pid > 0); sessions.push({ ...session, nodeId: node.id });
    const tty = await readlink(`/proc/${session.pid}/fd/0`);
    assert.match(tty, /^\/dev\/pts\/\d+$/, 'El shell usa un PTY del sistema');
    sessions.at(-1).tty = tty;
  }
  const second = await invoke('workspace.open', { path: secondPath });
  await page.reload(); await page.locator('.app-shell').waitFor(); await page.bringToFront(); await canvasOwnsFocus();
  result.fixture = { first: first.id, second: second.id, left: left.id, right: right.id, note: note.id, sessions: sessions.map(({ id, pid, tty }) => ({ id, pid, tty })) };
  await capture('00-setup');

  await check('proyecto → elegir panel → vecino → PTY real → salir → vecino, sin clicks', async () => {
    await chooseProject('SYNTHETIC-Keyboard-A', first.id);
    await choosePanel(left.title, left.id); await assertFramed(left.id);
    await press('ArrowRight'); await selectedId(right.id); await assertFramed(right.id);
    assert.equal(await focused().count(), 0); assert.equal(await page.locator('.xterm').count(), 0);
    await capture('01-vecino-seleccionado');
    await press('Enter'); await terminalOwnsFocus(right.id);
    const marker = `PHANTOM_KEYBOARD_${Date.now()}_OK`;
    await type(`printf '%s%s\\n' '${marker.slice(0, 12)}' '${marker.slice(12)}'`); await press('Enter');
    const session = sessions.find(session => session.nodeId === right.id);
    await poll(async () => (await invoke('terminal.attach', { sessionId: session.id })).data.includes(marker), 'marcador ejecutado por PTY');
    await poll(async () => (await focused().locator('.xterm-rows').innerText()).includes(marker), 'marcador visible en xterm');
    await capture('02-marcador-pty');
    const before = await stableTerminal(session.id);
    await press('Control+Shift+Escape'); await selectedId(right.id);
    await press('ArrowLeft'); await selectedId(left.id); await assertFramed(left.id);
    const after = await stableTerminal(session.id);
    assert.equal(after.data, before.data, 'Salir/navegar no envía teclas al PTY');
    assert.equal(after.session.pid, session.pid);
    await capture('03-salida-y-vecino'); return { marker, sessionId: session.id, pid: session.pid, tty: session.tty };
  });
  await check('fit-all conserva último trabajo; return-focus vuelve a xterm; sesiones ciclan sin entrar', async () => {
    await press('0'); await canvasOwnsFocus();
    await poll(() => page.locator('.zoom-value').innerText().then(text => parseInt(text, 10) < 80), 'encuadre de todos');
    await capture('04-fit-all');
    await press('Control+Shift+Enter'); await terminalOwnsFocus(right.id);
    await press('Control+PageDown'); await selectedId(left.id);
    await press('Control+PageUp'); await selectedId(right.id);
    assert.equal(await focused().count(), 0);
    await press('ArrowDown'); await selectedId(note.id);
    await press('Enter');
    await page.waitForFunction(() => document.activeElement?.classList.contains('note-editor'));
    const before = await page.locator('.note-editor:visible').inputValue();
    await press('ArrowLeft'); await type(' texto normal');
    assert.notEqual(await page.locator('.note-editor:visible').inputValue(), before);
    assert.equal(await focused().getAttribute('data-node-id'), note.id);
    await press('Control+Shift+Escape'); await selectedId(note.id);
  });
  await check('cancelar selector conserva proyecto, selección y foco; memoria por proyecto', async () => {
    const id = (await activeWorkspace()).id;
    await press('Control+Shift+p'); await dialog().waitFor();
    await tabTo(dialog().locator('input').first(), 'buscador para cancelar');
    await type('sin coincidencias sintéticas'); await press('Escape');
    await dialog().waitFor({ state: 'hidden' }); await selectedId(note.id);
    assert.equal((await activeWorkspace()).id, id);
    await chooseProject('SYNTHETIC-Keyboard-B', second.id); await canvasOwnsFocus();
    assert.equal(await selected().count(), 0);
    await chooseProject('SYNTHETIC-Keyboard-A', first.id); await selectedId(note.id);
    await press('Control+Shift+Enter');
    await poll(async () => await focused().getAttribute('data-node-id') === note.id, 'último enfoque del proyecto');
    await chooseProject('SYNTHETIC-Keyboard-B', second.id); await canvasOwnsFocus();
    await chooseProject('SYNTHETIC-Keyboard-A', first.id);
    await poll(async () => await focused().getAttribute('data-node-id') === note.id, 'enfoque restaurado por proyecto');
    await page.waitForFunction(() => document.activeElement?.classList.contains('note-editor'));
    await press('Control+Shift+Escape'); await selectedId(note.id);
    await capture('05-memoria-proyecto');
  });
  await check('configuración desde UI, persistencia tras recarga y binding global por proyecto', async () => {
    await shortcuts();
    const control = await shortcutControl('Siguiente sesión', 'Ctrl+PageDown');
    await tabTo(control, 'atajo Siguiente sesión');
    await press('Enter');
    const input = dialog().getByLabel('Atajo para Siguiente sesión', { exact: true });
    await poll(() => input.evaluate(element => element === document.activeElement), 'editor del atajo');
    await press('Control+a'); await type('Ctrl+Alt+Y'); await press('Enter');
    await poll(async () => (await storedBindings())['next-session'] === 'Ctrl+Alt+Y', 'nuevo atajo persistido desde UI');
    await capture('06-atajos-configurados');
    await press('Escape'); await dialog().waitFor({ state: 'hidden' });
    await chooseProject('SYNTHETIC-Keyboard-B', second.id);
    assert.equal((await storedBindings())['next-session'], 'Ctrl+Alt+Y');
    await page.reload(); await page.locator('.app-shell').waitFor(); await canvasOwnsFocus();
    await chooseProject('SYNTHETIC-Keyboard-A', first.id); await choosePanel(left.title, left.id);
    await press('Control+PageDown'); await selectedId(left.id);
    await press('Control+Alt+y'); await selectedId(right.id);
    await shortcuts();
    await shortcutControl('Siguiente sesión', 'Ctrl+Alt+Y');
    await press('Escape'); await dialog().waitFor({ state: 'hidden' }); await canvasOwnsFocus();
  });
  await check('paleta abre el selector y las acciones nuevas de teclado', async () => {
    await press('Control+k');
    const input = page.getByRole('combobox', { name: 'Buscar paneles y herramientas' });
    await poll(() => input.evaluate(element => element === document.activeElement), 'foco de paleta');
    await type('Cambiar proyecto'); await press('Enter');
    await page.getByRole('dialog', { name: 'Cambiar proyecto', exact: true }).waitFor();
    await page.getByRole('dialog', { name: 'Paleta del workspace' }).waitFor({ state: 'hidden' });
    await press('Escape'); await dialog().waitFor({ state: 'hidden' }); await canvasOwnsFocus();
    await capture('07-final');
  });
  assert.deepEqual(result.errors, [], 'Sin errores de renderer');
} catch (error) {
  process.exitCode = 1; result.errors.push(error.stack || error.message); console.error(error);
  if (page && !page.isClosed()) {
    result.failureFocus = await page.evaluate(() => ({ active: document.activeElement?.outerHTML, mode: document.querySelector('.app-shell')?.dataset.keyboardMode })).catch(() => null);
    await capture('failure').catch(() => {});
  }
} finally { await finish(); }
