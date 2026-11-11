import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserURL, validateID } from '../desktop/security.mjs';

export const MAX_RPC_BYTES = 64 * 1024;
export const browserEndpoint = dataDir => path.join(dataDir, 'agent-browser.sock');
export function timeoutMs(value = 10000) {
  if (!Number.isInteger(value) || value < 100 || value > 30000) throw new Error('timeoutMs debe estar entre 100 y 30000');
  return value;
}
export function browserError(code, message) { return Object.assign(new Error(message), { code }); }
export function bounded(promise, ms, message = 'Tiempo del navegador agotado') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(browserError('TIMEOUT', message)), ms);
  })]).finally(() => clearTimeout(timer));
}

// Internal automation API for the next integration: waitForHTTP(url, {timeoutMs,
// signal}) resolves the sanitized HTTP(S) URL only after a 2xx/3xx response.
// It launches no browser; redirects are left to Electron's navigation guards.
export async function waitForHTTP(value, options = {}) {
  const url = browserURL(value, { external: true });
  const ms = timeoutMs(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  let last = 'sin respuesta';
  while (!signal.aborted) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(ms, 1000))]) });
      await response.body?.cancel();
      if (response.status >= 200 && response.status < 400) return url;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.cause?.code || error.message; }
    if (!signal.aborted) await new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 100); signal.addEventListener('abort', done, { once: true });
    });
  }
  throw browserError('HTTP_TIMEOUT', `HTTP no disponible tras ${ms} ms (${last}): ${url}`);
}

// Called only for a new PTY. Tokens never enter workspace state or RPC results.
export function terminalBrowserEnv(dataDir, workspaceId, terminalId, sessionId) {
  for (const id of [workspaceId, terminalId, sessionId]) validateID(id);
  const dir = path.join(dataDir, 'browser-access');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error('Directorio de acceso browser no privado');
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify({ workspaceId, terminalId, sessionId, token }),
    { mode: 0o600, flag: 'wx' });
  return { PHANTOM_BROWSER_ENDPOINT: browserEndpoint(dataDir), PHANTOM_BROWSER_TOKEN: token,
    PHANTOM_WORKSPACE_ID: workspaceId, PHANTOM_TERMINAL_ID: terminalId, PHANTOM_TERMINAL_SESSION_ID: sessionId,
    PHANTOM_BROWSER_CLI: fileURLToPath(new URL('../scripts/workspace-browser.mjs', import.meta.url)),
    PHANTOM_BROWSER_HELP: 'node "$PHANTOM_BROWSER_CLI" help' };
}

export function browserContext(env = process.env) {
  return { endpoint: env.PHANTOM_BROWSER_ENDPOINT, workspaceId: env.PHANTOM_WORKSPACE_ID,
    terminalId: env.PHANTOM_TERMINAL_ID, sessionId: env.PHANTOM_TERMINAL_SESSION_ID,
    cli: env.PHANTOM_BROWSER_CLI, available: Boolean(env.PHANTOM_BROWSER_ENDPOINT && env.PHANTOM_BROWSER_TOKEN) };
}

// Public local client API: requestBrowser(method, params, {env}) uses only the
// terminal capability. Methods: context/status/preview/open/read/click/fill/
// screenshot/console. No eval, debugger endpoint, external browser or fallback.
export async function requestBrowser(method, params = {}, { env = process.env } = {}) {
  const context = browserContext(env);
  if (!context.available) return Promise.reject(browserError('NO_CONTEXT', 'Sin contexto de navegador; usa una terminal nueva de Phantom Workspace'));
  const ms = timeoutMs(params.timeoutMs);
  const packet = JSON.stringify({ version: 1, method, params, workspaceId: context.workspaceId,
    terminalId: context.terminalId, sessionId: context.sessionId, token: env.PHANTOM_BROWSER_TOKEN });
  if (Buffer.byteLength(packet) > MAX_RPC_BYTES) return Promise.reject(browserError('INVALID_INPUT', 'Petición demasiado grande'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(context.endpoint), decoder = new StringDecoder('utf8'); let bytes = 0, chunks = '', settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(browserError('TIMEOUT', 'Electron no respondió dentro del plazo')), ms + 1500);
    socket.on('connect', () => socket.write(`${packet}\n`));
    socket.on('error', error => finish(browserError('DESKTOP_UNAVAILABLE', `Navegador Electron no disponible: ${error.code}`)));
    socket.on('end', () => { if (!settled) finish(browserError('DISCONNECTED', 'Electron cerró la conexión')); });
    socket.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) return finish(browserError('INVALID_RESPONSE', 'Respuesta demasiado grande'));
      chunks += decoder.write(chunk);
      if (!chunks.includes('\n')) return;
      try { const reply = JSON.parse(chunks.slice(0, chunks.indexOf('\n'))); finish(reply.error ? browserError(reply.error.code, reply.error.message) : null, reply.result); }
      catch (error) { finish(error); }
    });
  });
}
