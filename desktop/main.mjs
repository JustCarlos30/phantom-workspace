import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, session, shell } from 'electron';
import { constants, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { access, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrowserManager } from './browser-manager.mjs';
import { startAgentBrowser } from './agent-browser.mjs';
import { readLocalImage } from './local-image.mjs';
import {
  INVOKE_CHANNEL, EVENT_CHANNEL, HOST_METHODS, authorizedPath, browserURL,
  contentSecurityPolicy, isHostTransportError, isLocalUIURL, isTrustedSender, isWithin,
  validateCloseReady, validateID, validateInvocation, validateJSON,
  REFERENCE_SCHEME, REVIEW_SCHEME, createReviewMedia, byteRange, referenceTarget,
} from './security.mjs';

// Must precede app ready. `stream` lets <video> seek through range requests.
protocol.registerSchemesAsPrivileged([REFERENCE_SCHEME, REVIEW_SCHEME].map(scheme => ({ scheme, privileges: { standard: true, secure: true, stream: true } })));
const reviewMedia = createReviewMedia();

const dataDir = path.resolve(process.env.PHANTOM_WORKSPACE_HOME
  || path.join(process.env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state'), 'phantom-workspace'));
await mkdir(path.join(dataDir, 'electron'), { recursive: true, mode: 0o700 });
app.setPath('userData', path.join(dataDir, 'electron'));
app.setName('Phantom Workspace');

let mainWindow = null;
let browsers = null;
let agentBrowser = null;
let client = null;
let connecting = null;
let quitting = false;
let closeAttempt = null;
const approvedClose = new WeakSet();
let hostStatus = { connected: false, error: null };
const appPath = app.getAppPath();
const distDir = path.join(appPath, 'dist');
const hostPath = path.join(appPath, 'host', 'server.mjs');
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(process.resourcesPath, 'browsers');
  process.env.PHANTOM_CLI ||= path.join(appPath, 'vendor', 'phantom', 'bin', 'phantom.mjs');
}
let devURL = null;
if (!app.isPackaged && process.env.PHANTOM_RENDERER_URL) {
  const candidate = new URL(browserURL(process.env.PHANTOM_RENDERER_URL, { external: true }));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(candidate.hostname)) throw new Error('El renderer de desarrollo debe ser loopback');
  devURL = candidate.href;
}
const uiURL = devURL || pathToFileURL(path.join(distDir, 'index.html')).href;
const csp = contentSecurityPolicy(devURL);

async function nodeBinary() {
  const packaged = path.join(process.resourcesPath, 'runtime', 'node');
  if (app.isPackaged) {
    try { await access(packaged, constants.X_OK); return packaged; } catch { /* explicit fallback below */ }
  }
  const selected = process.env.PHANTOM_NODE_BINARY || '/usr/bin/node';
  if (!path.isAbsolute(selected)) throw new Error('PHANTOM_NODE_BINARY debe ser una ruta absoluta');
  await access(selected, constants.X_OK);
  return selected;
}

function deadline(promise, milliseconds, message) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

function emit(event) {
  const wc = mainWindow?.webContents;
  if (!wc || mainWindow.isDestroyed() || wc.isDestroyed()) return;
  try {
    if (!isLocalUIURL(wc.mainFrame.url, uiURL) || wc.isLoadingMainFrame()) return;
    validateJSON(event, 16 * 1024 * 1024);
    // Send to the live top-level frame, never to a remote page or child frame.
    wc.mainFrame.send(EVENT_CHANNEL, event);
  } catch { /* Window/frame may disappear between the checks and delivery. */ }
}

function receiveHostEvent(event) {
  if (event?.type === 'connection') hostStatus = {
    connected: event.status === 'connected',
    error: event.status === 'connected' ? null : event.message || 'Host desconectado',
  };
  if (event?.type === 'state.changed') browsers?.reconcile().catch(() => {});
  emit(event);
}

async function hostClient() {
  if (client) return client;
  if (!connecting) {
    connecting = (async () => {
      const { connectHost } = await import('./host-client.mjs');
      const connected = await connectHost({ dataDir, nodePath: await nodeBinary(), hostPath, onEvent: receiveHostEvent });
      if (quitting) { connected.close(); throw new Error('Aplicación cerrada'); }
      client = connected;
      hostStatus = { connected: true, error: null };
      return connected;
    })();
    connecting.finally(() => { connecting = null; }).catch(() => {});
  }
  return deadline(connecting, 12_000, 'Host no disponible: tiempo de conexión agotado');
}

async function hostInvoke(method, payload = {}) {
  let connected;
  try {
    connected = await hostClient();
    // host-client owns the per-method deadline; an expired request is not a lost transport.
    const result = await connected.invoke(method, payload);
    if (method === 'review.export' && result.origin?.kind === 'render') {
      const state = await connected.invoke('state.get', {});
      const workspace = state.workspaces.find(item => item.id === payload.workspaceId);
      if (!workspace) throw new Error('Proyecto de revisión desconocido.');
      result.mediaURL = await reviewMedia.issue(await realpath(workspace.canonicalPath ?? workspace.path), payload.slug, result);
    }
    hostStatus = { connected: method !== 'host.shutdown', error: null };
    if (method === 'host.shutdown') { connected.close(); client = null; browsers?.invalidate(); }
    return result;
  } catch (error) {
    const transportLost = !connected || isHostTransportError(error);
    if (transportLost) hostStatus = { connected: false, error: error.message };
    // Validation failures and request timeouts preserve the channel. Never replay mutations:
    // after a timeout or disconnect their outcome may still be unknown.
    if (connected && transportLost) {
      connected.reconnect();
    }
    throw Object.assign(new Error(`Host: ${error.message}`), { code: error.code });
  }
}

function trustedContents(wc) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && wc === mainWindow.webContents
    && !wc.isDestroyed() && isLocalUIURL(wc.getURL(), uiURL));
}

function configureUISession(ses) {
  let microphoneGranted = false;
  let microphonePrompt = null;
  ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
    const local = trustedContents(wc) && details.isMainFrame && isLocalUIURL(details.requestingUrl, uiURL);
    if (!local) return false;
    if (permission === 'media') return microphoneGranted && details.mediaType === 'audio';
    return permission === 'clipboard-sanitized-write';
  });
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const local = trustedContents(wc) && details.isMainFrame && isLocalUIURL(details.requestingUrl, uiURL);
    if (!local) return callback(false);
    if (permission === 'clipboard-sanitized-write') return callback(true);
    if (permission !== 'media' || !details.mediaTypes?.length || details.mediaTypes.some(type => type !== 'audio')) return callback(false);
    if (microphoneGranted) return callback(true);
    microphonePrompt ??= dialog.showMessageBox(mainWindow, {
      type: 'question', title: 'Micrófono para voz',
      message: '¿Permitir que Phantom Workspace use el micrófono?',
      detail: 'Solo la interfaz local puede grabar voz. Los sitios del navegador interno no reciben este permiso.',
      buttons: ['No permitir', 'Permitir micrófono'], defaultId: 0, cancelId: 0,
    }).then(({ response }) => {
      microphoneGranted = response === 1 && trustedContents(wc);
      return microphoneGranted;
    }).catch(() => false).finally(() => { microphonePrompt = null; });
    microphonePrompt.then(allowed => callback(allowed && trustedContents(wc)));
  });
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback(null));
  ses.on('will-download', event => event.preventDefault());
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'content-security-policy') delete headers[name];
    callback({ responseHeaders: { ...headers, 'Content-Security-Policy': [csp] } });
  });
  // Canvas references: images and videos stored by the host under the data tree.
  ses.protocol.handle(REVIEW_SCHEME, request => reviewMedia.respond(request));
  ses.protocol.handle(REFERENCE_SCHEME, async request => {
    try {
      const target = referenceTarget(request.url);
      if (!target || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 });
      const root = await realpath(path.join(dataDir, 'references', target.workspaceId));
      const file = await realpath(path.join(root, target.file));
      if (!isWithin(file, root) || !isWithin(root, await realpath(dataDir))) return new Response('Forbidden', { status: 403 });
      const { size } = await stat(file), range = byteRange(request.headers.get('range'), size);
      const headers = { 'Content-Type': target.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' };
      if (range === false) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      const { start, end } = range || { start: 0, end: size - 1 };
      const body = request.method === 'HEAD' || !size ? null : Readable.toWeb(createReadStream(file, { start, end }));
      return new Response(body, { status: range ? 206 : 200, headers: { ...headers, 'Content-Length': String(size ? end - start + 1 : 0), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  if (!devURL) {
    // file: responses don't reliably pass through onHeadersReceived. Supply CSP on the
    // actual document response and restrict this session's file loader to built assets.
    ses.protocol.handle('file', async request => {
      try {
        const target = await realpath(fileURLToPath(request.url));
        if (!isWithin(target, await realpath(distDir))) return new Response('Forbidden', { status: 403 });
        const response = await net.fetch(pathToFileURL(target).href, { bypassCustomProtocolHandlers: true });
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', csp);
        return new Response(response.body, { status: response.status, headers });
      } catch { return new Response('Not found', { status: 404 }); }
    });
  }
}

let uiSession;
function openMainWindow() {
  if (quitting) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
    return mainWindow;
  }
  const win = new BrowserWindow({
    title: 'Phantom Workspace', width: 1520, height: 980, minWidth: 1000, minHeight: 700,
    backgroundColor: '#14121b', show: false,
    webPreferences: {
      session: uiSession, preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  const manager = new BrowserManager({ window: win, getState: () => hostInvoke('state.get'), emit });
  browsers = manager;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = event => { if (!event.isMainFrame || !isLocalUIURL(event.url, uiURL)) event.preventDefault(); };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-frame-navigate', guard);
  win.webContents.on('will-redirect', guard);
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('will-prevent-unload', event => {
    // A confirmed durable drain supersedes an older renderer beforeunload veto.
    if (approvedClose.has(win)) event.preventDefault();
  });
  win.webContents.on('did-start-navigation', event => {
    if (event.isMainFrame) {
      manager.invalidate();
      if (closeAttempt?.window === win) {
        closeAttempt.frame = null;
        offerCloseChoice(closeAttempt);
      }
    }
  });
  win.webContents.on('render-process-gone', () => {
    manager.invalidate();
    if (closeAttempt?.window === win) offerCloseChoice(closeAttempt);
  });
  win.on('ready-to-show', () => win.show());
  // Render immediately even if a broken dev server never reaches ready-to-show.
  const showTimer = setTimeout(() => { if (!win.isDestroyed()) win.show(); }, 1500);
  win.on('close', event => {
    if (!approvedClose.has(win)) {
      event.preventDefault();
      beginClose();
      return;
    }
    manager.dispose();
  });
  win.on('closed', () => {
    clearTimeout(showTimer);
    if (closeAttempt?.window === win) cancelClose(closeAttempt);
    if (mainWindow === win) { mainWindow = null; browsers = null; }
  });
  win.loadURL(uiURL).catch(error => {
    if (!win.isDestroyed()) {
      win.show();
      dialog.showMessageBox(win, { type: 'error', message: 'No se pudo abrir la interfaz', detail: error.message }).catch(() => {});
    }
  });
  return win;
}

function cancelClose(attempt) {
  clearTimeout(attempt.timer);
  if (closeAttempt === attempt) {
    closeAttempt = null;
    emit({ type: 'desktop.closeCancelled', requestId: attempt.requestId });
  }
}

async function finishClose(attempt) {
  if (closeAttempt !== attempt || attempt.finalizing) return;
  attempt.finalizing = true;
  clearTimeout(attempt.timer);
  try {
    // The renderer has now drained its durable writes, or the user explicitly
    // chose to discard them in a native dialog. Never stop the daemon earlier.
    if (attempt.stopHost) await hostInvoke('host.shutdown');
    if (closeAttempt !== attempt) return;
    cancelClose(attempt);
    approvedClose.add(attempt.window);
    if (attempt.quitApp) app.quit();
    else if (!attempt.window.isDestroyed()) attempt.window.close();
  } catch (error) {
    cancelClose(attempt);
    if (!attempt.window.isDestroyed()) await dialog.showMessageBox(attempt.window, {
      type: 'error', title: 'No se pudo cerrar', message: 'No se pudo detener el host', detail: error.message,
    }).catch(() => {});
  }
}

async function offerCloseChoice(attempt) {
  if (closeAttempt !== attempt || attempt.prompting || attempt.finalizing) return;
  clearTimeout(attempt.timer);
  attempt.prompting = true;
  try {
    const { response } = await dialog.showMessageBox(attempt.window, {
      type: 'warning', title: 'Guardado sin confirmar',
      message: 'La interfaz no ha confirmado que se guardaron los cambios recientes.',
      detail: 'Puedes reintentar el guardado o cancelar el cierre. Cerrar sin guardar puede perder notas o posiciones recientes.',
      buttons: ['Reintentar guardado', 'Cancelar cierre', 'Cerrar sin guardar'], defaultId: 1, cancelId: 1,
      noLink: true,
    });
    if (closeAttempt !== attempt || attempt.finalizing) return;
    if (attempt.acknowledged) return finishClose(attempt);
    if (response === 2) return finishClose(attempt);
    cancelClose(attempt);
    if (response === 0) beginClose({ stopHost: attempt.stopHost, quitApp: attempt.quitApp });
  } catch { cancelClose(attempt); }
}

function beginClose({ stopHost = false, quitApp = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (stopHost) hostInvoke('host.shutdown').then(() => app.quit()).catch(error => console.error(error));
    else app.quit();
    return null;
  }
  if (closeAttempt) {
    closeAttempt.stopHost ||= stopHost;
    closeAttempt.quitApp ||= quitApp;
    return closeAttempt;
  }
  const attempt = { requestId: randomUUID(), window: mainWindow, frame: mainWindow.webContents.mainFrame,
    stopHost, quitApp, finalizing: false, prompting: false };
  closeAttempt = attempt;
  attempt.timer = setTimeout(() => offerCloseChoice(attempt), 8000);
  // Let the desktop.quit IPC response settle before asking the UI to drain.
  setImmediate(() => {
    if (closeAttempt !== attempt) return;
    const wc = attempt.window.webContents;
    if (wc.isDestroyed() || wc.isCrashed() || !trustedContents(wc)) offerCloseChoice(attempt);
    else emit({ type: 'desktop.beforeClose', requestId: attempt.requestId });
  });
  return attempt;
}

async function quit(stopHost = false) {
  const attempt = beginClose({ stopHost, quitApp: true });
  return { quitting: true, pending: true, requestId: attempt?.requestId ?? null };
}

async function invokeLocal(method, payload) {
  if (method.startsWith('browser.')) return browsers.invoke(method, payload);
  if (method === 'desktop.notify') {
    if (!Notification.isSupported()) return { shown: false };
    const { title, body = '', target } = payload;
    const notification = new Notification({ title, body, silent: false });
    notification.on('click', () => {
      openMainWindow();
      emit({ type: 'desktop.notification', action: 'open', target });
    });
    notification.show();
    return { shown: true };
  }
  if (method === 'desktop.closeReady') {
    validateCloseReady(payload, closeAttempt?.requestId ?? null);
    const attempt = closeAttempt;
    if (attempt.finalizing || attempt.acknowledged) throw new Error('Cierre ya confirmado');
    attempt.acknowledged = true;
    clearTimeout(attempt.timer);
    // Reply before destroying the frame that is awaiting its acknowledgement.
    setImmediate(() => finishClose(attempt));
    return { accepted: true, requestId: attempt.requestId };
  }
  if (method === 'desktop.info') {
    let info = null;
    try { info = await deadline(hostInvoke('system.info'), 2500, 'Host no disponible'); }
    catch (error) { if (isHostTransportError(error)) hostStatus = { connected: false, error: error.message }; }
    return { platform: 'Linux', version: app.getVersion(), versions: { ...process.versions }, dataDir,
      packaged: app.isPackaged, host: { ...hostStatus, info }, hostPath };
  }
  if (method === 'desktop.quit') {
    if (payload.stopHost !== undefined && typeof payload.stopHost !== 'boolean') throw new Error('stopHost debe ser boolean');
    return quit(payload.stopHost === true);
  }
  if (method === 'desktop.openExternal') {
    await shell.openExternal(browserURL(payload.url, { external: true }));
    return { opened: true };
  }
  if (method === 'desktop.openPath' || method === 'desktop.previewImage') {
    const state = await hostInvoke('state.get');
    const roots = [];
    const canonicalData = await realpath(dataDir);
    for (const workspace of state.workspaces || []) {
      roots.push(workspace.canonicalPath || workspace.path);
      // Automation artifacts and the per-terminal worktrees (checkouts of this
      // same project) both live in the app's data tree.
      for (const area of ['automation', 'worktrees']) {
        try {
          validateID(workspace.id);
          const areaRoot = await realpath(path.join(dataDir, area, workspace.id));
          // A symlink planted in the state tree must not grant a new root.
          if (isWithin(areaRoot, canonicalData) && areaRoot !== canonicalData) roots.push(areaRoot);
        } catch { /* No known directory grants no access. */ }
      }
    }
    // Agent review captures live here, outside the project's source tree. Only
    // raster preview (never openPath or general file reads) gets this extra root.
    if (method === 'desktop.previewImage') return readLocalImage(payload.path, [...roots, '/tmp/opencode']);
    const target = await authorizedPath(payload.path, roots);
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return { opened: true, path: target };
  }
  if (method === 'dialog.openFolder' || method === 'dialog.openFile') {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: method === 'dialog.openFolder' ? 'Abrir proyecto' : 'Elegir archivo',
      properties: [method === 'dialog.openFolder' ? 'openDirectory' : 'openFile'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  }
  if (method === 'desktop.export') {
    let data = payload.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { throw new Error('Exportación debe contener JSON válido'); }
    }
    validateJSON(data, 16 * 1024 * 1024);
    if (!data || typeof data !== 'object') throw new Error('Exportación JSON debe ser un objeto o array');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar Phantom Workspace', defaultPath: 'phantom-workspace.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const destination = result.filePath.endsWith('.json') ? result.filePath : `${result.filePath}.json`;
    await writeFile(destination, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    });
    return { path: destination };
  }
  throw new Error('Método desktop no permitido');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady()) openMainWindow(); });
  app.on('activate', () => { if (app.isReady()) openMainWindow(); });
  // Desktop/session managers may request a graceful process termination by signal.
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    if (app.isReady()) quit().catch(error => console.error(error));
    else app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (mainWindow && !mainWindow.isDestroyed() && !approvedClose.has(mainWindow)) {
      event.preventDefault();
      beginClose({ quitApp: true });
      return;
    }
    quitting = true;
    if (agentBrowser) {
      event.preventDefault();
      const bridge = agentBrowser;
      agentBrowser = null;
      // Finish unlinking the private endpoint/socket before Electron exits.
      bridge.close().catch(error => console.error(error.message)).finally(() => app.quit());
      return;
    }
    browsers?.dispose();
    client?.close(); // Disconnect only: the daemon owns and keeps its sessions.
    client = null;
  });
  // Electron waits for the ESM entrypoint to settle before emitting ready; never
  // top-level-await whenReady() here (that deadlocks the main process).
  app.whenReady().then(async () => {
  uiSession = session.fromPartition('phantom-local-ui');
  configureUISession(uiSession);
  ipcMain.handle(INVOKE_CHANNEL, async (event, method, payload = {}) => {
    if (!isTrustedSender(event, mainWindow?.webContents, uiURL)) throw new Error('IPC rechazado: frame no autorizado');
    validateInvocation(method, payload);
    if (method === 'desktop.closeReady' && event.senderFrame !== closeAttempt?.frame) throw new Error('Frame de cierre no autorizado');
    if (method === 'host.shutdown') return quit(true);
    if (HOST_METHODS.has(method)) {
      if (['workspace.open', 'workspace.select', 'workspace.relocate', 'node.remove', 'storage.import'].includes(method)) browsers?.invalidate();
      return hostInvoke(method, payload);
    }
    return invokeLocal(method, payload);
  });
  const report = error => {
    const win = openMainWindow();
    if (win) dialog.showMessageBox(win, { type: 'error', message: 'No se pudo completar la acción', detail: error.message }).catch(() => {});
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Phantom Workspace', submenu: [
      { label: 'Abrir ventana', accelerator: 'CmdOrCtrl+Shift+N', click: () => openMainWindow() },
      { label: 'Cerrar ventana (conservar sesiones)', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.close() },
      { type: 'separator' },
      { label: 'Salir (conservar sesiones)', accelerator: 'CmdOrCtrl+Q', click: () => quit().catch(report) },
      { label: 'Detener host y salir', click: () => quit(true).catch(report) },
    ] },
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Ver', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
  ]));
   openMainWindow();
   agentBrowser = await startAgentBrowser({ dataDir, hostInvoke, getManager: () => browsers, emit,
     focusWindow: () => { openMainWindow(); } });
  hostInvoke('system.info').catch(error => emit({ type: 'desktop.host', connected: false, error: error.message }));
  }).catch(error => {
    console.error('Phantom desktop startup failed:', error);
    app.exit(1);
  });
}
