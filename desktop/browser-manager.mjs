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
    const entry = { id, workspaceId, view, attached: false, lastUsed: Date.now(), console: [], consoleSeq: 0 };
    this.entries.set(id, entry);
    const wc = view.webContents;
    wc.on('console-message', (_event, details) => {
      // Electron 45 supplies a details object. Keep a hard memory/output bound.
      entry.console.push({ seq: ++entry.consoleSeq, level: details.level,
        message: String(details.message || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 2000),
        timestamp: Date.now() });
      if (entry.console.length > 100) entry.console.shift();
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
        setImmediate(() => { if (!wc.isDestroyed()) wc.loadURL(safe).catch(error => this.send(entry, error.message)); });
      } catch { this.send(entry, 'Ventana bloqueada: URL no permitida'); }
      return { action: 'deny' };
    });
    for (const event of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      wc.on(event, () => { if (event === 'did-start-loading') entry.loadError = null; this.send(entry); });
    }
    wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) { entry.loadError = `${description} (${code})`; this.send(entry, entry.loadError); }
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
      wc.loadURL(browserURL(payload.url)).catch(error => this.send(entry, error.message));
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

  // Internal integrated automation API. Callers must authenticate and validate
  // command/payload first (desktop/agent-browser.mjs). Uses the exact UI-owned WC;
  // no debugger port, remote evaluate endpoint, or second browser session.
  async agentOperation(command, { id, workspaceId, selector, value }, signal) {
    browserNode(await this.getState(), id, workspaceId);
    signal?.throwIfAborted();
    const entry = this.entries.get(id);
    if (!entry || entry.workspaceId !== workspaceId || entry.view.webContents.isDestroyed()) throw new Error('Panel sin WebContents; vuelve a abrir preview');
    const wc = entry.view.webContents;
    if (command === 'status') return { id, workspaceId, webContentsId: wc.id, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), visible: entry.attached && entry.view.getVisible() };
    if (command === 'console') return { id, messages: entry.console.slice(), lastSeq: entry.consoleSeq };
    if (command === 'screenshot') {
      const image = await wc.capturePage(undefined, { stayHidden: true, stayAwake: false });
      if (image.isEmpty()) throw new Error('No hay captura renderizada disponible');
      return image.toPNG();
    }
    if (!['read', 'click', 'fill'].includes(command)) throw new Error('Operación DOM no permitida');
    // All source is application-owned. JSON arguments are data, never source.
    const operation = ({ command, selector, value }) => {
      const clean = text => String(text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
      let elements;
      try { elements = [...document.querySelectorAll(selector || 'body')]; }
      catch { throw new Error('Selector CSS inválido'); }
      if (!elements.length) throw new Error('No se encontró el elemento');
      if (command === 'read') return {
        url: location.href, title: document.title,
        text: clean(elements.slice(0, 20).map(el => el.innerText || el.textContent).join('\n')).slice(0, 24000),
        controls: [...document.querySelectorAll('input,textarea,button,select,a[href]')].slice(0, 100).map(el => ({
          tag: el.tagName.toLowerCase(), id: clean(el.id).slice(0, 200), name: clean(el.getAttribute('aria-label') || el.name || el.textContent).slice(0, 200),
          value: el.type === 'password' ? '[redacted]' : clean(el.value).slice(0, 1000),
        })),
      };
      if (elements.length !== 1) throw new Error('El selector debe identificar un único elemento');
      const el = elements[0], style = getComputedStyle(el), rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || style.visibility !== 'visible' || style.display === 'none' || el.disabled || el.closest('[inert]')) throw new Error('Elemento no interactuable');
      el.scrollIntoView({ block: 'center' }); el.focus();
      if (command === 'click') el.click();
      else {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly || (el instanceof HTMLInputElement && !['text','search','email','url','tel','password','number'].includes(el.type))) throw new Error('fill requiere input de texto o textarea editable');
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: true };
    };
    return wc.executeJavaScript(`(${operation.toString()})(${JSON.stringify({ command, selector, value })})`, true);
  }
}
