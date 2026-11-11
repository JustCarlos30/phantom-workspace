import net from 'node:net';
import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, realpath, readFile, writeFile, chmod, lstat, unlink } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { validateAgentRequest, validateID, isWithin } from './security.mjs';
import { waitForHTTP, timeoutValue, withTimeout, MAX_REQUEST, MAX_RESPONSE } from '../host/agent-browser.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Integration API: createAgentBrowserAPI({getManager, hostInvoke, emit, focusWindow,
// dataDir}).invoke(method, payload, {workspaceId, terminalId}). The trusted caller
// supplies identity; the socket wrapper authenticates it. preview waits for HTTP,
// selects the workspace, persists/reuses a node and waits for real UI attachment.
// Internal automation can reuse this API + waitForHTTP without opening any browser.
export function createAgentBrowserAPI({ getManager, hostInvoke, emit, focusWindow, dataDir }) {
  let previewQueue = Promise.resolve();
  async function perform(method, payload, identity, signal) {
    const timeoutMs = timeoutValue(payload.timeoutMs), end = Date.now() + timeoutMs;
    const remaining = () => { signal?.throwIfAborted(); if (Date.now() >= end) throw new Error('Timeout del panel Electron'); return end - Date.now(); };
    validateAgentRequest(method, payload);
    validateID(identity.workspaceId); validateID(identity.terminalId);
    const state = await hostInvoke('state.get');
    remaining();
    const ws = state.workspaces.find(w => w.id === identity.workspaceId);
    if (!ws?.nodes.some(n => n.id === identity.terminalId && n.type === 'terminal')) throw new Error('Identidad workspace/terminal no autorizada');
    const sessions = await hostInvoke('terminal.list', { workspaceId: ws.id });
    remaining();
    if (!sessions.some(s => s.nodeId === identity.terminalId && s.status === 'running')) throw new Error('Terminal no activa');
    const key = payload.key || 'default';
    let node = ws.nodes.find(n => n.type === 'browser' && n.data?.agentBrowser?.terminalId === identity.terminalId
      && (payload.id ? n.id === payload.id : n.data.agentBrowser.key === key));
    if (payload.id && !node) throw new Error('Panel no autorizado para esta terminal');
    if (method === 'preview') {
      await waitForHTTP(payload.url, { timeoutMs: Math.max(100, remaining()), signal });
      remaining();
      if (state.activeWorkspaceId !== ws.id) await hostInvoke('workspace.select', { id: ws.id });
      remaining();
      if (!node) {
        node = await hostInvoke('node.create', { workspaceId: ws.id, type: 'browser', title: `Preview · ${new URL(payload.url).host}`,
          x: Math.max(0, ...ws.nodes.map(n => n.x + n.width + 32)), y: 0, width: 800, height: 520,
          data: { url: payload.url, agentBrowser: { terminalId: identity.terminalId, key } } });
      } else if (node.data.hidden || node.data.url !== payload.url) {
        node = await hostInvoke('node.update', { workspaceId: ws.id, id: node.id,
          patch: { data: { ...node.data, hidden: false, url: payload.url } } });
      }
      remaining();
      focusWindow();
      let lastFocus = 0;
      while (true) {
        remaining();
        if (Date.now() - lastFocus > 250) { emit({ type: 'browser.agentFocus', workspaceId: ws.id, id: node.id }); lastFocus = Date.now(); }
        const manager = getManager(), entry = manager?.entries.get(node.id);
        if (entry?.attached && entry.view.getVisible()) break;
        await delay(40);
      }
      const manager = getManager(), entry = manager.agentEntry(node.id, ws.id), wc = entry.view.webContents;
      const url = new URL(payload.url).href;
      // Initial attachment may still be committing its first load. Avoid aborting
      // that load (and its UI intent) by dispatching the same destination twice.
      while (wc.isLoading()) { remaining(); await delay(40); }
      if (wc.getURL() !== url) {
        entry.lastRequestedURL = url;
        await withTimeout(wc.loadURL(url), remaining(), 'Timeout de navegación Electron');
      }
      while (wc.isLoading()) { remaining(); await delay(40); }
      remaining();
      if (entry.loadError) throw new Error(`Navegación Electron: ${entry.loadError}`);
      if (wc.getURL() !== url && !/^https?:/.test(wc.getURL())) throw new Error('Navegación Electron fallida');
      return manager.agentStatus(node.id, ws.id);
    }
    if (!node) throw new Error('No hay preview para esta terminal/clave; usa preview primero');
    if (state.activeWorkspaceId !== ws.id) throw new Error('Workspace inactivo; usa preview para mostrarlo');
    const manager = getManager();
    if (!manager) throw new Error('Ventana Electron no disponible');
    const entry = manager.agentEntry(node.id, ws.id);
    if (method === 'status') return manager.agentStatus(node.id, ws.id);
    if (method === 'console') return { id: node.id, messages: entry.console.slice() };
    if (['read', 'click', 'fill'].includes(method)) return manager.agentDOM(method, { ...payload, id: node.id, workspaceId: ws.id });
    if (method === 'screenshot') {
      const root = await realpath(dataDir), dir = path.join(root, 'automation', ws.id, 'artifacts');
      let parent = root;
      for (const component of ['automation', ws.id, 'artifacts']) {
        parent = path.join(parent, component);
        await mkdir(parent, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        if (await realpath(parent) !== parent) throw new Error('Directorio de artifacts no autorizado');
      }
      const canonical = await realpath(dir);
      if (canonical !== dir || !isWithin(canonical, root)) throw new Error('Directorio de artifacts no autorizado');
      const image = await entry.view.webContents.capturePage(undefined, { stayHidden: true, stayAwake: false });
      if (image.isEmpty()) throw new Error('Captura Electron vacía; enfoca el panel');
      remaining();
      const destination = path.join(canonical, payload.name || `browser-${randomUUID()}.png`);
      await writeFile(destination, image.toPNG(), { mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW });
      return { id: node.id, path: destination };
    }
  }
  return { invoke(method, payload = {}, identity, { signal } = {}) {
    validateAgentRequest(method, payload);
    const ms = timeoutValue(payload.timeoutMs);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const run = () => { controller.signal.throwIfAborted(); return perform(method, payload, identity, controller.signal); };
    const task = method === 'preview' ? previewQueue.then(run) : run();
    if (method === 'preview') previewQueue = task.catch(() => {});
    return withTimeout(task, ms, `Timeout de ${method} (${ms}ms); la operación puede seguir en curso`).finally(() => {
      controller.abort(); signal?.removeEventListener('abort', abort);
    });
  } };
}

export async function startAgentBrowserBridge(options) {
  const dir = path.join(options.dataDir, 'agent-browser');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (await realpath(dir) !== path.join(await realpath(options.dataDir), 'agent-browser')) throw new Error('Directorio RPC no autorizado');
  await chmod(dir, 0o700);
  const socketPath = path.join(dir, 'rpc.sock');
  try {
    const stat = await lstat(socketPath);
    if (!stat.isSocket()) throw new Error('Ruta RPC ocupada por un archivo');
    // Single-instance lock is held by desktop/main before reaching this function.
    await unlink(socketPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const api = createAgentBrowserAPI(options), clients = new Set();
  let active = 0;
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    if (clients.size >= 16) { socket.destroy(); return; }
    clients.add(socket);
    const controller = new AbortController();
    let bytes = 0, text = '', started = false;
    socket.setTimeout(35_000, () => socket.destroy());
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('close', () => { clients.delete(socket); controller.abort(); });
    const reply = value => {
      if (socket.destroyed) return;
      const json = JSON.stringify(value);
      socket.end(`${Buffer.byteLength(json) <= MAX_RESPONSE ? json : JSON.stringify({ ok: false, error: 'Respuesta demasiado grande' })}\n`);
    };
    socket.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_REQUEST || started) { socket.destroy(); return; }
      text += chunk.toString('utf8');
    });
    socket.on('end', async () => {
      if (started) return;
      started = true;
      if (active >= 8) { reply({ ok: false, error: 'Puente ocupado; reintenta explícitamente' }); return; }
      active++;
      try {
        const request = JSON.parse(text);
        if (Object.keys(request).some(k => !['method', 'payload', 'auth'].includes(k))) throw new Error('Solicitud no permitida');
        const auth = request.auth;
        validateID(auth?.terminalId); validateID(auth?.workspaceId);
        if (typeof auth.token !== 'string' || !/^[a-f0-9]{64}$/.test(auth.token)) throw new Error('Acceso no autorizado');
        const credential = path.join(dir, `${auth.terminalId}.json`);
        const stat = await lstat(credential);
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Credencial no privada');
        const saved = JSON.parse(await readFile(credential, 'utf8'));
        if (saved.workspaceId !== auth.workspaceId || saved.terminalId !== auth.terminalId || typeof saved.token !== 'string'
          || saved.token.length !== auth.token.length || !timingSafeEqual(Buffer.from(saved.token), Buffer.from(auth.token))) throw new Error('Acceso no autorizado');
        const result = await api.invoke(request.method, request.payload, auth, { signal: controller.signal });
        reply({ ok: true, result });
      } catch (error) { reply({ ok: false, error: error.message }); }
      finally { active--; }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  return { api, socketPath, close() { for (const socket of clients) socket.destroy(); server.close(); } };
}
