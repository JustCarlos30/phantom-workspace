import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inheritClaudeTrust } from '../host/claude-trust.mjs';
import { prepareTerminalDirectory } from '../host/worktrees.mjs';

async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-claude-trust-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'project'), home = path.join(root, 'home');
  fs.mkdirSync(source); fs.mkdirSync(home);
  const git = args => execFileSync('git', ['-C', source, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test' }, stdio: 'pipe',
  });
  git(['init']); git(['commit', '--allow-empty', '-m', 'fixture']);
  const node = { id: 'terminal-fixture', data: {} };
  const workspace = { id: 'workspace-fixture', path: source, canonicalPath: source, nodes: [node] };
  const store = { dir: path.join(root, 'state'), state: { workspaces: [workspace] } };
  const directory = await prepareTerminalDirectory(store, workspace, node);
  Object.assign(node.data, directory);
  const filename = path.join(home, '.claude.json');
  const config = { theme: 'dark', projects: { [source]: { hasTrustDialogAccepted: true, allowedTools: ['Read'] }, '/unrelated': { keep: 7 } } };
  const save = (value = config) => fs.writeFileSync(filename, JSON.stringify(value), { mode: 0o640 });
  save();
  const env = { HOME: home };
  return { root, source, node, workspace, store, directory, filename, config, save, env,
    inherit: () => inheritClaudeTrust(store, workspace, directory, env), read: () => JSON.parse(fs.readFileSync(filename, 'utf8')) };
}

test('inherits root trust for the exact Phantom worktree using a real git repository', async t => {
  const f = await fixture(t);
  assert.equal(await f.inherit(), true);
  assert.equal(f.read().projects[f.directory.cwd].hasTrustDialogAccepted, true);
  assert.equal(f.read().projects[path.dirname(f.directory.cwd)], undefined);
  assert.equal(fs.existsSync(`${f.filename}.lock`), false);
});

test('untrusted project leaves the config byte-for-byte intact', async t => {
  const f = await fixture(t);
  f.config.projects[f.source].hasTrustDialogAccepted = false; f.save();
  const before = fs.readFileSync(f.filename, 'utf8');
  assert.equal(await f.inherit(), false);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), before);
});

test('explicit destination refusal is preserved', async t => {
  const f = await fixture(t);
  for (const target of [false, { hasTrustDialogAccepted: false, keep: true }]) {
    f.config.projects[f.directory.cwd] = target; f.save();
    assert.equal(await f.inherit(), false);
    assert.deepEqual(f.read(), f.config);
  }
});

test('corrupt, missing and unreadable config never gets replaced', async t => {
  const f = await fixture(t);
  fs.writeFileSync(f.filename, '{broken');
  assert.equal(await f.inherit(), false);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), '{broken');
  fs.unlinkSync(f.filename);
  assert.equal(await f.inherit(), false);
  assert.equal(fs.existsSync(f.filename), false);
  fs.mkdirSync(f.filename);
  assert.equal(await f.inherit(), false);
  assert.equal(fs.statSync(f.filename).isDirectory(), true);
});

test('effective config is selected afresh and CLAUDE_CONFIG_DIR takes precedence over HOME', async t => {
  const f = await fixture(t);
  const alternate = path.join(f.root, 'alternate'); fs.mkdirSync(alternate);
  const alternateFile = path.join(alternate, '.claude.json');
  fs.writeFileSync(alternateFile, JSON.stringify(f.config));
  f.env.CLAUDE_CONFIG_DIR = alternate;
  assert.equal(await f.inherit(), true);
  assert.equal(f.read().projects[f.directory.cwd], undefined);
  assert.equal(JSON.parse(fs.readFileSync(alternateFile)).projects[f.directory.cwd].hasTrustDialogAccepted, true);
  fs.unlinkSync(alternateFile);
  assert.equal(await f.inherit(), false);
  assert.equal(f.read().projects[f.directory.cwd], undefined);
  delete f.env.CLAUDE_CONFIG_DIR;
  assert.equal(await f.inherit(), true);
});

test('occupied lock fails safely without removing it or retrying', async t => {
  const f = await fixture(t);
  fs.writeFileSync(`${f.filename}.lock`, 'other writer');
  assert.equal(await f.inherit(), false);
  assert.equal(f.read().projects[f.directory.cwd], undefined);
  assert.equal(fs.readFileSync(`${f.filename}.lock`, 'utf8'), 'other writer');
});

test('concurrent writers preserve both exact worktree entries', async t => {
  const f = await fixture(t);
  const node = { id: 'second-terminal', data: {} }; f.workspace.nodes.push(node);
  const second = await prepareTerminalDirectory(f.store, f.workspace, node); Object.assign(node.data, second);
  const results = await Promise.all([f.inherit(), inheritClaudeTrust(f.store, f.workspace, second, f.env)]);
  assert.ok(results.includes(true));
  for (const [i, directory] of [f.directory, second].entries()) {
    assert.equal(f.read().projects[directory.cwd]?.hasTrustDialogAccepted, results[i] ? true : undefined);
  }
  // A new explicit attempt reads the latest file rather than overwriting its other entries.
  assert.equal(await f.inherit(), true);
  assert.equal(await inheritClaudeTrust(f.store, f.workspace, second, f.env), true);
  assert.equal(f.read().projects[f.directory.cwd].hasTrustDialogAccepted, true);
  assert.equal(f.read().projects[second.cwd].hasTrustDialogAccepted, true);
});

test('preserves unrelated keys, destination keys and file mode with atomic replacement', async t => {
  const f = await fixture(t);
  f.config.projects[f.directory.cwd] = { allowedTools: ['Read'], lastSession: 'keep' }; f.save();
  fs.chmodSync(f.filename, 0o640);
  const old = fs.openSync(f.filename, 'r'); t.after(() => fs.closeSync(old));
  const original = fs.readFileSync(f.filename, 'utf8');
  assert.equal(await f.inherit(), true);
  assert.deepEqual(f.read(), { ...f.config, projects: { ...f.config.projects, [f.directory.cwd]: { ...f.config.projects[f.directory.cwd], hasTrustDialogAccepted: true } } });
  assert.equal(fs.statSync(f.filename).mode & 0o777, 0o640);
  assert.equal(fs.readFileSync(old, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(path.dirname(f.filename)), ['.claude.json']);
});

test('requires registered ownership, managed location, exact git root and common repository', async t => {
  const f = await fixture(t);
  f.store.state.workspaces = [];
  assert.equal(await f.inherit(), false);
  f.store.state.workspaces = [f.workspace];
  const saved = f.node.data.worktree; delete f.node.data.worktree;
  assert.equal(await f.inherit(), false);
  f.node.data.worktree = saved;
  assert.equal(await inheritClaudeTrust(f.store, f.workspace, { cwd: f.source, worktree: { ...saved, path: f.source } }, f.env), false);
  const child = path.join(f.directory.cwd, 'nested'); fs.mkdirSync(child);
  const fake = { ...saved, path: child }; f.node.data.worktree = fake;
  assert.equal(await inheritClaudeTrust(f.store, f.workspace, { cwd: child, worktree: fake }, f.env), false);
  f.node.data.worktree = saved;
  const other = path.join(f.root, 'other'); fs.mkdirSync(other);
  execFileSync('git', ['init', other], { stdio: 'pipe' });
  f.workspace.canonicalPath = other; saved.source = other;
  assert.equal(await f.inherit(), false);
  assert.equal(f.read().projects[f.directory.cwd], undefined);
});
