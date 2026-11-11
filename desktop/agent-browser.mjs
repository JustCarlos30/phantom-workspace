import net from 'node:net';
import path from 'node:path';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { browserURL, validateID, validateJSON } from './security.mjs';
import { bounded, browserEndpoint, browserError, MAX_RPC_BYTES, timeoutMs, waitForHTTP } from '../host/agent-browser.mjs';

const methods = new Set(['context', 'preview', 'open', 'status', 'read', 'click', 'fill', 'screenshot', 'console']);
const atDestination = (entry, url) => entry.view.webContents.getURL() === url
  || (entry.loadedURL === url && entry.loadedFinalURL === entry.view.webContents.getURL());
export function validateBrowserRequest(request) {
  validateJSON(request, MAX_RPC_BYTES);
  if (request.version !== 1 || !methods.has(request.method)) throw browserError('INVALID_METHOD', 'Método browser no permitido');
  if (Object.keys(request).some(k => !['version', 'method', 'params', 'workspaceId', 'terminalId', 'sessionId', 'token'].includes(k))) throw new Error('Campo RPC no permitido');
  for (const id of [request.workspaceId, request.terminalId, request.sessionId]) validateID(id);
  if (typeof request.token !== 'string' || !/^[a-f0-9]{64}$/.test(request.token)) throw browserError('ACCESS_DENIED', 'Credencial no válida');
  const p = request.params;
  if (!p || Array.isArray(p) || typeof p !== 'object') throw new Error('Parámetros no válidos');
  const allowed = ['id', 'key', 'timeoutMs', ...(['preview', 'open'].includes(request.method) ? ['url'] : []),
    ...(['read', 'click', 'fill'].includes(request.method) ? ['selector'] : []), ...(request.method === 'fill' ? ['value'] : [])];
  if (Object.keys(p).some(k => !allowed.includes(k))) throw new Error('Parámetro browser no permitido');
  timeoutMs(p.timeoutMs);
  if (p.id !== undefined) validateID(p.id);
  if (p.key !== undefined && (typeof p.key !== 'string' || !/^[\w.-]{1,128}$/.test(p.key))) throw new Error('Clave de idempotencia no válida');
  if (['preview', 'open'].includes(request.method)) p.url = browserURL(p.url, { external: true });
  if (p.selector !== undefined && (typeof p.selector !== 'string' || !p.selector.length || p.selector.length > 1024 || /[\u0000-\u001f\u007f]/.test(p.selector))) throw new Error('Selector no válido');
  if (['click', 'fill'].includes(request.method) && !p.selector) throw new Error('Selector requerido');
  if (request.method === 'fill' && (typeof p.value !== 'string' || p.value.length > 16000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(p.value))) throw new Error('Valor no válido');
  return request;
}

// Fixed, application-owned DOM program; agent supplies JSON data only. There is
// deliberately no API for source code, expressions, debugger commands or files.
function domOperation(method, selector, value) {
  const clean = text => String(text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 32000);
  const nodes = selector ? [...document.querySelectorAll(selector)].slice(0, 101) : [document.body];
  if (method === 'read') return { url: location.href, title: clean(document.title), text: clean(nodes.map(n => n?.innerText || n?.textContent || '').join('\n')),
    elements: [...(selector ? nodes : document.querySelectorAll('input,textarea,button,a,select'))].slice(0, 100).map(n => ({ tag: n.tagName,
      id: clean(n.id), text: clean(n.innerText || n.getAttribute('aria-label') || '').slice(0, 256),
      value: n.type === 'password' ? '[redacted]' : clean(n.value).slice(0, 1024) })), truncated: nodes.length > 100 };
  if (nodes.length !== 1) throw new Error('El selector debe identificar exactamente un elemento');
  const node = nodes[0], rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height || getComputedStyle(node).visibility === 'hidden' || node.disabled) throw new Error('Elemento no visible o deshabilitado');
  if (method === 'click') { node.scrollIntoView({ block: 'center' }); node.click(); return { clicked: true }; }
  if (!['INPUT', 'TEXTAREA'].includes(node.tagName) || node.readOnly || (node.tagName === 'INPUT' && !['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(node.type))) throw new Error('Solo se admite input de texto o textarea editable');
  const proto = node.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  return { filled: true };
}

export async function operateBrowserEntry(entry, method, params, { dataDir, signal }) {
  const wc = entry.view.webContents;
  if (signal.aborted) throw browserError('TIMEOUT', 'Petición caducada');
  if (method === 'status') return { id: entry.id, workspaceId: entry.workspaceId, webContentsId: wc.id,
    url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), visible: entry.attached && entry.view.getVisible() };
  if (method === 'console') return { id: entry.id, messages: [...entry.console], capacity: 200 };
  if (method === 'screenshot') {
    const image = await wc.capturePage(undefined, { stayHidden: true, stayAwake: false });
    if (image.isEmpty()) throw new Error('No hay captura renderizada disponible');
    if (signal.aborted) throw browserError('TIMEOUT', 'Petición caducada');
    const root = await realpath(dataDir);
    let dir = root;
    for (const component of ['automation', entry.workspaceId, 'browser', 'artifacts']) {
      dir = path.join(dir, component);
      try { await mkdir(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const stat = await lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(dir) !== dir) throw browserError('ACCESS_DENIED', 'Ruta de artifacts enlazada no permitida');
    }
    const destination = path.join(dir, `${randomUUID()}.png`);
    const file = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { if (signal.aborted) throw browserError('TIMEOUT', 'Petición caducada'); await file.writeFile(image.toPNG()); } finally { await file.close(); }
    return { id: entry.id, path: destination };
  }
  browserURL(wc.getURL(), { external: true });
  // JSON serialization (including U+2028/U+2029 escaping) cannot inject source.
  const args = JSON.stringify([method, params.selector ?? null, params.value ?? null]).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return wc.executeJavaScript(`(${domOperation.toString()})(...${args})`, true);
}

// Internal integrated-automation API: createAgentBrowserBridge({dataDir,
// getManager, hostInvoke, focus}) -> { start(), close(), invoke(request) }.
// invoke uses the same authenticated request schema as the Unix socket. It does
// not create a second browser. focus emits browser.agentFocus to the local UI;
// preview succeeds only once that UI has attached the matching native view.
export function createAgentBrowserBridge({ dataDir, getManager, hostInvoke, focus }) {
  let busy = false, server, stopping = false;
  const sockets = new Set();
  async function authenticate(r) {
    let capability;
    try {
      const filename = path.join(dataDir, 'browser-access', `${r.sessionId}.json`);
      const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 2048 || (stat.mode & 0o077)) throw new Error('private file required');
        capability = JSON.parse(await file.readFile('utf8'));
      } finally { await file.close(); }
    } catch { throw browserError('ACCESS_DENIED', 'Acceso browser no autorizado'); }
    if (capability.workspaceId !== r.workspaceId || capability.terminalId !== r.terminalId || capability.sessionId !== r.sessionId
      || typeof capability.token !== 'string' || capability.token.length !== r.token.length
      || !timingSafeEqual(Buffer.from(capability.token), Buffer.from(r.token))) throw browserError('ACCESS_DENIED', 'Identidad browser no autorizada');
    const sessions = await hostInvoke('terminal.list', { workspaceId: r.workspaceId });
    if (!sessions.some(s => s.id === r.sessionId && s.nodeId === r.terminalId && s.status === 'running')) throw browserError('ACCESS_DENIED', 'Sesión de terminal no activa');
  }
  async function perform(r, signal) {
    const check = () => { if (signal.aborted || stopping) throw browserError('TIMEOUT', 'Petición browser caducada'); };
    await authenticate(r); check();
    if (r.method === 'context') return { connected: true, transport: 'private-unix', methods: [...methods], maxTimeoutMs: 30000 };
    const manager = getManager();
    if (!manager || manager.disposed) throw browserError('DESKTOP_UNAVAILABLE', 'Ventana Electron no disponible');
    let state = await hostInvoke('state.get'); check();
    const workspace = state.workspaces.find(w => w.id === r.workspaceId);
    if (!workspace || state.activeWorkspaceId !== workspace.id) throw browserError('WORKSPACE_INACTIVE', 'Enfoca el proyecto de esta terminal antes de usar su navegador');
    const p = r.params, key = p.key || 'default';
    let node = p.id ? workspace.nodes.find(n => n.id === p.id && n.type === 'browser' && n.data?.agentTerminalId === r.terminalId)
      : workspace.nodes.find(n => n.type === 'browser' && n.data?.agentTerminalId === r.terminalId && n.data?.agentKey === key);
    if (p.id && !node) throw browserError('ACCESS_DENIED', 'Panel ajeno a esta terminal');
    if (['preview', 'open'].includes(r.method)) {
      await waitForHTTP(p.url, { timeoutMs: p.timeoutMs, signal }); check();
      if (!node) {
        node = await hostInvoke('node.create', { workspaceId: workspace.id, type: 'browser', title: 'Preview del agente',
          x: Math.max(0, ...workspace.nodes.map(n => n.x + n.width + 32)), y: 0,
          data: { url: p.url, agentTerminalId: r.terminalId, agentKey: key } });
      } else {
        const existing = manager.entries.get(node.id);
        const navigate = existing ? existing.lastRequestedURL !== p.url || !atDestination(existing, p.url) : node.data.url !== p.url;
        if (navigate || node.data.hidden) node = await hostInvoke('node.update', { workspaceId: workspace.id, id: node.id,
          patch: { data: { ...node.data, hidden: false, ...(navigate ? { url: p.url, agentRequest: randomUUID() } : {}) } } });
      }
      check();
      // Focus is retried while the renderer refreshes its durable state. No
      // hidden synthetic attachment can make a preview falsely report success.
      while (!signal.aborted) {
        check(); focus({ type: 'browser.agentFocus', workspaceId: workspace.id, id: node.id });
        const entry = manager.entries.get(node.id);
        if (entry?.lastRequestedURL === p.url && entry.loadError) throw browserError('NAVIGATION_FAILED', entry.loadError);
        if (entry?.attached && entry.view.getVisible() && entry.lastRequestedURL === p.url && !entry.view.webContents.isLoading()) {
          if (entry.loadError) throw browserError('NAVIGATION_FAILED', entry.loadError);
          if (atDestination(entry, p.url)) return operateBrowserEntry(entry, 'status', p, { dataDir, signal });
        }
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      check();
    }
    if (!node) throw browserError('NO_PANEL', 'Abre primero un preview desde esta terminal');
    const entry = manager.entries.get(node.id);
    if (!entry || entry.workspaceId !== workspace.id || entry.view.webContents.isDestroyed()) throw browserError('NO_VIEW', 'La vista no está activa; vuelve a abrir preview');
    check();
    return operateBrowserEntry(entry, r.method, p, { dataDir, signal });
  }
  async function invoke(request) {
    validateBrowserRequest(request);
    if (busy) throw browserError('BUSY', 'Navegador ocupado; reintenta al terminar la operación actual');
    busy = true;
    const controller = new AbortController(), ms = timeoutMs(request.params.timeoutMs);
    try { return await bounded(perform(request, controller.signal), ms); }
    finally { controller.abort(); busy = false; }
  }
  return { invoke,
    async start() {
      const endpoint = browserEndpoint(dataDir);
      if (Buffer.byteLength(endpoint) > 103) throw new Error('Ruta del socket browser demasiado larga');
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const dir = await lstat(dataDir);
      if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077)) throw new Error('El perfil browser debe ser privado (0700)');
      try {
        const stat = await lstat(endpoint);
        if (!stat.isSocket()) throw new Error('Endpoint browser ocupado por un archivo');
        const live = await new Promise(resolve => { const s = net.createConnection(endpoint); s.on('connect', () => { s.destroy(); resolve(true); }); s.on('error', () => resolve(false)); s.setTimeout(500, () => { s.destroy(); resolve(true); }); });
        if (live) throw new Error('Ya existe un puente browser activo');
        await unlink(endpoint);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      server = net.createServer(socket => {
        if (sockets.size >= 32) { socket.destroy(); return; }
        sockets.add(socket); const decoder = new StringDecoder('utf8'); let data = '', bytes = 0, handled = false;
        socket.setTimeout(32000, () => socket.destroy());
        socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
        socket.on('data', chunk => {
          if (handled) return;
          bytes += chunk.length;
          if (bytes > MAX_RPC_BYTES) { socket.destroy(); return; }
          data += decoder.write(chunk);
          if (!data.includes('\n')) return;
          handled = true;
          Promise.resolve().then(() => invoke(JSON.parse(data.slice(0, data.indexOf('\n')))))
            .then(result => socket.end(`${JSON.stringify({ result })}\n`), error => socket.end(`${JSON.stringify({ error: { code: error.code || 'BROWSER_ERROR', message: error.message } })}\n`));
        });
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
      await chmod(endpoint, 0o600);
    },
    close() { stopping = true; for (const socket of sockets) socket.destroy(); server?.close(); },
  };
}
