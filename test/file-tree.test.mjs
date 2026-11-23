import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFileTree, pruneToChanged, visibleRows } from '../src/hooks/file-tree.mjs';

const files = ['README.md', 'src/a.js', 'src/lib/b.js', 'src/lib/c.js', 'docs/x.md'];
const changes = [{ path: 'src/lib/b.js', status: 'M' }, { path: 'src/new.js', status: 'A' }];

test('buildFileTree ordena carpetas primero y cuenta cambiados', () => {
  const tree = buildFileTree(files, changes);
  assert.deepEqual(tree.children.map(node => node.name), ['docs', 'src', 'README.md']);
  const src = tree.children[1];
  assert.equal(src.changed, 2);
  assert.deepEqual(src.children.map(node => node.name), ['lib', 'a.js', 'new.js']);
  assert.equal(src.children[0].changed, 1);
  assert.equal(src.children[2].status, 'A');
  assert.equal(tree.changed, 2);
});

test('pruneToChanged deja solo lo cambiado', () => {
  const pruned = pruneToChanged(buildFileTree(files, changes));
  assert.deepEqual(pruned.children.map(node => node.name), ['src']);
  assert.deepEqual(pruned.children[0].children.map(node => node.name), ['lib', 'new.js']);
  assert.deepEqual(pruned.children[0].children[0].children.map(node => node.name), ['b.js']);
  assert.equal(pruneToChanged(buildFileTree(files, [])).children.length, 0);
});

test('visibleRows solo desciende por carpetas expandidas', () => {
  const tree = buildFileTree(files, changes);
  assert.deepEqual(visibleRows(tree, new Set()).map(row => row.node.path), ['docs', 'src', 'README.md']);
  const rows = visibleRows(tree, new Set(['src']));
  assert.deepEqual(rows.map(row => row.node.path), ['docs', 'src', 'src/lib', 'src/a.js', 'src/new.js', 'README.md']);
  assert.equal(rows[2].depth, 1);
  assert.equal(rows[1].expanded, true);
});
