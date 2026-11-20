import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createHost } from '../host/server.mjs';
import { HOST_METHODS } from '../desktop/security.mjs';
import { MobileAudit } from '../host/mobile-audit.mjs';
import { fetch, fixture, rawPost, post, phone, signed, authorized } from './support/mobile-fixture.mjs';

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
