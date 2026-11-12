import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost, phantomInstructions } from '../host/server.mjs';
import { main as canvas, planArrange, resolve } from '../scripts/canvas.mjs';

const node = (id, type, x, y, data = {}, w = 640, h = 400) => ({ id, type, title: id, x, y, width: w, height: h, data });
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('arrange packs panels without overlap, anchored at their current top-left, grouped by type', () => {
  const nodes = [node('t1', 'terminal', 500, 900), node('t2', 'terminal', -300, 40), node('b1', 'browser', 2000, 2000), node('n1', 'note', 10, 10, { hidden: true })];
  const plan = planArrange(nodes, { by: 'type', zones: true });
  assert.equal(plan.moves.length, 3, 'hidden panels stay put');
  const placed = plan.moves.map(m => ({ ...nodes.find(n => n.id === m.id), ...m }));
  for (const a of placed) for (const b of placed) if (a !== b) assert.ok(!overlaps(a, b), `${a.id} overlaps ${b.id}`);
  assert.equal(Math.min(...plan.zones.map(z => z.x), ...placed.map(n => n.x)), -300);
  assert.deepEqual(plan.zones.map(z => z.title), ['Terminales'], 'single-panel groups are not framed');
  const zone = plan.zones[0];
  for (const id of ['t1', 't2']) { const n = placed.find(n => n.id === id); assert.ok(n.x >= zone.x && n.y >= zone.y + 24 && n.x + n.width <= zone.x + zone.width && n.y + n.height <= zone.y + zone.height); }
});

test('manual zones move rigidly with their contents; previous auto zones are replaced', () => {
  const nodes = [node('z', 'zone', 0, 0, { color: 'iris' }, 800, 600), node('in', 'terminal', 40, 64, {}, 400, 300), node('auto', 'zone', 5000, 0, { auto: 'canvas' }, 300, 300), node('out', 'terminal', 3000, 3000)];
  const plan = planArrange(nodes, { by: 'none', zones: true });
  assert.deepEqual(plan.removeZones, ['auto']);
  const z = plan.moves.find(m => m.id === 'z'), inner = plan.moves.find(m => m.id === 'in');
  assert.deepEqual([inner.x - z.x, inner.y - z.y], [40, 64]);
});

test('spaces are laid out independently', () => {
  const plan = planArrange([node('a', 'terminal', 100, 100, { spaceId: 's1' }), node('b', 'terminal', 100, 100, { spaceId: 's2' })], { by: 'none' });
  assert.deepEqual(plan.moves.map(m => [m.x, m.y]), [[100, 100], [100, 100]]);
});

test('references resolve by id, title or branch prefix and reject ambiguity', () => {
  const nodes = [node('abc-1', 'terminal', 0, 0, { worktree: { branch: 'phantom/terminal-abc' } }), node('abd-2', 'terminal', 0, 0)];
  assert.equal(resolve(nodes, 'abc').id, 'abc-1');
  assert.throws(() => resolve(nodes, 'ab'), /ambiguo/);
  assert.throws(() => resolve(nodes, 'zzz'), /No hay/);
});

test('CLI edits the real host state and the main chat is told about it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-canvas-')), host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: async () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const w = await host.invoke('workspace.open', { path: root }), call = (method, payload) => host.invoke(method, payload);
  const a = await host.invoke('node.create', { workspaceId: w.id, type: 'note', title: 'Ideas', x: 900, y: 900 });
  const b = await host.invoke('node.create', { workspaceId: w.id, type: 'note', title: 'Pendientes', x: 900, y: 900 });
  const run = (action, ...rest) => canvas([action, '--workspace', w.canonicalPath, ...rest], {}, call);
  assert.match(await run('list'), /Ideas[\s\S]*Pendientes/);
  assert.match(await run('arrange', '--zones'), /Ordenados 2 paneles en 1 zonas/);
  let nodes = (await host.invoke('state.get')).workspaces[0].nodes;
  const [na, nb] = [a, b].map(x => nodes.find(n => n.id === x.id));
  assert.ok(!overlaps(na, nb));
  assert.equal(nodes.filter(n => n.type === 'zone').length, 1);
  await run('arrange', '--zones');
  assert.equal((await host.invoke('state.get')).workspaces[0].nodes.filter(n => n.type === 'zone').length, 1, 're-arranging does not pile up zones');
  await run('move', 'Ideas', '10', '20'); await run('resize', 'Ideas', '500', '300'); await run('rename', 'Ideas', 'Ideas v2'); await run('hide', 'Pendientes');
  nodes = (await host.invoke('state.get')).workspaces[0].nodes;
  assert.deepEqual((({ x, y, width, height, title }) => ({ x, y, width, height, title }))(nodes.find(n => n.id === a.id)), { x: 10, y: 20, width: 500, height: 300, title: 'Ideas v2' });
  assert.equal(nodes.find(n => n.id === b.id).data.hidden, true);
  await run('show', '--all');
  assert.equal((await host.invoke('state.get')).workspaces[0].nodes.find(n => n.id === b.id).data.hidden, false);
  await assert.rejects(run('resize', 'Ideas', '10', '10'), /mínimo/);
  assert.match(phantomInstructions(w), /scripts\/canvas\.mjs" help/);
});
