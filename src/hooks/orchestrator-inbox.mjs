// Global orchestrator inbox: one pure model over every project. «Te necesitan»
// semantics come from activityModel (buildActivity); this only regroups them.
import { ago, buildActivity, classifyTask, integrationGroups, itemsOf, leadNeed, sessionState, taskLinks, timeOf } from './activityModel.mjs';
import { explainReason, resolutionOf, titleOf } from './phantom-desk.mjs';

const text = value => typeof value === 'string' ? value : '';
const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const iso = ms => Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
const ms = at => at ? Date.parse(at) : NaN;
const STUCK = ['blocked', 'failed', 'error'];
const BROKEN_NEED = ['conflict', 'checks', 'blocked', 'failed'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function actionOf(need) {
  const id = need.nodeId || need.chatId || need.cardId || need.id || '';
  if (need.target === 'chat' || need.target === 'phantom') return { kind: 'answer-permission', label: need.need === 'question' ? 'Responder' : 'Revisar permiso', target: need.chatId || id };
  if (need.target === 'integration') return { kind: 'review-integration', label: 'Revisar incorporación', target: need.id || need.nodeId || '' };
  if (need.target === 'tasks') return { kind: 'open-card', label: 'Abrir tarea', target: need.cardId || need.id || '' };
  return { kind: 'open-session', label: need.need === 'approval' ? 'Dar permiso' : 'Abrir sesión', target: need.nodeId || need.sessionId || id };
}

function needRow(workspaceId, need) {
  const kind = need.target === 'integration' ? 'integration' : need.target === 'tasks' ? 'task' : 'session';
  const reason = text(need.context) || text(need.code) || text(need.headline);
  return { id: need.key, workspaceId, kind, title: text(need.headline) || text(need.title) || 'Sin título', state: text(need.label) || 'Te necesita', reason, at: iso(need.at), action: actionOf(need), _broken: kind === 'integration' || BROKEN_NEED.includes(need.need) };
}

function stuckRows(workspaceId, workspace, sessions, tasks, cards, connected) {
  const nodes = workspace?.nodes || [], seen = new Set(), rows = [];
  for (const raw of [...itemsOf(tasks), ...itemsOf(cards)]) {
    const id = text(raw?.id);
    if (!raw || (id && seen.has(id))) continue;
    if (id) seen.add(id);
    const status = classifyTask(raw).status;
    if (!STUCK.includes(status) || resolutionOf(raw)) continue;
    const reasonText = [raw.raw?.reason, raw.reason].find(v => typeof v === 'string' && v.trim()) || '';
    const explain = explainReason(reasonText);
    const location = obj(raw.location ?? raw.raw?.location);
    const where = [text(location.branch), text(location.path)].filter(Boolean).join(' · ');
    const linked = taskLinks(raw, itemsOf(sessions), nodes).length > 0;
    const goal = text(raw.raw?.contract?.goal) || text(raw.contract?.goal) || text(raw.title) || id;
    const reason = [reasonText.trim() ? explain.meaning : 'Phantom no informó el motivo.', where && `Rama/ruta: ${where}`].filter(Boolean).join(' · ');
    rows.push({
      id: `card:${id}`, workspaceId, kind: linked ? 'task' : 'card', title: titleOf(goal) || 'Sin título', state: classifyTask(raw).label,
      reason, at: iso(timeOf(raw)),
      action: status === 'blocked' ? { kind: 'open-card', label: 'Abrir tarea', target: id } : { kind: 'retry', label: 'Reintentar', target: id },
      _broken: true,
    });
  }
  return rows;
}

const byUrgency = (a, b) => (b._broken ? 1 : 0) - (a._broken ? 1 : 0) || (ms(a.at) || Infinity) - (ms(b.at) || Infinity) || a.id.localeCompare(b.id);
const clean = ({ _broken, ...row }) => row;

export function buildInbox({ workspaces, perWorkspace, connected = true, now = Date.now() } = {}) {
  const per = obj(perWorkspace);
  let pending = 0, broken = 0;
  const projects = itemsOf(workspaces).filter(w => w && typeof w === 'object' && w.id).map(workspace => {
    const raw = obj(per[workspace.id]);
    const list = v => itemsOf(v).filter(x => x && typeof x === 'object');
    const data = { sessions: list(raw.sessions), tasks: list(raw.tasks), cards: list(raw.cards), chats: list(raw.chats), merges: raw.merges && typeof raw.merges === 'object' ? raw.merges : null };
    const activity = buildActivity({ workspace: { ...workspace, nodes: list(workspace.nodes) }, sessions: data.sessions, tasks: data.tasks, merges: data.merges, chats: data.chats, connected, now });
    const rows = [...activity.needs.map(n => needRow(workspace.id, n)), ...stuckRows(workspace.id, workspace, data.sessions, data.tasks, data.cards, connected)].sort(byUrgency);
    const brokenRows = rows.filter(r => r._broken).map(clean), needsYou = rows.filter(r => !r._broken).map(clean);
    pending += activity.count;
    broken += brokenRows.length;
    const working = activity.current.length;
    return {
      workspaceId: workspace.id, name: text(workspace.name) || workspace.id, broken: brokenRows, needsYou,
      fine: { count: working, line: working ? `${plural(working, 'cosa en marcha', 'cosas en marcha')}, nada que revisar` : 'Todo en orden, nada que revisar' },
    };
  });
  const oldest = p => Math.min(...[...p.broken, ...p.needsYou].map(r => ms(r.at)).filter(Number.isFinite), Infinity);
  projects.sort((a, b) => (b.broken.length > 0) - (a.broken.length > 0) || (b.needsYou.length > 0) - (a.needsYou.length > 0) || oldest(a) - oldest(b) || a.name.localeCompare(b.name));
  return { projects, pending, broken, updatedAt: iso(now) };
}

const SUPERVISOR = {
  disabled: ['Desactivado', 'neutral'], idle: ['En espera', 'neutral'], pending: ['Esperando para resumir', 'working'],
  running: ['Resumiendo', 'working'], error: ['Con error', 'danger'], unavailable: ['No disponible', 'warning'],
  'rate-limited': ['Límite por hora alcanzado', 'warning'],
};

export function supervisorLine(data, now = Date.now()) {
  const d = obj(data), [state, tone] = SUPERVISOR[d.status] || ['Sin datos', 'neutral'];
  const usage = obj(d.usage), count = usage.callsLastHour, max = usage.maxCallsPerHour;
  const at = typeof d.summaryAt === 'number' ? d.summaryAt : Date.parse(d.summaryAt);
  const summaryText = text(d.summary).trim();
  return {
    state, tone,
    calls: Number.isFinite(count) && Number.isFinite(max) ? `${count} de ${max} llamadas en la última hora` : null,
    ago: Number.isFinite(at) ? ago(at, now) : '',
    summary: summaryText ? { text: summaryText, at: Number.isFinite(at) ? new Date(at).toISOString() : null } : null,
    alerts: itemsOf(d.alerts).map(a => typeof a === 'string' ? a : text(a?.message) || text(a?.text) || text(a?.title)).filter(Boolean),
  };
}

// Where a composer message goes: the row's project, else the selected one,
// else the most urgent project.
export function routeTarget(inbox, options) {
  const { selectedWorkspaceId, rowWorkspaceId } = obj(options);
  const ids = itemsOf(inbox?.projects).map(p => p?.workspaceId);
  if (rowWorkspaceId && ids.includes(rowWorkspaceId)) return { workspaceId: rowWorkspaceId, why: 'row' };
  if (selectedWorkspaceId && ids.includes(selectedWorkspaceId)) return { workspaceId: selectedWorkspaceId, why: 'selected' };
  return ids.length ? { workspaceId: ids[0], why: 'urgent' } : { workspaceId: null, why: 'none' };
}

export { integrationGroups, leadNeed, sessionState };
