import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, groupByFolder, parseDiffLines, sameFiles } from '../src/hooks/touched-files.mjs';

const files = [
  { path: 'src/a.js', status: 'M', added: 10, removed: 2, uncommitted: true },
  { path: 'README.md', status: 'A', added: 5, removed: 0, uncommitted: false },
  { path: 'src/ui/b.jsx', status: 'D', added: null, removed: null, uncommitted: false },
];

test('summarize totals counts and ignores unknown numbers', () => {
  assert.deepEqual(summarize(files), { count: 3, added: 15, removed: 2 });
  assert.deepEqual(summarize(undefined), { count: 0, added: 0, removed: 0 });
});

test('groupByFolder puts the root first and sorts folders', () => {
  const groups = groupByFolder(files);
  assert.deepEqual(groups.map(group => group.folder), ['', 'src', 'src/ui']);
  assert.equal(groups[0].files[0].name, 'README.md');
  assert.equal(groups[1].files[0].name, 'a.js');
});

test('parseDiffLines classifies meta, hunk, add, del and context', () => {
  const text = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n--- not meta\n\\ No newline at end of file\n';
  assert.deepEqual(parseDiffLines(text).map(line => line.kind), ['meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add', 'del', 'meta']);
  assert.equal(parseDiffLines(text)[6].text, 'new');
  assert.deepEqual(parseDiffLines(''), []);
});

test('sameFiles detects stable lists', () => {
  assert.equal(sameFiles(files, files.map(file => ({ ...file }))), true);
  assert.equal(sameFiles(files, files.map((file, i) => i ? file : { ...file, added: 11 })), false);
});
