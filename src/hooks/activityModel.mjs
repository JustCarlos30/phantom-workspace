// Source semantics only: a PTY and a controller process are not agent progress.
export const itemsOf = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
const text = value => typeof value === 'string' ? value : '';
const states = {
  blocked: ['Bloqueada', true], awaiting_approval: ['Requiere aprobación', true],
  needs_approval: ['Requiere aprobación', true], awaiting_input: ['Espera tu respuesta', true],
  waiting_for_input: ['Espera tu respuesta', true], needs_input: ['Espera tu respuesta', true],
  failed: ['Error declarado', true], error: ['Error declarado', true],
   running: ['En curso', false], working: ['En curso', false], doing: ['En curso', false],
   verifying: ['Verificando', false], recovering: ['Recuperando', false],
  completed: ['Completada en fuente', false], done: ['Completada en fuente', false],
  cancelled: ['Cancelada', false], stopped: ['Detenida', false],
  queued: ['En cola', false], pending: ['Pendiente', false], todo: ['Por hacer', false],
};
export function classifyTask(task) {
  const status = text(task?.status) || text(task?.state);
  const known = states[status];
  return { status: status || 'unknown', label: known?.[0] || (status ? `Estado fuente: ${status}` : 'Estado desconocido'), needsYou: known?.[1] === true };
}
export const isRead = item => !!(item.acknowledgedAt || item.ackedAt || item.acknowledged || item.acked);
// Acknowledgement has deliberately no bearing on intervention classification.
export function classifyNotice(item) {
  return { read: isRead(item), approved: item.approved === true || !!item.approvedAt, needsYou: classifyTask(item).needsYou };
}
export function taskLinks(task, sessions, nodes) {
  const raw = task.raw || task;
  const sessionId = text(raw.sessionId), nodeId = text(raw.nodeId);
  const refs = Array.isArray(raw.refs) ? raw.refs : [];
  const currentNode = s => nodes.find(n => n.type === 'terminal' && n.id === s.nodeId && n.data?.sessionId === s.id);
  return sessions.filter(s => (text(task.id) && currentNode(s)?.data?.agent?.cardId === task.id) || (sessionId && s.id === sessionId) ||
    (nodeId && s.nodeId === nodeId && !!currentNode(s)) ||
    refs.some(r => r && ((r.kind === 'session' && r.id === s.id) || (r.kind === 'terminal' && r.id === s.nodeId && !!currentNode(s)))));
}
export function sessionState(session, connected = true, linkedTasks = []) {
  if (!connected) return { label: 'Desconectada · estado sin confirmar', needsYou: false, tone: 'unknown' };
  if (session?.status === 'exited') return { label: `Proceso salido${session.exitCode != null ? ` · código ${session.exitCode}` : ''}`, needsYou: false, tone: 'unknown' };
  if (session?.status === 'lost') return { label: 'Sesión perdida · historial', needsYou: true, tone: 'warning' };
  const agent = text(session?.agentState) || text(session?.agent?.status);
  const explicit = agent ? classifyTask({ status: agent }) : null;
  const intervention = linkedTasks.find(t => classifyTask(t).needsYou);
  if (intervention) return { needsYou: true, label: `Tarea: ${classifyTask(intervention).label}`, tone: 'warning' };
  // What the terminal screen shows right now outranks a declared 'working': an
  // agent sitting on a question needs you even if it never reported it.
  const screen = text(session?.screenState);
  if (screen === 'awaiting_approval') return { needsYou: true, label: 'Pide tu aprobación', tone: 'warning', screen };
  if (screen === 'awaiting_input' && !explicit?.needsYou) return { needsYou: true, label: 'Terminó · tu turno', tone: 'warning', screen };
  if (explicit) return { needsYou: explicit.needsYou, label: `Agente: ${explicit.label}`, tone: explicit.needsYou ? 'warning' : 'neutral' };
  if (screen === 'working') return { needsYou: false, label: 'Trabajando', tone: 'working', screen };
  if (linkedTasks.length) return { needsYou: false, label: `Tarea: ${classifyTask(linkedTasks[0]).label}`, tone: 'neutral' };
  return { label: session?.status === 'running' ? 'Conectada · agente sin señal' : 'Estado desconocido', needsYou: false, tone: 'unknown' };
}
export function branchState(branch, git) {
  const comparable = git?.available === true && !!git.base && !!git.comparison?.baseOid;
  return comparable && typeof branch.merged === 'boolean' ? (branch.merged ? 'Integrada' : 'No integrada') : 'Integración desconocida';
}
export function cardIdOf(item) {
  return text(item?.cardId) || text(item?.taskId) || (['card', 'task'].includes(item?.ref?.kind) ? text(item.ref.id) : '');
}
export function activityTitle(item) {
  return text(item?.summary) || text(item?.title) || text(item?.raw?.contract?.goal) || text(item?.contract?.goal) || text(item?.id) || 'Sin resumen';
}
export function integrationState(item) {
  return ({ queued: 'En cola del orquestador', merging: 'Integrando', conflict: 'Conflicto comprobado · devuelta', failed: 'Checks fallidos · devuelta', merged: 'Integrada', rejected: 'Rechazada', withdrawn: 'Retirada' })[item?.status] || 'Estado desconocido';
}
export function integrationGroups(merges) {
  if (merges?.available !== true) return { ready: [], decisions: [], active: [] };
  const queue = itemsOf(merges.queue);
  return { ready: queue.filter(item => item.status === 'queued'), decisions: [...queue.filter(item => ['conflict', 'failed'].includes(item.status)), ...itemsOf(merges.active).filter(item => item.status === 'blocked')], active: [...queue.filter(item => item.status === 'merging'), ...itemsOf(merges.active).filter(item => item.status !== 'blocked')] };
}
export function buildActivity({ workspace, sessions = [], tasks = [], git = null, merges = null, connected = true }) {
  const nodes = workspace?.nodes || [];
  const sessionRows = itemsOf(sessions).map(s => {
    // A historical session must not navigate to a different, relaunched session.
    const node = nodes.find(n => n.type === 'terminal' && n.data?.sessionId === s.id);
    const linkedTasks = itemsOf(tasks).filter(t => taskLinks(t, [s], nodes).length);
    const cardId = node?.data?.agent?.cardId || (linkedTasks.length === 1 ? linkedTasks[0].id : '');
    return { ...s, descriptor: true, nodeId: node?.id || null, cardId, title: node?.title || s.id, hidden: !!node?.data?.hidden, linkedTasks, ...sessionState(s, connected, linkedTasks) };
  });
  for (const node of nodes.filter(n => n.type === 'terminal' && !sessionRows.some(s => s.nodeId === n.id))) {
    sessionRows.push({ id: `node:${node.id}`, nodeId: node.id, title: node.title, hidden: !!node.data?.hidden, ...sessionState(null, connected), linkedTasks: [] });
  }
  const taskRows = itemsOf(tasks).map(t => ({ ...t, cardId: t.id, title: activityTitle(t), ...classifyTask(t), sessions: taskLinks(t, sessionRows, nodes) }));
  const notices = (workspace?.attention || []).map(n => ({ ...n, ...classifyNotice(n) }));
  const branches = (git?.branches || []).map(b => ({ ...b, label: branchState(b, git), sessions: sessionRows.filter(s => {
    const node = nodes.find(n => n.id === s.nodeId);
    // The host's worktree allocation supplies a real branch association.
    return (s.worktree?.branch || node?.data?.worktree?.branch) === b.name;
  }) }));
  const needs = [
    ...taskRows.filter(t => t.needsYou).map(t => ({ ...t, key: `task:${t.id}`, target: 'tasks', source: 'Phantom · phantom.list' })),
    ...sessionRows.filter(s => s.needsYou && !s.linkedTasks.some(t => classifyTask(t).needsYou)).map(s => ({ ...s, key: `session:${s.id}`, target: 'terminal', source: 'Host · terminal.list' })),
    ...notices.filter(n => n.needsYou).map(n => ({ ...n, label: classifyTask(n).label, key: `notice:${n.id}`, target: 'notice', source: text(n.source) || 'Aviso local' })),
  ];
  const integrations = integrationGroups(merges);
  needs.push(...integrations.decisions.map(item => ({ ...item, key: `merge:${item.id || item.nodeId}`, target: 'integration', label: item.status === 'blocked' ? 'Bloqueada' : integrationState(item), source: 'Host · merge.status' })));
  const inProgress = taskRows.filter(t => ['running', 'working', 'doing', 'verifying', 'recovering', 'queued'].includes(t.status));
  const activeSessions = sessionRows.filter(s => !s.needsYou && !s.linkedTasks.length && !integrations.active.some(item => item.nodeId === s.nodeId) && connected && s.status === 'running' && (s.tone === 'working' || ['working', 'running', 'doing', 'verifying', 'recovering'].includes(s.agentState || s.agent?.status)));
  return { integrations, inProgress, activeSessions, sessions: sessionRows, sessionCount: itemsOf(sessions).length, unknownViews: sessionRows.filter(s => !s.descriptor).length, tasks: taskRows, notices, branches, needs, pendingBranches: branches.filter(b => b.label === 'No integrada').length, unknownBranches: branches.filter(b => b.label === 'Integración desconocida').length, unread: notices.filter(n => !n.read).length };
}
