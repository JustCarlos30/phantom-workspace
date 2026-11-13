import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareWorktree, SETUP_MARKER, SETUP_TIMEOUT_MS } from '../host/worktree-setup.mjs';
import { requestTimeout } from '../desktop/host-client.mjs';

const execute = promisify(execFile);
const write = (cwd, name, value) => fs.writeFileSync(path.join(cwd, name), typeof value === 'string' ? value : JSON.stringify(value));
const readMarker = cwd => JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', SETUP_MARKER), 'utf8'));
const count = cwd => Number(fs.readFileSync(path.join(cwd, 'install-count'), 'utf8'));
async function until(fn) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('Fixture did not reach expected state');
}
async function fixture(t, { electron = false } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom npm worktree-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const env = { npm_config_offline: 'true', npm_config_registry: 'http://127.0.0.1:1', npm_config_ignore_scripts: 'false', npm_config_cache: path.join(cwd, 'cache') };
  fs.mkdirSync(path.join(cwd, 'local-tool'));
  write(cwd, 'local-tool/package.json', { name: 'local-tool', version: '1.0.0', bin: { 'fixture-tool': 'cli.cjs' } });
  write(cwd, 'local-tool/cli.cjs', '#!/usr/bin/env node\nconsole.log("LOCAL_OFFLINE_TOOL");\n');
  fs.chmodSync(path.join(cwd, 'local-tool/cli.cjs'), 0o755);
  const dependencies = { 'local-tool': 'file:./local-tool' };
  if (electron) {
    // Mirrors electron@45+: no postinstall, the binary is fetched by install.js.
    fs.mkdirSync(path.join(cwd, 'local-electron'));
    write(cwd, 'local-electron/package.json', { name: 'electron', version: '45.0.0', bin: { 'install-electron': 'install.js' } });
    write(cwd, 'local-electron/install.js', `const fs=require('node:fs'),path=require('node:path');
const count=path.join(__dirname,'..','electron-installs');
fs.writeFileSync(count,String(Number(fs.existsSync(count)?fs.readFileSync(count,'utf8'):0)+1));
fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'dist','electron'),'');
fs.writeFileSync(path.join(__dirname,'path.txt'),'electron');
`);
    dependencies.electron = 'file:./local-electron';
  }
  write(cwd, 'package.json', { name: 'offline-fixture', version: '1.0.0', private: true, dependencies, scripts: { install: 'node install.cjs' } });
  write(cwd, 'install.cjs', `const fs=require('node:fs');
fs.writeFileSync('install-count',String(Number(fs.existsSync('install-count')?fs.readFileSync('install-count','utf8'):0)+1));
if(fs.existsSync('loud')) console.error('x'.repeat(100000));
if(fs.existsSync('fail')) {console.error('FIXTURE_INSTALL_FAILED');process.exit(7);}
if(fs.existsSync('pause')) {
  fs.writeFileSync('install-waiting','yes');
  const timer=setInterval(()=>{if(fs.existsSync('release')) clearInterval(timer);},25);
}
if(fs.existsSync('slow')) {
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
  fs.writeFileSync('descendant-pid',String(child.pid));
  setInterval(()=>{},1000);
}
`);
  // Only local file dependencies: offline mode and an unreachable registry prove
  // the real npm lock generation/ci path cannot rely on a network service.
  await execute('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, env: { ...process.env, ...env }, timeout: 15000 });
  return { cwd, options: { env } };
}

test('real offline npm ci installs local tools independently and is idempotent', async t => {
  const { cwd, options } = await fixture(t);
  const manifest = fs.readFileSync(path.join(cwd, 'package.json')), lock = fs.readFileSync(path.join(cwd, 'package-lock.json'));
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  assert.equal(fs.lstatSync(path.join(cwd, 'node_modules')).isSymbolicLink(), false);
  const result = await execute(path.join(cwd, 'node_modules/.bin/fixture-tool'), [], { cwd });
  assert.match(result.stdout, /LOCAL_OFFLINE_TOOL/);
  assert.equal((await prepareWorktree(cwd, options)).status, 'reused');
  assert.equal(count(cwd), 1);
  assert.equal(readMarker(cwd).state, 'ready');
  assert.deepEqual(fs.readFileSync(path.join(cwd, 'package.json')), manifest);
  assert.deepEqual(fs.readFileSync(path.join(cwd, 'package-lock.json')), lock);
});

test('electron without postinstall gets its runtime before ready, and legacy ready markers are completed', async t => {
  const { cwd, options } = await fixture(t, { electron: true });
  const runtime = path.join(cwd, 'node_modules/electron/dist/electron');
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  assert.ok(fs.existsSync(runtime));
  assert.equal((await prepareWorktree(cwd, options)).status, 'reused');
  assert.equal(Number(fs.readFileSync(path.join(cwd, 'electron-installs'), 'utf8')), 1);
  // A marker written before Electron preparation existed: ready, but no dist/.
  fs.rmSync(path.join(cwd, 'node_modules/electron/dist'), { recursive: true });
  fs.rmSync(path.join(cwd, 'node_modules/electron/path.txt'));
  const legacy = readMarker(cwd);
  legacy.inventory = legacy.inventory.filter(item => !/^.:electron\/(dist|path\.txt)/.test(item));
  write(cwd, `node_modules/${SETUP_MARKER}`, legacy);
  assert.equal((await prepareWorktree(cwd, options)).status, 'reused');
  assert.ok(fs.existsSync(runtime));
  assert.equal(count(cwd), 1);
  assert.equal(readMarker(cwd).state, 'ready');
});

test('lock/ABI changes, missing files and missing node_modules repair managed installs', async t => {
  const { cwd, options } = await fixture(t);
  await prepareWorktree(cwd, options);
  fs.appendFileSync(path.join(cwd, 'package-lock.json'), '\n');
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  const marker = readMarker(cwd);
  // A different ABI is part of the fingerprint, never a valid cache hit.
  marker.fingerprint = 'fingerprint-from-another-node-abi';
  write(cwd, `node_modules/${SETUP_MARKER}`, marker);
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  fs.unlinkSync(path.join(cwd, 'node_modules/.bin/fixture-tool'));
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true });
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  assert.equal(count(cwd), 5);
});

test('failed npm ci is visible, never ready, and retries in the same cwd', async t => {
  const { cwd, options } = await fixture(t);
  write(cwd, 'fail', 'yes');
  write(cwd, 'loud', 'yes');
  await assert.rejects(prepareWorktree(cwd, options), error => error.message.length < 16000 && error.message.includes(cwd) && /FIXTURE_INSTALL_FAILED/.test(error.message) && /reintenta/.test(error.message));
  assert.equal(readMarker(cwd).state, 'incomplete');
  fs.unlinkSync(path.join(cwd, 'fail'));
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  assert.equal(count(cwd), 2);
});

test('inputs changing during real npm ci never receive a ready marker and can retry', async t => {
  const { cwd, options } = await fixture(t);
  write(cwd, 'pause', 'yes');
  const pending = prepareWorktree(cwd, options);
  const rejection = assert.rejects(pending, /cambió durante npm ci/);
  await until(() => fs.existsSync(path.join(cwd, 'install-waiting')));
  // npm may already have removed the incomplete marker, but never wrote success.
  const markerPath = path.join(cwd, 'node_modules', SETUP_MARKER);
  if (fs.existsSync(markerPath)) assert.notEqual(readMarker(cwd).state, 'ready');
  fs.appendFileSync(path.join(cwd, 'package-lock.json'), '\n');
  write(cwd, 'release', 'yes');
  await rejection;
  assert.equal(readMarker(cwd).state, 'incomplete');
  fs.unlinkSync(path.join(cwd, 'pause'));
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  assert.equal(count(cwd), 2);
});

test('manual node_modules and symlinked node_modules are never overwritten', async t => {
  const { cwd, options } = await fixture(t);
  fs.mkdirSync(path.join(cwd, 'node_modules'));
  write(cwd, 'node_modules/manual.txt', 'keep me');
  await assert.rejects(prepareWorktree(cwd, options), /instalación manual/);
  assert.equal(fs.readFileSync(path.join(cwd, 'node_modules/manual.txt'), 'utf8'), 'keep me');
  fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'node_modules'));
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  assert.equal(count(cwd), 1);
  write(cwd, `node_modules/${SETUP_MARKER}`, '{interrupted manual marker');
  await assert.rejects(prepareWorktree(cwd, options), /Marcador de node_modules ilegible/);
  assert.equal(fs.readFileSync(path.join(cwd, 'node_modules', SETUP_MARKER), 'utf8'), '{interrupted manual marker');
  assert.equal(count(cwd), 1);
  fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.join(cwd, 'local-tool'), path.join(cwd, 'node_modules'));
  await assert.rejects(prepareWorktree(cwd, options), /no un enlace/);
});

test('non-node, lockless Node and non-npm projects skip without creating metadata', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-setup-skips-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  assert.equal((await prepareWorktree(cwd)).reason, 'non-node');
  write(cwd, 'package.json', { name: 'fixture' });
  assert.equal((await prepareWorktree(cwd)).reason, 'no-npm-lock');
  write(cwd, 'package-lock.json', {});
  for (const manager of ['pnpm@10', 'yarn@4', 'bun@1']) {
    write(cwd, 'package.json', { packageManager: manager });
    assert.equal((await prepareWorktree(cwd)).reason, 'non-npm');
  }
  write(cwd, 'package.json', { packageManager: 'npm@11' });
  for (const name of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
    write(cwd, name, 'other manager');
    assert.equal((await prepareWorktree(cwd)).reason, 'non-npm');
    fs.unlinkSync(path.join(cwd, name));
  }
  write(cwd, 'package.json', { devEngines: { packageManager: { name: 'pnpm' } } });
  assert.equal((await prepareWorktree(cwd)).reason, 'non-npm');
  assert.equal(fs.existsSync(path.join(cwd, 'node_modules')), false);
});

test('unsupported shrinkwrap skips without mutation, alone or alongside package-lock', async t => {
  const { cwd, options } = await fixture(t);
  fs.renameSync(path.join(cwd, 'package-lock.json'), path.join(cwd, 'npm-shrinkwrap.json'));
  const shrinkwrap = fs.readFileSync(path.join(cwd, 'npm-shrinkwrap.json'));
  const manifest = fs.readFileSync(path.join(cwd, 'package.json'));
  assert.equal((await prepareWorktree(cwd, options)).reason, 'unsupported-shrinkwrap');
  write(cwd, 'package-lock.json', shrinkwrap.toString());
  assert.equal((await prepareWorktree(cwd, options)).reason, 'unsupported-shrinkwrap');
  assert.equal(fs.existsSync(path.join(cwd, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(cwd, 'install-count')), false);
  assert.deepEqual(fs.readFileSync(path.join(cwd, 'package.json')), manifest);
  assert.deepEqual(fs.readFileSync(path.join(cwd, 'npm-shrinkwrap.json')), shrinkwrap);
  assert.deepEqual(fs.readFileSync(path.join(cwd, 'package-lock.json')), shrinkwrap);
  fs.unlinkSync(path.join(cwd, 'npm-shrinkwrap.json'));
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  assert.equal((await prepareWorktree(cwd, options)).status, 'reused');
  assert.equal(count(cwd), 1);
});

test('concurrent same-cwd preparations serialize into one real installation', async t => {
  const { cwd, options } = await fixture(t);
  const results = await Promise.all([prepareWorktree(cwd, options), prepareWorktree(path.join(cwd, '.'), options), prepareWorktree(cwd, options)]);
  assert.deepEqual(results.map(r => r.status), ['installed', 'reused', 'reused']);
  assert.equal(count(cwd), 1);
});

test('cancel/timeout kills npm lifecycle descendants, preserves retry, and queued cancellation is independent', async t => {
  const { cwd, options } = await fixture(t);
  write(cwd, 'slow', 'yes');
  const controller = new AbortController();
  const running = prepareWorktree(cwd, { ...options, signal: controller.signal });
  const rejection = assert.rejects(running, /fixture cancellation/);
  await until(() => fs.existsSync(path.join(cwd, 'descendant-pid')));
  const pid = Number(fs.readFileSync(path.join(cwd, 'descendant-pid'), 'utf8'));
  await assert.rejects(prepareWorktree(cwd, { ...options, timeoutMs: 30 }), /excedió/);
  controller.abort(new Error('fixture cancellation'));
  await rejection;
  await until(() => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); } catch { return true; } });
  assert.equal(readMarker(cwd).state, 'incomplete');
  fs.unlinkSync(path.join(cwd, 'slow'));
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  fs.writeFileSync(path.join(cwd, 'slow'), 'yes');
  fs.appendFileSync(path.join(cwd, 'package-lock.json'), '\n');
  await assert.rejects(prepareWorktree(cwd, { ...options, timeoutMs: 1500 }), /excedió/);
  assert.equal(readMarker(cwd).state, 'incomplete');
  assert.ok(requestTimeout('terminal.create') > SETUP_TIMEOUT_MS + 60000);
});

test('setup CLI module is inert when imported', async () => {
  const module = await import('../scripts/setup-worktree.mjs');
  assert.equal(typeof module.setupCurrentWorktree, 'function');
});
