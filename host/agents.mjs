import { assert, object, text } from './store.mjs';

export const AGENT_STATUSES = ['idle', 'working', 'blocked', 'review'];
export function validateAgent(agent) {
  object(agent);
  for (const key of Object.keys(agent)) assert(['cardId','cardTitle','providerSessionId','provider','step','status','source','updatedAt'].includes(key), 'Unknown agent field');
  for (const key of ['cardId','cardTitle','providerSessionId','provider','step','source','updatedAt']) if (agent[key] !== undefined) {
    text(agent[key], `agent.${key}`, key === 'step' ? 1000 : 512);
    assert(!/[\x00-\x1f\x7f]/.test(agent[key]), 'Agent fields must be single-line text');
  }
  if (agent.provider !== undefined) assert(agent.provider === 'opencode', 'Unsupported agent provider');
  if (agent.status !== undefined) assert(AGENT_STATUSES.includes(agent.status), 'Invalid agent status');
  if (agent.source !== undefined) assert(['manual','agent'].includes(agent.source), 'Invalid progress source');
  return agent;
}

export function agentContext(workspace, node, session) {
  return {
    nodeId: node.id, name: node.title, workspaceId: workspace.id,
    workspace: workspace.canonicalPath, terminalSessionId: session?.id ?? null,
    terminalStatus: session?.status ?? 'lost',
    ...(node.data.agent ?? {}),
    instructions: 'Esta es tu identidad en Phantom Workspace. Consulta este contexto al retomar. Reporta tu paso con el comando report; review significa listo para revisión, no card completada. Phantom verifica el resultado de la card.',
  };
}
