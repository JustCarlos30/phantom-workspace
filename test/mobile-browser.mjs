import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { X509Certificate, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chromium } from 'playwright';
import { build } from 'vite';
import { createHost } from '../host/server.mjs';

const evidence = '/tmp/phantom-mobile-secure-evidence';
await fs.mkdir(evidence, { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-mobile-secure-browser-'));
const repo = fileURLToPath(new URL('../', import.meta.url));
let host, browser, local;
const errors = [], results = [];
try {
  await fs.mkdir(path.join(root, 'project'));
  host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  const workspace = await host.invoke('workspace.open', { path: path.join(root, 'project') });
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal', title: 'Sesión de prueba', data: { chat: { provider: 'claude' } } });
  let effects = 0; host.chats.send = () => { effects++; };
  assert.equal((await host.invoke('mobile.status')).enabled, false);
  const access = await host.invoke('mobile.start', { workspaceId: workspace.id, address: '127.0.0.1' });
  const cert = new X509Certificate(access.identity.certificate);
  assert.equal(createHash('sha256').update(cert.raw).digest('hex'), access.identity.fingerprint);
  assert.equal(cert.checkIP('127.0.0.1'), '127.0.0.1'); assert.ok(cert.verify(cert.publicKey));
  const native = (route, body) => new Promise((resolve, reject) => {
    const req = https.request(new URL(route, access.url), { method: body ? 'POST' : 'GET', ca: access.identity.certificate, headers: body ? { 'Content-Type': 'application/json' } : {}, agent: false }, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    }); req.on('error', reject); req.end(body && JSON.stringify(body));
  });
  assert.equal((await native('/mobile')).status, 200); // actual hostname/CA validation
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const paired = JSON.parse((await native('/api/v2/pair', { code: access.pairing.code, name: 'Teléfono fixture', publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') })).text);
  assert.equal((await native('/api/v2/pair/prove', { deviceId: paired.deviceId, challengeId: paired.challengeId, signature: sign('sha256', Buffer.from(paired.bytes, 'base64url'), pair.privateKey).toString('base64url') })).status, 200);
  // Chromium trusts only this fixture's SPKI, never a global certificate bypass.
  // Node above independently validates the complete pinned cert, SAN and chain.
  const spki = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  browser = await chromium.launch({ headless: true, args: [`--ignore-certificate-errors-spki-list=${spki}`] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(access.url); await page.getByRole('heading', { name: 'Se necesita la app nativa' }).waitFor();
  assert.equal(await page.locator('button,input,textarea,form,script').count(), 0);
  assert.equal(await page.evaluate(() => typeof window.phantom), 'undefined');
  await page.screenshot({ path: path.join(evidence, '01-native-required.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, '02-narrow.png'), fullPage: true });
  const rejected = (await native('/api/rpc', { method: 'chat.send', biometricVerified: true })).status;
  assert.equal(rejected, 404); assert.equal(effects, 0); results.push('TLS real con CA y SAN validados; página sin controles; legacy rechazado; 390/360 px');

  // Isolated Vite fixture renders the actual desktop component. This bridge is
  // local test-only, and forwards only mobile desktop management to the tmp host.
  const entry = path.join(root, 'fixture.jsx'), bundleDir = path.join(root, 'bundle');
  await fs.writeFile(entry, `import React from ${JSON.stringify(path.join(repo, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(path.join(repo, 'node_modules/react-dom/client.js'))};
import MobileSettings from ${JSON.stringify(path.join(repo, 'src/components/MobileSettings.jsx'))};
import ${JSON.stringify(path.join(repo, 'src/tools.css'))};
const api=async(method,payload)=>{const r=await fetch('/fixture-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,payload})});const v=await r.json();if(!r.ok)throw Error(v.error);return v;};
createRoot(document.getElementById('root')).render(<MobileSettings workspace={${JSON.stringify({ id: workspace.id, name: 'Proyecto fixture' })}} api={api}/>);`);
  await build({ configFile: false, root: repo, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: bundleDir, emptyOutDir: true, lib: { entry, formats: ['es'], fileName: () => 'fixture.js' }, rollupOptions: { output: { assetFileNames: 'fixture.[ext]' } } } });
  local = http.createServer(async (req, res) => {
    try {
      if (req.url === '/fixture-api' && req.method === 'POST') {
        let text = ''; for await (const c of req) { text += c; assert.ok(text.length < 65536); }
        const { method, payload } = JSON.parse(text); assert.ok(['mobile.status', 'mobile.approve', 'mobile.permissions', 'mobile.revoke', 'mobile.stop', 'mobile.pairing'].includes(method));
        const result = await host.invoke(method, payload); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
      }
      if (['/fixture.js', '/fixture.css'].includes(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await fs.readFile(path.join(bundleDir, req.url.slice(1)))); return; }
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="es"><link rel="stylesheet" href="/fixture.css"><body style="background:#161616;color:#ddd"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
  });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 1000 } }); desktop.on('pageerror', e => errors.push(e.message));
  await desktop.goto(`http://127.0.0.1:${local.address().port}`);
  await desktop.getByRole('heading', { name: 'Conexión móvil local' }).waitFor();
  await desktop.getByRole('button', { name: 'Aprobar dispositivo' }).waitFor();
  assert.equal(await desktop.getByLabel('Dirección móvil').inputValue(), access.url);
  assert.equal(await desktop.getByLabel('Identidad del host / SHA256 del certificado').inputValue(), access.identity.fingerprint);
  assert.equal(await desktop.getByLabel('Sesión de prueba', { exact: true }).isChecked(), false);
  await desktop.getByLabel('Sesión de prueba', { exact: true }).check();
  assert.equal(await desktop.getByLabel('Lectura', { exact: true }).isChecked(), true);
  assert.equal(await desktop.getByLabel('Enviar chat', { exact: true }).isChecked(), false);
  await desktop.screenshot({ path: path.join(evidence, '03-desktop-pending.png'), fullPage: true });
  await desktop.getByRole('button', { name: 'Aprobar dispositivo' }).click();
  await desktop.getByRole('button', { name: 'Guardar permisos' }).waitFor();
  assert.deepEqual((await host.invoke('mobile.status')).devices[0].grants, [{ nodeId: node.id, capabilities: ['read'] }]);
  await desktop.getByLabel('Enviar chat', { exact: true }).check(); await desktop.getByRole('button', { name: 'Guardar permisos' }).click();
  await desktop.getByText('Permisos efectivos:', { exact: false }).filter({ hasText: 'Enviar chat' }).waitFor();
  await desktop.screenshot({ path: path.join(evidence, '04-desktop-permissions-audit.png'), fullPage: true });
  await desktop.getByRole('button', { name: 'Revocar', exact: true }).click(); await desktop.getByText('Ningún dispositivo emparejado.').waitFor();
  assert.equal(effects, 0); assert.deepEqual(errors, []); results.push('Componente desktop real: huellas, aprobación por nodo solo lectura, permisos editables, revocación y actividad');
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, evidence }, null, 2));
} finally {
  await browser?.close(); if (local) await new Promise(resolve => local.close(resolve)); await host?.close(); await fs.rm(root, { recursive: true, force: true });
}
