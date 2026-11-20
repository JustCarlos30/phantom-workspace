import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createHost } from '../host/server.mjs';
import { env, parseExtension } from '../integrations/env.mjs';
import { main as agentCLI } from '../scripts/agent.mjs';

const CONFIG = { services: {
  web: { ports: [{ target: 80, published: '8080' }], 'x-phantom': { lifecycle: 'ephemeral', purpose: 'Preview de componentes UI' } },
  db: { ports: [{ target: 5432 }], 'x-phantom': { lifecycle: 'persistent', purpose: 'Base de datos', card: 'card_1' } },
  api: { profiles: ['dev'], ports: [{ target: 80, published: '9090' }], 'x-phantom': { purpose: 'API' } },
  e2e: { profiles: ['test'] },
  plain: {},
} };

async function until(fn) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('No se observó el estado esperado');
}

// Docker falso: sin daemon real. Registra `up`/`rm` y expone los contenedores a `ps`/`inspect`.
function fakeDocker(root) {
  const calls = [], spawned = [], kills = [], behavior = { mode: 'exit', code: 0, out: 'hecho\n', err: '', closeOnKill: true };
  let containers = [];
  const names = args => args.slice(args.indexOf('--') + 1);
  const container = (service, project) => ({
    Id: createHash('sha256').update(service).digest('hex'),
    Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': service, 'com.docker.compose.project.working_dir': root, 'com.docker.compose.project.config_files': path.join(root, 'compose.yaml') } },
    State: { Status: 'running' },
    NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: CONFIG.services[service]?.ports?.[0]?.published ?? '1' }] } },
  });
  const execFile = async (file, args, options) => {
    assert.equal(file, 'docker'); assert.equal(options.shell, false); calls.push(args);
    let stdout = '';
    if (args[0] === 'context' && args[1] === 'show') stdout = 'fixture';
    else if (args[0] === 'context') stdout = JSON.stringify([{ Endpoints: { docker: { Host: 'unix:///fixture.sock' } } }]);
    else if (args.includes('ps')) stdout = containers.map(c => c.Id).join('\n');
    else if (args.includes('inspect')) stdout = JSON.stringify(containers.filter(c => args.includes(c.Id)));
    else if (args.includes('config')) {
      // Compose real: `config` descarta x-*; solo `--no-interpolate` los conserva.
      if (behavior.noInterpolateFails && args.includes('--no-interpolate')) throw new Error('config falló');
      const keep = args.includes('--no-interpolate');
      stdout = JSON.stringify({ services: Object.fromEntries(Object.entries(CONFIG.services).map(([n, s]) => [n, keep ? s : Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'x-phantom'))])) });
    }
    else if (args.includes('up')) { for (const name of names(args)) if (!containers.some(c => c.Config.Labels['com.docker.compose.service'] === name)) containers.push(container(name, args[args.indexOf('-p') + 1])); }
    else if (args.includes('rm')) containers = containers.filter(c => !names(args).includes(c.Config.Labels['com.docker.compose.service']));
    return { stdout, stderr: '' };
  };
  const spawn = (file, args, options) => {
    assert.equal(file, 'docker'); assert.equal(options.shell, false); spawned.push(args);
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = signal => { kills.push(signal); if (behavior.closeOnKill) setImmediate(() => child.emit('close', null, signal)); };
    setImmediate(() => { if (behavior.mode !== 'exit') return; child.stdout.emit('data', behavior.out); if (behavior.err) child.stderr.emit('data', behavior.err); child.emit('close', behavior.code, null); });
    return child;
  };
  return { execFile, spawn, calls, spawned, kills, behavior, running: () => containers.map(c => c.Config.Labels['com.docker.compose.service']).sort() };
}
const removed = docker => docker.calls.filter(a => a.includes('rm')).flatMap(a => a.slice(a.indexOf('--') + 1));

function directFixture(t, sessions = ['s1', 's2']) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-env-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'compose.yaml'), 'services: {}\n');
  const workspace = { id: 'w1', name: 'Repo', path: root, canonicalPath: root }, docker = fakeDocker(root);
  let persisted = 0;
  const context = { state: { workspaces: [workspace], settings: { dockerContext: 'fixture' } }, sessions: sessions.map(id => ({ id })), getWorkspace: id => { assert.equal(id, 'w1'); return workspace; }, persist: () => { persisted++; }, execFile: docker.execFile, spawn: docker.spawn };
  const owner = (sessionId = 's1') => ({ sessionId, nodeId: `n-${sessionId}` });
  const call = (method, payload = {}) => env(method, { workspaceId: 'w1', ...payload }, context);
  return { root, workspace, docker, context, call, owner, persisted: () => persisted };
}

test('x-phantom: lifecycle, purpose y card con ephemeral por defecto', () => {
  assert.deepEqual(parseExtension(undefined), { lifecycle: 'ephemeral', purpose: '', card: '' });
  assert.deepEqual(parseExtension({ lifecycle: 'persistent', purpose: ' Base ', card: 'c1' }), { lifecycle: 'persistent', purpose: 'Base', card: 'c1' });
  assert.equal(parseExtension({ lifecycle: 'forever' }).lifecycle, 'ephemeral');
  assert.equal(parseExtension([]).lifecycle, 'ephemeral');
  assert.equal(parseExtension({ purpose: 'x'.repeat(500) }).purpose.length, 200);
});

test('list expone servicios, perfiles, URL http, estado y dueño', async t => {
  const f = directFixture(t), list = await f.call('env.list');
  assert.equal(list.compose, true); assert.deepEqual(list.profiles, ['dev', 'test']);
  const by = Object.fromEntries(list.services.map(s => [s.name, s]));
  assert.deepEqual([by.web.lifecycle, by.web.purpose, by.web.status, by.web.owner], ['ephemeral', 'Preview de componentes UI', 'not created', null]);
  assert.deepEqual([by.db.lifecycle, by.db.card], ['persistent', 'card_1']);
  assert.deepEqual([by.plain.lifecycle, by.plain.purpose, by.plain.card], ['ephemeral', '', '']);
  assert.deepEqual(by.api.profiles, ['dev']);
  assert.ok(!f.docker.calls.some(a => a.includes('up') || a.includes('rm')));
  await f.call('env.up', { owner: f.owner(), service: 'web' });
  const after = (await f.call('env.list')).services.find(s => s.name === 'web');
  assert.equal(after.status, 'running'); assert.equal(after.url, 'http://127.0.0.1:8080/');
  assert.equal(after.owner.ownerSessionId, 's1');
});

test('up de servicio y de perfil registra al dueño y devuelve la URL', async t => {
  const f = directFixture(t), up = await f.call('env.up', { owner: f.owner(), service: 'web' });
  const upCall = f.docker.calls.find(a => a.includes('up'));
  assert.deepEqual(upCall.slice(-4), ['up', '-d', '--', 'web']); assert.ok(!upCall.includes('--profile'));
  assert.equal(up.url, 'http://127.0.0.1:8080/');
  assert.deepEqual(f.workspace.envOwners.map(({ startedAt, ...e }) => e), [{ service: 'web', ownerSessionId: 's1', ownerNodeId: 'n-s1', lifecycle: 'ephemeral' }]);
  assert.ok(f.workspace.envOwners[0].startedAt); assert.ok(f.persisted() > 0);
  const profile = await f.call('env.up', { owner: f.owner('s2'), profile: 'dev' });
  const call = f.docker.calls.find(a => a.includes('--profile') && a.includes('up'));
  assert.deepEqual(call.slice(call.indexOf('--profile')), ['--profile', 'dev', 'up', '-d', '--', 'api']);
  assert.equal(profile.url, 'http://127.0.0.1:9090/');
  assert.deepEqual(f.workspace.envOwners.find(e => e.service === 'api').profile, 'dev');
  await f.call('env.up', { owner: f.owner(), service: 'db' });
  assert.equal(f.workspace.envOwners.find(e => e.service === 'db').lifecycle, 'persistent');
});

test('up rechaza nombres inválidos, desconocidos y servicios ephemeral con dueño vivo', async t => {
  const f = directFixture(t);
  await assert.rejects(f.call('env.up', { owner: f.owner(), service: '../web' }), /inválido/);
  await assert.rejects(f.call('env.up', { owner: f.owner(), service: 'nope' }), /desconocido/);
  await assert.rejects(f.call('env.up', { owner: f.owner(), profile: 'nope' }), /Perfil/);
  await assert.rejects(f.call('env.up', { owner: f.owner() }), /servicio o un perfil/);
  await assert.rejects(f.call('env.up', { service: 'web' }), /dueño/);
  assert.ok(!f.docker.calls.some(a => a.includes('up')));
  await f.call('env.up', { owner: f.owner('s1'), service: 'web' });
  await assert.rejects(f.call('env.up', { owner: f.owner('s2'), service: 'web' }), /otra terminal/);
  f.context.sessions = [{ id: 's2' }];
  await f.call('env.up', { owner: f.owner('s2'), service: 'web' });
  assert.equal(f.workspace.envOwners.find(e => e.service === 'web').ownerSessionId, 's2');
  f.context.sessions = [{ id: 's1' }, { id: 's2' }];
  await f.call('env.up', { owner: f.owner('s1'), service: 'db' });
  await f.call('env.up', { owner: f.owner('s2'), service: 'db' });
  assert.equal(f.workspace.envOwners.find(e => e.service === 'db').ownerSessionId, 's2');
});

test('run ejecuta el job con spawn, devuelve exitCode y una cola acotada', async t => {
  const f = directFixture(t);
  assert.deepEqual(await f.call('env.run', { owner: f.owner(), job: 'e2e' }), { job: 'e2e', ok: true, exitCode: 0, signal: null, timedOut: false, truncated: false, logs: 'hecho\n' });
  assert.deepEqual(f.docker.spawned.at(-1).slice(-5), ['run', '--rm', '-T', '--', 'e2e']);
  Object.assign(f.docker.behavior, { code: 3, out: 'a'.repeat(40000), err: 'fallo\n' });
  const failed = await f.call('env.run', { owner: f.owner(), job: 'e2e', timeout: 30 });
  assert.equal(failed.exitCode, 3); assert.equal(failed.ok, false); assert.equal(failed.truncated, true);
  assert.equal(failed.logs.length, 16 * 1024); assert.ok(failed.logs.endsWith('fallo\n'));
  assert.equal(f.workspace.envOwners, undefined);
  for (const [payload, error] of [[{ job: 'nope' }, /desconocido/], [{ job: 'e2e', timeout: 0 }, /entre 1 y 3600/], [{ job: 'e2e', timeout: 3601 }, /entre 1 y 3600/], [{ job: 'e2e', timeout: 1.5 }, /entre 1 y 3600/], [{ job: 'a b' }, /inválido/]])
    await assert.rejects(f.call('env.run', { owner: f.owner(), ...payload }), error);
});

test('run supera el tiempo límite, termina el proceso y lo informa', async t => {
  const f = directFixture(t);
  f.docker.behavior.mode = 'hang';
  const result = await f.call('env.run', { owner: f.owner(), job: 'e2e', timeout: 1 });
  assert.equal(result.timedOut, true); assert.equal(result.ok, false); assert.deepEqual(f.docker.kills, ['SIGTERM']);
});

test('down: el agente baja lo suyo, no lo persistente ni lo ajeno; la UI baja cualquiera', async t => {
  const f = directFixture(t);
  await f.call('env.up', { owner: f.owner('s1'), service: 'web' });
  await f.call('env.up', { owner: f.owner('s1'), profile: 'dev' });
  await f.call('env.up', { owner: f.owner('s1'), service: 'db' });
  await assert.rejects(f.call('env.down', { owner: f.owner('s2'), service: 'web' }), /otra terminal/);
  await assert.rejects(f.call('env.down', { owner: f.owner('s1'), service: 'db' }), /persistente/);
  await assert.rejects(f.call('env.down', { owner: f.owner('s1'), service: 'plain' }), /no pertenece/);
  assert.deepEqual(await f.call('env.down', { owner: f.owner('s1'), service: 'web' }), { down: ['web'] });
  const rm = f.docker.calls.findLast(a => a.includes('rm'));
  assert.deepEqual(rm.slice(-5), ['*', 'rm', '-sf', '--', 'web']);
  assert.deepEqual(await f.call('env.down', { owner: f.owner('s1') }), { down: ['api'] });
  assert.deepEqual(f.workspace.envOwners.map(e => e.service), ['db']);
  assert.deepEqual(await f.call('env.down', { owner: f.owner('s1') }), { down: [] });
  await assert.rejects(f.call('env.down', { actor: 'ui' }), /servicio/);
  assert.deepEqual(await f.call('env.down', { actor: 'ui', service: 'db' }), { down: ['db'] });
  assert.deepEqual(f.workspace.envOwners, []); assert.deepEqual(f.docker.running(), []);
});

test('x-phantom llega por config --no-interpolate: persistent se detecta y release no lo elimina', async t => {
  const f = directFixture(t);
  const by = Object.fromEntries((await f.call('env.list', {})).services.map(s => [s.name, s]));
  assert.equal(by.db.lifecycle, 'persistent');
  assert.ok(f.docker.calls.some(a => a.includes('config') && a.includes('--no-interpolate')));
  await f.call('env.up', { owner: f.owner('s1'), service: 'db' });
  assert.deepEqual(await f.call('env.release', { sessionId: 's1', nodeId: null }), { removed: [], released: ['db'], errors: [] });
  assert.deepEqual(f.docker.running(), ['db']);
});

test('release: ephemeral se elimina, persistent solo se desvincula y sin registro no toca Docker', async t => {
  const f = directFixture(t);
  assert.deepEqual(await f.call('env.release', { sessionId: 's1', nodeId: 'n-s1' }), { removed: [], released: [], errors: [] });
  assert.equal(f.docker.calls.length, 0);
  await f.call('env.up', { owner: f.owner('s1'), service: 'web' });
  await f.call('env.up', { owner: f.owner('s1'), service: 'db' });
  await f.call('env.up', { owner: f.owner('s2'), profile: 'dev' });
  assert.deepEqual(await f.call('env.release', { sessionId: 's1', nodeId: null }), { removed: ['web'], released: ['db'], errors: [] });
  assert.deepEqual(f.docker.running(), ['api', 'db']);
  const db = f.workspace.envOwners.find(e => e.service === 'db');
  assert.deepEqual([db.ownerSessionId, db.ownerNodeId, db.lifecycle], [null, null, 'persistent']);
  assert.deepEqual(f.workspace.envOwners.map(e => e.service).sort(), ['api', 'db']);
  assert.deepEqual((await f.call('env.release', { sessionId: null, nodeId: 'n-s2' })).removed, ['api']);
  assert.deepEqual(f.docker.running(), ['db']);
});

async function hostFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-envhost-'));
  let host;
  t.after(async () => { await host?.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const directory = path.join(root, 'project'); fs.mkdirSync(directory);
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-b', 'main'); fs.writeFileSync(path.join(directory, 'README.md'), 'Fixture\n'); fs.writeFileSync(path.join(directory, 'compose.yaml'), 'services: {}\n'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Fixture');
  const docker = fakeDocker(fs.realpathSync(directory)), methods = [];
  host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: async (method, payload, context) => {
    if (!method.startsWith('env.')) return { handled: false };
    methods.push(method);
    return { handled: true, result: await env(method, payload, { ...context, execFile: docker.execFile, spawn: docker.spawn }) };
  } });
  await host.invoke('settings.update', { patch: { shell: '/bin/sh', dockerContext: 'fixture' } });
  const w = await host.invoke('workspace.open', { path: directory });
  const first = await host.invoke('terminal.create', { workspaceId: w.id, shell: '/bin/sh' });
  const second = await host.invoke('terminal.create', { workspaceId: w.id, shell: '/bin/sh' });
  const nodes = () => host.store.getWorkspace(w.id).nodes, browsers = () => nodes().filter(n => n.type === 'browser');
  const call = (action, payload = {}, session = first.session) => host.invoke(`terminal.agent.env.${action}`, { sessionId: session.id, ...payload });
  return { host, w, first, second, docker, methods, nodes, browsers, call, owners: () => host.store.getWorkspace(w.id).envOwners ?? [], env: { PHANTOM_TERMINAL_SESSION_ID: first.session.id, PHANTOM_WORKSPACE_SOCKET: host.socketPath } };
}

test('host: up crea y reutiliza el browser de la terminal, down lo cierra', async t => {
  const f = await hostFixture(t), up = await f.call('up', { service: 'web' });
  assert.equal(up.url, 'http://127.0.0.1:8080/');
  assert.equal(f.browsers().length, 1);
  const browser = f.browsers()[0];
  assert.deepEqual(up.browsers, [{ service: 'web', nodeId: browser.id }]);
  assert.equal(browser.data.url, 'http://127.0.0.1:8080/'); assert.equal(browser.data.agentTerminal, f.first.session.id); assert.equal(browser.data.envService, 'web');
  assert.deepEqual(f.owners().map(e => [e.service, e.ownerSessionId, e.ownerNodeId, e.lifecycle]), [['web', f.first.session.id, f.first.node.id, 'ephemeral']]);
  await f.call('up', { service: 'web' }); assert.equal(f.browsers().length, 1);
  const listed = await f.call('list'); assert.equal(listed.services.find(s => s.name === 'web').mine, true);
  assert.deepEqual(await f.call('down', { service: 'web' }), { down: ['web'] });
  assert.equal(f.browsers().length, 0); assert.deepEqual(f.owners(), []);
});

test('host: al salir la terminal se bajan los ephemeral y el persistent solo se desvincula', async t => {
  const f = await hostFixture(t);
  await f.call('up', { service: 'web' }); await f.call('up', { service: 'db' }); await f.call('up', { service: 'plain' });
  await f.call('up', { service: 'web' }, f.second.session).catch(() => {});
  await f.host.invoke('terminal.stop', { sessionId: f.first.session.id });
  await until(() => !f.docker.running().includes('web'));
  await until(() => f.browsers().length === 0);
  assert.deepEqual(removed(f.docker).sort(), ['plain', 'web']);
  assert.deepEqual(f.docker.running(), ['db']);
  assert.deepEqual(f.owners().map(e => [e.service, e.ownerSessionId, e.ownerNodeId, e.lifecycle]), [['db', null, null, 'persistent']]);
  await f.host.invoke('state.get'); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.host.store.dir, 'state.json'), 'utf8')).workspaces[0].envOwners.map(e => e.service), ['db']);
});

test('host: cerrar el panel dueño baja sus servicios ephemeral', async t => {
  const f = await hostFixture(t);
  await f.call('up', { service: 'web' }, f.second.session);
  await f.host.invoke('terminal.close', { workspaceId: f.w.id, nodeId: f.second.node.id });
  assert.deepEqual(f.docker.running(), []); assert.deepEqual(f.owners(), []); assert.equal(f.browsers().length, 0);
});

test('host: rechaza sesiones ajenas, no vivas, claves desconocidas y métodos internos', async t => {
  const f = await hostFixture(t);
  await assert.rejects(f.host.invoke('terminal.agent.env.up', { sessionId: 'inexistente', service: 'web' }), /session not found/);
  await f.call('up', { service: 'web' });
  await assert.rejects(f.call('down', { service: 'web' }, f.second.session), /otra terminal/);
  await assert.rejects(f.call('up', { service: 'web' }, f.second.session), /otra terminal/);
  for (const [action, payload] of [['up', { service: 'web', extra: 1 }], ['up', {}], ['up', { service: 'web', profile: 'dev' }], ['up', { service: '../x' }], ['run', {}], ['run', { job: 'e2e', timeout: 0 }], ['down', { service: 'a b' }], ['list', { service: 'web' }]])
    await assert.rejects(f.call(action, payload), /Clave de entorno|Indica|inválid|entre 1/);
  for (const method of ['env.up', 'env.run', 'env.release']) await assert.rejects(f.host.invoke(method, { workspaceId: f.w.id, service: 'web' }), /Unknown method/);
  await assert.rejects(f.host.invoke('env.down', { workspaceId: f.w.id, service: 'web', actor: 'agent' }), /Clave de entorno/);
  await f.host.invoke('terminal.stop', { sessionId: f.second.session.id });
  await until(() => f.host.terminals.get(f.second.session.id).status !== 'running');
  await assert.rejects(f.call('up', { service: 'plain' }, f.second.session), /sesión viva actual/);
  assert.ok((await f.call('list', {}, f.second.session)).services.length);
});

test('host: límite de 60 operaciones de entorno por sesión y hora', async t => {
  const f = await hostFixture(t);
  for (let i = 0; i < 60; i++) await f.call('down');
  await assert.rejects(f.call('down'), /máximo 60/);
  assert.ok((await f.call('list')).compose);
  assert.deepEqual(await f.call('down', {}, f.second.session), { down: [] });
});

test('host: env.list y env.down de la UI, también sobre persistent', async t => {
  const f = await hostFixture(t);
  await f.call('up', { service: 'db' });
  const list = await f.host.invoke('env.list', { workspaceId: f.w.id });
  assert.equal(list.services.find(s => s.name === 'db').owner.ownerSessionId, f.first.session.id);
  await assert.rejects(f.call('down', { service: 'db' }), /persistente/);
  assert.deepEqual(await f.host.invoke('env.down', { workspaceId: f.w.id, service: 'db' }), { down: ['db'] });
  assert.deepEqual(f.owners(), []); assert.equal(f.browsers().length, 0);
  await assert.rejects(f.host.invoke('env.list', { workspaceId: 'otro' }), /Workspace not found/);
});

test('CLI env list, up, run y down llegan al host con identidad de terminal', async t => {
  const f = await hostFixture(t);
  assert.equal((await agentCLI(['env', 'list'], f.env)).services.length, 5);
  assert.equal((await agentCLI(['env', 'up', 'web'], f.env)).url, 'http://127.0.0.1:8080/');
  assert.equal((await agentCLI(['env', 'up', '--profile', 'dev'], f.env)).profile, 'dev');
  const ran = await agentCLI(['env', 'run', 'e2e', '--timeout', '30'], f.env);
  assert.deepEqual([ran.job, ran.exitCode, ran.logs], ['e2e', 0, 'hecho\n']);
  assert.equal((await agentCLI(['env', 'run', 'e2e'], f.env)).ok, true);
  assert.deepEqual(await agentCLI(['env', 'down', 'web'], f.env), { down: ['web'] });
  assert.deepEqual(await agentCLI(['env', 'down'], f.env), { down: ['api'] });
});

test('CLI env: argumentos inválidos dan USAGE y exigen identidad de terminal', async () => {
  for (const args of [['env'], ['env', 'nope'], ['env', 'list', 'x'], ['env', 'up'], ['env', 'up', 'a', 'b'], ['env', 'up', '--profile'], ['env', 'up', '--profile', 'a b'], ['env', 'up', '-x'], ['env', 'run'], ['env', 'run', 'j', '--timeout'], ['env', 'run', 'j', '--timeout', '0'], ['env', 'run', 'j', '--timeout', '3601'], ['env', 'run', 'j', '--wait', '5'], ['env', 'down', 'a', 'b'], ['env', 'down', '../x']])
    await assert.rejects(agentCLI(args, {}), /Uso: agent.mjs.*\nEncargos:.*\nProcesos:.*\nEntorno.*env list \| env up SERVICIO\|--profile P \| env run JOB \[--timeout S\] \| env down \[SERVICIO\]/);
  for (const args of [['env', 'list'], ['env', 'up', 'web'], ['env', 'run', 'e2e'], ['env', 'down']]) await assert.rejects(agentCLI(args, {}), /Falta la identidad de terminal/);
});
