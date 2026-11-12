import test from 'node:test';
import assert from 'node:assert/strict';
import { asJson, clean, diffLines, numberedLines, searchResults } from '../src/components/tool-output.mjs';
import { toolChange } from '../host/chats.mjs';

test('edits keep their before/after text, bounded, for the diff view', () => {
  assert.deepEqual(toolChange('Edit', { old_string: 'a', new_string: 'b' }), { before: 'a', after: 'b' });
  assert.deepEqual(toolChange('Write', { content: 'x\ny' }), { before: '', after: 'x\ny' });
  assert.equal(toolChange('Read', { file_path: 'x' }), undefined);
  assert.equal(toolChange('Edit', { old_string: 'a', new_string: 'b'.repeat(9000) }).after.length, 6000);
});

test('diffLines keeps shared lines and marks additions and removals', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nB\nc'), [{ op: ' ', text: 'a' }, { op: '-', text: 'b' }, { op: '+', text: 'B' }, { op: ' ', text: 'c' }]);
  assert.deepEqual(diffLines('', 'x'), [{ op: '+', text: 'x' }]);
});

test('numbered reads are split into gutter and code', () => {
  assert.deepEqual(numberedLines('     1→const a = 1;\n     2→'), [{ n: '1', text: 'const a = 1;' }, { n: '2', text: '' }]);
  assert.deepEqual(numberedLines('    10\tx'), [{ n: '10', text: 'x' }]);
  assert.equal(numberedLines('plain text\nmore'), null);
});

test('search output becomes files or grouped matches', () => {
  assert.deepEqual(searchResults('src/a.js\nsrc/b/c.css'), { kind: 'files', files: ['src/a.js', 'src/b/c.css'] });
  assert.deepEqual(searchResults('src/a.js:3:foo\nsrc/a.js:9:bar\nb.md:1:baz'), { kind: 'matches', files: [{ path: 'src/a.js', hits: [{ n: '3', text: 'foo' }, { n: '9', text: 'bar' }] }, { path: 'b.md', hits: [{ n: '1', text: 'baz' }] }] });
  assert.deepEqual(searchResults('Found 1 file\nsrc/a.js'), { kind: 'files', files: ['src/a.js'] });
  assert.equal(searchResults('No files found'), null);
});

test('reminders are stripped and JSON is pretty printed', () => {
  assert.equal(clean('ok\n<system-reminder>hidden</system-reminder>\n'), 'ok');
  assert.equal(asJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(asJson('{nope'), null);
});
