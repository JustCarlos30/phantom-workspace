import path from 'node:path';
import { realpath } from 'node:fs/promises';

export const INVOKE_CHANNEL = 'phantom:invoke';
export const EVENT_CHANNEL = 'phantom:event';
export const HOST_METHODS = new Set([
  'system.info', 'state.get', 'settings.update',
  'workspace.open', 'workspace.select', 'workspace.update', 'workspace.relocate',
  'node.create', 'node.update', 'node.remove',
  'terminal.setup.retry', 'terminal.create', 'terminal.list', 'terminal.attach', 'terminal.tail', 'terminal.write', 'terminal.resize', 'terminal.stop', 'terminal.close',
  'terminal.agent.update', 'terminal.agent.context', 'terminal.agent.report', 'opencode.sessions',
  'chat.get', 'chat.configure', 'chat.send', 'chat.stop', 'chat.clear', 'chat.models', 'chat.permission.answer', 'chat.question.answer',
  'task.create', 'task.update', 'task.remove', 'mission.create', 'mission.update', 'mission.remove',
  'workflow.save', 'workflow.remove', 'context.pin', 'context.unpin', 'context.scan', 'context.read', 'skills.catalog', 'skills.read',
  'attention.list', 'attention.ack', 'attention.create', 'storage.export', 'storage.import', 'host.shutdown',
  'git.inspect', 'services.list', 'services.pin', 'services.remove', 'docker.list', 'docker.logs', 'docker.action',
  'plugins.list', 'plugins.update', 'plugins.status', 'plugins.models',
  // Incorporaciones: the renderer observes and toggles; queue actions belong to terminal sessions.
  'merge.status', 'merge.configure',
  // Ramas: the user's own Git decisions from the panel; the host never forces or discards.
  'branch.overview', 'branch.commit', 'branch.integrate', 'branch.update', 'branch.remove',
  'phantom.list', 'phantom.detail', 'phantom.events', 'phantom.controllers', 'phantom.create', 'phantom.update', 'phantom.control',
  'plugin.get', 'plugin.update',
  'automation.start', 'automation.list', 'automation.stop', 'automation.trace',
  'playground.run', 'playground.stop', 'playground.list', 'voice.transcribe', 'voice.intent',
  'voice.stream.start', 'voice.stream.push', 'voice.stream.finish', 'voice.stream.cancel',
]);
export const LOCAL_METHODS = new Set([
  'dialog.openFolder', 'dialog.openFile', 'desktop.openPath', 'desktop.openExternal', 'desktop.previewImage',
  'desktop.export', 'desktop.info', 'desktop.quit', 'desktop.closeReady',
  'browser.attach', 'browser.bounds', 'browser.navigate', 'browser.back', 'browser.forward',
  'browser.reload', 'browser.detach', 'browser.capture',
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
  validateJSON(payload, large ? 16 * 1024 * 1024 : 1024 * 1024);
  if (method === 'desktop.closeReady') validateCloseReady(payload);
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
  return `default-src 'self'; script-src 'self'${devURL ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${connect}; media-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
}
