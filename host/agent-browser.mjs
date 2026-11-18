import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserURL, validateID, validateJSON } from '../desktop/security.mjs';

export const browserCLI = fileURLToPath(new URL('../scripts/workspace-browser.mjs', import.meta.url));
export const browserShims = fileURLToPath(new URL('../scripts/browser-shims', import.meta.url));
export const endpointFile = dataDir => path.join(dataDir, 'agent-browser.json');
export const credentialFile = (dataDir, sessionId) => path.join(dataDir, 'browser-terminals', validateID(sessionId) + '.json');

// Called before PTY spawn. Secrets are runtime-only, never terminal descriptors/history.
// Each new shell discovers the CLI and carries one revocable workspace/session capability.
// System openers (xdg-open, $BROWSER, gio open...) are shimmed so skills that "open the
// URL for the user" land in the integrated panel instead of the desktop browser.
export function provisionBrowserTerminal(dataDir, { sessionId, workspaceId, nodeId }, baseEnv = process.env) {
  const filename = credentialFile(dataDir, sessionId);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(filename, JSON.stringify({ token, workspaceId, nodeId }), { mode: 0o600, flag: 'wx' });
  const inherited = (baseEnv.PATH || '/usr/local/bin:/usr/bin:/bin').split(':').filter(dir => dir && dir !== browserShims);
  let browser = path.join(browserShims, 'xdg-open');
  const browserLink = path.resolve(dataDir, 'browser-bin', 'xdg-open');
  try {
    if (!/\s/.test(browserLink)) {
      fs.mkdirSync(path.dirname(browserLink), { recursive: true, mode: 0o700 });
      try { fs.symlinkSync(browser, browserLink); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (fs.readlinkSync(browserLink) !== browser) { fs.rmSync(browserLink); fs.symlinkSync(browser, browserLink); }
      }
      if (fs.readlinkSync(browserLink) === browser) browser = browserLink;
    }
  } catch {}
  return { env: { PHANTOM_BROWSER_CLI: browserCLI, PHANTOM_BROWSER_ENDPOINT: endpointFile(dataDir),
    PHANTOM_BROWSER_TOKEN: token, PHANTOM_BROWSER_SESSION: sessionId, PHANTOM_BROWSER_WORKSPACE: workspaceId,
    PHANTOM_BROWSER_SHIMS: browserShims, PHANTOM_BROWSER_ORIGINAL: baseEnv.PHANTOM_BROWSER_ORIGINAL ?? baseEnv.BROWSER ?? '',
    BROWSER: browser, PATH: [browserShims, ...inherited].join(':') },
  revoke() { fs.rmSync(filename, { force: true }); } };
}

export function timeoutValue(value = 15000) {
  if (!Number.isInteger(value) || value < 100 || value > 60000) throw new Error('timeoutMs debe estar entre 100 y 60000');
  return value;
}

// Reusable HTTP readiness primitive: no navigation, redirects, external browser or
// debugger. Only 2xx/3xx count as ready. Every request and retry shares one deadline.
export async function waitForHTTP(value, { timeoutMs = 15000, signal } = {}) {
  const url = browserURL(value, { external: true });
  const end = Date.now() + timeoutValue(timeoutMs);
  do {
    signal?.throwIfAborted();
    const ready = await new Promise(resolve => {
      const request = (url.startsWith('https:') ? https : http).get(url, { signal,
        headers: { 'User-Agent': 'Phantom-Workspace-Readiness' } }, response => {
        const ok = response.statusCode >= 200 && response.statusCode < 400;
        response.destroy(); resolve(ok);
      });
      request.setTimeout(Math.max(1, Math.min(1000, end - Date.now())), () => request.destroy());
      const timer = setTimeout(() => request.destroy(), Math.max(1, end - Date.now()));
      request.once('close', () => clearTimeout(timer));
      request.once('error', () => resolve(false));
    });
    if (ready) return { url, ready: true };
    signal?.throwIfAborted();
    if (Date.now() < end) await new Promise(resolve => setTimeout(resolve, Math.min(100, end - Date.now())));
  } while (Date.now() < end);
  throw new Error(`HTTP readiness timeout (${timeoutMs}ms): ${url}`);
}

export function privateJSON(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 16384) throw new Error('Descriptor privado no válido');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}

// Internal client for subsequent automation: invoke(command, payload) resolves the
// exact desktop result, or rejects. Credentials default to the owning terminal's env.
// Commands: context/status, preview/open {url,key?,timeoutMs?}, read {key?,selector?},
// click {key?,selector}, fill {key?,selector,value}, screenshot/console {key?}.
// No evaluation command exists. Each request uses a fresh, bounded local connection.
export function createBrowserClient({ env = process.env } = {}) {
  return { invoke(command, payload = {}) {
    return new Promise((resolve, reject) => {
      let descriptor, requestLine;
      try {
        if (!env.PHANTOM_BROWSER_ENDPOINT || !env.PHANTOM_BROWSER_TOKEN) throw new Error('Puente no disponible: usa una terminal nueva de Phantom Workspace');
        descriptor = privateJSON(env.PHANTOM_BROWSER_ENDPOINT);
        if (typeof descriptor.socketPath !== 'string' || !path.isAbsolute(descriptor.socketPath)) throw new Error('Endpoint no válido');
        validateID(env.PHANTOM_BROWSER_SESSION); validateID(env.PHANTOM_BROWSER_WORKSPACE);
        requestLine = validateJSON({ command, payload, token: env.PHANTOM_BROWSER_TOKEN,
          sessionId: env.PHANTOM_BROWSER_SESSION, workspaceId: env.PHANTOM_BROWSER_WORKSPACE }, 65535) + '\n';
      } catch (error) { reject(error); return; }
      const socket = net.createConnection(descriptor.socketPath);
      let buffer = '', done = false;
      const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); };
      const timer = setTimeout(() => finish(new Error('Browser RPC timeout')), 75000);
      socket.setEncoding('utf8');
      socket.on('error', error => finish(error));
      socket.on('close', () => finish(new Error('Browser RPC desconectado')));
      socket.on('connect', () => socket.write(requestLine));
      socket.on('data', chunk => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 1024 * 1024) return finish(new Error('Respuesta demasiado grande'));
        if (!buffer.includes('\n')) return;
        try { const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); finish(response.error ? new Error(response.error) : null, response.result); }
        catch (error) { finish(error); }
      });
    });
  } };
}
