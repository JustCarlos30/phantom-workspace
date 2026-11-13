// What the Phantom launcher and dock say about the project's orchestration,
// read only from workspace state: the orchestrator node (a terminal with
// data.role 'orchestrator') and the Incorporaciones queue.

export const DOCK_TABS = ['chat', 'orchestrator'];

export function orchestratorNode(workspace) {
  return workspace?.nodes?.find(node => node.type === 'terminal' && node.data?.role === 'orchestrator') || null;
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// tone: 'off' (Incorporaciones inactive), 'idle', 'working', 'waiting'
// (requests queued with nobody to integrate them) or 'attention'.
export function dockStatus(workspace) {
  const integration = workspace?.integration?.enabled === true;
  const node = orchestratorNode(workspace);
  const queue = Array.isArray(workspace?.integration?.queue) ? workspace.integration.queue : [];
  const queued = queue.filter(item => item.status === 'queued' || item.status === 'merging').length;
  const merging = queue.some(item => item.status === 'merging');
  const agent = node?.data?.agent?.status || null;
  const orchestrator = node ? { id: node.id, title: node.title || 'Orquestador', chat: !!node.data?.chat?.provider, agent, step: node.data?.agent?.step || '' } : null;
  let tone, label;
  if (!integration) { tone = 'off'; label = 'Incorporaciones desactivado'; }
  else if (!orchestrator) { tone = queued ? 'waiting' : 'idle'; label = queued ? `${plural(queued, 'solicitud espera', 'solicitudes esperan')} sin sesión orquestadora` : 'Sin sesión orquestadora'; }
  else if (agent === 'blocked') { tone = 'attention'; label = `${orchestrator.title} está bloqueado`; }
  else if (merging || agent === 'working') { tone = 'working'; label = merging ? `${orchestrator.title} está incorporando` : `${orchestrator.title} está trabajando`; }
  else { tone = 'idle'; label = `${orchestrator.title} en espera`; }
  if (integration && queued && orchestrator) label += ` · ${plural(queued, 'solicitud', 'solicitudes')} en cola`;
  return { integration, orchestrator, queued, merging, tone, label };
}
