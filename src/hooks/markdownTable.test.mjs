import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRow, tableStartsAt, parseTable, columnKinds, toTSV } from './markdownTable.mjs';

test('rows split on real pipes only', () => {
  assert.deepEqual(splitRow('| a | `x|y` | b\\|c |'), ['a', '`x|y`', 'b|c']);
  assert.deepEqual(splitRow('a | b'), ['a', 'b']);
  assert.deepEqual(splitRow('| a | |'), ['a', '']);
});

test('tables need a matching delimiter row', () => {
  const lines = ['| A | B |', '|:--|--:|', '| 1 | 2 |'];
  assert.ok(tableStartsAt(lines, 0));
  assert.ok(!tableStartsAt(['| A | B |', '|---|'], 0), 'column count mismatch');
  assert.ok(!tableStartsAt(['texto | suelto', 'otra línea'], 0));
  assert.ok(!tableStartsAt(['| A | B |'], 0), 'a streaming header alone is not a table yet');
});

test('parses alignment, pads short (streaming) rows and trims long ones', () => {
  const { block, next } = parseTable(['| A | B | C |', '|:-:|--:|:--|', '| 1 | 2 |', '| x | y | z | extra |', '', 'after'], 0);
  assert.deepEqual(block.align, ['center', 'right', 'left']);
  assert.deepEqual(block.rows, [['1', '2', ''], ['x', 'y', 'z']]);
  assert.equal(next, 4);
});

test('detects numeric columns and exports TSV', () => {
  const { block } = parseTable(['| Item | Costo | % |', '|---|---|---|', '| **Uno** | $1,200 | 15% |', '| `dos` | 30 | |'], 0);
  assert.deepEqual(columnKinds(block), ['text', 'number', 'number']);
  assert.equal(toTSV(block), 'Item\tCosto\t%\nUno\t$1,200\t15%\ndos\t30\t');
});
