import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, hostGitEnv } from './merge-guard.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function inheritClaudeTrust(store, workspace, directory, env = process.env) {
  let lock, temporary, filename;
  try {
    const registered = store.state.workspaces.find(w => w.id === workspace.id);
    if (!registered || !directory.worktree) return false;
    const source = await fs.realpath(registered.canonicalPath || registered.path);
    const cwd = directory.cwd;
    const parent = path.resolve(store.dir, 'worktrees', registered.id);
    if (!path.isAbsolute(cwd) || path.dirname(cwd) !== parent || await fs.realpath(cwd) !== cwd || await fs.realpath(parent) !== parent) return false;
    const owner = registered.nodes.find(n => n.id === path.basename(cwd));
    const saved = owner?.data?.worktree;
    if (!saved || saved.path !== cwd || directory.worktree.path !== cwd || !saved.createdAt || await fs.realpath(saved.source) !== source) return false;
    const gitEnv = hostGitEnv();
    for (const key of Object.keys(gitEnv)) if (key.startsWith('GIT_')) gitEnv[key] = undefined;
    const [top, common, sourceCommon] = await Promise.all([
      git(cwd, ['rev-parse', '--show-toplevel'], { env: gitEnv }),
      git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { env: gitEnv }),
      git(source, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { env: gitEnv }),
    ]);
    if (top !== cwd || await fs.realpath(common) !== await fs.realpath(sourceCommon)) return false;
    const configDir = env.CLAUDE_CONFIG_DIR !== undefined ? env.CLAUDE_CONFIG_DIR : env.HOME;
    if (!configDir || !path.isAbsolute(configDir)) return false;
    filename = path.join(configDir, '.claude.json');
    lock = await fs.open(`${filename}.lock`, 'wx', 0o600);
    const stat = await fs.lstat(filename);
    if (!stat.isFile()) return false;
    const original = await fs.readFile(filename, 'utf8');
    const config = JSON.parse(original);
    if (!object(config) || !object(config.projects) || config.projects[source]?.hasTrustDialogAccepted !== true) return false;
    const target = config.projects[cwd];
    if (target === false || target?.hasTrustDialogAccepted === false || (target !== undefined && !object(target))) return false;
    if (target?.hasTrustDialogAccepted === true) return true;
    config.projects[cwd] = { ...target, hasTrustDialogAccepted: true };
    temporary = `${filename}.${randomUUID()}.tmp`;
    const file = await fs.open(temporary, 'wx', stat.mode & 0o7777);
    try {
      await file.writeFile(`${JSON.stringify(config, null, 2)}\n`);
      await file.chmod(stat.mode & 0o7777);
      await file.sync();
    } finally { await file.close(); }
    if (await fs.readFile(filename, 'utf8') !== original) return false;
    await fs.rename(temporary, filename);
    return true;
  } catch { return false; }
  finally {
    if (temporary) await fs.unlink(temporary).catch(() => {});
    if (lock) {
      await lock.close().catch(() => {});
      await fs.unlink(`${filename}.lock`).catch(() => {});
    }
  }
}
