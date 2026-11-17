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
