// Source semantics only: a PTY and a controller process are not agent progress.
import { isReadyBranch } from './incorporaciones-model.mjs';
import { explainReason, resolutionOf, titleOf } from './phantom-desk.mjs';

const OTHER_MEANING = 'Motivos distintos; abre cada tarea para leer el suyo.';
export const itemsOf = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
const text = value => typeof value === 'string' ? value : '';
const states = {
  blocked: ['Bloqueada', true], awaiting_approval: ['Pide permiso', true],
  needs_approval: ['Pide permiso', true], awaiting_input: ['Te hizo una pregunta', true],
  waiting_for_input: ['Te hizo una pregunta', true], needs_input: ['Te hizo una pregunta', true],
  failed: ['Falló', true], error: ['Falló', true],
  running: ['Trabajando', false], working: ['Trabajando', false], doing: ['Trabajando', false],
  verifying: ['Verificando', false], recovering: ['Recuperando', false],
  completed: ['Terminada', false], done: ['Terminada', false],
  cancelled: ['Cancelada', false], stopped: ['Detenida', false],
  queued: ['En cola', false], pending: ['Pendiente', false], todo: ['Por hacer', false], ready: ['Sin empezar', false],
};
export function classifyTask(task) {
  const status = text(task?.status) || text(task?.state);
  const known = states[status];
  return { status: status || 'unknown', label: known?.[0] || 'Sin datos', needsYou: known?.[1] === true };
}
export const isRead = item => !!(item.acknowledgedAt || item.ackedAt || item.acknowledged || item.acked);
// Acknowledgement only clears process-end notices; Phantom tasks remain authoritative.
export function classifyNotice(item) {
  const read = isRead(item), processEnd = text(item.eventKey).startsWith('tool:') || text(item.eventKey).startsWith('terminal:');
  return { read, approved: item.approved === true || !!item.approvedAt, needsYou: classifyTask(item).needsYou && (!processEnd || (item.source !== 'phantom' && !read)) };
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
  if (!connected) return { label: 'Sin conexión', needsYou: false, tone: 'unknown' };
  if (session?.status === 'exited') return { label: session.exitCode ? `Cerrada · código ${session.exitCode}` : 'Cerrada', needsYou: false, tone: 'unknown' };
  if (session?.status === 'lost') return { label: 'Sesión perdida', needsYou: true, tone: 'warning' };
  const agent = text(session?.agentState) || text(session?.agent?.status);
  const explicit = agent ? classifyTask({ status: agent }) : null;
  const intervention = linkedTasks.find(t => classifyTask(t).needsYou);
  if (intervention) return { needsYou: true, label: classifyTask(intervention).label, tone: 'warning' };
  // What the terminal screen shows right now outranks a declared 'working': an
  // agent sitting on a question needs you even if it never reported it.
  const screen = text(session?.screenState);
  if (screen === 'awaiting_approval') return { needsYou: true, label: session?.screenReason === 'trust' ? 'Pide confiar en la carpeta' : 'Pide permiso', tone: 'warning', screen };
  if (screen === 'awaiting_input' && !explicit?.needsYou) return { needsYou: true, label: 'Terminó · tu turno', tone: 'warning', screen };
  if (explicit) return { needsYou: explicit.needsYou, label: explicit.label, tone: explicit.needsYou ? 'warning' : 'neutral' };
  if (screen === 'working') return { needsYou: false, label: 'Trabajando', tone: 'working', screen };
  if (linkedTasks.length) return { needsYou: false, label: classifyTask(linkedTasks[0]).label, tone: 'neutral' };
  return { label: session?.status === 'running' ? 'En espera' : 'Sin datos', needsYou: false, tone: 'unknown' };
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
  return ({ queued: 'En cola', merging: 'Integrando', conflict: 'Conflicto', failed: 'Tests fallidos', merged: 'En main', rejected: 'Rechazada', withdrawn: 'Retirada' })[item?.status] || 'Estado desconocido';
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
export function waiting(at, now = Date.now()) {
  return !at ? '' : now - at < 60000 ? 'Recién' : `Espera ${ago(at, now)}`;
}
export function excerptLines(lines, max = 6) {
  return itemsOf(lines).map(line => text(line).trim()).filter(line => line && !/^[\s\u2500-\u257f\u2580-\u259f─━═|+_=*\-]+$/u.test(line) && !/^(?:[>❯›$#]\s*)$/u.test(line) && !/\besc(?:ape)?\s+(?:to\s+)?(?:interrupt|cancel)\b|\?\s+(?:for\s+)?shortcuts\b|\bctrl\s*[+＋]/i.test(line)).slice(-max);
}
export function leadNeed(activity) {
  const row = activity?.needs?.[0];
  return row ? { headline: row.headline, where: row.title, at: row.at } : null;
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
// Chat cards: a permission or a question the agent is waiting on lives inside
// the message that asked. Only a running turn can still be answered.
export function pendingParts(message) {
  return itemsOf(message?.parts).filter(part => (part?.type === 'permission' || part?.type === 'question') && part.status === 'pending');
}
export function pendingChat(chat) {
  return chat?.running ? itemsOf(chat.messages).flatMap(pendingParts) : [];
}
const PROVIDERS = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', phantom: 'Phantom' };
const VERBS = { bash: 'Ejecutar', edit: 'Editar', multiedit: 'Editar', notebookedit: 'Editar', write: 'Escribir', read: 'Leer', webfetch: 'Abrir', websearch: 'Buscar', external_directory: 'Acceder a' };
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
// A question can be answered from its row only when it is one choice among a
// few short options; anything richer is answered in the session.
function quickOptions(part) {
  const questions = itemsOf(part.questions), options = itemsOf(questions[0]?.options).map(option => text(option?.label)).filter(Boolean);
  return questions.length === 1 && !questions[0].multiSelect && options.length >= 2 && options.length <= 4 && options.every(label => label.length <= 28) ? options : [];
}
function chatNeed(entry, title, provider, main) {
  const part = entry.pending[0], agent = PROVIDERS[provider] || 'El agente', more = entry.pending.length > 1 ? ` · ${entry.pending.length - 1} más` : '';
  const row = { key: `chat:${entry.nodeId}`, group: 'now', target: main ? 'phantom' : 'chat', nodeId: main ? null : entry.nodeId, chatId: entry.nodeId, requestId: part.id, title, needsYou: true, at: timeOf(part) };
  if (part.type === 'question') {
    const question = text(itemsOf(part.questions)[0]?.question);
    return { ...row, need: 'question', label: 'Te hizo una pregunta', headline: question || 'Te hizo una pregunta', question, options: quickOptions(part), context: `${title} · ${agent} espera tu respuesta${more}` };
  }
  const tool = text(part.tool), verb = VERBS[tool.toLowerCase()];
  return { ...row, need: 'permission', label: 'Pide permiso', headline: verb || (tool && !tool.includes('__') ? `Usar ${tool}` : 'Usar una herramienta'), code: text(part.detail) || (verb ? '' : tool.includes('__') ? tool : ''), context: `${title} · ${agent} pide permiso${more}` };
}
const SESSION_NEED = {
  approval: 'Pide permiso para continuar', input: 'Te hizo una pregunta', turn: 'Terminó y espera tu respuesta',
  lost: 'Se perdió la sesión', failed: 'Falló', blocked: 'Está bloqueada',
};
const RANK = { permission: 0, question: 1, approval: 2 };
// A blocked or failed Phantom task is not waiting on a reply: it is stuck, and
// is reported by cause apart from the decisions that do need you.
const STUCK = ['blocked', 'failed', 'error'];
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
// chats: [{ nodeId, running, pending: [part] }] — what each chat card (and the
// project's Phantom conversation, `phantom:<workspace>`) is waiting on.
export function buildActivity({ workspace, sessions = [], tasks = [], git = null, merges = null, chats = [], connected = true, now = Date.now() }) {
  const nodes = workspace?.nodes || [];
  const chatOf = new Map(itemsOf(chats).map(entry => [entry.nodeId, { ...entry, pending: itemsOf(entry.pending) }]));
  // A chat card has no screen to read: its own turn says what it is doing.
  const chatState = node => {
    const entry = node?.data?.chat?.provider && connected ? chatOf.get(node.id) : null;
    if (!entry) return null;
    if (entry.pending.length) return { label: entry.pending[0].type === 'question' ? 'Te hizo una pregunta' : 'Pide permiso', needsYou: true, tone: 'warning', chatRunning: true };
    return entry.running ? { label: 'Trabajando', needsYou: false, tone: 'working', chatRunning: true } : { label: 'En espera', needsYou: false, tone: 'unknown' };
  };
  const sessionRows = itemsOf(sessions).map(s => {
    // A historical session must not navigate to a different, relaunched session.
    const node = nodes.find(n => n.type === 'terminal' && n.data?.sessionId === s.id);
    const linkedTasks = itemsOf(tasks).filter(t => taskLinks(t, [s], nodes).length);
    const cardId = node?.data?.agent?.cardId || (linkedTasks.length === 1 ? linkedTasks[0].id : '');
    return { ...s, descriptor: true, nodeId: node?.id || null, cardId, title: node?.title || 'Sesión anterior', hidden: !!node?.data?.hidden, linkedTasks, ...sessionState(s, connected, linkedTasks), ...chatState(node) };
  });
  for (const node of nodes.filter(n => n.type === 'terminal' && !sessionRows.some(s => s.nodeId === n.id))) {
    sessionRows.push({ id: `node:${node.id}`, nodeId: node.id, title: node.title, hidden: !!node.data?.hidden, ...sessionState(null, connected), ...chatState(node), linkedTasks: [] });
  }
  const taskRows = itemsOf(tasks).map(t => ({ ...t, cardId: t.id, title: activityTitle(t), ...classifyTask(t), at: timeOf(t), sessions: taskLinks(t, sessionRows, nodes) }));
  const notices = byRecent((workspace?.attention || []).map(n => ({ ...n, ...classifyNotice(n), at: timeOf(n) })));
  const branches = (git?.branches || []).map(b => ({ ...b, label: branchState(b, git), sessions: sessionRows.filter(s => {
    const node = nodes.find(n => n.id === s.nodeId);
    // The host's worktree allocation supplies a real branch association.
    return (s.worktree?.branch || node?.data?.worktree?.branch) === b.name;
  }) }));
  const integrations = integrationGroups(merges);
  const base = text(merges?.base?.branch) || 'main';

  // «Decide ahora»: one row per session. Whoever states the decision most
  // precisely claims the node — the chat's own request, then a task, then the
  // terminal screen, then the branch — and the rest stay quiet about it.
  const claimed = new Set(), needs = [];
  const claim = (...ids) => { for (const id of ids) if (id) claimed.add(id); };
  if (connected) for (const entry of chatOf.values()) {
    if (!entry.pending.length) continue;
    const main = entry.nodeId === `phantom:${workspace?.id}`, node = nodes.find(n => n.id === entry.nodeId);
    if (!main && !node) continue;
    needs.push(chatNeed(entry, main ? 'Phantom' : node.title || 'Chat', main ? 'phantom' : node.data?.chat?.provider, main));
    claim(node?.id);
  }
  for (const t of taskRows.filter(t => t.needsYou && !STUCK.includes(t.status))) {
    const kind = rowKind(t), where = t.sessions[0]?.title;
    needs.push({ ...t, key: `task:${t.id}`, target: 'tasks', source: 'Phantom · phantom.list', group: 'now', need: kind, headline: t.title, context: [kind === 'blocked' ? 'Tarea bloqueada' : `Tarea · ${t.label}`, where].filter(Boolean).join(' · ') });
    claim(...t.sessions.map(s => s.nodeId));
  }
  for (const s of sessionRows.filter(s => s.needsYou && !s.linkedTasks.some(t => classifyTask(t).needsYou))) {
    if (s.nodeId && claimed.has(s.nodeId)) continue;
    const need = s.screen === 'awaiting_approval' ? 'approval' : s.screen === 'awaiting_input' ? 'turn' : s.status === 'lost' ? 'lost' : rowKind({ ...s, status: text(s.agentState) || text(s.agent?.status) || s.status });
    const sessionId = s.descriptor && s.id && !s.id.startsWith('node:') ? s.id : null, live = s.status === 'running';
    needs.push({ ...s, key: `session:${s.id}`, target: 'terminal', source: 'Host · terminal.list', group: 'now', need, sessionId, live, reply: ['turn', 'input'].includes(need) && live && sessionId ? 'terminal' : null, excerpt: !!(live && sessionId), at: s.screen ? s.screenStateAt || 0 : 0, headline: need === 'approval' && s.screenReason === 'trust' ? s.label : SESSION_NEED[need] || s.label, context: s.title });
    claim(s.nodeId);
  }
  for (const n of notices.filter(n => n.needsYou)) {
    if (n.nodeId && claimed.has(n.nodeId)) continue;
    const label = classifyTask(n).label;
    needs.push({ ...n, label, key: `notice:${n.id}`, target: 'notice', source: text(n.source) || 'Aviso local', group: 'now', need: rowKind(n), headline: text(n.title) || label, context: text(n.title) ? label : 'Aviso' });
  }
  for (const item of integrations.decisions) {
    if (item.nodeId && claimed.has(item.nodeId)) continue;
    const name = text(item.title) || 'Una rama', files = itemsOf(item.conflicts).slice(0, 2).join(', ');
    const [need, headline, context] = item.status === 'conflict' ? ['conflict', `${name} choca con ${base}`, files ? `Conflicto en ${files}` : 'No se puede integrar hasta resolverlo']
      : item.status === 'failed' ? ['checks', `${name}: tests fallidos`, 'Hay que corregirlos y volver a enviarla']
        : ['blocked', `${name} está bloqueada`, text(item.step) || 'El agente no puede continuar'];
    needs.push({ ...item, key: `merge:${item.id || item.nodeId}`, target: 'integration', label: item.status === 'blocked' ? 'Bloqueada' : integrationState(item), source: 'Host · merge.status', group: 'now', need, headline, context });
    claim(item.nodeId);
  }
  needs.sort((a, b) => (RANK[a.need] ?? 3) - (RANK[b.need] ?? 3) || (a.at || Infinity) - (b.at || Infinity));

  // «Atoradas»: stuck Phantom tasks by cause. One with a successor or with
  // commits already landed in its scope is resolved by other means.
  const stuckByCause = new Map();
  for (const t of byRecent(taskRows.filter(t => STUCK.includes(t.status) && !resolutionOf(t)))) {
    const explain = explainReason([t.raw?.reason, t.reason].find(value => typeof value === 'string' && value.trim()) || '');
    if (!stuckByCause.has(explain.cause)) stuckByCause.set(explain.cause, { key: `stuck:${explain.cause}`, group: 'stuck', need: 'failed', cause: explain.cause, label: explain.label, meaning: explain.cause === 'other' ? OTHER_MEANING : explain.meaning, next: explain.next, count: 0, at: 0, items: [] });
    const group = stuckByCause.get(explain.cause), first = t.sessions[0];
    group.items.push({ key: `task:${t.id}`, cardId: t.id, id: t.id, headline: titleOf(text(t.raw?.contract?.goal) || text(t.contract?.goal) || t.title), context: first?.title || '', ...(explain.child ? { child: explain.child } : {}), nodeId: first?.nodeId || null, sessions: t.sessions, at: t.at });
    group.count = group.items.length;
    group.at = Math.max(group.at, t.at || 0);
  }
  const stuck = [...stuckByCause.values()].sort((a, b) => b.count - a.count || b.at - a.at);

  // «Cuando puedas»: nothing is stuck on these, they are the project's housekeeping.
  const later = [];
  if (merges?.available === true) {
    const ready = itemsOf(merges.active).filter(isReadyBranch), unsaved = merges.base?.uncommitted || 0;
    const queued = itemsOf(merges.queue).filter(item => item.status === 'queued').length, integrating = itemsOf(merges.queue).some(item => item.status === 'merging');
    if (ready.length) later.push({ key: 'later:ready', group: 'later', need: 'ready', count: ready.length, headline: `${plural(ready.length, 'rama lista', 'ramas listas')} para ${base}`, context: ready.map(item => text(item.title)).filter(Boolean).slice(0, 3).join(' · ') || 'Con cambios guardados y sin enviar a la cola' });
    if (unsaved > 0) later.push({ key: 'later:unsaved', group: 'later', need: 'unsaved', count: unsaved, headline: `${base} tiene ${plural(unsaved, 'archivo', 'archivos')} sin guardar`, context: 'Las sesiones nuevas no los verán' });
    if (queued && !integrating && merges.enabled !== false && !(merges.orchestrator && merges.orchestrator.running !== false)) later.push({ key: 'later:queue', group: 'later', need: 'queue', count: queued, headline: `Hay ${plural(queued, 'rama', 'ramas')} en cola y nadie integrando`, context: 'El orquestador las integra en orden' });
  }

  const inProgress = byRecent(taskRows.filter(t => RUNNING.includes(t.status) || WAITING.includes(t.status)).map(t => ({ ...t, tone: RUNNING.includes(t.status) ? 'working' : 'waiting' })))
    .sort((a, b) => (a.tone === 'working' ? 0 : 1) - (b.tone === 'working' ? 0 : 1));
  const finished = byRecent([
    ...taskRows.filter(t => CLOSED[t.status]).map(t => ({ ...t, key: `task:${t.id}`, target: 'tasks', tone: CLOSED[t.status] })),
    ...(merges?.available === true ? itemsOf(merges.history) : []).map(item => ({ ...item, key: `merge:${item.id}`, target: 'integration', label: integrationState(item), tone: item.status === 'merged' ? 'done' : 'cancelled', at: timeOf(item) })),
  ]);
  const activeSessions = sessionRows.filter(s => !s.needsYou && !s.linkedTasks.length && !integrations.active.some(item => item.nodeId === s.nodeId) && connected && (s.status === 'running' || s.chatRunning) && (s.tone === 'working' || ['working', 'running', 'doing', 'verifying', 'recovering'].includes(s.agentState || s.agent?.status)));

  // «En curso»: who is working right now, once each and never someone who is
  // already waiting on you above.
  const busy = new Set(claimed), current = [];
  const add = row => { if (row.nodeId && busy.has(row.nodeId)) return; current.push(row); if (row.nodeId) busy.add(row.nodeId); };
  for (const t of inProgress) add({ key: `task:${t.id}`, target: 'tasks', cardId: t.id, nodeId: t.sessions[0]?.nodeId || null, headline: t.title, state: t.label, context: t.sessions[0]?.title || 'Tarea', tone: t.tone, at: t.at });
  for (const item of integrations.active.filter(item => item.status === 'merging' || item.status === 'working')) add({ key: `merge:${item.id || item.nodeId}`, target: 'integration', nodeId: item.nodeId || null, cardId: cardIdOf(item), headline: text(item.title) || 'Una rama', state: item.status === 'merging' ? 'Integrando' : 'Trabajando', context: text(item.step), tone: 'working', at: timeOf(item) });
  for (const s of activeSessions) add({ key: `session:${s.id}`, target: 'terminal', nodeId: s.nodeId, cardId: s.cardId || '', headline: s.title, state: s.label, context: '', tone: 'working', at: 0 });
  for (const item of integrations.ready) add({ key: `merge:${item.id || item.nodeId}`, target: 'integration', nodeId: item.nodeId || null, cardId: cardIdOf(item), headline: text(item.title) || 'Una rama', state: 'En cola', context: '', tone: 'waiting', at: timeOf(item) });

  // «Hoy»: what closed today and what was only worth telling you.
  const today = byRecent([
    ...finished.filter(item => item.at && sameDay(item.at, now)).map(item => ({ key: item.key, target: item.target, cardId: cardIdOf(item) || (item.target === 'tasks' ? item.id : ''), nodeId: item.nodeId || item.sessions?.[0]?.nodeId || null, headline: text(item.title) || activityTitle(item), state: item.label, tone: item.tone, at: item.at })),
    ...notices.filter(n => !n.needsYou && (!n.read || (n.at && sameDay(n.at, now)))).map(n => ({ key: `notice:${n.id}`, target: 'notice', id: n.id, notice: n, cardId: cardIdOf(n), nodeId: n.nodeId || null, headline: text(n.title) || 'Aviso', state: n.read ? '' : 'Nuevo', tone: n.read ? 'read' : 'unread', read: n.read, at: n.at })),
  ]);
  return { integrations, inProgress, finished, activeSessions, sessions: sessionRows, sessionCount: itemsOf(sessions).length, unknownViews: sessionRows.filter(s => !s.descriptor).length, tasks: taskRows, notices, branches, needs, stuck, pending: { now: needs, later, stuck }, count: needs.length, current, today, pendingBranches: branches.filter(b => b.label === 'No integrada').length, unknownBranches: branches.filter(b => b.label === 'Integración desconocida').length, unread: notices.filter(n => !n.read).length };
}
