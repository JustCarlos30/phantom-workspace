import { WebContentsView, session } from 'electron';
import { browserURL, browserNode, clampBounds, validateID } from './security.mjs';

const securedSessions = new WeakSet();

// One visible view; up to eight live pages. Reclaiming a page never removes its source node.
// Runs inside the page (no closure access). Builds a short, stable CSS path for
// the element at a viewport point plus its visible text.
export function inspectPoint({ x, y }) {
  try {
    let el = document.elementFromPoint(x * innerWidth, y * innerHeight);
    if (!el) return { url: location.href, title: document.title };
    const esc = value => (window.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&'));
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 6; node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      if (node.id && document.querySelectorAll(`#${esc(node.id)}`).length === 1) { parts.unshift(`#${esc(node.id)}`); break; }
      if (tag === 'html' || tag === 'body') { parts.unshift(tag); break; }
      const testid = node.getAttribute('data-testid');
      if (testid) { parts.unshift(`${tag}[data-testid="${testid.replace(/"/g, '\\"')}"]`); break; }
      const classes = [...node.classList].filter(c => /^[a-zA-Z][\w-]{0,40}$/.test(c)).slice(0, 2).map(c => `.${esc(c)}`).join('');
      const siblings = node.parentElement ? [...node.parentElement.children].filter(child => child.tagName === node.tagName) : [];
      parts.unshift(`${tag}${classes}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''}`);
    }
    const label = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
    const text = (label || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return { url: location.href, title: document.title, element: { selector: parts.join(' > '), tag: el.tagName.toLowerCase(), text } };
  } catch { return { url: location.href, title: document.title }; }
}
export function inspectResult(result, wc) {
  const out = { url: String(result?.url || wc.getURL()).slice(0, 8192), title: String(result?.title ?? wc.getTitle()).slice(0, 1024) };
  const e = result?.element;
  if (e && typeof e.selector === 'string' && e.selector.trim() && typeof e.tag === 'string') {
    out.element = { selector: e.selector.slice(0, 1024), tag: e.tag.slice(0, 64), ...(typeof e.text === 'string' && e.text ? { text: e.text.slice(0, 500) } : {}) };
  }
  return out;
}

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
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.setAudioMuted(true);
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
    // Electron 45: the FIRST argument is Event<WebContentsConsoleMessageEventParams>.
    // Bound both individual strings and retained history; never expose a debugger.
    wc.on('console-message', details => {
      entry.console.push({ seq: ++entry.consoleSeq, level: String(details.level).slice(0, 32),
        message: String(details.message ?? '').slice(0, 2048), source: String(details.sourceId ?? '').slice(0, 1024),
        line: Number(details.lineNumber) || 0, timestamp: Date.now() });
      while (entry.console.length > 100) entry.console.shift();
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
    if (method !== 'browser.capture' && method !== 'browser.inspect' && (generation !== this.generation || panelVersion !== (this.panelVersions.get(payload.id) || 0))) return { stale: true };
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
    } else if (method === 'browser.inspect') {
      // Comment pin on a frozen preview: identify the element under a viewport
      // point. Only two numbers cross into the page; the function is fixed.
      const x = Number(payload.x), y = Number(payload.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error('Punto inválido');
      const result = await wc.executeJavaScript(`(${inspectPoint.toString()})(${JSON.stringify({ x, y })})`, true);
      return inspectResult(result, wc);
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

  // Internal automation surface only. Callers authenticate terminal/workspace in
  // agent-browser.mjs first; no renderer IPC or client-supplied JS reaches here.
  agentStatus(id) {
    const entry = this.entries.get(id);
    if (!entry || entry.view.webContents.isDestroyed()) return { id, attached: false, available: false };
    const wc = entry.view.webContents;
    return { id, workspaceId: entry.workspaceId, webContentsId: wc.id, attached: entry.attached,
      visible: entry.view.getVisible(), available: true, url: wc.getURL().slice(0, 8192), title: wc.getTitle().slice(0, 1024), loading: wc.isLoading() };
  }

  async agentInvoke(command, payload) {
    browserNode(await this.getState(), payload.id, payload.workspaceId);
    const entry = this.entries.get(payload.id);
    if (this.disposed || !entry || entry.workspaceId !== payload.workspaceId || entry.view.webContents.isDestroyed()) throw new Error('Panel browser no disponible; ejecuta preview');
    const wc = entry.view.webContents;
    if (command === 'console') return { id: entry.id, messages: entry.console.map(item => ({ ...item })), retained: 100, lastSeq: entry.consoleSeq };
    if (command === 'screenshot') {
      const image = await wc.capturePage(undefined, { stayHidden: true, stayAwake: false });
      if (image.isEmpty()) throw new Error('Sin captura renderizada');
      return image.toPNG();
    }
    if (!['read', 'click', 'fill'].includes(command)) throw new Error('Operación interna no permitida');
    // This fixed function is the entire page-side API. JSON encoding prevents CSS
    // selectors and input strings from ever becoming executable source.
    function pageOperation({ command, selector, value }) {
      try {
        const matches = selector ? document.querySelectorAll(selector) : null;
        if (command === 'read') {
          const element = selector ? matches[0] : document.body;
          if (!element) throw new Error('Selector sin coincidencias');
          const text = (element.innerText ?? element.textContent ?? '').slice(0, 32768);
          const controlSelector = 'input,textarea,select,button,a';
          const controls = [...(element.matches(controlSelector) ? [element] : []), ...element.querySelectorAll(controlSelector)].slice(0, 100).map(el => ({
            tag: el.tagName.toLowerCase(), id: el.id.slice(0, 256), name: (el.getAttribute('aria-label') || el.getAttribute('name') || '').slice(0, 256),
            text: (el.innerText || '').slice(0, 256), value: el.type === 'password' ? '[redacted]' : String(el.value ?? '').slice(0, 512),
          }));
          return { url: location.href.slice(0, 8192), title: document.title.slice(0, 1024), text, controls, truncated: text.length === 32768 };
        }
        if (matches.length !== 1) throw new Error('El selector debe identificar exactamente un elemento');
        const el = matches[0];
        if (!(el instanceof HTMLElement) || !el.getClientRects().length || getComputedStyle(el).visibility !== 'visible' || el.disabled) throw new Error('Elemento no interactuable');
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.focus();
        if (command === 'click') { el.click(); return { clicked: true }; }
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly ||
          (el instanceof HTMLInputElement && !['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'].includes(el.type))) throw new Error('El elemento no admite fill');
        const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { filled: true };
      } catch (error) { return { agentError: String(error.message || error).slice(0, 2048) }; }
    }
    const args = { command, ...(payload.selector !== undefined ? { selector: payload.selector } : {}), ...(command === 'fill' ? { value: payload.value } : {}) };
    const result = await wc.executeJavaScript(`(${pageOperation.toString()})(${JSON.stringify(args)})`, true);
    if (result?.agentError) throw new Error(result.agentError);
    return { id: entry.id, webContentsId: wc.id, ...result };
  }
}
