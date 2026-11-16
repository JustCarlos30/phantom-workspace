import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { AndroidGateway } from '../host/android-gateway.mjs';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const MAIN = `phantom:${WORKSPACE}`;
const address = '192.168.50.10';
const cliSource = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2), command = args[0];
fs.appendFileSync(path.join(root, 'argv.jsonl'), JSON.stringify(args) + '\\n');
const settings = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'), 'utf8'));
const result = { url: 'https://192.168.1.10:9443', hostId: 'fake-host', fingerprint: 'SHA256:fake', workspaceId: '${WORKSPACE}' };
if (command === 'start') {
  if (settings.mode === 'die') { process.stderr.write('Fallo TLS sintético\\n', () => process.exit(7)); }
  else {
    process.stdout.write(JSON.stringify(result).slice(0, 12));
    setTimeout(() => process.stdout.write(JSON.stringify(result).slice(12) + '\\n'), 10);
    setInterval(() => {}, 1000);
  }
} else if (command === 'status') console.log(JSON.stringify({ ...result, enabled: true, devices: settings.devices, pairingExpiresAt: 123456 }));
else if (command === 'pairing') console.log(JSON.stringify({ code: 'codigo-sintetico', expiresAt: 123456 }));
else if (command === 'export-bootstrap') console.log(JSON.stringify({ ...result, version: 1, certificate: 'PUBLICO', address: '192.168.1.10', expiresAt: 999999 }));
else console.log(JSON.stringify({ ok: true }));
`;

function fixture(t, overrides = {}) {
  t.mock.method(os, 'networkInterfaces', () => ({ prueba: [{ family: 'IPv4', internal: false, address }] }));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-android-test-'));
  const repoPath = path.join(root, 'phantom-mobile'), hostDataDir = path.join(root, 'desktop'), gatewayDataDir = path.join(root, 'gateway');
  fs.mkdirSync(path.join(repoPath, 'host'), { recursive: true });
  fs.mkdirSync(hostDataDir);
  fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({ name: 'phantom-mobile', type: 'module' }));
  fs.writeFileSync(path.join(repoPath, 'host/cli.mjs'), cliSource);
  const settings = { mode: 'normal', devices: [{ id: DEVICE, name: 'Prueba', state: 'pending', keyFingerprint: 'FAKE', grants: [] }] };
  const save = patch => { Object.assign(settings, patch); fs.writeFileSync(path.join(repoPath, 'fixture.json'), JSON.stringify(settings)); };
  save({});
  const calls = [], spawns = [];
  const execute = (bin, args, options, callback) => {
    calls.push({ bin, args, options });
    // El CLI falso funciona con el Node de los checks; no depende de Node 26 instalado.
    if (args[0] === '--version') { queueMicrotask(() => callback(null, 'v26.0.0\n', '')); return; }
    return execFile(bin, args, options, callback);
  };
  const gateway = new AndroidGateway({ hostDataDir, gatewayDataDir, repoPath, nodeBin: process.execPath,
    execFile: execute, spawn: (bin, args, options) => { spawns.push({ bin, args, options }); return spawn(bin, args, options); }, ...overrides });
  t.after(async () => { await gateway.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const argv = () => fs.existsSync(path.join(repoPath, 'argv.jsonl')) ? fs.readFileSync(path.join(repoPath, 'argv.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { gateway, root, repoPath, hostDataDir, gatewayDataDir, save, calls, spawns, argv };
}

// La interfaz es sintética: ningún test abre sockets ni depende de la red de la máquina.
const lanTest = (name, fn) => test(name, fn);
const start = gateway => gateway.start({ workspaceId: WORKSPACE, address, port: 0 });

test('link arranca con la primera interfaz y devuelve bootstrap, pairing y status', async t => {
  const f = fixture(t);
  const result = await f.gateway.link({ workspaceId: WORKSPACE });
  assert.equal(result.bootstrap.certificate, 'PUBLICO');
  assert.deepEqual(result.pairing, { code: 'codigo-sintetico', expiresAt: 123456 });
  assert.equal(result.status.enabled, true);
  assert.equal(f.argv()[0][2], address);
  assert.equal(f.spawns.length, 1);
  await f.gateway.link({ workspaceId: WORKSPACE });
  assert.equal(f.spawns.length, 1);
  assert.equal(f.argv().filter(args => args[0] === 'pairing').length, 2);
});

test('link rechaza otro proyecto vivo y UUID inválido sin reiniciar', async t => {
  const f = fixture(t);
  await assert.rejects(f.gateway.link({ workspaceId: 'inválido' }), /UUID/);
  assert.equal(f.calls.length, 0);
  await f.gateway.link({ workspaceId: WORKSPACE });
  const calls = f.calls.length;
  await assert.rejects(f.gateway.link({ workspaceId: SESSION }), /otro proyecto/);
  await assert.rejects(f.gateway.link({ workspaceId: '--workspace' }), /UUID/);
  assert.equal(f.calls.length, calls);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.gateway.alive(), true);
});

test('link explica la falta de red LAN antes de arrancar', async t => {
  const f = fixture(t);
  t.mock.method(os, 'networkInterfaces', () => ({}));
  await assert.rejects(f.gateway.link({ workspaceId: WORKSPACE }), /No se detecta una red LAN/);
  assert.equal(f.spawns.length, 0);
});

test('status explica repositorios ausentes y package.json con otro nombre', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repoPath, 'package.json'), '{"name":"otro"}');
  let status = await f.gateway.status();
  assert.equal(status.repoValid, false); assert.match(status.repoError, /phantom-mobile/);
  fs.unlinkSync(path.join(f.repoPath, 'host/cli.mjs'));
  status = await f.gateway.status();
  assert.equal(status.enabled, false); assert.match(status.repoError, /cli\.mjs/);
  await assert.rejects(start(f.gateway), /Repositorio phantom-mobile no válido/);
  assert.equal(f.spawns.length, 0);
});

test('configure persiste la ruta con modo 600 y prima sobre el valor por defecto', async t => {
  const f = fixture(t);
  await assert.rejects(f.gateway.configure({ repoPath: '--ruta' }), /Ruta/);
  await f.gateway.configure({ repoPath: f.repoPath });
  const configFile = path.join(f.hostDataDir, 'android-gateway.json');
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')), { repoPath: f.repoPath });
  const other = new AndroidGateway({ hostDataDir: f.hostDataDir, gatewayDataDir: f.gatewayDataDir, repoPath: '/no/existe', configFile,
    execFile: (bin, args, options, callback) => callback(null, 'v26.1.0', '') });
  const status = await other.status();
  assert.equal(status.repoPath, f.repoPath); assert.equal(status.repoValid, true);
});

test('status rechaza configuración corrupta y configure permite repararla', async t => {
  const f = fixture(t);
  for (const value of ['{', 'null', '[]', '{}', '{"repoPath":"--ruta"}']) {
    fs.writeFileSync(f.gateway.configFile, value);
    const status = await f.gateway.status();
    assert.equal(status.repoValid, false);
    assert.match(status.repoError, /configuración Android/);
    await assert.rejects(start(f.gateway), /configuración Android/);
  }
  await f.gateway.configure({ repoPath: f.repoPath });
  assert.equal((await f.gateway.status()).repoValid, true);
  assert.equal(f.spawns.length, 0);
});

test('status vuelve a detectar Node cuando se actualiza el binario disponible', async t => {
  let version = 'v24.9.0';
  const f = fixture(t, { execFile: (bin, args, options, callback) => callback(null, version, '') });
  assert.equal((await f.gateway.status()).node.compatible, false);
  version = 'v26.1.0';
  const status = await f.gateway.status();
  assert.equal(status.node.compatible, true);
  assert.equal(status.node.version, version);
  assert.equal(status.node.error, null);
});

lanTest('start parsea JSON fragmentado y pasa exactamente argv sin shell y datos separados', async t => {
  const f = fixture(t);
  const ready = await start(f.gateway);
  assert.equal(ready.enabled, true); assert.equal(ready.hostId, 'fake-host');
  assert.deepEqual(f.argv()[0], ['start', '--address', address, '--workspace', WORKSPACE,
    '--host-data', f.hostDataDir, '--data', f.gatewayDataDir, '--port', '0']);
  assert.deepEqual(f.spawns[0], { bin: process.execPath, args: [path.join(f.repoPath, 'host/cli.mjs'), ...f.argv()[0]], options: { shell: false, stdio: ['ignore', 'pipe', 'pipe'] } });
  const status = await f.gateway.status();
  assert.equal(status.processAlive, true); assert.equal(status.enabled, true); assert.equal(status.devices[0].id, DEVICE);
  assert.equal(status.node.compatible, true); assert.ok(status.interfaces.some(item => item.address === address));
  assert.ok(f.calls.every(call => call.options.timeout === 10000 && call.options.shell === false));
  await assert.rejects(start(f.gateway), /ya está activo/);
  await assert.rejects(f.gateway.configure({ repoPath: f.repoPath }), /Detén/);
});

lanTest('rechaza Node anterior a 26 antes de crear el hijo', async t => {
  const f = fixture(t, { execFile: (bin, args, options, callback) => callback(null, 'v24.9.0\n', '') });
  await assert.rejects(start(f.gateway), /Node >= 26.*v24\.9\.0/);
  assert.equal(f.spawns.length, 0);
  assert.match((await f.gateway.status()).node.error, /Node >= 26/);
});

lanTest('muerte durante el arranque conserva stderr como motivo', async t => {
  const f = fixture(t); f.save({ mode: 'die' });
  await assert.rejects(start(f.gateway), /Fallo TLS sintético/);
  const status = await f.gateway.status();
  assert.equal(status.enabled, false); assert.equal(status.processAlive, false);
  assert.match(status.lastError, /Fallo TLS sintético/);
});

lanTest('un error de spawn se informa y permite volver a arrancar', async t => {
  const f = fixture(t, { spawn: () => spawn(path.join(os.tmpdir(), 'phantom-node-inexistente', 'node'), []) });
  await assert.rejects(start(f.gateway), /ENOENT/);
  const status = await f.gateway.status();
  assert.equal(status.processAlive, false);
  assert.match(status.lastError, /ENOENT/);
  f.gateway.spawn = spawn;
  assert.equal((await start(f.gateway)).enabled, true);
});

test('stop cancela un arranque pendiente de detectar Node sin crear el hijo', async t => {
  let detected;
  const f = fixture(t, { execFile: (bin, args, options, callback) => { detected = callback; } });
  const pending = start(f.gateway);
  const rejected = assert.rejects(pending, /Arranque cancelado/);
  const stopping = f.gateway.stop();
  detected(null, 'v26.0.0', '');
  await rejected;
  assert.deepEqual(await stopping, { enabled: false });
  assert.equal(f.spawns.length, 0);
  assert.equal(f.gateway.starting, null);
});

lanTest('timeout de arranque a los 20 s informa stderr acotado y termina el hijo', async t => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.signalCode = null;
  const signals = [];
  child.kill = signal => { signals.push(signal); child.signalCode = signal; queueMicrotask(() => child.emit('close', null, signal)); return true; };
  const f = fixture(t, { spawn: () => child });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = start(f.gateway);
  const rejected = assert.rejects(pending, error => {
    assert.match(error.message, /20 segundos/); assert.match(error.message, /MOTIVO_FINAL/);
    assert.ok(Buffer.byteLength(error.message) < 4200); assert.ok(!error.message.includes('INICIO_DESCARTADO'));
    return true;
  });
  await new Promise(setImmediate);
  child.stderr.write('INICIO_DESCARTADO' + 'x'.repeat(6000) + 'MOTIVO_FINAL');
  t.mock.timers.tick(20000);
  await rejected;
  assert.deepEqual(signals, ['SIGTERM']);
});

lanTest('approve para pending construye permisos y reconocimiento exactos', async t => {
  const f = fixture(t); await start(f.gateway);
  await f.gateway.approve({ id: DEVICE, nodes: [MAIN], allow: [`${MAIN}=chat.send`, `${MAIN}=chat.stop`], workspaceRead: true, acknowledgeAgentAuthority: true });
  assert.deepEqual(f.argv().at(-1), ['approve', '--id', DEVICE, '--node', MAIN, '--allow', `${MAIN}=chat.send`, '--allow', `${MAIN}=chat.stop`,
    '--workspace-read', '--acknowledge-agent-authority', '--data', f.gatewayDataDir]);
});

lanTest('permissions para approved reemplaza grants, incluyendo permisos del proyecto', async t => {
  const f = fixture(t); f.save({ devices: [{ id: DEVICE, state: 'approved', grants: [] }] }); await start(f.gateway);
  await f.gateway.approve({ id: DEVICE, nodes: [SESSION], allow: [`${SESSION}=chat.send`], workspaceRead: true, workspaceAllow: ['cards.list'] });
  assert.deepEqual(f.argv().at(-1), ['permissions', '--id', DEVICE, '--node', SESSION, '--allow', `${SESSION}=chat.send`,
    '--workspace-read', '--workspace-allow', 'cards.list', '--data', f.gatewayDataDir]);
  await f.gateway.approve({ id: DEVICE });
  assert.deepEqual(f.argv().at(-1), ['permissions', '--id', DEVICE, '--data', f.gatewayDataDir]);
});

lanTest('revoke usa el UUID exacto y pairing/bootstrap usan solo datos del gateway', async t => {
  const f = fixture(t); await start(f.gateway);
  assert.equal((await f.gateway.pairing()).code, 'codigo-sintetico');
  assert.deepEqual(f.argv().at(-1), ['pairing', '--data', f.gatewayDataDir]);
  assert.equal((await f.gateway.bootstrap()).certificate, 'PUBLICO');
  assert.deepEqual(f.argv().at(-1), ['export-bootstrap', '--data', f.gatewayDataDir]);
  await f.gateway.revoke({ id: DEVICE });
  assert.deepEqual(f.argv().at(-1), ['revoke', '--id', DEVICE, '--data', f.gatewayDataDir]);
});

test('valida UUID, IPv4 privada y puertos antes de invocar procesos', async t => {
  const f = fixture(t);
  for (const patch of [{ workspaceId: '--workspace' }, { workspaceId: 'no-uuid' }, { address: '8.8.8.8' }, { address: '127.0.0.1' }, { address: '--address' }, { address: '192.168.999.1' }, { port: 1023 }, { port: 65536 }, { port: -1 }, { port: '1234' }, { port: 1024.5 }]) {
    await assert.rejects(f.gateway.start({ workspaceId: WORKSPACE, address: address || '192.168.1.1', port: 0, ...patch }));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.spawns.length, 0);
});

test('valida permisos sin invocar CLI: flags, allow sin nodo y autoridad ausente', async t => {
  const f = fixture(t);
  for (const patch of [{ id: '--id' }, { nodes: ['--node'] }, { allow: ['--allow'] }, { nodes: [SESSION], allow: [`${MAIN}=chat.send`] },
    { nodes: [SESSION], allow: [`${SESSION}=--metodo`] }, { nodes: [SESSION], allow: [`${SESSION}=chat.send=otro`] },
    { nodes: [MAIN] }, { workspaceAllow: ['cards.list'] }, { workspaceRead: 'true' }, { workspaceRead: true, workspaceAllow: ['--metodo'] },
    { acknowledgeAgentAuthority: 'true' }, { nodes: 'no-array' }]) {
    await assert.rejects(f.gateway.approve({ id: DEVICE, ...patch }));
  }
  await assert.rejects(f.gateway.revoke({ id: '--id' }), /UUID/);
  assert.equal(f.calls.length, 0);
});

test('los orquestadores también exigen reconocer la autoridad antes de construir argv', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.hostDataDir, 'state.json'), JSON.stringify({ workspaces: [{ id: WORKSPACE, nodes: [{ id: SESSION, data: { role: 'orchestrator' } }] }] }));
  await assert.rejects(f.gateway.approve({ id: DEVICE, nodes: [SESSION] }), /autoridad.*orquestador/);
  assert.equal(f.calls.length, 0);
});

lanTest('stop es idempotente y usa SIGTERM si el subcomando no cierra el proceso', async t => {
  const f = fixture(t);
  await f.gateway.stop(); assert.equal(f.calls.length, 0);
  await start(f.gateway);
  const child = f.gateway.child;
  const results = await Promise.all([f.gateway.stop(), f.gateway.stop()]);
  assert.ok(results.every(result => result.enabled === false));
  assert.equal(child.signalCode, 'SIGTERM');
  assert.equal(f.argv().filter(args => args[0] === 'stop').length, 1);
  await f.gateway.stop();
  assert.equal(f.argv().filter(args => args[0] === 'stop').length, 1);
  assert.equal((await f.gateway.status()).lastError, null);
});

lanTest('el estado informa la muerte inesperada tras arrancar', async t => {
  const f = fixture(t); await start(f.gateway);
  const closed = once(f.gateway.child, 'close');
  f.gateway.child.kill('SIGKILL'); await closed;
  const status = await f.gateway.status();
  assert.equal(status.enabled, false); assert.deepEqual(status.devices, []);
  assert.match(status.lastError, /gateway terminó.*SIGKILL/);
});

lanTest('no permite datos del gateway dentro de los del desktop', async t => {
  const f = fixture(t);
  f.gateway.gatewayDataDir = path.join(f.hostDataDir, 'android');
  await assert.rejects(start(f.gateway), /separados/);
  assert.equal(f.spawns.length, 0);
});

lanTest('el error de un subcomando incluye stderr y utiliza timeout de 10 s', async t => {
  const f = fixture(t); await start(f.gateway);
  const execute = f.gateway.execFile;
  f.gateway.execFile = (bin, args, options, callback) => {
    if (args[1] !== 'pairing') return execute(bin, args, options, callback);
    assert.equal(options.timeout, 10000); assert.equal(options.shell, false); assert.equal(options.killSignal, 'SIGKILL');
    callback(Object.assign(new Error('Tiempo agotado'), { killed: true }), '', 'Error: vinculación sintética fallida');
  };
  await assert.rejects(f.gateway.pairing(), /vinculación sintética fallida/);
  assert.match((await f.gateway.status()).lastError, /vinculación sintética fallida/);
});
