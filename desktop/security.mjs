import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { verifyReviewRender } from '../integrations/video-review.mjs';
import { safePath } from '../integrations/common.mjs';
import { validateInterfaceScale } from '../shared/interface-scale.mjs';

export const INVOKE_CHANNEL = 'phantom:invoke';
export const EVENT_CHANNEL = 'phantom:event';
export const HOST_METHODS = new Set([
  'system.info', 'state.get', 'settings.update', 'limits.read',
  'mobile.status', 'mobile.start', 'mobile.stop', 'mobile.pairing', 'mobile.revoke', 'mobile.approve', 'mobile.reject', 'mobile.audit',
  'android.status', 'android.configure', 'android.start', 'android.link', 'android.stop', 'android.pairing', 'android.bootstrap', 'android.approve', 'android.revoke',
  'workspace.open', 'workspace.select', 'workspace.update', 'workspace.relocate',
  'node.create', 'node.update', 'node.remove',
  'terminal.setup.retry', 'terminal.create', 'terminal.list', 'terminal.attach', 'terminal.tail', 'terminal.write', 'terminal.trust', 'terminal.resize', 'terminal.stop', 'terminal.close',
  'terminal.agent.update', 'terminal.agent.context', 'terminal.agent.report', 'opencode.sessions',
  // Observabilidad de agentes: el operador lee historial y supervisor; terminal.agent.trace[s] es API de agentes y no entra aquí.
  'agent.traces.list', 'agent.traces.detail', 'supervisor.read', 'supervisor.configure', 'supervisor.refresh',
  'chat.get', 'chat.configure', 'chat.send', 'chat.stop', 'chat.clear', 'chat.compaction.capabilities', 'chat.compact', 'chat.continue', 'chat.queue.remove', 'chat.queue.send', 'chat.models', 'chat.permission.answer', 'chat.question.answer',
  'task.create', 'task.update', 'task.remove', 'mission.create', 'mission.update', 'mission.remove',
  'workflow.save', 'workflow.remove', 'context.pin', 'context.unpin', 'context.scan', 'context.read', 'skills.catalog', 'skills.read',
  'orchestrator.send',
  'attention.list', 'attention.ack', 'attention.create', 'storage.export', 'storage.import', 'host.shutdown',
  'git.inspect', 'services.list', 'services.pin', 'services.remove', 'docker.list', 'docker.logs', 'docker.action',
  // Entorno: el renderer observa y baja servicios; subir y ejecutar jobs es de las terminales.
  'env.list', 'env.down',
  'plugins.list', 'plugins.update', 'plugins.status', 'plugins.models',
  'review.projects', 'review.export', 'review.add', 'review.list', 'review.resolve',
  // Incorporaciones: the renderer observes and toggles; queue actions belong to terminal sessions.
  'merge.status', 'merge.configure', 'merge.retry', 'merge.withdraw',
  // Ramas: the user's own Git decisions from the panel; the host never forces or discards.
  'branch.overview', 'branch.commit', 'branch.integrate', 'branch.update', 'branch.abort', 'branch.publish', 'branch.remove',
  // Repositorio: graph, diffs and edits of existing text files inside the project's own worktrees.
  'repo.graph', 'repo.commit', 'repo.diff', 'repo.changes', 'repo.files', 'repo.file.read', 'repo.file.write',
  'phantom.list', 'phantom.detail', 'phantom.events', 'phantom.controllers', 'phantom.create', 'phantom.update', 'phantom.control',
  'providers.list', 'providers.models', 'providers.configure',
  'plugin.get', 'plugin.update',
  'automation.start', 'automation.list', 'automation.stop', 'automation.trace',
  'playground.run', 'playground.stop', 'playground.list', 'voice.transcribe', 'voice.intent',
  'voice.stream.start', 'voice.stream.push', 'voice.stream.finish', 'voice.stream.cancel', 'voice.stream.warm', 'voice.stream.recover',
  // Canvas board: references (image, video, link) and comment pins.
  'reference.add', 'reference.link', 'reference.identity', 'comment.add', 'comment.reply', 'comment.update', 'comment.remove', 'comment.retry',
]);
// Reference files are served to the local UI only, by workspace and content-hash name.
export const REFERENCE_SCHEME = 'phantom-ref';
export const REVIEW_SCHEME = 'phantom-review';
// Capabilities are minted by main after a verified host export; paths never come from the renderer.
export function createReviewMedia() {
  const tokens = new Map();
  return {
    async issue(root, slug, pkg) {
      root = await realpath(root);
      const handle = await verifyReviewRender(root, slug, pkg);
      const identity = handle.reviewIdentity;
      await handle.close();
      const token = randomBytes(32).toString('hex');
      if (tokens.size >= 128) tokens.delete(tokens.keys().next().value);
      tokens.set(token, { root, exports: path.join(root, 'projects', slug, 'exports'), ...identity });
      return `${REVIEW_SCHEME}://media/${token}`;
    },
    async respond(request) {
      let handle, token;
      try {
        if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
        // Exact syntax also rejects URL-normalized traversal and escaped components.
        const match = /^phantom-review:\/\/media\/([a-f0-9]{64})$/.exec(request.url);
        const target = match && tokens.get(match[1]);
        if (!target) return new Response(null, { status: 403 });
        token = match[1];
        const file = await safePath(target.root, path.relative(target.root, target.file));
        if (!isWithin(file, target.exports) || await realpath(file) !== target.file) throw new Error('Render fuera de exports.');
        handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        const stat = await handle.stat();
        if (!stat.isFile() || ['dev', 'ino', 'size', 'mtimeMs'].some(key => stat[key] !== target[key])) throw new Error('El render cambió.');
        const { size } = stat, header = request.headers.get('range'), range = byteRange(header, size);
        const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
        if (header && !range) { await handle.close(); handle = null; return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } }); }
        const { start, end } = range || { start: 0, end: size - 1 };
        let body = null;
        if (request.method === 'HEAD' || !size) { await handle.close(); handle = null; }
        else { body = Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })); handle = null; }
        return new Response(body, { status: range ? 206 : 200, headers: { ...headers, 'Content-Length': String(size ? end - start + 1 : 0), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) } });
      } catch { if (token) tokens.delete(token); if (handle) await handle.close(); return new Response(null, { status: 404 }); }
    },
  };
}
export const REFERENCE_FILE = /^[0-9a-f]{32}\.(png|jpg|gif|webp|avif|mp4|mov|webm)$/;
export const REFERENCE_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
// phantom-ref://<workspace id>/<file> → the two validated segments, or null.
export function referenceTarget(value) {
  try {
    const url = new URL(value), file = url.pathname.slice(1);
    if (url.protocol !== `${REFERENCE_SCHEME}:` || url.search || url.hash || url.username || url.port) return null;
    validateID(url.hostname);
    return REFERENCE_FILE.test(file) ? { workspaceId: url.hostname.toLowerCase(), file, type: REFERENCE_TYPES[file.split('.')[1]] } : null;
  } catch { return null; }
}
// One satisfiable byte range, as <video> seeking asks for it.
export function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2])), end = match[1] && match[2] ? Number(match[2]) : size - 1;
  end = Math.min(end, size - 1);
  return start <= end && start < size ? { start, end } : false;
}
export const LOCAL_METHODS = new Set([
  'dialog.openFolder', 'dialog.openFile', 'desktop.openPath', 'desktop.openExternal', 'desktop.openBrowser', 'desktop.previewImage',
  'desktop.export', 'desktop.info', 'desktop.quit', 'desktop.closeReady', 'desktop.notify', 'desktop.badge',
  'desktop.interfaceScale.get', 'desktop.interfaceScale.set',
  'browser.attach', 'browser.bounds', 'browser.navigate', 'browser.back', 'browser.forward',
  'browser.reload', 'browser.detach', 'browser.capture', 'browser.inspect',
]);

export function validateJSON(value, maxBytes = 1024 * 1024) {
  const seen = new Set();
  let budget = maxBytes;
  function visit(item, depth) {
    if (depth > 64 || --budget < 0) throw new Error('Payload demasiado grande o profundo');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      budget -= Buffer.byteLength(item);
      if (budget < 0) throw new Error('Payload demasiado grande');
      return;
    }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || seen.has(item)) throw new Error('Payload debe ser JSON serializable');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new Error('Payload debe contener objetos JSON simples');
    }
    seen.add(item);
    for (const key of Object.keys(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Clave JSON no permitida');
      budget -= Buffer.byteLength(key);
      visit(item[key], depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maxBytes) throw new Error('Payload demasiado grande');
  return text;
}

export function validateInvocation(method, payload) {
  if (typeof method !== 'string' || (!HOST_METHODS.has(method) && !LOCAL_METHODS.has(method))) {
    throw new Error('Método desktop no permitido');
  }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Payload debe ser un objeto');
  const large = ['storage.import', 'desktop.export', 'voice.transcribe'].includes(method);
  // A pasted image travels as base64: 12 MB of pixels is about 16 MB of text.
  validateJSON(payload, method === 'reference.add' ? 17 * 1024 * 1024 : large ? 16 * 1024 * 1024 : 1024 * 1024);
  if (method === 'desktop.interfaceScale.get' || method === 'desktop.interfaceScale.set') {
    const keys = Object.keys(payload);
    if (method.endsWith('.get') ? keys.length !== 0 : keys.length !== 1 || keys[0] !== 'scale') {
      throw new Error('Payload de escala no válido');
    }
    if (method.endsWith('.set')) validateInterfaceScale(payload.scale);
  }
  if (method === 'desktop.closeReady') validateCloseReady(payload);
  if (method === 'desktop.notify') {
    if (Object.keys(payload).some(key => !['title', 'body', 'target', 'workspaceId', 'nodeId'].includes(key))
      || typeof payload.title !== 'string' || payload.title.length < 1 || payload.title.length > 120
      || ('body' in payload && (typeof payload.body !== 'string' || payload.body.length > 300))
      || ('target' in payload && !['branches', 'session'].includes(payload.target))
      || ('workspaceId' in payload && !isBoundedID(payload.workspaceId))
      || ('nodeId' in payload && !isBoundedID(payload.nodeId))) {
      throw new Error('Notificación desktop no válida');
    }
  }
  if (method === 'desktop.badge') {
    const keys = Object.keys(payload);
    if (keys.length !== 1 || keys[0] !== 'count' || !Number.isInteger(payload.count) || payload.count < 0 || payload.count > 9999) {
      throw new Error('Contador desktop no válido');
    }
  }
}

function isBoundedID(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128;
}

export const EXPORT_MAX_BYTES = 16 * 1024 * 1024;

export function normalizeExportPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  return filePath.toLowerCase().endsWith('.json') ? filePath : `${filePath}.json`;
}

export function checkExportSize(data, maxBytes = EXPORT_MAX_BYTES) {
  const text = JSON.stringify(data);
  if (text === undefined) throw new Error('Exportación debe contener JSON válido');
  if (Buffer.byteLength(text) > maxBytes) {
    throw new Error('La exportación supera 16 MB. Desactiva «Incluir historial al exportar» e inténtalo de nuevo.');
  }
  return text;
}

// Maps a save dialog result to the outcome reported to the renderer.
export function classifyExportResult(result, written) {
  if (!result || result.canceled || !result.filePath) return { status: 'cancelled' };
  const destination = normalizeExportPath(result.filePath);
  return written ? { status: 'saved', path: destination } : { status: 'pending', path: destination };
}

export function validateCloseReady(payload, outstandingId = payload?.requestId) {
  validateID(payload?.requestId);
  if (Object.keys(payload).some(key => !['requestId', 'discard'].includes(key))
    || (payload.discard !== undefined && payload.discard !== false)) {
    throw new Error('El renderer solo puede confirmar un guardado; descartar requiere una elección nativa');
  }
  if (!outstandingId || payload.requestId !== outstandingId) throw new Error('Solicitud de cierre caducada o no autorizada');
}

export function isHostTransportError(error) {
  if (error?.code === 'HOST_REQUEST_TIMEOUT') return false;
  return /^(?:ECONN\w*|EPIPE|ENOTCONN|ETIMEDOUT)$/.test(error?.code || '')
    || /^(?:Host (?:disconnected|connection timed out|startup failed|unavailable|client closed|no disponible)|Socket (?:closed|disconnected))\b/i.test(error?.message || '');
}

export function browserURL(value, { external = false } = {}) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('URL no válida');
  if (!external && value === 'about:blank') return value;
  let url;
  try { url = new URL(value); } catch { throw new Error('Usa una URL http:// o https://'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Solo se permite HTTP(S) sin credenciales');
  return url.href;
}

// Agent RPC is intentionally not part of LOCAL_METHODS: renderer/remote frames
// cannot mint terminal capabilities or invoke the private automation surface.
export function browserKey(value = 'preview') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new Error('key no válida');
  return value;
}

export function isLocalUIURL(value, uiURL) {
  try {
    const url = new URL(value);
    const expected = new URL(uiURL);
    return !url.username && !url.password && url.protocol === expected.protocol
      && url.host === expected.host && url.pathname === expected.pathname && url.search === expected.search;
  } catch { return false; }
}

export function isTrustedSender(event, contents, uiURL) {
  try {
    return Boolean(contents && !contents.isDestroyed() && event.sender === contents
      && event.senderFrame === contents.mainFrame && event.senderFrame.parent === null
      && isLocalUIURL(event.senderFrame.url, uiURL) && isLocalUIURL(contents.getURL(), uiURL));
  } catch { return false; }
}

export function clampBounds(bounds, viewport) {
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]))) {
    throw new Error('Bounds deben contener coordenadas finitas');
  }
  if (bounds.width < 0 || bounds.height < 0) throw new Error('Bounds negativos');
  const width = Math.max(0, Math.floor(viewport.width));
  const height = Math.max(0, Math.floor(viewport.height));
  const x = Math.max(0, Math.min(width, Math.ceil(bounds.x)));
  const y = Math.max(0, Math.min(height, Math.ceil(bounds.y)));
  const right = Math.max(x, Math.min(width, Math.floor(bounds.x + bounds.width)));
  const bottom = Math.max(y, Math.min(height, Math.floor(bounds.y + bounds.height)));
  return { x, y, width: right - x, height: bottom - y };
}

// DOM bounds are CSS pixels; native child views use window DIPs. Spatial canvas
// transforms are already included by getBoundingClientRect, so apply only UI zoom.
export function nativeUIBounds(bounds, factor) {
  clampBounds(bounds, { width: 0, height: 0 });
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 1 || factor > 1.5) throw new Error('Factor de interfaz no válido');
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, bounds[key] * factor]));
}

export function validateID(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('ID de panel/proyecto no válido');
  }
  return value;
}

export function browserNode(state, id, workspaceId) {
  validateID(id);
  validateID(workspaceId);
  const workspace = state.workspaces?.find(item => item.id === workspaceId);
  if (!workspace || state.activeWorkspaceId !== workspaceId || !workspace.nodes?.some(node => node.id === id && node.type === 'browser')) {
    throw new Error('El navegador no pertenece al proyecto activo');
  }
  return workspace;
}

export function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function authorizedPath(value, roots) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('Ruta absoluta requerida');
  const canonical = await realpath(value);
  for (const root of roots) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) continue;
    try { if (isWithin(canonical, await realpath(root))) return canonical; } catch { /* Missing root grants nothing. */ }
  }
  throw new Error('Ruta fuera de los proyectos y artefactos autorizados');
}

export function contentSecurityPolicy(devURL) {
  let connect = "'self'";
  if (devURL) {
    const url = new URL(devURL);
    connect += ` ${url.origin} ${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
  }
  return `default-src 'self'; script-src 'self'${devURL ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: phantom-ref:; font-src 'self' data:; connect-src ${connect}; media-src 'self' blob: phantom-ref: phantom-review:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
}
