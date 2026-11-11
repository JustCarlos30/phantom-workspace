import { opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { workspaceRoot, safePath, readBounded, excluded } from './common.mjs';

const allowed = file => /\.(md|markdown)$/i.test(file) || /(^|\/)(skill|manifest)\.json$/i.test(file);
export async function contextRead(payload, context) {
  const { root } = await workspaceRoot(context, payload), file = await safePath(root, payload.path);
  if (!allowed(file)) throw new Error('Only Markdown and skill manifests can be read');
  return { path: path.relative(root, file), ...await readBounded(file) };
}
export async function contextScan(payload, context) {
  const { root } = await workspaceRoot(context, payload), items = [];
  if (payload.query !== undefined && (typeof payload.query !== 'string' || payload.query.length > 500)) throw new Error('Invalid context query');
  const query = (payload.query ?? '').toLowerCase();
  let visited = 0, bytes = 0, truncated = false;
  const deadline = Date.now() + 3000;
  async function walk(dir, depth) {
    if (depth > 12) { truncated = true; return; }
    const directory = await opendir(dir);
    try {
      for await (const entry of directory) {
        if (++visited > 4000 || items.length >= 250 || bytes >= 8 * 1024 * 1024 || Date.now() > deadline) { truncated = true; break; }
        if (excluded(entry.name) || entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file, depth + 1);
        else if (entry.isFile() && allowed(file)) {
          try {
            await safePath(root, file);
            if ((await lstat(file)).size > 128 * 1024) continue;
            const { text } = await readBounded(file), relative = path.relative(root, file);
            bytes += Buffer.byteLength(text);
            if (!query || `${relative}\n${text}`.toLowerCase().includes(query)) items.push({ id: relative, path: relative, kind: /\.json$/.test(file) ? 'skill-manifest' : 'markdown', title: text.match(/^#\s+(.+)$/m)?.[1] ?? entry.name, source: 'workspace' });
          } catch { /* Unreadable, binary, or changed during scan. */ }
        }
        if (visited > 4000 || items.length >= 250 || bytes >= 8 * 1024 * 1024 || Date.now() > deadline) { truncated = true; break; }
      }
    } catch (error) { if (error.code !== 'EACCES') throw error; }
  }
  await walk(root, 0);
  return { items, truncated };
}
