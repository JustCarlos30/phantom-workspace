// Source facts stay separate: a PTY, an agent, a task and a read receipt
// have different lifecycles. In particular, no process exit grants acceptance.
const interventionStates = new Map([
  ['blocked', 'Bloqueada'], ['failed', 'Fallida'], ['needs_input', 'Necesita tu respuesta'],
  ['awaiting_input', 'Espera tu respuesta'], ['waiting_for_input', 'Espera tu respuesta'],
  ['needs_approval', 'Necesita revisión'], ['awaiting_approval', 'Espera revisión'],
  ['needs_review', 'Necesita revisión'], ['awaiting_review', 'Espera revisión'],
]);
const states = new Map([
  ...interventionStates, ['running', 'En ejecución'], ['working', 'En ejecución'],
  ['queued', 'En cola'], ['pending', 'Pendiente'], ['paused', 'Pausada'],
  ['completed', 'Finalizada'], ['succeeded', 'Finalizada'], ['cancelled', 'Cancelada'],
  ['canceled', 'Cancelada'], ['approved', 'Aprobada'], ['accepted', 'Aceptada'],
]);
export function classifyExplicit(status) {
  return { status: status || null, label: states.get(status) || 'Estado desconocido',
    needsYou: interventionStates.has(status), known: states.has(status) };
}
export const isRead = item => Boolean(item.acknowledgedAt || item.acknowledged || item.acked);
export function classifySession(session, connected = true) {
  if (!connected) return { label: 'Sin conexión', tone: 'unknown', needsYou: false };
  const agent = classifyExplicit(session?.agentStatus ?? session?.agent?.status);
  if (agent.known) return { ...agent, label: `Agente: ${agent.label}`, tone: agent.needsYou ? 'warning' : 'neutral' };
  if (session?.status === 'running') return { label: 'Conectada · sin señal de agente', tone: 'neutral', needsYou: false };
  if (session?.status === 'exited') return { label: `Proceso salido · código ${session.exitCode ?? 'desconocido'}`, tone: session.exitCode != null && session.exitCode !== 0 ? 'warning' : 'unknown', needsYou: session.exitCode != null && session.exitCode !== 0 };
  if (session?.status === 'lost') return { label: 'Sesión perdida', tone: 'warning', needsYou: true };
  return { label: 'Sin señal · estado desconocido', tone: 'unknown', needsYou: false };
}
export function sessionNode(session, nodes = []) {
  // A node can have older sessions in its history; never navigate an old
  // descriptor to a newer, different PTY on the same node.
  return nodes.find(n => n.type === 'terminal' && n.data?.sessionId === session.id)
    || nodes.find(n => n.type === 'terminal' && n.id === session.nodeId && !n.data?.sessionId);
}
export function branchSessions(branch, sessions, git) {
  const paths = (git?.worktrees || []).filter(t => t.branch === branch.name).map(t => t.path);
  return sessions.filter(s => s.worktree?.branch === branch.name || paths.includes(s.cwd) || paths.includes(s.worktree?.path));
}
export function taskSession(task, sessions) {
  const raw = task.raw || task;
  const sessionId = raw.sessionId ?? raw.session?.id;
  const nodeId = raw.nodeId;
  return sessions.find(s => (sessionId && s.id === sessionId) || (nodeId && s.nodeId === nodeId));
}
export function buildActivity({ workspace, sessions = [], tasks = [], git, connected = true }) {
  const nodes = workspace?.nodes || [];
  const sessionRows = sessions.map(s => {
    const node = sessionNode(s, nodes);
    return { ...s, node, hidden: Boolean(node?.data?.hidden), title: node?.title || s.id, state: classifySession(s, connected) };
  });
  // Include terminal views with no known descriptor rather than silently
  // interpreting a failed/missing terminal.list as zero sessions.
  for (const node of nodes.filter(n => n.type === 'terminal')) {
    if (!sessionRows.some(s => s.node?.id === node.id)) sessionRows.push({ id: `node:${node.id}`, node, hidden: Boolean(node.data?.hidden), title: node.title, state: classifySession(null, connected), descriptorMissing: true });
  }
  const taskRows = tasks.map(task => ({ ...task, state: classifyExplicit(task.status), session: taskSession(task, sessionRows) }));
  const branches = (git?.branches || []).map(branch => ({ ...branch,
    integration: git?.available && git?.base && git?.comparison?.baseOid && typeof branch.merged === 'boolean' ? (branch.merged ? 'integrated' : 'pending') : 'unknown',
    sessions: branchSessions(branch, sessionRows, git),
  }));
  const notices = (workspace?.attention || []).map(item => ({ ...item, read: isRead(item), session: sessionRows.find(s => s.id === item.sessionId), task: taskRows.find(t => t.id === item.taskId) }));
  const needs = [
    ...taskRows.filter(t => t.state.needsYou).map(t => ({ key: `task:${t.id}`, title: t.title || t.id, label: t.state.label, source: 'Phantom · tarea', target: t.session?.node ? { nodeId: t.session.node.id } : { tab: 'tasks' } })),
    ...sessionRows.filter(s => s.state.needsYou).map(s => ({ key: `session:${s.id}`, title: s.title, label: s.state.label, source: 'Host · terminal', target: s.node ? { nodeId: s.node.id } : { tab: 'sessions' } })),
    ...notices.filter(n => n.status === 'failed' && !n.task && !n.session).map(n => ({ key: `notice:${n.id}`, title: n.title, label: 'Fallo observado · resolución desconocida', source: n.source || 'Host', target: { tab: n.source === 'phantom' ? 'tasks' : 'sessions' } })),
  ];
  return { sessions: sessionRows, tasks: taskRows, branches, notices, needs,
    pendingBranches: branches.filter(b => b.integration === 'pending').length,
    unknownBranches: branches.filter(b => b.integration === 'unknown').length,
    unread: notices.filter(n => !n.read).length };
}
