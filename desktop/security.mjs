import path from 'node:path';
import { realpath } from 'node:fs/promises';

export const INVOKE_CHANNEL = 'phantom:invoke';
export const EVENT_CHANNEL = 'phantom:event';
export const HOST_METHODS = new Set([
  'system.info', 'state.get', 'settings.update',
  'workspace.open', 'workspace.select', 'workspace.update', 'workspace.relocate',
  'node.create', 'node.update', 'node.remove',
  'terminal.create', 'terminal.list', 'terminal.attach', 'terminal.write', 'terminal.resize', 'terminal.stop', 'terminal.close',
  'task.create', 'task.update', 'task.remove', 'mission.create', 'mission.update', 'mission.remove',
  'workflow.save', 'workflow.remove', 'context.pin', 'context.unpin', 'context.scan', 'context.read',
  'attention.list', 'attention.ack', 'attention.create', 'storage.export', 'storage.import', 'host.shutdown',
  'git.inspect', 'services.list', 'services.pin', 'services.remove', 'docker.list', 'docker.logs', 'docker.action',
  'phantom.list', 'phantom.detail', 'phantom.create', 'phantom.update', 'phantom.control',
  'automation.start', 'automation.list', 'automation.stop', 'automation.trace',
  'playground.run', 'playground.stop', 'playground.list', 'voice.transcribe', 'voice.intent',
]);
export const LOCAL_METHODS = new Set([
  'dialog.openFolder', 'dialog.openFile', 'desktop.openPath', 'desktop.openExternal',
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
  return /^(?:ECONN\w*|EPIPE|ENOTCONN|ETIMEDOUT)$/.test(error?.code || '')
    || /^(?:Host (?:disconnected|connection timed out|startup failed|unavailable|client closed|request timed out|no disponible|no responde)|Socket (?:closed|disconnected))\b/i.test(error?.message || '');
}

export function browserURL(value, { external = false } = {}) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('URL no válida');
  if (!external && value === 'about:blank') return value;
  let url;
  try { url = new URL(value); } catch { throw new Error('Usa una URL http:// o https://'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Solo se permite HTTP(S) sin credenciales');
  return url.href;
}

// Agent RPC is deliberately narrower than renderer IPC. No method names, source
// code, filesystem paths or Electron options supplied by the caller are executed.
export function validateBrowserAgentRequest(command, payload) {
  const fields = {
    preview: ['url'], open: ['url'], status: [], context: [], read: ['selector'],
    click: ['selector'], fill: ['selector', 'value'], screenshot: ['name'], console: [],
  };
  if (!Object.hasOwn(fields, command)) throw new Error('Comando de navegador no permitido');
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Payload debe ser objeto');
  validateJSON(payload, 96 * 1024);
  const allowed = [...fields[command], 'id', 'key', 'timeoutMs'];
  if (Object.keys(payload).some(key => !allowed.includes(key))) throw new Error('Campo de navegador no permitido');
  if (payload.id !== undefined) validateID(payload.id);
  if (payload.key !== undefined && (typeof payload.key !== 'string' || !/^[\w.-]{1,128}$/.test(payload.key))) throw new Error('Clave de idempotencia no válida');
  if (['open', 'preview'].includes(command)) browserURL(payload.url, { external: true });
  if (['click', 'fill'].includes(command) || payload.selector !== undefined) {
    if (typeof payload.selector !== 'string' || !payload.selector.trim() || payload.selector.length > 2000 || /[\u0000-\u001f\u007f]/.test(payload.selector)) throw new Error('Selector CSS no válido');
  }
  if (command === 'fill' && (typeof payload.value !== 'string' || payload.value.length > 16000 || /[\u0000\u001b\u007f]/.test(payload.value))) throw new Error('Valor de formulario no válido');
  if (payload.name !== undefined && (typeof payload.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.png$/.test(payload.name))) throw new Error('Nombre PNG no válido; no se admiten rutas');
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
