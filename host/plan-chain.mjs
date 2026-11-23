// Pure decision: what a finished Phantom task means for the terminal plan whose running phase it backs.
export const planNote = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || 'desconocido';

export function nextPlanStep(plan, { taskId, taskStatus, controllerStatus } = {}, now = new Date().toISOString()) {
  const index = plan?.phases?.findIndex(p => p.status === 'running' && p.taskId && p.taskId === taskId) ?? -1;
  if (index < 0) return { plan, launch: null };
  const next = structuredClone(plan), phase = next.phases[index];
  next.updatedAt = now;
  if (taskStatus !== 'completed') {
    Object.assign(phase, { status: 'blocked', endedAt: now, note: planNote(`Encargo ${taskStatus || 'desconocido'}; controlador ${controllerStatus || 'desconocido'}`) });
    return { plan: next, launch: null };
  }
  Object.assign(phase, { status: 'done', endedAt: now });
  const following = next.phases[index + 1];
  if (next.chain === true && following?.status === 'pending' && following.taskId) {
    Object.assign(following, { status: 'running', startedAt: now }); delete following.endedAt;
    return { plan: next, launch: following.taskId };
  }
  return { plan: next, launch: null };
}
