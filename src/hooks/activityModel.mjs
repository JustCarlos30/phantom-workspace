// Pure presentation model: source facts never imply acceptance or agent activity.
export const itemsOf = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
export const isRead = item => !!(item.acknowledgedAt || item.ackedAt || item.acknowledged || item.acked);
const interventionStates = new Set(['blocked', 'needs_input', 'needs_intervention', 'awaiting_input', 'waiting_for_input', 'awaiting_approval', 'pending_approval', 'needs_approval', 'waiting_for_approval', 'failed', 'error']);
const stateLabels = { blocked: 'Bloqueada', needs_input: 'Necesita entrada', needs_intervention: 'Necesita intervención', awaiting_input: 'Espera entrada', waiting_for_input: 'Espera entrada', awaiting_approval: 'Espera aprobación', pending_approval: 'Espera aprobación', needs_approval: 'Necesita aprobación', waiting_for_approval: 'Espera aprobación', failed: 'Fallida', error: 'Error', running: 'En ejecución', working: 'Trabajando', doing: 'En curso', completed: 'Finalizada · aceptación no acreditada', done: 'Completada en la fuente', approved: 'Aprobada en la fuente', accepted: 'Aceptada en la fuente', cancelled: 'Cancelada', queued: 'En cola', pending: 'Pendiente', todo: 'Por hacer' };
export function classifyState(status) {
  const key = typeof status === 'string' ? status.toLowerCase() : '';
  return { status: key || 'unknown', label: stateLabels[key] || (key ? `Estado fuente: ${status}` : 'Estado desconocido'), needsIntervention: interventionStates.has(key) };
}
export function sessionState(session, connected = true) {
  if (!connected) return { status: 'disconnected', label: 'Desconectada · último estado', needsIntervention: false };
  if (session?.status === 'exited') return { status: 'exited', label: `Proceso salido · código ${session.exitCode ?? 'desconocido'}`, needsIntervention: false };
  if (session?.status === 'lost') return { status: 'lost', label: 'Sesión perdida · sin señal', needsIntervention: false };
  const signal = session?.agentState || session?.agentStatus;
  if (signal) return classifyState(signal);
  return { status: session?.status === 'running' ? 'connected' : 'unknown', label: session?.status === 'running' ? 'Conectada · sin señal del agente' : 'Sesión desconocida · sin señal', needsIntervention: false };
}
const pathKey = value => typeof value === 'string' ? value.replace(/\/+$/, '') : null;
export function buildActivity({ workspace = {}, sessions = [], tasks = [], git = null, connected = true } = {}) {
  const nodes = (workspace.nodes || []).filter(n => n.type === 'terminal');
  const terminalSessions = itemsOf(sessions).filter(s => !s.workspaceId || s.workspaceId === workspace.id);
  const rows = terminalSessions.map(session => {
    // A reused nodeId must not associate a historic session with a new PTY.
    const node = nodes.find(n => n.data?.sessionId === session.id) || nodes.find(n => n.id === session.nodeId && !n.data?.sessionId);
    return { ...session, nodeId: node?.id, title: node?.title || session.title || session.id, hidden: !!node?.data?.hidden, state: sessionState(session, connected), source: 'terminal.list' };
  });
  for (const node of nodes) if (!rows.some(row => row.nodeId === node.id)) rows.push({ id: `node:${node.id}`, nodeId: node.id, title: node.title, hidden: !!node.data?.hidden, state: sessionState(null, connected), source: 'Panel local · sesión no observada' });
  const taskRows = itemsOf(tasks).map(task => ({ ...task, state: classifyState(task.status), source: 'Phantom · phantom.list' }));
  const branches = (git?.branches || []).map(branch => {
    const compared = git?.available === true && !!git?.base && !!git?.comparison && typeof branch.merged === 'boolean';
    const trees = (git?.worktrees || []).filter(tree => tree.branch === branch.name);
    const linkedSessions = rows.filter(s => trees.some(t => pathKey(t.path) && pathKey(t.path) === pathKey(s.cwd)));
    const linkedTasks = taskRows.filter(t => (t.raw?.branch || t.branch) === branch.name || trees.some(tree => pathKey(tree.path) && pathKey(tree.path) === pathKey(t.raw?.worktreePath || t.worktreePath)));
    return { ...branch, integration: compared ? branch.merged ? 'Integrada' : 'No integrada' : 'Desconocida', compared, sessions: linkedSessions, tasks: linkedTasks };
  });
  const notices = (workspace.attention || []).map(item => ({ ...item, read: isRead(item), source: item.source || 'Fuente desconocida', nodeId: rows.find(s => s.id === item.sessionId)?.nodeId }));
  const needs = [
    ...taskRows.filter(t => t.state.needsIntervention).map(t => ({ ...t, key: `task:${t.id}`, target: 'tasks' })),
    ...rows.filter(s => s.state.needsIntervention).map(s => ({ ...s, key: `session:${s.id}`, target: s.nodeId ? 'terminal' : 'sessions' })),
    ...notices.filter(n => !n.read && (interventionStates.has(n.status) || (typeof n.exitCode === 'number' && n.exitCode !== 0))).map(n => ({ ...n, key: `notice:${n.id}`, state: { label: 'Revisar aviso de fallo' }, target: n.nodeId ? 'terminal' : n.sessionId ? 'sessions' : 'tasks' })),
  ];
  return { sessions: rows, tasks: taskRows, branches, notices, needs, pendingBranches: branches.filter(b => b.integration === 'No integrada').length, unknownBranches: branches.filter(b => !b.compared).length, unread: notices.filter(n => !n.read).length };
}
