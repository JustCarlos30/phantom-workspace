import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, groupByFolder, parseDiffLines, sameFiles, placePanel, nextSelection } from '../src/hooks/touched-files.mjs';

test('placePanel sits right of the card when there is room', () => {
  const p = placePanel({ left: 100, top: 50, right: 500, height: 600 }, { width: 1600, height: 900 });
  assert.deepEqual(p, { side: 'right', left: 500, top: 50, width: 760, height: 600 });
});

test('placePanel goes left when the right side is too narrow', () => {
  const p = placePanel({ left: 900, top: 50, right: 1300, height: 600 }, { width: 1400, height: 900 });
  assert.equal(p.side, 'left');
  assert.equal(p.left + p.width, 900);
  assert.equal(p.width, 760);
});

test('placePanel overlays inside a narrow viewport and never leaves it', () => {
  const p = placePanel({ left: 20, top: 700, right: 400, height: 600 }, { width: 500, height: 800 });
  assert.equal(p.side, 'overlay');
  assert.ok(p.left >= 12 && p.left + p.width <= 488);
  assert.ok(p.top >= 12 && p.top + p.height <= 788);
});

test('nextSelection keeps, advances or empties', () => {
  const a = [{ path: 'a' }, { path: 'b' }, { path: 'c' }];
  assert.equal(nextSelection(a, 'b', a), 'b');
  assert.equal(nextSelection([a[0], a[2]], 'b', a), 'c');
  assert.equal(nextSelection([a[0], a[1]], 'c', a), 'b');
  assert.equal(nextSelection([], 'a', a), null);
});

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

test('parseDiffLines tracks old and new line numbers across edits and hunks', () => {
  const parsed = parseDiffLines('@@ -4,2 +8,3 @@\n same\n-old\n+new\n+next\n@@ -20 +22 @@\n-last\n+latest');
  assert.deepEqual(parsed.slice(1, 5).map(({ kind, oldLine, newLine, hunkIndex }) => ({ kind, oldLine, newLine, hunkIndex })), [
    { kind: 'ctx', oldLine: 4, newLine: 8, hunkIndex: 0 },
    { kind: 'del', oldLine: 5, newLine: null, hunkIndex: 0 },
    { kind: 'add', oldLine: null, newLine: 9, hunkIndex: 0 },
    { kind: 'add', oldLine: null, newLine: 10, hunkIndex: 0 },
  ]);
  assert.deepEqual(parsed.slice(6).map(({ oldLine, newLine, hunkIndex }) => ({ oldLine, newLine, hunkIndex })), [
    { oldLine: 20, newLine: null, hunkIndex: 1 },
    { oldLine: null, newLine: 22, hunkIndex: 1 },
  ]);
});

test('parseDiffLines marks malformed hunk bodies as metadata without inventing line numbers', () => {
  const parsed = parseDiffLines('@@ malformed @@\n text\n@@ -1 +1 @@\n+valid');
  assert.equal(parsed[1].kind, 'meta');
  assert.deepEqual(parsed[3], { kind: 'add', text: 'valid', oldLine: null, newLine: 1, hunkIndex: 1 });
});

test('parseDiffLines honors zero-start hunks for additions to an empty file', () => {
  const parsed = parseDiffLines('@@ -0,0 +1,2 @@\n+first\n+second');
  assert.deepEqual(parsed.slice(1).map(({ kind, oldLine, newLine, hunkIndex }) => ({ kind, oldLine, newLine, hunkIndex })), [
    { kind: 'add', oldLine: null, newLine: 1, hunkIndex: 0 },
    { kind: 'add', oldLine: null, newLine: 2, hunkIndex: 0 },
  ]);
});

test('sameFiles detects stable lists', () => {
  assert.equal(sameFiles(files, files.map(file => ({ ...file }))), true);
  assert.equal(sameFiles(files, files.map((file, i) => i ? file : { ...file, added: 11 })), false);
  assert.equal(sameFiles([{ ...files[0], originalPath: 'src/old.js' }], [{ ...files[0], originalPath: 'src/older.js' }]), false);
});
