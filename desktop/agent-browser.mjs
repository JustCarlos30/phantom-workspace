import net from 'node:net';
import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, chmod, lstat, realpath, unlink, open } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { browserURL, validateID, validateBrowserAgentRequest, isWithin } from './security.mjs';
import { browserSocket, browserError, MAX_RPC_BYTES, timeoutValue, waitForHTTP } from '../host/agent-browser.mjs';

// Exported API for the next integration: createAgentBrowserBridge({dataDir,
// hostInvoke, getManager, focusWindow, emit}) -> {invoke(identity,command,payload),
// close()}. invoke authenticates the same terminal capability as the wire RPC;
// preview returns {id,workspaceId,webContentsId,visible,url,...}. Reuse this API
// or requestBrowser in host/agent-browser.mjs, never create another browser.
export async function createAgentBrowserBridge({ dataDir, hostInvoke, getManager, focusWindow, emit }) {
  const directory = path.join(dataDir, 'agent-browser'), socketPath = browserSocket(dataDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Directorio RPC no puede ser enlace');
  await chmod(directory, 0o700);
  // Single-instance Electron lock is already held. Remove only a stale socket.
  try { if (!(await lstat(socketPath)).isSocket()) throw new Error('Ruta RPC ocupada por un archivo'); await unlink(socketPath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let closed = false, busy = false;
  const sockets = new Set();

  async function authenticate(identity) {
    try { validateID(identity.workspaceId); validateID(identity.terminalId); }
    catch { throw browserError('ACCESS_DENIED', 'Identidad de terminal no válida'); }
    if (typeof identity.token !== 'string' || !/^[a-f0-9]{64}$/.test(identity.token)) throw browserError('ACCESS_DENIED', 'Credencial de terminal no válida');
    let saved;
    try {
      const handle = await open(path.join(directory, `${identity.terminalId}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
      try { saved = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
    } catch { throw browserError('ACCESS_DENIED', 'Credencial caducada o desconocida'); }
    if (saved.workspaceId !== identity.workspaceId || saved.terminalId !== identity.terminalId || typeof saved.token !== 'string'
      || saved.token.length !== identity.token.length || !timingSafeEqual(Buffer.from(saved.token), Buffer.from(identity.token))) throw browserError('ACCESS_DENIED', 'Identidad no autorizada');
    const sessions = await hostInvoke('terminal.list', { workspaceId: identity.workspaceId });
    if (!sessions.some(session => session.id === identity.terminalId && session.status === 'running')) throw browserError('ACCESS_DENIED', 'La terminal ya no está activa');
  }

  async function perform(identity, command, payload, signal, deadline) {
    await authenticate(identity); signal.throwIfAborted();
    const { workspaceId, terminalId } = identity;
    if (command === 'context') return { workspaceId, terminalId, transport: 'private-unix-socket', desktop: true, commands: ['preview', 'open', 'status', 'read', 'click', 'fill', 'screenshot', 'console'], cli: 'node "$PHANTOM_BROWSER_CLI" help' };
    const state = await hostInvoke('state.get'); signal.throwIfAborted();
    if (state.activeWorkspaceId !== workspaceId) throw browserError('WORKSPACE_INACTIVE', 'Selecciona el workspace de esta terminal en Electron');
    const workspace = state.workspaces.find(item => item.id === workspaceId);
    const key = payload.key || 'default';
    const owned = workspace.nodes.filter(node => node.type === 'browser' && node.data?.agentTerminalId === terminalId);
    let node = payload.id ? owned.find(item => item.id === payload.id) : owned.find(item => item.data.agentKey === key);
    if (payload.id && !node) throw browserError('ACCESS_DENIED', 'Este panel no pertenece a la terminal');
    const manager = getManager();
    if (!manager || manager.disposed) throw browserError('DESKTOP_UNAVAILABLE', 'No hay ventana Electron disponible');
    if (['open', 'preview'].includes(command)) {
      const url = browserURL(payload.url, { external: true });
      await waitForHTTP(url, { timeoutMs: Math.max(100, deadline - Date.now()), signal }); signal.throwIfAborted();
      // Create/update only after readiness, so a failed URL leaves no empty node.
      if (!node) node = await hostInvoke('node.create', { workspaceId, type: 'browser', title: 'Preview de terminal',
        data: { url, agentTerminalId: terminalId, agentKey: key } });
      else if (node.data.url !== url || node.data.hidden) node = await hostInvoke('node.update', { workspaceId, id: node.id, patch: { data: { ...node.data, url, hidden: false } } });
      signal.throwIfAborted(); focusWindow();
      // Repeated event covers a state-refresh/render race; UI owns its bounds.
      while (!signal.aborted) {
        emit({ type: 'browser.agentFocus', id: node.id, workspaceId, url });
        const entry = manager.entries.get(node.id);
        if (entry?.attached && entry.view.getVisible()) {
          const wc = entry.view.webContents;
          if (entry.loadError && (entry.agentURL === url || entry.lastRequestedURL === url)) throw browserError('NAVIGATION_FAILED', entry.loadError);
          // The UI may already be navigating as part of its attach operation.
          if (wc.isLoadingMainFrame()) { await new Promise(resolve => setTimeout(resolve, 60)); continue; }
          if (entry.agentURL !== url) {
            entry.agentURL = url;
            // Do not reload an identical preview: preserve cookies/DOM/form state.
            if (wc.getURL() !== url) {
              await wc.loadURL(url); signal.throwIfAborted();
            }
          }
          if (!wc.isLoadingMainFrame()) return manager.agentOperation('status', { id: node.id, workspaceId }, signal);
        }
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      signal.throwIfAborted();
    }
    if (!node) throw browserError('PANEL_NOT_FOUND', 'Abre preview antes de usar el navegador');
    const result = await manager.agentOperation(command, { ...payload, id: node.id, workspaceId }, signal);
    signal.throwIfAborted();
    if (command !== 'screenshot') return result;
    // New files only; no caller-supplied directory, traversal, overwrite or symlink.
    const artifacts = path.join(directory, 'artifacts', workspaceId, terminalId);
    await mkdir(artifacts, { recursive: true, mode: 0o700 });
    const canonical = await realpath(artifacts);
    if (!isWithin(canonical, await realpath(directory)) || canonical !== artifacts) throw browserError('ACCESS_DENIED', 'Ruta de artifacts no válida');
    const destination = path.join(canonical, payload.name || `${randomUUID()}.png`);
    signal.throwIfAborted();
    const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(result); } finally { await handle.close(); }
    return { id: node.id, path: destination, bytes: result.length };
  }

  async function invoke(identity, command, payload = {}) {
    try { validateBrowserAgentRequest(command, payload); timeoutValue(payload.timeoutMs); }
    catch (error) { throw browserError('INVALID_INPUT', error.message); }
    if (closed) throw browserError('DESKTOP_UNAVAILABLE', 'Puente cerrado');
    if (busy) throw browserError('BUSY', 'Otra operación de navegador está en curso; reintenta al terminar');
    busy = true;
    const controller = new AbortController(), milliseconds = timeoutValue(payload.timeoutMs), deadline = Date.now() + milliseconds;
    let timer;
    const task = perform(identity, command, payload, controller.signal, deadline);
    // Keep the single-flight lock until the original task really settles: a
    // timeout cannot permit a second mutation to overtake an in-flight one.
    task.finally(() => { busy = false; }).catch(() => {});
    try {
      return await Promise.race([task, new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = browserError(['preview', 'open'].includes(command) ? 'PREVIEW_TIMEOUT' : 'OPERATION_TIMEOUT', `${command}: plazo de ${milliseconds} ms agotado; consulta status antes de repetir`);
          controller.abort(error); reject(error);
        }, milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }

  const server = net.createServer(socket => {
    if (sockets.size >= 16) return socket.destroy();
    sockets.add(socket); socket.setTimeout(35000, () => socket.destroy());
    let buffer = '', bytes = 0, received = false;
    socket.setEncoding('utf8');
    socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    socket.on('data', chunk => {
      if (received) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_RPC_BYTES) return socket.destroy();
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      received = true;
      (async () => {
        try {
          const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
          const result = await invoke(request, request.command, request.payload);
          socket.end(`${JSON.stringify({ result })}\n`);
        } catch (error) { socket.end(`${JSON.stringify({ error: { code: error.code || 'BROWSER_ERROR', message: error.message } })}\n`); }
      })().catch(() => socket.destroy());
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  return { invoke, close() { closed = true; for (const socket of sockets) socket.destroy(); server.close(); } };
}
