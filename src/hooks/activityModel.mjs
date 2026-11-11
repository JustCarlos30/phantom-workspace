// Source semantics only: a live shell is not evidence of agent work, and a
// completed process is neither task acceptance nor Git integration.
const states = {
  blocked: ['Bloqueada', 'warning', true],
  needs_input: ['Necesita respuesta', 'warning', true],
  awaiting_input: ['Espera respuesta', 'warning', true],
  awaiting_approval: ['Requiere revisión', 'warning', true],
  needs_review: ['Requiere revisión', 'warning', true],
  failed: ['Fallida', 'danger', true],
  running: ['En ejecución · agente', 'active', false],
  working: ['Trabajando · agente', 'active', false],
  queued: ['En cola', 'neutral', false],
  pending: ['Pendiente', 'neutral', false],
  completed: ['Ejecución completada', 'neutral', false],
  done: ['Completada en la fuente', 'neutral', false],
  accepted: ['Aceptada en la fuente', 'success', false],
  cancelled: ['Cancelada', 'neutral', false],
  canceled: ['Cancelada', 'neutral', false],
};
export function classifyTask(task = {}) {
  const status = task.status ?? task.raw?.status;
  const state = states[status];
  return { status: status || 'unknown', label: state?.[0] || 'Estado desconocido', tone: state?.[1] || 'neutral', intervention: state?.[2] || task.needsIntervention === true || task.raw?.needsIntervention === true };
}
export const isRead = item => Boolean(item.acknowledgedAt || item.ackedAt || item.acknowledged || item.acked);
export function classifyNotice(item = {}) {
  const task = classifyTask(item);
  const failedExit = Number.isInteger(item.exitCode) && item.exitCode !== 0;
  return { ...task, tone: failedExit ? 'danger' : task.tone, intervention: task.intervention || failedExit, read: isRead(item), approved: false,
    label: failedExit ? `Proceso salido · código ${item.exitCode}` : item.sessionId && 'exitCode' in item ? `Proceso salido · código ${item.exitCode ?? 'desconocido'}` : task.label };
}
export function linkedTask(task, session, node) {
  const raw = task.raw || task;
  return Boolean((session?.id && raw.sessionId === session.id) || (node?.id && raw.nodeId === node.id)
    || (Array.isArray(raw.refs) && raw.refs.some(ref => ref && ((session?.id && ref.kind === 'session' && ref.id === session.id) || (node?.id && ref.kind === 'node' && ref.id === node.id)))));
}
export function classifySession(session, task, connected = true) {
  if (!connected) return { label: 'Host desconectado', tone: 'warning', intervention: false };
  if (session?.status === 'exited') return { label: `Proceso salido · código ${session.exitCode ?? 'desconocido'}`, tone: session.exitCode ? 'danger' : 'neutral', intervention: Number.isInteger(session.exitCode) && session.exitCode !== 0 };
  if (session?.status === 'lost') return { label: 'Sesión perdida', tone: 'warning', intervention: true };
  if (task) return classifyTask(task);
  if (session?.agentStatus) return classifyTask({ status: session.agentStatus });
  return { label: session?.status === 'running' ? 'Conectada · sin señal del agente' : 'Estado desconocido', tone: 'neutral', intervention: false };
}
export function branchLinks(branch, git, sessions, tasks) {
  const trees = (git?.worktrees || []).filter(tree => tree.branch === branch.name);
  return {
    sessions: sessions.filter(s => s.worktree?.branch === branch.name || trees.some(t => t.path && t.path === s.cwd)),
    tasks: tasks.filter(t => trees.some(tree => tree.path && tree.path === t.raw?.contract?.workspace)),
  };
}
export function buildActivity({ workspace = {}, sessions = [], tasks = [], notices = [], git, connected = true }) {
  const nodes = (workspace.nodes || []).filter(n => n.type === 'terminal');
  const rows = sessions.map(session => {
    // nodeId alone can point at a newer session after an explicit relaunch.
    const node = nodes.find(n => n.data?.sessionId === session.id);
    const linked = tasks.filter(t => linkedTask(t, session, node));
    const task = linked.find(t => classifyTask(t).intervention) || linked[0];
    return { id: session.id, session, node, hidden: Boolean(node?.data?.hidden), title: node?.title || session.id, tasks: linked, ...classifySession(session, task, connected) };
  });
  for (const node of nodes) if (!rows.some(r => r.node?.id === node.id)) rows.push({ id: `node:${node.id}`, node, title: node.title, hidden: Boolean(node.data?.hidden), tasks: [], ...classifySession(null, null, connected) });
  const branches = (git?.branches || []).map(branch => ({ ...branch, integration: git?.available && git?.comparison?.baseOid && typeof branch.merged === 'boolean' ? branch.merged ? 'integrated' : 'pending' : 'unknown', links: branchLinks(branch, git, sessions, tasks) }));
  const needs = [
    ...tasks.filter(t => classifyTask(t).intervention).map(t => ({ key: `task:${t.id}`, title: t.title || t.id, source: 'Phantom · phantom.list', ...classifyTask(t), action: { tab: 'tasks', taskId: t.id } })),
    ...rows.filter(r => r.intervention && !r.tasks.some(t => classifyTask(t).intervention)).map(r => ({ key: `session:${r.id}`, title: r.title, source: 'Host · terminal.list', ...r, action: r.node ? { nodeId: r.node.id } : { tab: 'sessions' } })),
    ...notices.filter(n => classifyNotice(n).intervention && !rows.some(r => n.sessionId && r.session?.id === n.sessionId && r.intervention) && !tasks.some(t => t.id === n.taskId && classifyTask(t).intervention)).map(n => ({ key: `notice:${n.id}`, title: n.title, source: typeof n.source === 'string' ? n.source : 'Fuente desconocida', ...classifyNotice(n), action: noticeAction(n, rows) })),
  ];
  return { sessions: rows, tasks, branches, needs, notices: notices.map(n => ({ ...n, ...classifyNotice(n), action: noticeAction(n, rows) })), pendingBranches: branches.filter(b => b.integration === 'pending').length, unknownBranches: branches.filter(b => b.integration === 'unknown').length, byNode: Object.fromEntries(rows.filter(r => r.node).map(r => [r.node.id, r])) };
}
export function noticeAction(notice, rows) {
  const row = notice.sessionId && rows.find(r => r.session?.id === notice.sessionId && r.node);
  if (row) return { nodeId: row.node.id };
  if (notice.taskId || notice.source === 'phantom') return { tab: 'tasks' };
  if (notice.source === 'git') return { tab: 'git' };
  return { tab: 'sessions' };
}
