import { command, spawnCommand } from './common.mjs';
import { createHash } from 'node:crypto';
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
const isLive = (context, sessionId) => !!sessionId && (context.sessions || []).some(s => s.id === sessionId && (s.status ?? 'running') === 'running');
const environmentId = root => createHash('sha256').update(root).digest('hex');
const inEnvironment = (entry, scope) => (entry.environmentId ?? null) === (scope.environmentId ?? null);
async function environment(context, workspaceId, cwd) {
  const base = await registered(context, workspaceId);
  const { root } = cwd === undefined ? base : await registered(context, workspaceId, cwd);
  return { root, ...(root !== base.root ? { environmentId: environmentId(root) } : {}) };
}
async function savedEnvironment(context, workspaceId, entry) {
  const scope = await environment(context, workspaceId, entry.root);
  if (scope.root !== entry.root || scope.environmentId !== entry.environmentId) throw new Error('La identidad del entorno cambió');
  return scope;
}
async function selectedEnvironment(payload, context) {
  if (context.envCwd !== undefined) return environment(context, payload.workspaceId, context.envCwd);
  if (payload.environmentId !== undefined) {
    if (payload.actor !== 'ui' || typeof payload.environmentId !== 'string') throw new Error('Identidad de entorno inválida');
    const entry = entries(context, payload.workspaceId).find(e => e.environmentId === payload.environmentId);
    if (!entry) throw new Error('Entorno desconocido');
    return savedEnvironment(context, payload.workspaceId, entry);
  }
  return environment(context, payload.workspaceId);
}

async function prepare(context, workspaceId, scope) {
  const data = await discover(context, workspaceId, scope.root);
  if (!data.compose || !data.project) throw new Error('El proyecto no tiene Compose');
  const { root } = await registered(context, workspaceId, scope.root), file = await composeFile(root), target = await dockerTarget(context, root);
  if (root !== data.root || file !== data.composeFile || target.context !== data.dockerContext || target.daemon !== data.daemon) throw new Error('El proyecto o contexto Docker cambió; actualiza y vuelve a intentar');
  return { data, root, base: prefix(target, file, data.project) };
}
const describe = (service, owner) => ({ name: service.name, ...parseExtension(service.extension), profiles: service.profiles, status: service.status, urls: service.urls, url: service.urls[0] ?? null, owner: owner ? { ownerSessionId: owner.ownerSessionId, ownerNodeId: owner.ownerNodeId, startedAt: owner.startedAt } : null });

export async function envList(payload, context) {
  const owners = entries(context, payload.workspaceId);
  const scope = await selectedEnvironment(payload, context), scopes = [scope];
  if (context.envCwd === undefined) {
    for (const entry of owners) if (entry.environmentId && !scopes.some(s => s.environmentId === entry.environmentId)) scopes.push(await savedEnvironment(context, payload.workspaceId, entry));
  }
  const results = await Promise.all(scopes.map(async s => {
    const data = await discover(context, payload.workspaceId, s.root);
    return { data, services: data.services.map(service => ({ ...describe(service, owners.find(e => inEnvironment(e, s) && e.service === service.name)), ...s, project: data.project })) };
  }));
  const services = results.flatMap(r => r.services);
  return { workspaceId: payload.workspaceId, compose: results.some(r => r.data.compose), project: results[0].data.project ?? null, ...scope, observedAt: new Date().toISOString(), profiles: [...new Set(services.flatMap(s => s.profiles))].sort(), services };
}

export async function envUp(payload, context) {
  const owner = ownerOf(payload), { service, profile } = payload;
  if ((service === undefined) === (profile === undefined)) throw new Error('Indica un servicio o un perfil');
  const scope = await selectedEnvironment(payload, context), p = await prepare(context, payload.workspaceId, scope);
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
    const entry = current.find(e => inEnvironment(e, scope) && e.service === s.name);
    if (entry && entry.lifecycle === 'ephemeral' && entry.ownerSessionId && entry.ownerSessionId !== owner.sessionId && isLive(context, entry.ownerSessionId)) throw new Error(`El servicio ${s.name} pertenece a otra terminal`);
  }
  await command(context, 'docker', [...p.base, ...(profile !== undefined ? ['--profile', profile] : []), 'up', '-d', '--', ...names], { ...opts(p.root), timeout: 300000 });
  const startedAt = new Date().toISOString();
  store(context, payload.workspaceId, list => [...list.filter(e => !inEnvironment(e, scope) || !names.includes(e.service)), ...selected.map(s => ({ service: s.name, ...(scope.environmentId ? scope : {}), ...(profile !== undefined ? { profile } : {}), ownerSessionId: owner.sessionId, ownerNodeId: owner.nodeId, lifecycle: parseExtension(s.extension).lifecycle, startedAt }))]);
  let after = selected;
  try { after = (await discover(context, payload.workspaceId, scope.root)).services.filter(s => names.includes(s.name)); } catch { /* el servicio ya está arriba; sin URLs */ }
  const services = after.map(s => ({ ...describe(s, entries(context, payload.workspaceId).find(e => inEnvironment(e, scope) && e.service === s.name)), ...scope, project: p.data.project }));
  return { project: p.data.project, ...(profile !== undefined ? { profile } : {}), services, url: services.find(s => s.url)?.url ?? null };
}

export async function envRun(payload, context) {
  ownerOf(payload);
  const job = name(payload.job, 'trabajo'), seconds = payload.timeout ?? DEFAULT_TIMEOUT;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMEOUT) throw new Error(`El tiempo límite debe ser un entero entre 1 y ${MAX_TIMEOUT} segundos`);
  const scope = await selectedEnvironment(payload, context), p = await prepare(context, payload.workspaceId, scope);
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

async function remove(context, workspaceId, names, scope) {
  const p = await prepare(context, workspaceId, scope);
  await command(context, 'docker', [...p.base, '--profile', '*', 'rm', '-sf', '--', ...names], { ...opts(p.root), timeout: 120000 });
  store(context, workspaceId, list => list.filter(e => !inEnvironment(e, scope) || !names.includes(e.service)));
}

export async function envDown(payload, context) {
  const scope = await selectedEnvironment(payload, context);
  const agent = payload.actor !== 'ui', owners = entries(context, payload.workspaceId).filter(e => inEnvironment(e, scope));
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
  if (names.length) await remove(context, payload.workspaceId, names, scope);
  return { down: names, ...(scope.environmentId ? { environmentId: scope.environmentId } : {}) };
}

// Salida o cierre del dueño: los ephemeral se eliminan; los persistent solo se desvinculan.
export async function envRelease(payload, context) {
  const { workspaceId, sessionId, nodeId } = payload;
  const mine = e => (sessionId && e.ownerSessionId === sessionId) || (nodeId && e.ownerNodeId === nodeId);
  const matching = entries(context, workspaceId).filter(mine);
  if (!matching.length) return { removed: [], released: [], errors: [] };
  const released = matching.filter(e => e.lifecycle === 'persistent').map(e => e.service), removed = [], removedEnvironments = [], errors = [];
  store(context, workspaceId, list => list.map(e => mine(e) && e.lifecycle === 'persistent' ? { ...e, ownerSessionId: null, ownerNodeId: null } : e));
  const groups = new Map();
  for (const entry of matching.filter(e => e.lifecycle !== 'persistent')) {
    const key = entry.environmentId ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [id, group] of groups) {
    try {
      const scope = id ? await savedEnvironment(context, workspaceId, group[0]) : await environment(context, workspaceId);
      const names = group.map(e => e.service);
      await remove(context, workspaceId, names, scope);
      removed.push(...names); removedEnvironments.push({ ...(id ? { environmentId: id } : {}), services: names });
    } catch (error) { errors.push(error.message); }
  }
  return { removed, released, errors, ...(matching.some(e => e.environmentId) ? { removedEnvironments } : {}) };
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
