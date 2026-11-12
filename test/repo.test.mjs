import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHost } from '../host/server.mjs';
import { layoutGraph, parseDiff, parseRefs, diffStats } from '../src/hooks/repo-graph.mjs';
import { changeMix } from '../src/hooks/branches-model.mjs';

const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PHANTOM_')));
const run = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: clean(), stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('Repositorio: graph, commit files, diffs and guarded edits inside worktrees', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-repo-'))), repository = path.join(root, 'repository'), dataDir = path.join(root, 'state');
  fs.mkdirSync(repository);
  const git = (...args) => run(repository, ...args);
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@localhost');
  fs.writeFileSync(path.join(repository, 'a.txt'), 'one\ntwo\n'); git('add', '.'); git('commit', '-m', 'Base');
  const tree = path.join(root, 'feature');
  git('worktree', 'add', '-b', 'feature', tree, 'HEAD');
  fs.writeFileSync(path.join(tree, 'a.txt'), 'one\nTWO\n'); fs.writeFileSync(path.join(tree, 'b.txt'), 'new\n'); run(tree, 'add', '.'); run(tree, 'commit', '-m', 'Feature work');
  fs.writeFileSync(path.join(repository, 'c.txt'), 'main\n'); git('add', '.'); git('commit', '-m', 'Main moves');
  git('merge', '--no-ff', '-m', 'Merge feature', 'feature');
  const host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspaceId = (await host.invoke('workspace.open', { path: repository })).id;

  const graph = await host.invoke('repo.graph', { workspaceId });
  assert.equal(graph.available, true); assert.equal(graph.head, 'main');
  // Topological order: the merge first, the root last; siblings may come in either order.
  assert.equal(graph.commits[0].subject, 'Merge feature'); assert.equal(graph.commits[3].subject, 'Base');
  assert.deepEqual(graph.commits.map(c => c.subject).sort(), ['Base', 'Feature work', 'Main moves', 'Merge feature']);
  assert.equal(graph.commits[0].parents.length, 2);
  assert.ok(graph.commits[0].refs.includes('HEAD -> main'));

  const feature = graph.commits.find(c => c.subject === 'Feature work');
  const commit = await host.invoke('repo.commit', { workspaceId, oid: feature.oid });
  assert.deepEqual(commit.files.map(f => [f.status, f.path, f.added, f.removed]).sort(), [['A', 'b.txt', 1, 0], ['M', 'a.txt', 1, 1]]);
  const root0 = await host.invoke('repo.commit', { workspaceId, oid: graph.commits[3].oid });
  assert.deepEqual(root0.files.map(f => f.path), ['a.txt']);
  const diff = await host.invoke('repo.diff', { workspaceId, oid: feature.oid, path: 'a.txt' });
  assert.deepEqual(diffStats(parseDiff(diff.text)), { added: 1, removed: 1 });
  await assert.rejects(host.invoke('repo.commit', { workspaceId, oid: '--all' }), /no válido/);

  // Working-tree diffs: tracked and untracked files.
  fs.writeFileSync(path.join(tree, 'a.txt'), 'one\nTWO\nthree\n'); fs.writeFileSync(path.join(tree, 'u.txt'), 'untracked\n');
  assert.match((await host.invoke('repo.diff', { workspaceId, tree, path: 'a.txt' })).text, /^\+three$/m);
  assert.match((await host.invoke('repo.diff', { workspaceId, tree, path: 'u.txt' })).text, /^\+untracked$/m);
  assert.ok((await host.invoke('repo.files', { workspaceId, tree })).files.includes('u.txt'));

  // Editing: read, write with the read version, refuse stale versions and escapes.
  const file = await host.invoke('repo.file.read', { workspaceId, tree, path: 'a.txt' });
  assert.equal(file.editable, true); assert.equal(file.content, 'one\nTWO\nthree\n');
  const saved = await host.invoke('repo.file.write', { workspaceId, tree, path: 'a.txt', content: 'edited\n', hash: file.hash });
  assert.equal(fs.readFileSync(path.join(tree, 'a.txt'), 'utf8'), 'edited\n');
  await assert.rejects(host.invoke('repo.file.write', { workspaceId, tree, path: 'a.txt', content: 'x', hash: file.hash }), /cambió en disco/);
  fs.writeFileSync(path.join(tree, 'a.txt'), 'agent\n');
  await assert.rejects(host.invoke('repo.file.write', { workspaceId, tree, path: 'a.txt', content: 'x', hash: saved.hash }), /cambió en disco/);
  await assert.rejects(host.invoke('repo.file.read', { workspaceId, tree, path: '../repository/a.txt' }), /no válida/);
  await assert.rejects(host.invoke('repo.file.read', { workspaceId, tree, path: '.git/config' }), /no válida|no existe/);
  await assert.rejects(host.invoke('repo.file.read', { workspaceId, tree: root, path: 'repository/a.txt' }), /no es un worktree/);
  fs.symlinkSync(path.join(repository, 'a.txt'), path.join(tree, 'link.txt'));
  await assert.rejects(host.invoke('repo.file.read', { workspaceId, tree, path: 'link.txt' }), /fuera del worktree/);
  fs.writeFileSync(path.join(tree, 'bin.dat'), Buffer.from([1, 0, 2]));
  assert.equal((await host.invoke('repo.file.read', { workspaceId, tree, path: 'bin.dat' })).editable, false);

  // Large worktrees retain an exact type summary even when only 200 files are listed.
  for (let index = 0; index < 205; index++) fs.writeFileSync(path.join(tree, `untracked-${index}.txt`), 'new\n');
  const overview = await host.invoke('branch.overview', { workspaceId });
  const row = overview.branches.find(branch => branch.name === 'feature');
  assert.equal(row.changes.length, 200);
  assert.ok(row.changeCount > row.changes.length);
  assert.equal(row.changeSummary['??'], 208); // u.txt, link.txt, bin.dat and the 205 files
  assert.equal(changeMix(row.changes, row.changeSummary).reduce((sum, kind) => sum + kind.count, 0), row.changeCount);
});

test('Repositorio: lanes follow branches and merges', () => {
  // M merges F into C; F and C share base B.
  const rows = layoutGraph([
    { oid: 'M', parents: ['C', 'F'] },
    { oid: 'C', parents: ['B'] },
    { oid: 'F', parents: ['B'] },
    { oid: 'B', parents: [] },
  ]);
  assert.deepEqual(rows.map(r => r.col), [0, 0, 1, 0]);
  assert.equal(rows[0].merge, true); assert.deepEqual(rows[0].bottom, [[0, 0], [0, 1]]);
  assert.deepEqual(rows[1].bottom, [[0, 0], [1, 1]]);
  // F's lane joins B's lane.
  assert.deepEqual(rows[2].bottom, [[1, 0], [0, 0]]);
  assert.deepEqual(rows[3].top, [[0, 0]]);
  // Same history with the side branch listed first: the base still lands on lane 0.
  const flipped = layoutGraph([{ oid: 'M', parents: ['C', 'F'] }, { oid: 'F', parents: ['B'] }, { oid: 'C', parents: ['B'] }, { oid: 'B', parents: [] }]);
  assert.deepEqual(flipped.map(r => r.col), [0, 1, 0, 0]);
  assert.deepEqual(flipped[2].bottom, [[0, 0], [1, 0]]);
  assert.equal(rows[3].bottom.length, 0);
  assert.deepEqual(parseRefs(['HEAD -> main', 'origin/main', 'tag: v1', 'phantom/terminal-x']).map(r => r.kind), ['head', 'remote', 'tag', 'branch']);
  const parsed = parseDiff('diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n');
  assert.deepEqual(parsed.filter(r => r.kind !== 'meta').map(r => [r.kind, r.old, r.new]), [['hunk', undefined, undefined], ['ctx', 1, 1], ['del', 2, undefined], ['add', undefined, 2]]);
});
