import { access, chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getRunManager, requireWorkspace, requireId, stateDirectory, runCommand, executableOnPath, shutdownAutomation as shutdownRuns } from './run-manager.mjs';
import { createBrowserClient, credentialFile, endpointFile, privateJSON } from '../host/agent-browser.mjs';
import { browserKey } from '../desktop/security.mjs';
import { handleVoice, shutdownVoice } from './voice.mjs';

export async function shutdownAutomation() { await Promise.all([shutdownRuns(), shutdownVoice()]); }
export const shutdown = shutdownAutomation;
const METHODS = new Set(['automation.start', 'automation.list', 'automation.stop', 'automation.trace', 'playground.run', 'playground.list', 'playground.stop']);

function integer(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} debe estar entre ${min} y ${max}`);
  return value;
}

function httpURL(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('URL http(s) requerida');
  let url;
  try { url = new URL(value); } catch { throw new Error('URL inválida'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Solo URLs http(s) sin credenciales');
  return url.href;
}

function automationInput(payload) {
  const mode = payload.mode ?? 'integrated';
  if (!['integrated', 'isolated'].includes(mode)) throw new Error('mode debe ser integrated o isolated');
  const url = httpURL(payload.url);
  const actions = payload.actions ?? [];
  if (!Array.isArray(actions) || actions.length > 50) throw new Error('Máximo 50 acciones');
  const normalized = actions.map(action => {
    if (!action || !['goto', 'click', 'fill', 'screenshot', 'wait'].includes(action.type)) throw new Error('Tipo de acción no permitido');
    if (action.type === 'goto') return { type: action.type, url: httpURL(action.url) };
    if (['click', 'fill'].includes(action.type)) {
      if (typeof action.selector !== 'string' || !action.selector.trim() || action.selector.length > 2048) throw new Error('Selector inválido');
      if (action.type === 'fill' && (typeof action.value !== 'string' || action.value.length > 16_384)) throw new Error('Valor fill inválido');
      return { type: action.type, selector: action.selector, ...(action.type === 'fill' ? { value: action.value } : {}) };
    }
    if (action.type === 'wait') return { type: action.type, milliseconds: integer(action.milliseconds, 250, 0, 10_000, 'milliseconds') };
    return { type: action.type };
  });
  for (const key of ['headed', 'keepOpen']) if (payload[key] !== undefined && typeof payload[key] !== 'boolean') throw new Error(`${key} debe ser booleano`);
  if (mode === 'integrated' && payload.headed === false) throw new Error('integrated requiere el panel visible; usa mode: "isolated" para headless');
  // Canvas-only: nothing opens a window outside the workspace. Visible runs use the
  // integrated canvas panel; isolated runs are always headless (trace is viewed in-canvas).
  if (mode === 'isolated' && payload.headed === true) throw new Error('Ventana externa de Chromium deshabilitada: usa mode "integrated" (panel del canvas) para verlo en vivo; isolated es siempre sin ventana');
  return { mode, url, actions: normalized, headed: mode === 'integrated', keepOpen: payload.keepOpen === true,
    timeoutMs: integer(payload.timeoutMs, 60_000, 100, 120_000, 'timeoutMs'),
    keepOpenMs: integer(payload.keepOpenMs, 300_000, 100, 600_000, 'keepOpenMs') };
}

async function finishLog(record) {
  await writeFile(path.join(record.artifactDir, 'output.log'), record.output, { mode: 0o600 });
}

async function startPlayground(payload, context, manager, workspace, cwd) {
  if (!['node', 'python', 'shell'].includes(payload.runtime)) throw new Error('Runtime permitido: node, python, shell');
  if (typeof payload.code !== 'string' || !payload.code.trim() || Buffer.byteLength(payload.code) > 256 * 1024) throw new Error('Código requerido, máximo 256 KiB');
  const timeoutMs = integer(payload.timeoutMs, 30_000, 50, 120_000, 'timeoutMs');
  const runtime = payload.runtime;
  const executable = runtime === 'node' ? process.execPath : await executableOnPath(runtime === 'python' ? 'python3' : 'bash');
  if (!executable) throw new Error(`Runtime ${runtime} no disponible; instala/configura su ejecutable en el host`);
  const record = await manager.create(workspace.id, 'playground', { runtime, executable, cwd, timeoutMs }, context);
  const sourcePath = path.join(record.artifactDir, runtime === 'node' ? 'source.mjs' : runtime === 'python' ? 'source.py' : 'source.sh');
  await manager.prepare(record, context, async () => {
    await writeFile(sourcePath, payload.code, { mode: 0o600 });
    record.sourcePath = sourcePath;
    await manager.save(record);
  });
  const abort = new AbortController();
  let done;
  const controller = { stop: async () => { abort.abort(); await done; } };
  manager.own(record, controller);
  done = new Promise(resolve => setTimeout(resolve, 0)).then(async () => {
    try {
      if (abort.signal.aborted) throw new Error('Ejecución detenida');
      await manager.status(record, 'running', context);
      const version = await runCommand(executable, ['--version'], { cwd, timeoutMs: 3000, outputLimit: 4096, signal: abort.signal });
      record.runtimeVersion = version.output.split('\n')[0];
      const result = await runCommand(executable, runtime === 'python' ? ['-u', sourcePath] : [sourcePath], {
        cwd, timeoutMs, signal: abort.signal,
        onSpawn: pid => { record.pid = pid; manager.save(record).catch(() => {}); },
        onOutput: text => manager.output(record, text, context),
      });
      record.exitCode = result.code;
      record.exitSignal = result.signal;
      if (result.code !== 0) throw new Error(`Proceso terminó con código ${result.code ?? result.signal}`);
      await manager.status(record, abort.signal.aborted ? 'stopped' : 'completed', context);
    } catch (error) {
      await manager.status(record, abort.signal.aborted ? 'stopped' : 'failed', context, { error: error.message, exitCode: error.exitCode ?? record.exitCode, exitSignal: error.exitSignal ?? record.exitSignal });
    } finally {
      delete record.pid;
      if (manager.controllers.get(record.id) === controller) manager.controllers.delete(record.id);
      await finishLog(record);
      await manager.save(record);
    }
  }).catch(error => { manager.output(record, `Error de persistencia: ${error.message}\n`, context); if (manager.controllers.get(record.id) === controller) manager.controllers.delete(record.id); });
  return manager.describe(record);
}

const integratedOwners = new Set();

async function integratedClient(payload, context, workspace) {
  if (context.browserClient) return context.browserClient;
  const sessions = (context.sessions ?? []).filter(s => s.workspaceId === workspace.id && s.status === 'running');
  const sessionId = payload.sessionId ?? (process.env.PHANTOM_BROWSER_WORKSPACE === workspace.id ? process.env.PHANTOM_BROWSER_SESSION : undefined)
    ?? (sessions.length === 1 ? sessions[0].id : undefined);
  if (!sessionId) throw new Error('Navegador integrado: abre Phantom con una terminal activa; indica sessionId si hay varias (terminal.list). Para aislamiento usa mode: "isolated"');
  requireId(sessionId, 'sessionId');
  if (!sessions.some(s => s.id === sessionId)) throw new Error('sessionId debe ser una terminal activa de este workspace');
  const dataDir = stateDirectory(context);
  let capability;
  try { capability = privateJSON(credentialFile(dataDir, sessionId)); }
  catch { throw new Error('Puente browser no disponible: abre una terminal nueva en Phantom Workspace'); }
  if (capability.workspaceId !== workspace.id) throw new Error('Terminal browser de otro workspace');
  return createBrowserClient({ env: { PHANTOM_BROWSER_ENDPOINT: endpointFile(dataDir), PHANTOM_BROWSER_TOKEN: capability.token,
    PHANTOM_BROWSER_SESSION: sessionId, PHANTOM_BROWSER_WORKSPACE: workspace.id } });
}

async function startIntegrated(payload, input, context, manager, workspace, cwd) {
  const client = await integratedClient(payload, context, workspace);
  let discovery;
  try { discovery = await client.invoke('context'); }
  catch (error) { throw new Error(`Navegador integrado no disponible: abre la ventana de Phantom, activa este proyecto y usa una terminal nueva. ${error.message}`); }
  if (!discovery.available || discovery.workspaceId !== workspace.id) throw new Error('Puente browser no disponible para este workspace');
  const key = browserKey(payload.key);
  // One action stream per terminal, including across panel keys.
  const owner = `${workspace.id}:${discovery.sessionId}`;
  if (integratedOwners.has(owner)) throw new Error('Ya hay una automatización integrada activa en esta terminal');
  integratedOwners.add(owner);
  let record;
  try {
    record = await manager.create(workspace.id, 'automation', { ...input, cwd, sessionId: discovery.sessionId, key,
      lifecycle: 'Stop libera el control; el panel integrado y su sesión permanecen visibles', browserOpen: false,
      traceSupported: false, traceReason: 'El puente integrado no soporta trace Playwright; usa mode: "isolated"' }, context);
    await manager.prepare(record, context, () => writeFile(path.join(record.artifactDir, 'input.json'), JSON.stringify({ ...input, key, sessionId: discovery.sessionId }, null, 2), { mode: 0o600 }));
  } catch (error) { integratedOwners.delete(owner); throw error; }
  const abort = new AbortController();
  let done, keepTimer, executionTimer, released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(keepTimer);
    record.browserOpen = false;
    integratedOwners.delete(owner);
    if (manager.controllers.get(record.id) === controller) manager.controllers.delete(record.id);
  };
  const output = text => {
    if (!manager.output(record, text, context)) { record.outputExceeded = true; abort.abort(); throw new Error('Salida del navegador excede 65536 bytes'); }
  };
  const invoke = async (command, options = {}) => {
    abort.signal.throwIfAborted();
    const result = await client.invoke(command, { key, ...options });
    if (['preview', 'open'].includes(command)) {
      record.panelId = result.id;
      record.panelRetained = true;
    }
    abort.signal.throwIfAborted();
    return result;
  };
  const capture = async filename => {
    const artifact = await invoke('screenshot');
    const target = path.join(record.artifactDir, filename);
    await copyFile(artifact.path, target);
    return target;
  };
  const controller = { stop: async () => {
    abort.abort();
    // The bridge cannot cancel an RPC: drain it before acknowledging Stop.
    await done;
    release();
    await manager.status(record, 'stopped', context);
    await finishLog(record);
  } };
  manager.own(record, controller);
  done = new Promise(resolve => setTimeout(resolve, 0)).then(async () => {
    try {
      abort.signal.throwIfAborted();
      await manager.status(record, 'running', context);
      executionTimer = setTimeout(() => { record.timedOut = true; abort.abort(); }, input.timeoutMs);
      output(`preview ${input.url}\n`);
      const panel = await invoke('preview', { url: input.url, timeoutMs: Math.min(input.timeoutMs, 60_000) });
      record.panelId = panel.id;
      record.panelRetained = true;
      record.browserOpen = true;
      for (const [index, action] of input.actions.entries()) {
        abort.signal.throwIfAborted();
        output(`Paso ${index + 1}: ${action.type}\n`);
        if (action.type === 'goto') await invoke('open', { url: action.url, timeoutMs: Math.min(input.timeoutMs, 60_000) });
        if (action.type === 'click') await invoke('click', { selector: action.selector });
        if (action.type === 'fill') await invoke('fill', { selector: action.selector, value: action.value });
        if (action.type === 'wait') await new Promise((resolve, reject) => {
          const stop = () => { clearTimeout(timer); reject(new Error('Ejecución detenida')); };
          const timer = setTimeout(() => { abort.signal.removeEventListener('abort', stop); resolve(); }, action.milliseconds);
          abort.signal.addEventListener('abort', stop, { once: true });
        });
        if (action.type === 'screenshot') await capture(`step-${index + 1}.png`);
      }
      record.screenshotPath = await capture('screenshot.png');
      const consoleResult = await invoke('console');
      for (const message of consoleResult.messages ?? []) output(`[browser ${message.level}] ${message.message ?? message.text ?? ''}\n`);
      clearTimeout(executionTimer);
      if (!input.keepOpen) release();
      await manager.status(record, 'completed', context);
      if (input.keepOpen) {
        keepTimer = setTimeout(() => controller.stop().catch(() => {}), input.keepOpenMs);
        keepTimer.unref();
      }
    } catch (error) {
      release();
      await manager.status(record, record.timedOut || record.outputExceeded || !abort.signal.aborted ? 'failed' : 'stopped', context,
        { error: record.timedOut ? `Tiempo límite excedido (${input.timeoutMs} ms); RPC pendiente drenado` : error.message });
    } finally {
      clearTimeout(executionTimer);
      await finishLog(record);
      await manager.save(record);
    }
  }).catch(error => { release(); manager.output(record, `Error de persistencia: ${error.message}\n`, context); });
  return manager.describe(record);
}

async function startBrowser(payload, context, manager, workspace, cwd) {
  const input = automationInput(payload);
  if (input.mode === 'integrated') return startIntegrated(payload, input, context, manager, workspace, cwd);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { throw new Error('Playwright no disponible. Incluye playwright como dependencia de producción del host'); }
  // Full Chromium build, always headless: the canvas is the only visible browser surface.
  try { await access(chromium.executablePath()); } catch { throw new Error('Chromium de Playwright no está descargado. El administrador debe ejecutar npx playwright install chromium o incluirlo en el paquete'); }
  const record = await manager.create(workspace.id, 'automation', { ...input, cwd, lifecycle: input.keepOpen ? 'completed con navegador visible hasta Stop o keepOpenMs' : 'navegador cerrado al completar las acciones', browserOpen: false }, context);
  await manager.prepare(record, context, () => writeFile(path.join(record.artifactDir, 'input.json'), JSON.stringify(input, null, 2), { mode: 0o600 }));
  const abort = new AbortController();
  let browser, browserContext, tracing = false, done, keepTimer, closePromise;
  const close = () => closePromise ||= (async () => {
    if (tracing && browserContext) {
      tracing = false;
      try {
        const tracePath = path.join(record.artifactDir, 'trace.zip');
        await browserContext.tracing.stop({ path: tracePath });
        record.tracePath = tracePath;
      } catch (error) { manager.output(record, `No se pudo guardar trace: ${error.message}\n`, context); }
    }
    await browser?.close().catch(() => {});
    record.browserOpen = false;
  })();
  const controller = { stop: async () => {
    clearTimeout(keepTimer);
    abort.abort();
    // Closing owned browser interrupts navigation, locator waits and screenshots.
    if (browser) await close();
    await done;
    await close();
    if (manager.controllers.get(record.id) === controller) manager.controllers.delete(record.id);
    await manager.status(record, 'stopped', context);
  } };
  manager.own(record, controller);
  done = new Promise(resolve => setTimeout(resolve, 0)).then(async () => {
    let executionTimer;
    try {
      if (abort.signal.aborted) throw new Error('Ejecución detenida');
      await manager.status(record, 'running', context);
      executionTimer = setTimeout(() => { record.timedOut = true; abort.abort(); if (browser) void close(); }, input.timeoutMs);
      browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, timeout: Math.min(input.timeoutMs, 20_000) });
      record.browserOpen = true;
      if (abort.signal.aborted) throw new Error('Ejecución detenida');
      browserContext = await browser.newContext({ acceptDownloads: false });
      await browserContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
      tracing = true;
      const page = await browserContext.newPage();
      page.setDefaultTimeout(10_000);
      page.setDefaultNavigationTimeout(15_000);
      await browserContext.route('**/*', route => {
        const protocol = new URL(route.request().url()).protocol;
        return ['http:', 'https:'].includes(protocol) ? route.continue() : route.abort();
      });
      const browserOutput = text => {
        if (!manager.output(record, text, context)) {
          record.outputExceeded = true;
          abort.abort();
          void close();
        }
      };
      page.on('console', message => browserOutput(`[browser ${message.type()}] ${message.text().slice(0, 4096)}\n`));
      page.on('pageerror', error => browserOutput(`[pageerror] ${error.message.slice(0, 4096)}\n`));
      manager.output(record, `goto ${input.url}\n`, context);
      await page.goto(input.url, { waitUntil: 'domcontentloaded' });
      for (const [index, action] of input.actions.entries()) {
        if (abort.signal.aborted) throw new Error('Ejecución detenida');
        manager.output(record, `Paso ${index + 1}: ${action.type}\n`, context);
        if (action.type === 'goto') await page.goto(action.url, { waitUntil: 'domcontentloaded' });
        if (action.type === 'click') await page.locator(action.selector).click();
        if (action.type === 'fill') await page.locator(action.selector).fill(action.value);
        if (action.type === 'wait') await page.waitForTimeout(action.milliseconds);
        if (action.type === 'screenshot') await page.screenshot({ path: path.join(record.artifactDir, `step-${index + 1}.png`), timeout: 10_000 });
      }
      if (abort.signal.aborted) throw new Error('Ejecución detenida');
      record.screenshotPath = path.join(record.artifactDir, 'screenshot.png');
      await page.screenshot({ path: record.screenshotPath, timeout: 10_000 });
      const tracePath = path.join(record.artifactDir, 'trace.zip');
      await browserContext.tracing.stop({ path: tracePath });
      tracing = false;
      record.tracePath = tracePath;
      clearTimeout(executionTimer);
      if (!input.keepOpen) await close();
      await manager.status(record, 'completed', context);
      if (input.keepOpen) {
        keepTimer = setTimeout(() => controller.stop().catch(() => {}), input.keepOpenMs);
        keepTimer.unref();
        browser.on('disconnected', () => {
          clearTimeout(keepTimer);
          record.browserOpen = false;
          if (manager.controllers.get(record.id) === controller) manager.controllers.delete(record.id);
          manager.save(record).catch(() => {});
        });
      }
    } catch (error) {
      await close();
      const status = record.timedOut || record.outputExceeded ? 'failed' : abort.signal.aborted ? 'stopped' : 'failed';
      await manager.status(record, status, context, { error: record.outputExceeded ? 'Salida del navegador excede 65536 bytes' : record.timedOut ? `Tiempo límite excedido (${input.timeoutMs} ms)` : error.message });
    } finally {
      clearTimeout(executionTimer);
      if (!record.browserOpen && manager.controllers.get(record.id) === controller) manager.controllers.delete(record.id);
      await finishLog(record);
      await manager.save(record);
    }
  }).catch(error => { manager.output(record, `Error de persistencia: ${error.message}\n`, context); if (manager.controllers.get(record.id) === controller) manager.controllers.delete(record.id); });
  return manager.describe(record);
}

// Playwright's show-trace always hands its URL to the `open` package, which runs
// xdg-open (it ignores BROWSER). A private no-op xdg-open first on PATH keeps the
// viewer inside the canvas panel the caller opens with the returned URL.
async function noExternalOpenPath(context) {
  const dir = path.join(stateDirectory(context), 'no-external-open');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const shim = path.join(dir, 'xdg-open');
  await writeFile(shim, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await chmod(shim, 0o700);
  return [dir, process.env.PATH].filter(Boolean).join(path.delimiter);
}

// Optional explicit viewer: loopback-only Playwright CLI, five-minute ownership.
async function openTraceViewer(record, manager, context, tracePath) {
  if (record.viewer?.status === 'running' && record.viewer.url) return record.viewer.url;
  if (record.viewer?.status === 'starting') throw new Error('El visor de trace se está iniciando');
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  const abort = new AbortController();
  const original = manager.controllers.get(record.id);
  let resolveURL, rejectURL, startupTimer, done;
  const ready = new Promise((resolve, reject) => { resolveURL = resolve; rejectURL = reject; });
  record.viewer = { status: 'starting', expiresAt: new Date(Date.now() + 300_000).toISOString() };
  const controller = { stop: async () => {
    abort.abort();
    await Promise.all([done, original?.stop()]);
    if (manager.controllers.get(record.id) === controller) manager.controllers.delete(record.id);
    await manager.status(record, 'stopped', context);
  } };
  manager.controllers.set(record.id, controller);
  let pending = '', viewerPATH;
  try { viewerPATH = await noExternalOpenPath(context); } catch (error) {
    if (manager.controllers.get(record.id) === controller) { if (original) manager.controllers.set(record.id, original); else manager.controllers.delete(record.id); }
    record.viewer = { status: 'failed', error: error.message };
    throw new Error(`Visor de trace: no se pudo aislar del navegador externo (${error.message})`);
  }
  startupTimer = setTimeout(() => { abort.abort(); rejectURL(new Error('El visor no inició en 10 segundos')); }, 10_000);
  done = runCommand(process.execPath, [cli, 'show-trace', tracePath, '--host', '127.0.0.1', '--port', '0'], {
    cwd: record.artifactDir, signal: abort.signal, timeoutMs: 300_000, env: { ...process.env, PATH: viewerPATH },
    onSpawn: pid => { record.viewer.pid = pid; manager.save(record).catch(() => {}); },
    onOutput: text => {
      manager.output(record, `[trace viewer] ${text}`, context);
      pending = (pending + text).slice(-4096);
      const match = pending.match(/Listening on (http:\/\/127\.0\.0\.1:\d+\/?)/);
      if (match) {
        clearTimeout(startupTimer);
        record.viewer.status = 'running'; record.viewer.url = match[1];
        manager.save(record).catch(() => {});
        manager.emit(context, { type: 'tool.status', workspaceId: record.workspaceId, id: record.id, status: record.status, result: manager.describe(record) });
        resolveURL(match[1]);
      }
    },
  }).then(result => {
    record.viewer.status = result.code === 0 ? 'stopped' : 'failed';
    rejectURL(new Error(`El visor terminó con código ${result.code}`));
  }).catch(error => {
    record.viewer.status = abort.signal.aborted ? 'stopped' : 'failed';
    record.viewer.error = error.message;
    rejectURL(new Error(`Visor de trace: ${error.message}`));
  }).finally(async () => {
    clearTimeout(startupTimer);
    delete record.viewer.pid;
    if (manager.controllers.get(record.id) === controller) {
      if (original && record.browserOpen) manager.controllers.set(record.id, original);
      else manager.controllers.delete(record.id);
    }
    await manager.save(record).catch(() => {});
    await finishLog(record).catch(() => {});
  });
  return ready;
}

export async function handleAutomation(method, payload = {}, context = {}) {
  if (method.startsWith('voice.')) return handleVoice(method, payload, context);
  if (!METHODS.has(method)) return { handled: false };
  const { workspace, cwd } = await requireWorkspace(payload, context);
  const manager = await getRunManager(context, cwd, workspace.id);
  const kind = method.startsWith('playground.') ? 'playground' : 'automation';
  let result;
  if (method.endsWith('.list')) result = { items: [...manager.records.values()].filter(record => record.workspaceId === workspace.id && record.kind === kind).map(record => manager.describe(record)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  else if (method === 'playground.run') result = await startPlayground(payload, context, manager, workspace, cwd);
  else if (method === 'automation.start') result = await startBrowser(payload, context, manager, workspace, cwd);
  else {
    const record = manager.get(payload.id, workspace.id, kind);
    if (method.endsWith('.stop')) result = await manager.stop(record);
    else {
      if (record.mode === 'integrated') throw new Error(record.traceReason);
      const tracePath = path.join(record.artifactDir, 'trace.zip');
      try { await access(tracePath); } catch { throw new Error('Trace aún no disponible; espera a que termine o detén la ejecución'); }
      result = { path: tracePath };
      if (payload.openViewer === true) result.url = await openTraceViewer(record, manager, context, tracePath);
    }
  }
  return { handled: true, result };
}
