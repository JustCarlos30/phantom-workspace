export const STALL_THRESHOLD_MS = 2 * 60 * 1000;
export const LOOP_WINDOW_MS = 5 * 60 * 1000;
export const LOOP_THRESHOLD = 3;

const LOG_MAX = 20;
const QUIET_TOOLS = new Set(['read', 'grep', 'glob', 'list', 'ls']);
const DONE_CHILD = ['completed', 'done', 'failed', 'cancelled', 'blocked', 'settled', 'delivery_accepted'];

const relevantType = type => /^(?:process|child|action|task|run|verification|judge)\./.test(type ?? '');
const timestamp = event => Date.parse(event?.at);
const oneLine = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const clock2 = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

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
  let stage = 'waiting', round = 0, recorded = false, judging = false;
  const children = new Map(), actions = new Map(), log = [];
  const note = (event, text) => { const line = oneLine(text, 190); if (line) log.push({ at: event.at, text: `${clock2(timestamp(event))} ${line}` }); };
  for (const event of selected) {
    const data = event.data ?? {};
    if (event.type === 'run.started') { phase = 'running'; stage = 'waiting'; }
    else if (event.type === 'preflight.admitted') phase = 'running';
    else if (event.type === 'task.running') {
      phase = 'running'; judging = false;
      if (recorded) { round++; recorded = false; stage = 'repair'; note(event, `reparación ${round}`); } else stage = 'agent';
    }
    else if (event.type === 'task.verifying') { phase = 'verifying'; stage = 'checks'; note(event, 'checks en curso'); }
    else if (event.type === 'verification.recorded') {
      phase = 'verifying'; recorded = true; stage = 'checks';
      const verdict = data.ok ?? data.passed ?? data.status;
      note(event, `checks: ${verdict === true || verdict === 'passed' || verdict === 'ok' ? 'ok' : verdict === false || verdict === 'failed' ? 'fallan' : 'registrados'}`);
    }
    else if (event.type === 'judge.started') { stage = 'judge'; judging = true; note(event, 'juez revisando'); }
    else if (event.type === 'judge.verdict') { judging = false; stage = 'checks'; note(event, `juez: ${oneLine(data.verdict ?? data.status ?? data.result ?? 'veredicto', 40)}`); }
    else if (event.type === 'task.completed') { phase = 'completed'; stage = 'completed'; note(event, 'completado'); }
    else if (event.type === 'task.blocked' || event.type === 'run.error') { phase = 'blocked'; stage = 'blocked'; note(event, 'bloqueado'); }
    else if (event.type === 'task.cancelled') { phase = 'cancelled'; stage = 'cancelled'; note(event, 'cancelado'); }

    if ((event.type === 'run.error' || event.type === 'task.blocked') && typeof data.reason === 'string' && data.reason) reason = data.reason;
    if (event.type === 'process.intended') {
      current = { tool: data.kind ?? 'process', target: data.command ?? data.id ?? '', at: event.at };
      if (data.kind === 'check') note(event, `check ${oneLine(data.name ?? data.id ?? data.command, 80)}`);
    }
    if (event.type === 'action.intended') {
      current = { tool: data.tool ?? 'action', target: String(actionTarget(data)).slice(0, 240), at: event.at };
      if (data.callID) actions.set(data.callID, current);
      if (!QUIET_TOOLS.has(String(data.tool ?? '').toLowerCase())) note(event, `${data.tool ?? 'acción'} ${actionTarget(data)}`);
    }
    if (event.type === 'action.observed' && data.callID && actions.has(data.callID)) current = null;
    if (event.type === 'process.exited' && current?.target === data.id) {
      if (current.tool === 'check') note(event, `check ${oneLine(data.id, 80)}: ${data.exitCode === 0 || data.code === 0 ? 'ok' : 'falla'}`);
      current = null;
    }

    if (event.type.startsWith('child.')) {
      const id = data.id ?? data.taskId ?? data.childId ?? event.child_id;
      if (id) children.set(id, ['child.completed', 'child.done', 'child.failed', 'child.cancelled', 'child.blocked', 'child.settled', 'child.delivery_accepted'].includes(event.type) || DONE_CHILD.includes(data.status));
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
  const blockReason = reason;
  if (!reason && looping) reason = 'Repeated action loop detected';
  else if (!reason && stalled) reason = 'No relevant events within the stall threshold';
  const open = [...children.values()].filter(done => !done).length;
  if (!ended && open > 0 && (stage === 'agent' || stage === 'repair')) stage = 'children';
  const activity = oneLine(ended ? { completed: 'completado', blocked: 'bloqueado', cancelled: 'cancelado' }[phase]
    : judging ? 'juez revisando'
    : current ? (current.tool === 'check' ? `check ${current.target}` : `${current.tool}${current.target ? ` · ${current.target}` : ''}`)
    : { waiting: 'esperando arranque', agent: 'agente trabajando', checks: 'comprobaciones', repair: `reparación ${round}`, children: `subtareas ${children.size - open}/${children.size}`, judge: 'juez revisando' }[stage] ?? '', 240);
  return {
    phase, elapsedMs, idleMs, current, children: { done: children.size - open, total: children.size }, stalled, looping, reason,
    stage, round, activity, startedAt: first.at, lastEventAt: last.at, blockReason,
    childItems: [...children].slice(0, 16).map(([key, done]) => ({ key: oneLine(key, 200), status: done ? 'done' : 'running', activity: done ? 'terminado' : 'en curso' })),
    log: log.slice(-LOG_MAX),
  };
}
