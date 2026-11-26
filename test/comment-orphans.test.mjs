import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { Store } from '../host/store.mjs';

function fixture(t, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `phantom-${name}-`));
  const project = path.join(root, 'project'), dataDir = path.join(root, 'state'); fs.mkdirSync(project);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { project, dataDir };
}

test('cerrar una terminal con comentarios se lleva sus pines en vez de fallar', async t => {
  const { project, dataDir } = fixture(t, 'comment-close');
  const host = await createHost({ dataDir });
  t.after(() => host.close());
  const workspace = await host.invoke('workspace.open', { path: project });
  const terminal = await host.invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' });
  const nodeId = terminal.node.id;
  await host.invoke('comment.add', { workspaceId: workspace.id, nodeId, x: .83, y: .42, text: 'Aquí está mal la UI' });
  await host.invoke('comment.add', { workspaceId: workspace.id, x: 10, y: 20, text: 'Comentario del lienzo' });
  await host.invoke('terminal.close', { workspaceId: workspace.id, nodeId });
  const after = host.store.getWorkspace(workspace.id);
  assert.ok(!after.nodes.some(n => n.id === nodeId));
  assert.deepEqual(after.comments.map(c => c.messages[0].text), ['Comentario del lienzo']);
});

test('un estado guardado con pines huérfanos se repara al cargar', async t => {
  const { project, dataDir } = fixture(t, 'comment-load');
  const host = await createHost({ dataDir });
  const workspace = await host.invoke('workspace.open', { path: project });
  const note = await host.invoke('node.create', { workspaceId: workspace.id, type: 'note', title: 'Nota', x: 0, y: 0, width: 200, height: 200, data: {} });
  await host.invoke('comment.add', { workspaceId: workspace.id, nodeId: note.id, x: .5, y: .5, text: 'Se queda' });
  await host.invoke('comment.add', { workspaceId: workspace.id, x: 1, y: 1, text: 'Del lienzo' });
  host.store.flush();
  await host.close();
  // An older version closed a panel without dropping its pin.
  const file = path.join(dataDir, 'state.json'), state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const saved = state.workspaces.find(w => w.id === workspace.id);
  saved.comments.push({ ...saved.comments[0], id: '0b7c2f0e-8a8e-4c1e-9d5f-2a6b9c3d4e5f', nodeId: '6f1d2c3b-4a5e-4f6a-8b7c-9d0e1f2a3b4c' });
  fs.writeFileSync(file, JSON.stringify(state));
  const store = new Store(dataDir);
  assert.deepEqual(store.getWorkspace(workspace.id).comments.map(c => c.messages[0].text).sort(), ['Del lienzo', 'Se queda']);
});
