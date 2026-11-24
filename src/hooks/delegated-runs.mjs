// Encargos Phantom lanzados desde una terminal/chat (origin.nodeId) y su efecto en la fase del turno.
const time = item => Date.parse(item?.endedAt ?? item?.createdAt ?? '') || 0;

export function delegatedRuns(nodeId, controllers) {
  const own = (Array.isArray(controllers) ? controllers : []).filter(item => item && item.origin?.nodeId === nodeId && typeof nodeId === 'string' && nodeId);
  const live = own.filter(item => item.status === 'running');
  const finished = own.filter(item => item.status !== 'running');
  const latest = own.reduce((best, item) => !best || time(item) >= time(best) ? item : best, null);
  return { live, finished, latest };
}

// Un turno idle con encargos vivos es 'delegating'; al acabar, el resultado del último encargo guía el pulso.
export function delegationState(phase, runs) {
  const live = runs?.live?.length ?? 0;
  if (phase === 'idle' && live) return { phase: 'delegating', live, outcome: null };
  if (phase !== 'idle' || live) return { phase, live, outcome: null };
  const status = runs?.latest?.status;
  return { phase, live, outcome: status === 'failed' || status === 'lost' ? 'attention' : status === 'completed' ? 'turn' : null };
}
