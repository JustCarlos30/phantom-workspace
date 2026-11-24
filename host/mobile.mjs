import https from 'node:https';
import os from 'node:os';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Chats } from './chats.mjs';
import { loadIdentity } from './mobile-identity.mjs';
import { MobileAudit } from './mobile-audit.mjs';
import { secret, hash, fail, check, string, exact, deviceKey, challenge, verifyProof, bounded } from './mobile-auth.mjs';

const pick = (v, keys) => Object.fromEntries(keys.filter(k => v?.[k] !== undefined).map(k => [k, v[k]]));
const READ = new Set(['sessions.list', 'terminal.list', 'chat.get', 'terminal.attach']);
export const CAPABILITIES = ['read', 'chat.send', 'terminal.write', 'chat.stop', 'terminal.stop', 'chat.permission.answer', 'chat.question.answer'];
const MIGRATION_STYLE = ':root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0910;color:#eee9f4;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:760px;margin:auto;padding:24px 16px;overflow-wrap:anywhere}h1{font-size:22px;letter-spacing:-.025em}h2{font-size:18px}p{color:#a69bb7}';
const STYLE_HASH = Buffer.from(hash(MIGRATION_STYLE), 'hex').toString('base64');
export const MIGRATION_PAGE = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phantom · acceso móvil</title><style>${MIGRATION_STYLE}</style><main><h1>Phantom</h1><h2>Se necesita la app nativa</h2><p>El acceso móvil está migrando al protocolo seguro v2. El navegador no permite operar sesiones ni vincular dispositivos.</p><p>La futura app oficial fijará el certificado verificado desde el escritorio y firmará cada acción con autenticación biométrica del sistema. Esta fase implementa la base de seguridad; la app nativa todavía no está disponible.</p></main></html>`;
export function mobileInterfaces() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => entries.filter(i => i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)).map(i => ({ name, address: i.address })));
}
function chatView(view) {
  // Bound before traversing or serializing user/model text; never copy metadata.
  const result = { provider: view.provider, running: !!view.running, truncated: (view.messages || []).length > 100 || (view.messages || []).slice(-100).some(m => (m.parts || []).length > 40),
    messages: (view.messages || []).slice(-100).map(m => ({ ...pick(m, ['id', 'role', 'status']), parts: (m.parts || []).slice(0, 40).map(p => {
      const part = pick(p, ['type', 'id', 'text', 'name', 'tool', 'detail', 'status', 'reason']);
      if (p.type === 'question') {
        bounded(p.questions, 32000);
        part.questions = (p.questions || []).slice(0, 20).map(q => ({ ...pick(q, ['question', 'multiple']), options: (q.options || []).slice(0, 20).map(o => pick(o, ['label', 'description'])) }));
      }
      return part;
    }) })) };
  bounded(result); return result;
}

export class MobileAccess {
  constructor({ store, terminals, chats, dataDir, now = Date.now, pairingTTL = 120000, sessionTTL = 3600000 }) {
    Object.assign(this, { store, terminals, chats, dataDir, now });
    this.pairingTTL = Math.min(pairingTTL, 120000); this.sessionTTL = Math.min(sessionTTL, 3600000);
    this.auditLog = new MobileAudit(dataDir);
    this.devices = new Map(); this.challenges = new Map(); this.sessions = new Map(); this.buckets = new Map(); this.sockets = new Set(); this.secureSockets = new Set(); this.active = 0;
  }
  event(method, outcome, reason, device, extra = {}) {
    try { this.auditLog.append({ timestamp: this.now(), workspaceId: this.workspaceId, deviceId: device?.id, method, outcome, reason, ...extra }); this.auditError = null; }
    catch { this.auditError = 'No se pudo registrar la auditoría; consulta el escritorio'; fail(503, this.auditError); }
  }
  expire() {
    const now = this.now();
    if (this.pair?.expiresAt <= now) this.pair = null;
    for (const [id, c] of this.challenges) if (c.expiresAt <= now) this.challenges.delete(id);
    for (const [key, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(key);
    for (const [key, b] of this.buckets) if (b.until <= now) this.buckets.delete(key);
    for (const [id, d] of this.devices) if (d.state !== 'approved' && d.createdAt + 120000 <= now) this.devices.delete(id);
  }
  status() {
    this.expire();
    let auditError = this.auditError || null, activity = [];
    try { activity = this.auditLog.list(); } catch { auditError = 'No se puede leer la auditoría'; }
    return { enabled: !!this.server, interfaces: mobileInterfaces(), workspaceId: this.workspaceId ?? null, url: this.origin ? `${this.origin}/mobile` : null,
      identity: this.tls?.public ?? null, pairingExpiresAt: this.pair?.expiresAt ?? null, capabilities: CAPABILITIES,
      nodes: this.workspaceId ? [this.chats.mainNode(this.workspace()), ...this.workspace().nodes.filter(n => n.type === 'terminal')].map(n => ({ id: n.id, title: n.title, main: n.id === Chats.mainId(this.workspace()) || n.data?.role === 'orchestrator' })) : [],
      devices: [...this.devices.values()].map(d => pick(d, ['id', 'name', 'fingerprint', 'state', 'createdAt', 'lastAuthenticatedAt', 'permissionVersion', 'grants'])), activity, auditError };
  }
  pairing() {
    check(this.server, 'Activa primero el acceso móvil');
    const code = secret(); this.event('pairing', 'issued', 'desktop');
    this.pair = { digest: hash(code), expiresAt: this.now() + this.pairingTTL }; return { code, expiresAt: this.pair.expiresAt };
  }
  async identity({ regenerate = false, address } = {}) {
    check(typeof regenerate === 'boolean');
    if (!regenerate) return this.tls?.public ?? null;
    check(!this.server && !this.starting && !this.stopping && !this.identityChanging, 'Desactiva antes de regenerar la identidad');
    this.validAddress(address);
    this.event('identity', 'regenerated', 'desktop'); this.clearAccess();
    this.identityChanging = true;
    try { this.tls = await loadIdentity(this.dataDir, address, true); return this.tls.public; }
    finally { this.identityChanging = false; }
  }
  validAddress(address) { check(address === '127.0.0.1' || mobileInterfaces().some(i => i.address === address), 'Elige una interfaz LAN IPv4 privada detectada'); }
  async start({ workspaceId, address, port = 0 } = {}) {
    check(!this.server && !this.starting && !this.stopping && !this.identityChanging, 'El acceso móvil ya está activo o cambiando de estado');
    this.store.getWorkspace(workspaceId); this.validAddress(address);
    check(Number.isInteger(port) && (port === 0 || port >= 1024 && port <= 65535), 'Puerto no válido');
    this.starting = true;
    let finish; this.startDone = new Promise(resolve => { finish = resolve; });
    let server;
    try {
      this.tls = await loadIdentity(this.dataDir, address);
      server = https.createServer({ key: this.tls.key, cert: this.tls.cert, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3' }, (req, res) => this.handle(req, res));
      server.requestTimeout = 10000; server.headersTimeout = 5000; server.keepAliveTimeout = 2000; server.maxRequestsPerSocket = 100; server.maxHeadersCount = 32;
      server.on('connection', socket => {
        if (this.sockets.size >= 32) { socket.destroy(); return; }
        this.sockets.add(socket); socket.setTimeout(15000, () => socket.destroy()); socket.on('close', () => this.sockets.delete(socket));
      });
      server.on('secureConnection', socket => { this.secureSockets.add(socket); socket.on('close', () => this.secureSockets.delete(socket)); });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, address, resolve); });
      this.workspaceId = workspaceId; this.server = server; this.origin = `https://${address}:${server.address().port}`;
      this.timer = setInterval(() => this.expire(), 1000); this.timer.unref();
      return { ...this.status(), pairing: this.pairing() };
    } catch (e) {
      clearInterval(this.timer); this.clearAccess(); this.server = null; this.origin = null; this.workspaceId = null;
      for (const socket of this.sockets) socket.destroy();
      if (server?.listening) await new Promise(resolve => server.close(resolve)); throw e;
    }
    finally { this.starting = false; finish(); }
  }
  clearAccess() { this.pair = null; this.devices.clear(); this.sessions.clear(); this.challenges.clear(); this.buckets.clear(); }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this.starting) await this.startDone;
      clearInterval(this.timer); this.clearAccess(); const server = this.server; this.server = null; this.origin = null; this.workspaceId = null;
      for (const socket of this.sockets) socket.destroy();
      if (server) await new Promise(resolve => server.close(resolve)); return this.status();
    })();
    try { return await this.stopping; } finally { this.stopping = null; }
  }
  revoke({ id } = {}) {
    check(string(id)); const d = this.devices.get(id); let auditError;
    try { this.event('revoke', 'revoked', 'desktop', d); } catch (e) { auditError = e; }
    this.devices.delete(id);
    for (const [key, s] of this.sessions) if (s.deviceId === id) this.sessions.delete(key);
    for (const [key, c] of this.challenges) if (c.deviceId === id) this.challenges.delete(key);
    for (const socket of this.secureSockets) if (socket.mobileDevice === id) socket.destroy();
    if (auditError) throw auditError; return this.status();
  }
  permissions({ id, grants, acknowledgeAgentAuthority = false } = {}, approving = false) {
    const d = this.devices.get(id); check(d && (approving ? d.state === 'pending' : d.state === 'approved'), 'Dispositivo no disponible');
    check(Array.isArray(grants) && grants.length <= 64, 'Selecciona sesiones y capacidades explícitamente');
    const normalized = [], seen = new Set(), authorityNodes = new Set();
    for (const g of grants) {
      exact(g, ['nodeId', 'capabilities']); const node = this.node(g.nodeId);
      check(!seen.has(g.nodeId)); seen.add(g.nodeId);
      check(Array.isArray(g.capabilities) && g.capabilities.length > 0 && g.capabilities.length <= CAPABILITIES.length && g.capabilities.every(c => CAPABILITIES.includes(c)) && g.capabilities.includes('read'));
      if (node.id === Chats.mainId(this.workspace()) || node.data?.role === 'orchestrator') {
        check(acknowledgeAgentAuthority === true, 'El orquestador actúa con permisos reales del agente; confirma expresamente'); authorityNodes.add(node.id);
      }
      normalized.push({ nodeId: g.nodeId, capabilities: [...new Set(g.capabilities)] });
    }
    this.event(approving ? 'approve' : 'grants', 'accepted', 'desktop', d);
    d.grants = normalized; d.authorityNodes = authorityNodes; d.permissionVersion++; d.state = 'approved';
    for (const [key, c] of this.challenges) if (c.deviceId === id) this.challenges.delete(key);
    return this.status();
  }
  approve(p) { return this.permissions(p, true); }
  audit() { return this.auditLog.list(); }
  bucket(category, key, limit) {
    const id = `${category}:${key}`; let b = this.buckets.get(id);
    if (!b) { if (this.buckets.size >= 2048) fail(429, 'Límite temporal de clientes'); b = { count: 0, until: this.now() + 60000 }; this.buckets.set(id, b); }
    if (++b.count > limit) fail(429, 'Demasiadas solicitudes; espera un minuto');
  }
  issue(fields) {
    if (this.challenges.size >= 128) fail(429, 'Demasiados desafíos pendientes');
    const c = challenge(this.tls.public, this.now(), fields); this.challenges.set(c.challengeId, c);
    return pick(c, ['challengeId', 'bytes', 'expiresAt']);
  }
  consume(body, kind, device) {
    exact(body, ['challengeId', 'signature']);
    const c = this.challenges.get(body.challengeId);
    if (!c || c.kind !== kind || c.expiresAt <= this.now() || c.deviceId !== device.id || c.hostId !== this.tls.public.hostId || c.fingerprint !== this.tls.public.fingerprint || c.workspaceId !== this.workspaceId) fail(401, 'Desafío caducado, consumido o ajeno');
    // Consume even a failed proof. One challenge, one attempt, no async gap.
    this.challenges.delete(c.challengeId); verifyProof(device.key, c.bytes, body.signature); return c;
  }
  session(req, allowIdle = false) {
    const auth = req.headers.authorization || '';
    const s = /^Bearer [A-Za-z0-9_-]{43}$/.test(auth) && this.sessions.get(hash(auth.slice(7)));
    const d = s && this.devices.get(s.deviceId);
    if (!d || d.state !== 'approved' || s.expiresAt <= this.now() || (!allowIdle && this.now() - s.authenticatedAt >= 600000)) fail(401, 'Acceso bloqueado, caducado o revocado; firma un nuevo inicio de sesión');
    req.socket.mobileDevice = d.id; return { d, s };
  }
  async body(req) {
    check(req.headers['content-type'] === 'application/json', 'Se requiere JSON');
    if (Number(req.headers['content-length']) > 65536) fail(413, 'Entrada demasiado grande');
    let size = 0; const chunks = [];
    // A normal async iterator destroys the stream when the size check throws,
    // preventing the peer from receiving the 413 response. Keep the stream open
    // for that response; Connection: close and server timeouts bound its life.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > 65536) fail(413, 'Entrada demasiado grande'); chunks.push(chunk); }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, 'JSON no válido'); }
    exact(body, Object.keys(body || {})); bounded(body, 65536); return body;
  }
  async handle(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Connection', 'close');
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    let counted = false, device, auditMethod = 'transport', auditNode;
    const json = (status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); } };
    try {
      if (!this.server || req.headers.host !== new URL(this.origin).host || (req.headers.origin && req.headers.origin !== this.origin) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) fail(403, 'Origen no autorizado');
      if (this.active >= 8) fail(429, 'Demasiadas solicitudes simultáneas');
      counted = true; this.active++; this.expire();
      if (req.method === 'GET' && req.url === '/mobile') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(MIGRATION_PAGE); return; }
      if (req.method !== 'POST' || !req.url.startsWith('/api/v2/')) fail(404, 'Ruta no disponible');
      // Web pages never participate in native enrollment or action signing.
      if (req.headers.origin || req.headers['sec-fetch-mode']) fail(403, 'Se necesita la app nativa');
      const route = req.url.slice(8), ip = req.socket.remoteAddress;
      if (['pair', 'pair/prove', 'login', 'login/challenge', 'read', 'action', 'action/challenge', 'receipt'].includes(route)) auditMethod = route;
      if (['pair', 'pair/prove'].includes(route)) this.bucket('pair-ip', ip, 10);
      else if (['login/challenge', 'login'].includes(route)) this.bucket('auth-ip', ip, 30);
      else { ({ d: device } = this.session(req)); this.bucket('rpc-device', device.id, 120); this.bucket('rpc-ip', ip, 600); }
      const body = await this.body(req);
      if (!this.server) fail(401, 'Acceso desactivado');
      if (route === 'pair') {
        exact(body, ['code', 'name', 'publicKey']);
        if (!string(body.code, 128) || !this.pair || this.pair.expiresAt <= this.now() || !timingSafeEqual(Buffer.from(hash(body.code)), Buffer.from(this.pair.digest))) fail(401, 'Código caducado, usado o incorrecto');
        check(string(body.name, 80) && !/[\x00-\x1f\x7f]/.test(body.name));
        const key = deviceKey(body.publicKey);
        if (this.devices.size >= 8) fail(429, 'Revoca un dispositivo antes de emparejar otro');
        if (this.challenges.size >= 128) fail(429, 'Demasiados desafíos');
        const d = { id: randomUUID(), name: body.name, ...key, state: 'proving', createdAt: this.now(), grants: [], permissionVersion: 0, receipts: new Map() };
        this.event('pair', 'started', 'code-accepted', d); this.pair = null; this.devices.set(d.id, d);
        const proof = this.issue({ kind: 'pair', deviceId: d.id, workspaceId: this.workspaceId, nodeId: null, sessionId: null, method: 'pair', payload: { publicKey: body.publicKey, name: body.name }, requestId: randomUUID(), permissionVersion: 0 });
        json(200, { deviceId: d.id, ...proof }); return;
      }
      if (route === 'pair/prove') {
        exact(body, ['deviceId', 'challengeId', 'signature']); const d = this.devices.get(body.deviceId);
        if (!d || d.state !== 'proving') fail(401, 'Vinculación no disponible');
        device = d;
        this.consume(pick(body, ['challengeId', 'signature']), 'pair', d);
        this.event('pair', 'pending', 'proof-valid', d); d.state = 'pending'; d.createdAt = this.now();
        json(200, { deviceId: d.id, state: 'pending', requiresDesktopApproval: true }); return;
      }
      if (route === 'login/challenge') {
        exact(body, ['deviceId']); const d = this.devices.get(body.deviceId);
        if (!d || d.state !== 'approved') fail(401, 'Requiere aprobación en escritorio');
        device = d;
        this.bucket('auth-device', d.id, 15);
        json(200, this.issue({ kind: 'login', deviceId: d.id, workspaceId: this.workspaceId, nodeId: null, sessionId: null, method: 'login', payload: {}, requestId: randomUUID(), permissionVersion: d.permissionVersion })); return;
      }
      if (route === 'login') {
        exact(body, ['deviceId', 'challengeId', 'signature']); const d = this.devices.get(body.deviceId);
        if (!d || d.state !== 'approved') fail(401, 'Dispositivo revocado o no aprobado');
        device = d;
        const c = this.consume(pick(body, ['challengeId', 'signature']), 'login', d); check(c.permissionVersion === d.permissionVersion, 'Permisos cambiados');
        if (this.sessions.size >= 64) fail(429, 'Demasiadas sesiones');
        this.event('login', 'accepted', 'signature-valid', d);
        for (const [key, s] of this.sessions) if (s.deviceId === d.id) this.sessions.delete(key);
        const token = secret(), s = { deviceId: d.id, authenticatedAt: this.now(), expiresAt: this.now() + this.sessionTTL };
        this.sessions.set(hash(token), s); d.lastAuthenticatedAt = this.now(); json(200, { token, expiresAt: s.expiresAt, idleExpiresAt: s.authenticatedAt + 600000 }); return;
      }
      // Recheck after body I/O: revoke/stop/grants may have run meanwhile.
      const { d, s } = this.session(req); device = d;
      if (route === 'read') {
        exact(body, ['method', 'payload']); const p = body.payload ?? {}; const node = this.authorize(d, body.method, p, true);
        auditMethod = body.method; auditNode = node?.id;
        const permissionVersion = d.permissionVersion;
        const result = await this.read(body.method, p, d); this.session(req);
        if (d.permissionVersion !== permissionVersion) fail(403, 'Los permisos cambiaron durante la lectura');
        this.authorize(d, body.method, p, true); bounded(result); json(200, { result }); return;
      }
      if (route === 'action/challenge') {
        exact(body, ['method', 'payload', 'requestId']); check(string(body.requestId, 128) && /^[A-Za-z0-9_-]+$/.test(body.requestId), 'Identidad de acción no válida');
        const node = this.authorize(d, body.method, body.payload, false);
        auditMethod = body.method; auditNode = node.id;
        if (d.receipts.has(body.requestId)) fail(409, 'Consulta el recibo; no repitas la acción');
        if (d.receipts.size >= 256) fail(429, 'Límite de acciones alcanzado; revoca y vuelve a vincular');
        json(200, this.issue({ kind: 'action', deviceId: d.id, workspaceId: this.workspaceId, nodeId: node.id, sessionId: body.payload.sessionId ?? null, method: body.method, payload: body.payload, requestId: body.requestId, permissionVersion: d.permissionVersion })); return;
      }
      if (route === 'action') {
        const issued = this.challenges.get(body.challengeId);
        if (issued?.deviceId === d.id && issued.kind === 'action') { auditMethod = issued.method; auditNode = issued.nodeId; }
        const c = this.consume(body, 'action', d);
        check(c.permissionVersion === d.permissionVersion, 'Permisos cambiados');
        const node = this.authorize(d, c.method, c.payload, false);
        check(node.id === c.nodeId && (c.payload.sessionId ?? null) === c.sessionId, 'La sesión cambió de nodo; solicita otro desafío');
        if (d.receipts.has(c.requestId)) fail(409, 'Acción ya consumida; consulta el recibo');
        if (d.receipts.size >= 256) fail(429, 'Límite de acciones alcanzado');
        // Record before audit and effect, including failures. No automatic retry.
        const receipt = { requestId: c.requestId, state: 'pending' }; d.receipts.set(c.requestId, receipt);
        let admitted = false;
        try {
          this.event(c.method, 'admitted', 'signature-valid', d, { workspaceId: c.workspaceId, nodeId: node.id, requestId: c.requestId });
          admitted = true;
          // There is no await between this final scope check and invoking the effect.
          const pending = this.effect(c.method, c.payload, node);
          s.authenticatedAt = this.now(); d.lastAuthenticatedAt = this.now();
          await pending; receipt.state = 'completed';
          try { this.event(c.method, 'completed', 'effect-returned', d, { workspaceId: c.workspaceId, nodeId: node.id, requestId: c.requestId }); }
          catch { receipt.state = 'uncertain'; receipt.reason = 'audit-unavailable-after-effect'; fail(503, 'Efecto realizado; fallo de auditoría. Consulta el recibo y el escritorio; no repitas'); }
        } catch (e) {
          if (receipt.state === 'pending') {
            receipt.state = 'uncertain'; receipt.reason = !admitted ? 'audit-admission-failed' : 'effect-failed-or-uncertain';
            if (admitted) this.event(c.method, 'uncertain', 'effect-failed-or-uncertain', d, { workspaceId: c.workspaceId, nodeId: node.id, requestId: c.requestId });
          }
          throw e;
        }
        json(200, { receipt }); return;
      }
      if (route === 'receipt') { exact(body, ['requestId']); const receipt = d.receipts.get(body.requestId); if (!receipt) fail(404, 'Recibo no disponible'); json(200, { receipt }); return; }
      fail(404, 'Ruta no disponible');
    } catch (e) {
      try { this.event(auditMethod, 'rejected', `status-${e.status || 400}`, device, { nodeId: auditNode }); } catch { /* admission failures still deny */ }
      json(e.status || 400, { error: e.status ? e.message : 'La operación no se pudo completar; consulta el escritorio' });
    } finally { if (counted) this.active--; }
  }
  workspace() { return this.store.getWorkspace(this.workspaceId); }
  node(id) {
    const w = this.workspace(), n = id === Chats.mainId(w) ? this.chats.mainNode(w) : w.nodes.find(n => n.id === id);
    if (!n || n.type !== 'terminal') fail(403, 'Sesión fuera del proyecto autorizado'); return n;
  }
  terminal(id) {
    const s = this.terminals.sessions.find(s => s.id === id && s.workspaceId === this.workspaceId);
    if (!s) fail(403, 'Sesión fuera del proyecto autorizado'); this.node(s.nodeId); return s;
  }
  authorize(d, method, p, read) {
    if (!string(method, 128) || (read ? !READ.has(method) : !CAPABILITIES.includes(method) || method === 'read')) fail(403, 'Método móvil no permitido');
    const fields = { 'sessions.list': [], 'terminal.list': [], 'chat.get': ['nodeId'], 'terminal.attach': ['sessionId'], 'chat.send': ['nodeId', 'text'], 'chat.stop': ['nodeId'], 'terminal.write': ['sessionId', 'data'], 'terminal.stop': ['sessionId'], 'chat.permission.answer': ['nodeId', 'requestId', 'decision'], 'chat.question.answer': ['nodeId', 'requestId', 'answers'] };
    exact(p, [...fields[method], 'workspaceId']);
    if (p.workspaceId !== undefined && p.workspaceId !== this.workspaceId) fail(403, 'Proyecto no autorizado');
    if (method === 'sessions.list' || method === 'terminal.list') return null;
    const node = method.startsWith('chat.') ? this.node(p.nodeId) : this.node(this.terminal(p.sessionId).nodeId);
    if (!this.hasGrant(d, node, read ? 'read' : method)) fail(403, 'Nodo o capacidad no autorizados');
    if (method.startsWith('chat.')) check(node.data?.chat?.provider, 'Esta sesión no tiene chat configurado');
    if (method === 'chat.send') check(string(p.text, 32000) && p.text.trim());
    if (method === 'terminal.write') check(string(p.data, 16000));
    if (method === 'chat.permission.answer') check(string(p.requestId, 128) && ['allow', 'deny'].includes(p.decision));
    if (method === 'chat.question.answer') {
      check(string(p.requestId, 128));
      if (p.answers !== null) { exact(p.answers, Object.keys(p.answers || {})); check(Object.keys(p.answers).length <= 20 && Object.entries(p.answers).every(([k, v]) => string(k, 4000) && (string(v, 4000) || Array.isArray(v) && v.length <= 20 && v.every(x => string(x, 4000))))); }
    }
    return node;
  }
  async read(method, p, d) {
    const w = this.workspace(), nodes = [this.chats.mainNode(w), ...w.nodes.filter(n => n.type === 'terminal')].filter(n => this.hasGrant(d, n, 'read'));
    const ids = new Set(nodes.map(n => n.id));
    if (method === 'sessions.list') {
      return { workspace: pick(w, ['id', 'name']), sessions: nodes.map(n => ({ nodeId: n.id, title: n.title, kind: n.data?.chat?.provider ? 'chat' : 'terminal', provider: n.data?.chat?.provider ?? null,
        terminals: this.terminals.sessions.filter(s => s.workspaceId === w.id && s.nodeId === n.id).slice(0, 64).map(s => pick(s, ['id', 'status', 'createdAt'])) })) };
    }
    if (method === 'terminal.list') return this.terminals.sessions.filter(s => s.workspaceId === this.workspaceId && ids.has(s.nodeId)).slice(0, 256).map(s => pick(s, ['id', 'nodeId', 'status', 'createdAt']));
    if (method === 'chat.get') return chatView(this.chats.get(this.node(p.nodeId)));
    const v = await this.terminals.tail(p.sessionId, 40); const result = pick(v, ['status', 'seq', 'lines', 'text']); bounded(result); return result;
  }
  hasGrant(d, node, capability) {
    if ((node.id === Chats.mainId(this.workspace()) || node.data?.role === 'orchestrator') && !d.authorityNodes?.has(node.id)) return false;
    return d.grants.some(g => g.nodeId === node.id && g.capabilities.includes(capability));
  }
  effect(method, p, node) {
    if (method === 'chat.send') return this.chats.send(this.workspace(), node, p.text);
    if (method === 'chat.stop') return this.chats.stop(node.id);
    if (method === 'chat.permission.answer') return this.chats.answerPermission(node, p.requestId, p.decision);
    if (method === 'chat.question.answer') return this.chats.answerQuestion(node, p.requestId, p.answers);
    if (method === 'terminal.write') return this.terminals.write(p.sessionId, p.data);
    if (method === 'terminal.stop') return this.terminals.stop(p.sessionId);
    fail(403, 'Método móvil no permitido');
  }
}
