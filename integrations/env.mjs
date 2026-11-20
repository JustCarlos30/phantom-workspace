import { command, spawnCommand } from './common.mjs';
import { dockerTarget } from './docker.mjs';
import { discover, registered, composeFile, prefix, opts } from './sites.mjs';

// Entorno: todo lo que se ejecuta para dar feedback vive como servicio de compose.yaml.
// El ciclo de vida se declara en la extensión `x-phantom` del servicio; sin ella es ephemeral.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const LOG_LIMIT = 16 * 1024;
const DEFAULT_TIMEOUT = 600, MAX_TIMEOUT = 3600;

export function parseExtension(raw) {
  const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const line = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : '';
  return { lifecycle: x.lifecycle === 'persistent' ? 'persistent' : 'ephemeral', purpose: line(x.purpose, 200), card: line(x.card, 512) };
}
const name = (value, label) => { if (typeof value !== 'string' || !NAME.test(value)) throw new Error(`${label}: nombre inválido`); return value; };
const ownerOf = payload => {
  const o = payload.owner;
  if (!o || typeof o.sessionId !== 'string' || !o.sessionId || typeof o.nodeId !== 'string' || !o.nodeId) throw new Error('Falta el dueño del entorno');
  return o;
};
const entries = (context, id) => context.getWorkspace(id).envOwners ?? [];
function store(context, id, fn) {
  const w = context.getWorkspace(id);
  w.envOwners = fn(w.envOwners ?? []);
  context.persist?.();
}
const isLive = (context, sessionId) => !!sessionId && (context.sessions || []).some(s => s.id === sessionId);

async function prepare(context, workspaceId) {
  const data = await discover(context, workspaceId);
  if (!data.compose || !data.project) throw new Error('El proyecto no tiene Compose');
  const { root } = await registered(context, workspaceId), file = await composeFile(root), target = await dockerTarget(context, root);
  if (root !== data.root || file !== data.composeFile || target.context !== data.dockerContext || target.daemon !== data.daemon) throw new Error('El proyecto o contexto Docker cambió; actualiza y vuelve a intentar');
  return { data, root, base: prefix(target, file, data.project) };
}
const describe = (service, owner) => ({ name: service.name, ...parseExtension(service.extension), profiles: service.profiles, status: service.status, urls: service.urls, url: service.urls[0] ?? null, owner: owner ? { ownerSessionId: owner.ownerSessionId, ownerNodeId: owner.ownerNodeId, startedAt: owner.startedAt } : null });

export async function envList(payload, context) {
  const data = await discover(context, payload.workspaceId);
  const base = { workspaceId: payload.workspaceId, compose: !!data.compose, project: data.project ?? null, observedAt: new Date().toISOString() };
  if (!data.compose) return { ...base, profiles: [], services: [] };
  const owners = entries(context, payload.workspaceId);
  const services = data.services.map(s => describe(s, owners.find(e => e.service === s.name)));
  return { ...base, profiles: [...new Set(services.flatMap(s => s.profiles))].sort(), services };
}

export async function envUp(payload, context) {
  const owner = ownerOf(payload), { service, profile } = payload;
  if ((service === undefined) === (profile === undefined)) throw new Error('Indica un servicio o un perfil');
  const p = await prepare(context, payload.workspaceId);
  let selected;
  if (service !== undefined) {
    selected = p.data.services.filter(s => s.name === name(service, 'servicio'));
    if (!selected.length) throw new Error('Servicio Compose desconocido');
  } else {
    selected = p.data.services.filter(s => s.profiles.includes(name(profile, 'perfil')));
    if (!selected.length) throw new Error('Perfil Compose desconocido');
  }
  const names = selected.map(s => s.name), current = entries(context, payload.workspaceId);
  for (const s of selected) {
    const entry = current.find(e => e.service === s.name);
    if (entry && entry.lifecycle === 'ephemeral' && entry.ownerSessionId && entry.ownerSessionId !== owner.sessionId && isLive(context, entry.ownerSessionId)) throw new Error(`El servicio ${s.name} pertenece a otra terminal`);
  }
  await command(context, 'docker', [...p.base, ...(profile !== undefined ? ['--profile', profile] : []), 'up', '-d', '--', ...names], { ...opts(p.root), timeout: 300000 });
  const startedAt = new Date().toISOString();
  store(context, payload.workspaceId, list => [...list.filter(e => !names.includes(e.service)), ...selected.map(s => ({ service: s.name, ...(profile !== undefined ? { profile } : {}), ownerSessionId: owner.sessionId, ownerNodeId: owner.nodeId, lifecycle: parseExtension(s.extension).lifecycle, startedAt }))]);
  let after = selected;
  try { after = (await discover(context, payload.workspaceId)).services.filter(s => names.includes(s.name)); } catch { /* el servicio ya está arriba; sin URLs */ }
  const services = after.map(s => describe(s, entries(context, payload.workspaceId).find(e => e.service === s.name)));
  return { project: p.data.project, ...(profile !== undefined ? { profile } : {}), services, url: services.find(s => s.url)?.url ?? null };
}

export async function envRun(payload, context) {
  ownerOf(payload);
  const job = name(payload.job, 'trabajo'), seconds = payload.timeout ?? DEFAULT_TIMEOUT;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMEOUT) throw new Error(`El tiempo límite debe ser un entero entre 1 y ${MAX_TIMEOUT} segundos`);
  const p = await prepare(context, payload.workspaceId);
  if (!p.data.services.some(s => s.name === job)) throw new Error('Servicio Compose desconocido');
  let logs = '', truncated = false;
  const push = chunk => { logs += String(chunk); if (logs.length > LOG_LIMIT) { logs = logs.slice(-LOG_LIMIT); truncated = true; } };
  const result = await new Promise((resolve, reject) => {
    let done = false, timedOut = false, grace;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); clearTimeout(grace); resolve({ timedOut, ...value }); };
    const child = spawnCommand(context, 'docker', [...p.base, 'run', '--rm', '-T', '--', job], { ...opts(p.root), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', push); child.stderr?.on('data', push);
    child.once('error', error => { if (done) return; done = true; clearTimeout(timer); clearTimeout(grace); reject(error); });
    child.once('close', (code, signal) => finish({ exitCode: code, signal: signal ?? null }));
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGTERM');
      grace = setTimeout(() => { child.kill('SIGKILL'); finish({ exitCode: null, signal: 'SIGKILL' }); }, 5000);
    }, seconds * 1000);
  });
  return { job, ok: result.exitCode === 0 && !result.timedOut, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, truncated, logs };
}

async function remove(context, workspaceId, names) {
  const p = await prepare(context, workspaceId);
  await command(context, 'docker', [...p.base, '--profile', '*', 'rm', '-sf', '--', ...names], { ...opts(p.root), timeout: 120000 });
  store(context, workspaceId, list => list.filter(e => !names.includes(e.service)));
}

export async function envDown(payload, context) {
  const agent = payload.actor !== 'ui', owners = entries(context, payload.workspaceId);
  let names;
  if (payload.service !== undefined) {
    const service = name(payload.service, 'servicio'), entry = owners.find(e => e.service === service);
    if (agent) {
      const owner = ownerOf(payload);
      if (!entry) throw new Error('El servicio no pertenece a esta terminal');
      if (entry.lifecycle === 'persistent') throw new Error('El servicio es persistente: se administra desde Entorno');
      if (entry.ownerSessionId !== owner.sessionId && isLive(context, entry.ownerSessionId)) throw new Error('El servicio pertenece a otra terminal');
    }
    names = [service];
  } else {
    if (!agent) throw new Error('Indica el servicio que quieres bajar');
    const owner = ownerOf(payload);
    names = owners.filter(e => e.ownerSessionId === owner.sessionId && e.lifecycle === 'ephemeral').map(e => e.service);
  }
  if (!names.length) return { down: [] };
  await remove(context, payload.workspaceId, names);
  return { down: names };
}

// Salida o cierre del dueño: los ephemeral se eliminan; los persistent solo se desvinculan.
export async function envRelease(payload, context) {
  const { workspaceId, sessionId, nodeId } = payload;
  const mine = e => (sessionId && e.ownerSessionId === sessionId) || (nodeId && e.ownerNodeId === nodeId);
  const matching = entries(context, workspaceId).filter(mine);
  if (!matching.length) return { removed: [], released: [], errors: [] };
  const released = matching.filter(e => e.lifecycle === 'persistent').map(e => e.service), removed = matching.filter(e => e.lifecycle !== 'persistent').map(e => e.service);
  store(context, workspaceId, list => list.map(e => released.includes(e.service) ? { ...e, ownerSessionId: null, ownerNodeId: null } : e));
  const errors = [];
  if (removed.length) {
    try { await remove(context, workspaceId, removed); }
    catch (error) { errors.push(error.message); return { removed: [], released, errors }; }
  }
  return { removed, released, errors };
}

export async function env(method, payload, context) {
  if (typeof payload.workspaceId !== 'string') throw new Error('Proyecto requerido');
  if (method === 'env.list') return envList(payload, context);
  if (method === 'env.up') return envUp(payload, context);
  if (method === 'env.run') return envRun(payload, context);
  if (method === 'env.down') return envDown(payload, context);
  if (method === 'env.release') return envRelease(payload, context);
  throw new Error('Acción de entorno desconocida');
}
