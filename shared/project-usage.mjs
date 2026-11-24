// Project usage metadata: {count, lastAccessAt}. Legacy projects have none and count as 0.
export function validateUsage(usage) {
  if (usage === undefined) return undefined;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw new Error('Invalid project usage');
  if (!Number.isSafeInteger(usage.count) || usage.count < 0) throw new Error('Invalid project usage count');
  if (typeof usage.lastAccessAt !== 'string' || Number.isNaN(Date.parse(usage.lastAccessAt))) throw new Error('Invalid project usage date');
  return usage;
}

// Counts only a real switch: selecting the already-active project is a no-op.
export function recordUsage(state, workspace, now = new Date().toISOString()) {
  if (state.activeWorkspaceId === workspace.id) return false;
  workspace.usage = { count: (workspace.usage?.count || 0) + 1, lastAccessAt: now };
  return true;
}

export function compareProjects(a, b) {
  const count = (b.usage?.count || 0) - (a.usage?.count || 0);
  if (count) return count;
  const time = (Date.parse(b.usage?.lastAccessAt) || 0) - (Date.parse(a.usage?.lastAccessAt) || 0);
  if (time) return time;
  return (a.name || '').localeCompare(b.name || '') || (a.canonicalPath || a.path || '').localeCompare(b.canonicalPath || b.path || '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function sortProjects(projects, activeId) {
  return [...projects].sort((a, b) => (b.id === activeId) - (a.id === activeId) || compareProjects(a, b));
}
