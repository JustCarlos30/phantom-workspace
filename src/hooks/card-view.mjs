const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const arr = v => Array.isArray(v) ? v : [];
const str = v => typeof v === 'string' ? v : '';
const finite = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const meta = {
  'task.created': ['Tarea creada', 'info'], 'run.started': ['Ejecución iniciada', 'info'],
  'preflight.admitted': ['Preparación admitida', 'ok'], 'engine.connected': ['Motor conectado', 'ok'],
  'model.requested': ['Modelo solicitado', 'info'], 'action.intended': ['Acción propuesta', 'info'],
  'action.observed': ['Acción observada', 'muted'], 'task.verifying': ['Verificando checks', 'info'],
  'verification.recorded': ['Verificación registrada', 'info'], 'task.running': ['Tarea en ejecución', 'info'],
  'usage.unavailable': ['Consumo no disponible', 'warn'], 'workspace.observed_after_stop': ['Workspace observado tras detener', 'muted'],
  'run.error': ['Error de ejecución', 'bad'], 'task.blocked': ['Tarea bloqueada', 'bad'],
  'task.completed': ['Tarea completada', 'ok'], 'task.project_assigned': ['Proyecto asignado', 'info'],
  'process.intended': ['Proceso propuesto', 'muted'], 'process.prepared': ['Proceso preparado', 'muted'],
  'process.authorized': ['Proceso autorizado', 'muted'], 'process.exited': ['Proceso finalizado', 'muted'],
};
export function eventMeta(type) {
  const [label, tone] = meta[type] || [str(type) || 'Evento desconocido', 'muted'];
  return { label, tone, group: str(type).split('.')[0] || 'unknown' };
}
function summaryOf(data) {
  if (typeof data === 'string') return data.slice(0, 1000);
  const d = obj(data), pieces = [];
  for (const key of ['reason', 'message', 'summary', 'check', 'path', 'file', 'model', 'requestedModel']) {
    const v = d[key]; const text = str(v) || str(obj(v).name) || str(obj(v).message) || str(obj(v).reason);
    if (text) pieces.push(text);
  }
  if (typeof d.passed === 'boolean') pieces.push(d.passed ? '✓ Correcto' : '✗ Fallido');
  if (finite(d.exitCode) !== null) pieces.push(`Salida ${d.exitCode}`);
  if (Array.isArray(d.argv)) pieces.push(d.argv.filter(v => typeof v === 'string').join(' '));
  return [...new Set(pieces)].join(' · ').slice(0, 1000) || 'Sin resumen informado';
}
export function timelineOf(events, { collapseProcess = true } = {}) {
  const entries = arr(Array.isArray(events) ? events : events?.items).filter(e => e && typeof e === 'object').map((e, index) => ({ ...e, ...eventMeta(e.type), summary: summaryOf(e.data), index }));
  entries.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || (a.seq ?? a.index) - (b.seq ?? b.index));
  const groups = [];
  for (const event of entries) {
    const last = groups.at(-1);
    if (collapseProcess && event.group === 'process' && last?.group === 'process' && last.run_id === event.run_id && last.task_id === event.task_id) {
      const members = last.events || [last];
      groups[groups.length - 1] = { ...event, label: 'Actividad de procesos', summary: `${members.length + 1} eventos · ${event.summary}`, events: [...members, event] };
    } else groups.push(event);
  }
  return groups.reverse();
}
export function checkResultsOf(contract, run) {
  const rounds = arr(run?.evidence), checks = arr(rounds.at(-1)?.checks);
  return arr(contract?.checks).map((value, index) => {
    const check = obj(value), name = str(check.name) || `Check ${index + 1}`;
    const result = checks.find(r => r && r.name === check.name);
    const state = result?.passed === false || (finite(result?.exitCode) !== null && result.exitCode !== 0) ? 'failed' : result?.passed === true || result?.exitCode === 0 ? 'passed' : 'pending';
    const argv = arr(check.argv).filter(v => typeof v === 'string');
    return { name, command: argv.join(' '), state, detail: result ? [finite(result.exitCode) !== null ? `Salida ${result.exitCode}` : '', finite(result.durationMs) !== null ? `${result.durationMs} ms` : '', str(result.reason)].filter(Boolean).join(' · ') : 'Sin resultado en la última ronda' };
  });
}
export function budgetUsageOf(budget, run) {
  const b = obj(budget), r = obj(run);
  const start = Date.parse(r.startedAt), end = r.endedAt ? Date.parse(r.endedAt) : Date.now();
  const time = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  return [['Turnos', finite(r.turns), finite(b.maxTurns)], ['Herramientas', finite(r.tools), finite(b.maxTools)], ['Tiempo (ms)', time, finite(b.timeoutMs)], ['Reparaciones', run ? Math.max(0, arr(r.evidence).length - 1) : null, finite(b.maxRepairs)]].map(([label, used, limit]) => ({ label, used, limit, ratio: used === null || limit === null ? null : limit > 0 ? used / limit : used > 0 ? Infinity : 0 }));
}
export function tokensOf(run) {
  const total = { total: 0, input: 0, output: 0, available: false };
  for (const report of arr(run?.usage?.reports)) {
    const t = obj(report?.tokens);
    if (['total', 'input', 'output'].some(key => finite(t[key]) !== null)) total.available = true;
    total.input += finite(t.input) ?? 0; total.output += finite(t.output) ?? 0;
    total.total += finite(t.total) ?? ((finite(t.input) ?? 0) + (finite(t.output) ?? 0));
  }
  return total;
}
export function childrenOf(detail, catalogItems = []) {
  const d = obj(detail?.task || detail), plan = arr(d.contract?.coordination?.children);
  const registered = [...arr(d.childTasks), ...arr(d.children), ...arr(catalogItems).map(v => v?.raw || v).filter(v => v && (v.parentId === d.id || v.parentTaskId === d.id || v.parent_id === d.id || v.parent === d.id || v.parent?.id === d.id))];
  const matches = (task, key) => task && (task.key === key || task.childKey === key || task.coordinationKey === key);
  const latest = tasks => tasks.reduce((previous, task) => {
    if (!previous) return task;
    const updated = str(task.updatedAt), previousUpdated = str(previous.updatedAt);
    if (updated && previousUpdated && updated !== previousUpdated) return updated > previousUpdated ? task : previous;
    return str(task.createdAt) >= str(previous.createdAt) ? task : previous;
  }, undefined);
  const nodes = plan.map((child, index) => {
    const c = obj(child), key = str(c.key) || `hijo-${index + 1}`;
    const task = latest(registered.filter(t => matches(t, key)));
    return { key, goal: str(c.goal) || key, scope: arr(c.scope).filter(v => typeof v === 'string'), dependencies: arr(c.dependencies).filter(v => typeof v === 'string'), status: str(task?.status) || 'sin registrar', ...(task?.id ? { taskId: task.id } : {}) };
  });
  const extras = new Map();
  for (const task of registered) {
    if (!task || typeof task !== 'object' || nodes.some(n => matches(task, n.key))) continue;
    const key = str(task.key) || str(task.childKey) || str(task.coordinationKey) || str(task.id);
    extras.set(key, latest([extras.get(key), task].filter(Boolean)));
  }
  for (const [key, task] of extras) {
    nodes.push({ key, goal: str(task.contract?.goal) || str(task.goal) || str(task.id), scope: arr(task.contract?.scope), dependencies: arr(task.contract?.dependencies), status: str(task.status) || 'sin registrar', taskId: task.id });
  }
  return { nodes, edges: nodes.flatMap(n => n.dependencies.map(from => ({ from, to: n.key }))) };
}
export function changedFilesOf(run) { return [...new Set(arr(run?.evidence).flatMap(round => arr(round?.changed)).filter(v => typeof v === 'string'))]; }
