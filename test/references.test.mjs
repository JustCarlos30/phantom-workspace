import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHost } from '../host/server.mjs';
import { imageSize, pageMeta, sniff } from '../host/references.mjs';
import { main as canvas, planBoard, readingOrder, freeSlot } from '../scripts/canvas.mjs';
import { byteRange, referenceTarget, contentSecurityPolicy, HOST_METHODS, validateInvocation } from '../desktop/security.mjs';
import { readTransfer, timecode, visibleComments, commentBrief } from '../src/hooks/references.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]);

test('media is recognised by content, never by name', () => {
  assert.deepEqual(sniff(PNG), { kind: 'image', mime: 'image/png', ext: 'png' });
  assert.equal(sniff(MP4).kind, 'video');
  assert.equal(sniff(Buffer.from('<svg onload="x"/>')), null);
  assert.deepEqual(imageSize(PNG), { width: 2, height: 1 });
  const meta = pageMeta('<title>Plain</title><meta property="og:title" content="Tom &amp; Jerry"><meta name="description" content="d"><meta property="og:image" content="/a.png">', 'https://example.com/x/y');
  assert.deepEqual([meta.title, meta.description, meta.image], ['Tom & Jerry', 'd', 'https://example.com/a.png']);
});

test('references, comments and the agent CLI share one board', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-refs-')), project = path.join(root, 'project'), dataDir = path.join(root, 'state');
  fs.mkdirSync(project);
  const site = http.createServer((req, res) => {
    if (req.url === '/shot.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); }
    else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><head><title>Fallback</title><meta property="og:title" content="Estudio"><meta property="og:description" content="Portafolio"><meta property="og:image" content="/shot.png"></head></html>'); }
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${site.address().port}`;
  const host = await createHost({ dataDir });
  t.after(async () => { await host.close(); site.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const w = await host.invoke('workspace.open', { path: project });
  const run = (...args) => canvas([...args, '--workspace', project], {}, (method, payload) => host.invoke(method, payload));

  // In-process results are the store's own objects; copy them as the socket would.
  const pasted = structuredClone(await host.invoke('reference.add', { workspaceId: w.id, data: PNG.toString('base64'), x: 100, y: 100, center: true, note: 'paleta' }));
  assert.equal(pasted.type, 'reference'); assert.equal(pasted.data.kind, 'image'); assert.equal(pasted.data.aspect, 2);
  assert.equal(pasted.x, 100 - pasted.width / 2);
  const stored = path.join(dataDir, 'references', w.id, pasted.data.file);
  assert.ok(fs.existsSync(stored)); assert.equal(fs.statSync(stored).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(project), [], 'nothing is written into the project folder');

  const clip = path.join(root, 'clip.mp4'); fs.writeFileSync(clip, MP4);
  const video = structuredClone(await host.invoke('reference.add', { workspaceId: w.id, path: clip }));
  assert.equal(video.data.kind, 'video'); assert.equal(video.title, 'clip');
  await assert.rejects(host.invoke('reference.add', { workspaceId: w.id, data: Buffer.from('not media').toString('base64') }), /Formato no compatible/);
  await assert.rejects(host.invoke('reference.add', { workspaceId: w.id, path: path.join(root, 'missing.png') }), /ENOENT/);
  await assert.rejects(host.invoke('node.update', { workspaceId: w.id, id: pasted.id, patch: { data: { ...pasted.data, file: '../../state.json' } } }), /Invalid reference file/);

  const link = await host.invoke('reference.link', { workspaceId: w.id, url: `${base}/page` });
  assert.equal(link.data.kind, 'link'); assert.equal(link.title, 'Estudio'); assert.equal(link.data.description, 'Portafolio'); assert.equal(link.data.file, pasted.data.file);
  const direct = await host.invoke('reference.link', { workspaceId: w.id, url: `${base}/shot.png` });
  assert.equal(direct.data.kind, 'image'); assert.equal(direct.data.source, `${base}/shot.png`);
  await assert.rejects(host.invoke('reference.link', { workspaceId: w.id, url: 'file:///etc/passwd' }), /HTTP/);
  const offline = await host.invoke('reference.link', { workspaceId: w.id, url: 'http://127.0.0.1:1/x' });
  assert.equal(offline.data.kind, 'link', 'an unreachable site is still a link reference');

  const pin = await host.invoke('comment.add', { workspaceId: w.id, nodeId: video.id, x: .25, y: 2, time: 12.4, text: ' corte más rápido ' });
  assert.deepEqual([pin.x, pin.y, pin.time, pin.messages[0].text, pin.messages[0].author], [.25, 1, 12.4, 'corte más rápido', 'Tú']);
  await assert.rejects(host.invoke('comment.add', { workspaceId: w.id, nodeId: video.id, x: 0, y: 0, text: '   ' }), /Empty comment/);
  assert.match(await run('comments'), /\[clip\] #1 25%,100% · 0:12 Tú: corte más rápido/);
  await run('reply', '1', 'Listo, recortado a 2s', '--author', 'Claude');
  await run('comment', 'Imagen', 'Usar este azul', '--at', '10,20');
  assert.equal((await run('comments', '--json')).length, 2);
  await run('resolve', '2');
  assert.equal((await run('comments', '--json')).length, 1);

  const list = path.join(root, 'refs.json');
  fs.writeFileSync(list, JSON.stringify([{ image: clip, note: 'ritmo' }, { url: `${base}/page`, note: 'tipografía' }, { image: `${base}/shot.png`, title: 'Captura' }, { image: path.join(root, 'nope.png') }]));
  const report = await run('board', 'Moodboard', '--from', list);
  assert.match(report, /creado con 3 referencias/); assert.match(report, /No se pudieron añadir 1/);
  const refs = await run('refs', '--zone', 'Moodboard', '--json');
  assert.equal(refs.length, 3);
  assert.ok(refs.every(r => r.kind === 'link' || fs.existsSync(r.file)));
  assert.equal(refs.find(r => r.kind === 'link').note, 'tipografía');
  const state = await host.invoke('state.get'), nodes = state.workspaces[0].nodes, zone = nodes.find(n => n.type === 'zone');
  const members = nodes.filter(n => n.type === 'reference' && n.x >= zone.x && n.y >= zone.y && n.x + n.width <= zone.x + zone.width && n.y + n.height <= zone.y + zone.height);
  assert.equal(members.length, 3);
  for (const a of members) for (const b of members) if (a !== b) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'board members do not overlap');
  await run('add-image', clip, '--zone', 'Moodboard', '--note', 'otra toma');
  assert.equal((await run('refs', '--zone', 'Moodboard', '--json')).length, 4);
  assert.match(await run('storyboard', 'Moodboard'), /# Storyboard: Moodboard\n\n## Toma 1 — /);
  assert.match(await run('refs'), /por qué: paleta/);

  await host.invoke('node.remove', { workspaceId: w.id, id: video.id });
  assert.equal((await host.invoke('comment.list', { workspaceId: w.id })).some(c => c.nodeId === video.id), false, 'pins leave with their panel');
  assert.ok(fs.existsSync(path.join(dataDir, 'references', w.id, video.data.file)), 'a file still shown by another panel stays');
  for (const n of (await host.invoke('state.get')).workspaces[0].nodes.filter(n => n.data.file === pasted.data.file)) await host.invoke('node.remove', { workspaceId: w.id, id: n.id });
  assert.equal(fs.existsSync(stored), false, 'an unreferenced file is deleted');
});

test('layout helpers keep reading order and pack boards', () => {
  const box = (id, x, y, width = 100, height = 100) => ({ id, x, y, width, height });
  assert.deepEqual(readingOrder([box('c', 0, 200), box('b', 200, 10), box('a', 0, 0)]).map(n => n.id), ['a', 'b', 'c']);
  const plan = planBoard([box('a', 0, 0, 360, 200), box('b', 0, 0, 360, 400), box('c', 0, 0, 360, 100)], { cols: 2 });
  assert.equal(plan.moves[2].x, plan.moves[0].x, 'the third goes under the shortest column');
  assert.deepEqual(freeSlot({ x: 0, y: 0, width: 400, height: 400 }, [], 100, 100), { x: 40, y: 64 });
  assert.equal(freeSlot({ x: 0, y: 0, width: 200, height: 200 }, [], 300, 100), null);
});

test('the desktop serves reference files only by workspace and content-hash name', () => {
  const id = '10dec435-6bd1-437c-a406-ea43f76bc05a', file = '33596f87751f5980f005f22961e93040.png';
  assert.deepEqual(referenceTarget(`phantom-ref://${id}/${file}`), { workspaceId: id, file, type: 'image/png' });
  for (const bad of [`phantom-ref://${id}/../state.json`, `phantom-ref://${id}/${file}?x=1`, `phantom-ref://${id}/a/${file}`, `phantom-ref://nope/${file}`, `file:///${file}`, `phantom-ref://${id}/${file.replace('png', 'svg')}`]) assert.equal(referenceTarget(bad), null, bad);
  assert.deepEqual(byteRange('bytes=10-', 100), { start: 10, end: 99 });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=0-999', 100), { start: 0, end: 99 });
  assert.equal(byteRange('bytes=200-', 100), false); assert.equal(byteRange(null, 100), null);
  assert.match(contentSecurityPolicy(), /img-src 'self' data: blob: phantom-ref:;.*media-src 'self' blob: phantom-ref: phantom-review:;/);
  for (const method of ['reference.add', 'reference.link', 'comment.add', 'comment.reply', 'comment.update', 'comment.remove']) assert.ok(HOST_METHODS.has(method));
  validateInvocation('reference.add', { workspaceId: id, data: 'A'.repeat(15 * 1024 * 1024) });
  assert.throws(() => validateInvocation('comment.add', { text: 'A'.repeat(2 * 1024 * 1024) }), /grande/);
});

test('a paste or drop is read as files, links or a note', () => {
  const transfer = (files, data = {}) => ({ files, getData: type => data[type] || '' });
  const image = { type: 'image/png', name: 'image.png' };
  assert.deepEqual(readTransfer(transfer([image], { 'text/plain': 'https://a.com/x.png' })), [{ kind: 'file', file: image }]);
  assert.deepEqual(readTransfer(transfer([], { 'text/plain': 'https://a.com\nhttps://b.com/x' })).map(i => i.url), ['https://a.com', 'https://b.com/x']);
  assert.deepEqual(readTransfer(transfer([], { 'text/plain': 'idea: abrir con https://a.com' })), [{ kind: 'note', text: 'idea: abrir con https://a.com' }]);
  assert.deepEqual(readTransfer(transfer([{ type: 'application/pdf', name: 'a.pdf' }])), []);
  assert.equal(timecode(12.4), '0:12'); assert.equal(timecode(3725), '1:02:05');
  const comments = [{ id: 'a', nodeId: 'n1', x: .1, y: .2, time: 65, messages: [{ author: 'Tú', text: 'hola' }] }, { id: 'b', nodeId: null, x: 5, y: 5, spaceId: 's', messages: [] }, { id: 'c', nodeId: 'gone', messages: [] }];
  assert.deepEqual(visibleComments(comments, [{ id: 'n1' }], null).map(c => [c.id, c.number]), [['a', 1]]);
  assert.deepEqual(visibleComments(comments, [], 's').map(c => c.id), ['b']);
  assert.equal(commentBrief(comments[0], { type: 'reference', title: 'Clip', data: {} }, '/x/clip.mp4'), 'Comentario en Referencia "Clip" (/x/clip.mp4) — posición 10%, 20% · minuto 1:05:\n- Tú: hola');
});

test('@phantom in a person\'s comment hands the thread to the agent, once and safely', async () => {
  const { handleReference, MENTION } = await import('../host/references.mjs');
  const { Store } = await import('../host/store.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-mention-')), project = path.join(root, 'p'); fs.mkdirSync(project);
  try {
    const store = new Store(path.join(root, 'state')), w = store.transaction(() => store.open(project));
    const mutate = (_, fn) => store.transaction(fn), sent = [];
    let fail = false;
    const ctx = { store, mutate, dataDir: path.join(root, 'state'), mention: async (_, comment) => { if (fail) throw new Error('sin proveedor'); sent.push(comment.messages.at(-1).text); return { queued: sent.length > 1 }; } };
    const node = await handleReference('reference.add', { workspaceId: w.id, data: PNG.toString('base64') }, ctx);
    const quiet = await handleReference('comment.add', { workspaceId: w.id, nodeId: node.id, x: .5, y: .5, text: 'solo para mí, correo a ana@phantom.dev' }, ctx);
    assert.equal(quiet.mention, undefined); assert.equal(sent.length, 0);
    const asked = await handleReference('comment.add', { workspaceId: w.id, nodeId: node.id, x: .5, y: .5, time: 61, text: '@phantom busca 3 referencias con esta luz' }, ctx);
    assert.equal(asked.mention, 'sent');
    const agent = await handleReference('comment.reply', { workspaceId: w.id, id: asked.id, text: 'Listo @phantom', author: 'Phantom' }, ctx);
    assert.equal(agent.mention, undefined, 'the agent replying never re-triggers itself');
    assert.equal((await handleReference('comment.reply', { workspaceId: w.id, id: asked.id, text: '@Claude más cálidas' }, ctx)).mention, 'queued');
    fail = true;
    const lost = await handleReference('comment.reply', { workspaceId: w.id, id: asked.id, text: '@agente otra' }, ctx);
    assert.equal(lost.mention, 'failed'); assert.equal(lost.messages.length, 4, 'the comment is kept even when the agent is unreachable');
    assert.ok(MENTION.test('(@phantom)') && !MENTION.test('x@phantom.dev'));
    const { mentionBrief } = await import('../host/references.mjs');
    const brief = mentionBrief(store.getWorkspace(w.id), store.getWorkspace(w.id).comments[1], ctx.dataDir, '/app/scripts/canvas.mjs');
    assert.match(brief, /comment thread #2 on reference \(image\) "Imagen"/); assert.match(brief, /at 1:01 \(61s\)/); assert.match(brief, /File: .*references.*\.png/); assert.match(brief, /reply 2 "<short answer>" --author Phantom/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a zone exports as a Remotion project and re-exports in place', async () => {
  const { exportRemotion } = await import('../scripts/canvas.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-remotion-')), still = path.join(root, 'a.png'), clip = path.join(root, 'b.mp4');
  fs.writeFileSync(still, PNG); fs.writeFileSync(clip, MP4);
  try {
    const rows = [{ n: 1, title: 'Luz', kind: 'image', file: still, note: 'fría', comments: [] }, { n: 2, title: 'Corte', kind: 'video', file: clip, comments: [{ seconds: 8 }, { seconds: 4.5 }] }, { n: 3, title: 'Sitio', kind: 'link', url: 'https://a.com', comments: [] }];
    const out = path.join(root, 'out'), made = exportRemotion(out, 'Mi Secuencia', rows, { seconds: 2, fps: 25 });
    assert.deepEqual([made.shots, made.seconds, made.fresh], [3, 6, true]);
    const plan = JSON.parse(fs.readFileSync(path.join(out, 'src', 'shots.json'), 'utf8'));
    assert.deepEqual(plan.shots.map(s => [s.file, s.frames, s.startFrom]), [['shots/01.png', 50, 0], ['shots/02.mp4', 50, 113], [null, 50, 0]]);
    assert.ok(fs.existsSync(path.join(out, 'public', 'shots', '02.mp4')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')).name, 'mi-secuencia');
    fs.appendFileSync(path.join(out, 'src', 'Storyboard.tsx'), '// mine\n');
    assert.equal(exportRemotion(out, 'Mi Secuencia', rows.slice(0, 1)).fresh, false);
    assert.match(fs.readFileSync(path.join(out, 'src', 'Storyboard.tsx'), 'utf8'), /\/\/ mine/, 'your edits to the composition survive a re-export');
    assert.deepEqual(fs.readdirSync(path.join(out, 'public', 'shots')), ['01.png']);
    fs.mkdirSync(path.join(root, 'busy')); fs.writeFileSync(path.join(root, 'busy', 'x'), '');
    assert.throws(() => exportRemotion(path.join(root, 'busy'), 'x', rows), /no está vacía/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
