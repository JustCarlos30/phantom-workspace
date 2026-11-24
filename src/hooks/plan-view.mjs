// Pure view model for an agent plan (node.data.plan). No plan → null.
export function planSummary(plan) {
  const phases = Array.isArray(plan?.phases) ? plan.phases : null;
  if (!phases || !phases.length) return null;
  const total = phases.length;
  const done = phases.filter(phase => phase.status === 'done').length;
  if (done === total) return { total, done, index: total, current: null, label: `Plan completo · ${total} fases`, tone: 'done' };
  let position = phases.findIndex(phase => phase.status === 'running');
  if (position === -1) position = phases.findIndex(phase => phase.status === 'blocked');
  if (position === -1) position = phases.findIndex(phase => phase.status !== 'done');
  const current = phases[position];
  const tone = current.status === 'running' ? 'working' : current.status === 'blocked' ? 'blocked' : 'idle';
  return { total, done, index: position + 1, current, label: `Fase ${position + 1} de ${total} · ${current.title}`, tone };
}

export function phaseState(phase) {
  if (phase?.status === 'running') return 'En curso';
  if (phase?.status === 'done') return 'Hecha';
  if (phase?.status === 'blocked') return 'Bloqueada';
  return phase?.taskId ? 'Lista' : 'Sin encargo todavía';
}
