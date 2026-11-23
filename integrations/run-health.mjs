export const STALL_THRESHOLD_MS = 2 * 60 * 1000;
export const LOOP_WINDOW_MS = 5 * 60 * 1000;
export const LOOP_THRESHOLD = 3;

const relevantType = type => /^(?:process|child|action|task|run)\./.test(type ?? '');
const timestamp = event => Date.parse(event?.at);

function actionTarget(data) {
  const args = data.args ?? {};
  return args.filePath ?? args.path ?? args.pattern ?? args.command ?? args.url ?? args.description ?? '';
}

export function summarizeRunHealth(events, now = Date.now(), opts = {}) {
  const stallMs = opts.stallMs ?? STALL_THRESHOLD_MS;
  const loopWindowMs = opts.loopWindowMs ?? LOOP_WINDOW_MS;
  const loopThreshold = opts.loopThreshold ?? LOOP_THRESHOLD;
  const clock = typeof now === 'number' ? now : Date.parse(now);
  const ordered = (Array.isArray(events) ? events : []).filter(event => relevantType(event?.type) && Number.isFinite(timestamp(event))).sort((a, b) => timestamp(a) - timestamp(b));
  const latestRun = [...ordered].reverse().find(event => event.type === 'run.started')?.run_id;
  const selected = latestRun === undefined ? ordered : ordered.filter(event => event.run_id === latestRun);
  const first = selected[0], last = selected.at(-1);
  if (!first) return { phase: 'idle', elapsedMs: 0, idleMs: 0, current: null, children: { done: 0, total: 0 }, stalled: false, looping: false, reason: null };

  let phase = 'running', current = null, reason = null;
  const children = new Map(), actions = new Map();
  for (const event of selected) {
    const data = event.data ?? {};
    if (event.type === 'run.started') phase = 'running';
    else if (event.type === 'preflight.admitted') phase = 'running';
    else if (event.type === 'task.verifying' || event.type === 'verification.recorded') phase = 'verifying';
    else if (event.type === 'task.completed' || event.type === 'run.completed') phase = 'completed';
    else if (event.type === 'task.blocked' || event.type === 'run.error') phase = 'blocked';
    else if (event.type === 'task.cancelled') phase = 'cancelled';

    if ((event.type === 'run.error' || event.type === 'task.blocked') && typeof data.reason === 'string' && data.reason) reason = data.reason;
    if (event.type === 'process.intended') current = { tool: data.kind ?? 'process', target: data.command ?? data.id ?? '', at: event.at };
    if (event.type === 'action.intended') {
      current = { tool: data.tool ?? 'action', target: String(actionTarget(data)).slice(0, 240), at: event.at };
      if (data.callID) actions.set(data.callID, current);
    }
    if (event.type === 'action.observed' && data.callID && actions.has(data.callID)) current = null;
    if (event.type === 'process.exited' && current?.target === data.id) current = null;

    if (event.type.startsWith('child.')) {
      const id = data.id ?? data.taskId ?? data.childId ?? event.child_id;
      if (id) children.set(id, ['child.completed', 'child.done', 'child.failed', 'child.cancelled', 'child.blocked', 'child.settled', 'child.delivery_accepted'].includes(event.type) || ['completed', 'done', 'failed', 'cancelled', 'blocked', 'settled', 'delivery_accepted'].includes(data.status));
    }
  }

  const ended = ['completed', 'blocked', 'cancelled'].includes(phase);
  const elapsedMs = Math.max(0, (ended ? timestamp(last) : clock) - timestamp(first));
  const idleMs = Math.max(0, (ended ? timestamp(last) : clock) - timestamp(last));
  const signatures = selected.filter(event => event.type === 'action.intended' && timestamp(event) >= clock - loopWindowMs).map(event => `${event.data?.tool ?? ''}\0${actionTarget(event.data ?? {})}`);
  const counts = new Map();
  for (const signature of signatures) counts.set(signature, (counts.get(signature) ?? 0) + 1);
  const looping = !ended && [...counts.values()].some(count => count >= loopThreshold);
  const stalled = !ended && idleMs >= stallMs;
  if (!reason && looping) reason = 'Repeated action loop detected';
  else if (!reason && stalled) reason = 'No relevant events within the stall threshold';
  return { phase, elapsedMs, idleMs, current, children: { done: [...children.values()].filter(Boolean).length, total: children.size }, stalled, looping, reason };
}
