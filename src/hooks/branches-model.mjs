// Pure model for the Ramas panel (shared by renderer and node tests).
// Git facts come from the host; this only names, groups and orders them.
export const shortBranch = name => name ? name.replace(/^phantom\/terminal-([0-9a-f]{8})[0-9a-f-]*$/, 'terminal $1') : 'HEAD separado';
export const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
export const filesText = count => plural(count, 'archivo', 'archivos');
export const commitsText = count => plural(count, 'commit', 'commits');

export const GROUPS = [
  { id: 'dirty', title: 'Con cambios sin guardar', hint: 'Archivos editados en su worktree que no están en ningún commit. Solo existen en esa carpeta.' },
  { id: 'ready', title: 'Con commits por integrar', hint: 'Trabajo guardado en la rama que todavía no está en la rama de integración.' },
  { id: 'clean', title: 'Sin trabajo pendiente', hint: 'Todo lo que tenían ya está en la rama de integración.' },
];

const CHANGE = { M: 'Modificado', A: 'Añadido', D: 'Borrado', R: 'Renombrado', C: 'Copiado', T: 'Tipo cambiado', U: 'En conflicto', '?': 'Nuevo' };
export const changeCode = status => /U/.test(status || '') || ['AA', 'DD'].includes(status) ? 'U' : (status || '').replace(/ /g, '')[0] || '?';
export const changeLabel = status => CHANGE[changeCode(status)] || 'Cambiado';
export const changeTone = status => { const code = changeCode(status); return code === 'D' ? 'removed' : code === '?' || code === 'A' ? 'added' : code === 'U' ? 'conflict' : 'modified'; };

// Where a row sits on the rail: commits it lacks to the left, its own work to the right.
// Logarithmic so 1 and 40 commits are both readable.
export const span = count => count > 0 ? Math.round(Math.min(96, 16 + 18 * Math.log2(1 + count))) : 0;

export function describeBranch(row, base) {
  const title = row.terminal?.title || shortBranch(row.name);
  const group = row.isBase ? 'base' : row.work === 'dirty' ? 'dirty' : row.work === 'ready' ? 'ready' : 'clean';
  const exists = Boolean(row.worktree?.exists), owned = Boolean(row.terminal), running = Boolean(row.terminal?.running);
  const conflicts = row.conflicts?.length ? row.conflicts : [];
  const parts = [];
  const inBase = row.inBase || 0;
  if (row.changeCount) parts.push(`${filesText(row.changeCount)} sin guardar${inBase ? inBase === row.changeCount ? ` (todos ya idénticos en ${base})` : ` (${inBase} ya idénticos en ${base})` : ''}`);
  if (row.ahead) parts.push(`${commitsText(row.ahead)} por integrar`);
  if (row.behind) parts.push(`${commitsText(row.behind)} detrás de ${base}`);
  if (!parts.length && !row.isBase) parts.push(`Al día con ${base}`);
  const where = !row.worktree ? 'Sin worktree' : !exists ? 'Worktree borrado del disco' : row.worktree.main ? 'Checkout del proyecto' : owned ? (running ? 'Terminal con sesión activa' : 'Terminal del canvas') : 'Sin terminal en el canvas';
  return {
    ...row, inBase, pendingCount: row.changeCount - inBase, changes: [...row.changes].sort((a, b) => Number(Boolean(a.inBase)) - Number(Boolean(b.inBase))),
    id: row.name || `detached:${row.worktree?.path}`, title, group, exists, owned, running, conflicts, summary: parts.join(' · '), where,
    // Each action is offered only when the host would accept it.
    can: {
      commit: exists && row.changeCount > 0 && !row.detached,
      integrate: !row.isBase && !row.detached && row.ahead > 0 && !conflicts.length,
      update: !row.isBase && !row.detached && exists && row.behind > 0 && !(row.ahead && row.changeCount) && !conflicts.length,
      remove: !row.isBase && !row.detached && !row.worktree?.main && !owned && row.work === 'none' && !row.worktree?.locked,
    },
  };
}

export function buildBranches(data, { query = '', content, cards = [] } = {}) {
  const base = data?.base?.branch || '';
  const text = query.trim().toLowerCase();
  const all = (data?.branches || []).map(row => describeBranch(row, base));
  const baseRow = all.find(row => row.isBase) || null;
  const rows = all.filter(row => !row.isBase);
  const visible = rows.filter(row => !text || `${row.title}\n${row.name || ''}\n${cardsOf(row, content?.get(row.name || row.worktree?.path), cards).map(card => `${card.id} ${card.title}`).join('\n')}\n${row.worktree?.path || ''}\n${row.changes.map(change => change.path).join('\n')}\n${row.committed.join('\n')}`.toLowerCase().includes(text));
  const time = row => Date.parse(row.last?.at) || 0;
  const groups = GROUPS.map(group => ({ ...group, rows: visible.filter(row => row.group === group.id).sort((a, b) => (b.pendingCount + b.ahead) - (a.pendingCount + a.ahead) || time(b) - time(a)) }));
  const counts = Object.fromEntries(GROUPS.map(group => [group.id, rows.filter(row => row.group === group.id).length]));
  return {
    base, baseRow, groups, counts, total: rows.length, visible: visible.length,
    unsaved: rows.reduce((sum, row) => sum + row.changeCount, 0), unsavedInBase: rows.reduce((sum, row) => sum + row.inBase, 0), pending: rows.reduce((sum, row) => sum + row.ahead, 0),
    removable: rows.filter(row => row.can.remove), updatable: rows.filter(row => row.can.update && row.work === 'none'),
  };
}

// How a set of changes splits by kind, in a fixed order for the stacked bar.
export const MIX = [
  { id: 'added', label: 'Nuevos' }, { id: 'modified', label: 'Modificados' },
  { id: 'removed', label: 'Borrados' }, { id: 'conflict', label: 'En conflicto' },
];
export function changeMix(changes = []) {
  const counts = { added: 0, modified: 0, removed: 0, conflict: 0 };
  for (const change of changes) counts[changeTone(change.status)]++;
  return MIX.map(kind => ({ ...kind, count: counts[kind.id] })).filter(kind => kind.count);
}

// Files grouped by their folder, folders in path order, files by name. Root is ''.
export function groupByDir(items = [], pathOf = item => item.path) {
  const groups = new Map();
  for (const item of items) {
    const file = pathOf(item), dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))
    .map(([dir, list]) => ({ dir, items: list.sort((a, b) => pathOf(a).localeCompare(pathOf(b))) }));
}

// The Cards a worktree belongs to: the one bound to its terminal first, then any
// Card whose contract lives in that branch's checkout. Deduplicated by ID.
export function cardsOf(row, content, catalog = []) {
  const list = [], seen = new Set();
  const bound = row?.terminal?.cardId;
  if (bound) {
    const known = catalog.find(card => card.id === bound) || content?.cards?.find(card => card.id === bound);
    list.push({ id: bound, title: known?.title || row.terminal.cardTitle || bound, status: known?.status, bound: true });
    seen.add(bound);
  }
  for (const card of content?.cards || []) if (!seen.has(card.id)) { seen.add(card.id); list.push({ id: card.id, title: card.title, status: card.status, bound: false }); }
  return list;
}

// Cards and Skills that live in a branch's worktree, for the per-branch chips.
export function contentByBranch({ cards = [], skills = [], baseBranch } = {}) {
  const map = new Map();
  const slot = branch => { if (!map.has(branch)) map.set(branch, { cards: [], skills: [] }); return map.get(branch); };
  for (const card of cards) {
    const location = card.location;
    const key = location?.main ? baseBranch : location?.branch || location?.path;
    if (key) slot(key).cards.push(card);
  }
  for (const skill of skills) if (skill.origin === 'worktree' && skill.branch) slot(skill.branch).skills.push(skill);
  return map;
}

// Cards panel: the checkouts cards live in, most used first, with a readable name.
export function cardLocations(items = [], nodes = []) {
  const found = new Map();
  for (const item of items) {
    const location = item.location; if (!location) continue;
    const key = location.main ? 'main' : location.branch || location.path;
    const owner = nodes.find(node => node.type === 'terminal' && location.branch && node.data?.worktree?.branch === location.branch);
    const entry = found.get(key) || { key, main: Boolean(location.main), branch: location.branch, label: location.main ? 'Proyecto' : owner?.title || shortBranch(location.branch), count: 0 };
    entry.count++; found.set(key, entry);
  }
  return [...found.values()].sort((a, b) => Number(b.main) - Number(a.main) || b.count - a.count);
}
export const locationKey = item => item?.location ? item.location.main ? 'main' : item.location.branch || item.location.path : '';
