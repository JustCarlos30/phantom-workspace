import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserURL, validateID } from '../desktop/security.mjs';

export const MAX_RPC_BYTES = 512 * 1024;
export const browserSocket = dataDir => path.join(dataDir, 'agent-browser', 'rpc.sock');
export function browserError(code, message) { return Object.assign(new Error(message), { code }); }
export function timeoutValue(value = 10000) {
  if (!Number.isInteger(value) || value < 100 || value > 30000) throw browserError('INVALID_INPUT', 'timeoutMs debe estar entre 100 y 30000');
  return value;
}

// Internal API for integrated automation: waitForHTTP(url, { timeoutMs, signal }).
// Only HTTP(S), no credentials; redirects are deliberately not followed. Success
// means a 2xx/3xx response, not that the document has finished rendering.
export async function waitForHTTP(value, { timeoutMs = 10000, signal } = {}) {
  const url = browserURL(value, { external: true });
  const bounded = AbortSignal.timeout(timeoutValue(timeoutMs));
  const combined = signal ? AbortSignal.any([bounded, signal]) : bounded;
  let last = 'sin respuesta HTTP';
  while (!combined.aborted) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([combined, AbortSignal.timeout(1000)]) });
      await response.body?.cancel();
      if (response.status >= 200 && response.status < 400) return { url, status: response.status };
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.cause?.code || error.message; }
    if (!combined.aborted) await new Promise(resolve => {
      const done = () => { clearTimeout(timer); combined.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 100); combined.addEventListener('abort', done, { once: true });
    });
  }
  throw browserError('HTTP_TIMEOUT', `HTTP no disponible tras ${timeoutMs} ms: ${url} (${last})`);
}

// A capability is private to the local OS account and bound to one live terminal.
// Never persist the token in public terminal descriptors or workspace state.
export function terminalBrowserEnvironment(dataDir, workspaceId, terminalId) {
  validateID(workspaceId); validateID(terminalId);
  const dir = path.join(dataDir, 'agent-browser');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, `${terminalId}.json`), JSON.stringify({ workspaceId, terminalId, token }), { mode: 0o600, flag: 'wx' });
  return {
    PHANTOM_BROWSER_SOCKET: browserSocket(dataDir), PHANTOM_BROWSER_TOKEN: token,
    PHANTOM_WORKSPACE_ID: workspaceId, PHANTOM_TERMINAL_ID: terminalId,
    PHANTOM_BROWSER_CLI: fileURLToPath(new URL('../scripts/workspace-browser.mjs', import.meta.url)),
    PHANTOM_BROWSER_HELP: 'node "$PHANTOM_BROWSER_CLI" help — preview/open, status, read, click, fill, screenshot, console, context',
  };
}
export function revokeTerminalBrowser(dataDir, terminalId) {
  validateID(terminalId);
  try { fs.unlinkSync(path.join(dataDir, 'agent-browser', `${terminalId}.json`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// Internal API: requestBrowser({socketPath, token, workspaceId, terminalId},
// command, payload). JSON-only allowlisted RPC, never a CDP endpoint or JS API.
export function requestBrowser(context, command, payload = {}) {
  const timeoutMs = timeoutValue(payload.timeoutMs);
  const body = JSON.stringify({ token: context.token, workspaceId: context.workspaceId, terminalId: context.terminalId, command, payload });
  if (Buffer.byteLength(body) > MAX_RPC_BYTES) return Promise.reject(browserError('INVALID_INPUT', 'Petición demasiado grande'));
  return new Promise((resolve, reject) => {
    let buffer = '', bytes = 0, settled = false;
    const socket = net.createConnection(context.socketPath);
    socket.setEncoding('utf8');
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(browserError('RPC_TIMEOUT', 'Electron no respondió dentro del plazo; consulta status antes de repetir una mutación')), timeoutMs + 2000);
    socket.once('connect', () => socket.write(`${body}\n`));
    socket.once('error', error => finish(browserError('DESKTOP_UNAVAILABLE', `Puente Electron no disponible: ${error.code || error.message}`)));
    socket.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_RPC_BYTES) return finish(browserError('PROTOCOL_ERROR', 'Respuesta demasiado grande'));
      buffer += chunk.toString('utf8');
      if (!buffer.includes('\n')) return;
      try { const reply = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); finish(reply.error ? browserError(reply.error.code, reply.error.message) : null, reply.result); }
      catch (error) { finish(browserError('PROTOCOL_ERROR', error.message)); }
    });
    socket.once('end', () => { if (!settled) finish(browserError('DESKTOP_UNAVAILABLE', 'Electron cerró el puente sin respuesta')); });
  });
}
