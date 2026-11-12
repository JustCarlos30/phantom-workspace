import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHost, phantomInstructions } from '../host/server.mjs';
import { detectChecks, runChecks } from '../host/checks.mjs';
import { main as cli, resolveBranch, cleanable } from '../scripts/branches.mjs';

const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PHANTOM_')));
const run = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: clean(), stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-orchestration-'))), repository = path.join(root, 'repository'), remote = path.join(root, 'remote.git'), dataDir = path.join(root, 'state');
  fs.mkdirSync(repository);
  const git = (...args) => run(repository, ...args);
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@localhost');
  fs.writeFileSync(path.join(repository, 'shared.txt'), 'base\n'); fs.writeFileSync(path.join(repository, 'health.txt'), 'good\n'); git('add', '.'); git('commit', '-m', 'Base');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { env: clean(), stdio: 'ignore' }); git('remote', 'add', 'origin', remote);
  const host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspaceId = (await host.invoke('workspace.open', { path: repository })).id;
  const tree = name => { const dir = path.join(root, name); git('worktree', 'add', '-b', `phantom/terminal-${name}`, dir, 'HEAD'); return dir; };
  const branch = name => `phantom/terminal-${name}`;
  return { root, repository, remote, git, host, workspaceId, tree, branch };
}

test('integration runs the project checks and undoes a merge that breaks them', async t => {
  const { repository, git, host, workspaceId, tree, branch } = await fixture(t);
  await host.invoke('merge.configure', { workspaceId, checks: 'grep -q good health.txt' });
  assert.equal((await host.invoke('branch.overview', { workspaceId })).checks, 'grep -q good health.txt');
  const good = tree('good'), bad = tree('bad');
  fs.writeFileSync(path.join(good, 'feature.txt'), 'x\n'); run(good, 'add', '.'); run(good, 'commit', '-m', 'Feature');
  fs.writeFileSync(path.join(bad, 'health.txt'), 'broken\n'); run(bad, 'commit', '-am', 'Break health');

  const failed = await host.invoke('branch.integrate', { workspaceId, branch: branch('bad') });
  assert.equal(failed.status, 'checks-failed'); assert.equal(failed.checks.ok, false); assert.equal(failed.checks.code, 1);
  assert.equal(git('log', '-1', '--format=%s'), 'Base'); assert.equal(fs.readFileSync(path.join(repository, 'health.txt'), 'utf8'), 'good\n'); assert.equal(git('status', '--porcelain'), '');

  // Uncommitted edits in the checkout would make the verdict meaningless.
  fs.writeFileSync(path.join(repository, 'shared.txt'), 'local\n');
  await assert.rejects(host.invoke('branch.integrate', { workspaceId, branch: branch('good') }), /cambios sin commitear/);
  git('checkout', '--', 'shared.txt');

  const merged = await host.invoke('branch.integrate', { workspaceId, branch: branch('good') });
  assert.equal(merged.status, 'merged'); assert.equal(merged.checks.ok, true); assert.ok(fs.existsSync(path.join(repository, 'feature.txt')));
  // Skipping checks is explicit, and '' configures "none".
  assert.equal((await host.invoke('branch.integrate', { workspaceId, branch: branch('bad'), checks: false })).status, 'merged');
  await host.invoke('merge.configure', { workspaceId, checks: '' });
  assert.equal((await host.invoke('branch.overview', { workspaceId })).checks, '');
  await host.invoke('merge.configure', { workspaceId, checks: null });
  assert.equal((await host.invoke('branch.overview', { workspaceId })).checks, '', 'no package.json: nothing detected');
  await assert.rejects(host.invoke('merge.configure', { workspaceId, checks: 'a\nb' }), /un solo comando/);
});

test('a conflict can be resolved inside the worktree, concluded by commit, then integrated and published', async t => {
  const { repository, remote, git, host, workspaceId, tree, branch } = await fixture(t);
  await host.invoke('merge.configure', { workspaceId, checks: '' });
  const clash = tree('clash'), other = tree('other');
  fs.writeFileSync(path.join(clash, 'shared.txt'), 'clash\n'); run(clash, 'commit', '-am', 'Clash');
  fs.writeFileSync(path.join(repository, 'shared.txt'), 'main\n'); git('commit', '-am', 'Main moves');

  assert.equal((await host.invoke('branch.integrate', { workspaceId, branch: branch('clash') })).status, 'conflict');
  // Without --resolve the update is undone as before.
  assert.equal((await host.invoke('branch.update', { workspaceId, branch: branch('clash') })).status, 'conflict');
  assert.equal(run(clash, 'status', '--porcelain'), '');

  const open = await host.invoke('branch.update', { workspaceId, branch: branch('clash'), resolve: true });
  assert.equal(open.status, 'resolving'); assert.deepEqual(open.conflicts, ['shared.txt']); assert.equal(open.worktree, clash);
  await assert.rejects(host.invoke('branch.update', { workspaceId, branch: branch('clash'), resolve: true }), /merge sin terminar/);
  await assert.rejects(host.invoke('branch.commit', { workspaceId, branch: branch('clash'), message: 'Resolve' }), /marcas de conflicto en: shared\.txt/);
  // Abort backs out completely; resolving again leaves the same conflict.
  assert.equal((await host.invoke('branch.abort', { workspaceId, branch: branch('clash') })).status, 'aborted');
  assert.equal(run(clash, 'log', '-1', '--format=%s'), 'Clash'); assert.equal(run(clash, 'status', '--porcelain'), '');
  await assert.rejects(host.invoke('branch.abort', { workspaceId, branch: branch('clash') }), /no tiene un merge sin terminar/);
  await host.invoke('branch.update', { workspaceId, branch: branch('clash'), resolve: true });
  fs.writeFileSync(path.join(clash, 'shared.txt'), 'main\nclash\n');
  const concluded = await host.invoke('branch.commit', { workspaceId, branch: branch('clash'), message: 'Resolve with main' });
  assert.equal(concluded.concluded, 'merge'); assert.equal(run(clash, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3);
  assert.equal((await host.invoke('branch.integrate', { workspaceId, branch: branch('clash') })).status, 'merged');
  assert.equal(fs.readFileSync(path.join(repository, 'shared.txt'), 'utf8'), 'main\nclash\n');

  // A live terminal on a branch resolves its own conflicts.
  fs.writeFileSync(path.join(other, 'shared.txt'), 'other\n'); run(other, 'commit', '-am', 'Other');
  await host.invoke('node.create', { workspaceId, type: 'terminal', title: 'Worker', data: { worktree: { path: other, branch: branch('other'), source: repository, createdAt: new Date().toISOString() } } });
  const node = (await host.invoke('state.get')).workspaces[0].nodes.find(n => n.title === 'Worker');
  host.terminals.sessions.push({ id: 'fake', nodeId: node.id, workspaceId, status: 'running' });
  await assert.rejects(host.invoke('branch.update', { workspaceId, branch: branch('other'), resolve: true }), /sigue activa/);
  host.terminals.sessions.pop();

  // Publishing pushes the base without forcing.
  const published = await host.invoke('branch.publish', { workspaceId });
  assert.equal(published.status, 'published'); assert.equal(published.remote, 'origin');
  assert.equal(execFileSync('git', ['-C', remote, 'rev-parse', 'main'], { encoding: 'utf8', env: clean() }).trim(), git('rev-parse', 'main'));
  await assert.rejects(host.invoke('branch.publish', { workspaceId, remote: 'nowhere' }), /no tiene el remoto/);
  await assert.rejects(host.invoke('branch.publish', { workspaceId, remote: '--upload-pack=x' }), /Remoto inválido/);
  git('reset', '-q', '--hard', 'HEAD~1'); fs.writeFileSync(path.join(repository, 'diverge.txt'), 'x'); git('add', '.'); git('commit', '-m', 'Diverge');
  await assert.rejects(host.invoke('branch.publish', { workspaceId }), /rejected|non-fast-forward|fetch first/);
});

test('branches CLI resolves loose names, integrates in order and cleans only what is integrated', async t => {
  const { repository, git, host, workspaceId, tree, branch } = await fixture(t);
  const call = (method, payload) => host.invoke(method, payload), env = {};
  const say = (...args) => cli([...args, '--workspace', repository], env, call);
  assert.match(await say('checks', 'grep -q good health.txt'), /grep -q good health\.txt/);
  const a = tree('aaaa1111-0000'), b = tree('bbbb2222-0000'), c = tree('cccc3333-0000'); tree('dddd4444-0000');
  for (const [dir, file] of [[a, 'a.txt'], [b, 'b.txt']]) { fs.writeFileSync(path.join(dir, file), 'x\n'); run(dir, 'add', '.'); run(dir, 'commit', '-m', file); }
  fs.writeFileSync(path.join(c, 'health.txt'), 'bad\n'); run(c, 'commit', '-am', 'Break');

  const status = await say('status');
  assert.match(status, /^Base main · checks: grep -q good health\.txt · Incorporaciones apagado/);
  assert.match(status, /terminal-aaaa1111 +ready +sin terminal +— \+1 commits/); assert.match(status, /1 ramas sin trabajo pendiente/);
  const rows = (await host.invoke('branch.overview', { workspaceId })).branches;
  assert.equal(resolveBranch(rows, 'aaaa1111').name, branch('aaaa1111-0000'));
  assert.throws(() => resolveBranch(rows, 'zzzz'), /Ninguna|No hay ninguna rama/);

  await assert.rejects(say('integrate', 'aaaa1111', 'cccc3333', 'bbbb2222'), err => /✓ terminal-aaaa1111 integrada/.test(err.message) && /✗ terminal-cccc3333: checks fallidos/.test(err.message) && /quedan sin integrar: terminal-bbbb2222/.test(err.message));
  assert.match(git('log', '-1', '--format=%s'), /aaaa1111/);
  assert.match(await say('integrate', 'bbbb2222'), /✓ terminal-bbbb2222 integrada en main .* checks OK/);

  const after = (await host.invoke('branch.overview', { workspaceId })).branches;
  assert.deepEqual(after.filter(cleanable).map(r => r.name).sort(), [branch('aaaa1111-0000'), branch('bbbb2222-0000'), branch('dddd4444-0000')]);
  assert.match(await say('clean', '--dry-run'), /terminal-aaaa1111/);
  const cleaned = await say('clean');
  assert.match(cleaned, /✓ terminal-aaaa1111/); assert.match(cleaned, /✓ terminal-dddd4444/);
  assert.deepEqual(git('branch', '--format=%(refname:short)').split('\n').sort(), ['main', branch('cccc3333-0000')]);
  assert.match(await say('incorporaciones', 'on'), /Incorporaciones activo/);
  assert.match(await say('help'), /integrate RAMA/);
});

test('checks detection, process-group timeout, and the integrator instructions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-checks-'));
  try {
    assert.equal(detectChecks(dir), '');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    assert.equal(detectChecks(dir), '');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    assert.equal(detectChecks(dir), 'npm test');
    const slow = await runChecks(dir, 'sleep 5; echo never', { timeout: 200 });
    assert.equal(slow.ok, false); assert.equal(slow.timedOut, true); assert.ok(slow.durationMs < 3000);
    const loud = await runChecks(dir, 'echo out; echo err >&2; exit 3');
    assert.equal(loud.code, 3); assert.match(loud.output, /out/); assert.match(loud.output, /err/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const text = phantomInstructions({ name: 'p', canonicalPath: '/p', nodes: [] });
  assert.match(text, /integrator/); assert.match(text, /branches\.mjs/); assert.match(text, /--resolve/);
});
