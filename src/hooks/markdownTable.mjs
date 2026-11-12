// GitHub-flavored Markdown tables, shared by the chat and Skills readers.
// Pure functions so parsing is testable without React.

// Splits a row on unescaped pipes outside inline code: `a|b` and a\|b stay one cell.
export function splitRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells = []; let cell = '', code = 0;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\' && row[i + 1] === '|') { cell += '|'; i++; continue; }
    if (ch === '`') { let run = 1; while (row[i + run] === '`') run++; code = code === run ? 0 : code || run; cell += row.slice(i, i + run); i += run - 1; continue; }
    if (ch === '|' && !code) { cells.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
export const isTableRow = line => /\|/.test(line) && !!line.trim();

// A table starts at a row containing a pipe followed by a delimiter row with
// the same number of columns (or more, as GitHub accepts).
export function tableStartsAt(lines, i) {
  return isTableRow(lines[i] ?? '') && SEPARATOR.test(lines[i + 1] ?? '') && /-/.test(lines[i + 1]) && (lines[i + 1].includes('|') || splitRow(lines[i]).length === 1)
    && splitRow(lines[i + 1]).length === splitRow(lines[i]).length;
}

// Returns { block, next } where next is the first line after the table.
export function parseTable(lines, i) {
  const head = splitRow(lines[i]), width = head.length;
  const align = splitRow(lines[i + 1]).map(spec => spec.startsWith(':') && spec.endsWith(':') ? 'center' : spec.endsWith(':') ? 'right' : spec.startsWith(':') ? 'left' : null);
  const rows = []; let next = i + 2;
  for (; next < lines.length && isTableRow(lines[next]) && !/^\s*(```|~~~)/.test(lines[next]); next++) {
    const cells = splitRow(lines[next]).slice(0, width);
    while (cells.length < width) cells.push('');
    rows.push(cells);
  }
  return { block: { type: 'table', head, align, rows }, next };
}

const NUMERIC = /^[-+−]?[$€£¥]?\s?\d[\d,.\s]*(%|[kKmMbB]|ms|s|MB|GB|KB|x)?$/;
// Columns without explicit alignment whose filled body cells are all numbers read
// better right-aligned with tabular figures.
export function columnKinds(block) {
  return block.head.map((_, c) => {
    const values = block.rows.map(r => r[c].replace(/[*`_]/g, '').trim()).filter(Boolean);
    return values.length && values.every(v => NUMERIC.test(v)) ? 'number' : 'text';
  });
}

// Tab-separated text pastes cleanly into spreadsheets; inline Markdown marks are dropped.
export function toTSV(block) {
  const plain = cell => cell.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[\t\n]/g, ' ');
  return [block.head, ...block.rows].map(row => row.map(plain).join('\t')).join('\n');
}
