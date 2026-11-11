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
    const entry = { id, workspaceId, view, attached: false, lastUsed: Date.now(), console: [], consoleBytes: 0 };
    this.entries.set(id, entry);
    const wc = view.webContents;
    wc.on('console-message', (_event, details) => {
      const message = { level: String(details.level).slice(0, 20), message: String(details.message).slice(0, 2000),
        timestamp: new Date().toISOString() };
      entry.console.push(message);
      entry.consoleBytes += Buffer.byteLength(JSON.stringify(message));
      while (entry.console.length > 100 || entry.consoleBytes > 64 * 1024) entry.consoleBytes -= Buffer.byteLength(JSON.stringify(entry.console.shift()));
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
      wc.on(event, () => this.send(entry));
    }
    wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) { entry.loadError = `${description} (${code})`; this.send(entry, entry.loadError); }
    });
    wc.on('did-start-loading', () => { entry.loadError = null; });
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

  // Internal automation API for the next child. These methods operate ONLY on
  // the existing Electron-owned WebContentsView, never a Playwright browser.
  // Caller must authorize workspace/node first (agent RPC does so on every call).
  // No source-code argument is supported; DOM programs below are fixed here.
  agentEntry(id, workspaceId) {
    const entry = this.entries.get(id);
    if (this.disposed || !entry || entry.workspaceId !== workspaceId || entry.view.webContents.isDestroyed()) throw new Error('Panel no adjunto; usa preview con la UI disponible');
    return entry;
  }

  agentStatus(id, workspaceId) {
    const entry = this.agentEntry(id, workspaceId), wc = entry.view.webContents;
    return { id, workspaceId, webContentsId: wc.id, url: wc.getURL(), title: wc.getTitle(),
      loading: wc.isLoading(), visible: entry.attached && entry.view.getVisible() };
  }

  async agentDOM(method, { id, workspaceId, selector, value }) {
    const wc = this.agentEntry(id, workspaceId).view.webContents;
    // JSON serialization prevents selector/value interpolation from becoming JS.
    // First matching element only; no frames, file inputs, contenteditable or eval.
    const data = JSON.stringify({ method, selector: selector ?? 'body', value }).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    // Electron may replace thrown renderer exceptions with a generic message.
    // Return fixed error codes as data, then construct the diagnostic in main.
    const reply = await wc.executeJavaScript(`(({method,selector,value}) => {
      const fail = error => ({ ok: false, error });
      const success = result => ({ ok: true, result });
      let element;
      try { element = document.querySelector(selector); } catch { return fail('invalid-selector'); }
      if (!element) return fail('missing-element');
      if (method === 'read') return success({ text: (element.innerText ?? element.textContent ?? '').slice(0,16000), truncated: (element.innerText ?? element.textContent ?? '').length > 16000 });
      if (!(element instanceof HTMLElement) || element.matches(':disabled') || !element.getClientRects().length) return fail('not-interactable');
      if (method === 'click') { if (element instanceof HTMLInputElement && element.type === 'file') return fail('file-input'); element.click(); return success({ clicked: true }); }
      if (method === 'fill') {
        const input = element instanceof HTMLInputElement, area = element instanceof HTMLTextAreaElement;
        if ((!input && !area) || element.readOnly || (input && !['text','search','email','url','tel','password','number'].includes(element.type))) return fail('not-editable');
        const prototype = input ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);
        element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true}));
        return success({ filled: true });
      }
      return fail('unsupported-action');
    })(${data})`, true);
    const errors = {
      'invalid-selector': 'Selector CSS no válido',
      'missing-element': 'Elemento no encontrado',
      'not-interactable': 'Elemento no interactuable',
      'file-input': 'Input file no permitido',
      'not-editable': 'Input no editable',
      'unsupported-action': 'Acción DOM no permitida',
    };
    if (reply?.ok !== true) throw new Error(Object.hasOwn(errors, reply?.error) ? errors[reply.error] : 'Respuesta DOM no válida');
    return reply.result;
  }
}
