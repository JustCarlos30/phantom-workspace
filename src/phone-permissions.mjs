const TERMINAL_ACTIONS = [
  ['terminal.write', 'escribir en la terminal'],
  ['terminal.stop', 'detener la terminal'],
];
const CHAT_ACTIONS = [
  ['chat.send', 'enviar mensajes'],
  ['chat.stop', 'parar turnos'],
  ['chat.question.answer', 'responder preguntas del agente'],
  ['chat.permission.answer', 'responder permisos del agente'],
];
const PROJECT_ACTIONS = [
  ['terminal.create', 'crear terminales'],
  ['terminal.agent.handoff', 'transferir sesión a un agente'],
  ['limits.read', 'leer límites de uso'],
];
const toActions = list => list.map(([capability, label]) => ({ capability, label }));

export function projectActions() {
  return toActions(PROJECT_ACTIONS);
}

export function chatActions() {
  return toActions(CHAT_ACTIONS);
}

// Usa hasChat, tipo y data.chat reportados por el host; no infiere chat de otras señales.
export function nodeActions(node) {
  const isTerminal = node?.type === 'terminal';
  const hasChat = node?.hasChat === true || node?.type === 'chat' || (isTerminal && Boolean(node?.data?.chat));
  return toActions([...(isTerminal ? TERMINAL_ACTIONS : []), ...(hasChat ? CHAT_ACTIONS : [])]);
}

export function standardGrants(workspaces = []) {
  return workspaces.flatMap(({ id }) => [
    { workspaceId: id, nodeId: `phantom:${id}`, capabilities: ['read', 'chat.send', 'chat.stop'] },
    { workspaceId: id, nodeId: null, capabilities: ['workspace.read'] },
  ]);
}

export function grantsFromSelection(selection, workspaces = []) {
  return (selection.grants ?? []).flatMap(grant => {
    const workspace = workspaces.find(item => item.id === grant.workspaceId);
    if (!workspace || (grant.nodeId !== null && grant.nodeId !== `phantom:${workspace.id}` && !workspace.nodes?.some(node => node.id === grant.nodeId))) return [];
    const read = grant.nodeId === null ? 'workspace.read' : 'read';
    if (!grant.capabilities?.includes(read)) return [];
    return [{ workspaceId: grant.workspaceId, nodeId: grant.nodeId, capabilities: [...new Set(grant.capabilities)] }];
  });
}

export function selectionFromGrants(device, workspaces = []) {
  const selection = { grants: device.grants ?? [], acknowledgeAgentAuthority: device.acknowledgeAgentAuthority === true };
  return { ...selection, grants: grantsFromSelection(selection, workspaces) };
}

export function needsAcknowledgement(selection, workspaces = []) {
  return grantsFromSelection(selection, workspaces).some(grant => grant.nodeId === `phantom:${grant.workspaceId}` ||
    workspaces.find(workspace => workspace.id === grant.workspaceId)?.nodes?.some(node => node.id === grant.nodeId && node.role === 'orchestrator'));
}
