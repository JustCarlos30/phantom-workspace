import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { credentialFile, endpointFile, privateJSON, timeoutValue, waitForHTTP } from '../host/agent-browser.mjs';
import { browserURL, browserKey, validateID, validateJSON, isWithin } from './security.mjs';

export function validateBrowserRequest(command, payload) {
  const fields = { context: [], status: ['key'], preview: ['url', 'key', 'timeoutMs'], open: ['url', 'key', 'timeoutMs'],
    read: ['key', 'selector'], click: ['key', 'selector'], fill: ['key', 'selector', 'value'], screenshot: ['key'], console: ['key'] };
  if (!Object.hasOwn(fields, command)) throw new Error('Comando browser no permitido');
  validateJSON(payload, 32768);
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' || Object.keys(payload).some(k => !fields[command].includes(k))) throw new Error('Opciones browser no válidas');
  const key = browserKey(payload.key);
  if (['preview', 'open'].includes(command)) { browserURL(payload.url, { external: true }); timeoutValue(payload.timeoutMs); }
  if (['click', 'fill'].includes(command) || payload.selector !== undefined) {
    if (typeof payload.selector !== 'string' || !payload.selector.trim() || payload.selector.length > 2048 || payload.selector.includes('\0')) throw new Error('Selector CSS no válido');
  }
  if (command === 'fill' && (typeof payload.value !== 'string' || payload.value.length > 16384 || payload.value.includes('\0'))) throw new Error('Valor de input no válido');
  return key;
}

// Host-owned private directories, no caller-selected paths. Exclusive/no-follow
// writes; at most 16 PNGs / 64MiB per workspace, 8MiB per capture.
export function saveBrowserArtifact(dataDir, workspaceId, bytes) {
  validateID(workspaceId);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Captura excede el límite de 8MiB');
  const canonical = fs.realpathSync(dataDir);
  let dir = canonical;
  for (const name of ['browser-artifacts', workspaceId]) {
    dir = path.join(dir, name);
    try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) || !isWithin(fs.realpathSync(dir), canonical)) throw new Error('Ruta de artefactos no autorizada');
  }
  const files = fs.readdirSync(dir).map(name => {
    if (!/^[0-9a-f-]{36}\.png$/.test(name)) throw new Error('Contenido de artefactos no válido');
    const filename = path.join(dir, name), stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Artefacto no válido');
    return { filename, size: stat.size, time: stat.mtimeMs };
  }).sort((a, b) => a.time - b.time);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  while (files.length >= 16 || total + bytes.length > 64 * 1024 * 1024) {
    const oldest = files.shift(); fs.unlinkSync(oldest.filename); total -= oldest.size;
  }
  const filename = path.join(dir, `${randomUUID()}.png`);
  fs.writeFileSync(filename, bytes, { mode: 0o600, flag: fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW });
  return { path: filename, bytes: bytes.length, mimeType: 'image/png' };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const limited = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Operación navegador timeout')), ms); })]).finally(() => clearTimeout(timer));
};

// Private newline-JSON RPC, deliberately separate from renderer IPC and host RPC.
// Authentication is rechecked per request against a live PTY and its capability.
// The endpoint is published only after listen; close removes only our own files.
export async function startAgentBrowser({ dataDir, hostInvoke, getManager, emit, focusWindow }) {
  const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-browser-'));
  fs.chmodSync(socketDir, 0o700);
  const socketPath = path.join(socketDir, 'rpc.sock');
  const descriptor = endpointFile(dataDir), instanceId = randomUUID();
  const sockets = new Set(), busy = new Set();
  const abort = new AbortController();
  async function authenticate(request) {
    validateID(request.sessionId); validateID(request.workspaceId);
    const capability = privateJSON(credentialFile(dataDir, request.sessionId));
    const a = Buffer.from(typeof request.token === 'string' ? request.token : ''), b = Buffer.from(capability.token);
    if (a.length !== b.length || !timingSafeEqual(a, b) || capability.workspaceId !== request.workspaceId) throw new Error('Acceso browser no autorizado');
    // A live PTY, or a chat card (Claude/OpenCode/Codex) with a turn in progress.
    const sessions = await hostInvoke('terminal.list', { workspaceId: request.workspaceId });
    const live = sessions.some(s => s.id === request.sessionId && s.nodeId === capability.nodeId && s.status === 'running')
      || (await hostInvoke('chat.browser.active', { workspaceId: request.workspaceId, sessionId: request.sessionId, nodeId: capability.nodeId }).catch(() => null))?.active === true;
    if (!live) throw new Error('Terminal browser no activa');
    const state = await hostInvoke('state.get');
    const workspace = state.workspaces.find(w => w.id === request.workspaceId);
    if (!workspace || state.activeWorkspaceId !== workspace.id) throw new Error('El navegador requiere el proyecto activo de la terminal');
    return workspace;
  }
  async function perform(request) {
    const { command, payload = {}, sessionId, workspaceId } = request;
    const key = validateBrowserRequest(command, payload);
    let workspace = await authenticate(request);
    abort.signal.throwIfAborted();
    if (command === 'context') return { available: true, workspaceId, sessionId, cli: 'node "$PHANTOM_BROWSER_CLI" help',
      commands: ['preview', 'open', 'status', 'read', 'click', 'fill', 'screenshot', 'console'],
      panels: workspace.nodes.filter(n => n.type === 'browser' && n.data?.agentTerminal === sessionId).map(n => ({ id: n.id, key: n.data.agentKey, url: n.data.url })) };
    if (busy.has(sessionId)) throw new Error('La terminal ya tiene una operación browser en curso');
    busy.add(sessionId);
    try {
      let node = workspace.nodes.find(n => n.type === 'browser' && n.data?.agentTerminal === sessionId && n.data?.agentKey === key);
      const manager = getManager();
      if (!manager || manager.disposed) throw new Error('Ventana Electron no disponible');
      if (['preview', 'open'].includes(command)) {
        const { url } = await waitForHTTP(payload.url, { timeoutMs: payload.timeoutMs, signal: abort.signal });
        workspace = await authenticate(request);
        abort.signal.throwIfAborted();
        node = workspace.nodes.find(n => n.type === 'browser' && n.data?.agentTerminal === sessionId && n.data?.agentKey === key);
        const reused = Boolean(node);
        if (!node) {
          if (workspace.nodes.filter(n => n.data?.agentTerminal === sessionId).length >= 8) throw new Error('Límite de paneles browser por terminal');
          node = await hostInvoke('node.create', { workspaceId, type: 'browser', title: `Preview · ${key}`,
            data: { url, agentTerminal: sessionId, agentKey: key } });
        } else if (node.data.hidden) node = await hostInvoke('node.update', { workspaceId, id: node.id, patch: { data: { ...node.data, hidden: false } } });
        focusWindow();
        const end = Date.now() + 10000;
        let entry;
        do {
          abort.signal.throwIfAborted();
          emit({ type: 'browser.agentFocus', id: node.id, workspaceId });
          entry = manager.entries.get(node.id);
          if (entry?.attached && !entry.view.webContents.isLoading() && entry.view.webContents.getURL()) break;
          await sleep(100);
        } while (Date.now() < end);
        if (!entry?.attached || entry.view.webContents.isLoading()) throw new Error('Timeout esperando panel visible');
        await authenticate(request);
        abort.signal.throwIfAborted();
        const wc = entry.view.webContents;
        if (wc.getURL() !== url) {
          entry.lastRequestedURL = url;
          await limited(wc.loadURL(url), 10000);
        }
        manager.send(entry);
        return { ...manager.agentStatus(node.id), key, reused, ready: true };
      }
      if (!node) throw new Error('Sin panel para terminal/key: ejecuta preview primero');
      if (command === 'status') return { ...manager.agentStatus(node.id), key };
      // No alternate/headless page: every operation resolves the manager's entry.
      await authenticate(request);
      abort.signal.throwIfAborted();
      const result = await limited(manager.agentInvoke(command, { ...payload, id: node.id, workspaceId }), 10000);
      return command === 'screenshot' ? { ...saveBrowserArtifact(dataDir, workspaceId, result), id: node.id } : result;
    } finally { busy.delete(sessionId); }
  }
  const server = net.createServer(socket => {
    if (sockets.size >= 16) { socket.destroy(); return; }
    sockets.add(socket); socket.setEncoding('utf8'); socket.setTimeout(75000, () => socket.destroy());
    let buffer = '', received = false;
    socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    socket.on('data', chunk => {
      if (received) { socket.destroy(); return; }
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 65536) { socket.destroy(); return; }
      const index = buffer.indexOf('\n'); if (index < 0) return;
      received = true;
      const reply = value => { if (!socket.destroyed) socket.end(JSON.stringify(value) + '\n'); };
      Promise.resolve().then(() => {
        if (buffer.slice(index + 1).trim()) throw new Error('Una petición por conexión');
        return perform(JSON.parse(buffer.slice(0, index)));
      }).then(result => reply({ result }), error => reply({ error: error.message }));
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    fs.chmodSync(socketPath, 0o600);
    const temporary = descriptor + '.' + instanceId;
    fs.writeFileSync(temporary, JSON.stringify({ socketPath, instanceId, version: 1 }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, descriptor);
  } catch (error) { server.close(); fs.rmSync(socketDir, { recursive: true, force: true }); throw error; }
  return { socketPath, async close() {
    abort.abort();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    try { if (privateJSON(descriptor).instanceId === instanceId) fs.unlinkSync(descriptor); } catch { /* Already removed. */ }
    fs.rmSync(socketDir, { recursive: true, force: true });
  } };
}
