import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { command, jsonCommand, workspaceRoot, inside, text } from './common.mjs';

async function dockerTarget(context, root) {
  const configured = context.state?.settings?.dockerContext;
  if (configured !== undefined) text(configured, 'dockerContext', 256);
  const name = configured ?? (await command(context, 'docker', ['context', 'show'], { cwd: root })).stdout.trim();
  const info = await jsonCommand(context, 'docker', ['context', 'inspect', name], { cwd: root });
  const endpoint = info[0]?.Endpoints?.docker?.Host;
  // Local path labels cannot establish project ownership on a remote daemon.
  if (!endpoint?.startsWith('unix://') || (!configured && (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT && process.env.DOCKER_CONTEXT !== name))) throw new Error('Docker project ownership requires an unambiguous local Unix daemon/context');
  return { prefix: ['--context', name], daemon: endpoint, context: name };
}
async function owned(container, root) {
  const labels = container.Config?.Labels ?? {}, working = labels['com.docker.compose.project.working_dir'], files = labels['com.docker.compose.project.config_files'];
  if (!working || !files) return false;
  try {
    if (await realpath(working) !== root) return false;
    for (const file of files.split(',')) {
      const canonical = await realpath(path.resolve(working, file));
      if (!inside(root, canonical)) return false;
    }
    return true;
  } catch { return false; }
}
export async function dockerList(payload, context) {
  const { root } = await workspaceRoot(context, payload);
  try {
    const target = await dockerTarget(context, root);
    const ids = (await command(context, 'docker', [...target.prefix, 'ps', '-aq', '--filter', `label=com.docker.compose.project.working_dir=${root}`], { cwd: root })).stdout.trim().split(/\s+/).filter(Boolean);
    if (ids.length > 500) throw new Error('Too many Docker containers to inspect safely');
    const items = [];
    for (let i = 0; i < ids.length; i += 25) {
      if (ids.slice(i, i + 25).some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error('Invalid Docker container ID');
      const containers = await jsonCommand(context, 'docker', [...target.prefix, 'inspect', ...ids.slice(i, i + 25)], { cwd: root });
      for (const raw of containers) if (await owned(raw, root)) items.push({ id: raw.Id, name: raw.Name?.replace(/^\//, ''), status: raw.State?.Status, image: raw.Config?.Image, ports: raw.NetworkSettings?.Ports ?? {}, portBindings: raw.HostConfig?.PortBindings ?? {}, health: raw.State?.Health?.Status ?? 'unknown', daemon: target.daemon, context: target.context, raw });
    }
    return { available: true, items, daemon: target.daemon, context: target.context };
  } catch (error) { return { available: false, items: [], reason: `Docker unavailable: ${error.message}` }; }
}
export async function dockerOperation(method, payload, context) {
  text(payload.id, 'container ID', 64);
  const result = await dockerList(payload, context);
  if (!result.available) throw new Error(result.reason);
  const container = result.items.find(item => item.id === payload.id);
  if (!container) throw new Error('Container is not owned by this workspace');
  const { root } = await workspaceRoot(context, payload), prefix = ['--context', container.context];
  if (method === 'docker.logs') {
    const tail = payload.tail ?? 200;
    if (!Number.isInteger(tail) || tail < 1 || tail > 2000) throw new Error('tail must be 1–2000');
    const output = await command(context, 'docker', [...prefix, 'logs', '--tail', String(tail), '--timestamps', container.id], { cwd: root, maxBuffer: 512 * 1024 });
    return { text: output.stdout + output.stderr };
  }
  if (!['start', 'stop', 'restart'].includes(payload.action)) throw new Error('Docker action must be start, stop, or restart');
  await command(context, 'docker', [...prefix, payload.action, container.id], { cwd: root, timeout: 30000 });
  return { id: container.id, action: payload.action, status: 'requested' };
}
