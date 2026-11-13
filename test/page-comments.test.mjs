import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { mentionBrief, referencePath } from '../host/references.mjs';
import { RESEARCH_LABELS, RESEARCH_STATUS, statusOf, withStatus } from '../shared/research.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';

test('research states and page comments persist their PNG capture', async t => {
  assert.deepEqual(RESEARCH_STATUS, ['inbox', 'liked', 'discarded']);
  assert.deepEqual(RESEARCH_LABELS, { inbox: 'Bandeja', liked: 'Me gusta', discarded: 'Descartadas' });
  assert.equal(statusOf({ data: { tags: ['idea', 'research:liked'] } }), 'liked');
  assert.equal(statusOf({ data: { tags: ['research:unknown'] } }), null);
  assert.deepEqual(withStatus(['idea', 'research:inbox', 'other'], 'discarded'), ['idea', 'other', 'research:discarded']);
  assert.deepEqual(withStatus(['idea', 'research:liked'], null), ['idea']);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-page-comment-'));
  const project = path.join(root, 'project'), dataDir = path.join(root, 'state'); fs.mkdirSync(project);
  const host = await createHost({ dataDir });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: project });
  const browser = await host.invoke('node.create', { workspaceId: workspace.id, type: 'browser', title: 'Docs', x: 0, y: 0, width: 400, height: 300, data: {} });
  const page = { url: 'https://example.com/docs', title: 'Documentacion', capture: `data:image/png;base64,${PNG}` };
  const comment = await host.invoke('comment.add', { workspaceId: workspace.id, nodeId: browser.id, x: .5, y: .5, text: 'Revisar esto', page });
  assert.equal(comment.page.url, page.url); assert.equal(comment.page.title, page.title);
  assert.match(comment.page.capture, /^[0-9a-f]{32}\.png$/);
  const capture = referencePath(dataDir, workspace.id, comment.page.capture);
  assert.ok(fs.existsSync(capture));
  assert.equal((await host.invoke('comment.list', { workspaceId: workspace.id }))[0].page.capture, comment.page.capture);
  const state = await host.invoke('state.get');
  const brief = mentionBrief(state.workspaces[0], state.workspaces[0].comments[0], dataDir, '/cli');
  assert.match(brief, /Página: https:\/\/example\.com\/docs/); assert.ok(brief.includes(`Captura de la página: ${capture} — léela para ver lo que el usuario veía`));
  await assert.rejects(host.invoke('comment.add', { workspaceId: workspace.id, nodeId: browser.id, text: 'no', page: { url: 'file:///tmp/nope' } }), /HTTP/);
  await assert.rejects(host.invoke('comment.add', { workspaceId: workspace.id, nodeId: browser.id, text: 'no', page: { url: 'https://example.com', extra: true } }), /Unsupported page field/);
});
