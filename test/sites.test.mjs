import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { handleIntegration } from '../integrations/index.mjs';

async function fixture(t) {
  const home = await mkdtemp('/tmp/phantom-sites-'); t.after(() => rm(home, { recursive: true, force: true }));
  const roots = await Promise.all(['one', 'two', 'empty'].map(async name => { const root = path.join(home, name); await mkdir(root); return root; }));
  await Promise.all(roots.slice(0, 2).map(root => writeFile(path.join(root, 'compose.yaml'), 'services: {}')));
  const workspaces = roots.map((root, i) => ({ id: String(i), name: `Repo ${i}`, path: root, canonicalPath: root }));
  const calls = [], context = { state: { workspaces, settings: {} }, sessions: [], getWorkspace: id => workspaces.find(w => w.id === id) };
  let containers = [], failingRoot = '';
  context.execFile = async (file, args, options) => {
    assert.equal(file, 'docker'); assert.equal(options.shell, false); calls.push({ args, options });
    if (options.cwd === failingRoot) throw new Error('daemon fixture unavailable');
    let stdout = '';
    if (args[0] === 'context' && args[1] === 'show') stdout = 'fixture';
    else if (args[0] === 'context') stdout = JSON.stringify([{ Endpoints: { docker: { Host: 'unix:///fixture.sock' } } }]);
    else if (args.includes('ps')) {
      const filter = args[args.indexOf('--filter') + 1];
      stdout = containers.filter(c => filter === `label=com.docker.compose.project.working_dir=${c.Config.Labels['com.docker.compose.project.working_dir']}` || filter === `label=com.docker.compose.project=${c.Config.Labels['com.docker.compose.project']}`).map(c => c.Id).join('\n');
    } else if (args.includes('inspect')) stdout = JSON.stringify(containers.filter(c => args.includes(c.Id)));
    else if (args.includes('config')) stdout = JSON.stringify({ services: { web: { ports: [{ target: 80 }, { target: 443 }, { target: 5432 }, { target: 3000, app_protocol: 'http' }] }, db: { ports: [{ target: 5432 }] } } });
    else if (args.includes('logs')) stdout = 'fixture log';
    return { stdout, stderr: '' };
  };
  const call = async (method, payload = {}) => (await handleIntegration(method, { scope: 'sites', ...payload }, context)).result;
  return { home, roots, workspaces, context, calls, call, setContainers: v => { containers = v; }, fail: root => { failingRoot = root; } };
}
function container(root, project = 'existing', file = path.join(root, 'compose.yaml')) {
  return { Id: 'a'.repeat(64), Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': 'web', 'com.docker.compose.project.working_dir': root, 'com.docker.compose.project.config_files': file } }, State: { Status: 'exited' }, NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }], '443/tcp': [{ HostIp: '::', HostPort: '8443' }], '5432/tcp': [{ HostPort: '5432' }], '3000/tcp': [{ HostPort: '3000' }] } } };
}
test('multi-repo sin sesiones, Compose sin crear y controles detached explícitos', async t => {
  const f = await fixture(t); const result = await f.call('docker.list');
  assert.equal(result.projects.length, 3); assert.equal(result.projects[0].services[0].status, 'not created'); assert.equal(result.projects[2].compose, false);
  assert.ok(!f.calls.some(c => ['up', 'stop', 'restart'].some(a => c.args.includes(a))));
  await f.call('docker.action', { workspaceId: '0', service: 'web', action: 'start' });
  const up = f.calls.find(c => c.args.includes('up')); assert.deepEqual(up.args.slice(-4), ['up', '-d', '--', 'web']); assert.equal(up.options.cwd, f.roots[0]);
  await f.call('docker.action', { workspaceId: '1', service: 'db', action: 'stop' });
  assert.deepEqual(f.calls.at(-1).args.slice(-3), ['stop', '--', 'db']);
  assert.equal((await f.call('docker.logs', { workspaceId: '1', service: 'web' })).text, 'fixture log');
  assert.ok(!f.calls.some(c => c.args.includes('down') || c.args.includes('--volumes')));
});
test('contenedores existentes, múltiples URL HTTP y errores parciales', async t => {
  const f = await fixture(t); f.setContainers([container(f.roots[0])]); f.fail(f.roots[1]);
  const data = await f.call('docker.list'), web = data.projects[0].services.find(s => s.name === 'web');
  assert.equal(web.status, 'exited'); assert.deepEqual(web.urls, ['http://127.0.0.1:8080/', 'https://127.0.0.1:8443/', 'http://127.0.0.1:3000/']);
  assert.match(data.projects[1].error, /unavailable/); assert.equal(data.projects[2].compose, false);
  await f.call('docker.action', { workspaceId: '0', service: 'web', action: 'restart' });
  assert.deepEqual(f.calls.at(-1).args.slice(-3), ['restart', '--', 'web']);
});
test('rechaza proyectos no registrados, symlinks y colisiones ajenas antes de actuar', async t => {
  const f = await fixture(t);
  await assert.rejects(f.call('docker.action', { workspaceId: 'unknown', service: 'web', action: 'start' }), /registrado/);
  await assert.rejects(f.call('docker.action', { workspaceId: '0', service: '../web', action: 'start' }), /desconocido/);
  await symlink(path.join(f.roots[0], 'compose.yaml'), path.join(f.roots[2], 'compose.yaml'));
  assert.match((await f.call('docker.list')).projects[2].error, /regular/);
  await writeFile(path.join(f.home, 'foreign.yaml'), 'services: {}');
  // Same Compose project label but a foreign root must never be adopted.
  f.setContainers([container(f.roots[0]), { ...container(f.roots[1], 'existing'), Id: 'b'.repeat(64) }]);
  await assert.rejects(f.call('docker.action', { workspaceId: '0', service: 'web', action: 'start' }), /ajenos/);
  assert.ok(!f.calls.some(c => c.args.includes('up')));
  f.workspaces[0].canonicalPath = path.join(f.home, 'alias'); await symlink(f.roots[0], f.workspaces[0].canonicalPath);
  assert.match((await f.call('docker.list')).projects[0].error, /canónica/);
});
