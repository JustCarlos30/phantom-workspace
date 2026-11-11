import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assert, canonicalFolder } from './store.mjs';

const execute = promisify(execFile);
async function git(cwd, args) {
  const { stdout } = await execute('git', ['-C', cwd, ...args], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  return stdout.trim();
}

export async function prepareTerminalDirectory(store, workspace, node) {
  const source = canonicalFolder(workspace.canonicalPath || workspace.path);
  const saved = node.data?.worktree;
  if (saved) {
    const cwd = canonicalFolder(saved.path);
    const [top, common, originalCommon] = await Promise.all([
      git(cwd, ['rev-parse', '--show-toplevel']),
      git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      git(source, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    ]);
    assert(canonicalFolder(top) === cwd && canonicalFolder(common) === canonicalFolder(originalCommon), 'El worktree de esta terminal ya no pertenece al repositorio del proyecto.');
    const branch = await git(cwd, ['branch', '--show-current']);
    return { cwd, worktree: { ...saved, branch: branch || null }, worktreeReason: null };
  }
  let inside;
  try { inside = await git(source, ['rev-parse', '--is-inside-work-tree']); }
  catch (error) {
    if (error.code === 'ENOENT') return { cwd: source, worktree: null, worktreeReason: 'Git no está instalado' };
    if (/not a git repository/i.test(error.stderr || '')) return { cwd: source, worktree: null, worktreeReason: 'Carpeta sin repositorio Git' };
    throw error;
  }
  if (inside !== 'true') return { cwd: source, worktree: null, worktreeReason: 'Carpeta sin árbol de trabajo Git' };
  try { await git(source, ['rev-parse', '--verify', 'HEAD^{commit}']); }
  catch (error) {
    if (/needed a single revision|unknown revision|bad revision|not a valid/i.test(error.stderr || '')) return { cwd: source, worktree: null, worktreeReason: 'Repositorio sin commits' };
    throw error;
  }
  // Store outside the repository so creating a terminal doesn't dirty the source.
  const parent = path.join(store.dir, 'worktrees', workspace.id);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const cwd = path.join(parent, node.id), branch = `phantom/terminal-${node.id}`;
  await git(source, ['worktree', 'add', '-b', branch, cwd, 'HEAD']);
  return { cwd: canonicalFolder(cwd), worktree: { path: cwd, branch, source, createdAt: new Date().toISOString() }, worktreeReason: null };
}
