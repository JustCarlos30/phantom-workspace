// Pure model for the Repositorio panel (shared by renderer and node tests).
// Lays commits out on lanes the way Git clients draw history, and parses
// unified diffs into rows. Git facts come from the host.

// commits: newest first, topological order, each { oid, parents }.
// Each row gets: col (its lane), top (lanes entering from above as [from, to]),
// bottom (lanes leaving below as [from, to]) and width (lanes used).
export function layoutGraph(commits) {
  const lanes = [], rows = [];
  const free = () => { const index = lanes.indexOf(null); return index === -1 ? lanes.length : index; };
  for (const commit of commits) {
    const before = lanes.slice();
    let col = lanes.indexOf(commit.oid);
    const tip = col === -1;
    if (tip) col = free();
    lanes[col] = commit.oid;
    const top = [];
    before.forEach((oid, index) => {
      if (oid === null || oid === undefined) return;
      if (oid === commit.oid) { top.push([index, col]); if (index !== col) lanes[index] = null; }
      else top.push([index, index]);
    });
    // First parent continues this lane; others reuse a lane already waiting for them or open one.
    const [first, ...rest] = commit.parents;
    const bottom = [];
    if (first !== undefined) {
      const waiting = lanes.findIndex((oid, index) => oid === first && index !== col);
      if (waiting !== -1) {
        // Two lanes reach the same parent: keep the leftmost so the main line stays put.
        const target = Math.min(col, waiting), other = Math.max(col, waiting);
        lanes[target] = first; lanes[other] = null;
        bottom.push([col, target]);
        if (other === waiting) bottom.push([waiting, target]);
      }
      else { lanes[col] = first; bottom.push([col, col]); }
    } else lanes[col] = null;
    for (const parent of rest) {
      let index = lanes.indexOf(parent);
      if (index === -1) { index = free(); lanes[index] = parent; }
      bottom.push([col, index]);
    }
    lanes.forEach((oid, index) => { if (oid && index !== col && before[index] === oid && oid !== commit.oid) bottom.push([index, index]); });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ oid: commit.oid, col, tip, top, bottom, merge: commit.parents.length > 1, width: Math.max(before.length, lanes.length, col + 1) });
  }
  return rows;
}

// Refs as printed by %D: "HEAD -> main, origin/main, tag: v1".
export function parseRefs(refs = []) {
  const out = [];
  for (const ref of refs) {
    if (ref.startsWith('HEAD -> ')) { out.push({ kind: 'head', name: ref.slice(8) }); continue; }
    if (ref === 'HEAD') { out.push({ kind: 'detached', name: 'HEAD' }); continue; }
    if (ref.startsWith('tag: ')) { out.push({ kind: 'tag', name: ref.slice(5) }); continue; }
    out.push({ kind: ref.includes('/') && /^[^/]+\/.+/.test(ref) && !ref.startsWith('phantom/') ? 'remote' : 'branch', name: ref });
  }
  return out;
}

// Unified diff -> rows { kind: 'meta'|'hunk'|'add'|'del'|'ctx'|'note', text, old, new }.
export function parseDiff(textValue = '') {
  const rows = []; let oldLine = 0, newLine = 0, inHunk = false;
  for (const line of textValue.split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') && !inHunk || line.startsWith('+++ ') && !inHunk || /^(new|deleted) file mode|^similarity index|^rename (from|to)|^old mode|^new mode/.test(line)) {
      if (line.startsWith('diff --git')) inHunk = false;
      rows.push({ kind: 'meta', text: line }); continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; rows.push({ kind: 'hunk', text: line }); continue; }
    if (!inHunk) { if (line) rows.push({ kind: 'meta', text: line }); continue; }
    if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1), new: newLine++ });
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line.slice(1), old: oldLine++ });
    else if (line.startsWith('\\')) rows.push({ kind: 'note', text: line.slice(2) });
    else if (line.startsWith(' ')) rows.push({ kind: 'ctx', text: line.slice(1), old: oldLine++, new: newLine++ });
  }
  while (rows.length && rows[rows.length - 1].kind === 'meta' && !rows[rows.length - 1].text) rows.pop();
  return rows;
}

export const diffStats = rows => rows.reduce((sum, row) => ({ added: sum.added + (row.kind === 'add'), removed: sum.removed + (row.kind === 'del') }), { added: 0, removed: 0 });

export function relativeTime(value, now = Date.now()) {
  const at = Date.parse(value);
  if (Number.isNaN(at)) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'ahora';
  const minutes = Math.round(seconds / 60); if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60); if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24); if (days < 30) return `hace ${days} d`;
  return new Date(at).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}
