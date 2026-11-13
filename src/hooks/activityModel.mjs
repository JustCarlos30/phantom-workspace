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
  queued: ['En cola', false], pending: ['Pendiente', false], todo: ['Por hacer', false], ready: ['Sin ejecutar', false],
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
// When something last changed, from whichever timestamp its source records.
export function timeOf(item) {
  for (const value of [item?.finishedAt, item?.updatedAt, item?.raw?.updatedAt, item?.requestedAt, item?.createdAt, item?.raw?.createdAt, item?.observedAt]) {
    const at = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isFinite(at)) return at;
  }
  return 0;
}
export function ago(at, now = Date.now()) {
  if (!at) return '';
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `hace ${hours} h` : `hace ${Math.floor(hours / 24)} d`;
}
const byRecent = rows => rows.map((row, index) => [row, index]).sort((a, b) => (b[0].at || 0) - (a[0].at || 0) || a[1] - b[1]).map(([row]) => row);
const RUNNING = ['running', 'working', 'doing', 'verifying', 'recovering'], WAITING = ['queued', 'pending', 'todo', 'ready'];
const CLOSED = { completed: 'done', done: 'done', cancelled: 'cancelled', stopped: 'cancelled' };
// Which glyph and ink a row gets: the reason it is in its list, not its source.
export function rowKind(item) {
  if (item?.target === 'integration') return ['conflict', 'failed'].includes(item.status) ? 'returned' : item.status === 'blocked' ? 'blocked' : item.tone || 'working';
  if (item?.screen === 'awaiting_approval') return 'approval';
  if (item?.screen === 'awaiting_input') return 'input';
  const status = text(item?.status) || text(item?.state);
  if (/approval/.test(status)) return 'approval';
  if (/input/.test(status)) return 'input';
  if (status === 'failed' || status === 'error' || status === 'lost') return 'failed';
  if (status === 'blocked') return 'blocked';
  return item?.tone || (item?.needsYou ? 'blocked' : 'working');
}
// Only the sources that feed «Necesitan de ti» can make the notch doubt its
// count. Limits or the Git radar failing say nothing about pending decisions.
const ATTENTION_SOURCES = { tasks: 'tareas de Phantom', sessions: 'terminales', merges: 'incorporaciones' };
export function freshness({ sources = {}, connected = true, now = Date.now(), staleMs = 45000 } = {}) {
  if (!connected) return { state: 'offline', failing: [] };
  const entries = Object.entries(ATTENTION_SOURCES).map(([key, name]) => [sources[key] || {}, name]);
  const failing = entries.filter(([source]) => source.error).map(([, name]) => name);
  if (entries.some(([source]) => !source.at && !source.error)) return { state: 'loading', failing };
  const stale = entries.some(([source]) => source.at && now - source.at > staleMs);
  return { state: failing.length || stale ? 'stale' : 'fresh', failing };
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
  const taskRows = itemsOf(tasks).map(t => ({ ...t, cardId: t.id, title: activityTitle(t), ...classifyTask(t), at: timeOf(t), sessions: taskLinks(t, sessionRows, nodes) }));
  const notices = byRecent((workspace?.attention || []).map(n => ({ ...n, ...classifyNotice(n), at: timeOf(n) })));
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
  const inProgress = byRecent(taskRows.filter(t => RUNNING.includes(t.status) || WAITING.includes(t.status)).map(t => ({ ...t, tone: RUNNING.includes(t.status) ? 'working' : 'waiting' })))
    .sort((a, b) => (a.tone === 'working' ? 0 : 1) - (b.tone === 'working' ? 0 : 1));
  const finished = byRecent([
    ...taskRows.filter(t => CLOSED[t.status]).map(t => ({ ...t, key: `task:${t.id}`, target: 'tasks', tone: CLOSED[t.status] })),
    ...(merges?.available === true ? itemsOf(merges.history) : []).map(item => ({ ...item, key: `merge:${item.id}`, target: 'integration', label: integrationState(item), tone: item.status === 'merged' ? 'done' : 'cancelled', at: timeOf(item) })),
  ]);
  const activeSessions = sessionRows.filter(s => !s.needsYou && !s.linkedTasks.length && !integrations.active.some(item => item.nodeId === s.nodeId) && connected && s.status === 'running' && (s.tone === 'working' || ['working', 'running', 'doing', 'verifying', 'recovering'].includes(s.agentState || s.agent?.status)));
  needs.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { integrations, inProgress, finished, activeSessions, sessions: sessionRows, sessionCount: itemsOf(sessions).length, unknownViews: sessionRows.filter(s => !s.descriptor).length, tasks: taskRows, notices, branches, needs, pendingBranches: branches.filter(b => b.label === 'No integrada').length, unknownBranches: branches.filter(b => b.label === 'Integración desconocida').length, unread: notices.filter(n => !n.read).length };
}
