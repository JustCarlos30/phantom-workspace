import test from 'node:test';
import assert from 'node:assert/strict';
import { appendReviewComment, changesLayout, changesSession, CHANGES_MIN_ZOOM } from './changes-canvas.mjs';

const node = { x: -120, y: 240, width: 640, height: 560, data: { worktree: { path: '/synthetic/session-a' }, sessionId: 'pty-a', chat: { provider: 'claude', sessionId: 'chat-a' } } };
const area = { left: 100, right: 80, top: 72, bottom: 16 };
const view = { width: 1800, height: 1000 };

test('companion uses real source geometry, a 24px gap and readable dimensions', () => {
  const layout = changesLayout(node, null, area, view);
  assert.deepEqual(layout.placement, { left: 544, top: 240, width: 720, height: 560 });
  assert.equal(layout.expanded, false);
  assert.ok(layout.camera.zoom >= CHANGES_MIN_ZOOM);
  const c = layout.camera, p = layout.placement;
  assert.ok(node.x * c.zoom + c.x >= area.left);
  assert.ok((p.left + p.width) * c.zoom + c.x <= view.width - area.right);
  assert.ok(node.y * c.zoom + c.y >= area.top);
  assert.ok((p.top + p.height) * c.zoom + c.y <= view.height - area.bottom);
});

test('live drag and resize previews drive placement without mutating the source', () => {
  const preview = { x: 85, y: -50, width: 820, height: 320 };
  const layout = changesLayout(node, preview, area, view);
  assert.deepEqual(layout.placement, { left: 929, top: -50, width: 720, height: 480 });
  assert.equal(node.x, -120);
  assert.equal(node.width, 640);
  assert.deepEqual(preview, { x: 85, y: -50, width: 820, height: 320 });
});

test('narrow or unmeasured stages choose expanded instead of unreadable scaling', () => {
  for (const narrow of [{ width: 780, height: 720 }, { width: 0, height: 0 }, { width: 1800, height: 300 }]) {
    const layout = changesLayout(node, null, area, narrow);
    assert.equal(layout.expanded, true);
    assert.equal(layout.placement.width, 720);
  }
  assert.equal(changesLayout(null, null, area, view), null);
  assert.equal(changesLayout({ ...node, width: NaN }, null, area, view), null);
  assert.equal(changesLayout({ ...node, height: 0 }, null, area, view), null);
});

test('session identity changes only for worktree, PTY or chat destination changes', () => {
  assert.equal(changesSession(node), changesSession({ ...node, title: 'Renombrado', x: 100 }));
  for (const data of [{ ...node.data, sessionId: 'pty-b' }, { ...node.data, worktree: { path: '/synthetic/session-b' } }, { ...node.data, chat: { provider: 'claude', sessionId: 'chat-b' } }, { ...node.data, chat: { provider: 'codex', sessionId: 'chat-a' } }]) {
    assert.notEqual(changesSession(node), changesSession({ ...node, data }));
  }
});

test('file comments append the complete range and multiline quote to the existing draft', () => {
  assert.equal(appendReviewComment('Borrador previo  ', { path: 'src/demo.jsx', startLine: 4, endLine: 7, text: 'Revisar esto\nY esto también' }), 'Borrador previo  \n\nRevisión de src/demo.jsx:L4-L7\n> Revisar esto\n> Y esto también');
  assert.equal(appendReviewComment('', { path: 'a.txt', startLine: 1, endLine: 1, text: 'Comentario' }), 'Revisión de a.txt:L1\n> Comentario');
});

test('invalid comments never modify the draft or invent line ranges', () => {
  const good = { path: 'a.txt', startLine: 2, endLine: 4, text: 'Revisar' };
  for (const bad of [null, { ...good, path: '' }, { ...good, text: ' ' }, { ...good, startLine: 0 }, { ...good, endLine: 1 }, { ...good, startLine: 1.5 }, { ...good, endLine: null }]) assert.equal(appendReviewComment('Conservar', bad), 'Conservar');
});
