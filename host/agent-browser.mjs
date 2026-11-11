import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserURL, validateID } from '../desktop/security.mjs';

export const BROWSER_HELP = `workspace-browser — navegador integrado de Phantom (requiere Electron abierto)
Uso: node "$PHANTOM_BROWSER_CLI" <comando> [opciones]
  context                         Identidad y disponibilidad del puente
  preview|open <http(s)://URL>      Esperar HTTP y mostrar/enfocar el panel
  status                          Estado de la misma vista
  read [--selector CSS]            Texto y controles DOM (sin ejecutar código)
  click --selector CSS             Activar un elemento visible y único
  fill --selector CSS --value TEXTO  Rellenar input/textarea
  screenshot [--name captura.png]  PNG en artifacts privados del workspace
  console                         Últimos 200 mensajes (máximo 2 KiB cada uno)
Opciones: --timeout MS (250–30000, por defecto 10000), --key CLAVE
Cada terminal reutiliza su panel; --key permite paneles idempotentes adicionales.
No se admite JavaScript, debugger ni navegador externo. URLs HTTP(S) sin credenciales.
Las terminales nuevas reciben PHANTOM_BROWSER_{CLI,CONTEXT} y PHANTOM_{WORKSPACE,TERMINAL}_ID.
Errores JSON en stderr y salida no cero; un timeout puede dejar un panel ya creado.
`;

export function browserEndpoint(dataDir) {
  const hash = createHash('sha256').update(path.resolve(dataDir)).digest('hex').slice(0, 24);
  return path.join(os.tmpdir(), `phantom-browser-${process.getuid?.() ?? 'local'}-${hash}`, 'rpc.sock');
}

export function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) {
    throw new Error('Directorio de navegador no privado');
  }
  return directory;
}

export function browserCredentialPath(dataDir, terminalId) {
  validateID(terminalId);
  return path.join(dataDir, 'agent-browser', `${terminalId}.json`);
}

export function terminalBrowserEnvironment(dataDir, workspaceId, terminalId) {
  validateID(workspaceId); validateID(terminalId);
  privateDirectory(path.join(dataDir, 'agent-browser'));
  const context = browserCredentialPath(dataDir, terminalId);
  fs.writeFileSync(context, JSON.stringify({ version: 1, workspaceId, terminalId,
    endpoint: browserEndpoint(dataDir), token: randomBytes(32).toString('hex') }), { mode: 0o600, flag: 'wx' });
  return { PHANTOM_BROWSER_CLI: fileURLToPath(new URL('../scripts/workspace-browser.mjs', import.meta.url)),
    PHANTOM_BROWSER_CONTEXT: context, PHANTOM_WORKSPACE_ID: workspaceId, PHANTOM_TERMINAL_ID: terminalId };
}

export function readBrowserContext(filename) {
  if (!filename || !path.isAbsolute(filename)) throw new Error('Sin contexto: usa una terminal nueva de Phantom Workspace');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 4096) throw new Error('Credencial no privada');
    const context = JSON.parse(fs.readFileSync(fd, 'utf8'));
    validateID(context.workspaceId); validateID(context.terminalId);
    if (context.version !== 1 || !/^[a-f0-9]{64}$/.test(context.token) || typeof context.endpoint !== 'string') throw new Error('Contexto no válido');
    return context;
  } finally { fs.closeSync(fd); }
}

export function timeoutValue(value = 10000) {
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < 250 || ms > 30000) throw new Error('timeout debe estar entre 250 y 30000 ms');
  return ms;
}

// Shared readiness API for the next integration: waitForHTTP(url, {timeoutMs,
// signal}) returns the sanitized final URL. One absolute budget covers retries,
// headers and redirects; no body is buffered, no external browser is launched.
export async function waitForHTTP(value, { timeoutMs = 10000, signal } = {}) {
  const url = browserURL(value, { external: true });
  const deadline = Date.now() + timeoutValue(timeoutMs);
  const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  let last = 'sin respuesta';
  while (!combined.aborted && Date.now() < deadline) {
    try {
      let target = url;
      for (let hop = 0; hop <= 5; hop++) {
        const response = await fetch(target, { redirect: 'manual', signal: combined });
        await response.body?.cancel();
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location || hop === 5) throw new Error('Redirecciones HTTP no válidas');
          target = browserURL(new URL(location, target).href, { external: true });
          continue;
        }
        if (response.ok) return target;
        last = `HTTP ${response.status}`;
        break;
      }
    } catch (error) { last = error.message; }
    if (!combined.aborted) await new Promise(resolve => {
      const timer = setTimeout(done, Math.min(150, Math.max(1, deadline - Date.now())));
      function done() { clearTimeout(timer); combined.removeEventListener('abort', done); resolve(); }
      combined.addEventListener('abort', done, { once: true });
    });
  }
  throw Object.assign(new Error(`HTTP timeout (${timeoutMs} ms): ${last}`), { code: 'HTTP_TIMEOUT' });
}

// Public client API: requestBrowser(context, {command, timeoutMs, key, ...args}).
// Context comes only from readBrowserContext(PHANTOM_BROWSER_CONTEXT). The server
// authenticates workspace + running terminal on every call. No eval/script RPC.
export function requestBrowser(context, payload) {
  const timeoutMs = timeoutValue(payload.timeoutMs);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(context.endpoint);
    let buffer = '', settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('RPC timeout: Electron no respondió'), { code: 'RPC_TIMEOUT' })), timeoutMs + 1000);
    socket.on('connect', () => socket.write(`${JSON.stringify({ ...payload, workspaceId: context.workspaceId, terminalId: context.terminalId, token: context.token })}\n`));
    socket.on('data', data => {
      buffer += data.toString('utf8');
      if (Buffer.byteLength(buffer) > 256 * 1024) return finish(new Error('Respuesta RPC demasiado grande'));
      const end = buffer.indexOf('\n'); if (end < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, end));
        finish(message.error ? Object.assign(new Error(message.error.message), { code: message.error.code }) : null, message.result);
      } catch (error) { finish(error); }
    });
    socket.on('error', error => finish(Object.assign(new Error(`Puente Electron no disponible: ${error.message}`), { code: 'BRIDGE_UNAVAILABLE' })));
    socket.on('end', () => { if (!settled) finish(new Error('Puente Electron desconectado')); });
  });
}
