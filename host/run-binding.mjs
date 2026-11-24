// Pure decisions for the visible state of a terminal that launched a Phantom run.
import { cardTitleOf } from './agents.mjs';
import { classifyBlocker } from '../integrations/run-blockers.mjs';

const line = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// The terminal node that launched the run, whatever the medium (`via`); null for the main chat or other node types.
export function cardNode(nodes, origin) {
  if (typeof origin?.nodeId !== 'string') return null;
  const node = (nodes ?? []).find(n => n?.id === origin.nodeId);
  return node?.type === 'terminal' ? node : null;
}

export function startPatch({ taskId, contract, now = new Date().toISOString() } = {}) {
  const id = line(taskId, 200);
  return { cardId: id, cardTitle: cardTitleOf(contract?.goal), status: 'working', step: `Encargo ${id} en curso`, source: 'agent', updatedAt: now };
}

// Closes the live `run` object (if the card had one) with the final phase and blocker.
function finalRun(run, { taskId, completed, cancelled, blocker, now }) {
  if (!run) return {};
  const phase = completed ? 'completed' : cancelled ? 'cancelled' : 'blocked';
  return { run: { ...run, taskId: line(taskId, 200), phase, activity: phase === 'completed' ? 'completado' : phase === 'cancelled' ? 'cancelado' : 'bloqueado', stalled: false, looping: false, idleMs: 0, blocker: completed ? null : blocker ?? null, observedAt: now } };
}

// Returns the patch for node.data.agent, or null when the terminal no longer belongs to this task.
export function finishPatch({ agent, taskId, controller = {}, task, now = new Date().toISOString() } = {}) {
  if (!taskId || agent?.cardId !== taskId) return null;
  const id = line(taskId, 200);
  if (task?.status === 'completed' && controller.status !== 'lost') {
    return { status: 'review', step: `Encargo ${id} terminado: verifica que funciona de verdad y si necesita algo más`, source: 'agent', updatedAt: now, ...finalRun(agent.run, { taskId, completed: true, now }) };
  }
  const reason = line(task?.blockedReason ?? task?.reason ?? task?.run?.blockedReason ?? task?.error ?? controller.error, 600);
  const state = line(task?.status, 60) || 'desconocido';
  const why = reason || (controller.status === 'lost' ? 'el run se perdió' : `estado ${state}, controlador ${line(controller.status, 40) || 'desconocido'}`);
  const blocker = classifyBlocker(reason, { ...task, id: line(taskId, 200) }, Date.parse(now));
  return { status: 'blocked', step: line(`Encargo ${id} sin completar: ${why}`, 1000), source: 'agent', updatedAt: now, ...finalRun(agent.run, { taskId, cancelled: task?.status === 'cancelled', blocker, now }) };
}
