import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { createHost } from '../host/server.mjs';
import { HOST_METHODS } from '../desktop/security.mjs';

// All listeners bind loopback, all projects/profiles are synthetic. No CLI,
// shell, agent, user profile or external model is started by these fixtures.
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
  const start = () => host.invoke('mobile.start', { workspaceId: w.id, address: '127.0.0.1', port: 0 });
  return { root, distDir, host, w, foreign, node, other, start, advance: ms => { clock += ms; }, writes: () => writes };
}
async function post(origin, route, body, token, headers = {}) {
  const response = await fetch(origin + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
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
    const request = http.request(origin, { path: url, headers }, response => { let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body })); });
    request.on('error', reject); request.end();
  });
}

test('mobile is opt-in, desktop-only management, start/stop and restart forget access', async t => {
  const f = await fixture(t);
  assert.equal((await f.host.invoke('mobile.status')).enabled, false);
  for (const method of ['status', 'start', 'stop', 'pairing', 'revoke']) assert.ok(HOST_METHODS.has(`mobile.${method}`));
  const started = await f.start(); assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/mobile$/);
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
  assert.equal((await post(origin, '/api/rpc', 'x'.repeat(65537), token)).status, 413);
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

test('revocation and host shutdown close existing connections and the HTTP listener', async t => {
  const f = await fixture(t), { origin, rpc } = await authorized(f);
  f.host.terminals.sessions.push({ id: 'pending-attach', workspaceId: f.w.id, nodeId: f.node.id, status: 'lost', snapshot: '', seq: 0 });
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.host.terminals.tail = async () => { enter(); await gate; return { status: 'lost', seq: 0, lines: [] }; };
  const pending = assert.rejects(rpc('terminal.attach', { sessionId: 'pending-attach' }));
  await entered;
  try { await f.host.invoke('mobile.revoke', { id: (await f.host.invoke('mobile.status')).devices[0].id }); await pending; }
  finally { release(); }
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
