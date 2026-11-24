import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildAppPairingPayload, parseAppPairingPayload, buildBrowserPairingUrl, readBrowserPairingCode, qrMatrix } from '../src/phone-pairing.mjs';
import { standardGrants, grantsFromSelection, selectionFromGrants, needsAcknowledgement } from '../src/phone-permissions.mjs';

async function payload(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-qr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, ...fixed };
}

const fixed = { bootstrap: { url: 'https://192.168.1.25:9443', fingerprint: '00'.repeat(32), certificate: 'NO INCLUIR' }, code: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', now: 0x010203030000, expiresAt: 0x010203040506 };

test('v2 coincide byte a byte con vector independiente y hace roundtrip sin certificado', () => {
  const text = buildAppPairingPayload(fixed);
  const expected = Buffer.from('c0a8011924e3' + '00'.repeat(64) + '010203040506', 'hex');
  assert.equal(expected.length, 76);
  assert.equal(text, 'phantom-pair:v2:' + expected.toString('base64url'));
  assert.equal(text.length, 118);
  assert.deepEqual(parseAppPairingPayload(text, { now: fixed.now }), { bootstrap: { url: fixed.bootstrap.url, fingerprint: fixed.bootstrap.fingerprint }, code: fixed.code, expiresAt: fixed.expiresAt });
  assert.equal(buildAppPairingPayload({ ...fixed, bootstrap: { url: fixed.bootstrap.url, fingerprint: Array(32).fill('AB').join(':') } }), buildAppPairingPayload({ ...fixed, bootstrap: { url: fixed.bootstrap.url, fingerprint: 'ab'.repeat(32) } }));
});

test('valida dirección, puerto, huella, código canónico y límites de caducidad', () => {
  for (const url of ['http://192.168.1.25', 'https://localhost', 'https://192.168.001.25', 'https://256.1.1.1', 'https://1.2.3.4:0', 'https://1.2.3.4:65536', 'https://1.2.3.4/path', 'https://user@1.2.3.4']) {
    assert.throws(() => buildAppPairingPayload({ ...fixed, bootstrap: { ...fixed.bootstrap, url } }), /no válido/);
  }
  for (const fingerprint of ['', 'SHA256:abc', 'AB'.repeat(32), null]) assert.throws(() => buildAppPairingPayload({ ...fixed, bootstrap: { ...fixed.bootstrap, fingerprint } }), /no válido/);
  for (const code of ['', 'A'.repeat(42), 'A'.repeat(42) + 'B', fixed.code + '=', null]) assert.throws(() => buildAppPairingPayload({ ...fixed, code }), /no válido/);
  for (const expiresAt of [fixed.now, fixed.now - 1, fixed.now + 120001, NaN, fixed.now + 0.5, String(fixed.expiresAt), 281474976710656]) assert.throws(() => buildAppPairingPayload({ ...fixed, expiresAt }), /no válido/);
  for (const delta of [1, 120000]) {
    const text = buildAppPairingPayload({ ...fixed, expiresAt: fixed.now + delta });
    assert.equal(parseAppPairingPayload(text, { now: fixed.now }).expiresAt, fixed.now + delta);
    assert.throws(() => parseAppPairingPayload(text, { now: fixed.now + delta }), /no válido/);
    assert.throws(() => parseAppPairingPayload(text, { now: fixed.now - 120000 }), /no válido/);
  }
  for (const port of ['', ':1', ':65535']) {
    const text = buildAppPairingPayload({ ...fixed, bootstrap: { ...fixed.bootstrap, url: `https://1.2.3.4${port}` } });
    assert.equal(parseAppPairingPayload(text, { now: fixed.now }).bootstrap.url, `https://1.2.3.4:${port.slice(1) || 443}`);
  }
  const max = 281474976710655;
  assert.equal(parseAppPairingPayload(buildAppPairingPayload({ ...fixed, now: max - 1, expiresAt: max }), { now: max - 1 }).expiresAt, max);
});

test('parser rechaza versiones anteriores, padding, bits no canónicos y puerto cero', () => {
  const text = buildAppPairingPayload(fixed);
  const bytes = Buffer.from(text.slice(16), 'base64url');
  bytes[4] = bytes[5] = 0;
  for (const value of ['{}', text.replace(':v2:', ':v1:'), text + '=', text.slice(0, -1), text.slice(0, -1) + 'h', 'phantom-pair:v2:' + bytes.toString('base64url')]) assert.throws(() => parseAppPairingPayload(value, { now: fixed.now }), /no válido/);
});

test('URL del navegador codifica el código exclusivamente en el fragmento', () => {
  const code = 'a+b /?&=一';
  const url = buildBrowserPairingUrl('https://192.168.1.25:9443/mobile', code);
  assert.equal(url, `https://192.168.1.25:9443/mobile#pair=${encodeURIComponent(code)}`);
  assert.equal(new URL(url).search, '');
  assert.equal(readBrowserPairingCode(new URL(url).hash), code);
  assert.equal(readBrowserPairingCode(''), '');
});

test('UI pasa expiry ISO/numérico, oculta QR inválido y ofrece recuperación sin romper render', async () => {
  const { transformWithEsbuild } = await import('vite');
  const source = fs.readFileSync(new URL('../src/components/AndroidGatewaySettings.jsx', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export default function', 'function');
  const { code } = await transformWithEsbuild(source, 'AndroidGatewaySettings.jsx', { loader: 'jsx', jsx: 'transform' });
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment' };
  const now = Date.now(), expiresAt = now + 60000;
  for (const expiry of [expiresAt, new Date(expiresAt).toISOString(), String(expiresAt), now - 1, 'invalid']) {
    let index = 0;
    const states = [{ enabled: true, pairingExpiresAt: expiresAt, devices: [], interfaces: [], node: {}, repoValid: true }, '', '', '0', fixed.bootstrap, { code: fixed.code, expiresAt: expiry }, true, false, '', false, now];
    const effects = [];
    const component = new Function('React', 'useState', 'useRef', 'useEffect', 'Group', 'Row', 'TextRow', 'Switch', 'PhoneQr', 'MobileSettings', 'buildAppPairingPayload', 'standardGrants', 'grantsFromSelection', 'selectionFromGrants', 'needsAcknowledgement', code + '\nreturn AndroidGatewaySettings;')(React, () => [states[index++], () => {}], value => ({ current: value }), (...args) => effects.push(args), 'Group', 'Row', 'TextRow', 'Switch', 'PhoneQr', 'MobileSettings', buildAppPairingPayload, standardGrants, grantsFromSelection, selectionFromGrants, needsAcknowledgement);
    const tree = component({ workspace: { id: 'test', name: 'Test' }, api: () => {} });
    const nodes = [];
    const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (node && typeof node === 'object') { nodes.push(node); visit(node.children); } };
    visit(tree);
    const qr = nodes.find(node => node.type === 'PhoneQr');
    assert.ok(nodes.some(node => node.props?.className === 'st-phone-link'));
    const actions = nodes.find(node => node.props?.className === 'st-actions');
    assert.ok(actions);
    assert.ok(nodes.some(node => node.type === 'Row' && node.props?.hint?.includes('Phantom Workspace (todos tus proyectos)')));
    assert.ok(!nodes.some(node => node.type === 'Row' && node.props?.label === ''));
    assert.ok(!nodes.some(node => node.type === 'p' && node.children.includes('Test')));
    if (expiry === now - 1 || expiry === 'invalid') {
      assert.equal(qr, undefined);
      assert.ok(nodes.some(node => node.props?.role === 'alert'));
      assert.ok(nodes.some(node => node.type === 'button' && node.children.includes('Reintentar') && typeof node.props.onClick === 'function'));
    } else {
      assert.equal(parseAppPairingPayload(qr.props.text, { now }).expiresAt, expiresAt);
    }
    assert.ok(effects.some(([, dependencies]) => dependencies?.length === 1 && dependencies[0] === now));
  }
});

test('UI pendiente muestra SAS y bloquea Permitir sin SAS válido', async () => {
  const { transformWithEsbuild } = await import('vite');
  const source = fs.readFileSync(new URL('../src/components/AndroidGatewaySettings.jsx', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export default function', 'function');
  const { code } = await transformWithEsbuild(source, 'AndroidGatewaySettings.jsx', { loader: 'jsx', jsx: 'transform' });
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment' };
  for (const sas of ['123456', undefined, '12345', 'abcdef']) {
    let index = 0;
    const device = { id: 'd1', name: 'Tel', state: 'pending', keyFingerprint: 'a'.repeat(64), ...(sas === undefined ? {} : { sas }) };
    const states = [{ enabled: true, workspacesAvailable: true, workspaces: [], devices: [device], interfaces: [], node: { compatible: true }, repoValid: true }, '', '', '0', null, null, false, false, '', false, Date.now()];
    const component = new Function('React', 'useState', 'useRef', 'useEffect', 'Group', 'Row', 'TextRow', 'Switch', 'PhoneQr', 'MobileSettings', 'buildAppPairingPayload', 'standardGrants', 'grantsFromSelection', 'selectionFromGrants', 'needsAcknowledgement', code + '\nreturn AndroidGatewaySettings;')(React, () => [states[index++], () => {}], value => ({ current: value }), () => {}, 'Group', 'Row', 'TextRow', 'Switch', 'PhoneQr', 'MobileSettings', buildAppPairingPayload, standardGrants, grantsFromSelection, selectionFromGrants, needsAcknowledgement);
    const tree = component({ workspace: { id: 'w', name: 'W' }, api: () => {} });
    const nodes = [];
    const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (node && typeof node === 'object') { nodes.push(node); visit(node.children); } };
    visit(tree);
    const allow = nodes.find(node => node.type === 'button' && node.children.includes('Permitir'));
    const shown = nodes.find(node => node.props?.className === 'st-sas');
    assert.ok(allow);
    assert.equal(allow.props.disabled, sas !== '123456');
    assert.equal(shown.children.join(''), sas === '123456' ? '123 456' : '—');
  }
});

test('matriz QR es cuadrada, booleana y admite un bootstrap realista', async t => {
  const input = await payload(t);
  const { size, modules } = qrMatrix(buildAppPairingPayload(input));
  assert.ok(size >= 21 && (size - 17) % 4 === 0);
  assert.ok(size <= 49);
  assert.equal(modules.length, size);
  for (const row of modules) { assert.equal(row.length, size); assert.ok(row.every(value => typeof value === 'boolean')); }
  assert.equal(modules[0][0], true);
  assert.throws(() => qrMatrix('x'.repeat(10000)), /no caben/);
});

test('zbar decodifica exactamente QR de app y navegador con UTF-8', async t => {
  if (!fs.existsSync('/usr/bin/zbarimg')) return t.skip('zbarimg no está instalado');
  const input = await payload(t);
  const texts = [buildAppPairingPayload(input), buildBrowserPairingUrl(input.bootstrap.url + '/mobile', 'vinculación-一 +/?&=secreto')];
  for (const [index, text] of texts.entries()) {
    const { size, modules } = qrMatrix(text), width = (size + 8) * 4;
    const rows = Array.from({ length: width }, (_, y) => Array.from({ length: width }, (_, x) => modules[Math.floor(y / 4) - 4]?.[Math.floor(x / 4) - 4] ? '1' : '0').join(' '));
    const file = path.join(input.dir, `${index}.pbm`);
    fs.writeFileSync(file, `P1\n${width} ${width}\n${rows.join('\n')}\n`);
    assert.equal(execFileSync('/usr/bin/zbarimg', ['--raw', '-q', '--set', 'binary=1', file], { encoding: 'utf8' }), text + '\n');
  }
});
