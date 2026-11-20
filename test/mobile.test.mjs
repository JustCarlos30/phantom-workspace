import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID, X509Certificate, createPublicKey, generateKeyPairSync, createHash, sign } from 'node:crypto';
import { createHost } from '../host/server.mjs';
import { HOST_METHODS } from '../desktop/security.mjs';
import { mobileTLS } from '../host/mobile-tls.mjs';
import { MobileAudit } from '../host/mobile-audit.mjs';

// Trust only the certificate generated for each fixture, never disable TLS verification.
const certificates = new Map();
const gateways = new Map(), deviceKeys = new Map();
const phone = () => { const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' }); return { ...keys, jwk: keys.publicKey.export({ format: 'jwk' }) }; };
function signed(origin, route, body, key, time = gateways.get(origin).now()) {
  const timestamp = String(time), raw = typeof body === 'string' ? body : JSON.stringify(body);
  return { 'X-Phantom-Time': timestamp, 'X-Phantom-Signature': sign('sha256', Buffer.from(`${timestamp}\n${route}\n${createHash('sha256').update(raw).digest('hex')}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
}
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { ...options, ca: certificates.get(new URL(url).origin), agent: false }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    request.on('error', reject); request.end(options.body);
  });
}

// All listeners bind loopback, all projects/profiles are synthetic. Only system
// OpenSSL is used; no shell, agent CLI, user profile or external model is started.
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-mobile-'));
  const distDir = path.join(root, 'dist'); fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Mobile fixture</title>');
  fs.writeFileSync(path.join(distDir, 'assets', 'fixture.js'), 'export const fixture = true;');
  fs.mkdirSync(path.join(root, 'project')); fs.mkdirSync(path.join(root, 'foreign'));
  let clock = 1000000;
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }), mobileOptions: { distDir, now: () => clock, ...options } });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const w = await host.invoke('workspace.open', { path: path.join(root, 'project') });
  const foreign = await host.invoke('workspace.open', { path: path.join(root, 'foreign') });
  const node = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', title: 'Local chat', data: { chat: { provider: 'claude' }, env: { secret: 'PRIVATE_ENV' }, worktree: { path: 'PRIVATE_WORKTREE' } } });
  const other = await host.invoke('node.create', { workspaceId: foreign.id, type: 'terminal', data: { chat: { provider: 'claude' } } });
  let writes = 0;
  host.chats.get = () => ({ provider: 'claude', running: false, messages: [{ id: 'fixture-message', role: 'assistant', parts: [{ type: 'text', text: 'Fixture response' }], status: 'done' }], meta: { secret: 'PRIVATE_META' } });
  host.chats.send = async () => { writes++; return { ok: true, private: 'PRIVATE_RESULT' }; };
  const start = async () => {
    const status = await host.invoke('mobile.start', { workspaceId: w.id, address: '127.0.0.1', port: 0 });
    const origin = new URL(status.url).origin;
    certificates.set(origin, fs.readFileSync(path.join(root, 'state', 'mobile-tls', 'cert.pem')));
    gateways.set(origin, { host, now: () => clock });
    t.after(() => { certificates.delete(origin); gateways.delete(origin); });
    return status;
  };
  return { root, distDir, host, w, foreign, node, other, start, advance: ms => { clock += ms; }, writes: () => writes };
}
async function rawPost(origin, route, body, token, headers = {}) {
  const response = await fetch(origin + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function post(origin, route, body, token, headers = {}) {
  if (route === '/api/pair' && body && typeof body === 'object' && !Object.hasOwn(body, 'publicKey')) {
    const keys = phone(), requested = await rawPost(origin, route, { ...body, publicKey: keys.jwk }, token, headers);
    if (requested.status !== 200) return requested;
    await gateways.get(origin).host.invoke('mobile.approve', { id: requested.data.requestId });
    const approved = await rawPost(origin, '/api/pair/status', { requestId: requested.data.requestId, poll: requested.data.poll });
    if (approved.status === 200) deviceKeys.set(approved.data.token, keys.privateKey);
    return approved;
  }
  return rawPost(origin, route, body, token, { ...(route === '/api/rpc' && deviceKeys.has(token) ? signed(origin, route, body, deviceKeys.get(token)) : {}), ...headers });
}
async function authorized(f) {
  const status = await f.start(), origin = new URL(status.url).origin;
  const paired = await post(origin, '/api/pair', { code: status.pairing.code, name: 'Test phone' });
  assert.equal(paired.status, 200);
  const token = paired.data.token;
  return { origin, token, rpc: (method, payload = {}, requestId = randomUUID()) => post(origin, '/api/rpc', { method, payload, requestId }, token) };
}
function raw(origin, url, headers = {}) {
  return new Promise((resolve, reject) => {
    // A forged HTTP Host must reach the gateway's Host check. Verify TLS against
    // the actual destination IP, independently of that deliberately forged header.
    const request = https.request(origin, { path: url, headers, ca: certificates.get(origin), agent: false, servername: '', checkServerIdentity: (_name, cert) => tls.checkServerIdentity(new URL(origin).hostname, cert) }, response => { let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body })); });
    request.on('error', reject); request.end();
  });
}

test('mobile is opt-in, desktop-only management, start/stop and restart forget access', async t => {
  const f = await fixture(t);
  assert.equal((await f.host.invoke('mobile.status')).enabled, false);
  for (const method of ['status', 'start', 'stop', 'pairing', 'revoke', 'approve', 'reject']) assert.ok(HOST_METHODS.has(`mobile.${method}`));
  const started = await f.start(); assert.match(started.url, /^https:\/\/127\.0\.0\.1:\d+\/mobile$/);
  await assert.rejects(f.start(), /activo/);
  await f.host.invoke('mobile.stop'); assert.equal((await f.host.invoke('mobile.status')).enabled, false);
  await assert.rejects(fetch(started.url));
  await f.host.close();
  const restarted = await createHost({ dataDir: path.join(f.root, 'state'), handleIntegration: () => ({ handled: false }) });
  try { assert.equal((await restarted.invoke('mobile.status')).enabled, false); assert.deepEqual((await restarted.invoke('mobile.status')).devices, []); }
  finally { await restarted.close(); }
});

test('mobile rejects public, wildcard, hostname and invalid port bindings', async t => {
  const f = await fixture(t);
  for (const address of ['0.0.0.0', '8.8.8.8', 'localhost', '::', '192.0.2.1']) await assert.rejects(f.host.invoke('mobile.start', { workspaceId: f.w.id, address }), /interfaz/);
  for (const port of [-1, 1, 65536, 1.5, '8080']) await assert.rejects(f.host.invoke('mobile.start', { workspaceId: f.w.id, address: '127.0.0.1', port }), /Puerto/);
  await assert.rejects(f.host.invoke('mobile.start', { workspaceId: 'foreign-missing', address: '127.0.0.1' }));
  assert.equal((await f.host.invoke('mobile.status')).enabled, false);
});

test('QR request requires desktop approval, binds SAS and key, and delivers token once', async t => {
  const f = await fixture(t), started = await f.start(), origin = new URL(started.url).origin, keys = phone();
  assert.equal(started.pairing.link, `${origin}/mobile#pair=${started.pairing.code}`);
  for (const publicKey of [null, {}, { ...keys.jwk, d: 'private' }, { ...keys.jwk, crv: 'P-384' }, { ...keys.jwk, x: 'bad' }]) assert.equal((await rawPost(origin, '/api/pair', { code: started.pairing.code, publicKey })).status, 400);
  const request = await rawPost(origin, '/api/pair', { code: started.pairing.code, name: 'My phone', publicKey: keys.jwk }); assert.equal(request.status, 200);
  const statusBody = { requestId: request.data.requestId, poll: request.data.poll };
  assert.equal((await rawPost(origin, '/api/pair/status', statusBody)).data.state, 'pending');
  assert.equal((await rawPost(origin, '/api/pair/status', { ...statusBody, poll: 'wrong' })).status, 401);
  assert.equal((await rawPost(origin, '/api/pair', { code: started.pairing.code, publicKey: keys.jwk })).status, 401);
  const status = await f.host.invoke('mobile.status'); assert.equal(status.devices.length, 0); assert.equal(status.pending.length, 1);
  assert.equal(status.pending[0].sas, String(createHash('sha256').update(`${started.pairing.code}\n${keys.jwk.x}.${keys.jwk.y}`).digest().readUInt32BE(0) % 1000000).padStart(6, '0'));
  for (const value of [started.pairing.code, request.data.poll]) assert.ok(!JSON.stringify(status).includes(value));
  assert.equal(status.pairingLink, undefined);
  await f.host.invoke('mobile.approve', { id: request.data.requestId });
  const approved = await rawPost(origin, '/api/pair/status', statusBody); assert.equal(approved.data.state, 'approved');
  assert.equal((await rawPost(origin, '/api/pair/status', statusBody)).status, 401);
  assert.ok(!JSON.stringify(await f.host.invoke('mobile.status')).includes(approved.data.token));
  const body = { method: 'sessions.list' }, token = approved.data.token;
  assert.equal((await rawPost(origin, '/api/rpc', body, token)).status, 401);
  assert.equal((await rawPost(origin, '/api/rpc', body, token, signed(origin, '/api/rpc', body, phone().privateKey))).status, 401);
  assert.equal((await rawPost(origin, '/api/rpc', body, token, signed(origin, '/api/rpc', body, keys.privateKey, 1))).status, 401);
  const signature = signed(origin, '/api/rpc', body, keys.privateKey);
  assert.equal((await rawPost(origin, '/api/rpc', body, token, signature)).status, 200);
  assert.equal((await rawPost(origin, '/api/rpc', body, token, signature)).status, 401);
  assert.equal((await rawPost(origin, '/api/rpc', { method: 'chat.send', payload: { nodeId: f.node.id, text: 'Tampered' }, requestId: 'tampered' }, token, signed(origin, '/api/rpc', body, keys.privateKey))).status, 401);
  assert.equal(f.writes(), 0);
});

test('pending requests reject, expire, have bounded polling, and stop forgets them', async t => {
  const f = await fixture(t), started = await f.start(), origin = new URL(started.url).origin;
  const ask = async code => { const response = await rawPost(origin, '/api/pair', { code, publicKey: phone().jwk }); assert.equal(response.status, 200); return { requestId: response.data.requestId, poll: response.data.poll }; };
  const rejected = await ask(started.pairing.code);
  await assert.rejects(f.host.invoke('mobile.approve', { id: 4 }), /Solicitud/);
  await assert.rejects(f.host.invoke('mobile.reject', { id: 'missing' }), /encontrada/);
  await f.host.invoke('mobile.reject', { id: rejected.requestId });
  assert.equal((await rawPost(origin, '/api/pair/status', rejected)).data.state, 'rejected');
  const expired = await ask((await f.host.invoke('mobile.pairing')).code); f.advance(60001);
  assert.equal((await rawPost(origin, '/api/pair/status', expired)).data.state, 'expired');
  await assert.rejects(f.host.invoke('mobile.approve', { id: expired.requestId }), /caducada/);
  const pending = await ask((await f.host.invoke('mobile.pairing')).code);
  for (let i = 0; i < 60; i++) assert.equal((await rawPost(origin, '/api/pair/status', pending)).status, 200);
  assert.equal((await rawPost(origin, '/api/pair/status', pending)).status, 429);
  for (let i = 0; i < 3; i++) await ask((await f.host.invoke('mobile.pairing')).code);
  assert.equal((await rawPost(origin, '/api/pair', { code: (await f.host.invoke('mobile.pairing')).code, publicKey: phone().jwk })).status, 429);
  await f.host.invoke('mobile.stop'); assert.deepEqual((await f.host.invoke('mobile.status')).pending, []);
  const events = fs.readFileSync(path.join(f.root, 'state', 'mobile-audit.jsonl'), 'utf8');
  for (const method of ['pairing.request', 'pairing.reject', 'pairing.request.expire']) assert.ok(events.includes(`"method":"${method}"`));
});

test('pairing expires, regeneration invalidates, and concurrent reuse grants only once', async t => {
  const f = await fixture(t), started = await f.start(), origin = new URL(started.url).origin;
  f.advance(120001);
  assert.equal((await post(origin, '/api/pair', { code: started.pairing.code })).status, 401);
  const old = await f.host.invoke('mobile.pairing'), current = await f.host.invoke('mobile.pairing');
  assert.equal((await post(origin, '/api/pair', { code: old.code })).status, 401);
  const paired = await Promise.all([post(origin, '/api/pair', { code: current.code }), post(origin, '/api/pair', { code: current.code })]);
  assert.deepEqual(paired.map(r => r.status).sort(), [200, 401]);
  const state = await f.host.invoke('mobile.status'); assert.equal(state.devices.length, 1);
  assert.equal(state.pairingExpiresAt, null); assert.ok(!JSON.stringify(state).includes(current.code));
});

test('bearers are required, expire and are revocable without persisting credentials', async t => {
  const f = await fixture(t, { sessionTTL: 1000 }), { origin, token, rpc } = await authorized(f);
  assert.equal((await post(origin, '/api/rpc', { method: 'sessions.list' })).status, 401);
  assert.equal((await post(origin, '/api/rpc', { method: 'sessions.list' }, token + 'x')).status, 401);
  assert.equal((await rpc('sessions.list')).status, 200);
  const state = await f.host.invoke('mobile.status'); await f.host.invoke('mobile.revoke', { id: state.devices[0].id });
  assert.equal((await rpc('sessions.list')).status, 401);
  const pairing = await f.host.invoke('mobile.pairing');
  const next = await post(origin, '/api/pair', { code: pairing.code });
  f.advance(1001); assert.equal((await post(origin, '/api/rpc', { method: 'sessions.list' }, next.data.token)).status, 401);
  for (const file of fs.readdirSync(path.join(f.root, 'state')).filter(name => name.endsWith('.json'))) {
    const saved = fs.readFileSync(path.join(f.root, 'state', file), 'utf8');
    assert.ok(!saved.includes(token) && !saved.includes(pairing.code));
  }
});

test('revocation and expiry remove credentials even when their audit fails', async t => {
  const f = await fixture(t, { sessionTTL: 1000 }), { origin, rpc } = await authorized(f);
  const device = (await f.host.invoke('mobile.status')).devices[0];
  const file = path.join(f.root, 'state', 'mobile-audit.jsonl');
  fs.chmodSync(file, 0o644);
  try {
    await assert.rejects(f.host.invoke('mobile.revoke', { id: device.id }), /auditoría/);
    assert.equal((await rpc('sessions.list')).status, 401);
    assert.deepEqual((await f.host.invoke('mobile.status')).devices, []);
  } finally { fs.chmodSync(file, 0o600); }
  const pairing = await f.host.invoke('mobile.pairing');
  const next = await post(origin, '/api/pair', { code: pairing.code });
  assert.equal(next.status, 200);
  fs.chmodSync(file, 0o644);
  try {
    f.advance(1001);
    await assert.rejects(f.host.invoke('mobile.status'), /auditoría/);
    assert.equal((await post(origin, '/api/rpc', { method: 'sessions.list' }, next.data.token)).status, 401);
    const expiring = await f.host.invoke('mobile.pairing');
    f.advance(120001);
    await assert.rejects(f.host.invoke('mobile.status'), /auditoría/);
    assert.equal((await f.host.invoke('mobile.status')).pairingExpiresAt, null);
    fs.chmodSync(file, 0o600);
    assert.equal((await post(origin, '/api/pair', { code: expiring.code })).status, 401);
  } finally { fs.chmodSync(file, 0o600); }
});

test('Origin and literal served Host block cross-origin and rebinding, without ambient cookies', async t => {
  const f = await fixture(t), { origin, token } = await authorized(f);
  for (const Origin of ['http://evil.example', 'null', 'http://localhost:1']) assert.equal((await post(origin, '/api/rpc', { method: 'sessions.list' }, token, { Origin })).status, 403);
  const missing = await fetch(origin + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{"method":"sessions.list"}' });
  assert.equal(missing.status, 403);
  for (const Host of ['evil.example', 'localhost', '127.0.0.1:1']) assert.equal((await raw(origin, '/mobile', { Host })).status, 403);
  assert.equal((await raw(origin, '/mobile', { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await post(origin, '/api/rpc', { method: 'sessions.list' }, '', { Cookie: `token=${token}` })).status, 401);
  const page = await raw(origin, '/mobile'); assert.equal(page.status, 200);
  assert.equal(page.headers['access-control-allow-origin'], undefined); assert.equal(page.headers['set-cookie'], undefined);
  assert.equal(page.headers['cache-control'], 'no-store'); assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['strict-transport-security'], 'max-age=31536000');
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('mobile RPC denies desktop, management, filesystem, host, git and unknown methods', async t => {
  const f = await fixture(t), { rpc } = await authorized(f);
  for (const method of ['state.get', 'settings.update', 'host.shutdown', 'workspace.open', 'node.create', 'terminal.create', 'terminal.resize', 'repo.file.read', 'branch.commit', 'chat.configure', 'chat.clear', 'chat.permission.request', 'mobile.status', 'mobile.start', 'mobile.stop', 'mobile.pairing', 'mobile.revoke', 'desktop.info', '__proto__']) assert.equal((await rpc(method)).status, 403, method);
  assert.equal(f.w.nodes.length, 1); assert.equal(f.w.nodes[0].id, f.node.id);
});

test('catalog is sanitized and node/session/workspace scope cannot cross projects', async t => {
  const f = await fixture(t), { rpc } = await authorized(f);
  f.host.terminals.sessions.push({ id: 'local-session', workspaceId: f.w.id, nodeId: f.node.id, status: 'lost', createdAt: '', pid: 999, shell: 'PRIVATE_SHELL', cwd: 'PRIVATE_CWD', snapshot: '', seq: 0 }, { id: 'foreign-session', workspaceId: f.foreign.id, nodeId: f.other.id, status: 'lost', snapshot: '', seq: 0 });
  const catalog = await rpc('sessions.list'); assert.equal(catalog.status, 200);
  const encoded = JSON.stringify(catalog.data); assert.ok(!/PRIVATE|canonicalPath|worktree|settings|env|pid|shell|cwd/.test(encoded));
  assert.ok(!encoded.includes(f.other.id)); assert.ok(encoded.includes(f.node.id));
  assert.equal((await rpc('chat.get', { nodeId: f.node.id })).status, 200);
  assert.ok(!JSON.stringify((await rpc('chat.get', { nodeId: f.node.id })).data).includes('PRIVATE_META'));
  for (const method of ['chat.get', 'chat.send', 'chat.stop', 'chat.permission.answer', 'chat.question.answer']) {
    const fields = method === 'chat.send' ? { text: 'x' } : method === 'chat.permission.answer' ? { requestId: 'permission', decision: 'allow' } : method === 'chat.question.answer' ? { requestId: 'question', answers: {} } : {};
    assert.equal((await rpc(method, { nodeId: f.other.id, ...fields })).status, 403);
    assert.equal((await rpc(method, { workspaceId: f.foreign.id, nodeId: f.node.id })).status, 403);
  }
  for (const method of ['terminal.attach', 'terminal.write', 'terminal.stop']) assert.equal((await rpc(method, { sessionId: 'foreign-session', ...(method === 'terminal.write' ? { data: 'x' } : {}) })).status, 403);
  assert.equal((await rpc('chat.get', { nodeId: `phantom:${f.foreign.id}` })).status, 403);
  assert.equal((await rpc('chat.get', { nodeId: f.node.id, cwd: '/tmp' })).status, 400);
  assert.equal(f.writes(), 0);
});

test('only canonical allowlisted build assets are served; raw traversal and symlinks fail', async t => {
  const f = await fixture(t); fs.writeFileSync(path.join(f.root, 'private.txt'), 'PRIVATE');
  fs.symlinkSync(path.join(f.root, 'private.txt'), path.join(f.distDir, 'assets', 'linked.js'));
  const { origin } = await authorized(f);
  for (const route of ['/mobile?token=secret', '/', '/src/main.jsx', '/host/server.mjs', '/assets/linked.js', '/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/%2fetc/passwd', '//assets/fixture.js', '/assets/fixture.js?x=1']) assert.equal((await raw(origin, route)).status, 404, route);
  const script = await raw(origin, '/assets/fixture.js'); assert.equal(script.status, 200); assert.match(script.headers['content-type'], /javascript/);
  fs.unlinkSync(path.join(f.distDir, 'assets', 'fixture.js')); fs.symlinkSync(path.join(f.root, 'private.txt'), path.join(f.distDir, 'assets', 'fixture.js'));
  assert.notEqual((await raw(origin, '/assets/fixture.js')).status, 200);
});

test('body, pairing-attempt, device request and concurrency budgets are enforced', async t => {
  const f = await fixture(t), { origin, token, rpc } = await authorized(f);
  const largeBody = JSON.stringify({ method: 'sessions.list' }) + ' '.repeat(65537);
  assert.equal((await post(origin, '/api/rpc', largeBody, token)).status, 200);
  assert.equal((await post(origin, '/api/rpc', 'x'.repeat(8 * 1024 * 1024 + 1), token)).status, 413);
  assert.equal((await post(origin, '/api/rpc', '{invalid', token)).status, 400);
  assert.equal((await post(origin, '/api/rpc', { method: 'sessions.list' }, token, { 'Content-Type': 'text/plain' })).status, 400);
  for (let i = 0; i < 9; i++) await post(origin, '/api/pair', { code: 'wrong' });
  assert.equal((await post(origin, '/api/pair', { code: 'wrong' })).status, 429);
  f.advance(60001);
  let release, entered = 0;
  const gate = new Promise(resolve => { release = resolve; });
  f.host.chats.send = async () => { entered++; await gate; };
  const pending = Array.from({ length: 8 }, () => rpc('chat.send', { nodeId: f.node.id, text: 'Wait' }));
  try {
    const deadline = Date.now() + 3000;
    while (entered < 8 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(entered, 8); assert.equal((await rpc('sessions.list')).status, 429);
  } finally { release(); await Promise.all(pending); }
  let limited = false;
  for (let i = 0; i < 125; i++) if ((await rpc('sessions.list')).status === 429) { limited = true; break; }
  assert.ok(limited);
});

test('large chat text reaches the chat intact and text limits remain enforced', async t => {
  const f = await fixture(t), { rpc } = await authorized(f);
  const text = ' á\n漢字'.repeat(40000);
  assert.equal(text.length, 200000);
  const received = [];
  f.host.chats.send = async (workspace, node, value) => { received.push(value); assert.equal(workspace.id, f.w.id); assert.equal(node.id, f.node.id); };
  assert.equal((await rpc('chat.send', { nodeId: f.node.id, text })).status, 200);
  assert.deepEqual(received, [text]);
  assert.equal((await rpc('chat.send', { nodeId: f.node.id, text: 'x'.repeat(2000000) })).status, 200);
  assert.equal((await rpc('chat.send', { nodeId: f.node.id, text: 'x'.repeat(2000001) })).status, 400);
  assert.equal(received.length, 2);
});

test('large RPC bodies require a valid session before body reading', async t => {
  const f = await fixture(t), { origin, token } = await authorized(f);
  for (const bearer of ['', token + 'x']) {
    const status = await new Promise((resolve, reject) => {
      const request = https.request(origin + '/api/rpc', { method: 'POST', ca: certificates.get(origin), agent: false,
        headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': 65537, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) } }, response => {
        response.resume(); response.on('end', () => { resolve(response.statusCode); request.destroy(); });
      });
      request.on('error', reject);
      request.setTimeout(3000, () => request.destroy(new Error('Session check waited for the body')));
      request.flushHeaders();
    });
    assert.equal(status, 401);
  }
});

test('pairing audits only 401 failures, not rejected origins, invalid bodies or rate limits', async t => {
  const f = await fixture(t), started = await f.start(), origin = new URL(started.url).origin;
  const file = path.join(f.root, 'state', 'mobile-audit.jsonl');
  const initial = fs.readFileSync(file, 'utf8');
  assert.equal((await post(origin, '/api/pair', { code: 'wrong' }, '', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(origin, '/api/pair', '{invalid')).status, 400);
  assert.equal((await post(origin, '/api/pair', 'x'.repeat(65537))).status, 413);
  assert.equal(fs.readFileSync(file, 'utf8'), initial);
  assert.equal((await post(origin, '/api/pair', { code: 'wrong' })).status, 401);
  const after401 = fs.readFileSync(file, 'utf8');
  const events = after401.slice(initial.length).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.length, 1); assert.equal(events[0].method, 'pairing'); assert.equal(events[0].result, 'error');
  for (let i = 0; i < 7; i++) assert.equal((await post(origin, '/api/pair', '{invalid')).status, 400);
  assert.equal((await post(origin, '/api/pair', { code: 'wrong' })).status, 429);
  assert.equal(fs.readFileSync(file, 'utf8'), after401);
});

test('uncertain/repeated writes are deduplicated by action ID, including failed operations', async t => {
  const f = await fixture(t), { rpc } = await authorized(f);
  const payload = { nodeId: f.node.id, text: 'Only once' }, id = randomUUID();
  const repeated = await Promise.all([rpc('chat.send', payload, id), rpc('chat.send', payload, id)]);
  assert.ok(repeated.every(r => r.status === 200)); assert.equal(f.writes(), 1);
  assert.equal((await rpc('chat.send', { ...payload, text: 'Different' }, id)).status, 400);
  let failures = 0; f.host.chats.send = async () => { failures++; throw new Error('Fixture failure after accepting input'); };
  const failedID = randomUUID(); assert.equal((await rpc('chat.send', payload, failedID)).status, 400);
  assert.equal((await rpc('chat.send', payload, failedID)).status, 400); assert.equal(failures, 1);
  f.host.terminals.sessions.push({ id: 'writable-fixture', workspaceId: f.w.id, nodeId: f.node.id, status: 'running', snapshot: '', seq: 0 });
  let inputs = 0; f.host.terminals.write = () => { inputs++; return { ok: true }; };
  const inputID = randomUUID(); await rpc('terminal.write', { sessionId: 'writable-fixture', data: 'one\r' }, inputID); await rpc('terminal.write', { sessionId: 'writable-fixture', data: 'one\r' }, inputID);
  assert.equal(inputs, 1);
});

test('pending permission and question answers require explicit scoped actions', async t => {
  const f = await fixture(t), { rpc } = await authorized(f); let permissions = [], answers = [];
  f.host.chats.answerPermission = (node, requestId, decision) => { permissions.push({ id: node.id, requestId, decision }); };
  f.host.chats.answerQuestion = (node, requestId, value) => { answers.push({ id: node.id, requestId, value }); };
  await rpc('chat.get', { nodeId: f.node.id }); assert.equal(permissions.length, 0);
  assert.equal((await rpc('chat.permission.answer', { nodeId: f.node.id, requestId: 'permission', decision: 'always' })).status, 400);
  assert.equal((await rpc('chat.permission.answer', { nodeId: f.node.id, requestId: 'permission', decision: 'allow' })).status, 200);
  assert.equal((await rpc('chat.question.answer', { nodeId: f.node.id, requestId: 'question', answers: { Which: 'This one' } })).status, 200);
  assert.deepEqual(permissions, [{ id: f.node.id, requestId: 'permission', decision: 'allow' }]);
  assert.equal(answers[0].value.Which, 'This one');
});

test('revocation and host shutdown close existing connections and the HTTPS listener', async t => {
  const f = await fixture(t), { origin, rpc } = await authorized(f);
  f.host.terminals.sessions.push({ id: 'pending-attach', workspaceId: f.w.id, nodeId: f.node.id, status: 'lost', snapshot: '', seq: 0 });
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.host.terminals.tail = async () => { enter(); await gate; return { status: 'lost', seq: 0, lines: [] }; };
  const pending = assert.rejects(rpc('terminal.attach', { sessionId: 'pending-attach' }));
  await entered;
  const revokedAt = performance.now();
  try { await f.host.invoke('mobile.revoke', { id: (await f.host.invoke('mobile.status')).devices[0].id }); await pending; }
  finally { release(); }
  assert.ok(performance.now() - revokedAt < 3000, 'revocation must reject the pending request in under 3 s');
  const socket = net.createConnection({ host: '127.0.0.1', port: Number(new URL(origin).port) });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const closed = new Promise(resolve => socket.once('close', resolve));
  await f.host.close(); await closed;
  await assert.rejects(fetch(origin + '/mobile'));
});

test('device and action limits do not evict an earlier action identity', async t => {
  const f = await fixture(t), { origin, rpc } = await authorized(f);
  for (let i = 0; i < 7; i++) {
    const pairing = await f.host.invoke('mobile.pairing');
    assert.equal((await post(origin, '/api/pair', { code: pairing.code })).status, 200);
  }
  const extra = await f.host.invoke('mobile.pairing');
  assert.equal((await post(origin, '/api/pair', { code: extra.code })).status, 429);
  const original = randomUUID(), payload = { nodeId: f.node.id, text: 'Bounded action' };
  assert.equal((await rpc('chat.send', payload, original)).status, 200);
  for (let i = 1; i < 256; i++) {
    if (i % 100 === 0) f.advance(60001);
    assert.equal((await rpc('chat.send', payload)).status, 200);
  }
  assert.equal((await rpc('chat.send', payload)).status, 429);
  assert.equal((await rpc('chat.send', payload, original)).status, 200);
  assert.equal(f.writes(), 256);
});

test('HTTPS presents the advertised fingerprint, verifies its IP and rejects plaintext and old TLS', async t => {
  const f = await fixture(t), started = await f.start(), url = new URL(started.url);
  const cert = new X509Certificate(certificates.get(url.origin));
  assert.equal(cert.checkIP('127.0.0.1'), '127.0.0.1');
  assert.match(started.tls.fingerprint, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(started.tls.fingerprint, cert.fingerprint256);
  assert.deepEqual((await f.host.invoke('mobile.status')).tls, started.tls);
  await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port), ca: certificates.get(url.origin), rejectUnauthorized: true }, () => {
      try { assert.equal(socket.authorized, true); assert.equal(socket.getPeerCertificate().fingerprint256, started.tls.fingerprint); resolve(); }
      catch (error) { reject(error); }
      finally { socket.destroy(); }
    });
    socket.on('error', reject);
  });
  await assert.rejects(new Promise((resolve, reject) => {
    const request = https.get(started.url, { agent: false }, resolve); request.on('error', reject);
  }), /self.signed/i);
  await assert.rejects(new Promise((resolve, reject) => {
    const request = http.get(started.url.replace('https:', 'http:'), response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  }));
  await assert.rejects(new Promise((resolve, reject) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port), ca: certificates.get(url.origin), minVersion: 'TLSv1', maxVersion: 'TLSv1.1' }, () => { socket.destroy(); resolve(); });
    socket.on('error', reject);
  }));
  assert.ok(!JSON.stringify(started).includes('PRIVATE KEY'));
});

test('TLS files are private, reused, and reissued for another IP with the same P-256 key', async t => {
  const f = await fixture(t), started = await f.start();
  const dir = path.join(f.root, 'state', 'mobile-tls'), keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
  const key = fs.readFileSync(keyFile), certificate = fs.readFileSync(certFile), inode = fs.statSync(keyFile).ino;
  assert.equal(fs.statSync(dir).mode & 0o7777, 0o700);
  for (const file of [keyFile, certFile]) {
    const stat = fs.lstatSync(file);
    assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.uid, process.getuid()); assert.equal(stat.isSymbolicLink(), false);
  }
  const publicKey = createPublicKey(key);
  assert.equal(publicKey.asymmetricKeyType, 'ec'); assert.equal(publicKey.asymmetricKeyDetails.namedCurve, 'prime256v1');
  await f.host.invoke('mobile.stop'); const again = await f.start();
  assert.equal(again.tls.fingerprint, started.tls.fingerprint);
  assert.equal(fs.statSync(keyFile).ino, inode); assert.deepEqual(fs.readFileSync(keyFile), key); assert.deepEqual(fs.readFileSync(certFile), certificate);
  await f.host.invoke('mobile.stop');
  const changed = await mobileTLS(path.join(f.root, 'state'), '127.0.0.2');
  assert.deepEqual(changed.key, key); assert.equal(new X509Certificate(changed.cert).checkIP('127.0.0.2'), '127.0.0.2');
  assert.notEqual(changed.fingerprint, started.tls.fingerprint);
});

test('unsafe TLS files are replaced without following links or reusing exposed keys', async t => {
  const f = await fixture(t); await f.start(); await f.host.invoke('mobile.stop');
  const dir = path.join(f.root, 'state', 'mobile-tls'), keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
  const oldKey = fs.readFileSync(keyFile), victim = path.join(f.root, 'victim');
  fs.writeFileSync(victim, 'do not overwrite');
  fs.unlinkSync(certFile); fs.symlinkSync(victim, certFile); fs.chmodSync(keyFile, 0o644);
  await f.start();
  assert.notDeepEqual(fs.readFileSync(keyFile), oldKey);
  assert.equal(fs.lstatSync(certFile).isSymbolicLink(), false); assert.equal(fs.readFileSync(victim, 'utf8'), 'do not overwrite');
  assert.equal(fs.statSync(keyFile).mode & 0o7777, 0o600); assert.equal(fs.statSync(certFile).mode & 0o7777, 0o600);
});

test('missing openssl fails activation closed, with a clear HTTPS error', async t => {
  const f = await fixture(t, { openssl: '/nonexistent/phantom-openssl' });
  await assert.rejects(f.start(), /HTTPS.*openssl/);
  const status = await f.host.invoke('mobile.status');
  assert.equal(status.enabled, false); assert.equal(status.url, null); assert.equal(status.tls, null);
  const failing = await fixture(t, { openssl: process.execPath });
  await assert.rejects(failing.start(), /HTTPS.*openssl/);
  assert.equal((await failing.host.invoke('mobile.status')).enabled, false);
});

test('mobile cannot allow a permission in effective full mode; deny remains available', async t => {
  const f = await fixture(t), { rpc } = await authorized(f), permissions = [];
  f.host.chats.answerPermission = (node, id, decision) => { permissions.push({ nodeId: node.id, id, decision }); };
  await f.host.invoke('chat.configure', { workspaceId: f.w.id, nodeId: f.node.id, permissionMode: 'full' });
  const payload = { nodeId: f.node.id, requestId: 'sensitive', decision: 'allow' };
  assert.equal((await rpc('chat.permission.answer', payload)).status, 403); assert.deepEqual(permissions, []);
  assert.equal((await rpc('chat.permission.answer', { ...payload, decision: 'deny' })).status, 200);
  assert.deepEqual(permissions, [{ nodeId: f.node.id, id: 'sensitive', decision: 'deny' }]);
  await f.host.invoke('chat.configure', { workspaceId: f.w.id, nodeId: f.node.id, permissionMode: 'ask' });
  assert.equal((await rpc('chat.permission.answer', payload)).status, 200);
});

test('mobile cannot allow an ongoing full turn after the chat is reconfigured to ask', async t => {
  const f = await fixture(t), { rpc } = await authorized(f), permissions = [];
  f.host.chats.answerPermission = (node, id, decision) => { permissions.push({ nodeId: node.id, id, decision }); };
  await f.host.invoke('chat.configure', { workspaceId: f.w.id, nodeId: f.node.id, permissionMode: 'full' });
  f.host.chats.turns.set(f.node.id, { mode: 'full' });
  try {
    await f.host.invoke('chat.configure', { workspaceId: f.w.id, nodeId: f.node.id, permissionMode: 'ask' });
    const payload = { nodeId: f.node.id, requestId: 'ongoing-full', decision: 'allow' };
    assert.equal((await rpc('chat.permission.answer', payload)).status, 403);
    assert.deepEqual(permissions, []);
    assert.equal((await rpc('chat.permission.answer', { ...payload, decision: 'deny' })).status, 200);
    assert.deepEqual(permissions, [{ nodeId: f.node.id, id: 'ongoing-full', decision: 'deny' }]);
    f.host.chats.turns.delete(f.node.id);
    assert.equal((await rpc('chat.permission.answer', payload)).status, 200);
  } finally { f.host.chats.turns.delete(f.node.id); }
});

test('audit persists lifecycle and write outcomes with attribution and no credentials or input', async t => {
  const f = await fixture(t, { sessionTTL: 1000 }), { origin, token, rpc } = await authorized(f);
  const pair = await f.host.invoke('mobile.pairing');
  await post(origin, '/api/pair', { code: 'WRONG_PAIRING_SECRET' });
  await rpc('chat.send', { nodeId: f.node.id, text: 'PRIVATE_CHAT_TEXT' });
  f.host.chats.stop = async () => {};
  f.host.chats.answerPermission = async () => {};
  f.host.chats.answerQuestion = async () => {};
  await rpc('chat.stop', { nodeId: f.node.id });
  await rpc('chat.permission.answer', { nodeId: f.node.id, requestId: 'permission', decision: 'deny' });
  await rpc('chat.question.answer', { nodeId: f.node.id, requestId: 'question', answers: { secret: 'PRIVATE_ANSWER' } });
  f.host.terminals.sessions.push({ id: 'audit-terminal', workspaceId: f.w.id, nodeId: f.node.id, status: 'lost', snapshot: '', seq: 0 });
  f.host.terminals.write = async () => {};
  f.host.terminals.stop = async () => {};
  await rpc('terminal.write', { sessionId: 'audit-terminal', data: 'PRIVATE_TERMINAL_DATA' });
  await rpc('terminal.stop', { sessionId: 'audit-terminal' });
  f.host.chats.send = async () => { throw new Error('PRIVATE_PROVIDER_ERROR'); };
  assert.equal((await rpc('chat.send', { nodeId: f.node.id, text: 'PRIVATE_FAILED_TEXT' })).status, 400);
  const firstDevice = (await f.host.invoke('mobile.status')).devices[0];
  await f.host.invoke('mobile.revoke', { id: firstDevice.id });
  const second = await post(origin, '/api/pair', { code: pair.code, name: 'Expiring phone' });
  assert.equal(second.status, 200); f.advance(120001); await f.host.invoke('mobile.status');
  await f.host.invoke('mobile.pairing'); f.advance(120001); await f.host.invoke('mobile.status');
  await f.host.invoke('mobile.stop');
  const file = path.join(f.root, 'state', 'mobile-audit.jsonl'), contents = fs.readFileSync(file, 'utf8');
  assert.equal(fs.statSync(file).mode & 0o7777, 0o600);
  for (const value of [token, pair.code, second.data.token, 'WRONG_PAIRING_SECRET', 'PRIVATE_CHAT_TEXT', 'PRIVATE_TERMINAL_DATA', 'PRIVATE_ANSWER', 'PRIVATE_FAILED_TEXT', 'PRIVATE_PROVIDER_ERROR', 'PRIVATE KEY']) assert.ok(!contents.includes(value), value);
  const events = contents.trim().split('\n').map(line => JSON.parse(line));
  for (const method of ['mobile.start', 'mobile.stop', 'pairing', 'device.revoke', 'device.expire', 'pairing.expire', 'chat.send', 'chat.stop', 'chat.permission.answer', 'chat.question.answer', 'terminal.write', 'terminal.stop']) assert.ok(events.some(event => event.method === method), method);
  assert.ok(events.some(event => event.method === 'pairing' && event.result === 'error'));
  assert.ok(events.some(event => event.method === 'chat.send' && event.result === 'error'));
  const action = events.find(event => event.method === 'chat.send' && event.phase === 'completed' && event.result === 'ok');
  assert.equal(action.deviceId, firstDevice.id); assert.equal(action.deviceName, 'Test phone'); assert.equal(action.remoteAddress, '127.0.0.1'); assert.equal(action.nodeId, f.node.id);
  assert.ok(events.some(event => event.method === 'terminal.write' && event.sessionId === 'audit-terminal'));
  for (const event of events) { assert.equal(new Date(event.time).toISOString(), event.time); assert.ok(['ok', 'error'].includes(event.result)); }
});

test('an unavailable or symlinked audit fails writes closed and preserves deduplication', async t => {
  const f = await fixture(t), { rpc } = await authorized(f);
  const file = path.join(f.root, 'state', 'mobile-audit.jsonl'), saved = file + '.saved', victim = path.join(f.root, 'victim');
  fs.writeFileSync(victim, 'PRIVATE_UNTOUCHED'); fs.renameSync(file, saved); fs.symlinkSync(victim, file);
  const id = randomUUID(), payload = { nodeId: f.node.id, text: 'PRIVATE_BLOCKED_TEXT' };
  try { assert.equal((await rpc('chat.send', payload, id)).status, 503); assert.equal(f.writes(), 0); assert.equal(fs.readFileSync(victim, 'utf8'), 'PRIVATE_UNTOUCHED'); }
  finally { fs.unlinkSync(file); fs.renameSync(saved, file); }
  assert.equal((await rpc('chat.send', payload, id)).status, 200); assert.equal(f.writes(), 1);
  assert.equal((await rpc('chat.send', payload, id)).status, 200); assert.equal(f.writes(), 1);
  fs.chmodSync(file, 0o644);
  try { assert.equal((await rpc('chat.send', payload)).status, 503); assert.equal(f.writes(), 1); }
  finally { fs.chmodSync(file, 0o600); }
});

test('audit rotation retains only one private previous generation without following its link', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-mobile-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = new MobileAudit(root), victim = path.join(root, 'victim');
  fs.writeFileSync(victim, 'untouched'); fs.symlinkSync(victim, audit.file + '.1');
  for (let i = 0; i < 140; i++) audit.append({ method: 'fixture', deviceName: 'x'.repeat(16000), result: 'ok', sequence: i });
  for (const file of [audit.file, audit.file + '.1']) {
    const stat = fs.lstatSync(file); assert.equal(stat.isSymbolicLink(), false); assert.equal(stat.mode & 0o7777, 0o600); assert.ok(stat.size <= 1024 * 1024);
    for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) assert.equal(JSON.parse(line).method, 'fixture');
  }
  assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched');
  assert.equal(fs.existsSync(audit.file + '.2'), false);
});

test('a completion-audit failure returns an error and cannot replay an already executed write', async t => {
  const f = await fixture(t), { rpc } = await authorized(f);
  const original = MobileAudit.prototype.append;
  const mocked = t.mock.method(MobileAudit.prototype, 'append', function (event) {
    if (event.method === 'chat.send' && event.phase === 'completed') throw new Error('Fixture audit failure');
    return original.call(this, event);
  });
  const id = randomUUID(), payload = { nodeId: f.node.id, text: 'Only once even if completion audit fails' };
  try {
    assert.equal((await rpc('chat.send', payload, id)).status, 503);
    assert.equal((await rpc('chat.send', payload, id)).status, 503);
    assert.equal(f.writes(), 1);
  } finally { mocked.mock.restore(); }
  assert.equal((await rpc('chat.send', payload, id)).status, 503); assert.equal(f.writes(), 1);
});
