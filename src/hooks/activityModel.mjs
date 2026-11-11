// Activity is a projection of sources, never an approval or execution authority.
export const itemsOf = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
const text = value => typeof value === 'string' ? value : '';
export const isRead = item => !!(item.acknowledgedAt || item.ackedAt || item.acknowledged || item.acked);
export function classifyState(value) {
  const state = text(value).toLowerCase().replaceAll('-', '_');
  if (['blocked', 'needs_input', 'waiting_input', 'awaiting_input', 'waiting_for_user', 'needs_intervention'].includes(state)) return { label: 'Necesita de ti', tone: 'warning', intervention: true };
  if (['awaiting_approval', 'pending_approval', 'needs_approval', 'pending_review', 'awaiting_review'].includes(state)) return { label: 'Requiere revisión', tone: 'warning', intervention: true };
  if (['failed', 'error'].includes(state)) return { label: 'Fallo declarado', tone: 'danger', intervention: true };
  if (['running', 'working', 'in_progress', 'doing'].includes(state)) return { label: 'En curso declarado', tone: 'active', intervention: false };
  if (['completed', 'done', 'succeeded'].includes(state)) return { label: 'Completada según fuente', tone: 'neutral', intervention: false };
  if (['cancelled', 'canceled', 'stopped'].includes(state)) return { label: 'Detenida', tone: 'neutral', intervention: false };
  if (['queued', 'pending', 'todo', 'ready'].includes(state)) return { label: 'Pendiente según fuente', tone: 'neutral', intervention: false };
  return { label: 'Estado desconocido', tone: 'neutral', intervention: false };
}
export function sessionState(session, connected = true) {
  if (!connected) return { label: 'Sin conexión', tone: 'warning', intervention: false };
  if (!session) return { label: 'Sin señal', tone: 'neutral', intervention: false };
  if (session.status === 'exited') return { label: `Proceso salido · código ${session.exitCode ?? '?'}`, tone: 'neutral', intervention: false };
  if (session.status === 'lost') return { label: 'Sesión perdida', tone: 'warning', intervention: true };
  const explicit = session.agentState ?? session.agent?.status ?? session.taskState;
  if (explicit) return { ...classifyState(explicit), rawState: text(explicit) };
  return { label: session.status === 'running' ? 'Conectada · sin señal de agente' : 'Estado desconocido', tone: 'neutral', intervention: false };
}
export function buildActivity({ workspace = {}, sessions: sourceSessions, tasks: sourceTasks, git, connected = true }) {
  const nodes = (workspace.nodes || []).filter(n => n.type === 'terminal');
  const sessions = itemsOf(sourceSessions).map(session => {
    const node = nodes.find(n => n.data?.sessionId === session.id) || nodes.find(n => n.id === session.nodeId && !n.data?.sessionId);
    return { ...session, nodeId: node?.id, title: node?.title || session.id, hidden: !!node?.data?.hidden, state: sessionState(session, connected), source: 'terminal.list' };
  });
  for (const node of nodes) if (!sessions.some(s => s.nodeId === node.id)) sessions.push({ id: node.data?.sessionId || node.id, nodeId: node.id, title: node.title, hidden: !!node.data?.hidden, state: sessionState(null, connected), source: 'Vista local · sin descriptor de sesión' });
  const tasks = [...itemsOf(sourceTasks).map(task => ({ ...task, state: classifyState(task.status ?? task.raw?.status ?? task.raw?.state), source: 'Phantom · phantom.list' })), ...(workspace.tasks || []).filter(t => t.kind !== 'phantom').map(task => ({ ...task, state: classifyState(task.status), source: 'Tarea local · estado declarado' }))];
  const branches = (git?.available ? git.branches || [] : []).map(branch => {
    const known = !!git.base && !!git.comparison?.baseOid;
    // Associations require explicit IDs or exact worktree paths; names/goals are not links.
    const trees = (git.worktrees || []).filter(t => t.branch === branch.name);
    const associatedSessions = sessions.filter(s => s.worktree?.branch === branch.name || trees.some(t => t.path && (s.worktree?.path === t.path || s.cwd === t.path)));
    const associatedTasks = tasks.filter(t => t.raw?.branch === branch.name || trees.some(tree => tree.path && t.raw?.contract?.workspace === tree.path));
    return { ...branch, ahead: known ? branch.ahead : undefined, behind: known ? branch.behind : undefined, integration: known && branch.merged === true ? 'Integrada' : known && branch.merged === false ? 'No integrada' : 'Desconocida', pending: known && branch.merged === false, sessions: associatedSessions, tasks: associatedTasks };
  });
  const notices = (workspace.attention || []).map(item => {
    const ref = typeof item.ref === 'object' ? item.ref : {};
    const session = sessions.find(s => s.id === (item.sessionId || ref.sessionId) || (item.source === 'terminal' && s.id === item.ref));
    const task = tasks.find(t => t.id === (item.taskId || ref.taskId));
    const controller = workspace.phantomControllers?.find(c => c.id === item.runId);
    const controllerTask = controller && tasks.find(t => t.id === controller.taskId);
    return { ...item, read: isRead(item), state: classifyState(item.status), target: session?.nodeId ? { kind: 'terminal', id: session.nodeId } : task || controllerTask ? { kind: 'tasks', id: (task || controllerTask).id } : { kind: item.source === 'git' ? 'git' : 'tasks' } };
  });
  const needs = [...sessions.filter(s => s.state.intervention).map(s => ({ ...s, key: `session:${s.id}`, target: s.nodeId ? { kind: 'terminal', id: s.nodeId } : { kind: 'sessions' } })), ...tasks.filter(t => t.state.intervention).map(t => ({ ...t, key: `task:${t.id}`, target: { kind: 'tasks', id: t.id } }))];
  for (const notice of notices) if (notice.state.intervention && !needs.some(n => notice.target.id && n.target.kind === notice.target.kind && n.target.id === notice.target.id)) needs.push({ ...notice, key: `notice:${notice.id}` });
  return { sessions, tasks, branches, notices, needs, unread: notices.filter(n => !n.read).length, pendingBranches: branches.filter(b => b.pending).length, unknownBranches: branches.filter(b => b.integration === 'Desconocida').length };
}
export const activityEvent = (event, workspaceId) => (!event.workspaceId || event.workspaceId === workspaceId) && ['state.changed', 'attention.new', 'terminal.exit', 'terminal.created', 'tool.status', 'task.changed', 'agent.status', 'git.changed'].includes(event.type);
