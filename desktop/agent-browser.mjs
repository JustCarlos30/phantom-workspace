import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { browserEndpoint, browserCredentialPath, privateDirectory, readBrowserContext, waitForHTTP } from '../host/agent-browser.mjs';
import { browserURL, isWithin, validateAgentBrowserRequest } from './security.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const expired = signal => { if (signal.aborted) throw Object.assign(new Error('Browser timeout: operación cancelada'), { code: 'BROWSER_TIMEOUT' }); };

// Fixed, application-owned DOM program. Only JSON data is interpolated; no agent
// script, expression, attribute handler, URL or debugger command is evaluated.
export function browserDOMProgram(command, { selector, value } = {}) {
  if (!['read', 'click', 'fill'].includes(command)) throw new Error('Acción DOM no permitida');
  const args = JSON.stringify({ command, selector, value }).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `(() => {
    const {command, selector, value} = ${args};
    const nodes = selector ? [...document.querySelectorAll(selector)].slice(0, 201) : [document.body];
    if (command === 'read') return {url: location.href, title: document.title.slice(0, 1024),
      text: nodes.slice(0, 200).map(n => (n?.innerText || n?.textContent || '').slice(0, 65536)).join('\\n').slice(0, 65536),
      controls: [...document.querySelectorAll('input,textarea,button,a,select')].slice(0, 100).map(n => ({tag:n.tagName.toLowerCase(), id:n.id.slice(0,256),
        type:(n.type || '').slice(0,80), label:(n.getAttribute('aria-label') || n.textContent || '').slice(0,256),
        value:n.type === 'password' || n.type === 'file' ? undefined : String(n.value || '').slice(0,512)}))};
    if (nodes.length !== 1) throw new Error('El selector debe coincidir con un único elemento');
    const node = nodes[0], rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    if (!rect.width || !rect.height || style.visibility !== 'visible' || style.display === 'none' || node.disabled || node.closest('[inert]')) throw new Error('Elemento no visible o deshabilitado');
    if (command === 'click') {
      if (!(node instanceof HTMLElement)) throw new Error('Elemento no activable');
      node.scrollIntoView({block:'center'}); node.click();
    } else {
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) || node.readOnly ||
        (node instanceof HTMLInputElement && !['text','search','url','email','tel','password','number'].includes(node.type))) throw new Error('Input no editable');
      const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(node,value);
      node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true}));
    }
    return {ok:true};
  })()`;
}

// Internal integration API (for the next child): createAgentBrowserController
// returns invoke({workspaceId,terminalId,command,timeoutMs,key?,...}, {signal}).
// Its caller is trusted desktop code, and must supply a real running terminal.
// preview/open perform HTTP readiness, idempotent node allocation, UI focus and
// awaited load in the SAME BrowserManager WebContentsView. Other commands never
// create pages. No separate Chromium, public CDP, or arbitrary-JS API exists.
export function createAgentBrowserController({ dataDir, hostInvoke, getManager, emit, focusWindow }) {
  let queue = Promise.resolve();
  async function perform(p, signal) {
    expired(signal);
    const state = await hostInvoke('state.get'); expired(signal);
    const workspace = state.workspaces.find(w => w.id === p.workspaceId);
    if (!workspace || state.activeWorkspaceId !== p.workspaceId) throw new Error('El workspace de la terminal no está activo');
    const sessions = await hostInvoke('terminal.list', { workspaceId: p.workspaceId }); expired(signal);
    if (!sessions.some(s => s.id === p.terminalId && s.status === 'running')) throw new Error('Terminal no activa o de otro workspace');
    if (p.command === 'context') return { workspaceId: workspace.id, terminalId: p.terminalId, available: Boolean(getManager()), transport: 'private-unix', commands: ['preview','open','status','read','click','fill','screenshot','console'] };
    const manager = getManager();
    if (!manager || manager.disposed) throw new Error('Ventana Electron no disponible');
    const key = p.key ? `key:${p.key}` : `terminal:${p.terminalId}`;
    let node = workspace.nodes.find(n => n.type === 'browser' && n.data?.agentBrowserKey === key);
    if (['preview', 'open'].includes(p.command)) {
      await waitForHTTP(p.url, { timeoutMs: Math.max(250, Math.min(p.timeoutMs, signal.deadline - Date.now())), signal }); expired(signal);
      if (!node) {
        node = await hostInvoke('node.create', { workspaceId: p.workspaceId, type: 'browser', title: 'Preview · agente',
          x: Math.max(0, ...workspace.nodes.map(n => n.x + n.width + 32)), y: 0,
          data: { url: p.url, agentBrowserKey: key, agentTerminalId: p.terminalId } });
      } else if (node.data.url !== p.url || node.data.hidden) {
        node = await hostInvoke('node.update', { workspaceId: p.workspaceId, id: node.id,
          patch: { data: { ...node.data, url: p.url, hidden: false } } });
      }
      expired(signal); focusWindow();
      // Repeat focus until React has consumed the host snapshot and attached the
      // panel. No guessed bounds and no second hidden automation-only page.
      let entry;
      while (!signal.aborted) {
        emit({ type: 'browser.agentFocus', workspaceId: p.workspaceId, id: node.id });
        entry = manager.entries.get(node.id);
        if (entry?.attached && entry.view.getVisible()) break;
        await delay(75);
      }
      expired(signal);
      const wc = entry.view.webContents;
      if (entry.agentLoadedURL !== p.url || wc.getURL() !== p.url) {
        const stop = () => { if (!wc.isDestroyed()) wc.stop(); };
        signal.addEventListener('abort', stop, { once: true });
        try {
          // UI attach may already have begun this exact load; await it instead
          // of aborting/restarting the renderer's navigation.
          if (entry.lastRequestedURL === p.url && wc.isLoading()) {
            while (wc.isLoading() && !signal.aborted) await delay(30);
            expired(signal);
            if (entry.lastLoadError) throw new Error(entry.lastLoadError);
          } else if (wc.getURL() !== p.url) await wc.loadURL(p.url);
          expired(signal);
          browserURL(wc.getURL(), { external: true });
          entry.agentLoadedURL = p.url;
        } finally { signal.removeEventListener('abort', stop); }
      }
      const reused = Boolean(entry.agentOpened);
      entry.agentOpened = true;
      return { id: node.id, workspaceId: p.workspaceId, webContentsId: wc.id, url: wc.getURL(), visible: entry.view.getVisible(), reused };
    }
    if (!node) throw new Error('No hay preview para esta terminal/clave; usa preview primero');
    const entry = manager.entries.get(node.id);
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('La vista ya no está disponible; vuelve a abrir preview');
    const wc = entry.view.webContents;
    if (p.command === 'status') return { id: node.id, workspaceId: p.workspaceId, webContentsId: wc.id, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), visible: entry.view.getVisible() };
    if (p.command === 'console') return { id: node.id, messages: [...entry.consoleMessages] };
    if (['read','click','fill'].includes(p.command)) {
      browserURL(wc.getURL(), { external: true });
      const result = await wc.executeJavaScript(browserDOMProgram(p.command, p), false);
      expired(signal); return { id: node.id, webContentsId: wc.id, ...result };
    }
    if (p.command === 'screenshot') {
      const image = await wc.capturePage(undefined, { stayHidden: true, stayAwake: false }); expired(signal);
      if (image.isEmpty()) throw new Error('No hay captura renderizada disponible');
      const base = fs.realpathSync(privateDirectory(path.join(dataDir, 'agent-browser')));
      const artifacts = privateDirectory(path.join(base, 'artifacts'));
      const directory = privateDirectory(path.join(artifacts, p.workspaceId));
      if (!isWithin(fs.realpathSync(directory), base)) throw new Error('Artifacts fuera de la raíz privada');
      const destination = path.join(directory, p.name || `${randomUUID()}.png`);
      // Exclusive creation rejects both overwrites and symlinks. No caller path.
      fs.writeFileSync(destination, image.toPNG(), { flag: 'wx', mode: 0o600 });
      return { id: node.id, path: destination, webContentsId: wc.id };
    }
    throw new Error('Comando de navegador no permitido');
  }
  return {
    invoke(payload, { signal = AbortSignal.timeout(payload.timeoutMs || 10000) } = {}) {
      signal.deadline ??= Date.now() + (payload.timeoutMs || 10000);
      const task = queue.then(() => perform(payload, signal));
      queue = task.catch(() => {});
      return task;
    },
  };
}

// Authenticated one-request-per-connection JSON RPC. Socket and credentials are
// owner-only; a token is bound to a workspace/running PTY, never a global secret.
export async function startAgentBrowserServer({ dataDir, controller }) {
  const endpoint = browserEndpoint(dataDir);
  privateDirectory(path.dirname(endpoint));
  if (fs.existsSync(endpoint)) {
    const alive = await new Promise(resolve => {
      const probe = net.createConnection(endpoint);
      probe.once('connect', () => { probe.destroy(); resolve(true); });
      probe.once('error', () => resolve(false));
      probe.setTimeout(500, () => { probe.destroy(); resolve(true); });
    });
    if (alive) throw new Error('Ya existe un puente Electron para este perfil');
    fs.unlinkSync(endpoint);
  }
  const sockets = new Set();
  const server = net.createServer(socket => {
    if (sockets.size >= 16) { socket.destroy(); return; }
    sockets.add(socket); socket.setEncoding('utf8'); socket.setTimeout(32000, () => socket.destroy());
    let buffer = '', started = false;
    const abort = new AbortController(); let timer;
    const respond = value => { if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`); };
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(timer); abort.abort(); sockets.delete(socket); });
    socket.on('data', async data => {
      if (started) return;
      buffer += data;
      if (Buffer.byteLength(buffer) > 32 * 1024) { socket.destroy(); return; }
      const end = buffer.indexOf('\n'); if (end < 0) return;
      started = true;
      try {
        const p = validateAgentBrowserRequest(JSON.parse(buffer.slice(0, end)));
        const credential = readBrowserContext(browserCredentialPath(dataDir, p.terminalId));
        if (credential.workspaceId !== p.workspaceId || !timingSafeEqual(Buffer.from(p.token), Buffer.from(credential.token))) throw Object.assign(new Error('Acceso al navegador rechazado'), { code: 'ACCESS_DENIED' });
        timer = setTimeout(() => {
          abort.abort(); respond({ error: { code: 'BROWSER_TIMEOUT', message: `Browser timeout (${p.timeoutMs} ms)` } });
        }, p.timeoutMs);
        const result = await controller.invoke(p, { signal: abort.signal });
        if (!abort.signal.aborted) respond({ result });
      } catch (error) {
        if (!abort.signal.aborted) respond({ error: { code: error.code || 'BROWSER_ERROR', message: error.message } });
      } finally { clearTimeout(timer); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
  fs.chmodSync(endpoint, 0o600);
  return { endpoint, close() { for (const socket of sockets) socket.destroy(); server.close(); try { fs.unlinkSync(endpoint); } catch {} } };
}
