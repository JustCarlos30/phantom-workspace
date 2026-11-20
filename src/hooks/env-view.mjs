// Modelo puro de Entorno → Docker: agrupa los servicios de env.list por dueño y ciclo de vida.
const text = value => typeof value === 'string' ? value.trim() : '';

export function ageLabel(startedAt, now = Date.now()) {
  const time = Date.parse(startedAt);
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return 'hace menos de 1 min';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

export const LIFECYCLE_LABELS = Object.freeze({ ephemeral: 'Efímero', persistent: 'Persistente' });
const RUNNING = /^(running|up|healthy|starting|restarting)\b/i;
export const isRunning = status => RUNNING.test(text(status));

export function statusText(status) {
  const value = text(status);
  if (!value) return 'Detenido';
  return isRunning(value) ? 'En marcha' : value.charAt(0).toUpperCase() + value.slice(1);
}

export function envRow(service, { nodes = [], now = Date.now() } = {}) {
  const lifecycle = service?.lifecycle === 'persistent' ? 'persistent' : 'ephemeral';
  const owner = service?.owner && typeof service.owner === 'object' ? service.owner : null;
  const node = owner?.ownerNodeId && nodes.find(n => n.id === owner.ownerNodeId);
  const ownerLabel = lifecycle === 'persistent' ? 'Proyecto' : owner?.ownerSessionId ? (text(node?.title) || 'Terminal') : 'Sin dueño';
  const url = text(service?.url) || (Array.isArray(service?.urls) ? text(service.urls[0]) : '');
  const running = isRunning(service?.status);
  return {
    name: text(service?.name) || 'Servicio',
    lifecycle,
    lifecycleLabel: LIFECYCLE_LABELS[lifecycle],
    owner: ownerLabel,
    ownerNodeId: owner?.ownerNodeId || null,
    purpose: text(service?.purpose),
    card: text(service?.card),
    age: owner?.startedAt ? ageLabel(owner.startedAt, now) : '',
    status: statusText(service?.status),
    running,
    url: url || null,
    canOpen: !!url && running,
    canDown: running || !!owner,
  };
}

const GROUPS = [
  ['project', 'Del proyecto', row => row.lifecycle === 'persistent'],
  ['terminal', 'De una terminal', row => row.lifecycle === 'ephemeral' && row.owner !== 'Sin dueño'],
  ['free', 'Sin dueño', () => true],
];

export function envView({ data, loading = false, error = null, nodes = [], now = Date.now() } = {}) {
  if (loading) return { state: 'loading', message: 'Cargando el entorno…', groups: [] };
  if (error) return { state: 'error', message: text(error.message) || 'No se pudo leer el entorno.', groups: [] };
  if (!data || data.available === false) return { state: 'unavailable', message: text(data?.reason) || 'Docker no está disponible.', groups: [] };
  if (!data.compose) return { state: 'empty', message: 'Este proyecto no tiene compose.yaml. Los agentes lo añaden cuando una card declara un entorno.', groups: [] };
  const rows = (Array.isArray(data.services) ? data.services : []).map(s => envRow(s, { nodes, now }));
  if (!rows.length) return { state: 'empty', message: 'compose.yaml no declara servicios.', groups: [] };
  const groups = GROUPS.map(([key, title]) => ({ key, title, rows: [] }));
  for (const row of rows) groups[GROUPS.findIndex(([, , match]) => match(row))].rows.push(row);
  return { state: 'ready', message: '', groups: groups.filter(g => g.rows.length) };
}
