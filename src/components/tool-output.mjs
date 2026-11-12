// Pure parsing for the tool output viewer (ToolOutput.jsx).

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
export const clean = text => String(text || '').replace(REMINDER, '').replace(/\s+$/, '');
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const basename = path => String(path).split(/[\\/]/).filter(Boolean).at(-1) || path;

// Line diff by longest common subsequence; large edits fall back to
// "everything removed, everything added" to stay cheap.
export function diffLines(before, after) {
  const a = before ? before.split('\n') : [], b = after ? after.split('\n') : [];
  if (a.length * b.length > 160_000) return [...a.map(text => ({ op: '-', text })), ...b.map(text => ({ op: '+', text }))];
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: ' ', text: a[i] }); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) out.push({ op: '-', text: a[i++] });
    else out.push({ op: '+', text: b[j++] });
  }
  while (i < a.length) out.push({ op: '-', text: a[i++] });
  while (j < b.length) out.push({ op: '+', text: b[j++] });
  return out;
}

// "     12→text" or "    12\ttext" (cat -n), as file readers return them.
const NUMBERED = /^\s*(\d+)(?:→|\t)(.*)$/;
export function numberedLines(text) {
  const lines = text.split('\n');
  const parsed = lines.map(line => NUMBERED.exec(line));
  if (parsed.filter(Boolean).length < Math.max(1, lines.length * 0.7)) return null;
  return parsed.map((match, i) => match ? { n: match[1], text: match[2] } : { n: '', text: lines[i] });
}

// grep -n style "path:line:text", grouped by file; or a bare list of paths.
const MATCH = /^(.+?):(\d+)[:-](.*)$/;
const PATHLIKE = /^[^\s:]*[\\/.][^\s]*$/;
export function searchResults(text) {
  const lines = text.split('\n').filter(line => line.trim() && !/^Found \d+ (files?|matches?|lines?)\b/i.test(line.trim()));
  if (!lines.length) return null;
  if (lines.every(line => MATCH.test(line))) {
    const files = new Map();
    for (const line of lines) { const [, path, n, body] = MATCH.exec(line); if (!files.has(path)) files.set(path, []); files.get(path).push({ n, text: body }); }
    return { kind: 'matches', files: [...files].map(([path, hits]) => ({ path, hits })) };
  }
  if (lines.every(line => PATHLIKE.test(line.trim()))) return { kind: 'files', files: lines.map(line => line.trim()) };
  return null;
}

export const asJson = text => {
  if (!/^[[{]/.test(text.trim())) return null;
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return null; }
};
