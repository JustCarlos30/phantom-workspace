import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { X509Certificate, createPublicKey } from 'node:crypto';
import { mobileTLS } from '../host/mobile-tls.mjs';
import { certificates, fetch, fixture, post, authorized, raw } from './support/mobile-fixture.mjs';

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

test('only canonical allowlisted build assets are served; raw traversal and symlinks fail', async t => {
  const f = await fixture(t); fs.writeFileSync(path.join(f.root, 'private.txt'), 'PRIVATE');
  fs.symlinkSync(path.join(f.root, 'private.txt'), path.join(f.distDir, 'assets', 'linked.js'));
  const { origin } = await authorized(f);
  for (const route of ['/mobile?token=secret', '/', '/src/main.jsx', '/host/server.mjs', '/assets/linked.js', '/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/%2fetc/passwd', '//assets/fixture.js', '/assets/fixture.js?x=1']) assert.equal((await raw(origin, route)).status, 404, route);
  const script = await raw(origin, '/assets/fixture.js'); assert.equal(script.status, 200); assert.match(script.headers['content-type'], /javascript/);
  fs.unlinkSync(path.join(f.distDir, 'assets', 'fixture.js')); fs.symlinkSync(path.join(f.root, 'private.txt'), path.join(f.distDir, 'assets', 'fixture.js'));
  assert.notEqual((await raw(origin, '/assets/fixture.js')).status, 200);
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
