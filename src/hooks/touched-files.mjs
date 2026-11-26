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
  let oldLine = null, newLine = null, hunkIndex = -1;
  return lines.map(line => {
    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      hunkIndex++;
      oldLine = match ? Number(match[1]) : null;
      newLine = match ? Number(match[2]) : null;
      return { kind: 'hunk', text: line, oldLine: null, newLine: null, hunkIndex };
    }
    if (line.startsWith('diff --git')) { oldLine = newLine = null; return { kind: 'meta', text: line }; }
    if (line.startsWith('\\')) return { kind: 'meta', text: line };
    if (oldLine === null || newLine === null) return { kind: 'meta', text: line };
    if (line[0] === '+') return { kind: 'add', text: line.slice(1), oldLine: null, newLine: newLine++, hunkIndex };
    if (line[0] === '-') return { kind: 'del', text: line.slice(1), oldLine: oldLine++, newLine: null, hunkIndex };
    return { kind: 'ctx', text: line.slice(1), oldLine: oldLine++, newLine: newLine++, hunkIndex };
  });
}

// Side panel placement next to the session card: right outside, else left outside, else overlaid on the viewport's right.
export function placePanel(card, viewport, { margin = 12, maxWidth = 760, minWidth = 360, minHeight = 320 } = {}) {
  const vw = viewport.width, vh = viewport.height;
  const height = Math.min(Math.max(card.height, minHeight), Math.max(120, vh - margin * 2));
  const top = Math.max(margin, Math.min(card.top, vh - margin - height));
  const right = vw - card.right - margin, left = card.left - margin;
  if (right >= minWidth) return { side: 'right', left: card.right, top, width: Math.min(maxWidth, right), height };
  if (left >= minWidth) { const width = Math.min(maxWidth, left); return { side: 'left', left: card.left - width, top, width, height }; }
  const width = Math.max(1, Math.min(maxWidth, vw - margin * 2));
  return { side: 'overlay', left: Math.max(margin, vw - margin - width), top, width, height };
}

// Path to select after the list changed: keeps the current one, else the file now at its old position (or the last).
export function nextSelection(files, current, previous) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return null;
  if (list.some(file => file.path === current)) return current;
  const index = Array.isArray(previous) ? previous.findIndex(file => file.path === current) : -1;
  return list[Math.min(Math.max(index, 0), list.length - 1)].path;
}

// Keeps the previous array when the list did not change, so React does not re-render.
export function sameFiles(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((file, i) => { const other = b[i]; return file.path === other.path && file.originalPath === other.originalPath && file.status === other.status && file.added === other.added && file.removed === other.removed && file.uncommitted === other.uncommitted; });
}
