import fs from 'node:fs';
import path from 'node:path';
import { assert, text, canonicalFolder } from './store.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git, hostGitEnv } from './merge-guard.mjs';

const execute = promisify(execFile);

// Ramas: one view of every local branch of the project repository, the worktree
// that holds it, the terminal that owns it and the work it still carries
// (uncommitted files, commits not yet in the base). Git is the only source;
// nothing is cached. Actions are the user's own decisions from the panel:
// they never discard work and never force.
const MAX_FILES = 200, MAX_BRANCHES = 200;
const real = target => { try { return canonicalFolder(target); } catch { return null; } };
const lines = value => value ? value.split('\n').filter(Boolean) : [];

function parseWorktrees(output) {
  const trees = []; let tree;
  for (const field of output.split('\0')) {
    if (field.startsWith('worktree ')) { tree = { path: field.slice(9) }; trees.push(tree); }
    else if (!tree) continue;
    else if (field.startsWith('HEAD ')) tree.oid = field.slice(5);
    else if (field.startsWith('branch ')) tree.branch = field.slice(7).replace(/^refs\/heads\//, '');
    else if (field === 'detached') tree.detached = true;
    else if (field.startsWith('prunable')) tree.prunable = true;
    else if (field.startsWith('locked')) tree.locked = true;
  }
  return trees;
}
function parseStatus(output) {
  const entries = output.split('\0'), changes = [];
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    const status = entries[i].slice(0, 2), item = { status, path: entries[i].slice(3) };
    if (/[RC]/.test(status)) item.originalPath = entries[++i];
    changes.push(item);
  }
  return changes;
}
// git() trims stdout, which would eat the first status column (" M path"); read this one raw.
async function status(cwd) {
  const { stdout } = await execute('git', ['-C', cwd, '--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: hostGitEnv() });
  return parseStatus(stdout);
}

// Unsaved files whose content is already byte-identical in the base: the worktree
// is only out of date there, nothing would be lost. Deletions count when the base lacks the path too.
async function markInBase(source, baseOid, tree, changes) {
  if (!changes.length) return;
  const listed = await git(source, ['--literal-pathspecs', 'ls-tree', '-r', '-z', baseOid, '--', ...changes.map(change => change.path)]);
  const blobs = new Map(listed.split('\0').filter(Boolean).map(entry => { const tab = entry.indexOf('\t'); return [entry.slice(tab + 1), entry.slice(0, tab).split(' ')[2]]; }));
  const files = changes.filter(change => { try { return fs.statSync(path.join(tree, change.path)).isFile(); } catch { return false; } });
  const hashes = files.length ? lines(await git(tree, ['hash-object', '--', ...files.map(change => change.path)])) : [];
  const own = new Map(files.map((change, index) => [change.path, hashes[index]]));
  for (const change of changes) change.inBase = own.has(change.path) ? own.get(change.path) === blobs.get(change.path) : /D/.test(change.status) && !blobs.has(change.path);
}

export class Branches {
  constructor({ store, terminals, mutate, merges }) { Object.assign(this, { store, terminals, mutate, merges }); }

  async repository(w) {
    const base = await this.merges.base(w);
    const [refs, trees] = await Promise.all([
      git(base.source, ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(authorname)%00%(subject)', 'refs/heads/']),
      git(base.source, ['worktree', 'list', '--porcelain', '-z']).then(parseWorktrees),
    ]);
    const branches = lines(refs).slice(0, MAX_BRANCHES).map(line => { const [name, oid, at, author, subject] = line.split('\0'); return { name, oid, last: { at, author, subject } }; });
    return { base, branches, trees };
  }

  async overview(w) {
    const result = { available: false, base: null, branches: [], observedAt: new Date().toISOString() };
    let repository;
    try { repository = await this.repository(w); } catch (error) { return { ...result, reason: error.message }; }
    const { base, branches, trees } = repository;
    const live = id => this.terminals.sessions.some(s => s.nodeId === id && s.status === 'running');
    const nodes = w.nodes.filter(n => n.type === 'terminal');
    const open = new Map((w.integration?.queue ?? []).filter(item => ['queued', 'merging', 'conflict'].includes(item.status)).map(item => [item.branch, item]));
    const rows = await Promise.all(branches.map(async branch => {
      const tree = trees.find(item => item.branch === branch.name), isBase = branch.name === base.branch;
      const exists = Boolean(tree && !tree.prunable && fs.existsSync(tree.path));
      const node = isBase ? nodes.find(n => n.data?.role === 'orchestrator') : nodes.find(n => n.data?.worktree?.branch === branch.name);
      const row = {
        name: branch.name, oid: branch.oid, isBase, last: branch.last,
        worktree: tree ? { path: tree.path, exists, main: real(tree.path) === base.source, locked: Boolean(tree.locked) } : null,
        terminal: node ? { nodeId: node.id, title: node.title, running: live(node.id), step: node.data.agent?.step ?? '', status: node.data.agent?.status ?? 'idle' } : null,
        ahead: 0, behind: 0, committed: [], changes: [], changeCount: 0, inBase: 0, conflicts: null, request: open.get(branch.name)?.status ?? null,
      };
      try {
        if (!isBase) {
          [row.behind, row.ahead] = (await git(base.source, ['rev-list', '--left-right', '--count', `${base.oid}...${branch.oid}`])).split(/\s+/).map(Number);
          if (row.ahead) row.committed = lines(await git(base.source, ['diff', '--name-only', `${base.oid}...${branch.oid}`]));
          // Predict the merge without touching any checkout (git >= 2.38). Unknown stays null.
          if (row.ahead && row.behind) row.conflicts = await git(base.source, ['merge-tree', '--write-tree', '--name-only', '--no-messages', base.oid, branch.oid]).then(() => [], error => error.code === 1 ? lines(error.stdout ?? '').slice(1) : null);
          else if (row.ahead) row.conflicts = [];
        }
        if (exists) {
          const changes = await status(tree.path); row.changeCount = changes.length; row.changes = changes.slice(0, MAX_FILES);
          if (!isBase) { await markInBase(base.source, base.oid, tree.path, row.changes); row.inBase = row.changes.filter(change => change.inBase).length; }
        }
      } catch (error) { row.error = error.message.slice(0, 300); }
      return row;
    }));
    // Worktrees without a branch still hold files; show them so nothing stays hidden.
    for (const tree of trees.filter(item => !item.branch)) {
      const exists = !tree.prunable && fs.existsSync(tree.path), changes = exists ? await status(tree.path).catch(() => []) : [];
      rows.push({ name: null, oid: tree.oid ?? null, detached: true, isBase: false, last: null, worktree: { path: tree.path, exists, main: real(tree.path) === base.source, locked: Boolean(tree.locked) }, terminal: null, ahead: 0, behind: 0, committed: [], changes: changes.slice(0, MAX_FILES), changeCount: changes.length, conflicts: null, request: null });
    }
    // Files touched (committed or not) by more than one branch with pending work: order matters there.
    const touching = new Map();
    const filesOf = row => row.isBase ? [] : [...new Set([...row.committed, ...row.changes.filter(change => !change.inBase).map(change => change.path)])];
    for (const row of rows) for (const file of filesOf(row)) touching.set(file, [...(touching.get(file) ?? []), row]);
    for (const row of rows) {
      row.overlaps = filesOf(row).filter(file => touching.get(file).length > 1).slice(0, 25).map(file => ({ path: file, with: touching.get(file).filter(other => other !== row).map(other => other.terminal?.title || other.name || other.worktree.path) }));
      row.committedCount = row.committed.length; row.committed = row.committed.slice(0, MAX_FILES);
      row.work = row.changeCount ? 'dirty' : row.ahead ? 'ready' : 'none';
    }
    return { ...result, available: true, base: { branch: base.branch, oid: base.oid, path: base.source }, integration: { enabled: Boolean(w.integration?.enabled) }, branches: rows };
  }

  // Re-read Git for one branch right before acting on it: the panel may be stale.
  async target(w, name) {
    text(name, 'rama', 512);
    const { base, branches, trees } = await this.repository(w);
    const branch = branches.find(item => item.name === name); assert(branch, `La rama ${name} ya no existe.`);
    const tree = trees.find(item => item.branch === name) ?? null;
    const exists = Boolean(tree && !tree.prunable && fs.existsSync(tree.path));
    const node = w.nodes.find(n => n.type === 'terminal' && n.data?.worktree?.branch === name) ?? null;
    return { base, branch, tree, exists, node, changes: exists ? await status(tree.path) : [] };
  }
  async exclusive(w, fn) {
    assert(!this.merges.running.has(w.id), 'Ya hay una integración en curso en este proyecto.');
    this.merges.running.add(w.id);
    try { return await fn(); } finally { this.merges.running.delete(w.id); }
  }
  // A merge that stopped on conflicts is undone; the caller reports the files.
  async merge(cwd, args) {
    try { await git(cwd, ['merge', ...args], { timeout: 180000 }); return null; }
    catch (error) {
      const conflicts = lines(await git(cwd, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''));
      if (await git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => '')) await git(cwd, ['merge', '--abort']);
      if (!conflicts.length) throw error;
      return conflicts.slice(0, 100);
    }
  }

  async handle(method, p) {
    const w = this.store.getWorkspace(p.workspaceId);
    if (method === 'branch.overview') return this.overview(w);
    if (method === 'branch.commit') {
      const message = text(p.message, 'mensaje', 500).trim(); assert(!/[\x00-\x1f\x7f]/.test(message), 'El mensaje debe ser una sola línea');
      const { tree, exists, changes } = await this.target(w, p.branch);
      assert(exists, 'Esta rama no tiene un worktree en disco.'); assert(changes.length, 'No hay cambios sin guardar en este worktree.');
      assert(!await git(tree.path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => ''), 'Este worktree tiene un merge sin terminar. Termínalo en su terminal.');
      await git(tree.path, ['add', '-A']);
      await git(tree.path, ['commit', '-m', message], { timeout: 120000 });
      return { branch: p.branch, oid: await git(tree.path, ['rev-parse', 'HEAD']), files: changes.length };
    }
    if (method === 'branch.integrate') return this.exclusive(w, async () => {
      const { base, branch, node } = await this.target(w, p.branch);
      assert(branch.name !== base.branch, 'Esta es la rama de integración.');
      assert(Number(await git(base.source, ['rev-list', '--count', `${base.oid}..${branch.oid}`])) > 0, `${branch.name} no tiene commits nuevos respecto a ${base.branch}.`);
      assert(!await git(base.source, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => ''), 'El checkout del proyecto tiene un merge sin terminar. Termínalo o abórtalo antes de integrar.');
      const conflicts = await this.merge(base.source, ['--no-ff', '--no-edit', '-m', `Integrar ${node?.title || branch.name} (${branch.name})`, branch.oid]);
      if (conflicts) return { status: 'conflict', branch: branch.name, base: base.branch, conflicts };
      const mergedOid = await git(base.source, ['rev-parse', 'HEAD']);
      // A pending Incorporaciones request for exactly this commit is now settled.
      this.mutate(w.id, () => {
        const item = this.store.getWorkspace(w.id).integration?.queue?.find(item => item.branch === branch.name && ['queued', 'conflict'].includes(item.status) && item.headOid === branch.oid);
        if (item) Object.assign(item, { status: 'merged', mergedOid, finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      });
      return { status: 'merged', branch: branch.name, base: base.branch, mergedOid };
    });
    if (method === 'branch.update') {
      const { base, branch, tree, exists, changes } = await this.target(w, p.branch);
      assert(branch.name !== base.branch, 'Esta es la rama de integración.'); assert(exists, 'Esta rama no tiene un worktree en disco.');
      const [behind, ahead] = (await git(base.source, ['rev-list', '--left-right', '--count', `${base.oid}...${branch.oid}`])).split(/\s+/).map(Number);
      assert(behind > 0, `${branch.name} ya contiene todo ${base.branch}.`);
      // Fast-forward is safe with local edits: Git refuses if it would touch them. A real merge needs a clean tree to be undoable.
      assert(!ahead || !changes.length, 'Guarda primero los cambios de este worktree: actualizar una rama con commits propios necesita el árbol limpio.');
      const conflicts = await this.merge(tree.path, ahead ? ['--no-edit', '-m', `Actualizar desde ${base.branch}`, base.oid] : ['--ff-only', base.oid]);
      if (conflicts) return { status: 'conflict', branch: branch.name, base: base.branch, conflicts };
      return { status: 'updated', branch: branch.name, base: base.branch, oid: await git(tree.path, ['rev-parse', 'HEAD']) };
    }
    if (method === 'branch.remove') {
      const { base, branch, tree, exists, node, changes } = await this.target(w, p.branch);
      assert(branch.name !== base.branch && real(tree?.path ?? '') !== base.source, 'La rama de integración y el checkout del proyecto no se limpian.');
      // A terminal on the canvas keeps working in its worktree: removing it would leave the card without a place to write.
      assert(!node, `Esta rama es de la terminal «${node?.title}» del canvas. Ponla al día desde ${base.branch}, o quita la terminal para poder limpiarla.`);
      assert(!changes.length, 'Este worktree tiene cambios sin guardar. Guárdalos e intégralos antes de limpiar.');
      assert(Number(await git(base.source, ['rev-list', '--count', `${base.oid}..${branch.oid}`])) === 0, `${branch.name} tiene commits que no están en ${base.branch}. Intégrala antes de limpiar.`);
      assert(!tree?.locked, 'El worktree está bloqueado (git worktree lock).');
      // No --force anywhere: Git itself refuses if anything would be lost.
      if (tree) await git(base.source, exists ? ['worktree', 'remove', tree.path] : ['worktree', 'prune']);
      await git(base.source, ['branch', '-d', branch.name]);
      return { status: 'removed', branch: branch.name, worktree: tree?.path ?? null };
    }
    throw new Error(`Unknown method: ${method}`);
  }
}
