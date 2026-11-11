import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MAX_REQUEST = 32 * 1024;
export const MAX_RESPONSE = 256 * 1024;
export const MAX_TIMEOUT = 30_000;
export function timeoutValue(value = 10_000) {
  if (!Number.isInteger(value) || value < 100 || value > MAX_TIMEOUT) throw new Error('timeoutMs debe estar entre 100 y 30000');
  return value;
}
export function previewURL(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('URL no válida');
  let url;
  try { url = new URL(value); } catch { throw new Error('URL HTTP(S) requerida'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL HTTP(S) sin credenciales requerida');
  return url.href;
}
export function withTimeout(promise, ms, message = 'Tiempo agotado; la operación puede seguir en curso') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

// Shared readiness API for internal automation: probes HTTP(S) without following
// redirects or downloading bodies. A 2xx/3xx response is ready; deadline is total,
// including connection failures. Never launches a browser. signal cancels probes.
export async function waitForHTTP(value, { timeoutMs = 10_000, signal } = {}) {
  const url = previewURL(value), end = Date.now() + timeoutValue(timeoutMs);
  let last = 'sin respuesta HTTP';
  while (Date.now() < end) {
    signal?.throwIfAborted();
    const remaining = end - Date.now();
    const ready = await new Promise(resolve => {
      let settled = false;
      const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
      const req = (url.startsWith('https:') ? https : http).get(url, { signal, headers: { 'User-Agent': 'Phantom-Workspace-Readiness' } }, res => {
        last = `HTTP ${res.statusCode}`;
        finish(res.statusCode >= 200 && res.statusCode < 400);
        res.destroy();
      });
      const timer = setTimeout(() => { last = 'timeout de conexión'; finish(false); req.destroy(); }, Math.min(1000, remaining));
      req.on('error', error => { last = error.code || error.message; finish(false); });
    });
    signal?.throwIfAborted();
    if (ready) return { url, ready: true };
    if (Date.now() < end) await new Promise(resolve => setTimeout(resolve, Math.min(100, end - Date.now())));
  }
  throw new Error(`HTTP no disponible tras ${timeoutMs}ms (${last})`);
}

// Minted only when spawning a new PTY. The token is private to this local user;
// workspace/node identity is checked again against live host state by Electron.
export function terminalBrowserEnvironment(dataDir, workspaceId, terminalId) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(workspaceId) || !uuid.test(terminalId)) throw new Error('Identidad workspace/terminal no válida');
  const dir = path.join(dataDir, 'agent-browser');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const credential = path.join(dir, `${terminalId}.json`);
  const identity = { workspaceId, terminalId, token: randomBytes(32).toString('hex') };
  fs.writeFileSync(credential, JSON.stringify(identity), { mode: 0o600, flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW });
  return { PHANTOM_BROWSER_SOCKET: path.join(dir, 'rpc.sock'), PHANTOM_BROWSER_CREDENTIAL: credential,
    PHANTOM_WORKSPACE_ID: workspaceId, PHANTOM_TERMINAL_ID: terminalId,
    PHANTOM_BROWSER_CLI: fileURLToPath(new URL('../scripts/workspace-browser.mjs', import.meta.url)),
    PHANTOM_BROWSER_HELP: 'node "$PHANTOM_BROWSER_CLI" help — preview/open, status, read, click, fill, screenshot, console; context para identidad' };
}

export function browserContext(env = process.env) {
  return { available: Boolean(env.PHANTOM_BROWSER_SOCKET && env.PHANTOM_BROWSER_CREDENTIAL),
    workspaceId: env.PHANTOM_WORKSPACE_ID || null, terminalId: env.PHANTOM_TERMINAL_ID || null,
    cli: env.PHANTOM_BROWSER_CLI || fileURLToPath(new URL('../scripts/workspace-browser.mjs', import.meta.url)),
    transport: 'private-unix-socket', browser: 'Electron workspace panel', maxTimeoutMs: MAX_TIMEOUT };
}

// Public Node API for CLI/next child: requestBrowser(method, payload, {env}).
// No debugger endpoint, eval, external browser, or automatic replay of mutations.
export async function requestBrowser(method, payload = {}, { env = process.env } = {}) {
  const timeoutMs = timeoutValue(payload.timeoutMs);
  if (!browserContext(env).available) throw new Error('Puente no descubierto: usa una terminal nueva de Phantom Workspace con Electron abierto');
  const auth = JSON.parse(fs.readFileSync(env.PHANTOM_BROWSER_CREDENTIAL, 'utf8'));
  const message = JSON.stringify({ method, payload, auth });
  if (Buffer.byteLength(message) > MAX_REQUEST) throw new Error('Solicitud demasiado grande');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(env.PHANTOM_BROWSER_SOCKET);
    socket.setEncoding('utf8');
    let bytes = 0, text = '';
    const timer = setTimeout(() => finish(new Error('Puente Electron: timeout; la operación puede seguir en curso')), timeoutMs + 2000);
    function finish(error, result) { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); }
    socket.on('connect', () => socket.end(`${message}\n`));
    socket.on('error', error => finish(new Error(`Puente Electron no disponible (${error.code || error.message})`)));
    socket.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_RESPONSE) return finish(new Error('Respuesta demasiado grande'));
      text += chunk.toString('utf8');
      if (!text.includes('\n')) return;
      try { const reply = JSON.parse(text); reply.ok ? finish(null, reply.result) : finish(new Error(reply.error)); }
      catch (error) { finish(error); }
    });
    socket.on('end', () => { if (!text.includes('\n')) finish(new Error('Puente Electron desconectado sin respuesta')); });
  });
}
