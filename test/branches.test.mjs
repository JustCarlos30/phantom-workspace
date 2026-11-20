import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHost } from '../host/server.mjs';
import { Branches } from '../host/branches.mjs';
import { GitPolling } from '../host/merges.mjs';
import { buildBranches, cardsOf, changeLabel, changeMix, changeTone, contentByBranch, groupByDir } from '../src/hooks/branches-model.mjs';

const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PHANTOM_')));
const run = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: clean(), stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('branch polling shares concurrent work and host mutations invalidate object queries', async () => {
  let rounds = 0, calls = 0;
  const polling = new GitPolling(async () => { calls++; return '0\t0'; });
  const base = { source: '/repo', branch: 'main', oid: 'a'.repeat(40) };
  const w = { id: 'polling', nodes: [] };
  const branches = new Branches({ store: { getWorkspace: () => w }, terminals: { sessions: [] }, merges: { polling } });
  branches.repository = async () => { rounds++; return { base, trees: [], branches: [{ name: 'worker', oid: 'b'.repeat(40) }] }; };
  const [first, second] = await Promise.all([branches.overview(w), branches.overview(w)]);
  assert.strictEqual(first, second);
  assert.equal(rounds, 1); assert.equal(calls, 1);
  await branches.overview(w);
  assert.equal(calls, 1, 'immutable Git results survive the next poll');
  branches.act = async () => ({ status: 'removed' });
  await branches.handle('branch.remove', { workspaceId: w.id });
  await branches.overview(w);
  assert.equal(calls, 2, 'a host mutation forces new Git work');
});

test('Ramas: every branch and worktree is visible, and integration never loses work', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-branches-'))), repository = path.join(root, 'repository'), dataDir = path.join(root, 'state');
  fs.mkdirSync(repository);
  const git = (...args) => run(repository, ...args);
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@localhost');
  fs.writeFileSync(path.join(repository, 'shared.txt'), 'base\n'); fs.writeFileSync(path.join(repository, 'other.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'Base');
  const host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspaceId = (await host.invoke('workspace.open', { path: repository })).id;
  const tree = name => { const dir = path.join(root, name); git('worktree', 'add', '-b', `phantom/terminal-${name}`, dir, 'HEAD'); return dir; };
  const dirty = tree('dirty'), ready = tree('ready'), stale = tree('stale'), clash = tree('clash');
  // A terminal on the canvas owns the dirty worktree; the others are orphans.
  const node = await host.invoke('node.create', { workspaceId, type: 'terminal', title: 'Sidebar', data: { worktree: { path: dirty, branch: 'phantom/terminal-dirty', source: repository, createdAt: new Date().toISOString() } } });
  fs.writeFileSync(path.join(dirty, 'shared.txt'), 'dirty\n'); fs.writeFileSync(path.join(dirty, 'new.txt'), 'new\n');
  fs.writeFileSync(path.join(ready, 'other.txt'), 'ready\n'); run(ready, 'commit', '-am', 'Ready work');
  fs.writeFileSync(path.join(clash, 'shared.txt'), 'clash\n'); run(clash, 'commit', '-am', 'Clash work');
  fs.writeFileSync(path.join(repository, 'shared.txt'), 'main moved\n'); git('commit', '-am', 'Main moves');

  const read = async () => { const data = await host.invoke('branch.overview', { workspaceId }); return { data, of: name => data.branches.find(b => b.name === `phantom/terminal-${name}`) }; };
  let { data, of } = await read();
  assert.equal(data.available, true); assert.equal(data.base.branch, 'main'); assert.equal(data.branches.length, 5);
  assert.equal(data.branches.find(b => b.isBase).worktree.main, true);
  assert.equal(of('dirty').work, 'dirty'); assert.equal(of('dirty').changeCount, 2); assert.equal(of('dirty').terminal.title, 'Sidebar');
  assert.equal(of('dirty').terminal.cardId, ''); assert.equal(of('dirty').terminal.cardTitle, '');
  assert.equal(of('dirty').inBase, 0);
  assert.deepEqual(of('dirty').changes.map(c => [c.status, c.path]).sort(), [[' M', 'shared.txt'], ['??', 'new.txt']].sort());
  assert.equal(of('ready').work, 'ready'); assert.equal(of('ready').ahead, 1); assert.equal(of('ready').behind, 1); assert.deepEqual(of('ready').conflicts, []); assert.equal(of('ready').terminal, null);
  assert.equal(of('stale').work, 'none'); assert.equal(of('stale').behind, 1);
  assert.deepEqual(of('clash').conflicts, ['shared.txt']);
  // Uncommitted and committed edits of the same file in two branches are an overlap.
  assert.deepEqual(of('dirty').overlaps, [{ path: 'shared.txt', with: ['phantom/terminal-clash'] }]);

  // Unsaved files already identical in the base are told apart: that worktree is only out of date.
  fs.writeFileSync(path.join(stale, 'shared.txt'), 'main moved\n');
  ({ of } = await read());
  assert.equal(of('stale').work, 'dirty'); assert.equal(of('stale').inBase, 1); assert.equal(of('stale').changes[0].inBase, true); assert.deepEqual(of('stale').overlaps, []);
  run(stale, 'checkout', '--', 'shared.txt');

  // Nothing with pending work can be cleaned, and nothing is forced.
  fs.writeFileSync(path.join(stale, 'scratch.txt'), 'x');
  await assert.rejects(host.invoke('branch.remove', { workspaceId, branch: 'phantom/terminal-stale' }), /cambios sin guardar/);
  fs.rmSync(path.join(stale, 'scratch.txt'));
  await assert.rejects(host.invoke('branch.remove', { workspaceId, branch: 'phantom/terminal-ready' }), /commits que no están en main/);
  await assert.rejects(host.invoke('branch.remove', { workspaceId, branch: 'main' }), /no se limpian/);
  await assert.rejects(host.invoke('branch.integrate', { workspaceId, branch: 'phantom/terminal-stale' }), /no tiene commits nuevos/);

  // A conflicting integration is undone and reported; the checkout stays clean.
  const conflict = await host.invoke('branch.integrate', { workspaceId, branch: 'phantom/terminal-clash' });
  assert.equal(conflict.status, 'conflict'); assert.deepEqual(conflict.conflicts, ['shared.txt']);
  assert.equal(git('status', '--porcelain'), ''); assert.equal(git('log', '-1', '--format=%s'), 'Main moves');

  const merged = await host.invoke('branch.integrate', { workspaceId, branch: 'phantom/terminal-ready' });
  assert.equal(merged.status, 'merged'); assert.equal(fs.readFileSync(path.join(repository, 'other.txt'), 'utf8'), 'ready\n');
  assert.match(git('log', '-1', '--format=%s'), /^Integrar phantom\/terminal-ready/);

  // Updating: fast-forward keeps local edits when they don't collide, and refuses when they do.
  assert.equal((await host.invoke('branch.update', { workspaceId, branch: 'phantom/terminal-stale' })).status, 'updated');
  await assert.rejects(host.invoke('branch.update', { workspaceId, branch: 'phantom/terminal-dirty' }), /shared\.txt|overwritten/);
  assert.equal(fs.readFileSync(path.join(dirty, 'shared.txt'), 'utf8'), 'dirty\n');

  // Saving commits everything in the worktree on its own branch, untracked files included.
  await assert.rejects(host.invoke('branch.commit', { workspaceId, branch: 'phantom/terminal-dirty', message: 'a\nb' }), /una sola línea/);
  const saved = await host.invoke('branch.commit', { workspaceId, branch: 'phantom/terminal-dirty', message: 'Save sidebar work' });
  assert.equal(saved.files, 2); assert.equal(run(dirty, 'status', '--porcelain'), ''); assert.equal(run(dirty, 'log', '-1', '--format=%s'), 'Save sidebar work');
  // With commits of its own, updating is a real merge: its conflict is undone too.
  const behind = await host.invoke('branch.update', { workspaceId, branch: 'phantom/terminal-dirty' });
  assert.equal(behind.status, 'conflict'); assert.equal(run(dirty, 'status', '--porcelain'), '');

  // Cleaning removes worktree and branch once everything is in the base.
  ({ of } = await read());
  assert.equal(of('ready').work, 'none'); assert.equal(of('ready').ahead, 0);
  assert.equal((await host.invoke('branch.remove', { workspaceId, branch: 'phantom/terminal-ready' })).status, 'removed');
  assert.equal(fs.existsSync(ready), false); assert.equal(git('branch', '--list', 'phantom/terminal-ready'), '');
  fs.writeFileSync(path.join(dirty, 'shared.txt'), 'main moved\n'); run(dirty, 'commit', '-am', 'Take main');
  run(dirty, 'merge', '--no-edit', 'main'); assert.equal((await host.invoke('branch.integrate', { workspaceId, branch: 'phantom/terminal-dirty' })).status, 'merged');
  // A branch owned by a terminal on the canvas is not cleaned under it; once the terminal is gone it is an orphan.
  await assert.rejects(host.invoke('branch.remove', { workspaceId, branch: 'phantom/terminal-dirty' }), /terminal «Sidebar»/);
  await host.invoke('node.remove', { workspaceId, id: node.id });
  assert.equal((await host.invoke('branch.remove', { workspaceId, branch: 'phantom/terminal-dirty' })).status, 'removed');
  assert.equal(fs.existsSync(dirty), false);
  // A worktree deleted by hand is pruned instead of blocking the cleanup.
  fs.rmSync(stale, { recursive: true, force: true });
  ({ of } = await read()); assert.equal(of('stale').worktree.exists, false);
  assert.equal((await host.invoke('branch.remove', { workspaceId, branch: 'phantom/terminal-stale' })).status, 'removed');
  ({ data } = await read()); assert.deepEqual(data.branches.map(b => b.name).sort(), ['main', 'phantom/terminal-clash']);
});

test('Ramas: integrating closes the worktree\'s blocked tasks and a failure there never undoes the merge', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-branches-close-'))), repository = path.join(root, 'repository'), dataDir = path.join(root, 'state');
  fs.mkdirSync(repository);
  const git = (...args) => run(repository, ...args);
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@localhost');
  fs.writeFileSync(path.join(repository, 'a.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'Base');
  const one = path.join(root, 'one'), two = path.join(root, 'two');
  git('worktree', 'add', '-b', 'phantom/terminal-one', one, 'HEAD'); git('worktree', 'add', '-b', 'phantom/terminal-two', two, 'HEAD');
  fs.writeFileSync(path.join(one, 'one.txt'), '1\n'); run(one, 'add', '.'); run(one, 'commit', '-m', 'One');
  fs.writeFileSync(path.join(two, 'two.txt'), '2\n'); run(two, 'add', '.'); run(two, 'commit', '-m', 'Two');
  const log = path.join(root, 'cancelled.log'), cli = path.join(root, 'fake-phantom.mjs');
  const tasks = [['t_one', 'blocked', one], ['t_one_ready', 'ready', one], ['t_two', 'blocked', two], ['t_two_other', 'blocked', repository]].map(([id, status, workspace]) => ({ id, kind: 'card', status, contract: { goal: id, workspace, lane: 'coordinated' } }));
  fs.writeFileSync(cli, `import fs from 'node:fs';
const [command, id] = process.argv.slice(2);
if (command === 'cancel') { if (id === 't_two') { console.error('cancel refused'); process.exit(1); } fs.appendFileSync(${JSON.stringify(log)}, id + '\\n'); console.log('{}'); }
else console.log(${JSON.stringify(JSON.stringify(tasks))});
`);
  const previous = process.env.PHANTOM_CLI; process.env.PHANTOM_CLI = cli;
  const host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); if (previous === undefined) delete process.env.PHANTOM_CLI; else process.env.PHANTOM_CLI = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const workspaceId = (await host.invoke('workspace.open', { path: repository })).id;
  await host.invoke('plugin.update', { workspaceId, id: 'phantom', settings: { enabled: true, refreshMs: 3000 } });
  const first = await host.invoke('branch.integrate', { workspaceId, branch: 'phantom/terminal-one', checks: false });
  assert.equal(first.status, 'merged'); assert.deepEqual(first.closedTasks, ['t_one']); assert.equal(first.closeErrors, undefined);
  assert.equal(fs.readFileSync(log, 'utf8'), 't_one\n');
  const second = await host.invoke('branch.integrate', { workspaceId, branch: 'phantom/terminal-two', checks: false });
  assert.equal(second.status, 'merged'); assert.deepEqual(second.closedTasks, []);
  assert.equal(second.closeErrors.length, 1); assert.equal(second.closeErrors[0].id, 't_two');
  assert.match(git('log', '-1', '--format=%s'), /^Integrar phantom\/terminal-two/);
});

test('Ramas: a worktree names the Card it works for and how its changes split', () => {
  const row = { name: 'phantom/terminal-a', terminal: { cardId: 'task_bound', cardTitle: 'Título guardado' } };
  const content = { cards: [{ id: 'task_other', title: 'Otra', status: 'ready' }, { id: 'task_bound', title: 'Título vivo', status: 'running' }], skills: [] };
  assert.deepEqual(cardsOf(row, content), [
    { id: 'task_bound', title: 'Título vivo', status: 'running', bound: true },
    { id: 'task_other', title: 'Otra', status: 'ready', bound: false },
  ]);
  // Without the catalog the bound Card still shows, from the terminal identity.
  assert.deepEqual(cardsOf(row, undefined), [{ id: 'task_bound', title: 'Título guardado', status: undefined, bound: true }]);
  assert.deepEqual(cardsOf({ terminal: { cardId: '' } }, undefined), []);
  assert.deepEqual(cardsOf(row, undefined, [{ id: 'task_bound', title: 'Título del catálogo', status: 'done' }]), [{ id: 'task_bound', title: 'Título del catálogo', status: 'done', bound: true }]);
  assert.deepEqual(changeMix([{ status: '??' }, { status: ' M' }, { status: 'M ' }, { status: ' D' }]).map(k => [k.id, k.count]), [['added', 1], ['modified', 2], ['removed', 1]]);
  assert.deepEqual(groupByDir([{ path: 'src/b.js' }, { path: 'a.md' }, { path: 'src/a.js' }, { path: 'docs/x.md' }]).map(g => [g.dir, g.items.map(i => i.path)]),
    [['', ['a.md']], ['docs', ['docs/x.md']], ['src', ['src/a.js', 'src/b.js']]]);
});

test('Ramas: all unmerged Git states read as conflicts, including both-added and both-deleted', () => {
  const changes = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].map(status => ({ status }));
  for (const change of changes) {
    assert.equal(changeLabel(change.status), 'En conflicto');
    assert.equal(changeTone(change.status), 'conflict');
  }
  assert.deepEqual(changeMix(changes).map(kind => [kind.id, kind.count]), [['conflict', 7]]);
  assert.equal(changeLabel(' T'), 'Tipo cambiado');
  assert.equal(changeLabel('R '), 'Renombrado');
  assert.deepEqual(changeMix(['R ', 'C ', ' T', 'AA'].map(status => ({ status }))).map(kind => [kind.id, kind.count]),
    [['renamed', 1], ['copied', 1], ['type', 1], ['conflict', 1]]);
  // The full host summary takes precedence over the capped file list.
  assert.deepEqual(changeMix([{ status: ' M' }], { ' M': 220, '??': 12, 'DD': 2 }).map(kind => [kind.id, kind.count]),
    [['added', 12], ['modified', 220], ['conflict', 2]]);
});

test('Ramas: Card locations include main and detached checkouts, and search finds branch Cards', () => {
  const cards = [
    { id: 'task_main', title: 'Proyecto', location: { main: true, branch: 'main' } },
    { id: 'task_branch', title: 'Mejorar navegación', location: { branch: 'feature' } },
    { id: 'task_detached', title: 'Separada', location: { path: '/detached' } },
  ];
  const content = contentByBranch({ cards, baseBranch: 'main' });
  assert.deepEqual(content.get('main').cards, [cards[0]]);
  assert.deepEqual(content.get('/detached').cards, [cards[2]]);
  const data = { base: { branch: 'main' }, branches: [{ name: 'feature', work: 'none', changeCount: 0, ahead: 0, behind: 0, changes: [], committed: [] }] };
  assert.equal(buildBranches(data, { query: 'navegación', content, cards }).visible, 1);
  assert.equal(buildBranches(data, { query: 'task_branch', content, cards }).visible, 1);
  assert.equal(buildBranches(data, { query: 'Separada', content, cards }).visible, 0);
});
