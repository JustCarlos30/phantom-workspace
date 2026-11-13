import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { main as canvas } from '../scripts/canvas.mjs';

test('research creates and reuses its space, marks references, and filters them', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-research-'));
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: async () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const w = await host.invoke('workspace.open', { path: root });
  const refs = path.join(root, 'refs.json');
  fs.writeFileSync(refs, JSON.stringify([
    { url: 'http://127.0.0.1:1/one', note: 'Primera fuente' },
    { url: 'http://127.0.0.1:1/one', note: 'Duplicada' },
    { url: 'http://127.0.0.1:1/two', note: 'Segunda fuente' },
  ]));
  const run = (action, ...rest) => canvas([action, '--workspace', w.canonicalPath, ...rest], {}, (method, payload) => host.invoke(method, payload));
  assert.match(await run('research', 'Tema', '--from', refs, '--cols', '2'), /entraron 2 fuentes; se omitieron 1 duplicadas/);
  let state = await host.invoke('state.get');
  const workspace = state.workspaces[0], space = workspace.spaces.find(s => s.name === 'Research · Tema');
  assert.ok(space);
  const research = workspace.nodes.filter(n => n.type === 'reference' && n.data.spaceId === space.id);
  assert.equal(research.length, 2);
  assert.ok(research.every(n => n.data.tags.includes('research:inbox')));
  assert.ok(workspace.nodes.some(n => n.type === 'zone' && n.title === 'Bandeja' && n.data.spaceId === space.id));
  assert.ok(workspace.nodes.some(n => n.type === 'browser' && n.title === 'Lector · Tema' && n.data.reader && n.data.spaceId === space.id));
  await run('research', 'Tema', '--from', refs);
  state = await host.invoke('state.get');
  assert.equal(state.workspaces[0].nodes.filter(n => n.type === 'reference' && n.data.spaceId === space.id).length, 2);
  await run('mark', research[0].id, 'liked');
  const filtered = await run('refs', '--space', 'Research · Tema', '--status', 'liked', '--json');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].status, 'liked');
});

test('research rejects a source without its rationale', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-research-'));
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: async () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const w = await host.invoke('workspace.open', { path: root }), refs = path.join(root, 'refs.json');
  fs.writeFileSync(refs, JSON.stringify([{ url: 'http://127.0.0.1:1/no-note' }]));
  await assert.rejects(canvas(['research', 'Tema', '--workspace', w.canonicalPath, '--from', refs], {}, (method, payload) => host.invoke(method, payload)), /cada fuente necesita su porqué/);
});
