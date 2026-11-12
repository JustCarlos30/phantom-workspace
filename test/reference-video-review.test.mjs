import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentBox, contentPoint, frameAt, stepTime, validateReview, reviewBrief } from '../shared/video-review.mjs';
import { Store } from '../host/store.mjs';
import { handleReference, mentionBrief, referencePath } from '../host/references.mjs';
import { createHost } from '../host/server.mjs';
import { main as canvas } from '../scripts/canvas.mjs';
import { commentBrief } from '../src/hooks/references.mjs';
import { validateInvocation } from '../desktop/security.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
const reviewFor = n => ({ schema: 1, kind: n.data.kind, file: n.data.file, hash: n.data.hash, region: { type: 'rect', x: .1, y: .2, width: .3, height: .4 }, scope: 'range', time: 1, fps: 24, frame: 24, end: 2, element: 'ala izquierda del pixel art', editableSource: 'src/ave.aseprite' });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-review-')), dataDir = path.join(root, 'state');
  const project = path.join(root, 'project'), second = path.join(root, 'second'); fs.mkdirSync(project); fs.mkdirSync(second);
  const store = new Store(dataDir), w = store.transaction(() => store.open(project)), other = store.transaction(() => store.open(second));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ctx = { store, dataDir, mutate: (_, fn) => store.transaction(fn) };
  return { root, dataDir, project, store, w, other, ctx, call: (method, p = {}) => handleReference(method, { workspaceId: w.id, ...p }, ctx) };
}

test('content geometry excludes chrome/contain bars at zoom, resize and both aspect ratios', () => {
  for (const zoom of [.25, .7, 1, 2]) {
    const box = contentBox({ left: 100, top: 80, width: 400 * zoom, height: 400 * zoom }, 1920, 1080);
    assert.deepEqual(box, { x: 100, y: 80 + 87.5 * zoom, width: 400 * zoom, height: 225 * zoom });
    assert.equal(contentPoint(box, 100 + 200 * zoom, 80), null, 'top bar is not content');
    assert.equal(contentPoint(box, 100, 79), null, 'chrome outside media is excluded');
    assert.deepEqual(contentPoint(box, box.x + box.width * .25, box.y + box.height * .75), { x: .25, y: .75 });
  }
  assert.deepEqual(contentBox({ x: 10, y: 20, width: 800, height: 400 }, 100, 200), { x: 310, y: 20, width: 200, height: 400 });
  for (const size of [0, NaN, Infinity, -1]) assert.equal(contentBox({ width: size, height: 300 }, 2, 1), null);
  assert.equal(contentBox(null, 2, 1), null);
  assert.equal(contentPoint(null, 0, 0), null);
});

test('explicit FPS, frame stepping and review validation reject inconsistent context', () => {
  assert.equal(frameAt(1.5, 24), 36);
  assert.equal(stepTime(1, 1, 24, 3), 25 / 24);
  assert.equal(stepTime(0, -1, 24, 3), 0);
  assert.equal(stepTime(3, 1, 24, 3), 3 - 1 / 24);
  assert.equal(stepTime(1, 1, 29.97, 3), 31 / 29.97);
  for (const fps of [0, -1, Infinity, NaN, 241]) assert.throws(() => stepTime(0, 1, fps, 3), /FPS/);
  assert.throws(() => stepTime(0, 1, 24, Infinity), /duración/);
  const r = reviewFor({ data: { kind: 'video', file: `${'a'.repeat(32)}.mp4`, hash: 'a'.repeat(64) } });
  assert.equal(validateReview(r), r);
  for (const patch of [{ hash: 'b'.repeat(64) }, { file: '../a.mp4' }, { fps: 0 }, { frame: 25 }, { time: -1 }, { end: 1 }, { scope: 'unknown' }, { region: { type: 'rect', x: .9, y: .1, width: .2, height: .2 } }, { region: { type: 'point', x: NaN, y: 0 } }, { element: 'a'.repeat(4097) }, { capture: '/tmp/frame.png' }]) assert.throws(() => validateReview({ ...r, ...patch }));
  assert.throws(() => validateReview({ ...r, scope: 'instant' }), /final/);
  assert.match(reviewBrief(r), /no una selección semántica automática/);
});

test('review, PNG capture, immutable identity and rich handoff persist on their original version', async t => {
  const f = fixture(t), sent = []; f.ctx.mention = async (w, c, brief) => { sent.push({ w: w.id, c: c.id, brief }); return { queued: true, id: 'queue-fixture' }; };
  const original = await f.call('reference.add', { data: MP4.toString('base64') }), review = reviewFor(original), requestId = randomUUID();
  const input = { nodeId: original.id, x: .1, y: .2, text: '@phantom mejora esta ala', review, capture: PNG.toString('base64'), requestId };
  validateInvocation('comment.add', { workspaceId: f.w.id, ...input });
  const made = await f.call('comment.add', input);
  assert.equal(made.handoff.status, 'queued'); assert.equal(made.handoff.queueId, 'queue-fixture'); assert.equal(made.resolved, false);
  assert.equal(sent.length, 1); assert.equal(sent[0].w, f.w.id);
  for (const text of [review.hash, '"frame": 24', '"fps": 24', '"scope": "range"', '"width": 0.3', review.element, review.editableSource, 'Captura:', 'Do not resolve']) assert.ok(sent[0].brief.includes(text), text);
  assert.match(sent[0].brief, /decoded content \(not panel chrome\)/);
  assert.ok(fs.readFileSync(referencePath(f.dataDir, f.w.id, made.review.capture)).equals(PNG));
  const duplicated = await f.call('comment.add', input); assert.equal(duplicated.id, made.id); assert.equal(sent.length, 1);
  const nextBytes = Buffer.concat([MP4, Buffer.from('render 2')]);
  const next = await f.call('reference.add', { data: nextBytes.toString('base64'), previousVersion: original.id });
  assert.equal(next.data.previousVersion, original.id); assert.notEqual(next.data.hash, review.hash);
  assert.ok(fs.readFileSync(referencePath(f.dataDir, f.w.id, original.data.file)).equals(MP4));
  await assert.rejects(f.call('reference.add', { data: MP4.toString('base64'), previousVersion: original.id }), /idéntico/);
  await assert.rejects(f.call('comment.add', { ...input, requestId: randomUUID(), nodeId: next.id }), /inmutable/);
  await assert.rejects(f.call('comment.add', { ...input, workspaceId: f.other.id, requestId: randomUUID() }), /Node not found/);
  await assert.rejects(f.call('reference.add', { data: nextBytes.toString('base64'), workspaceId: f.other.id, previousVersion: original.id }), /fuera del proyecto/);
  const fresh = new Store(f.dataDir), saved = fresh.getWorkspace(f.w.id).comments[0];
  assert.deepEqual(saved, f.store.getWorkspace(f.w.id).comments[0]);
  assert.equal(saved.nodeId, original.id); assert.equal(saved.review.hash, review.hash);
  assert.equal(fresh.getWorkspace(f.other.id).comments, undefined);
  assert.match(commentBrief(saved, original, '/media/original.mp4'), /ala izquierda/);
});

test('save failure rolls back, explicit retry reuses the persisted brief and never creates another comment', async t => {
  const f = fixture(t), n = await f.call('reference.add', { data: MP4.toString('base64') });
  let attempts = 0, fail = true; const briefs = [];
  f.ctx.mention = async (_, c, brief) => { attempts++; briefs.push(brief); if (fail) throw new Error('cola no disponible'); return { queued: true, id: 'retry-fixture' }; };
  const requestId = randomUUID(), input = { nodeId: n.id, text: '@phantom corrige el ala', review: reviewFor(n), requestId };
  const persist = f.store.persist.bind(f.store); f.store.persist = () => { throw new Error('disco lleno'); };
  await assert.rejects(f.call('comment.add', input), /disco lleno/); assert.equal(attempts, 0);
  assert.equal(f.store.getWorkspace(f.w.id).comments?.length || 0, 0);
  f.store.persist = persist;
  const made = await f.call('comment.add', input); assert.equal(made.handoff.status, 'failed'); assert.equal(attempts, 1);
  assert.equal((await f.call('comment.add', input)).id, made.id); assert.equal(attempts, 1, 'response retry must not retry delivery implicitly');
  fail = false;
  const again = await f.call('comment.retry', { id: made.id });
  assert.equal(again.handoff.status, 'queued'); assert.equal(attempts, 2); assert.equal(briefs[0], briefs[1]);
  assert.equal(f.store.getWorkspace(f.w.id).comments.length, 1); assert.equal(again.messages.length, 1); assert.equal(again.resolved, false);
  await assert.rejects(f.call('comment.retry', { id: made.id }), /Solo se reintenta/);
  const reply = { id: made.id, text: 'respuesta local', author: 'Phantom', requestId: randomUUID() };
  await f.call('comment.reply', reply); await f.call('comment.reply', reply);
  assert.equal(f.store.getWorkspace(f.w.id).comments[0].messages.length, 2, 'reply retries are idempotent too');
  assert.equal(new Store(f.dataDir).getWorkspace(f.w.id).comments[0].handoff.status, 'queued');
});

test('delivery acknowledgment failure and interrupted host expose uncertainty without replay', async t => {
  const f = fixture(t), n = await f.call('reference.add', { data: MP4.toString('base64') });
  let deliveries = 0; const persist = f.store.persist.bind(f.store);
  f.ctx.mention = async () => { deliveries++; let once = true; f.store.persist = () => { if (once) { once = false; throw new Error('acuse sin guardar'); } persist(); }; return { queued: false }; };
  const made = await f.call('comment.add', { nodeId: n.id, text: '@phantom revisa', review: reviewFor(n), requestId: randomUUID() });
  assert.equal(made.handoff.status, 'uncertain'); assert.equal(deliveries, 1);
  await assert.rejects(f.call('comment.retry', { id: made.id }), /Solo se reintenta/);
  f.store.persist = persist;
  f.store.transaction(() => { f.store.getWorkspace(f.w.id).comments[0].handoff.status = 'sending'; });
  const restarted = new Store(f.dataDir); assert.equal(restarted.getWorkspace(f.w.id).comments[0].handoff.status, 'uncertain');
  assert.equal(deliveries, 1);
});

test('concurrent retry is single-flight and image reviews use the same normalized context', async t => {
  const f = fixture(t), n = await f.call('reference.add', { data: PNG.toString('base64') });
  const review = { schema: 1, file: n.data.file, hash: n.data.hash, kind: 'image', region: { type: 'point', x: .25, y: .5 }, scope: 'all' };
  f.ctx.mention = async () => { throw new Error('offline'); };
  const made = await f.call('comment.add', { nodeId: n.id, text: '@phantom esta imagen', review });
  let finish; f.ctx.mention = () => new Promise(resolve => { finish = resolve; });
  const first = f.call('comment.retry', { id: made.id });
  await assert.rejects(f.call('comment.retry', { id: made.id }), /Solo se reintenta/);
  finish({ queued: true }); await first;
  assert.equal(f.store.getWorkspace(f.w.id).comments[0].review.kind, 'image');
  assert.match(mentionBrief(f.store.getWorkspace(f.w.id), f.store.getWorkspace(f.w.id).comments[0], f.dataDir, '/cli'), /"scope": "all"/);
});

test('host and canvas CLI enforce immutable versions and expose review context consistently', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-review-cli-')), project = path.join(root, 'project'); fs.mkdirSync(project);
  const host = await createHost({ dataDir: path.join(root, 'state') });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const w = await host.invoke('workspace.open', { path: project });
  const n = structuredClone(await host.invoke('reference.add', { workspaceId: w.id, data: MP4.toString('base64'), title: 'Clip' }));
  for (const patch of [{ file: `${'b'.repeat(32)}.mp4` }, { hash: 'b'.repeat(64) }, { kind: 'image' }, { previousVersion: randomUUID() }]) await assert.rejects(host.invoke('node.update', { workspaceId: w.id, id: n.id, patch: { data: { ...n.data, ...patch } } }), /inmutable/);
  await host.invoke('node.update', { workspaceId: w.id, id: n.id, patch: { data: { note: 'nota editable' } } });
  assert.equal((await host.invoke('reference.identity', { workspaceId: w.id, id: n.id })).hash, n.data.hash);
  const run = (...args) => canvas([...args, '--workspace', project], {}, (m, p) => host.invoke(m, p));
  await assert.rejects(run('review', 'Clip', 'sin FPS', '--region', '.1,.2', '--time', '1'), /FPS/);
  const saved = await run('review', 'Clip', 'Revisar ala', '--region', '.1,.2,.3,.4', '--time', '1', '--fps', '24', '--scope', 'range', '--end', '2', '--element', 'ala', '--editable-source', 'ave.aseprite', '--json');
  assert.equal(saved.review.element, 'ala'); assert.equal(saved.review.frame, 24); assert.match(saved.review.captureLimit, /sin captura/);
  assert.match(await run('comments'), /"editableSource": "ave.aseprite"/);
  const render = path.join(root, 'next.mp4'); fs.writeFileSync(render, Buffer.concat([MP4, Buffer.from('next')]));
  await run('add-version', 'Clip', render);
  const refs = await host.invoke('reference.list', { workspaceId: w.id }); assert.equal(refs.length, 2); assert.equal(refs[1].data.previousVersion, n.id);
  assert.equal((await host.invoke('comment.list', { workspaceId: w.id }))[0].nodeId, n.id);
});
