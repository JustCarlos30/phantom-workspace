// Classifications describe source evidence, never PTY activity or acceptance.
export const itemsOf = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
const states = {
  blocked: ['blocked', 'Bloqueada', true], needs_input: ['input', 'Necesita respuesta', true],
  waiting_input: ['input', 'Necesita respuesta', true], awaiting_input: ['input', 'Necesita respuesta', true],
  awaiting_approval: ['approval', 'Solicita aprobación', true], needs_approval: ['approval', 'Solicita aprobación', true],
  failed: ['failed', 'Fallo declarado', true], error: ['failed', 'Error declarado', true],
  running: ['active', 'En curso (fuente)', false], working: ['active', 'Trabajando (agente)', false],
  completed: ['completed', 'Completada (fuente)', false], done: ['completed', 'Completada (fuente)', false],
  cancelled: ['cancelled', 'Cancelada', false], stopped: ['stopped', 'Detenida', false],
  queued: ['queued', 'En cola', false], pending: ['queued', 'Pendiente (fuente)', false],
};
export function classifyState(value) {
  const [kind, label, intervention] = (typeof value === 'string' && Object.hasOwn(states, value) ? states[value] : null) || ['unknown', typeof value === 'string' && value ? `Estado sin clasificar: ${value}` : 'Estado desconocido', false];
  return { kind, label, intervention, raw: value || null };
}
export function sessionState(session, connected = true) {
  if (!connected) return { kind: 'unknown', label: 'Sin conexión · última observación', intervention: false };
  if (!session) return { kind: 'unknown', label: 'Sin señal de sesión', intervention: false };
  // Shell running is transport/process evidence, not agent working evidence.
  if (session.status === 'exited') return { kind: 'exited', label: `Proceso salido · código ${session.exitCode ?? '?'}`, intervention: false };
  if (session.status === 'lost') return { kind: 'unknown', label: 'Sesión perdida · historial', intervention: false };
  if (session.agentStatus) return classifyState(session.agentStatus);
  return { kind: 'unknown', label: session.status === 'running' ? 'Conectada · agente sin señal' : 'Estado de sesión desconocido', intervention: false };
}
export const isRead = item => Boolean(item.acknowledgedAt || item.ackedAt || item.acknowledged || item.acked);
export function noticeTarget(item, sessions, nodes, tasks, controllers = []) {
  const ref = typeof item.ref === 'object' && item.ref ? item.ref : {};
  const sessionId = item.sessionId || ref.sessionId;
  const nodeId = item.nodeId || ref.nodeId;
  const node = nodes.find(n => n.type === 'terminal' && (n.id === nodeId || (sessionId && n.data?.sessionId === sessionId)));
  if (node) return { type: 'terminal', id: node.id };
  const session = sessions.find(s => sessionId && s.id === sessionId);
  if (session?.nodeId && nodes.some(n => n.type === 'terminal' && n.id === session.nodeId && n.data?.sessionId === session.id)) return { type: 'terminal', id: session.nodeId };
  const controller = controllers.find(run => run.id === (item.runId || ref.runId));
  const taskId = item.taskId || ref.taskId || controller?.taskId;
  if (taskId && (tasks.some(t => t.id === taskId) || controller?.taskId === taskId)) return { type: 'tasks', id: taskId };
  if (item.source === 'git') return { type: 'git' };
  return null;
}
export function buildActivity({ workspace = {}, sessions: sourceSessions, tasks: sourceTasks, git, connected = true }) {
  const nodes = workspace.nodes || [], tasks = itemsOf(sourceTasks);
  const sessions = itemsOf(sourceSessions).map(s => {
    // Older sessions of a relaunched node must not navigate to the new session.
    const node = nodes.find(n => n.type === 'terminal' && n.data?.sessionId === s.id);
    return { ...s, node, title: node?.title || s.id, hidden: Boolean(node?.data?.hidden), state: sessionState(s, connected) };
  });
  const terminals = Object.fromEntries(nodes.filter(n => n.type === 'terminal').map(n => [n.id, sessionState(sessions.find(s => s.id === n.data?.sessionId), connected)]));
  const needs = [
    ...tasks.filter(t => classifyState(t.status).intervention).map(t => ({ key: `task:${t.id}`, title: t.title || t.id, state: classifyState(t.status), source: 'phantom.list · tarea', target: { type: 'tasks', id: t.id } })),
    ...sessions.filter(s => s.state.intervention).map(s => ({ key: `session:${s.id}`, title: s.title, state: s.state, source: 'terminal.list · agentStatus', target: s.node ? { type: 'terminal', id: s.node.id } : { type: 'sessions' } })),
  ];
  const notices = (workspace.attention || []).map(item => ({ ...item, read: isRead(item), target: noticeTarget(item, sessions, nodes, tasks, workspace.phantomControllers) }));
  const comparisonKnown = git?.available === true && Boolean(git.base && git.comparison?.baseOid);
  const branches = (git?.branches || []).map(branch => {
    const state = comparisonKnown && branch.merged === true ? 'integrated' : comparisonKnown && branch.merged === false ? 'pending' : 'unknown';
    // Association requires explicit identity/path evidence; names and timing are not links.
    const trees = (git.worktrees || []).filter(tree => tree.branch === branch.name);
    const linkedSessions = sessions.filter(s => trees.some(tree => tree.path === s.cwd || tree.path === s.worktree?.path));
    const linkedTasks = tasks.filter(t => trees.some(tree => tree.path === t.raw?.contract?.workspace));
    return { ...branch, state, label: ({ integrated: 'Integrada', pending: 'No integrada', unknown: 'Integración desconocida' })[state], sessions: linkedSessions, tasks: linkedTasks };
  });
  return { sessions, terminals, tasks, needs, notices, branches, comparisonKnown,
    counts: { sessions: sessions.length, needs: needs.length, unread: notices.filter(n => !n.read).length, branches: branches.length, pending: comparisonKnown ? branches.filter(b => b.state === 'pending').length : null } };
}

export const ACTIVITY_EVENTS = new Set(['state.changed', 'attention.new', 'terminal.exit', 'tool.status', 'task.changed', 'agent.status', 'git.changed']);
export const relevantActivityEvent = (event, workspaceId) => ACTIVITY_EVENTS.has(event.type) && (!event.workspaceId || event.workspaceId === workspaceId);

// Shared by the hook and race tests. No late result can publish across an epoch.
export function createActivityFence() {
  let epoch = 0;
  return { invalidate: () => ++epoch, token: () => epoch, current: token => token === epoch };
}
