import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assert, text, canonicalFolder } from './store.mjs';
import { hostGitEnv } from './merge-guard.mjs';

const execute = promisify(execFile);

// Repositorio: the GitKraken-style view of the project repository. It reads the
// commit graph, a commit's files, diffs, and lets the user edit a file inside
// one of the repository's own worktrees. Git is the only source; nothing is
// cached. Writes are limited to existing text files of a known worktree and
// refuse when the file changed on disk since it was read.
const MAX_COMMITS = 2000, MAX_DIFF = 768 * 1024, MAX_FILE = 1024 * 1024, MAX_LIST = 20000;
const OID = /^[0-9a-f]{7,64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');

async function raw(cwd, args, { ok = [0], maxBuffer = 16 * 1024 * 1024 } = {}) {
  try {
    const { stdout } = await execute('git', ['-C', cwd, '--no-optional-locks', ...args], { encoding: 'utf8', timeout: 30000, maxBuffer, env: hostGitEnv() });
    return stdout;
  } catch (error) {
    // git diff --no-index exits 1 when files differ: that is an answer, not a failure.
    if (ok.includes(error.code) && typeof error.stdout === 'string') return error.stdout;
    const detail = `${error.stderr || ''}`.trim();
    if (detail) error.message = detail.slice(-2000);
    throw error;
  }
}
const clip = value => value.length > MAX_DIFF ? { text: value.slice(0, MAX_DIFF), truncated: true } : { text: value, truncated: false };

function parseNameStatus(output) {
  const fields = output.split('\0'), files = [];
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i];
    if (!status) continue;
    const file = { status: status[0], path: fields[++i] };
    if (/^[RC]/.test(status)) { file.originalPath = file.path; file.path = fields[++i]; }
    files.push(file);
  }
  return files;
}

export class Repo {
  constructor({ store }) { this.store = store; }

  source(w) { return canonicalFolder(w.canonicalPath || w.path); }

  async worktrees(source) {
    const output = await raw(source, ['worktree', 'list', '--porcelain', '-z']);
    return output.split('\0').filter(field => field.startsWith('worktree ')).map(field => field.slice(9));
  }

  // The tree must be a live worktree of this repository, and the path a regular
  // file inside it (symlinks resolved), never inside .git.
  async locate(w, tree, file, { exists = true } = {}) {
    text(tree, 'worktree', 4096); text(file, 'archivo', 4096);
    const source = this.source(w);
    const root = canonicalFolder(tree);
    const known = await Promise.all((await this.worktrees(source)).map(item => { try { return canonicalFolder(item); } catch { return null; } }));
    assert(known.includes(root), 'Esa carpeta no es un worktree de este repositorio.');
    assert(!path.isAbsolute(file) && !file.split(/[\\/]/).some(part => part === '..' || part === '.git'), 'Ruta de archivo no válida.');
    const target = path.join(root, file);
    if (!exists) return { root, target };
    let real;
    try { real = fs.realpathSync(target); } catch { throw new Error(`El archivo ${file} no existe en este worktree.`); }
    assert(real === root || real.startsWith(root + path.sep), 'El archivo apunta fuera del worktree.');
    assert(!path.relative(root, real).split(path.sep).includes('.git'), 'Ruta de archivo no válida.');
    const stat = fs.statSync(real);
    assert(stat.isFile(), `${file} no es un archivo.`);
    return { root, target: real, stat };
  }

  async graph(w, p) {
    const limit = Math.min(MAX_COMMITS, Math.max(1, Number.isSafeInteger(p.limit) ? p.limit : 400));
    const source = this.source(w);
    const result = { available: false, commits: [], observedAt: new Date().toISOString() };
    try { await raw(source, ['rev-parse', '--verify', 'HEAD^{commit}']); }
    catch (error) { return { ...result, reason: /not a git repository/i.test(error.message) ? 'La carpeta del proyecto no es un repositorio Git.' : 'El repositorio todavía no tiene commits.' }; }
    // Record separator \x1e between commits, unit separator \x1f between fields.
    const output = await raw(source, ['log', '--branches', '--remotes', '--tags', 'HEAD', '--topo-order', `-n${limit + 1}`, '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e']);
    const commits = output.split('\x1e').map(entry => entry.replace(/^\n/, '')).filter(Boolean).map(entry => {
      const [oid, parents, author, email, at, subject, refs] = entry.split('\x1f');
      return { oid, parents: parents ? parents.split(' ') : [], author, email, at, subject, refs: refs ? refs.split(', ').filter(Boolean) : [] };
    });
    const head = (await raw(source, ['symbolic-ref', '-q', '--short', 'HEAD'], { ok: [0, 1] })).trim() || null;
    return { ...result, available: true, head, commits: commits.slice(0, limit), more: commits.length > limit };
  }

  async commit(w, p) {
    text(p.oid, 'commit', 64); assert(OID.test(p.oid), 'Identificador de commit no válido.');
    const source = this.source(w);
    const [meta] = (await raw(source, ['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%cI%x1f%B', p.oid])).split('\x1e');
    const [oid, parents, author, email, at, committer, committedAt, ...body] = meta.split('\x1f');
    const parentList = parents ? parents.split(' ') : [];
    // Merges are shown against their first parent, as in a linear history.
    const changes = parentList.length
      ? await raw(source, ['diff', '--no-ext-diff', '--name-status', '-z', '-M', parentList[0], oid, '--'])
      : await raw(source, ['diff-tree', '--root', '--no-commit-id', '-r', '-z', '--name-status', '-M', oid]);
    const stats = parentList.length
      ? await raw(source, ['diff', '--numstat', '-z', '-M', parentList[0], oid, '--'])
      : await raw(source, ['diff-tree', '--root', '--no-commit-id', '-r', '-z', '--numstat', '-M', oid]);
    const files = parseNameStatus(changes);
    const counts = new Map();
    const fields = stats.split('\0');
    for (let i = 0; i < fields.length; i++) {
      if (!fields[i]) continue;
      const [added, removed, name] = fields[i].split('\t');
      let file = name;
      if (!name) { i++; file = fields[++i]; } // rename: "a\tb\t" then old\0new\0
      counts.set(file, { added: added === '-' ? null : Number(added), removed: removed === '-' ? null : Number(removed) });
    }
    for (const file of files) Object.assign(file, counts.get(file.path) ?? {});
    return { oid, parents: parentList, author, email, at, committer, committedAt, message: body.join('\x1f').trim(), files };
  }

  async diff(w, p) {
    text(p.path, 'archivo', 4096);
    if (p.oid !== undefined) {
      text(p.oid, 'commit', 64); assert(OID.test(p.oid), 'Identificador de commit no válido.');
      const source = this.source(w);
      const parents = (await raw(source, ['show', '-s', '--format=%P', p.oid])).trim();
      const parent = parents ? parents.split(' ')[0] : null;
      const paths = ['--', ...(p.originalPath ? [p.originalPath] : []), p.path];
      const output = parent
        ? await raw(source, ['diff', '--no-ext-diff', '--no-color', '-M', parent, p.oid, ...paths])
        : await raw(source, ['show', '--no-ext-diff', '--no-color', '--format=', p.oid, ...paths]);
      return clip(output);
    }
    const { root } = await this.locate(w, p.tree, p.path, { exists: false });
    const tracked = (await raw(root, ['ls-files', '--error-unmatch', '--', p.path], { ok: [0, 1] })).trim();
    if (!tracked) {
      // Untracked: show it as a new file against nothing.
      const { target } = await this.locate(w, p.tree, p.path);
      return clip(await raw(root, ['diff', '--no-index', '--no-color', '--', '/dev/null', path.relative(root, target)], { ok: [0, 1] }));
    }
    const hasHead = (await raw(root, ['rev-parse', '-q', '--verify', 'HEAD^{commit}'], { ok: [0, 1] })).trim();
    return clip(await raw(root, ['diff', '--no-ext-diff', '--no-color', ...(hasHead ? ['HEAD'] : ['--cached']), '--', p.path]));
  }

  async files(w, p) {
    const { root } = await this.locate(w, p.tree, '.', { exists: false });
    const output = await raw(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    const files = [...new Set(output.split('\0').filter(Boolean))];
    return { files: files.slice(0, MAX_LIST), truncated: files.length > MAX_LIST };
  }

  async read(w, p) {
    const { target, stat } = await this.locate(w, p.tree, p.path);
    if (stat.size > MAX_FILE) return { path: p.path, editable: false, reason: `El archivo pesa ${Math.round(stat.size / 1024)} KB; el editor abre hasta ${MAX_FILE / 1024} KB.` };
    const buffer = fs.readFileSync(target);
    if (buffer.includes(0)) return { path: p.path, editable: false, reason: 'Archivo binario: no se puede editar como texto.' };
    const content = buffer.toString('utf8');
    return { path: p.path, editable: true, content, hash: sha(buffer), size: stat.size };
  }

  async write(w, p) {
    assert(typeof p.content === 'string', 'Contenido no válido.');
    assert(Buffer.byteLength(p.content) <= MAX_FILE, 'El contenido supera 1 MB.');
    text(p.hash, 'versión', 64);
    const { target, stat } = await this.locate(w, p.tree, p.path);
    const current = fs.readFileSync(target);
    assert(sha(current) === p.hash, 'El archivo cambió en disco desde que lo abriste (quizá lo editó un agente). Recárgalo antes de guardar.');
    // Atomic replace that keeps the file mode.
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.phantom-${process.pid}-${Date.now()}`);
    fs.writeFileSync(temporary, p.content, { mode: stat.mode & 0o7777 });
    try { fs.renameSync(temporary, target); } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
    const buffer = Buffer.from(p.content);
    return { path: p.path, hash: sha(buffer), size: buffer.length };
  }

  async handle(method, p) {
    const w = this.store.getWorkspace(p.workspaceId);
    if (method === 'repo.graph') return this.graph(w, p);
    if (method === 'repo.commit') return this.commit(w, p);
    if (method === 'repo.diff') return this.diff(w, p);
    if (method === 'repo.files') return this.files(w, p);
    if (method === 'repo.file.read') return this.read(w, p);
    if (method === 'repo.file.write') return this.write(w, p);
    throw new Error(`Unknown method: ${method}`);
  }
}
