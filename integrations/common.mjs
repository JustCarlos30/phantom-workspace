import { execFile, spawn } from 'node:child_process';
import { realpath, lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

export const observedAt = () => new Date().toISOString();
export const inside = (root, target) => { const r = path.relative(root, target); return r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };
export function text(value, label = 'value', max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > max) throw new Error(`${label}: invalid text`);
  return value;
}
export async function workspaceRoot(context, payload = {}) {
  const workspace = payload.workspaceId && context.getWorkspace ? await context.getWorkspace(payload.workspaceId) : context.workspace;
  if (!workspace || (payload.workspaceId && workspace.id !== payload.workspaceId)) throw new Error('Unknown workspace');
  const root = await realpath(workspace.canonicalPath ?? workspace.path);
  if (!(await lstat(root)).isDirectory()) throw new Error('Workspace is not a directory');
  return { workspace, root };
}
export const excluded = name => ['.git', 'node_modules', '.phantom', '.ssh', '.aws', '.secrets', 'secrets', '.env'].includes(name) || /^\.env\.|\.(pem|key|p12|pfx)$/i.test(name);
export async function safePath(root, value, { missing = false } = {}) {
  text(value, 'path', 4096);
  const target = path.resolve(root, value);
  if (!inside(root, target)) throw new Error('Path outside workspace');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    if (excluded(part)) throw new Error('Excluded workspace path');
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink paths are not permitted'); }
    catch (error) { if (!(missing && error.code === 'ENOENT')) throw error; }
  }
  return target;
}
export async function readBounded(file, limit = 128 * 1024) {
  const handle = await open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Not a regular file');
    const buffer = Buffer.alloc(limit + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, Math.min(bytesRead, limit));
    if (data.includes(0) || data.toString('utf8').includes('\uFFFD')) throw new Error('Binary files are not permitted');
    return { text: data.toString('utf8'), truncated: bytesRead > limit };
  } finally { await handle.close(); }
}
export async function externalStatePath(home, root) {
  home = path.resolve(home);
  // Resolve existing ancestors as well as the final path, including symlinked state parents.
  let ancestor = home, suffix = [];
  for (;;) { try { ancestor = await realpath(ancestor); break; } catch (e) { if (e.code !== 'ENOENT') throw e; suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); } }
  const canonical = path.join(ancestor, ...suffix);
  if (inside(root, canonical)) throw new Error('Integration state must be outside workspace');
  return canonical;
}
export async function stateHome(context, root) {
  const canonical = await externalStatePath(context.dataDir ?? context.stateDir ?? process.env.PHANTOM_WORKSPACE_HOME ?? path.join(process.env.XDG_STATE_HOME ?? path.join(homedir(), '.local/state'), 'phantom-workspace'), root);
  await mkdir(canonical, { recursive: true, mode: 0o700 });
  return canonical;
}
export async function command(context, file, args, options = {}) {
  const settings = { timeout: 15000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', windowsHide: true, ...options, shell: false };
  if (context.execFile) return context.execFile(file, args, settings);
  return new Promise((resolve, reject) => execFile(file, args, settings, (error, stdout, stderr) => {
    if (error) { error.message = `${path.basename(file)}: ${stderr?.trim() || error.message}`; reject(error); }
    else resolve({ stdout, stderr });
  }));
}
export const spawnCommand = (context, file, args, options) => (context.spawn ?? spawn)(file, args, { ...options, shell: false });
export async function jsonCommand(context, file, args, options) {
  const { stdout } = await command(context, file, args, options);
  try { return JSON.parse(stdout); } catch { throw new Error(`${path.basename(file)} returned invalid JSON`); }
}
