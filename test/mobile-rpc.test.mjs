import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { certificates, fixture, post, authorized } from './support/mobile-fixture.mjs';

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
