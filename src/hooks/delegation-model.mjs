import { childrenOf } from './card-view.mjs';

export function withCardPlans(delegation, tasks) {
  const items = Array.isArray(tasks) ? tasks : Array.isArray(tasks?.items) ? tasks.items : [];
  const plans = new Map();
  for (const item of items) {
    const children = childrenOf(item.raw ?? item, items).nodes.map(({ key, goal, status, dependencies, taskId = '' }) => ({ key, goal, status, dependencies, taskId }));
    if (children.length) plans.set(item.id, { cardId: item.id, total: children.length, done: children.filter(child => child.status === 'completed').length, children });
  }
  const assigned = new Set(delegation.rows.map(row => row.cardId).filter(Boolean));
  return {
    rows: delegation.rows.map(row => ({ ...row, plan: row.cardId ? plans.get(row.cardId) || null : null })),
    counts: delegation.counts,
    cards: items.filter(item => item.status !== 'completed' && item.status !== 'cancelled' && plans.has(item.id) && !assigned.has(item.id)).map(item => {
      let goal = ((item.raw ?? item).contract?.goal || '').replace(/\s+/g, ' ').trim();
      if (goal.length > 200) goal = `${goal.slice(0, 199)}…`;
      return { id: item.id, goal, status: item.status, plan: plans.get(item.id) };
    }),
  };
}

export function buildDelegation(workspace, { now = Date.now() } = {}) {
  const nodes = (workspace?.nodes || []).filter(node => node.type === 'terminal' && !node.data?.process);
  const rows = nodes.map(node => {
    const { agent = {}, handoff, worktree = {}, role, hidden } = node.data || {};
    const what = agent.cardTitle || handoff?.title || '';
    let why = (handoff?.brief || '').replace(/\s+/g, ' ').trim();
    if (what && why.startsWith(`${what} `)) why = why.slice(what.length).trim();
    if (why === what) why = '';
    if (why.length > 200) why = `${why.slice(0, 199)}…`;
    return {
      id: node.id,
      title: node.title || 'Terminal',
      role: role === 'orchestrator' ? 'orchestrator' : 'worker',
      depth: 0,
      parentId: null,
      purpose: typeof agent.cardId === 'string' && agent.cardId.length > 0 ? 'task' : handoff ? 'handoff' : role === 'orchestrator' ? 'orchestrator' : 'none',
      what,
      why,
      from: handoff?.from ? {
        nodeId: handoff.from.nodeId,
        title: handoff.from.title,
        workspaceName: handoff.from.workspaceName,
        external: handoff.from.workspaceId !== workspace.id,
      } : null,
      status: ['idle', 'working', 'blocked', 'review'].includes(agent.status) ? agent.status : 'idle',
      step: agent.step || '',
      branch: worktree.branch || '',
      cardId: agent.cardId || '',
      hidden: Boolean(hidden),
      subagents: (Array.isArray(node.data?.subagents) ? node.data.subagents : []).filter(entry => entry && typeof entry.id === 'string' && typeof entry.startedAt === 'string' && Number.isFinite(Date.parse(entry.startedAt)) && now - Date.parse(entry.startedAt) <= 6 * 3600e3).map(entry => ({ id: entry.id, type: typeof entry.type === 'string' ? entry.type : '', description: typeof entry.description === 'string' ? entry.description : '', background: entry.background === true })),
    };
  });
  const byId = new Map(rows.map(row => [row.id, row]));
  rows.forEach(row => {
    if (!row.from || row.from.external) return;
    let parent = byId.get(row.from.nodeId);
    if (!parent || parent === row) return;
    const parentId = parent.id;
    while (parent && parent !== row) parent = byId.get(parent.parentId);
    if (!parent) row.parentId = parentId;
  });
  const children = new Map(rows.map(row => [row.id, []]));
  const createdAt = new Map(nodes.map(node => [node.id, node.data?.handoff?.createdAt || '']));
  for (const row of rows) if (row.parentId !== null) children.get(row.parentId).push(row);
  for (const siblings of children.values()) siblings.sort((a, b) => {
    const first = createdAt.get(a.id), second = createdAt.get(b.id);
    return first < second ? -1 : first > second ? 1 : 0;
  });
  const ordered = [];
  function visit(row, depth) {
    row.depth = depth;
    ordered.push(row);
    for (const child of children.get(row.id)) visit(child, depth + 1);
  }
  const roots = rows.filter(row => row.parentId === null);
  roots.sort((a, b) => Number(b.role === 'orchestrator') - Number(a.role === 'orchestrator'));
  for (const root of roots) visit(root, 0);
  return {
    rows: ordered,
    counts: {
      total: rows.length,
      unassigned: rows.filter(row => row.purpose === 'none').length,
      working: rows.filter(row => row.status === 'working').length,
      blocked: rows.filter(row => row.status === 'blocked').length,
      subagents: rows.reduce((total, row) => total + row.subagents.length, 0),
    },
  };
}
