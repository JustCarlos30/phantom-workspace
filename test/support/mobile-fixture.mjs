import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import tls from 'node:tls';
import { randomUUID, generateKeyPairSync, createHash, sign } from 'node:crypto';
import { createHost } from '../../host/server.mjs';

// Trust only the certificate generated for each fixture, never disable TLS verification.
export const certificates = new Map();
export const gateways = new Map(), deviceKeys = new Map();
export const phone = () => { const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' }); return { ...keys, jwk: keys.publicKey.export({ format: 'jwk' }) }; };
export function signed(origin, route, body, key, time = gateways.get(origin).now()) {
  const timestamp = String(time), raw = typeof body === 'string' ? body : JSON.stringify(body);
  return { 'X-Phantom-Time': timestamp, 'X-Phantom-Signature': sign('sha256', Buffer.from(`${timestamp}\n${route}\n${createHash('sha256').update(raw).digest('hex')}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
}
export function fetch(url, options = {}) {
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
export async function fixture(t, options = {}) {
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
export async function rawPost(origin, route, body, token, headers = {}) {
  const response = await fetch(origin + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
export async function post(origin, route, body, token, headers = {}) {
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
export async function authorized(f) {
  const status = await f.start(), origin = new URL(status.url).origin;
  const paired = await post(origin, '/api/pair', { code: status.pairing.code, name: 'Test phone' });
  assert.equal(paired.status, 200);
  const token = paired.data.token;
  return { origin, token, rpc: (method, payload = {}, requestId = randomUUID()) => post(origin, '/api/rpc', { method, payload, requestId }, token) };
}
export function raw(origin, url, headers = {}) {
  return new Promise((resolve, reject) => {
    // A forged HTTP Host must reach the gateway's Host check. Verify TLS against
    // the actual destination IP, independently of that deliberately forged header.
    const request = https.request(origin, { path: url, headers, ca: certificates.get(origin), agent: false, servername: '', checkServerIdentity: (_name, cert) => tls.checkServerIdentity(new URL(origin).hostname, cert) }, response => { let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body })); });
    request.on('error', reject); request.end();
  });
}
