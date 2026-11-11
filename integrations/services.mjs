import { randomUUID } from 'node:crypto';
import { readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { workspaceRoot, inside, observedAt } from './common.mjs';
import { dockerList } from './docker.mjs';

export function serviceURL(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid service URL');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid service URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Service URL must be HTTP(S) without credentials');
  return url.href;
}
// Read socket inodes only from managed session processes and their descendants.
// A listening socket elsewhere on the host never establishes ownership.
export async function managedPorts(context, workspace, root) {
  const sessions = (context.sessions ?? []).filter(s => s.workspaceId === workspace.id && s.status === 'running' && Number.isSafeInteger(s.pid));
  if (!sessions.length) return [];
  const deadline = Date.now() + 2500;
  const processes = new Map();
  const entries = (await readdir('/proc')).filter(n => /^\d+$/.test(n)).slice(0, 16000);
  for (const entry of entries) {
    if (Date.now() > deadline) throw new Error('Process attribution time budget exceeded');
    try {
      const stat = await readFile(`/proc/${entry}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      processes.set(Number(entry), { parent: Number(fields[1]), start: fields[19] });
    } catch { /* Process already gone. */ }
  }
  const inodes = new Map();
  let descriptorCount = 0;
  for (const [pid] of processes) {
    if (Date.now() > deadline) throw new Error('Process attribution time budget exceeded');
    let ancestor = pid, session, steps = 0;
    while (ancestor && steps++ < 128) {
      session = sessions.find(s => s.pid === ancestor);
      if (session) break;
      ancestor = processes.get(ancestor)?.parent;
    }
    if (!session) continue;
    try {
      if (!inside(root, await realpath(`/proc/${pid}/cwd`))) continue;
      const descriptors = (await readdir(`/proc/${pid}/fd`)).slice(0, 2048);
      for (const fd of descriptors) {
        if (++descriptorCount > 8192 || Date.now() > deadline) throw new Error('Process socket attribution budget exceeded');
        try { const inode = (await readlink(`/proc/${pid}/fd/${fd}`)).match(/^socket:\[(\d+)\]$/)?.[1]; if (inode) inodes.set(inode, { pid, sessionId: session.id }); } catch { /* Race. */ }
      }
    } catch { /* Unreadable process. */ }
  }
  const ports = [];
  for (const table of ['tcp', 'tcp6']) {
    const lines = (await readFile(`/proc/net/${table}`, 'utf8')).trim().split('\n').slice(1, 16001);
    for (const line of lines) {
      const fields = line.trim().split(/\s+/), owner = inodes.get(fields[9]);
      if (fields[3] !== '0A' || !owner) continue;
      const port = parseInt(fields[1].split(':')[1], 16);
      if (port) ports.push({ port, owner });
    }
  }
  return ports;
}
export async function services(method, payload, context) {
  const { workspace, root } = await workspaceRoot(context, payload);
  if (method === 'services.pin') {
    const url = serviceURL(payload.url);
    if (payload.title !== undefined && (typeof payload.title !== 'string' || payload.title.length > 200)) throw new Error('Invalid service title');
    workspace.services ??= [];
    const existing = workspace.services.find(s => s.source === 'pinned' && s.url === url);
    if (existing) return existing;
    const item = { id: randomUUID(), url, title: payload.title || new URL(url).host, source: 'pinned', status: 'unknown' };
    workspace.services.push(item); await context.persist(); return item;
  }
  if (method === 'services.remove') {
    const index = (workspace.services ?? []).findIndex(s => s.id === payload.id && s.source === 'pinned');
    if (index < 0) throw new Error('Unknown pinned service');
    workspace.services.splice(index, 1); await context.persist(); return { removed: true, id: payload.id };
  }
  const at = observedAt(), items = (workspace.services ?? []).filter(s => s.source === 'pinned').map(s => ({ ...s, status: 'unknown', observedAt: at }));
  let processReason;
  try {
    const ports = await managedPorts(context, workspace, root);
    for (const { port, owner } of ports) {
      if (items.some(s => s.source === 'managed' && s.port === port && s.owner.pid === owner.pid)) continue;
      items.push({ id: `managed:${owner.sessionId}:${port}`, title: `Managed port ${port}`, url: `http://127.0.0.1:${port}/`, port, source: 'managed', status: 'listening', health: 'unknown', owner, observedAt: at });
    }
  } catch (error) { processReason = error.message; }
  const docker = await dockerList(payload, context);
  for (const container of docker.items) {
    // NetworkSettings is the daemon's actual binding; HostConfig is only requested configuration.
    for (const [containerPort, bindings] of Object.entries(container.ports)) for (const binding of bindings ?? []) {
      const port = Number(binding.HostPort);
      if (!port || !containerPort.endsWith('/tcp')) continue;
      let host = binding.HostIp || '127.0.0.1';
      if (['0.0.0.0', '::'].includes(host)) host = '127.0.0.1';
      if (host.includes(':')) host = `[${host}]`;
      items.push({ id: `compose:${container.id}:${containerPort}:${binding.HostIp}:${port}`, title: container.name, url: `http://${host}:${port}/`, port, source: 'compose', status: container.status, health: container.health, owner: { containerId: container.id, daemon: container.daemon, context: container.context }, observedAt: at });
    }
  }
  if (payload.probe === true) for (const item of items.slice(0, 40)) {
    try {
      const response = await fetch(serviceURL(item.url), { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(1500) });
      item.health = response.ok ? 'healthy' : 'unhealthy'; item.httpStatus = response.status;
      await response.body?.cancel();
    } catch (error) { item.health = 'unreachable'; item.healthReason = error.message; }
  }
  return { items, observedAt: at, dockerAvailable: docker.available, ...(docker.reason ? { dockerReason: docker.reason } : {}), ...(processReason ? { processReason } : {}) };
}
