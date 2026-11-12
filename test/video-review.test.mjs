import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { videoReview } from '../integrations/video-review.mjs';
import { handleIntegration } from '../integrations/index.mjs';

const revision = 'a'.repeat(64);
const bytes = Buffer.from('synthetic mp4 bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
async function workshop(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'bin'));
  await mkdir(path.join(root, 'projects/demo/exports'), { recursive: true });
  await writeFile(path.join(root, 'REVIEW.md'), 'fixture v1');
  const pkg = { schemaVersion: 1, project: 'demo', revision, video: { width: 1920, height: 1080, fps: 30, durationInFrames: 90 }, elements: [], origin: { kind: 'render', file: 'exports/render.mp4', sha256, revision, snapshot: 'render' } };
  await writeFile(path.join(root, 'projects/demo/exports/render.mp4'), bytes);
  await writeFile(path.join(root, 'projects/demo/exports/render.mp4.review.json'), JSON.stringify({ schemaVersion: 1, snapshot: 'render', revision, sha256 }));
  const context = { workspace: { id: 'fixture', path: root } };
  const stub = async body => writeFile(path.join(root, 'bin/video.mjs'), body);
  await stub(`const args = process.argv.slice(2); const input = JSON.parse(args[4]);
    if (args[1] === 'export') console.log(JSON.stringify(${JSON.stringify(pkg)}));
    else if (args[1] === 'list') console.log(JSON.stringify({schemaVersion:1,currentRevision:${JSON.stringify(revision)},comments:[]}));
    else console.log(JSON.stringify({...input, resolved:args[1]==='resolve', argv:args,cwd:process.cwd()}));`);
  const call = (action, input = {}) => videoReview(`review.${action}`, { slug: 'demo', input }, context);
  return { root, context, pkg, stub, call };
}

test('detects only real workshops and registers review methods', async t => {
  const f = await workshop(t);
  const result = await handleIntegration('review.projects', {}, f.context);
  assert.equal(result.handled, true);
  assert.deepEqual(result.result.items, [{ slug: 'demo', renders: [{ name: 'render.mp4', revision, snapshot: 'render' }] }]);
  await rm(path.join(f.root, 'REVIEW.md'));
  const missing = await f.call('projects');
  assert.equal(missing.available, false);
  assert.match(missing.reason, /bin\/video.mjs y REVIEW.md/);
  await symlink(path.join(f.root, 'bin/video.mjs'), path.join(f.root, 'REVIEW.md'));
  assert.equal((await f.call('projects')).available, false);
});

test('CLI receives separate argv and literal JSON without a shell', async t => {
  const f = await workshop(t);
  const input = { id: 'nota-1', revision, frame: 0, text: 'ala " ; $(touch escaped) `echo nope`\nsegunda línea' };
  const result = await f.call('add', input);
  assert.deepEqual(result.argv, ['review', 'add', 'demo', '--json', JSON.stringify(input)]);
  assert.equal(result.text, input.text);
  assert.equal(result.cwd, f.root);
  const resolved = await f.call('resolve', { id: input.id, revision });
  assert.equal(resolved.resolved, true);
  assert.equal((await f.call('list')).schemaVersion, 1);
  let observed;
  await videoReview('review.list', { slug: 'demo' }, { ...f.context, execFile: async (file, args, options) => { observed = { file, args, options }; return { stdout: '{"schemaVersion":1,"comments":[]}', code: 0 }; } });
  assert.equal(observed.file, process.execPath);
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.cwd, f.root);
  assert.equal(observed.options.timeout, 30000);
  assert.equal(observed.options.maxBuffer, 2 * 1024 * 1024);
});

test('nonzero exit is checked before stdout parsing and lock errors explain retry', async t => {
  const f = await workshop(t);
  await f.stub(`console.log('{"schemaVersion":1,"comments":[]}'); console.error('Error: fallo deliberado'); process.exitCode=7;`);
  await assert.rejects(f.call('list'), /fallo deliberado/);
  await f.stub(`console.error('Error: lock ocupado por otro comando'); process.exitCode=1;`);
  await assert.rejects(f.call('add', {}), /Reintenta cuando termine/);
});

test('concurrent panels serialize CLI calls and a failure does not block the next request', async t => {
  const f = await workshop(t);
  let active = 0, maximum = 0, calls = 0;
  const context = { ...f.context, execFile: async () => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    if (calls === 1) throw new Error('Error: fallo inicial');
    return { stdout: '{"schemaVersion":1,"comments":[]}' };
  } };
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => videoReview('review.list', { slug: 'demo' }, context)));
  assert.equal(maximum, 1);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled', 'fulfilled']);
});

test('requires one JSON object and schemaVersion 1 where applicable', async t => {
  const f = await workshop(t);
  for (const stdout of ['{}\n{}', 'log\n{}', '[]', 'null', '{"schemaVersion":2}', '{}']) {
    await f.stub(`process.stdout.write(${JSON.stringify(stdout)});`);
    await assert.rejects(f.call('list'), /JSON|objeto|schemaVersion/);
  }
  await f.stub(`console.log(JSON.stringify(${JSON.stringify({ ...f.pkg, schemaVersion: 2 })}));`);
  await assert.rejects(f.call('export', { render: 'render.mp4' }), /schemaVersion/);
});

test('render export verifies MP4 hash and exact association on the host', async t => {
  const f = await workshop(t);
  assert.deepEqual(await f.call('export', { render: 'render.mp4' }), f.pkg);
  await assert.rejects(f.call('export', { render: 'other.mp4' }), /otro render/);
  await writeFile(path.join(f.root, 'projects/demo/exports/render.mp4'), 'changed');
  await assert.rejects(f.call('export', { render: 'render.mp4' }), /hash.*renderizar/);
});

test('catalog exposes missing and invalid sidecars without inventing associations', async t => {
  const f = await workshop(t);
  await writeFile(path.join(f.root, 'projects/demo/exports/old.mp4'), bytes);
  await writeFile(path.join(f.root, 'projects/demo/exports/render.mp4.review.json'), '{"schemaVersion":2}');
  const catalog = await f.call('projects');
  assert.equal(catalog.items[0].renders.length, 2);
  assert.match(catalog.items[0].renders.find(r => r.name === 'old.mp4').reason, /sin sidecar/);
  assert.match(catalog.items[0].renders.find(r => r.name === 'render.mp4').reason, /renderizar de nuevo/);
});

test('rejects traversal and symlinks in project and export paths', async t => {
  const f = await workshop(t);
  for (const slug of ['../demo', 'demo/../../bin', '/tmp/demo', 'demo\\escape', 'demo;id']) await assert.rejects(videoReview('review.list', { slug }, f.context), /Slug/);
  for (const render of ['../render.mp4', '/tmp/render.mp4', 'render.mp4;id', 'a\\b.mp4']) await assert.rejects(f.call('export', { render }), /Nombre/);
  const mp4 = path.join(f.root, 'projects/demo/exports/render.mp4');
  await rm(mp4); await symlink(path.join(f.root, 'REVIEW.md'), mp4);
  await assert.rejects(f.call('export', { render: 'render.mp4' }), /Symlink/);
  await assert.rejects(f.call('projects'), /simbólicos/);
  await rm(mp4);
  await symlink(path.join(f.root, 'projects/demo'), path.join(f.root, 'projects/alias'));
  await assert.rejects(videoReview('review.list', { slug: 'alias' }, f.context), /Symlink/);
});
