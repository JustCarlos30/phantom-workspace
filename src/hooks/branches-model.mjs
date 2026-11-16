// Pure model for the Ramas panel (shared by renderer and node tests).
// Git facts come from the host; this names each branch, gives it ONE state,
// one line of detail and at most one action, and orders the list.
export const branchTitle = name => {
  if (!name) return 'Sin rama';
  const session = /^phantom\/terminal-([0-9a-f]{8})[0-9a-f-]*$/.exec(name);
  return session ? `Sesión cerrada · ${session[1]}` : name;
};
// Kept under its old name for the modules that already import it.
export const shortBranch = branchTitle;
export const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
export const filesText = count => plural(count, 'archivo', 'archivos');
export const commitsText = count => plural(count, 'commit', 'commits');

// The seven states a branch can be in, in the order the list shows them.
export const BRANCH_STATES = {
  conflict: { label: 'Conflicto', tone: 'danger', order: 0 },
  ready: { label: 'Lista', tone: 'success', order: 1 },
  merging: { label: 'Integrando', tone: 'working', order: 2 },
  queued: { label: 'En cola', tone: 'neutral', order: 3 },
  unsaved: { label: 'Sin guardar', tone: 'attention', order: 4 },
  working: { label: 'Trabajando', tone: 'working', order: 5 },
  merged: { label: 'En main', tone: 'neutral', order: 6 },
};
export const stateLabel = (state, base = 'main') => state === 'merged' ? `En ${base || 'main'}` : BRANCH_STATES[state]?.label || '';
// One group now; the name stays exported for older importers.
export const GROUPS = [{ id: 'sessions', title: 'Ramas de tus sesiones' }];

const CHANGE = { M: 'Modificado', A: 'Añadido', D: 'Borrado', R: 'Renombrado', C: 'Copiado', T: 'Tipo cambiado', U: 'En conflicto', '?': 'Nuevo' };
export const changeCode = status => /U/.test(status || '') || ['AA', 'DD'].includes(status) ? 'U' : (status || '').replace(/ /g, '')[0] || '?';
export const changeLabel = status => CHANGE[changeCode(status)] || 'Cambiado';
export const changeTone = status => { const code = changeCode(status); return code === 'D' ? 'removed' : code === '?' || code === 'A' ? 'added' : code === 'U' ? 'conflict' : 'modified'; };

// Width of a count on a rail, logarithmic so 1 and 40 are both readable.
export const span = count => count > 0 ? Math.round(Math.min(96, 16 + 18 * Math.log2(1 + count))) : 0;

const baseName = file => String(file).split('/').pop();
const clash = (files, base) => `${baseName(files[0])}${files.length > 1 ? ` y ${files.length - 1} más` : ''} ${files.length > 1 ? 'chocan' : 'choca'} con ${base}`;

// The single state of a branch, with its line of detail and its one action.
// Pure: the same host row always reads the same way.
export function branchState(row, base = 'main') {
  const changeCount = row.changeCount || 0, ahead = row.ahead || 0;
  const conflicts = row.conflicts?.length ? row.conflicts : [];
  const owned = Boolean(row.terminal), agentWorking = row.terminal?.status === 'working';
  const fileCount = row.committedCount ?? row.committed?.length ?? 0;
  const work = [ahead && commitsText(ahead), fileCount && filesText(fileCount)].filter(Boolean).join(' · ');
  let state, detail, action = null;
  if (row.isBase) {
    state = changeCount ? 'unsaved' : 'merged';
    detail = changeCount ? `${filesText(changeCount)} sin guardar${changeCount === 1 && row.changes?.[0]?.path ? ` · ${baseName(row.changes[0].path)}` : ''}` : 'Al día';
    action = changeCount ? 'save' : null;
  } else if (row.request === 'merging') { state = 'merging'; detail = 'El orquestador la está integrando'; }
  else if (row.request === 'conflict' || row.request === 'failed' || conflicts.length) {
    state = 'conflict'; action = owned ? 'session' : null;
    detail = conflicts.length ? clash(conflicts, base) : row.request === 'failed' ? 'Los tests fallaron al integrar' : `Choca con ${base}`;
  } else if (row.request === 'queued') { state = 'queued'; detail = 'Espera su turno en la cola'; }
  else if (changeCount) {
    state = agentWorking ? 'working' : 'unsaved'; action = agentWorking ? null : 'save';
    detail = `${filesText(changeCount)} sin guardar`;
  } else if (ahead) {
    state = agentWorking ? 'working' : 'ready'; action = agentWorking ? null : 'integrate';
    detail = work;
  } else if (agentWorking) { state = 'working'; detail = row.terminal.step || 'Sin cambios todavía'; }
  else {
    state = 'merged'; action = owned ? null : 'remove';
    detail = owned ? 'Sin cambios propios' : `Ya está en ${base} · sesión cerrada`;
  }
  if (row.error) detail = 'Git no pudo leer esta rama';
  else if (row.worktree && !row.worktree.exists && !row.isBase) detail = `${detail} · su carpeta ya no existe`;
  const meta = BRANCH_STATES[state];
  return { state, stateLabel: stateLabel(state, base), tone: meta.tone, order: meta.order, detail, action };
}

// The road to the base in a few steps, drawn the same way for every branch:
// Guardada → Al día → Tests → En main. Tests only appears when the project has them.
export function branchPath(row, { base = 'main', checks = '' } = {}) {
  const state = row.state || branchState(row, base).state;
  const landed = state === 'merged' && !row.isBase, conflicts = row.conflicts?.length > 0 || row.request === 'conflict';
  const ids = ['saved', 'current', ...(checks ? ['tests'] : []), 'landed'];
  const labels = { saved: 'Guardada', current: 'Al día', tests: 'Tests', landed: `En ${base}` };
  const done = new Set();
  if (landed) ids.forEach(id => done.add(id));
  else {
    if (!row.changeCount && row.ahead > 0) done.add('saved');
    if (done.has('saved') && !row.behind && !conflicts) done.add('current');
  }
  const failed = landed ? null : conflicts ? 'current' : row.request === 'failed' ? (checks ? 'tests' : 'landed') : null;
  if (failed === 'tests' || failed === 'landed') { done.add('saved'); done.add('current'); }
  let current = false;
  const steps = ids.map(id => {
    const step = failed === id ? 'fail' : done.has(id) ? 'done' : !failed && !current ? 'now' : 'todo';
    if (step === 'now') current = true;
    return { id, label: labels[id], state: step };
  });
  return { steps, missing: [], notes: [], owner: 'none', done: steps.filter(step => step.state === 'done').length, total: steps.length };
}

export function describeBranch(row, base) {
  const title = row.terminal?.title || branchTitle(row.name);
  const exists = Boolean(row.worktree?.exists), owned = Boolean(row.terminal), running = Boolean(row.terminal?.running);
  const conflicts = row.conflicts?.length ? row.conflicts : [];
  const inBase = row.inBase || 0, changeCount = row.changeCount || 0;
  const changes = [...(row.changes || [])].sort((a, b) => Number(Boolean(a.inBase)) - Number(Boolean(b.inBase)));
  const committed = row.committed || [];
  const status = branchState({ ...row, changeCount, changes }, base);
  // Each action is offered only when the host would accept it.
  const can = {
    commit: exists && changeCount > 0 && !row.detached,
    integrate: !row.isBase && !row.detached && row.ahead > 0 && !conflicts.length,
    update: !row.isBase && !row.detached && exists && row.behind > 0 && !(row.ahead && changeCount) && !conflicts.length,
    remove: !row.isBase && !row.detached && !row.worktree?.main && !owned && row.work === 'none' && !row.worktree?.locked,
  };
  const allowed = { save: can.commit, integrate: can.integrate, session: owned, remove: can.remove };
  return {
    ...row, changeCount, inBase, pendingCount: changeCount - inBase, changes, committed, committedCount: row.committedCount ?? committed.length,
    id: row.name || `detached:${row.worktree?.path}`, title, group: row.isBase ? 'base' : 'sessions', exists, owned, running, conflicts,
    ...status, action: allowed[status.action] ? status.action : null, summary: status.detail, can,
  };
}

export function buildBranches(data, { query = '', filter = '', content, cards = [] } = {}) {
  const base = data?.base?.branch || '';
  const text = query.trim().toLowerCase();
  const all = (data?.branches || []).map(row => describeBranch(row, base || 'main'));
  const baseRow = all.find(row => row.isBase) || null;
  const time = row => Date.parse(row.last?.at) || 0;
  const rows = all.filter(row => !row.isBase).sort((a, b) => a.order - b.order || (b.pendingCount + b.ahead) - (a.pendingCount + a.ahead) || time(b) - time(a));
  const visible = rows.filter(row => !text || `${row.title}\n${row.name || ''}\n${row.stateLabel}\n${cardsOf(row, content?.get(row.name || row.worktree?.path), cards).map(card => `${card.id} ${card.title}`).join('\n')}\n${row.worktree?.path || ''}\n${row.changes.map(change => change.path).join('\n')}\n${row.committed.join('\n')}`.toLowerCase().includes(text));
  const filtered = visible.filter(row => !filter || row.state === filter);
  const filters = Object.keys(BRANCH_STATES).map(id => ({ id, label: stateLabel(id, base), count: visible.filter(row => row.state === id).length })).filter(item => item.count);
  const sessions = rows.every(row => row.owned || /^phantom\/terminal-/.test(row.name || ''));
  const counts = Object.fromEntries(Object.keys(BRANCH_STATES).map(state => [state, rows.filter(row => row.state === state).length]));
  return {
    base, baseRow, rows: filtered, counts, total: rows.length, visible: filtered.length,
    filters, matched: visible.length, active: filtered.filter(row => row.state !== 'merged'), landed: filtered.filter(row => row.state === 'merged'),
    title: `${plural(rows.length, 'rama', 'ramas')}${sessions ? ' de tus sesiones' : ''}`,
    // One ordered list; `groups` stays for the callers that flatten it.
    groups: [{ id: 'sessions', title: `${plural(rows.length, 'rama', 'ramas')}${sessions ? ' de tus sesiones' : ''}`, rows: filtered }],
    unsaved: rows.reduce((sum, row) => sum + row.changeCount, 0), unsavedInBase: rows.reduce((sum, row) => sum + row.inBase, 0), pending: rows.reduce((sum, row) => sum + row.ahead, 0),
    removable: rows.filter(row => row.can.remove), updatable: rows.filter(row => row.can.update && row.work === 'none'),
  };
}

// How a set of changes splits by kind, in a fixed order for the stacked bar.
export const MIX = [
  { id: 'added', label: 'Nuevos' }, { id: 'modified', label: 'Modificados' },
  { id: 'renamed', label: 'Renombrados' }, { id: 'copied', label: 'Copiados' },
  { id: 'type', label: 'Tipo cambiado' },
  { id: 'removed', label: 'Borrados' }, { id: 'conflict', label: 'En conflicto' },
];
export function changeMix(changes = [], summary) {
  const counts = Object.fromEntries(MIX.map(kind => [kind.id, 0]));
  const entries = summary ? Object.entries(summary) : changes.map(change => [change.status, 1]);
  for (const [status, count] of entries) {
    const code = changeCode(status);
    const kind = ({ R: 'renamed', C: 'copied', T: 'type' })[code] || changeTone(status);
    counts[kind] += count;
  }
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
