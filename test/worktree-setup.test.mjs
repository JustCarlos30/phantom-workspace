import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareWorktree, SETUP_MARKER } from '../host/worktree-setup.mjs';
import { execute, write, readMarker, count, fixture } from './support/worktree-setup-fixture.mjs';

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

