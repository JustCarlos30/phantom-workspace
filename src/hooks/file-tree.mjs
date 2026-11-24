// Pure model of the folder explorer: a tree of a worktree's files annotated
// with what changed, plus the flat list of rows that are actually visible.

const letterOf = status => { const code = String(status || 'M')[0].toUpperCase(); return code === '?' ? 'A' : code; };
const order = (a, b) => a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name);

// files: string[] (repo.files); changes: [{ path, status }] (repo.changes).
// Dir nodes carry `changed`: how many changed files they contain (descendants).
// File nodes carry `status` when changed (and changed: 1).
export function buildFileTree(files = [], changes = []) {
  const byPath = new Map();
  for (const change of changes) if (change?.path) byPath.set(change.path, letterOf(change.status));
  const root = { name: '', path: '', type: 'dir', children: [], changed: 0 };
  const dirs = new Map([['', root]]);
  const dirOf = dir => {
    if (dirs.has(dir)) return dirs.get(dir);
    const cut = dir.lastIndexOf('/'), parent = dirOf(cut < 0 ? '' : dir.slice(0, cut));
    const node = { name: dir.slice(cut + 1), path: dir, type: 'dir', children: [], changed: 0 };
    parent.children.push(node); dirs.set(dir, node);
    return node;
  };
  const seen = new Set();
  for (const file of [...files, ...byPath.keys()]) {
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const cut = file.lastIndexOf('/'), status = byPath.get(file);
    const node = { name: file.slice(cut + 1), path: file, type: 'file', children: [], changed: status ? 1 : 0, ...(status ? { status } : {}) };
    dirOf(cut < 0 ? '' : file.slice(0, cut)).children.push(node);
  }
  const finish = node => {
    if (node.type === 'file') return node.changed;
    node.children.sort(order);
    node.changed = node.children.reduce((sum, child) => sum + finish(child), 0);
    return node.changed;
  };
  finish(root);
  return root;
}

// A copy of the tree keeping only changed files and the folders leading to them.
export function pruneToChanged(tree) {
  if (tree.type === 'file') return tree.changed ? tree : null;
  const children = tree.children.map(pruneToChanged).filter(Boolean);
  return children.length || (tree.path === '' && !tree.changed) ? { ...tree, children } : null;
}

// Rows to paint, in order: the root's children, descending only into expanded
// folders. Collapsed folders cost nothing, however large.
export function visibleRows(tree, expanded = new Set()) {
  const rows = [];
  const walk = (node, depth) => {
    for (const child of node.children) {
      const open = child.type === 'dir' && expanded.has(child.path);
      rows.push({ node: child, depth, expanded: open });
      if (open) walk(child, depth + 1);
    }
  };
  if (tree) walk(tree, 0);
  return rows;
}
