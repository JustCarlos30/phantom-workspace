import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateKeyPairSync, sign, randomUUID, X509Certificate } from 'node:crypto';
import { createHost } from '../host/server.mjs';
import { HOST_METHODS } from '../desktop/security.mjs';
import { loadIdentity } from '../host/mobile-identity.mjs';
import { MobileAudit } from '../host/mobile-audit.mjs';
import { deviceKey } from '../host/mobile-auth.mjs';

// Only temporary profiles, loopback listeners, synthetic engines; no agent,
// shell, user profile, or TLS verification bypass. OpenSSL uses argv in tmp.
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-mobile-secure-'));
  fs.mkdirSync(path.join(root, 'project')); fs.mkdirSync(path.join(root, 'foreign'));
  let clock = Date.now(), writes = 0;
  const dataDir = path.join(root, 'state');
  const host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }), mobileOptions: { now: () => clock, ...options } });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const w = await host.invoke('workspace.open', { path: path.join(root, 'project') });
  const foreign = await host.invoke('workspace.open', { path: path.join(root, 'foreign') });
  const node = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', title: 'Local chat', data: { chat: { provider: 'claude' }, env: { secret: 'PRIVATE_ENV' } } });
  const hidden = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', title: 'UNAUTHORIZED', data: { chat: { provider: 'claude' } } });
  const other = await host.invoke('node.create', { workspaceId: foreign.id, type: 'terminal', data: { chat: { provider: 'claude' } } });
  host.chats.get = () => ({ provider: 'claude', running: false, messages: [{ id: 'message', role: 'assistant', parts: [{ type: 'text', text: 'Fixture response' }], status: 'done' }], meta: { secret: 'PRIVATE_META' } });
  host.chats.send = async () => { writes++; return { private: 'PRIVATE_RESULT' }; };
  const f = { root, dataDir, host, w, node, hidden, other, foreign, advance: ms => { clock += ms; }, writes: () => writes };
  f.start = async () => {
    const access = await host.invoke('mobile.start', { workspaceId: w.id, address: '127.0.0.1' });
    f.origin = new URL(access.url).origin; f.ca = access.identity.certificate; f.access = access; return access;
  };
  return f;
}
function request(f, route, body, token, options = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    // The TLS identity is the literal destination IP. A hostile HTTP Host must
    // reach the Host guard, not become the TLS servername under test. Empty SNI
    // retains Node's normal CA and destination-IP certificate verification.
    const req = https.request(f.origin + route, { ca: f.ca, servername: '', method: data === undefined ? 'GET' : 'POST', agent: false,
      ...options, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => { let value; try { value = JSON.parse(text); } catch { value = text; } resolve({ status: res.statusCode, data: value, headers: res.headers }); });
    });
    req.on('error', reject); req.end(data);
  });
}
const post = (f, route, body, token, options) => request(f, '/api/v2/' + route, body, token, options);
const keys = () => { const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); return { ...pair, publicDER: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') }; };
const proof = (key, c) => sign('sha256', Buffer.from(c.bytes, 'base64url'), { key: key.privateKey, dsaEncoding: 'der' }).toString('base64url');
async function enroll(f, key = keys(), code = f.access.pairing.code) {
  const paired = await post(f, 'pair', { code, name: 'Test phone', publicKey: key.publicDER }); assert.equal(paired.status, 200, JSON.stringify(paired.data));
  const p = paired.data;
  const proven = await post(f, 'pair/prove', { deviceId: p.deviceId, challengeId: p.challengeId, signature: proof(key, p) }); assert.equal(proven.status, 200);
  return { key, id: p.deviceId };
}
async function login(f, d) {
  const c = await post(f, 'login/challenge', { deviceId: d.id }); assert.equal(c.status, 200);
  const r = await post(f, 'login', { deviceId: d.id, challengeId: c.data.challengeId, signature: proof(d.key, c.data) }); assert.equal(r.status, 200); return r.data.token;
}
async function authorized(f, caps = ['read', 'chat.send', 'chat.stop', 'terminal.write', 'terminal.stop', 'chat.permission.answer', 'chat.question.answer']) {
  await f.start(); const d = await enroll(f);
  await f.host.invoke('mobile.approve', { id: d.id, grants: [{ nodeId: f.node.id, capabilities: caps }] });
  const token = await login(f, d);
  const read = (method, payload = {}) => post(f, 'read', { method, payload }, token);
  const issue = (method = 'chat.send', payload = { nodeId: f.node.id, text: 'Only once' }, requestId = randomUUID()) => post(f, 'action/challenge', { method, payload, requestId }, token);
  const execute = c => post(f, 'action', { challengeId: c.challengeId, signature: proof(d.key, c) }, token);
  const action = async (method, payload, requestId) => { const c = await issue(method, payload, requestId); return c.status === 200 ? execute(c.data) : c; };
  return { ...d, token, read, issue, execute, action };
}

test('opt-in lifecycle, desktop allowlist, HTTPS-only and restart forget access', async t => {
  const f = await fixture(t); assert.equal((await f.host.invoke('mobile.status')).enabled, false);
  for (const m of ['status', 'start', 'stop', 'pairing', 'revoke', 'approve', 'permissions', 'identity', 'audit']) assert.ok(HOST_METHODS.has('mobile.' + m));
  const s = await f.start(); assert.match(s.url, /^https:\/\/127\.0\.0\.1:\d+\/mobile$/); await assert.rejects(f.start(), /activo/);
  await f.host.invoke('mobile.stop'); await assert.rejects(request(f, '/mobile'));
  await f.host.close();
  const restarted = await createHost({ dataDir: f.dataDir, handleIntegration: () => ({ handled: false }) });
  try { const status = await restarted.invoke('mobile.status'); assert.equal(status.enabled, false); assert.deepEqual(status.devices, []); } finally { await restarted.close(); }
});
test('rejects public/wildcard/hostname bindings and invalid ports', async t => {
  const f = await fixture(t);
  for (const address of ['0.0.0.0', '8.8.8.8', 'localhost', '::', '192.0.2.1']) await assert.rejects(f.host.invoke('mobile.start', { workspaceId: f.w.id, address }), /interfaz/);
  for (const port of [-1, 1, 65536, 1.5, '8080']) await assert.rejects(f.host.invoke('mobile.start', { workspaceId: f.w.id, address: '127.0.0.1', port }), /Puerto/);
  await assert.rejects(f.host.invoke('mobile.start', { workspaceId: 'missing', address: '127.0.0.1' }));
});
test('pairing expires, regeneration replaces code and concurrent reuse wins once', async t => {
  const f = await fixture(t); await f.start(); const key = keys(), body = { code: f.access.pairing.code, name: 'Test', publicKey: key.publicDER };
  f.advance(120001); assert.equal((await post(f, 'pair', body)).status, 401);
  const old = await f.host.invoke('mobile.pairing'), current = await f.host.invoke('mobile.pairing');
  assert.equal((await post(f, 'pair', { ...body, code: old.code })).status, 401);
  const r = await Promise.all([post(f, 'pair', { ...body, code: current.code }), post(f, 'pair', { ...body, code: current.code })]);
  assert.deepEqual(r.map(x => x.status).sort(), [200, 401]);
  const state = await f.host.invoke('mobile.status'); assert.equal(state.devices.length, 1); assert.equal(state.pairingExpiresAt, null); assert.ok(!JSON.stringify(state).includes(current.code));
});
test('bearers required, capped lifetime, revocation and no persisted credentials', async t => {
  const f = await fixture(t, { sessionTTL: 1000 }), a = await authorized(f);
  assert.equal((await post(f, 'read', { method: 'sessions.list' })).status, 401);
  assert.equal((await post(f, 'read', { method: 'sessions.list' }, a.token + 'x')).status, 401);
  assert.equal((await a.read('sessions.list')).status, 200);
  f.advance(1001); assert.equal((await a.read('sessions.list')).status, 401);
  const token = await login(f, a); await f.host.invoke('mobile.revoke', { id: a.id });
  assert.equal((await post(f, 'read', { method: 'sessions.list' }, token)).status, 401);
  const files = fs.readdirSync(path.join(f.dataDir, 'mobile-audit')); const audit = files.map(n => fs.readFileSync(path.join(f.dataDir, 'mobile-audit', n), 'utf8')).join('');
  assert.ok(!audit.includes(a.token) && !audit.includes(f.access.pairing.code));
});
test('Host/Origin rebinding, ambient cookies and browser transport denied', async t => {
  const f = await fixture(t), a = await authorized(f);
  for (const Origin of ['https://evil.example', 'null', f.origin]) assert.equal((await post(f, 'read', { method: 'sessions.list' }, a.token, { headers: { Origin } })).status, 403);
  for (const Host of ['evil.example', 'localhost', '127.0.0.1:1']) assert.equal((await request(f, '/mobile', undefined, undefined, { headers: { Host } })).status, 403);
  assert.equal((await post(f, 'read', { method: 'sessions.list' }, '', { headers: { Cookie: `token=${a.token}` } })).status, 401);
  const page = await request(f, '/mobile'); assert.equal(page.status, 200); assert.equal(page.headers['access-control-allow-origin'], undefined); assert.equal(page.headers['set-cookie'], undefined); assert.equal(page.headers['cache-control'], 'no-store'); assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
});
test('network cannot invoke desktop/management/filesystem/host/git/unknown methods', async t => {
  const f = await fixture(t), a = await authorized(f);
  for (const method of ['state.get', 'settings.update', 'host.shutdown', 'workspace.open', 'node.create', 'terminal.create', 'terminal.resize', 'repo.file.read', 'branch.commit', 'chat.configure', 'chat.clear', 'mobile.approve', 'mobile.permissions', 'mobile.identity', 'mobile.audit', '__proto__']) {
    assert.equal((await a.read(method)).status, 403, method); assert.equal((await a.issue(method, {})).status, 403, method);
  }
  assert.equal(f.writes(), 0);
});
test('catalog and reads filter authorized nodes within workspace and strip engine metadata', async t => {
  const f = await fixture(t), a = await authorized(f);
  f.host.terminals.sessions.push({ id: 'local', workspaceId: f.w.id, nodeId: f.node.id, status: 'lost', snapshot: '', seq: 0, pid: 99, cwd: 'PRIVATE_CWD' }, { id: 'hidden', workspaceId: f.w.id, nodeId: f.hidden.id, status: 'lost', snapshot: '', seq: 0 }, { id: 'foreign', workspaceId: f.foreign.id, nodeId: f.other.id, status: 'lost', snapshot: '', seq: 0 });
  const catalog = await a.read('sessions.list'); assert.equal(catalog.status, 200); const text = JSON.stringify(catalog.data);
  assert.ok(text.includes(f.node.id)); assert.ok(!/PRIVATE|UNAUTHORIZED|canonicalPath|worktree|settings|env|pid|shell|cwd/.test(text)); assert.ok(!text.includes(f.hidden.id) && !text.includes(f.other.id));
  assert.equal((await a.read('chat.get', { nodeId: f.node.id })).status, 200); assert.ok(!JSON.stringify((await a.read('chat.get', { nodeId: f.node.id })).data).includes('PRIVATE_META'));
  for (const nodeId of [f.hidden.id, f.other.id, `phantom:${f.foreign.id}`]) assert.equal((await a.read('chat.get', { nodeId })).status, 403);
  assert.equal((await a.read('chat.get', { nodeId: f.node.id, workspaceId: f.foreign.id })).status, 403);
  assert.equal((await a.read('terminal.attach', { sessionId: 'foreign' })).status, 403);
  assert.equal((await a.read('terminal.attach', { sessionId: 'hidden' })).status, 403);
  assert.equal((await a.read('chat.get', { nodeId: f.node.id, cwd: '/tmp' })).status, 400);
});
test('only fixed migration page is served; assets/source/traversal/query fail', async t => {
  const f = await fixture(t); await f.start();
  for (const route of ['/mobile?token=secret', '/', '/src/main.jsx', '/host/server.mjs', '/assets/fixture.js', '/assets/../index.html', '/assets/%2e%2e/index.html', '//assets/file.js']) assert.equal((await request(f, route)).status, 404, route);
  const page = await request(f, '/mobile'); assert.match(page.data, /Se necesita la app nativa/); assert.ok(!/<script|<form|biometricVerified/.test(page.data));
});
test('body/type/JSON and pairing/action request budgets enforced', async t => {
  const f = await fixture(t), a = await authorized(f);
  assert.equal((await post(f, 'read', 'x'.repeat(65537), a.token)).status, 413);
  assert.equal((await post(f, 'read', 'x'.repeat(65537), a.token, { headers: { 'Transfer-Encoding': 'chunked' } })).status, 413);
  assert.equal((await post(f, 'read', '{invalid', a.token)).status, 400);
  assert.equal((await post(f, 'read', {}, a.token, { headers: { 'Content-Type': 'text/plain' } })).status, 400);
  for (let i = 0; i < 10; i++) await post(f, 'pair', { code: 'wrong' });
  assert.equal((await post(f, 'pair', { code: 'wrong' })).status, 429);
  assert.equal((await a.read('sessions.list')).status, 200);
  f.advance(60001); let limited = false;
  for (let i = 0; i < 125; i++) if ((await a.read('sessions.list')).status === 429) { limited = true; break; } assert.ok(limited);
});
test('concurrent replay cannot double execute and response-loss receipt is stable', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue();
  const r = await Promise.all([a.execute(c.data), a.execute(c.data)]); assert.deepEqual(r.map(x => x.status).sort(), [200, 401]); assert.equal(f.writes(), 1);
  const envelope = JSON.parse(Buffer.from(c.data.bytes, 'base64url'));
  const receipt = await post(f, 'receipt', { requestId: envelope.requestId }, a.token); assert.equal(receipt.data.receipt.state, 'completed');
  assert.equal((await a.issue('chat.send', { nodeId: f.node.id, text: 'Different' }, envelope.requestId)).status, 409); assert.equal(f.writes(), 1);
});
test('failed/uncertain operations are not repeated with new signatures', async t => {
  const f = await fixture(t), a = await authorized(f); let attempts = 0;
  f.host.chats.send = () => { attempts++; throw new Error('after acceptance'); };
  const id = randomUUID(), c = await a.issue('chat.send', { nodeId: f.node.id, text: 'Uncertain' }, id);
  assert.equal((await a.execute(c.data)).status, 400); assert.equal((await a.issue('chat.send', { nodeId: f.node.id, text: 'Uncertain' }, id)).status, 409); assert.equal(attempts, 1);
  assert.equal((await post(f, 'receipt', { requestId: id }, a.token)).data.receipt.state, 'uncertain');
});
test('permission/question responses and terminal input require individually scoped signed actions', async t => {
  const f = await fixture(t), a = await authorized(f); const permissions = [], answers = [], inputs = [];
  f.host.chats.answerPermission = (n, id, decision) => permissions.push({ nodeId: n.id, id, decision });
  f.host.chats.answerQuestion = (n, id, value) => answers.push(value);
  f.host.terminals.sessions.push({ id: 'writable', workspaceId: f.w.id, nodeId: f.node.id, status: 'lost', snapshot: '', seq: 0 }); f.host.terminals.write = (id, data) => inputs.push(data);
  await a.read('chat.get', { nodeId: f.node.id }); assert.equal(permissions.length, 0);
  assert.equal((await a.action('chat.permission.answer', { nodeId: f.node.id, requestId: 'permission', decision: 'always' })).status, 400);
  assert.equal((await a.action('chat.permission.answer', { nodeId: f.node.id, requestId: 'permission', decision: 'allow' })).status, 200);
  assert.equal((await a.action('chat.question.answer', { nodeId: f.node.id, requestId: 'question', answers: { Which: 'This one' } })).status, 200);
  assert.equal((await a.action('terminal.write', { sessionId: 'writable', data: 'one\r' })).status, 200);
  assert.equal(permissions[0].nodeId, f.node.id); assert.equal(answers[0].Which, 'This one'); assert.deepEqual(inputs, ['one\r']);
});
test('revocation closes existing connections and stop closes TLS listener', async t => {
  const f = await fixture(t), a = await authorized(f);
  f.host.terminals.sessions.push({ id: 'pending', workspaceId: f.w.id, nodeId: f.node.id, status: 'lost', snapshot: '', seq: 0 }); let enter, release;
  const entered = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
  f.host.terminals.tail = async () => { enter(); await gate; return { lines: [] }; };
  const pending = assert.rejects(a.read('terminal.attach', { sessionId: 'pending' })); await entered;
  try { await f.host.invoke('mobile.revoke', { id: a.id }); await pending; } finally { release(); }
  await f.host.invoke('mobile.stop'); await assert.rejects(request(f, '/mobile'));
});
test('device/action limits do not evict recorded request identities', async t => {
  const f = await fixture(t), a = await authorized(f);
  for (let i = 0; i < 7; i++) { const code = await f.host.invoke('mobile.pairing'); const d = await enroll(f, keys(), code.code); await f.host.invoke('mobile.approve', { id: d.id, grants: [] }); f.advance(60001); }
  const extra = await f.host.invoke('mobile.pairing'); assert.equal((await post(f, 'pair', { code: extra.code, name: 'Extra', publicKey: keys().publicDER })).status, 429);
  const id = randomUUID(), payload = { nodeId: f.node.id, text: 'Bounded action' };
  assert.equal((await a.action('chat.send', payload, id)).status, 200);
  for (let i = 1; i < 256; i++) { if (i % 30 === 0) f.advance(60001); assert.equal((await a.action('chat.send', payload)).status, 200); }
  assert.equal((await a.action('chat.send', payload)).status, 429);
  assert.equal((await post(f, 'receipt', { requestId: id }, a.token)).data.receipt.state, 'completed'); assert.equal(f.writes(), 256);
});
test('pairing proof precedes pending state and desktop approval precedes login', async t => {
  const f = await fixture(t); await f.start(); const key = keys();
  const r = await post(f, 'pair', { code: f.access.pairing.code, name: 'Phone', publicKey: key.publicDER });
  assert.equal(r.data.token, undefined); assert.equal((await post(f, 'login/challenge', { deviceId: r.data.deviceId })).status, 401);
  assert.equal((await post(f, 'pair/prove', { deviceId: r.data.deviceId, challengeId: r.data.challengeId, signature: proof(key, r.data) })).status, 200);
  assert.equal((await post(f, 'login/challenge', { deviceId: r.data.deviceId })).status, 401);
  const status = await f.host.invoke('mobile.status'); assert.equal(status.devices[0].state, 'pending'); assert.deepEqual(status.devices[0].grants, []);
});
test('SPKI accepts only canonical P256, rejects RSA/P384/padded/invalid DER', () => {
  const key = keys(); assert.ok(deviceKey(key.publicDER).fingerprint);
  const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  for (const value of [key.publicDER + '=', p384, rsa, 'AA', '!!!!', key.publicDER + 'AA']) assert.throws(() => deviceKey(value));
});
test('wrong pairing proof never creates an approved or pending device', async t => {
  const f = await fixture(t); await f.start(); const key = keys(); const c = await post(f, 'pair', { code: f.access.pairing.code, name: 'Phone', publicKey: key.publicDER });
  assert.equal((await post(f, 'pair/prove', { deviceId: c.data.deviceId, challengeId: c.data.challengeId, signature: proof(keys(), c.data) })).status, 401);
  assert.equal((await f.host.invoke('mobile.status')).devices[0].state, 'proving');
  f.advance(120001); assert.deepEqual((await f.host.invoke('mobile.status')).devices, []);
});
test('approval defaults to read only and main agent requires explicit acknowledgment', async t => {
  const f = await fixture(t), a = await authorized(f, ['read']); assert.equal((await a.issue()).status, 403);
  const state = await f.host.invoke('mobile.status'), main = state.nodes.find(n => n.main);
  await assert.rejects(f.host.invoke('mobile.permissions', { id: a.id, grants: [{ nodeId: main.id, capabilities: ['read'] }] }), /permisos reales/);
  await f.host.invoke('mobile.permissions', { id: a.id, grants: [{ nodeId: main.id, capabilities: ['read'] }], acknowledgeAgentAuthority: true });
  assert.equal((await a.read('chat.get', { nodeId: f.node.id })).status, 403);
});
test('wrong signature is rejected without effect and consumes challenge', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue();
  assert.equal((await post(f, 'action', { challengeId: c.data.challengeId, signature: proof(keys(), c.data) }, a.token)).status, 401);
  assert.equal((await a.execute(c.data)).status, 401); assert.equal(f.writes(), 0);
});
test('signed envelope binds exact payload, host, node, method and permission version', async t => {
  const f = await fixture(t), a = await authorized(f);
  for (const change of [{ payload: { nodeId: f.hidden.id, text: 'tampered' } }, { method: 'terminal.stop' }, { hostId: 'other' }, { nodeId: f.hidden.id }, { permissionVersion: 99 }]) {
    const c = await a.issue(); const original = JSON.parse(Buffer.from(c.data.bytes, 'base64url')); const tampered = { ...c.data, bytes: Buffer.from(JSON.stringify({ ...original, ...change })).toString('base64url') };
    assert.equal((await a.execute(tampered)).status, 401);
  }
  const c = await a.issue(); assert.equal((await post(f, 'action', { challengeId: c.data.challengeId, signature: proof(a.key, c.data), payload: { text: 'extra' } }, a.token)).status, 400); assert.equal(f.writes(), 0);
});
test('expired challenges cannot execute', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue(); f.advance(60001); assert.equal((await a.execute(c.data)).status, 401); assert.equal(f.writes(), 0);
});
test('reduced permissions invalidate in-flight challenges', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue();
  await f.host.invoke('mobile.permissions', { id: a.id, grants: [{ nodeId: f.node.id, capabilities: ['read'] }] });
  assert.equal((await a.execute(c.data)).status, 401); assert.equal((await a.issue()).status, 403); assert.equal(f.writes(), 0);
});
test('revoked device cannot execute in-flight challenge or reauthenticate', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue(); await f.host.invoke('mobile.revoke', { id: a.id });
  assert.equal((await a.execute(c.data)).status, 401); assert.equal((await post(f, 'login/challenge', { deviceId: a.id })).status, 401); assert.equal(f.writes(), 0);
});
test('polling does not extend ten-minute idle lock; signed login unlocks', async t => {
  const f = await fixture(t), a = await authorized(f);
  for (let i = 0; i < 9; i++) { f.advance(60000); assert.equal((await a.read('sessions.list')).status, 200); }
  f.advance(60000); assert.equal((await a.read('sessions.list')).status, 401);
  const token = await login(f, a); assert.equal((await post(f, 'read', { method: 'sessions.list' }, token)).status, 200);
  f.advance(3600001); assert.equal((await post(f, 'read', { method: 'sessions.list' }, token)).status, 401);
});
test('audit records identifiers not token/code/SPKI/conversation/command bodies and files are private', async t => {
  const f = await fixture(t), a = await authorized(f); const secretText = 'SECRET_COMMAND_OR_CONVERSATION'; await a.action('chat.send', { nodeId: f.node.id, text: secretText });
  const events = await f.host.invoke('mobile.audit'), text = JSON.stringify(events);
  for (const secret of [secretText, a.token, f.access.pairing.code, a.key.publicDER, 'PRIVATE']) assert.ok(!text.includes(secret));
  for (const method of ['pair', 'approve', 'login', 'chat.send']) assert.ok(events.some(e => e.method === method));
  assert.equal(fs.statSync(path.join(f.dataDir, 'mobile-audit', 'events.jsonl')).mode & 0o777, 0o600);
});
test('audit admission failure denies effect and reserves idempotent receipt', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue(); const saved = MobileAudit.prototype.append;
  MobileAudit.prototype.append = () => { throw new Error('fixture audit unavailable'); };
  try { assert.equal((await a.execute(c.data)).status, 503); assert.equal(f.writes(), 0); } finally { MobileAudit.prototype.append = saved; }
  const env = JSON.parse(Buffer.from(c.data.bytes, 'base64url'));
  assert.equal((await a.issue('chat.send', env.payload, env.requestId)).status, 409); assert.equal((await post(f, 'receipt', { requestId: env.requestId }, a.token)).data.receipt.reason, 'audit-admission-failed');
});
test('revocation remains immediate when its audit write fails', async t => {
  const f = await fixture(t), a = await authorized(f), original = MobileAudit.prototype.append;
  MobileAudit.prototype.append = () => { throw new Error('fixture audit unavailable'); };
  try {
    await assert.rejects(f.host.invoke('mobile.revoke', { id: a.id }), /auditoría/);
    assert.equal((await a.read('sessions.list')).status, 401);
    assert.deepEqual((await f.host.invoke('mobile.status')).devices, []);
  } finally { MobileAudit.prototype.append = original; }
});
test('truncated on-disk audit fails closed before invoking a signed action', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue();
  fs.appendFileSync(path.join(f.dataDir, 'mobile-audit', 'events.jsonl'), '{truncated');
  assert.equal((await a.execute(c.data)).status, 503); assert.equal(f.writes(), 0);
  assert.match((await f.host.invoke('mobile.status')).auditError, /auditoría/);
});
test('pairing abuse isolated by socket IP, not forwarded headers or authenticated RPC', async t => {
  const f = await fixture(t), a = await authorized(f);
  for (let i = 0; i < 11; i++) await post(f, 'pair', { code: 'wrong' }, undefined, { headers: { 'X-Forwarded-For': `192.168.0.${i}` } });
  assert.equal((await post(f, 'pair', { code: 'wrong' })).status, 429);
  assert.equal((await a.read('sessions.list')).status, 200);
  const code = await f.host.invoke('mobile.pairing');
  const otherIP = await post(f, 'pair', { code: code.code, name: 'Other IP', publicKey: keys().publicDER }, undefined, { localAddress: '127.0.0.2' }); assert.equal(otherIP.status, 200);
});
test('TLS trusts exact certificate, rejects wrong pin and TLS1.1; HTTP legacy never operates', async t => {
  const f = await fixture(t); await f.start();
  const wrong = await loadIdentity(path.join(f.root, 'wrong'), '127.0.0.1');
  await assert.rejects(request({ ...f, ca: wrong.public.certificate }, '/mobile'));
  const cert = new X509Certificate(f.ca); assert.equal(cert.checkIP('127.0.0.1'), '127.0.0.1');
  await assert.rejects(new Promise((resolve, reject) => { const socket = tls.connect({ host: '127.0.0.1', port: Number(new URL(f.origin).port), ca: f.ca, maxVersion: 'TLSv1.1', minVersion: 'TLSv1' }, () => { socket.destroy(); resolve(); }); socket.on('error', reject); }));
  const plain = await new Promise(resolve => { const req = http.request(f.origin.replace('https:', 'http:') + '/api/pair', { method: 'POST' }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', () => resolve(0)); req.end('{}'); }); assert.notEqual(plain, 200);
  assert.equal((await request(f, '/api/pair', { code: f.access.pairing.code })).status, 404);
  assert.equal((await request(f, '/api/rpc', { method: 'chat.send', biometricVerified: true }, 'old-token')).status, 404);
});
test('stable identity survives restart; corrupt/expired identity fails closed until explicit regeneration', async t => {
  const f = await fixture(t); const first = await f.start(); await f.host.invoke('mobile.stop'); const second = await f.start(); assert.equal(first.identity.fingerprint, second.identity.fingerprint);
  await f.host.invoke('mobile.stop'); fs.writeFileSync(path.join(f.dataDir, 'mobile-identity', '127.0.0.1.key'), 'corrupt');
  await assert.rejects(f.start()); const regenerated = await f.host.invoke('mobile.identity', { regenerate: true, address: '127.0.0.1' }); assert.notEqual(first.identity.fingerprint, regenerated.fingerprint);
  await f.start(); assert.equal(fs.statSync(path.join(f.dataDir, 'mobile-identity')).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(f.dataDir, 'mobile-identity', '127.0.0.1.key')).mode & 0o777, 0o600);
});
test('challenge budgets and oversized read text fail before response serialization', async t => {
  const f = await fixture(t), a = await authorized(f);
  f.host.chats.get = () => ({ messages: [{ parts: [{ type: 'text', text: 'x'.repeat(2000000) }] }] }); assert.equal((await a.read('chat.get', { nodeId: f.node.id })).status, 413);
  const code = await f.host.invoke('mobile.pairing'), d = await enroll(f, keys(), code.code);
  await f.host.invoke('mobile.approve', { id: d.id, grants: [{ nodeId: f.node.id, capabilities: ['read', 'chat.send'] }] }); const token = await login(f, d);
  for (let i = 0; i < 80; i++) assert.equal((await a.issue()).status, 200);
  for (let i = 0; i < 48; i++) assert.equal((await post(f, 'action/challenge', { method: 'chat.send', payload: { nodeId: f.node.id, text: 'cap' }, requestId: randomUUID() }, token)).status, 200);
  assert.equal((await a.issue()).status, 429);
  f.advance(60001); assert.equal((await a.issue()).status, 200);
});
test('action challenge from another device cannot be executed by this bearer', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue();
  const code = await f.host.invoke('mobile.pairing'), d = await enroll(f, keys(), code.code);
  await f.host.invoke('mobile.approve', { id: d.id, grants: [{ nodeId: f.node.id, capabilities: ['read', 'chat.send'] }] }); const token = await login(f, d);
  assert.equal((await post(f, 'action', { challengeId: c.data.challengeId, signature: proof(a.key, c.data) }, token)).status, 401); assert.equal(f.writes(), 0);
});
test('global concurrency budget rejects ninth request without additional effect', async t => {
  const f = await fixture(t), a = await authorized(f); let entered = 0, release;
  const gate = new Promise(r => { release = r; }); f.host.chats.send = async () => { entered++; await gate; };
  const challenges = []; for (let i = 0; i < 8; i++) challenges.push((await a.issue()).data);
  const pending = challenges.map(c => a.execute(c));
  try {
    const deadline = Date.now() + 5000;
    while (entered < 8 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.equal(entered, 8); assert.equal((await a.read('sessions.list')).status, 429); assert.equal(entered, 8);
  } finally { release(); await Promise.all(pending); }
});
test('revocation during incomplete action body prevents invocation', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue();
  const body = JSON.stringify({ challengeId: c.data.challengeId, signature: proof(a.key, c.data) }); let req;
  const result = new Promise(resolve => {
    req = https.request(f.origin + '/api/v2/action', { ca: f.ca, method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${a.token}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0)); req.write(body.slice(0, 20));
  });
  await new Promise(r => setTimeout(r, 30)); await f.host.invoke('mobile.revoke', { id: a.id }); req.end(body.slice(20));
  assert.notEqual(await result, 200); assert.equal(f.writes(), 0);
});
test('audit failure after effect preserves uncertain receipt without second invocation', async t => {
  const f = await fixture(t), a = await authorized(f), c = await a.issue(), original = MobileAudit.prototype.append; let effects = 0;
  f.host.chats.send = () => { effects++; MobileAudit.prototype.append = () => { throw new Error('fixture final audit failed'); }; };
  try { assert.equal((await a.execute(c.data)).status, 503); assert.equal(effects, 1); } finally { MobileAudit.prototype.append = original; }
  const envelope = JSON.parse(Buffer.from(c.data.bytes, 'base64url'));
  assert.equal((await post(f, 'receipt', { requestId: envelope.requestId }, a.token)).data.receipt.reason, 'audit-unavailable-after-effect');
  assert.equal((await a.issue('chat.send', envelope.payload, envelope.requestId)).status, 409); assert.equal(effects, 1);
});
test('expired identity is rejected without silently changing certificate or key', async t => {
  const f = await fixture(t); await f.start(); await f.host.invoke('mobile.stop');
  const dir = path.join(f.dataDir, 'mobile-identity'), certFile = path.join(dir, '127.0.0.1.crt'), keyFile = path.join(dir, '127.0.0.1.key');
  // All OpenSSL arguments refer to this temporary fixture, never a real profile.
  await promisify(execFile)('/usr/bin/openssl', ['x509', '-in', certFile, '-signkey', keyFile, '-days', '-1', '-out', certFile + '.expired'], { timeout: 15000 });
  fs.renameSync(certFile + '.expired', certFile); const expired = fs.readFileSync(certFile), key = fs.readFileSync(keyFile);
  await assert.rejects(f.start(), /caducada/); assert.deepEqual(fs.readFileSync(certFile), expired); assert.deepEqual(fs.readFileSync(keyFile), key);
});
test('audit rotation is bounded and keeps every retained file mode600', async t => {
  const f = await fixture(t), log = new MobileAudit(f.dataDir);
  for (let i = 0; i < 1800; i++) log.append({ timestamp: Date.now(), deviceId: 'd'.repeat(128), workspaceId: 'w'.repeat(128), nodeId: 'n'.repeat(128), method: 'chat.send', outcome: 'completed', reason: 'fixture', requestId: String(i) });
  const files = fs.readdirSync(path.join(f.dataDir, 'mobile-audit')); assert.equal(files.length, 3);
  for (const name of files) { const stat = fs.statSync(path.join(f.dataDir, 'mobile-audit', name)); assert.equal(stat.mode & 0o777, 0o600); assert.ok(stat.size < 258 * 1024); }
  assert.ok(log.list().length <= 100);
});
test('terminal session moving to another granted node invalidates old binding', async t => {
  const f = await fixture(t), a = await authorized(f);
  await f.host.invoke('mobile.permissions', { id: a.id, grants: [f.node.id, f.hidden.id].map(nodeId => ({ nodeId, capabilities: ['read', 'terminal.write'] })) });
  const terminal = { id: 'moving', workspaceId: f.w.id, nodeId: f.node.id, status: 'lost', snapshot: '', seq: 0 }; f.host.terminals.sessions.push(terminal); let effects = 0; f.host.terminals.write = () => { effects++; };
  const c = await a.issue('terminal.write', { sessionId: terminal.id, data: 'bound' }); terminal.nodeId = f.hidden.id;
  assert.equal((await a.execute(c.data)).status, 400); assert.equal(effects, 0);
});
