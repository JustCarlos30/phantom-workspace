import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { command, jsonCommand, workspaceRoot } from './common.mjs';
import { dockerList, dockerTarget, owned } from './docker.mjs';

const names = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const projectName = root => `phantom-${createHash('sha256').update(root).digest('hex').slice(0, 24)}`;

async function registered(context, id) {
  const workspace = (context.state?.workspaces || []).find(w => w.id === id);
  if (!workspace) throw new Error('Proyecto no registrado');
  const { root } = await workspaceRoot({ workspace }, {});
  if (workspace.canonicalPath && path.resolve(workspace.canonicalPath) !== root) throw new Error('La ruta canónica del proyecto cambió');
  return { workspace, root };
}
async function composeFile(root) {
  for (const name of names) {
    const file = path.join(root, name);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || await realpath(file) !== file) throw new Error('El archivo Compose debe ser un archivo regular en la raíz');
      return file;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}
const opts = root => ({ cwd: root, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('COMPOSE_'))) });
const prefix = (target, file, project) => [...target.prefix, 'compose', '--project-directory', path.dirname(file), '-f', file, '-p', project];
async function inspectProject(context, root, target, project, file) {
  const ids = (await command(context, 'docker', [...target.prefix, 'ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`], opts(root))).stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length > 500 || ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error('Lista de contenedores inválida');
  const all = [];
  for (let i = 0; i < ids.length; i += 25) all.push(...await jsonCommand(context, 'docker', [...target.prefix, 'inspect', ...ids.slice(i, i + 25)], opts(root)));
  if (all.length !== ids.length) throw new Error('No se pudo verificar la propiedad de todos los contenedores');
  for (const raw of all) {
    const labels = raw.Config?.Labels || {};
    const files = (labels['com.docker.compose.project.config_files'] || '').split(',');
    if (!await owned(raw, root) || labels['com.docker.compose.project'] !== project || files.length !== 1 || await realpath(path.resolve(root, files[0])) !== file) throw new Error('El proyecto Compose contiene contenedores ajenos o con otra configuración');
  }
  return all;
}
function urls(service, containers) {
  const result = new Set();
  for (const port of service.ports || []) {
    const scheme = port.app_protocol ? (['http', 'https'].includes(port.app_protocol) ? port.app_protocol : null) : Number(port.target) === 80 ? 'http' : Number(port.target) === 443 ? 'https' : null;
    if (!scheme || (port.protocol && port.protocol !== 'tcp')) continue;
    for (const container of containers) for (const binding of container.NetworkSettings?.Ports?.[`${port.target}/tcp`] || []) {
      const number = Number(binding.HostPort); if (!Number.isInteger(number) || number < 1 || number > 65535) continue;
      let host = binding.HostIp || '127.0.0.1'; if (host === '0.0.0.0' || host === '::') host = '127.0.0.1';
      if (host.includes(':')) host = `[${host}]`;
      result.add(`${scheme}://${host}:${number}/`);
    }
  }
  return [...result];
}
async function discover(context, id) {
  const { workspace, root } = await registered(context, id);
  const item = { workspaceId: id, name: workspace.name, root, services: [] };
  const file = await composeFile(root);
  if (!file) return { ...item, compose: false };
  item.compose = true;
  item.composeFile = file;
  const target = await dockerTarget(context, root);
  const existing = await dockerList({ workspaceId: id }, { ...context, getWorkspace: () => workspace });
  if (!existing.available) throw new Error(existing.reason);
  if (existing.daemon !== target.daemon || existing.context !== target.context) throw new Error('El contexto Docker cambió durante la consulta');
  item.daemon = target.daemon; item.dockerContext = target.context;
  const projects = new Set(existing.items.map(c => c.raw.Config?.Labels?.['com.docker.compose.project']).filter(Boolean));
  // Multiple projects in one root cannot safely be guessed as a single target.
  if (projects.size > 1) throw new Error('Hay varios proyectos Compose en esta raíz; no se puede elegir uno automáticamente');
  const project = [...projects][0] || projectName(root);
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(project)) throw new Error('Nombre de proyecto Compose inválido');
  const containers = await inspectProject(context, root, target, project, file);
  const config = await jsonCommand(context, 'docker', [...prefix(target, file, project), 'config', '--format', 'json'], opts(root));
  item.project = project;
  item.services = Object.entries(config.services || {}).map(([name, service]) => {
    const matching = containers.filter(c => c.Config?.Labels?.['com.docker.compose.service'] === name);
    return { name, status: matching.length ? [...new Set(matching.map(c => c.State?.Status || 'unknown'))].join(', ') : 'not created', urls: urls(service, matching), containers: matching.map(c => c.Id) };
  });
  return item;
}
export async function sites(method, payload, context) {
  if (method === 'docker.list') {
    const results = await Promise.all((context.state?.workspaces || []).map(async w => {
      try { return await discover(context, w.id); }
      catch (error) { return { workspaceId: w.id, name: w.name, error: error.message, services: [] }; }
    }));
    return { projects: results };
  }
  if (typeof payload.workspaceId !== 'string') throw new Error('Proyecto requerido');
  const data = await discover(context, payload.workspaceId);
  if (!data.compose || !data.project) throw new Error('El proyecto no tiene Compose');
  const service = data.services.find(s => s.name === payload.service);
  if (!service) throw new Error('Servicio Compose desconocido');
  const { root } = await registered(context, payload.workspaceId), file = await composeFile(root), target = await dockerTarget(context, root);
  if (root !== data.root || file !== data.composeFile || target.context !== data.dockerContext || target.daemon !== data.daemon) throw new Error('El proyecto o contexto Docker cambió; actualiza y vuelve a intentar');
  await inspectProject(context, root, target, data.project, file);
  if (method === 'docker.logs') {
    const output = await command(context, 'docker', [...prefix(target, file, data.project), 'logs', '--no-color', '--tail', '200', '--timestamps', '--', service.name], { ...opts(root), maxBuffer: 512 * 1024 });
    return { text: output.stdout + output.stderr };
  }
  if (!['start', 'stop', 'restart'].includes(payload.action)) throw new Error('Acción desconocida');
  const action = payload.action === 'start' ? ['up', '-d', '--', service.name] : [payload.action, '--', service.name];
  await command(context, 'docker', [...prefix(target, file, data.project), ...action], { ...opts(root), timeout: 120000 });
  return { status: 'requested' };
}
