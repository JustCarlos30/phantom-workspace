import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { buildAppPairingPayload, parseAppPairingPayload, buildBrowserPairingUrl, readBrowserPairingCode, qrMatrix } from '../src/phone-pairing.mjs';

async function payload(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-qr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const certificate = execFileSync('openssl', ['req', '-new', '-x509', '-sha256', '-days', '365', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-subj', '/CN=Phantom Workspace mobile/O=Phantom Workspace/OU=Android phone pairing gateway', '-addext', 'subjectAltName=IP:192.168.1.25'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = new X509Certificate(certificate);
  assert.equal(parsed.publicKey.asymmetricKeyDetails.namedCurve, 'prime256v1');
  const bootstrap = { version: 1, hostId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', url: 'https://192.168.1.25:9443', fingerprint: parsed.fingerprint256, certificate, expiresAt: Date.now() + 120000 };
  return { dir, bootstrap, code: 'vinculación-一 +/?&=secreto' };
}

test('payload de app conserva bootstrap TLS P-256 y código sin transformar', async t => {
  const { bootstrap, code } = await payload(t);
  assert.match(bootstrap.certificate, /BEGIN CERTIFICATE/);
  assert.ok(bootstrap.certificate.length >= 750 && bootstrap.certificate.length <= 900);
  const text = buildAppPairingPayload({ bootstrap, code });
  assert.equal(text, JSON.stringify({ t: 'phantom-pair', v: 1, b: bootstrap, c: code }));
  assert.deepEqual(parseAppPairingPayload(text), { bootstrap, code });
});

test('rechaza tipo, versión, HTTP, huella y código ausentes o inválidos', () => {
  const valid = { t: 'phantom-pair', v: 1, b: { url: 'https://192.168.1.25', fingerprint: 'SHA256:abc' }, c: 'secreto' };
  for (const value of [{ ...valid, t: 'otro' }, { ...valid, v: 2 }, { ...valid, b: { ...valid.b, url: 'http://192.168.1.25' } }, { ...valid, b: { url: valid.b.url } }, { ...valid, c: undefined }, { ...valid, c: '' }, null]) {
    assert.throws(() => parseAppPairingPayload(JSON.stringify(value)), /no válido/);
  }
  assert.throws(() => parseAppPairingPayload('{'), /no válido/);
});

test('URL del navegador codifica el código exclusivamente en el fragmento', () => {
  const code = 'a+b /?&=一';
  const url = buildBrowserPairingUrl('https://192.168.1.25:9443/mobile', code);
  assert.equal(url, `https://192.168.1.25:9443/mobile#pair=${encodeURIComponent(code)}`);
  assert.equal(new URL(url).search, '');
  assert.equal(readBrowserPairingCode(new URL(url).hash), code);
  assert.equal(readBrowserPairingCode(''), '');
});

test('matriz QR es cuadrada, booleana y admite un bootstrap realista', async t => {
  const input = await payload(t);
  const { size, modules } = qrMatrix(buildAppPairingPayload(input));
  assert.ok(size >= 21 && (size - 17) % 4 === 0);
  assert.equal(modules.length, size);
  for (const row of modules) { assert.equal(row.length, size); assert.ok(row.every(value => typeof value === 'boolean')); }
  assert.equal(modules[0][0], true);
  assert.throws(() => qrMatrix('x'.repeat(10000)), /no caben/);
});

test('zbar decodifica exactamente QR de app y navegador con UTF-8', async t => {
  if (!fs.existsSync('/usr/bin/zbarimg')) return t.skip('zbarimg no está instalado');
  const input = await payload(t);
  const texts = [buildAppPairingPayload(input), buildBrowserPairingUrl(input.bootstrap.url + '/mobile', input.code)];
  for (const [index, text] of texts.entries()) {
    const { size, modules } = qrMatrix(text), width = (size + 8) * 4;
    const rows = Array.from({ length: width }, (_, y) => Array.from({ length: width }, (_, x) => modules[Math.floor(y / 4) - 4]?.[Math.floor(x / 4) - 4] ? '1' : '0').join(' '));
    const file = path.join(input.dir, `${index}.pbm`);
    fs.writeFileSync(file, `P1\n${width} ${width}\n${rows.join('\n')}\n`);
    assert.equal(execFileSync('/usr/bin/zbarimg', ['--raw', '-q', '--set', 'binary=1', file], { encoding: 'utf8' }), text + '\n');
  }
});
