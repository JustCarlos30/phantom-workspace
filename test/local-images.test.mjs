import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLocalImage, imagePreviewRoots } from '../desktop/local-image.mjs';
import { saveBrowserArtifact } from '../desktop/agent-browser.mjs';
import { markdownTarget } from '../src/hooks/markdownLinks.mjs';

test('Markdown targets decode local paths and reject executable or remote-file URLs', () => {
  assert.deepEqual(markdownTarget('file:///tmp/opencode/captura%20final.PNG'), { kind: 'image', path: '/tmp/opencode/captura final.PNG' });
  assert.deepEqual(markdownTarget('/home/user/report.md'), { kind: 'file', path: '/home/user/report.md' });
  assert.deepEqual(markdownTarget('https://example.com/review'), { kind: 'web', url: 'https://example.com/review' });
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file://remote/share/a.png', 'file:///a%00.png', '//remote/a.png', 'file:///a.png?x=1', 'file:///a.png#x', 'file:///bad%XX.png', 'https://user:pass@example.com']) assert.equal(markdownTarget(url), null, url);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const WS = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';

test('Preview authorizes saveBrowserArtifact captures only for registered workspaces', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'phantom-art-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dataDir = path.join(base, 'data'), project = path.join(base, 'project');
  await mkdir(dataDir); await mkdir(project);
  const shot = saveBrowserArtifact(dataDir, WS, PNG).path;
  const unknown = saveBrowserArtifact(dataDir, OTHER, PNG).path;
  await writeFile(path.join(dataDir, 'state.png'), PNG);
  const roots = await imagePreviewRoots([project], [{ id: WS }], dataDir);
  assert.match((await readLocalImage(shot, roots)).dataUrl, /^data:image\/png;base64,/);
  await assert.rejects(readLocalImage(unknown, roots), /fuera/);
  await assert.rejects(readLocalImage(path.join(dataDir, 'state.png'), roots), /fuera/);
  const bad = await imagePreviewRoots([project], [{ id: '../x' }, { id: WS }], dataDir);
  assert.ok(!bad.some(root => root.endsWith('..') || root === dataDir));
  assert.ok(roots.includes('/tmp/opencode'));
});

test('Browser artifact roots reject symlinked directories and files escaping the tree', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'phantom-art-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dataDir = path.join(base, 'data'), outside = path.join(base, 'outside');
  await mkdir(dataDir, { mode: 0o700 }); await mkdir(outside);
  await writeFile(path.join(outside, 'a.png'), PNG);
  await mkdir(path.join(dataDir, 'browser-artifacts'), { mode: 0o700 });
  await symlink(outside, path.join(dataDir, 'browser-artifacts', WS));
  const linkedDir = await imagePreviewRoots([], [{ id: WS }], dataDir);
  assert.ok(!linkedDir.includes(outside));
  await assert.rejects(readLocalImage(path.join(outside, 'a.png'), linkedDir), /fuera/);
  await rm(path.join(dataDir, 'browser-artifacts', WS));
  const real = saveBrowserArtifact(dataDir, WS, PNG).path;
  const link = path.join(path.dirname(real), 'link.png');
  await symlink(path.join(outside, 'a.png'), link);
  const roots = await imagePreviewRoots([], [{ id: WS }], dataDir);
  await assert.rejects(readLocalImage(link, roots), /fuera/);
  assert.ok((await readLocalImage(real, roots)).dataUrl);
});

test('Browser artifact preview keeps raster validation and size limits', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'phantom-art-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const real = saveBrowserArtifact(base, WS, PNG).path, dir = path.dirname(real);
  const roots = await imagePreviewRoots([], [{ id: WS }], base);
  await writeFile(path.join(dir, 'fake.png'), '<svg onload="alert(1)"></svg>');
  await assert.rejects(readLocalImage(path.join(dir, 'fake.png'), roots), /Formato/);
  await writeFile(path.join(dir, 'large.png'), Buffer.alloc(12 * 1024 * 1024 + 1));
  await assert.rejects(readLocalImage(path.join(dir, 'large.png'), roots), /12 MB/);
  await assert.rejects(readLocalImage(dir, roots), /no es un archivo/);
});

test('Local image preview is bounded to authorized roots and raster formats', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-image-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const allowed = path.join(root, 'workspace'); await mkdir(allowed);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const png = path.join(allowed, 'captura con espacios.png'); await writeFile(png, bytes);
  assert.equal((await readLocalImage(png, [allowed])).dataUrl, `data:image/png;base64,${bytes.toString('base64')}`);
  const outside = path.join(root, 'outside.png'); await writeFile(outside, bytes);
  await symlink(outside, path.join(allowed, 'escape.png'));
  for (const filename of [outside, path.join(allowed, '../outside.png'), path.join(allowed, 'escape.png')]) await assert.rejects(readLocalImage(filename, [allowed]), /fuera/);
  await writeFile(path.join(allowed, 'fake.png'), '<svg onload="alert(1)"></svg>');
  await assert.rejects(readLocalImage(path.join(allowed, 'fake.png'), [allowed]), /Formato/);
  await writeFile(path.join(allowed, 'large.png'), Buffer.alloc(12 * 1024 * 1024 + 1));
  await assert.rejects(readLocalImage(path.join(allowed, 'large.png'), [allowed]), /12 MB/);
  await assert.rejects(readLocalImage(allowed, [allowed]), /no es un archivo/);
  await assert.rejects(readLocalImage(path.join(allowed, 'missing.png'), [allowed]), /ENOENT/);
});
