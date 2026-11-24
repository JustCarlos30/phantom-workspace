// Pure helpers for the live "touched files" badge on terminal and chat cards.

export function summarize(files) {
  const list = Array.isArray(files) ? files : [];
  let added = 0, removed = 0;
  for (const file of list) {
    if (Number.isFinite(file?.added)) added += file.added;
    if (Number.isFinite(file?.removed)) removed += file.removed;
  }
  return { count: list.length, added, removed };
}

// Folders sorted by name, root ('') first; files keep their order within each.
export function groupByFolder(files) {
  const groups = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const slash = file.path.lastIndexOf('/');
    const folder = slash < 0 ? '' : file.path.slice(0, slash);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push({ ...file, name: file.path.slice(slash + 1) });
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([folder, items]) => ({ folder, files: items }));
}

export function parseDiffLines(text) {
  if (typeof text !== 'string' || !text) return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let inHunk = false;
  return lines.map(line => {
    if (line.startsWith('@@')) { inHunk = true; return { kind: 'hunk', text: line }; }
    if (line.startsWith('diff --git')) { inHunk = false; return { kind: 'meta', text: line }; }
    if (line.startsWith('\\')) return { kind: 'meta', text: line };
    if (!inHunk) return { kind: 'meta', text: line };
    if (line[0] === '+') return { kind: 'add', text: line.slice(1) };
    if (line[0] === '-') return { kind: 'del', text: line.slice(1) };
    return { kind: 'ctx', text: line.slice(1) };
  });
}

// Keeps the previous array when the list did not change, so React does not re-render.
export function sameFiles(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((file, i) => { const other = b[i]; return file.path === other.path && file.status === other.status && file.added === other.added && file.removed === other.removed && file.uncommitted === other.uncommitted; });
}
