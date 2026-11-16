export function buildDelegation(workspace) {
  const nodes = (workspace?.nodes || []).filter(node => node.type === 'terminal' && !node.data?.process);
  const rows = nodes.map(node => {
    const { agent = {}, handoff, worktree = {}, role, hidden } = node.data || {};
    const what = agent.cardTitle || handoff?.title || '';
    let why = (handoff?.brief || '').replace(/\s+/g, ' ').trim();
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
    },
  };
}
