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
  { id: 'queue', title: 'En cola y recientes', empty: 'Sin Cards en cola.' },
];

export function zoneOf(status, controllerStatus) {
  if (status === 'blocked') return 'decide';
  if (['running', 'verifying', 'recovering'].includes(status) || controllerStatus === 'running') return 'live';
  return 'queue';
}

const time = value => { const t = Date.parse(value); return Number.isFinite(t) ? t : 0; };
const queueRank = status => status === 'ready' ? 0 : status === 'unknown' ? 1 : 2;

export function buildDesk(items = [], controllers = [], query = '', location = '') {
  const text = query.trim().toLowerCase();
  const cards = items.map(item => {
    const raw = item.raw || {};
    const status = stateOf(item);
    const controller = controllers.filter(entry => entry.taskId === item.id).at(-1) || null;
    return {
      id: item.id, goal: goalOf(item), status, kind: item.kind || raw.kind || 'card',
      reason: [raw.reason, raw.blockReason, raw.blockedReason, raw.admission?.reason].find(value => typeof value === 'string' && value.trim()) || '',
      updatedAt: raw.updatedAt || raw.createdAt || null, controller,
      dependencies: Array.isArray(contractOf(raw).dependencies) ? contractOf(raw).dependencies : [],
      zone: zoneOf(status, controller?.status), item, location: locationKey(item),
    };
  }).filter(card => !location || card.location === location).filter(card => !text || `${card.goal}\n${card.id}\n${(contractOf(card.item.raw).scope || []).join('\n')}`.toLowerCase().includes(text));
  const zones = Object.fromEntries(ZONES.map(zone => [zone.id, []]));
  for (const card of cards) zones[card.zone].push(card);
  zones.decide.sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  zones.live.sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  zones.queue.sort((a, b) => queueRank(a.status) - queueRank(b.status) || time(b.updatedAt) - time(a.updatedAt));
  const counts = Object.fromEntries(Object.keys(STATUS).map(key => [key, cards.filter(card => card.status === key).length]));
  return { cards, zones, counts, total: cards.length };
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
