// Pure model for the Phantom Cards desk ("Mesa del ahora").
// Native status stays the authority; zones only order what Phantom reports.
import { stateOf, goalOf, contractOf } from './plugin-model.mjs';
import { locationKey } from './branches-model.mjs';

export const STATUS = {
  blocked: { label: 'Bloqueada', tone: 'blocked' },
  running: { label: 'En curso', tone: 'live' },
  verifying: { label: 'Verificando', tone: 'live' },
  recovering: { label: 'Recuperando', tone: 'live' },
  ready: { label: 'Lista', tone: 'idle' },
  completed: { label: 'Completada', tone: 'done' },
  cancelled: { label: 'Cancelada', tone: 'muted' },
  failed: { label: 'Falló', tone: 'blocked' },
};
export const statusLabel = status => STATUS[status]?.label || (status === 'unknown' ? 'Estado no informado' : status);
export const statusTone = status => STATUS[status]?.tone || 'idle';

export const ZONES = [
  { id: 'decide', title: 'Espera tu decisión', empty: 'Nada bloqueado. Phantom no espera ninguna decisión tuya.' },
  { id: 'live', title: 'Corriendo ahora', empty: 'No hay ejecuciones en curso.' },
  { id: 'resolved', title: 'Probablemente resueltas', empty: 'Ninguna bloqueada parece resuelta por otra vía.' },
  { id: 'queue', title: 'En cola', empty: 'Sin Cards en cola.' },
  { id: 'history', title: 'Historial', empty: 'Sin Cards completadas ni canceladas.' },
];

// Title: the line under "## Título" if present; otherwise the first line or sentence.
export function titleOf(goal, max = 90) {
  const text = String(goal || '').trim();
  const lines = text.split(/\r?\n/);
  const heading = lines.findIndex(line => /^#{1,6}\s*t[ií]tulo\s*$/i.test(line.trim()));
  let title = heading >= 0 ? lines.slice(heading + 1).find(line => line.trim() && !/^#{1,6}\s/.test(line.trim())) || '' : '';
  if (!title.trim()) title = (lines.find(line => line.trim() && !/^#{1,6}\s/.test(line.trim())) || lines.find(line => line.trim()) || '').replace(/^#{1,6}\s*/, '');
  title = title.trim().split(/(?<=[.!?])\s+/)[0];
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

export function sectionsOf(goal) {
  const text = String(goal || '').trim();
  const sections = []; let current = { heading: '', body: [] };
  for (const line of text.split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) { if (current.heading || current.body.join('').trim()) sections.push(current); current = { heading: match[1], body: [] }; }
    else current.body.push(line);
  }
  sections.push(current);
  return sections.map(section => ({ heading: section.heading, body: section.body.join('\n').trim() }));
}

const CAUSES = [
  ['budget', /presupuesto de (tiempo|tokens|turnos|herramientas)[^.]*agotado|budget.*exhausted/i, 'Se quedó sin tiempo/tokens', 'Phantom detuvo al agente al agotar el presupuesto antes de terminar.', 'Amplía el presupuesto o divide la tarea'],
  ['verification', /verificaci[oó]n fallida/i, 'Tests en rojo', 'El agente hizo cambios, pero algún check siguió fallando tras los intentos de reparación.', 'Abre Verificación para ver qué check falló; reintenta o amplía el alcance'],
  ['no-change', /no hay un cambio atribuible/i, 'El agente no hizo cambios', 'Terminó sin un cambio dentro del alcance que cumpla el encargo.', 'Lee su mensaje: suele pedir un archivo o permiso que falta'],
  ['weak-checks', /comprobaciones no acreditan pruebas/i, 'Checks insuficientes', 'Los checks declarados no demuestran que el cambio funcione.', 'Añade un check que pruebe el resultado y vuelve a ejecutar'],
  ['baseline', /regresi[oó]n previa/i, 'Ya fallaba antes', 'Un check fallaba antes de que el agente tocara nada.', 'Arregla primero ese check en main o quítalo del contrato'],
  ['checks-mutate', /los checks modificaron el artefacto/i, 'Los checks cambian archivos', 'Ejecutar los checks modificó lo que el agente entregó.', 'Haz que los checks no escriban en el alcance y reintenta'],
  ['baseline-dirty', /comprobaciones iniciales modificaron el workspace/i, 'Los checks ensucian el proyecto', 'Las pruebas iniciales dejaron archivos modificados antes de empezar.', 'Haz que los checks no escriban en el proyecto y reintenta'],
  ['snapshot', /snapshot no soporta|EISDIR/i, 'Alcance no admitido', 'El alcance incluye una ruta que Phantom no puede fotografiar (por ejemplo, una carpeta).', 'Declara archivos concretos en el alcance'],
  ['git-dirty', /git_dirty/i, 'Hay cambios sin guardar', 'El proyecto tenía cambios sin confirmar y Phantom no quiso mezclarlos.', 'Confirma o aparta tus cambios y reintenta'],
  ['judge', /judge_rejected/i, 'El revisor lo rechazó', 'Un juez revisó el cambio y no lo aceptó.', 'Lee su motivo en Detalles técnicos y ajusta el encargo'],
  ['out-of-scope', /cambio fuera del mandato/i, 'Tocó archivos fuera del alcance', 'El agente cambió archivos que el contrato no permitía.', 'Amplía el alcance o aclara el encargo y reintenta'],
  ['workspace-gone', /workspace desaparecido/i, 'Se perdió su carpeta', 'La carpeta de trabajo de la tarea ya no existe.', 'Vuelve a ejecutar o crea un reemplazo'],
  ['engine', /fetch failed|model is not supported|claude_code_refused|motor report[oó] un error/i, 'Falló el motor', 'El agente no pudo ejecutarse (conexión, modelo no admitido o error del motor).', 'Reintenta; si se repite, cambia el modelo en Opciones de ejecución'],
];

export function explainReason(reason) {
  const text = String(reason || '').trim();
  const child = /^Hijo\s+([^:]+):\s*/i.exec(text);
  const body = child ? text.slice(child[0].length) : text;
  const found = CAUSES.find(([, pattern]) => pattern.test(body));
  const [cause, label, meaning, next] = found ? [found[0], found[2], found[3], found[4]] : ['other', 'Phantom la bloqueó', body || 'Phantom no informó el motivo.', 'Abre la Card y lee qué pasó antes de decidir'];
  return { cause, label, meaning, next, ...(child ? { child: child[1].trim() } : {}) };
}

export function resolutionOf(card) {
  const resolution = card?.resolution ?? card?.item?.resolution;
  if (!resolution || typeof resolution !== 'object') return null;
  if (resolution.supersededBy) return 'superseded';
  if (Number(resolution.landed) > 0) return 'landed';
  return null;
}

export function zoneOf(status, controllerStatus, resolved = false) {
  if (status === 'blocked') return resolved ? 'resolved' : 'decide';
  if (['running', 'verifying', 'recovering'].includes(status) || controllerStatus === 'running') return 'live';
  if (status === 'completed' || status === 'cancelled') return 'history';
  return 'queue';
}

const time = value => { const t = Date.parse(value); return Number.isFinite(t) ? t : 0; };
const queueRank = status => status === 'ready' ? 0 : status === 'unknown' ? 1 : 2;

export function groupByCause(cards = []) {
  const groups = new Map();
  for (const card of cards) {
    const explain = card.explain || explainReason(card.reason);
    if (!groups.has(explain.cause)) groups.set(explain.cause, { cause: explain.cause, label: explain.label, cards: [] });
    groups.get(explain.cause).cards.push(card);
  }
  return [...groups.values()].sort((a, b) => b.cards.length - a.cards.length);
}

export function buildDesk(items = [], controllers = [], query = '', location = '') {
  const text = query.trim().toLowerCase();
  const all = items.map(item => {
    const raw = item.raw || {};
    const status = stateOf(item);
    const controller = controllers.filter(entry => entry.taskId === item.id).at(-1) || null;
    const reason = [raw.reason, raw.blockReason, raw.blockedReason, raw.admission?.reason].find(value => typeof value === 'string' && value.trim()) || '';
    const resolution = status === 'blocked' ? resolutionOf(item) : null;
    const goal = goalOf(item);
    return {
      id: item.id, goal, title: titleOf(goal) || item.id, status, kind: item.kind || raw.kind || 'card', reason,
      explain: status === 'blocked' ? explainReason(reason) : null, resolution,
      updatedAt: raw.updatedAt || raw.createdAt || null, controller,
      dependencies: Array.isArray(contractOf(raw).dependencies) ? contractOf(raw).dependencies : [],
      zone: zoneOf(status, controller?.status, Boolean(resolution)), item, location: locationKey(item),
    };
  });
  const byId = new Map(all.map(card => [card.id, card]));
  for (const card of all) {
    if (card.resolution === 'superseded') {
      const by = card.item.resolution.supersededBy;
      const known = byId.get(by.id);
      card.resolutionText = `Sustituida por ${known?.title || by.id} · ${statusLabel(by.status || known?.status || 'unknown')}`;
    } else if (card.resolution === 'landed') {
      const landed = Number(card.item.resolution.landed);
      card.resolutionText = `Sus archivos cambiaron en main después · ${landed} ${landed === 1 ? 'commit' : 'commits'}`;
    }
  }
  const cards = all.filter(card => !location || card.location === location).filter(card => !text || `${card.goal}\n${card.id}\n${(contractOf(card.item.raw).scope || []).join('\n')}`.toLowerCase().includes(text));
  const zones = Object.fromEntries(ZONES.map(zone => [zone.id, []]));
  for (const card of cards) zones[card.zone].push(card);
  const recent = (a, b) => time(b.updatedAt) - time(a.updatedAt);
  zones.decide.sort(recent); zones.live.sort(recent); zones.resolved.sort(recent); zones.history.sort(recent);
  zones.queue.sort((a, b) => queueRank(a.status) - queueRank(b.status) || recent(a, b));
  const counts = Object.fromEntries(Object.keys(STATUS).map(key => [key, cards.filter(card => card.status === key).length]));
  return { cards, zones, counts, total: cards.length };
}

export function runSummary(run) {
  const files = Array.isArray(run?.summary?.files) ? run.summary.files : [];
  const rounds = Array.isArray(run?.evidence?.verification) ? run.evidence.verification : [];
  const last = rounds.filter(round => round?.available).at(-1);
  const checks = Array.isArray(last?.checks) ? last.checks : [];
  return {
    files: files.length,
    added: files.reduce((sum, file) => sum + (Number(file.added) || 0), 0),
    removed: files.reduce((sum, file) => sum + (Number(file.removed) || 0), 0),
    checksPassed: checks.filter(check => check.passed === true).length,
    checksTotal: checks.length,
    attempts: rounds.length || (run ? 1 : 0),
  };
}

export function tailOf(output, lines = 40) {
  if (typeof output !== 'string' || !output) return '';
  return output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+$/, '').split(/\r?\n/).slice(-lines).join('\n');
}

// Ids whose native status changed between two observed catalogs. The first
// observation marks nothing: only change seen while watching is news.
export function changedStatuses(previous, items) {
  if (!previous) return [];
  return items.filter(item => previous.has(item.id) && previous.get(item.id) !== stateOf(item)).map(item => item.id);
}
export const statusMap = items => new Map(items.map(item => [item.id, stateOf(item)]));

export function relative(value, now = Date.now()) {
  const t = time(value); if (!t) return '';
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 45) return 'hace un momento';
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.round(seconds / 3600)} h`;
  const days = Math.round(seconds / 86400);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

export function duration(start, end, now = Date.now()) {
  const a = time(start); if (!a) return '';
  const total = Math.max(0, Math.round(((time(end) || now) - a) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

export function lastLine(output) {
  if (typeof output !== 'string') return '';
  // Strip ANSI escapes; show the last meaningful line the host really received.
  const lines = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.at(-1)?.slice(0, 240) || '';
}

const BUDGET = { timeoutMs: value => `${Math.round(value / 60000)} min`, maxTurns: value => `${value} turnos`, maxTools: value => `${value} herramientas`, maxRepairs: value => `${value} reparaciones` };
export function budgetText(budget) {
  if (!budget || typeof budget !== 'object') return '';
  return Object.entries(budget).filter(([, value]) => Number.isFinite(value)).map(([key, value]) => BUDGET[key] ? BUDGET[key](value) : `${key}: ${value}`).join(' · ');
}

export const argvText = argv => Array.isArray(argv) ? argv.map(arg => !arg || /[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg).join(' ') : '';

// Native run records arrive as `runs` (detail) or `run` (latest, from show).
export function runsOf(value) {
  const native = value?.task || value || {};
  const runs = Array.isArray(value?.runs) ? value.runs : Array.isArray(native.runs) ? native.runs : native.run ? [native.run] : [];
  return runs.filter(run => run && typeof run === 'object').slice().reverse();
}

export const checkResult = check => check.executed === false ? 'No ejecutada' : check.passed === true ? 'Pasó' : check.passed === false ? 'Falló' : 'Desconocido';
export const eventLabel = type => ({ 'task.created': 'Tarea creada', 'run.started': 'Ejecución iniciada', 'run.finished': 'Ejecución finalizada', 'task.cancelled': 'Tarea cancelada' })[type] || type || 'Evento';
export function eventDetails(event) {
  const value = JSON.stringify(event.data ?? {}, null, 2);
  return value.length > 65536 ? `${value.slice(0, 65536)}\n[Detalles recortados explícitamente a 65536 caracteres]` : value;
}
export function phaseOf(native) {
  if (native.phase || native.run?.phase) return `Fase nativa: ${native.phase || native.run.phase}`;
  const evidence = native.run?.evidence;
  if (evidence?.verification?.some(round => round.available)) return 'Fase observada: verificación posterior del worktree';
  if (evidence?.baseline?.available) return 'Fase observada: pruebas iniciales del worktree';
  return 'Fase no informada; evidencia no disponible';
}

// Command line ⇄ argv without a shell: quotes group words, nothing expands.
// A JSON array is still accepted for pasted contracts.
export function parseCommand(text) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.startsWith('[')) {
    try { const value = JSON.parse(source); if (Array.isArray(value) && value.every(arg => typeof arg === 'string')) return value; } catch { /* fall through to words */ }
  }
  const args = []; let current = '', quote = null, started = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && /["\\]/.test(source[i + 1] || '')) current += source[++i];
      else current += char;
    } else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { args.push(current); current = ''; started = false; } }
    else if (char === '\\' && i + 1 < source.length) { current += source[++i]; started = true; }
    else { current += char; started = true; }
  }
  if (quote) throw new Error('Comando: falta cerrar una comilla.');
  if (started) args.push(current);
  return args;
}
export function commandOf(argvJson) {
  try { const value = typeof argvJson === 'string' ? JSON.parse(argvJson || '[]') : argvJson; return argvText(value); } catch { return String(argvJson || ''); }
}

const BUDGET_FIELDS = [['timeoutMs', 'timeoutMin', 60000], ['maxTurns', 'maxTurns', 1], ['maxTools', 'maxTools', 1], ['maxRepairs', 'maxRepairs', 1]];
export function budgetFieldsOf(json) {
  let budget = {};
  try { budget = json && json.trim() ? JSON.parse(json) : {}; } catch { budget = {}; }
  const fields = { extra: {} };
  for (const [key, field, scale] of BUDGET_FIELDS) fields[field] = Number.isFinite(budget[key]) ? String(budget[key] / scale) : '';
  for (const [key, value] of Object.entries(budget)) if (!BUDGET_FIELDS.some(([known]) => known === key)) fields.extra[key] = value;
  return fields;
}
export function budgetJsonOf(fields) {
  const budget = { ...(fields.extra || {}) };
  for (const [key, field, scale] of BUDGET_FIELDS) {
    const raw = String(fields[field] ?? '').trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error('Presupuesto: usa números positivos.');
    budget[key] = Math.round(value * scale);
  }
  return Object.keys(budget).length ? JSON.stringify(budget) : '';
}
