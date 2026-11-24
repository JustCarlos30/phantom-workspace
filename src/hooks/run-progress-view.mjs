// Vista pura de node.data.agent.run: fase, tono, relojes y bloqueo para la tarjeta.
const TERMINAL = new Set(['completed', 'blocked', 'cancelled']);
const PHASES = {
  waiting: ['Esperando eventos', 'idle'],
  agent: ['Agente trabajando', 'working'],
  checks: ['Ejecutando checks', 'working'],
  repair: ['Reparación', 'attention'],
  judge: ['Juez revisando', 'working'],
  children: ['Hijos', 'working'],
  completed: ['Terminado', 'review'],
  blocked: ['Bloqueado', 'error'],
  cancelled: ['Cancelado', 'idle'],
};
const CATEGORIES = {
  budget: 'Presupuesto agotado',
  rate_limit: 'Límite de uso del proveedor',
  contract: 'Contrato incompleto',
  verification: 'Verificación fallida',
  no_change: 'Sin cambios producidos',
  engine: 'Fallo del motor',
  policy: 'Política bloqueante',
  unknown: 'Bloqueo sin clasificar',
};
const CHILD_STATUS = { done: 'Listo', completed: 'Listo', running: 'En curso', blocked: 'Bloqueado', failed: 'Falló', pending: 'Pendiente', waiting: 'Pendiente', cancelled: 'Cancelado' };

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${seconds % 60 ? ` ${seconds % 60} s` : ''}`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

const time = value => { const t = Date.parse(value); return Number.isFinite(t) ? t : null; };

export function runProgressView(run, now = Date.now()) {
  if (!run || typeof run !== 'object') return null;
  const phase = PHASES[run.phase] ? run.phase : 'waiting';
  const terminal = TERMINAL.has(phase);
  const round = Math.max(0, Number(run.round) || 0);
  const label = phase === 'repair' ? `Reparación ${Math.max(1, round)}` : PHASES[phase][0];
  const started = time(run.startedAt), last = time(run.lastEventAt), observed = time(run.observedAt);
  const sinceObserved = observed == null ? 0 : Math.max(0, now - observed);
  const elapsedMs = terminal ? Math.max(0, Number(run.elapsedMs) || 0)
    : started != null ? Math.max(0, now - started) : Math.max(0, Number(run.elapsedMs) || 0) + sinceObserved;
  const idleMs = terminal ? null
    : last != null ? Math.max(0, now - last)
    : run.lastEventAt === null && !(Number(run.idleMs) > 0) ? null : Math.max(0, Number(run.idleMs) || 0) + sinceObserved;
  const looping = !terminal && !!run.looping, stalled = !terminal && !!run.stalled;
  const warning = looping ? 'Posible bucle de actividad' : stalled ? 'Sin actividad reciente: puede estar atorado' : '';
  const children = run.children || {};
  const items = (Array.isArray(children.items) ? children.items : []).slice(0, 16).map(item => ({
    key: String(item.key), status: item.status, statusLabel: CHILD_STATUS[item.status] || String(item.status || ''), activity: item.activity || '',
  }));
  const total = Number(children.total) || 0;
  const lines = (Array.isArray(run.log) ? run.log : []).slice(-20).map((entry, index) => ({ key: `${index}:${entry.at}`, at: entry.at, text: String(entry.text || '') }));
  const b = run.blocker;
  const blocker = b ? {
    category: b.category,
    title: CATEGORIES[b.category] || CATEGORIES.unknown,
    autonomy: b.autonomy,
    summary: b.summary || '',
    remedy: b.remedy || '',
    commands: Array.isArray(b.commands) ? b.commands.slice(0, 4) : [],
    retryAt: b.retryAt && time(b.retryAt) != null ? new Date(b.retryAt).toLocaleString('es') : '',
    action: b.autonomy === 'ask_user' && b.category === 'budget' ? { id: 'amend', label: 'Ampliar presupuesto' } : null,
  } : null;
  return {
    phase, label, tone: phase === 'blocked' || blocker ? 'error' : PHASES[phase][1], terminal,
    activity: run.activity || '',
    elapsedMs, elapsed: formatDuration(elapsedMs),
    idleMs, idle: idleMs == null ? '' : formatDuration(idleMs),
    level: looping ? 'alert' : stalled ? 'warn' : 'ok', warning, looping, stalled,
    children: { done: Number(children.done) || 0, total, items },
    lines, blocker,
    taskId: run.taskId,
  };
}
