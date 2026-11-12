const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const kinds = {
  rule: { label: 'Norma', tone: 'rule', icon: 'ShieldCheck' },
  decision: { label: 'Decisión', tone: 'decision', icon: 'GitBranch' },
  fact: { label: 'Hecho', tone: 'fact', icon: 'BadgeCheck' },
  hypothesis: { label: 'Hipótesis', tone: 'hypothesis', icon: 'FlaskConical' },
};
export function kindMeta(kind) { return kinds[kind] || { label: 'Tipo desconocido', tone: 'unknown', icon: 'CircleHelp' }; }
export function scopeLabel(scope) { return scope === '.' ? 'Todo el proyecto' : text(scope, 'Alcance no informado') || 'Alcance no informado'; }
export function spaceLabel(space) { return space === 'project' ? 'Proyecto' : space === 'workspace' ? 'Workspace' : 'Espacio no informado'; }
export function expiryState(expiresAt, now = Date.now()) {
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) return 'none';
  const remaining = Date.parse(expiresAt) - Number(new Date(now));
  return remaining <= 0 ? 'expired' : remaining < 7 * 86400000 ? 'soon' : 'ok';
}
export function memoryView(item, now = Date.now()) {
  const outer = object(item), raw = { ...outer, ...object(outer.raw) };
  return {
    title: text(raw.title) || text(raw.key) || text(raw.id, 'Memoria sin título'), key: text(raw.key),
    kind: text(raw.kind, 'unknown'), body: text(raw.body), scope: text(raw.scope), space: text(raw.space),
    state: text(raw.state) || text(raw.status, 'unknown'), revision: Number.isSafeInteger(raw.revision) ? raw.revision : null,
    evidence: (Array.isArray(raw.evidence) ? raw.evidence : []).flatMap(entry => {
      if (typeof entry === 'string') return [{ path: entry, hash: '', observedAt: null, root: '' }];
      const e = object(entry);
      return typeof e.path === 'string' ? [{ path: e.path, hash: text(e.hash), observedAt: text(e.observedAt) || null, root: text(e.root) }] : [];
    }), expiry: { state: expiryState(raw.expiresAt, now), at: text(raw.expiresAt) || null }, updatedAt: text(raw.updatedAt) || null,
  };
}
export function revisionsOf(detail) {
  const value = object(detail);
  const entries = Array.isArray(detail) ? detail : [value.revisions, value.history, value.items, value.records, value.raw].find(Array.isArray) || [];
  return entries.flatMap(entry => {
    const e = object(entry), record = object(e.record || e.document || e.memory || e);
    if (!Object.keys(record).length || !Number.isSafeInteger(e.revision ?? record.revision)) return [];
    return [{ ...record, revision: e.revision ?? record.revision, reason: text(e.reason), at: text(e.at) || text(record.updatedAt), body: text(record.body) }];
  }).sort((a, b) => a.revision - b.revision);
}
// Bounded LCS: large documents retain every line using a linear replacement fallback.
export function lineDiff(a, b) {
  const lines = value => text(value) === '' ? [] : text(value).split('\n');
  const left = lines(a), right = lines(b), out = [];
  if (left.length * right.length > 250000) return [...left.map(text => ({ type: 'del', text })), ...right.map(text => ({ type: 'add', text }))];
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) table[i][j] = left[i] === right[j] ? 1 + table[i + 1][j + 1] : Math.max(table[i + 1][j], table[i][j + 1]);
  let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { out.push({ type: 'same', text: left[i++] }); j++; }
    else if (i < left.length && (j === right.length || table[i + 1][j] >= table[i][j + 1])) out.push({ type: 'del', text: left[i++] });
    else out.push({ type: 'add', text: right[j++] });
  }
  return out;
}
