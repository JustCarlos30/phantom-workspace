import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from '../host/server.mjs';

// Shipping renderer/IPC and real PTYs; only external catalogs are synthetic.
// No shell commands, models, personal profiles, or repository evidence writes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.mkdir('/tmp/opencode', { recursive: true });
const temp = await fs.mkdtemp('/tmp/opencode/conversation-windows-');
const profile = path.join(temp, 'profile'), project = path.join(temp, 'project');
const control = path.join(temp, 'output.json'), received = path.join(temp, 'input.jsonl');
const fixture = path.join(temp, 'pty-fixture.mjs');
let app, appProcess, host, page, sequence = 0, failCatalog = false;
const errors = [], checks = [], writes = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, label, timeout = 8000) {
  const until = Date.now() + timeout;
  do { const value = await fn(); if (value) return value; await pause(50); } while (Date.now() < until);
  throw new Error(`Timeout: ${label}`);
}
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function emit(text) {
  // Atomic control file keeps output independent of terminal input ownership.
  await fs.writeFile(`${control}.next`, JSON.stringify({ seq: ++sequence, text }));
  await fs.rename(`${control}.next`, control);
  const sentinel = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim().split(/\r?\n/).at(-1);
  await poll(async () => (await host.invoke('terminal.attach', { sessionId })).data.includes(sentinel), 'PTY fixture output');
  await pause(180);
}
let workspaceId, nodeId, sessionId;
const workspace = async () => (await host.invoke('state.get')).workspaces.find(w => w.id === workspaceId);
const node = async () => (await workspace()).nodes.find(n => n.id === nodeId);
const panel = () => page.locator('.canvas-node');
const history = () => page.getByRole('button', { name: 'Ir al final', exact: true });
const visibleRows = async () => (await panel().locator('.xterm-rows > div').allTextContents()).map(text => text.trimEnd());
const firstRow = async () => (await visibleRows())[0];
const inputBytes = async () => fs.readFile(received, 'utf8');
async function viewport(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(800, 600); window.setContentSize(w, h);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
}
async function wheel(deltaY) {
  const rect = await panel().locator('.xterm-screen').boundingBox();
  assert(rect?.height > 0, 'real xterm screen is visible');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, deltaY);
}
async function saved() { await poll(async () => await page.locator('.save-state').textContent() === 'Guardado', 'presentation saved'); }
async function settledNavigation() {
  // "Guardado" can still describe the previous camera while navigation is
  // animating (180ms), awaiting camera commit (180ms), or queued save (350ms).
  // Observe both the real transform and durable camera beyond those debounces
  // before taking a baseline. Keep subsequent camera assertions exact.
  let last, since;
  await poll(async () => {
    const transform = await page.locator('.canvas-world').evaluate(el => el.style.transform);
    const camera = (await workspace()).camera;
    const key = JSON.stringify({ transform, camera });
    if (key !== last) { last = key; since = Date.now(); }
    return Date.now() - since >= 700;
  }, 'camera animation and durable navigation settled');
  await saved();
}
async function zoomOverview(target = .34) {
  while ((await workspace()).camera.zoom > target) {
    await page.getByRole('button', { name: 'Alejar', exact: true }).click();
    await settledNavigation();
  }
  await page.locator('.terminal-overview').waitFor(); await settledNavigation();
}
async function readableSummary(compact = false) {
  const summary = page.getByRole('region', { name: /^Resumen de / });
  assert.equal(await summary.getAttribute('data-tier'), compact ? 'compact' : 'summary');
  const metrics = await summary.evaluate(el => {
    const zoom = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform).a;
    const bounds = el.getBoundingClientRect();
    return { zoom, fields: [...el.querySelectorAll('strong,.terminal-overview-state,dl > div')].map(field => {
      const rect = field.getBoundingClientRect();
      return { text: field.textContent, font: parseFloat(getComputedStyle(field).fontSize) * zoom,
        contained: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1,
        unclipped: field.scrollHeight <= field.clientHeight + 1 && field.scrollWidth <= field.clientWidth + 1 };
    }) };
  });
  assert(Math.abs(metrics.zoom - (compact ? .2 : .34)) < .015, `real overview zoom: ${metrics.zoom}`);
  assert.equal(metrics.fields.length, compact ? 3 : 5);
  for (const field of metrics.fields) {
    assert(field.text.trim(), 'primary context is real visible text');
    assert(field.font >= 9.9 && field.font <= 12.1, `effective screen font ${field.font}: ${field.text}`);
    assert(field.contained && field.unclipped, `primary context not clipped: ${field.text}`);
  }
  const terminalPanel = panel().locator('.terminal-panel');
  assert.equal(await terminalPanel.getByRole('button').count(), 0, 'hidden terminal/editor actions are absent from accessibility');
  assert.equal(await terminalPanel.getByRole('textbox').count(), 0, 'hidden xterm/editor inputs are absent from accessibility');
  const focusable = await terminalPanel.evaluate(el => [...el.querySelectorAll('button,input,textarea,select,a[href],[tabindex],[contenteditable="true"]')].filter(control => {
    control.focus(); return document.activeElement === control;
  }).map(control => control.outerHTML));
  assert.deepEqual(focusable, [], 'underlying terminal/editor controls cannot receive keyboard focus');
  assert.equal(await summary.locator('button,input,textarea,select,a,[tabindex]').count(), 0);
  return summary;
}
async function zoomNormal() {
  await page.locator('.canvas').focus(); await page.keyboard.press('1');
  await page.locator('.terminal-overview').waitFor({ state: 'hidden' }); await settledNavigation();
}

try {
  await fs.mkdir(project); await fs.writeFile(received, '');
  await fs.writeFile(fixture, `#!${process.execPath}
import fs from 'node:fs';
process.stdin.setRawMode(true); process.stdin.resume();
process.stdin.on('data', data => fs.appendFileSync(${JSON.stringify(received)}, JSON.stringify([...data]) + '\\n'));
let seq = 0;
setInterval(() => {
  try { const value = JSON.parse(fs.readFileSync(${JSON.stringify(control)}, 'utf8')); if (value.seq !== seq) { seq = value.seq; process.stdout.write(value.text); } } catch {}
}, 25);
process.stdout.write('PTY_FIXTURE_READY\\r\\n');
`, { mode: 0o700 });
  host = await createHost({ dataDir: profile, handleIntegration: async (method, payload) => {
    if (method === 'phantom.detail') {
      if (failCatalog) throw new Error('Fallo sintético de guardado');
      return { handled: true, result: { id: payload.id, kind: 'card', contract: { goal: 'Card sintética de conversación', workspace: project } } };
    }
    if (method === 'phantom.list') return { handled: true, result: { available: true, items: [{ id: 'card_fixture', kind: 'card', title: 'Card sintética de conversación' }, { id: 'card_error', kind: 'card', title: 'Card para error sintético' }] } };
    if (method === 'opencode.sessions') return { handled: true, result: { available: true, items: [{ id: 'ses_fixture', title: 'OpenCode sintético', directory: project }] } };
    return { handled: true, result: { available: false, items: [], reason: 'Fixture aislada: integración no utilizada' } };
  } });
  const originalWrite = host.terminals.write.bind(host.terminals);
  host.terminals.write = (id, text) => { writes.push({ id, text }); return originalWrite(id, text); };
  workspaceId = (await host.invoke('workspace.open', { path: project })).id;
  const mission = await host.invoke('mission.create', { workspaceId, title: 'Misión sintética de lectura' });
  nodeId = (await host.invoke('node.create', { workspaceId, type: 'terminal', title: 'Agente de conversación', x: 20, y: 60, width: 400, height: 540 })).id;
  await host.invoke('node.update', { workspaceId, id: nodeId, patch: { groupId: mission.id } });
  sessionId = (await host.invoke('terminal.create', { workspaceId, nodeId, shell: fixture })).session.id;
  await host.invoke('terminal.agent.update', { workspaceId, nodeId, patch: { cardId: 'card_fixture', providerSessionId: 'ses_fixture' } });
  await host.invoke('terminal.agent.report', { sessionId, patch: { status: 'working', step: 'Leyendo salida sintética' } });
  const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PHANTOM_RENDERER_URL', 'NODE_OPTIONS', 'NODE_PATH', 'PHANTOM_CLI', 'PHANTOM_HOME']) delete env[key];
  app = await electron.launch({ args: [root, '--ozone-platform=headless', '--no-sandbox'], cwd: root, env, timeout: 20000 });
  appProcess = app.process();
  page = await app.firstWindow(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.waitForSelector('.app-shell'); await viewport(1520, 980);
  await panel().locator('.status-dot.running').waitFor();
  await saved();

  await check('historial normal: rueda, salida entrante y vuelta al final sin entrada PTY', async () => {
    await emit(Array.from({ length: 240 }, (_, i) => `NORMAL_${String(i).padStart(3, '0')}\r\n`).join('') + 'NORMAL_NEWEST\r\n');
    await poll(async () => (await visibleRows()).includes('NORMAL_NEWEST'), 'newest output rendered in xterm DOM');
    await panel().locator('.xterm').evaluate(el => { window.conversationTerminalElement = el; });
    const latestFirst = await firstRow();
    await wheel(-1000); await history().waitFor();
    await poll(async () => (await firstRow()) !== latestFirst, 'older normal output rendered after wheel');
    // Native wheel normalization can advance just a few lines per event. Leave
    // ample history below the anchor so growing rows cannot clamp it to baseY.
    for (let attempt = 0; attempt < 60; attempt++) {
      await pause(100);
      if (/^NORMAL_\d+$/.test(await firstRow()) && Number((await firstRow()).slice(7)) < 200) break;
      await wheel(-1000);
    }
    await pause(150);
    const anchor = await firstRow();
    assert.match(anchor, /^NORMAL_\d+$/, 'actual older normal-buffer line is visible');
    assert(Number(anchor.slice(7)) < 200, 'reading anchor has room below for geometry growth');
    const count = writes.length, bytes = await inputBytes();
    await emit('INCOMING_WHILE_READING\r\n');
    assert(await history().isVisible(), 'incoming output retains history-reading position');
    assert.equal(await firstRow(), anchor, 'incoming output preserves the visible reading line');
    await page.getByRole('button', { name: 'Ampliar texto de la terminal', exact: true }).click();
    await saved(); await pause(250); assert(await history().isVisible(), 'font fit retains reading position');
    assert.equal(await firstRow(), anchor, 'font fit preserves the reading line for unwrapped output');
    await panel().getByLabel('Cambiar tamaño del panel', { exact: true }).press('ArrowDown');
    await saved(); await pause(250);
    assert.equal(await firstRow(), anchor, 'geometry fit preserves the reading line');
    await history().click(); await history().waitFor({ state: 'hidden' });
    await poll(async () => (await visibleRows()).includes('INCOMING_WHILE_READING'), 'return action renders newest output');
    assert(await panel().locator('.xterm').evaluate(el => el === window.conversationTerminalElement), 'history and fits never remount xterm');
    assert.equal(writes.length, count); assert.equal(await inputBytes(), bytes);
    await fs.writeFile(path.join(temp, 'normal-session.json'), JSON.stringify(await host.invoke('terminal.attach', { sessionId }), null, 2));
    await page.screenshot({ path: path.join(temp, 'desktop.png') });
  });

  await check('buffer alternativo: rueda llega a la aplicación sin falso historial normal', async () => {
    await wheel(-700); await history().waitFor();
    await emit('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[H\x1b[2JALT_MOUSE_READY');
    await history().waitFor({ state: 'hidden' });
    await poll(async () => (await visibleRows()).includes('ALT_MOUSE_READY'), 'alternate application screen rendered');
    const count = writes.length;
    const bytes = (await inputBytes()).length;
    await wheel(-320);
    await poll(() => writes.length > count, 'application mouse report');
    assert(writes.slice(count).every(w => w.id === sessionId && /^\x1b\[<6[45];\d+;\d+M$/.test(w.text)), 'native SGR wheel reports target this PTY');
    await poll(async () => (await inputBytes()).length > bytes, 'real PTY receives wheel');
    assert.equal(await history().count(), 0);
    await emit('\x1b[?1000l\x1b[?1006l\x1b[?1049lNORMAL_RESTORED\r\n');
  });

  await check('resumen legible al 34% y compacto al 20%, sin controles subyacentes accesibles', async () => {
    await panel().locator('.agent-identity-toggle').click();
    await host.invoke('node.update', { workspaceId, id: nodeId, patch: { height: 540 } });
    await zoomOverview();
    const summary = await readableSummary();
    const text = await summary.innerText();
    for (const expected of ['Agente de conversación', 'Misión', 'Misión sintética de lectura', 'Trabajando', 'Paso', 'Leyendo salida sintética', 'PTY', 'En ejecución']) assert(text.includes(expected), expected);
    const description = await summary.getAttribute('aria-description');
    for (const expected of ['Card sintética de conversación', 'Reportado por agente', sessionId, 'Vínculo declarado · ses_fixture']) assert(description.includes(expected), expected);
    assert.equal(await panel().locator('.agent-editor').isVisible(), false);
    await page.screenshot({ path: path.join(temp, 'overview.png') });
    await zoomOverview(.2);
    const compact = await readableSummary(true);
    for (const expected of ['Agente de conversación', 'Trabajando', 'PTY', 'En ejecución']) assert((await compact.innerText()).includes(expected), expected);
    assert.equal(await compact.locator('.terminal-overview-mission,.terminal-overview-step').count(), 0, 'compact tier deliberately removes detail');
    assert((await compact.getAttribute('aria-description')).includes('Leyendo salida sintética'));
    await page.screenshot({ path: path.join(temp, 'overview-compact.png') });
    await zoomNormal();
    assert(await panel().locator('.xterm').evaluate(el => el === window.conversationTerminalElement), 'overview tiers never remount xterm');
    // Returning from overview restores the open draft and its input ownership.
    await poll(() => page.getByLabel('Nombre del agente', { exact: true }).evaluate(el => document.activeElement === el), 'editor focus after overview');
    await page.keyboard.press('Escape');
  });

  for (const [width, height, label] of [[1520, 980, 'escritorio'], [1050, 760, 'estrecha']]) {
    await viewport(width, height);
    await check(`editor ${label}: foco, Escape, scroll contenido y borrador tras error`, async () => {
      const camera = structuredClone((await workspace()).camera), count = writes.length;
      await panel().locator('.agent-identity-toggle').click();
      const name = page.getByLabel('Nombre del agente', { exact: true });
      await poll(() => name.evaluate(el => document.activeElement === el), 'name receives opening focus');
      await page.getByRole('button', { name: 'Herramienta de mano', exact: true }).click();
      await name.click();
      assert(await name.evaluate(el => document.activeElement === el), 'hand tool does not intercept editor controls');
      await name.fill(`Borrador ${label}`);
      await name.press('Control+Shift+Enter');
      assert.equal(await page.locator('.canvas-node.focused').count(), 0, 'editor owns keys, including canvas focus shortcut');
      // Force actual host validation/catalog failure without replacing IPC.
      await page.getByLabel('Card de Phantom', { exact: true }).selectOption('card_error');
      failCatalog = true;
      const editor = panel().locator('.agent-editor');
      const bounds = await editor.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, 600);
      await poll(() => editor.evaluate(el => el.scrollTop > 0), 'editor scrolls');
      assert(await editor.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no horizontal field/action overflow at 400px');
      await page.getByRole('button', { name: 'Guardar identidad', exact: true }).click();
      await editor.getByRole('alert').waitFor();
      assert.equal(await name.inputValue(), `Borrador ${label}`);
      assert.equal(await page.getByLabel('Card de Phantom', { exact: true }).inputValue(), 'card_error');
      assert((await editor.getByRole('alert').innerText()).includes('Fallo sintético de guardado'));
      assert.deepEqual((await workspace()).camera, camera); assert.equal(writes.length, count);
      await page.screenshot({ path: path.join(temp, `editor-${label}.png`) });
      await name.press('Escape'); await editor.waitFor({ state: 'hidden' });
      assert(await panel().locator('.agent-identity-toggle').evaluate(el => document.activeElement === el));
      await page.getByRole('button', { name: 'Herramienta de selección', exact: true }).click();
      failCatalog = false;
    });
  }

  await check('guardar solo el nombre conserva reportes recibidos con el editor abierto', async () => {
    await panel().locator('.agent-identity-toggle').click();
    await page.getByLabel('Nombre del agente', { exact: true }).fill('Nombre actualizado');
    await host.invoke('terminal.agent.report', { sessionId, patch: { status: 'review', step: 'Reporte concurrente real' } });
    await poll(async () => (await node()).data.agent.step === 'Reporte concurrente real', 'host live report');
    await page.getByRole('button', { name: 'Guardar identidad', exact: true }).click();
    await panel().locator('.agent-editor').waitFor({ state: 'hidden' });
    assert.equal((await node()).title, 'Nombre actualizado');
    assert.equal((await node()).data.agent.step, 'Reporte concurrente real');
    assert.equal((await node()).data.agent.source, 'agent');
  });

  await check('resumen declara vínculos ausentes sin inventar conversación ni progreso', async () => {
    await host.invoke('terminal.agent.update', { workspaceId, nodeId, patch: { cardId: '', providerSessionId: '' } });
    await host.invoke('node.update', { workspaceId, id: nodeId, patch: { groupId: null } });
    await zoomOverview();
    const summary = page.locator('.terminal-overview');
    await poll(async () => (await summary.getAttribute('aria-description'))?.includes('Sin card vinculada'), 'unlinked accessible description refreshed');
    const text = await summary.innerText();
    for (const expected of ['Nombre actualizado', 'Sin misión vinculada', 'Sin paso declarado', 'PTY', 'En ejecución']) assert(text.includes(expected), expected);
    const description = await summary.getAttribute('aria-description');
    for (const expected of ['Sin card vinculada', 'Sin sesión vinculada', 'Declarado manualmente', sessionId]) assert(description.includes(expected), expected);
    await zoomOverview(.2);
    assert((await summary.innerText()).includes('Sin iniciar'), 'compact tier preserves the reset declared state independently of the running PTY');
    await zoomNormal();
  });

  await check('enfocar panel corto conserva nodo, PID, sesión, cámara y geometría persistida', async () => {
    await host.invoke('node.update', { workspaceId, id: nodeId, patch: { height: 300 } });
    await page.getByRole('button', { name: 'Enfocar para escribir', exact: true }).waitFor();
    const before = await node(), camera = (await workspace()).camera;
    const identity = (await host.invoke('terminal.list', { workspaceId }))[0];
    await page.getByRole('button', { name: 'Enfocar para escribir', exact: true }).click();
    await page.locator('.canvas-node.focused').waitFor(); await pause(250);
    const sessions = await host.invoke('terminal.list', { workspaceId });
    assert.equal(sessions.length, 1); assert.equal(sessions[0].id, identity.id); assert.equal(sessions[0].pid, identity.pid);
    assert.equal((await node()).id, before.id); assert.equal((await node()).height, before.height); assert.equal((await node()).width, before.width);
    assert.deepEqual((await workspace()).camera, camera);
    await page.locator('.focus-return button').click();
  });

  await check('cambiar sesión descarta el estado de lectura anterior', async () => {
    await wheel(-700); await history().waitFor();
    await host.invoke('terminal.stop', { sessionId });
    await poll(async () => (await host.invoke('terminal.attach', { sessionId })).session.status === 'exited', 'old PTY exits');
    await zoomOverview();
    await poll(async () => (await page.locator('.terminal-overview-pty').innerText()).includes('Finalizada'), 'overview truthfully reports exited PTY');
    assert.equal(await panel().locator('.terminal-message').count(), 0, 'error overlay cannot cover summary');
    await zoomNormal();
    await panel().getByRole('button', { name: 'Nueva sesión', exact: true }).waitFor();
    sessionId = (await host.invoke('terminal.create', { workspaceId, nodeId, shell: fixture })).session.id;
    await panel().locator('.status-dot.running').waitFor();
    await history().waitFor({ state: 'hidden' });
    assert.equal((await node()).data.sessionId, sessionId);
  });
  await check('capturas finales: escritorio, editor estrecho y ambos niveles de resumen', async () => {
    await host.invoke('node.update', { workspaceId, id: nodeId, patch: { height: 540 } });
    await viewport(1520, 980); await zoomNormal();
    await page.screenshot({ path: path.join(temp, 'final-desktop.png') });
    await viewport(1050, 760);
    await panel().locator('.agent-identity-toggle').click();
    await page.getByLabel('Nombre del agente', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(temp, 'final-editor-narrow.png') });
    await viewport(1520, 980); await zoomOverview();
    await readableSummary();
    await page.screenshot({ path: path.join(temp, 'final-overview.png') });
    await zoomOverview(.2); await readableSummary(true);
    await page.screenshot({ path: path.join(temp, 'final-overview-compact.png') });
    await zoomNormal();
    await page.getByLabel('Nombre del agente', { exact: true }).press('Escape');
  });
  await check('sin errores de página', async () => assert.deepEqual(errors, []));
} catch (error) {
  process.exitCode = 1;
  console.error(error.stack || error);
  await page?.screenshot({ path: path.join(temp, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(temp, 'failure.txt'), String(error.stack || error));
} finally {
  // Kill only this Playwright-owned app; host.close drains and kills owned PTYs.
  try {
    if (app) {
      let timer;
      try { await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron cleanup timeout')), 5000); })]); }
      catch (error) { process.exitCode = 1; errors.push(error.message); console.error(error.message); }
      finally { clearTimeout(timer); if (appProcess.exitCode === null && appProcess.signalCode === null) appProcess.kill('SIGKILL'); }
    }
  } finally { await host?.close(); }
  await fs.writeFile(path.join(temp, 'evidence.json'), JSON.stringify({ checks, errors, writes, temp }, null, 2));
  console.log(`Evidencia: ${temp}`);
}
