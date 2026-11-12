import { assert, object, text } from './store.mjs';
import { POLICY_HINTS } from './agent-policy.mjs';

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

// Panels keep the generic type label until someone names them; only those
// adopt a linked card's title so manual names are never overwritten.
export const isDefaultTerminalTitle = title => !title || /^terminal$/i.test(title.trim());
export function cardPanelTitle(cardTitle, max = 80) {
  const flat = cardTitle.replace(/[\x00-\x1f\x7f\s]+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

// A terminal owns its worktree, so an open Phantom task registered on exactly
// that worktree identifies the terminal's work. Only never-linked terminals
// qualify (cardId undefined): an explicit unlink stores '' and is respected.
// Zero or several candidates bind nothing rather than guessing.
const CLOSED_TASK = new Set(['completed', 'cancelled']);
export function autoBindings(nodes, tasks, canonical = p => p) {
  const open = tasks.filter(t => ['task', 'card'].includes(t.kind) && t.id && !CLOSED_TASK.has(t.status) && t.location?.path && t.raw?.contract?.goal);
  const bindings = [];
  for (const node of nodes) {
    if (node.type !== 'terminal' || node.data?.agent?.cardId !== undefined || !node.data?.worktree?.path) continue;
    let home; try { home = canonical(node.data.worktree.path); } catch { continue; }
    const matches = open.filter(t => t.location.path === home);
    if (matches.length === 1) bindings.push({ nodeId: node.id, cardId: matches[0].id, cardTitle: matches[0].raw.contract.goal.slice(0, 512) });
  }
  return bindings;
}

export function agentContext(workspace, node, session) {
  return {
    nodeId: node.id, name: node.title, workspaceId: workspace.id,
    workspace: workspace.canonicalPath, terminalSessionId: session?.id ?? null,
    terminalStatus: session?.status ?? 'lost',
    ...(node.data.agent ?? {}),
    cwd: session?.cwd ?? node.data.cwd ?? workspace.canonicalPath,
    branch: (session ? session.worktree?.branch : node.data.worktree?.branch) ?? null,
    role: node.data.role === 'orchestrator' ? 'orchestrator' : 'worker', integration: workspace.integration?.enabled === true,
    policy: { ...POLICY_HINTS },
    instructions: 'Esta es tu identidad en Phantom Workspace. Consulta este contexto al retomar. Reporta tu paso con el comando report; review significa listo para revisión, no card completada. Phantom verifica el resultado de la card.',
  };
}
