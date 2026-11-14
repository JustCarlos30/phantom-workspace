import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CONVENCIONS_PLUGIN, defaultPlugins, validatePluginManifest, validatePluginPreferences } from '../shared/plugins.mjs';
import { validateConvencionsSnapshot, filterConvencions } from '../shared/convencions.mjs';
import { readConvencions } from '../integrations/convencions.mjs';
import { Store, validateState, NODE_TYPES } from '../host/store.mjs';
import { createHost } from '../host/server.mjs';
import { handleIntegration } from '../integrations/index.mjs';
import { validateInvocation } from '../desktop/security.mjs';
import { getPluginDescriptor } from '../src/plugins/registry.js';

const at = '2026-11-13T12:00:00.000Z';
const owner = { id: 'fixture-project', canonicalPath: '/synthetic/repository', plugins: { ...defaultPlugins(), convencions: { enabled: true, config: {} } } };
function snapshot(workspace = owner) {
  const sources = [{ label: 'SYNTHETIC · evidencia', reference: 'fixture://evidence/only-in-tests', observedAt: at }];
  const conventions = Object.keys({ adopted: 1, observed: 1, proposed: 1, excepted: 1 }).map((state, index) => ({
    id: `fixture-${state}`, title: `SYNTHETIC · ${state}`, state,
    scope: { kind: ['project', 'path', 'file', 'path'][index], target: index ? 'src/área/synthetic-only.mjs' : '.' },
    what: 'SYNTHETIC · contenido de prueba', when: 'SYNTHETIC · al revisar', why: 'SYNTHETIC · motivo', verification: 'SYNTHETIC · comprobar evidencia', sources,
    exception: state === 'excepted' ? { reason: 'SYNTHETIC · adaptación temporal', until: null } : null,
  }));
  return { contractVersion: 1, workspaceId: workspace.id, repository: workspace.canonicalPath, state: 'ready', available: true, reason: null, observedAt: at,
    bases: [{ id: 'synthetic-base', name: 'SYNTHETIC · base madre', versions: ['1.0.0', '2.0.0'].map(version => ({ version, publishedAt: at, description: 'SYNTHETIC · versión inmutable', conventions })) }],
    project: { registration: { registeredAt: at, source: 'SYNTHETIC · registro explícito' }, integration: { baseId: 'synthetic-base', version: '1.0.0', profile: 'SYNTHETIC · perfil', integratedAt: at, reason: 'SYNTHETIC · decisión de integración' }, conventions,
      decisions: [{ id: 'decision-1', title: 'SYNTHETIC · adaptación', kind: 'adaptation', at, scope: { kind: 'path', target: 'src/' }, reason: 'SYNTHETIC · compatibilidad', sources }],
      checks: [{ id: 'check-1', title: 'SYNTHETIC · comprobación', status: 'passed', at, detail: 'SYNTHETIC · evidencia de prueba, no ejecución real', sources }] } };
}

test('Convencions manifest, renderer registration and old preference migration are independent', () => {
  assert.deepEqual(validatePluginManifest(CONVENCIONS_PLUGIN), CONVENCIONS_PLUGIN);
  assert.deepEqual(getPluginDescriptor('convencions').commands.map(action => action.id), CONVENCIONS_PLUGIN.actions.map(action => action.id));
  assert.deepEqual(validatePluginPreferences({ phantom: { enabled: true, config: {} } }).convencions, { enabled: false, config: {} });
  assert.ok(CONVENCIONS_PLUGIN.panels.every(panel => NODE_TYPES.includes(panel.nodeType)));
  assert.throws(() => validatePluginPreferences({ convencions: { enabled: true, config: { command: '/invented' } } }));
});

test('read contract validates ownership, versions, evidence and semantics without manufacturing adoption', () => {
  const valid = snapshot();
  assert.deepEqual(validateConvencionsSnapshot(valid, owner), valid);
  const mutations = [
    data => { data.contractVersion = 2; }, data => { data.workspaceId = 'foreign'; }, data => { data.repository += '/foreign'; },
    data => { data.available = false; }, data => { data.extra = 'unknown'; }, data => { data.observedAt = 'yesterday'; },
    data => { data.project.integration.version = 'unpublished'; }, data => { data.project.integration = null; },
    data => { data.project.conventions[1].sources = []; }, data => { data.project.conventions[3].exception.reason = ''; },
    data => { data.project.conventions[0].exception = { reason: 'bad', until: null }; },
    data => { data.project.conventions[0].state = 'normative'; }, data => { data.project.conventions[0].scope.kind = 'global'; },
    data => { data.project.conventions.push(data.project.conventions[0]); }, data => { data.bases[0].versions.push(data.bases[0].versions[0]); },
    data => { data.project.checks[0].sources = []; }, data => { data.project.checks[0].at = null; },
  ];
  for (const mutate of mutations) { const invalid = structuredClone(valid); mutate(invalid); assert.throws(() => validateConvencionsSnapshot(invalid, owner), /Contrato Convencions/); }
  const registered = snapshot(); registered.project.integration = null; registered.project.conventions = registered.project.conventions.filter(item => ['observed', 'proposed'].includes(item.state));
  assert.equal(validateConvencionsSnapshot(registered, owner).project.integration, null);
  const empty = snapshot(); empty.project = null; empty.bases = [];
  assert.deepEqual(validateConvencionsSnapshot(empty, owner), empty);
});

test('search includes evidence/reasons and intersects status/scope without promoting observations', () => {
  const items = snapshot().project.conventions;
  assert.equal(filterConvencions(items, { query: 'AREA', scope: 'file', state: 'proposed' })[0].state, 'proposed');
  assert.equal(filterConvencions(items, { query: 'adaptacion temporal' })[0].state, 'excepted');
  assert.equal(filterConvencions(items, { query: 'fixture://evidence' }).length, 4);
  assert.equal(filterConvencions(items, { query: 'absent' }).length, 0);
  assert.equal(filterConvencions(items, { scope: 'file', state: 'observed' }).length, 0);
});

test('timestamps reject normalized impossible dates throughout the read contract', () => {
  const locations = [
    data => data,
    data => data.bases[0].versions[0],
    data => data.project.registration,
    data => data.project.integration,
    data => data.project.conventions[1].sources[0],
    data => data.project.conventions[3].exception,
    data => data.project.decisions[0],
    data => data.project.checks[0],
  ];
  const fields = ['observedAt', 'publishedAt', 'registeredAt', 'integratedAt', 'observedAt', 'until', 'at', 'at'];
  for (const invalid of ['2026-02-31T12:00:00Z', '2026-11-13T24:00:00Z', '2026-11-13T12:00:00+00:00']) {
    locations.forEach((location, index) => {
      const data = snapshot(); location(data)[fields[index]] = invalid;
      assert.throws(() => validateConvencionsSnapshot(data, owner), /fecha/);
    });
  }
  for (const valid of ['2028-02-29T12:00:00Z', '2026-11-13T12:00:00.1Z', '2026-11-13T12:00:00.12Z', at]) {
    const data = snapshot(); data.observedAt = valid;
    assert.equal(validateConvencionsSnapshot(data, owner).observedAt, valid);
  }
});

test('production never invokes commands, connects a model or mistakes unavailable for empty', async () => {
  const workspace = structuredClone(owner);
  let calls = 0;
  workspace.plugins.convencions.enabled = false;
  assert.equal((await readConvencions(workspace, { readSnapshot: () => { calls++; } })).state, 'disabled');
  workspace.plugins.convencions.enabled = true;
  const unavailable = await readConvencions(workspace);
  assert.equal(unavailable.state, 'unavailable'); assert.equal(unavailable.available, false); assert.equal(unavailable.project, null); assert.deepEqual(unavailable.bases, []);
  assert.match(unavailable.reason, /MCP/); assert.equal(calls, 0);
  const read = () => snapshot(workspace);
  assert.equal((await readConvencions(workspace, { readSnapshot: read })).state, 'ready');
  await assert.rejects(readConvencions(workspace, { readSnapshot: async () => { throw new Error('transport failed'); } }), /transport failed/);
  await assert.rejects(readConvencions(workspace, { readSnapshot: async () => ({ ...read(), workspaceId: 'foreign' }) }), /ownership/);
  const adapter = await readFile(new URL('../integrations/convencions.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(adapter, /child_process|execFile|spawn\(|jsonCommand|localStorage|writeFile|phantom\.mjs/);
});

test('late responses respect deactivation and repository identity changes', async () => {
  const workspace = structuredClone(owner);
  let release;
  const pending = readConvencions(workspace, { readSnapshot: () => new Promise(resolve => { release = resolve; }) });
  workspace.plugins.convencions.enabled = false; release(snapshot(workspace));
  assert.equal((await pending).state, 'disabled');
  workspace.plugins.convencions.enabled = true;
  const moved = readConvencions(workspace, { readSnapshot: () => new Promise(resolve => { release = resolve; }) });
  workspace.canonicalPath += '/moved'; release(snapshot(owner));
  await assert.rejects(moved, /proyecto cambió/);
});

test('host and desktop allowed routes persist spatial panels, reject convention storage and isolate projects', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'convencions-'));
  const roots = [path.join(home, 'one'), path.join(home, 'two')];
  await Promise.all(roots.map(root => mkdir(root)));
  let commands = 0;
  const host = await createHost({ dataDir: path.join(home, 'host'), handleIntegration: (method, payload, context) => handleIntegration(method, payload, { ...context, execFile() { commands++; throw new Error('No commands allowed'); }, spawn() { commands++; throw new Error('No processes allowed'); } }) });
  t.after(async () => { await host.close(); await rm(home, { recursive: true, force: true }); });
  const [a, b] = await Promise.all(roots.map(root => host.invoke('workspace.open', { path: root })));
  const call = (method, payload = {}, id = a.id) => host.invoke(method, { workspaceId: id, ...payload });
  for (const method of ['plugins.list', 'plugins.update', 'plugins.status', 'node.create', 'node.update']) assert.doesNotThrow(() => validateInvocation(method, {}));
  assert.throws(() => validateInvocation('convencions.adopt', {}));
  assert.equal((await call('plugins.status', { id: 'convencions' })).state, 'disabled');
  await call('plugins.update', { id: 'convencions', patch: { enabled: true } });
  assert.equal((await call('plugins.status', { id: 'convencions' })).state, 'unavailable');
  const nodes = [];
  for (const panel of CONVENCIONS_PLUGIN.panels) {
    const node = await call('node.create', { type: panel.nodeType }); nodes.push(node);
    assert.deepEqual(node.data, { pluginId: 'convencions', panelId: panel.id });
    await call('node.update', { id: node.id, patch: { x: 120, width: 880, data: { ...node.data, hidden: true, spaceId: 'fixture-space' } } });
    await assert.rejects(call('node.update', { id: node.id, patch: { data: { ...node.data, conventions: snapshot().project.conventions } } }), /spatial identity/);
    await assert.rejects(call('node.update', { id: node.id, patch: { data: { pluginId: 'phantom', panelId: panel.id } } }), /pluginId/);
    await assert.rejects(call('node.update', { id: node.id, patch: { title: 'foreign' } }, b.id), /Node not found/);
  }
  for (const payload of [ { id: 'convencions', command: 'invented' }, { id: 'convencions', workspaceId: 'foreign' }, { id: 'convencions', baseId: 'foreign' } ]) await assert.rejects(call('plugins.status', payload));
  await assert.rejects(call('plugins.update', { id: 'convencions', patch: { config: { sourcePath: '/tmp/fake' } } }));
  await assert.rejects(call('plugins.models', { id: 'convencions' }), /no utiliza modelos/);
  assert.equal(commands, 0);
  assert.equal((await call('plugins.list', {}, b.id)).items.find(item => item.id === 'convencions').enabled, false);
  assert.equal((await call('plugins.list')).items.find(item => item.id === 'phantom').enabled, false);
  await call('plugins.update', { id: 'convencions', patch: { enabled: false } });
  const restored = new Store(path.join(home, 'host'));
  const saved = restored.getWorkspace(a.id);
  assert.equal(saved.plugins.convencions.enabled, false);
  assert.deepEqual(saved.nodes.map(node => node.id), nodes.map(node => node.id));
  assert.ok(saved.nodes.every(node => node.data.hidden && node.data.spaceId === 'fixture-space' && node.x === 120));
  assert.equal(restored.getWorkspace(b.id).nodes.length, 0);
  const exported = await host.invoke('storage.export');
  assert.deepEqual(validateState(structuredClone(exported)).workspaces.find(w => w.id === a.id).nodes, saved.nodes);
  const bad = structuredClone(exported); bad.workspaces.find(w => w.id === a.id).nodes[0].data.snapshot = snapshot();
  assert.throws(() => validateState(bad), /spatial identity/);
  const disk = await readFile(restored.filename, 'utf8');
  assert.doesNotMatch(disk, /fixture-adopted|synthetic-base|fixture:\/\/evidence/);
});
