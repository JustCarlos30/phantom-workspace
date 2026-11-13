import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { Chats } from './chats.mjs';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const check = (value, message = 'Solicitud no válida') => { if (!value) fail(400, message); };
const string = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };

export function mobileInterfaces() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => entries
    .filter(item => item.family === 'IPv4' && !item.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address))
    .map(item => ({ name, address: item.address })));
}

// No source-tree fallback. Freeze the build's canonical asset allowlist at activation.
function buildAssets(root) {
  check(fs.realpathSync(root) === path.resolve(root), 'El build no puede ser un enlace');
  const assets = new Map();
  function add(relative, route) {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    check(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync(file) === file, 'Asset no canónico');
    assets.set(route, { file, stat, type: relative === 'index.html' ? 'text/html; charset=utf-8' : MIME[path.extname(file)] });
  }
  add('index.html', '/mobile');
  function walk(relative) {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const next = path.join(relative, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) walk(next);
      else if (item.isFile() && MIME[path.extname(next)]) add(next, '/' + next.split(path.sep).join('/'));
    }
  }
  walk('assets');
  return assets;
}

function chatView(view) {
  return {
    provider: view.provider, running: !!view.running,
    truncated: (view.messages || []).length > 200 || (view.messages || []).some(m => (m.parts || []).length > 100),
    messages: (view.messages || []).slice(-200).map(message => ({
      ...pick(message, ['id', 'role', 'status', 'error']),
      parts: (message.parts || []).slice(0, 100).map(part => {
        if (part.type === 'question') return { ...pick(part, ['type', 'id', 'status']), questions: (part.questions || []).map(q => ({ question: String(q.question).slice(0, 4000), options: (q.options || []).map(o => pick(o, ['label', 'description'])), multiple: !!q.multiple })) };
        return pick(part, ['type', 'id', 'text', 'name', 'tool', 'detail', 'status', 'reason']);
      }),
    })),
    queue: (view.queue || []).map(item => pick(item, ['id', 'text'])),
  };
}

export class MobileAccess {
  constructor({ store, terminals, chats, distDir = DIST, now = Date.now, pairingTTL = 120000, sessionTTL = 8 * 3600000 }) {
    Object.assign(this, { store, terminals, chats, distDir, now, pairingTTL, sessionTTL });
    this.devices = new Map(); this.sockets = new Set(); this.active = 0; this.pairAttempts = [];
  }
  status() {
    this.expire();
    return { enabled: !!this.server, interfaces: mobileInterfaces(), workspaceId: this.workspaceId ?? null,
      url: this.origin ? `${this.origin}/mobile` : null,
      pairingExpiresAt: this.pair?.expiresAt ?? null,
      devices: [...this.devices.values()].map(d => pick(d, ['id', 'name', 'createdAt', 'expiresAt', 'lastSeenAt'])) };
  }
  expire() {
    if (this.pair && this.pair.expiresAt <= this.now()) this.pair = null;
    for (const [key, device] of this.devices) if (device.expiresAt <= this.now()) this.removeDevice(key);
  }
  pairing() {
    check(this.server, 'Activa primero el acceso móvil');
    const code = secret(); this.pair = { digest: hash(code), expiresAt: this.now() + this.pairingTTL };
    return { code, expiresAt: this.pair.expiresAt };
  }
  async start({ workspaceId, address, port = 0 } = {}) {
    check(!this.server && !this.starting && !this.stopping, 'El acceso móvil ya está activo o cambiando de estado');
    this.store.getWorkspace(workspaceId);
    check(address === '127.0.0.1' || mobileInterfaces().some(item => item.address === address), 'Elige una interfaz LAN IPv4 privada detectada');
    check(Number.isInteger(port) && (port === 0 || (port >= 1024 && port <= 65535)), 'Puerto no válido');
    this.starting = true;
    let finishStart; this.startDone = new Promise(resolve => { finishStart = resolve; });
    try {
      this.assets = buildAssets(this.distDir);
      this.workspaceId = workspaceId;
      const server = http.createServer((req, res) => this.handle(req, res));
      server.requestTimeout = 10000; server.headersTimeout = 5000; server.keepAliveTimeout = 2000; server.maxRequestsPerSocket = 100;
      server.on('connection', socket => {
        if (this.sockets.size >= 32) { socket.destroy(); return; }
        this.sockets.add(socket); socket.setTimeout(15000, () => socket.destroy());
        socket.on('close', () => this.sockets.delete(socket));
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, address, resolve); });
      this.server = server; this.origin = `http://${address}:${server.address().port}`;
      this.timer = setInterval(() => this.expire(), 1000); this.timer.unref();
      return { ...this.status(), pairing: this.pairing() };
    } finally { this.starting = false; finishStart(); }
  }
  removeDevice(key) {
    const device = this.devices.get(key); this.devices.delete(key);
    for (const socket of this.sockets) if (socket.mobileDevices?.has(device?.id)) socket.destroy();
  }
  revoke({ id } = {}) {
    check(string(id), 'Dispositivo no válido');
    for (const [key, device] of this.devices) if (device.id === id) this.removeDevice(key);
    return this.status();
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this.starting) await this.startDone;
      clearInterval(this.timer); this.pair = null; this.devices.clear(); this.pairAttempts = [];
      const server = this.server; this.server = null; this.origin = null; this.workspaceId = null;
      for (const socket of this.sockets) socket.destroy();
      if (server) await new Promise(resolve => server.close(resolve));
      return this.status();
    })();
    try { return await this.stopping; } finally { this.stopping = null; }
  }
  async body(req) {
    check(req.headers['content-type'] === 'application/json', 'Se requiere JSON');
    if (Number(req.headers['content-length']) > 65536) fail(413, 'Entrada demasiado grande');
    let size = 0, chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 65536) fail(413, 'Entrada demasiado grande'); chunks.push(chunk); }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, 'JSON no válido'); }
    check(value && typeof value === 'object' && !Array.isArray(value)); return value;
  }
  async handle(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Connection', 'close');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    let counted = false;
    const json = (status, value) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); } };
    try {
      if (!this.server || req.headers.host !== new URL(this.origin).host || (req.headers.origin && req.headers.origin !== this.origin) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) fail(403, 'Origen no autorizado');
      if (this.active >= 8) fail(429, 'Demasiadas solicitudes simultáneas');
      this.active++; counted = true; this.expire();
      if (req.method === 'GET') {
        const asset = this.assets.get(req.url);
        if (!asset) fail(404, 'Ruta no disponible');
        if (fs.realpathSync(asset.file) !== asset.file) fail(404, 'Asset no disponible');
        const fd = fs.openSync(asset.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const stat = fs.fstatSync(fd);
          if (!stat.isFile() || ['ino', 'dev', 'size', 'mtimeMs'].some(k => stat[k] !== asset.stat[k])) fail(404, 'El build cambió; reactiva el acceso');
          res.writeHead(200, { 'Content-Type': asset.type }); res.end(fs.readFileSync(fd));
        } finally { fs.closeSync(fd); }
        return;
      }
      if (req.method !== 'POST' || req.headers.origin !== this.origin) fail(403, 'Origen no autorizado');
      if (req.url === '/api/pair') {
        this.pairAttempts = this.pairAttempts.filter(time => time > this.now() - 60000);
        if (this.pairAttempts.length >= 10) fail(429, 'Demasiados intentos; espera un minuto');
        this.pairAttempts.push(this.now());
        const body = await this.body(req);
        this.expire();
        if (!this.server) fail(401, 'Acceso desactivado');
        if (!string(body.code, 128) || !this.pair || !timingSafeEqual(Buffer.from(hash(body.code)), Buffer.from(this.pair.digest))) fail(401, 'Código caducado, usado o incorrecto; genera otro en Ajustes');
        if (this.devices.size >= 8) fail(429, 'Revoca un dispositivo antes de emparejar otro');
        this.pair = null;
        const token = secret(), device = { id: randomUUID(), name: typeof body.name === 'string' ? body.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) : 'Móvil', createdAt: this.now(), expiresAt: this.now() + this.sessionTTL, lastSeenAt: this.now(), requests: [], actions: new Map() };
        this.devices.set(hash(token), device); (req.socket.mobileDevices ??= new Set()).add(device.id);
        json(200, { token, expiresAt: device.expiresAt }); return;
      }
      if (req.url !== '/api/rpc') fail(404, 'Ruta no disponible');
      const authorization = req.headers.authorization || '';
      const device = /^Bearer [A-Za-z0-9_-]{43}$/.test(authorization) && this.devices.get(hash(authorization.slice(7)));
      if (!device) fail(401, 'Acceso caducado o revocado; vuelve a emparejar');
      (req.socket.mobileDevices ??= new Set()).add(device.id); device.lastSeenAt = this.now();
      device.requests = device.requests.filter(time => time > this.now() - 60000);
      if (device.requests.length >= 120) fail(429, 'Demasiadas solicitudes; reconecta en un minuto');
      device.requests.push(this.now());
      const body = await this.body(req);
      // Re-check after body I/O: a desktop revocation/stop cannot authorize a queued write.
      if (!this.devices.has(hash(authorization.slice(7))) || device.expiresAt <= this.now()) fail(401, 'Acceso revocado');
      const result = await this.rpc(body, device);
      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) fail(413, 'Hilo demasiado grande para móvil; consulta el escritorio');
      json(200, { result });
    } catch (error) { json(error.status || 400, { error: error.status ? error.message : 'La operación no se pudo completar; consulta la sesión en escritorio' }); }
    finally { if (counted) this.active--; }
  }
  workspace() { return this.store.getWorkspace(this.workspaceId); }
  node(id) {
    const w = this.workspace();
    const node = id === Chats.mainId(w) ? this.chats.mainNode(w) : w.nodes.find(item => item.id === id);
    if (!node || node.type !== 'terminal') fail(403, 'Sesión fuera del proyecto autorizado');
    return node;
  }
  session(id) {
    const session = this.terminals.sessions.find(item => item.id === id && item.workspaceId === this.workspaceId);
    if (!session) fail(403, 'Sesión fuera del proyecto autorizado');
    this.node(session.nodeId); return session;
  }
  async rpc({ method, payload = {}, requestId }, device) {
    check(string(method, 128), 'Método no válido');
    check(payload && typeof payload === 'object' && !Array.isArray(payload));
    if (payload.workspaceId !== undefined && payload.workspaceId !== this.workspaceId) fail(403, 'Proyecto no autorizado');
    if (method === 'sessions.list') {
      check(Object.keys(payload).every(key => key === 'workspaceId'));
      const w = this.workspace();
      const nodes = [this.chats.mainNode(w), ...w.nodes.filter(n => n.type === 'terminal')];
      return { workspace: { id: w.id, name: w.name }, sessions: nodes.map(n => ({ nodeId: n.id, title: n.title, kind: n.data?.chat?.provider ? 'chat' : 'terminal', provider: n.data?.chat?.provider ?? null,
        terminals: this.terminals.sessions.filter(s => s.workspaceId === w.id && s.nodeId === n.id).map(s => pick(s, ['id', 'status', 'createdAt'])) })) };
    }
    const allowed = {
      'chat.get': ['nodeId'], 'chat.send': ['nodeId', 'text'], 'chat.stop': ['nodeId'],
      'chat.permission.answer': ['nodeId', 'requestId', 'decision'], 'chat.question.answer': ['nodeId', 'requestId', 'answers'],
      'terminal.list': [], 'terminal.attach': ['sessionId'], 'terminal.write': ['sessionId', 'data'], 'terminal.stop': ['sessionId'],
    };
    if (!Object.hasOwn(allowed, method)) fail(403, 'Método móvil no permitido');
    check(Object.keys(payload).every(key => [...allowed[method], 'workspaceId'].includes(key)), 'Campo no permitido');
    const node = method.startsWith('chat.') ? this.node(payload.nodeId) : null;
    if (node) check(node.data?.chat?.provider, 'Esta sesión no tiene chat configurado');
    if (method.startsWith('terminal.') && method !== 'terminal.list') this.session(payload.sessionId);
    if (method === 'chat.get') return chatView(this.chats.get(node));
    if (method === 'terminal.list') return this.terminals.sessions.filter(s => s.workspaceId === this.workspaceId && this.workspace().nodes.some(n => n.id === s.nodeId)).map(s => pick(s, ['id', 'nodeId', 'status', 'createdAt']));
    if (method === 'terminal.attach') {
      // Plain, bounded screen snapshot, replaced on each poll rather than replayed.
      const view = await this.terminals.tail(payload.sessionId, 40);
      return pick(view, ['status', 'seq', 'lines', 'text']);
    }
    check(string(requestId, 128), 'Cada acción requiere una identidad');
    const signature = JSON.stringify({ method, payload }), existing = device.actions.get(requestId);
    if (existing) { check(existing.signature === signature, 'Identidad de acción reutilizada'); return existing.promise; }
    // Never evict a recorded action during the bearer lifetime: an uncertain
    // response must not turn into a second write. Re-pair when this budget is spent.
    if (device.actions.size >= 256) fail(429, 'Límite de acciones alcanzado; vuelve a emparejar');
    const promise = Promise.resolve().then(async () => {
      if (![...this.devices.values()].includes(device) || device.expiresAt <= this.now()) fail(401, 'Acceso revocado');
      const current = node ? this.node(payload.nodeId) : null;
      if (method.startsWith('terminal.')) this.session(payload.sessionId);
      if (method === 'chat.send') { check(string(payload.text, 32000) && payload.text.trim()); await this.chats.send(this.workspace(), current, payload.text); }
      if (method === 'chat.stop') await this.chats.stop(current.id);
      if (method === 'chat.permission.answer') { check(['allow', 'deny'].includes(payload.decision)); await this.chats.answerPermission(current, payload.requestId, payload.decision); }
      if (method === 'chat.question.answer') await this.chats.answerQuestion(current, payload.requestId, payload.answers === undefined ? null : payload.answers);
      if (method === 'terminal.write') { check(string(payload.data, 16000)); await this.terminals.write(payload.sessionId, payload.data); }
      if (method === 'terminal.stop') await this.terminals.stop(payload.sessionId);
      return { ok: true };
    });
    device.actions.set(requestId, { signature, promise }); return promise;
  }
}
