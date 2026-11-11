import { realpath } from 'node:fs/promises';
import { command, workspaceRoot, observedAt, text } from './common.mjs';

export async function gitInspect(payload, context) {
  const { root } = await workspaceRoot(context, payload);
  const result = { available: false, changes: [], branches: [], worktrees: [], observedAt: observedAt() };
  const git = async args => (await command(context, 'git', ['--no-optional-locks', ...args], { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout;
  try { result.root = await realpath((await git(['rev-parse', '--show-toplevel'])).trim()); }
  catch (error) { return { ...result, reason: `Git unavailable or not a repository: ${error.message}` }; }
  try {
    result.branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => 'HEAD')).trim();
    const entries = (await git(['status', '--porcelain=v1', '-z', '--untracked-files=normal'])).split('\0');
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i]) continue;
      const status = entries[i].slice(0, 2), item = { status, path: entries[i].slice(3) };
      if (/[RC]/.test(status)) item.originalPath = entries[++i];
      result.changes.push(item);
    }
    result.dirty = result.changes.length > 0;
    const branchData = await git(['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(HEAD)', 'refs/heads/']);
    result.branches = branchData.split('\n').filter(Boolean).map(line => { const [name, oid, head] = line.split('\0'); return { name, oid, current: head === '*' }; });
    const worktreeData = await git(['worktree', 'list', '--porcelain', '-z']);
    let tree;
    for (const field of worktreeData.split('\0')) {
      if (field.startsWith('worktree ')) { tree = { path: field.slice(9) }; result.worktrees.push(tree); }
      else if (tree && field.startsWith('HEAD ')) tree.oid = field.slice(5);
      else if (tree && field.startsWith('branch ')) tree.branch = field.slice(7).replace(/^refs\/heads\//, '');
      else if (tree && field === 'detached') tree.detached = true;
    }
    if (payload.base !== undefined) {
      text(payload.base, 'base', 512);
      let oid;
      try { oid = (await git(['rev-parse', '--verify', '--end-of-options', `${payload.base}^{commit}`])).trim(); }
      catch { return { ...result, base: payload.base, reason: `Unknown Git base: ${payload.base}` }; }
      result.base = payload.base;
      for (const branch of result.branches) {
        const [behind, ahead] = (await git(['rev-list', '--left-right', '--count', `${oid}...${branch.oid}`])).trim().split(/\s+/).map(Number);
        Object.assign(branch, { ahead, behind, merged: ahead === 0 });
      }
      result.comparison = { baseOid: oid, changes: (await git(['diff', '--no-ext-diff', '--name-status', '-z', oid, '--'])).split('\0').filter(Boolean) };
    }
    return { ...result, available: true };
  } catch (error) { return { ...result, reason: `Git inspection failed: ${error.message}` }; }
}
