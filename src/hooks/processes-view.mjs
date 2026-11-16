export function processesView(nodes = [], sessions = [], services = []) {
  return nodes.filter(node => node.type === 'terminal' && node.data?.process)
    .sort((a,b) => b.data.process.createdAt.localeCompare(a.data.process.createdAt))
    .map(node => {
      const process = node.data.process, sessionId = node.data.sessionId;
      return { ...process, processId:process.id, nodeId:node.id, sessionId,
        status:sessions.some(session => session.id === sessionId && session.nodeId === node.id && session.status === 'running') ? 'running' : 'stopped',
        services:sessionId ? services.filter(service => service.source === 'managed' && service.owner?.sessionId === sessionId) : [],
      };
    });
}
