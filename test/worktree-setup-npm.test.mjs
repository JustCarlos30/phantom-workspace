import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareWorktree, SETUP_MARKER } from '../host/worktree-setup.mjs';
import { write, readMarker, count, until, fixture } from './support/worktree-setup-fixture.mjs';

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
