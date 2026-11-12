import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLocalImage } from '../desktop/local-image.mjs';
import { markdownTarget } from '../src/hooks/markdownLinks.mjs';

test('Markdown targets decode local paths and reject executable or remote-file URLs', () => {
  assert.deepEqual(markdownTarget('file:///tmp/opencode/captura%20final.PNG'), { kind: 'image', path: '/tmp/opencode/captura final.PNG' });
  assert.deepEqual(markdownTarget('/home/user/report.md'), { kind: 'file', path: '/home/user/report.md' });
  assert.deepEqual(markdownTarget('https://example.com/review'), { kind: 'web', url: 'https://example.com/review' });
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file://remote/share/a.png', 'file:///a%00.png', '//remote/a.png', 'file:///a.png?x=1', 'file:///a.png#x', 'file:///bad%XX.png', 'https://user:pass@example.com']) assert.equal(markdownTarget(url), null, url);
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
