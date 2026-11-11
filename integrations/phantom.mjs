import { realpath, readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workspaceRoot, safePath, stateHome, externalStatePath, jsonCommand, command, spawnCommand, text, observedAt } from './common.mjs';

const defaultCLI = fileURLToPath(new URL('../../harness_engineer/bin/phantom.mjs', import.meta.url));
const controllers = new Map(), writes = new Map(), starts = new Map();
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const identifier = value => { text(value, 'Phantom ID', 200); if (value.startsWith('-')) throw new Error('Invalid Phantom ID'); return value; };
async function client(payload, context) {
  const { root, workspace } = await workspaceRoot(context, payload);
  const cli = await realpath(context.state?.settings?.phantomPath ?? process.env.PHANTOM_CLI ?? defaultCLI);
  const flags = ['--json'];
  const data = context.state?.settings?.phantomData;
  const nativeHome = await externalStatePath(data ?? process.env.PHANTOM_HOME ?? path.join(process.env.XDG_STATE_HOME ?? path.join(homedir(), '.local/state'), 'phantom'), root);
  if (data !== undefined) {
    text(data, 'phantomData', 4096);
    // Native Phantom owns this database. Never copy or open it through Store.
    const home = await stateHome({ ...context, dataDir: data }, root);
    flags.push('--data', home);
  }
  const call = args => jsonCommand(context, process.execPath, [cli, ...args, ...flags], { cwd: root });
  return { root, workspace, cli, flags, call, backend: createHash('sha256').update(stable({ root, cli, nativeHome })).digest('hex') };
}
async function family(client, context) {
  const roots = new Set([client.root]);
  try {
    const { stdout } = await command(context, 'git', ['--no-optional-locks', 'worktree', 'list', '--porcelain', '-z'], { cwd: client.root });
    for (const entry of stdout.split('\0')) if (entry.startsWith('worktree ')) {
      try { roots.add(await realpath(entry.slice(9))); } catch { /* Removed worktree. */ }
    }
  } catch { /* A non-Git workspace still has an exact canonical scope. */ }
  return roots;
}
async function scopedTask(raw, client, context) {
  const roots = await family(client, context);
  try { return roots.has(await realpath(raw.contract?.workspace)); } catch { return false; }
}
export function normalizePhantom(raw, topic) {
  return { id: raw.id ?? raw.ref?.id, title: raw.contract?.goal ?? raw.title ?? raw.description ?? raw.ref?.id ?? raw.id, kind: topic === 'tasks' ? raw.kind : topic === 'memories' ? raw.kind : 'skill', ...(raw.status || raw.state ? { status: raw.status ?? raw.state } : {}), ...(raw.body ? { body: raw.body } : {}), source: 'phantom', ...(raw.revision !== undefined ? { revision: raw.revision } : raw.ref?.version ? { revision: raw.ref.version } : {}), ...(raw.ref ? { ref: raw.ref } : {}), raw };
}
async function list(payload, context, c) {
  const topic = payload.topic;
  if (!['tasks', 'memories', 'skills'].includes(topic)) throw new Error('topic must be tasks, memories, or skills');
  if (payload.query !== undefined && (typeof payload.query !== 'string' || payload.query.length > 500)) throw new Error('Invalid Phantom query');
  let raw = await c.call(topic === 'tasks' ? ['list'] : [topic === 'memories' ? 'memory-list' : 'skill-list', '--workspace', c.root, ...(topic === 'skills' && payload.allVersions ? ['--all-versions'] : [])]);
  if (!Array.isArray(raw)) throw new Error('Phantom returned an invalid catalog');
  if (topic === 'tasks') {
    const roots = await family(c, context), filtered = [];
    for (const item of raw) { try { if (roots.has(await realpath(item.contract?.workspace))) filtered.push(item); } catch { /* Not this workspace. */ } }
    raw = filtered;
  }
  const query = (payload.query ?? '').toLowerCase();
  return { available: true, items: raw.map(item => normalizePhantom(item, topic)).filter(item => !query || `${item.title}\n${item.body ?? ''}\n${item.id}`.toLowerCase().includes(query)), observedAt: observedAt() };
}
async function detail(payload, context, c) {
  identifier(payload.id);
  if (payload.topic === 'tasks') {
    const raw = await c.call(['show', payload.id]);
    if (!await scopedTask(raw, c, context)) throw new Error('Phantom task belongs to another workspace');
    return raw;
  }
  if (payload.topic === 'memories') return c.call(['memory-history', payload.id, '--workspace', c.root]);
  if (payload.topic !== 'skills') throw new Error('Unknown Phantom topic');
  const catalog = await list({ topic: 'skills', allVersions: Boolean(payload.ref) }, context, c);
  const matches = catalog.items.filter(item => item.id === payload.id && (!payload.ref || item.ref.scope === payload.ref.scope && item.ref.version === payload.ref.version && item.ref.sha256 === payload.ref.sha256));
  if (matches.length > 1) throw new Error('Ambiguous skill ID: provide its exact ref');
  const match = matches[0];
  if (!match) throw new Error('Skill reference is not visible in this workspace');
  const raw = await c.call(['skill-show', payload.id, '--version', match.ref.version, ...(match.ref.scope === 'global' ? ['--global'] : ['--workspace', c.root])]);
  if (raw.ref?.sha256 !== match.ref.sha256) throw new Error('Phantom skill reference changed');
  return raw;
}
async function validateInput(payload, c) {
  const input = payload.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be a native Phantom object');
  const source = path.resolve(path.dirname(c.cli), '../src');
  if (payload.kind === 'card') {
    if (input.workspace !== undefined && await realpath(input.workspace) !== c.root) throw new Error('Card workspace differs from selected workspace');
    const { contract } = await import(pathToFileURL(path.join(source, 'contract.mjs')));
    const value = contract({ ...input, workspace: c.root });
    if (value.lane !== 'coordinated') throw new Error('A card requires native lane coordinated');
    async function checkPaths(spec) {
      for (const file of spec.scope ?? []) await safePath(c.root, file, { missing: true });
      for (const check of spec.checks ?? []) {
        await safePath(c.root, check.cwd ?? '.', { missing: true });
        for (const file of check.protect ?? []) await safePath(c.root, file, { missing: true });
      }
      for (const child of spec.coordination?.children ?? []) await checkPaths(child);
    }
    await checkPaths(value); return value;
  }
  if (payload.kind === 'skill') {
    const { skillManifest } = await import(pathToFileURL(path.join(source, 'skill-format.mjs')));
    const value = skillManifest(input);
    for (const file of [value.bodySource, ...value.resources.map(r => r.source)].filter(Boolean)) await safePath(c.root, file, { missing: true });
    return value;
  }
  if (payload.kind !== 'decision') throw new Error('kind must be card, decision, or skill');
  const allowed = ['key', 'kind', 'title', 'body', 'scope', 'space', 'evidence', 'expiresAt'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`Unknown memory field: ${key}`);
  if (input.kind !== undefined && input.kind !== 'decision') throw new Error('Decision input.kind must be decision');
  text(input.key, 'memory.key', 120); text(input.title, 'memory.title', 200); text(input.body, 'memory.body', 6000);
  if (input.scope !== undefined) await safePath(c.root, input.scope, { missing: true });
  if (input.evidence !== undefined && (!Array.isArray(input.evidence) || input.evidence.length > 12)) throw new Error('Invalid memory evidence');
  for (const evidence of input.evidence ?? []) await safePath(c.root, typeof evidence === 'string' ? evidence : evidence?.path);
  return { ...input, kind: 'decision' };
}
async function writeNative(method, payload, context, c) {
  const value = await validateInput(payload, c), update = method === 'phantom.update';
  if (update) {
    identifier(payload.id);
    if (payload.kind === 'card') {
      if (payload.replace !== true) throw new Error('Cards are immutable: set replace:true to explicitly create a replacement card');
    } else if (payload.kind === 'decision') {
      if (!Number.isSafeInteger(payload.revision) || payload.revision < 1) throw new Error('Memory update requires the revision read');
    }
  }
  const home = await stateHome(context, c.root), dir = path.join(home, 'integration-writes');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const operation = stable({ method, backend: c.backend, workspace: c.root, cli: c.cli, flags: c.flags, kind: payload.kind, id: payload.id, revision: payload.revision, ref: payload.ref, replace: payload.replace, value });
  const hash = createHash('sha256').update(operation).digest('hex');
  const key = createHash('sha256').update(payload.idempotencyKey ? `${c.root}:${text(payload.idempotencyKey, 'idempotencyKey', 200)}` : hash).digest('hex');
  const journal = path.join(dir, `${key}.json`);
  if (writes.has(journal)) {
    const running = writes.get(journal);
    if (running.hash !== hash) throw new Error('Idempotency key already used for different input');
    return running.work;
  }
  const work = (async () => {
    let old;
    try { old = JSON.parse(await readFile(journal, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (old) {
      if (old.hash !== hash) throw new Error('Idempotency key already used for different input');
      if (old.status === 'completed') return old.result;
      throw new Error('Previous Phantom write has an uncertain outcome; inspect the native catalog before creating another item');
    }
    if (update && payload.kind === 'card') await detail({ topic: 'tasks', id: payload.id }, context, c);
    if (update && payload.kind === 'skill') {
      const previous = await detail({ topic: 'skills', id: payload.id, ref: payload.ref }, context, c);
      if (previous.ref.scope === 'global') throw new Error('Global skills are read-only here; publish a workspace skill explicitly');
      if (value.id !== payload.id || previous.ref.version !== payload.revision || value.version === previous.ref.version) throw new Error('Skill update requires current revision and a new immutable version');
    }
    await writeFile(journal, JSON.stringify({ hash, status: 'pending', createdAt: observedAt() }), { flag: 'wx', mode: 0o600 });
    const temp = await mkdtemp(path.join(dir, 'input-'));
    try {
      const file = path.join(temp, 'input.json'); await writeFile(file, JSON.stringify(value), { mode: 0o600 });
      const args = payload.kind === 'card' ? ['create', file] : payload.kind === 'skill' ? ['skill-publish', file, '--workspace', c.root] : update ? ['memory-edit', payload.id, '--from', file, '--revision', String(payload.revision), '--workspace', c.root] : ['memory-add', file, '--workspace', c.root];
      const raw = await c.call(args);
      const id = raw.id ?? raw.ref?.id;
      if (!id) throw new Error('Phantom write returned no canonical ID; inspect native catalog');
      const result = { id, ...(raw.ref ? { ref: raw.ref } : {}), source: 'phantom', semantic: update ? payload.kind === 'card' ? 'replacement' : payload.kind === 'skill' ? 'new-version' : 'revision' : 'created', ...(update && payload.kind === 'card' ? { replaces: payload.id, relatedRef: { source: 'phantom', topic: 'tasks', id: payload.id } } : {}), raw };
      const staging = `${journal}.${randomUUID()}`;
      await writeFile(staging, JSON.stringify({ hash, status: 'completed', result }), { mode: 0o600 }); await rename(staging, journal);
      return result;
    } finally { await rm(temp, { recursive: true, force: true }); }
  })();
  writes.set(journal, { hash, work });
  try { return await work; } finally { writes.delete(journal); }
}
async function control(payload, context, c) {
  if (payload.action === 'stop' || payload.action === 'cancel') return controlOwned(payload, context, c);
  const key = stable({ backend: c.backend, id: payload.id });
  if (starts.has(key)) return starts.get(key);
  const work = controlOwned(payload, context, c);
  starts.set(key, work);
  try { return await work; } finally { starts.delete(key); }
}
async function controlOwned(payload, context, c) {
  if (payload.action === 'stop') {
    const owned = [...controllers.values()].find(p => p.descriptor.workspaceId === c.workspace.id && p.descriptor.backend === c.backend && (p.descriptor.id === payload.id || p.descriptor.taskId === payload.id) && p.descriptor.status === 'running');
    if (!owned) throw new Error('No active controller owned by this host for that task');
    if (!owned.child.kill('SIGINT')) throw new Error('Controller could not be interrupted');
    return { ...owned.descriptor, stopRequested: true };
  }
  if (!['run', 'cancel', 'recover', 'verify'].includes(payload.action)) throw new Error('Unknown Phantom control action');
  const task = await detail({ topic: 'tasks', id: payload.id }, context, c);
  if (payload.action === 'cancel') return c.call(['cancel', task.id]);
  if (payload.action === 'run') text(payload.model, 'model', 200);
  const active = [...controllers.values()].find(p => p.descriptor.workspaceId === c.workspace.id && p.descriptor.backend === c.backend && p.descriptor.taskId === task.id && p.descriptor.status === 'running');
  if (active) return active.descriptor;
  const descriptor = { id: randomUUID(), taskId: task.id, workspaceId: c.workspace.id, workspacePath: c.root, backend: c.backend, action: payload.action, status: 'running', source: 'phantom', createdAt: observedAt(), output: '' };
  c.workspace.phantomControllers ??= []; c.workspace.phantomControllers.push(descriptor);
  // Retain descriptors across host restarts; a stale descriptor is never a kill authority.
  for (const old of c.workspace.phantomControllers) if (old !== descriptor && old.status === 'running' && !controllers.has(old.id)) old.status = 'lost';
  await context.persist();
  let child;
  try { child = spawnCommand(context, process.execPath, [c.cli, payload.action, task.id, ...(payload.action === 'run' ? ['--model', payload.model] : []), ...c.flags], { cwd: c.root, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { descriptor.status = 'failed'; descriptor.error = error.message; await context.persist(); throw error; }
  descriptor.pid = child.pid;
  controllers.set(descriptor.id, { descriptor, child });
  let bytes = 0, finished = false;
  const emit = event => context.emit?.({ ...event, workspaceId: c.workspace.id, id: descriptor.id });
  let hardTimer;
  const timer = setTimeout(() => {
    descriptor.timeout = true; child.kill('SIGINT');
    hardTimer = setTimeout(() => child.kill('SIGKILL'), 10000); hardTimer.unref?.();
  }, 3600000); timer.unref?.();
  const output = data => {
    const chunk = Buffer.from(data), remaining = Math.max(0, 1024 * 1024 - bytes); bytes += chunk.length;
    if (remaining) { const text = chunk.subarray(0, remaining).toString(); descriptor.output = (descriptor.output + text).slice(-65536); emit({ type: 'tool.output', data: text }); }
    if (bytes > 1024 * 1024) descriptor.truncated = true;
  };
  const finish = (code, signal, error) => {
    if (finished) return; finished = true; clearTimeout(timer); clearTimeout(hardTimer);
    Object.assign(descriptor, { status: error || code !== 0 ? 'failed' : 'completed', exitCode: code, signal, endedAt: observedAt(), ...(error ? { error: error.message } : {}) });
    controllers.delete(descriptor.id);
    emit({ type: 'tool.status', status: descriptor.status, result: { ...descriptor } });
    Promise.resolve(context.persist()).catch(() => {});
  };
  child.stdout?.on('data', output); child.stderr?.on('data', output);
  child.once('error', error => finish(null, null, error)); child.once('close', (code, signal) => finish(code, signal));
  emit({ type: 'tool.status', status: 'running', result: { ...descriptor } });
  await context.persist(); return { ...descriptor };
}
export async function phantom(method, payload, context) {
  // Validate topics outside the availability catch; bad API input is not an unavailable backend.
  if (method === 'phantom.list' && !['tasks', 'memories', 'skills'].includes(payload.topic)) throw new Error('topic must be tasks, memories, or skills');
  if (method === 'phantom.list' && payload.query !== undefined && (typeof payload.query !== 'string' || payload.query.length > 500)) throw new Error('Invalid Phantom query');
  if (method === 'phantom.list') {
    await workspaceRoot(context, payload);
    try { return await list(payload, context, await client(payload, context)); }
    catch (error) { return { available: false, items: [], reason: `Phantom unavailable: ${error.message}`, observedAt: observedAt() }; }
  }
  const c = await client(payload, context);
  if (method === 'phantom.detail') return detail(payload, context, c);
  if (method === 'phantom.control') return control(payload, context, c);
  return writeNative(method, payload, context, c);
}

export async function shutdownPhantom() {
  for (const { child, descriptor } of controllers.values()) if (descriptor.status === 'running') child.kill('SIGINT');
}
