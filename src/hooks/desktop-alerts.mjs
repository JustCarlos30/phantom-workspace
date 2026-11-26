const MERGE = {
  conflict: ['merge-conflict', 'conflicto al incorporar'],
  checks: ['merge-checks', 'fallaron los checks al incorporar'],
  stale: ['merge-stale', 'la rama quedó desactualizada'],
  error: ['merge-error', 'error al incorporar'],
  rejected: ['merge-rejected', 'incorporación rechazada']
};
const PERMISSION = new Set(['needs_approval', 'awaiting_approval', 'awaiting_input', 'waiting_for_input', 'needs_input']);
const SESSION_SOURCES = new Set(['terminal', 'phantom', 'tool']);
const GROUP_LIMIT = 3;

const clip = (text, max) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const acknowledged = item => !!(item?.acknowledgedAt || item?.acknowledged || item?.acked);
const array = value => (Array.isArray(value) ? value : []);

function fact(workspace, kind, key, what, body, target, nodeId) {
  const out = {
    key,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    kind,
    title: clip(`${workspace.name} · ${what}`, 120),
    body: clip(body, 300),
    target
  };
  if (nodeId) out.nodeId = nodeId;
  return out;
}

export function alertFacts(workspaces, supervisorAlerts = []) {
  const facts = [];
  const names = new Map();
  for (const ws of array(workspaces)) {
    if (!ws) continue;
    const workspace = { id: ws.id, name: ws.name || ws.id || 'Proyecto' };
    names.set(ws.id, workspace);
    const nodes = array(ws.nodes);
    const attention = array(ws.attention).filter(item => item && !acknowledged(item));
    const mergeNodes = new Set();
    for (const item of attention) {
      if (item.source !== 'incorporaciones') continue;
      if (item.nodeId) mergeNodes.add(item.nodeId);
      const [kind, what] = MERGE[item.failure] || MERGE.error;
      const parts = [];
      if (item.branch) parts.push(item.branch);
      if (kind === 'merge-conflict') {
        const files = array(item.conflicts).slice(0, 3);
        if (files.length) parts.push(files.join(', '));
      }
      const key = item.eventKey || `merge:${item.ref ?? item.id}:${item.failure}`;
      facts.push(fact(workspace, kind, `${ws.id}:${key}`, what, parts.join(' · '), 'branches', item.nodeId));
    }
    for (const item of attention) {
      if (!SESSION_SOURCES.has(item.source)) continue;
      const failed = item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0);
      if (!failed) continue;
      const node = item.sessionId ? nodes.find(n => n?.data?.sessionId === item.sessionId || n?.sessionId === item.sessionId) : null;
      const nodeId = node?.id || item.nodeId;
      const detail = item.title || item.message || '';
      const code = item.exitCode != null && item.exitCode !== 0 ? `código ${item.exitCode}` : '';
      facts.push(fact(workspace, 'session-failed', `${ws.id}:failed:${item.id ?? item.ref ?? item.sessionId}`, 'una sesión falló', [detail, code].filter(Boolean).join(' · '), 'session', nodeId));
    }
    for (const node of nodes) {
      const status = node?.data?.agent?.status;
      if (!status) continue;
      const stamp = node.data.agent.updatedAt ?? '';
      const label = node.data?.title || node.title || node.id;
      if (status === 'blocked' && !mergeNodes.has(node.id)) {
        facts.push(fact(workspace, 'session-blocked', `${ws.id}:blocked:${node.id}:${stamp}`, 'una sesión quedó bloqueada', label, 'session', node.id));
      } else if (PERMISSION.has(status)) {
        facts.push(fact(workspace, 'permission', `${ws.id}:permission:${node.id}:${stamp}`, 'una sesión necesita tu permiso', label, 'session', node.id));
      }
    }
  }
  for (const alert of array(supervisorAlerts)) {
    if (!alert || (alert.kind !== 'stalled' && alert.kind !== 'unattended')) continue;
    const workspace = names.get(alert.workspaceId) || { id: alert.workspaceId, name: alert.workspaceId || 'Proyecto' };
    const what = alert.kind === 'stalled' ? 'algo se atoró' : 'algo quedó sin atender';
    facts.push(fact(workspace, alert.kind, `${alert.kind}:${alert.workspaceId}:${alert.entityId}:${alert.at}`, what, alert.title || '', 'session', alert.entityId));
  }
  return facts;
}

export function trackAlerts(seen, facts) {
  const list = array(facts);
  const current = new Set(list.map(f => f.key));
  if (!(seen instanceof Set)) return { seen: current, fresh: [] };
  const fresh = list.filter(f => !seen.has(f.key));
  return { seen: current, fresh };
}

export function planNotifications(fresh, { focused = false } = {}) {
  const list = array(fresh);
  if (!list.length) return { toasts: [], native: [] };
  const toNative = f => ({ title: f.title, body: f.body, target: f.target, workspaceId: f.workspaceId, nodeId: f.nodeId });
  let items;
  if (list.length > GROUP_LIMIT) {
    const projects = new Set(list.map(f => f.workspaceId)).size;
    const first = list[0];
    items = [{
      title: `${list.length} avisos en ${projects} ${projects === 1 ? 'proyecto' : 'proyectos'}`,
      body: '',
      target: first.target,
      workspaceId: first.workspaceId,
      nodeId: first.nodeId
    }];
  } else items = list;
  if (focused) return { toasts: items.map(f => (f.body ? `${f.title}: ${f.body}` : f.title)), native: [] };
  return { toasts: [], native: items.map(toNative) };
}

export function pendingCount(facts) {
  return array(facts).length;
}
