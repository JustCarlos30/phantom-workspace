import { WebContentsView, session } from 'electron';
import { browserURL, browserNode, clampBounds, validateID } from './security.mjs';

const securedSessions = new WeakSet();

// One visible view; up to eight live pages. Reclaiming a page never removes its source node.
export class BrowserManager {
  constructor({ window, getState, emit, maxViews = 8 }) {
    this.window = window;
    this.getState = getState;
    this.emit = emit;
    this.maxViews = maxViews;
    this.entries = new Map();
    this.generation = 0;
    this.panelVersions = new Map();
    this.disposed = false;
    this.queue = Promise.resolve();
    this.resize = () => {
      for (const entry of this.entries.values()) if (entry.attached) this.position(entry, entry.requestedBounds);
    };
    window.on('resize', this.resize);
  }

  send(entry, error) {
    const wc = entry.view.webContents;
    if (wc.isDestroyed() || this.disposed) return;
    this.emit({ type: 'browser.state', id: entry.id, workspaceId: entry.workspaceId,
      url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(),
      ...(error ? { error } : {}),
    });
  }

  hide(entry) {
    // Keep the bounded, hidden view parented so Chromium retains its compositor
    // surface for a truthful overview capture. Eviction/disposal removes it.
    entry.view.setVisible(false);
    entry.attached = false;
    entry.view.webContents.setAudioMuted(true);
  }

  invalidate() {
    // Invalidate in-flight attachments synchronously, before awaiting host state.
    this.generation++;
    for (const entry of this.entries.values()) this.hide(entry);
  }

  async reconcile() {
    const state = await this.getState();
    if (this.disposed) return;
    for (const entry of this.entries.values()) {
      const ws = state.workspaces?.find(item => item.id === entry.workspaceId);
      if (!ws?.nodes?.some(node => node.id === entry.id && node.type === 'browser')) this.destroy(entry);
      else if (state.activeWorkspaceId !== entry.workspaceId) this.hide(entry);
    }
  }

  destroy(entry) {
    this.hide(entry);
    if (entry.parented && !this.window.isDestroyed()) this.window.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close({ waitForBeforeUnload: false });
    this.entries.delete(entry.id);
  }

  position(entry, bounds) {
    entry.requestedBounds = bounds;
    const [width, height] = this.window.getContentSize();
    const clipped = clampBounds(bounds, { width, height });
    entry.view.setBounds(clipped);
    entry.view.setVisible(entry.attached && clipped.width > 0 && clipped.height > 0);
    return clipped;
  }

  create(id, workspaceId) {
    if (this.entries.size >= this.maxViews) {
      const oldest = [...this.entries.values()].filter(entry => !entry.attached).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!oldest) throw new Error('Límite de navegadores activos alcanzado');
      this.destroy(oldest);
    }
    const partition = `persist:phantom-workspace-${workspaceId.toLowerCase()}`;
    const isolated = session.fromPartition(partition);
    if (!securedSessions.has(isolated)) {
      isolated.setPermissionCheckHandler(() => false);
      isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      isolated.setDevicePermissionHandler(() => false);
      isolated.setDisplayMediaRequestHandler((_request, callback) => callback(null));
      isolated.on('will-download', event => event.preventDefault());
      securedSessions.add(isolated);
    }
    const view = new WebContentsView({ webPreferences: {
      partition, contextIsolation: true, sandbox: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false,
    } });
    view.setVisible(false);
    const entry = { id, workspaceId, view, attached: false, lastUsed: Date.now(), console: [], loadError: null };
    this.entries.set(id, entry);
    const wc = view.webContents;
    wc.on('console-message', (_event, details, message, lineNumber, sourceId) => {
      const item = typeof details === 'object' ? details : { level: details, message, lineNumber, sourceId };
      const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 512);
      entry.console.push({ level: clean(item.level), message: clean(item.message), line: item.lineNumber,
        source: clean(item.sourceId), time: Date.now() });
      if (entry.console.length > 200) entry.console.shift();
    });
    wc.on('did-start-navigation', event => { if (event.isMainFrame) entry.loadError = null; });
    wc.on('did-finish-load', () => {
      entry.loadedURL = entry.requestedNavigation;
      entry.loadedFinalURL = wc.getURL();
      entry.requestedNavigation = null;
    });
    const guard = event => {
      try { browserURL(event.url); } catch { event.preventDefault(); this.send(entry, 'Navegación bloqueada: solo HTTP(S) o about:blank'); }
    };
    wc.on('will-navigate', guard);
    wc.on('will-frame-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-attach-webview', event => event.preventDefault());
    wc.on('content-bounds-updated', event => event.preventDefault());
    // Popups stay in the same isolated panel. Never hand remote URLs to the OS.
    wc.setWindowOpenHandler(({ url }) => {
      try {
        const safe = browserURL(url);
        setImmediate(() => { if (!wc.isDestroyed()) { entry.requestedNavigation = safe; wc.loadURL(safe).catch(error => this.send(entry, error.message)); } });
      } catch { this.send(entry, 'Ventana bloqueada: URL no permitida'); }
      return { action: 'deny' };
    });
    for (const event of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      wc.on(event, () => this.send(entry));
    }
    wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) entry.loadError = `${description} (${code})`;
      if (mainFrame && code !== -3) this.send(entry, `${description} (${code})`);
    });
    wc.on('render-process-gone', (_event, details) => this.send(entry, `Navegador detenido: ${details.reason}`));
    return entry;
  }

  invoke(method, payload) {
    // Detach takes effect immediately, even when an earlier attach is awaiting state.
    if (method === 'browser.detach' || (method === 'browser.bounds' && payload.visible === false)) {
      validateID(payload.id);
      this.panelVersions.set(payload.id, (this.panelVersions.get(payload.id) || 0) + 1);
      const entry = this.entries.get(payload.id);
      if (entry) this.hide(entry);
      return Promise.resolve({ detached: true });
    }
    const generation = this.generation;
    const panelVersion = this.panelVersions.get(payload.id) || 0;
    const task = this.queue.then(() => this.perform(method, payload, generation, panelVersion));
    this.queue = task.catch(() => {});
    return task;
  }

  async perform(method, payload, generation, panelVersion) {
    if (this.disposed) throw new Error('Ventana cerrada');
    validateID(payload.id);
    let entry = this.entries.get(payload.id);
    const workspaceId = payload.workspaceId ?? entry?.workspaceId;
    const state = await this.getState();
    if (this.disposed) throw new Error('Ventana cerrada');
    if (method !== 'browser.capture' && (generation !== this.generation || panelVersion !== (this.panelVersions.get(payload.id) || 0))) return { stale: true };
    browserNode(state, payload.id, workspaceId);
    if (entry && entry.workspaceId !== workspaceId) throw new Error('Panel de otro proyecto');
    if (method === 'browser.attach') {
      const url = browserURL(payload.url ?? 'about:blank');
      clampBounds(payload.bounds, { width: 1, height: 1 });
      if (payload.visible !== true) {
        if (entry) this.hide(entry);
        return { attached: false };
      }
      for (const other of this.entries.values()) if (other !== entry) this.hide(other);
      entry ??= this.create(payload.id, workspaceId);
      if (!entry.parented) {
        this.window.contentView.addChildView(entry.view);
        entry.parented = true;
      }
      entry.attached = true;
      entry.lastUsed = Date.now();
      entry.view.webContents.setAudioMuted(false);
      const bounds = this.position(entry, payload.bounds);
      // Reattachment must not reset a user's navigation/history to the stored source URL.
      const currentURL = entry.view.webContents.getURL();
      if (!currentURL || (entry.lastRequestedURL !== url && currentURL !== url)) {
        entry.requestedNavigation = url;
        entry.view.webContents.loadURL(url).catch(error => this.send(entry, error.message));
      }
      entry.lastRequestedURL = url;
      this.send(entry);
      return { attached: true, bounds };
    }
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('Adjunta el navegador antes de usarlo');
    entry.lastUsed = Date.now();
    const wc = entry.view.webContents;
    if (method === 'browser.bounds') {
      // A late ResizeObserver cannot resurrect a hidden view. Only attach can show it.
      if (!entry.attached) return { attached: false };
      return { bounds: this.position(entry, payload.bounds), attached: true };
    }
    if (method === 'browser.navigate') {
      entry.lastRequestedURL = browserURL(payload.url);
      entry.requestedNavigation = entry.lastRequestedURL;
      wc.loadURL(entry.lastRequestedURL).catch(error => this.send(entry, error.message));
    } else if (method === 'browser.back') {
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    } else if (method === 'browser.forward') {
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    } else if (method === 'browser.reload') wc.reload();
    else if (method === 'browser.capture') {
      let image;
      try { image = await wc.capturePage(undefined, { stayHidden: true, stayAwake: false }); }
      catch { throw new Error('No hay una captura renderizada disponible; enfoca la página y vuelve a intentar'); }
      if (image.isEmpty()) throw new Error('No hay una captura renderizada disponible');
      return { dataUrl: image.toDataURL() };
    } else throw new Error('Método browser no permitido');
    this.send(entry);
    return { ok: true };
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.window.removeListener('resize', this.resize);
    for (const entry of this.entries.values()) this.destroy(entry);
  }
}
