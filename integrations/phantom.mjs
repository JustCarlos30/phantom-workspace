import { realpath, stat, readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workspaceRoot, safePath, readBounded, stateHome, externalStatePath, jsonCommand, command, spawnCommand, text, observedAt } from './common.mjs';
import { validatePluginPreferences } from '../shared/plugins.mjs';

const PHANTOM_MAX_BUFFER = 64 * 1024 * 1024;
const defaultCLI = fileURLToPath(new URL('../../harness_engineer/bin/phantom.mjs', import.meta.url));
const controllerPreload = fileURLToPath(new URL('../scripts/phantom-fetch.mjs', import.meta.url));
const controllers = new Map(), writes = new Map(), starts = new Map();
export function prunePhantomControllers(workspace, live = controllers) {
  const items = workspace.phantomControllers;
  if (!Array.isArray(items)) return false;
  const active = item => item.status === 'running' || live.has(item.id);
  const recent = new Set(items.filter(item => !active(item)).sort((a, b) =>
    (Date.parse(b.endedAt ?? b.createdAt) || 0) - (Date.parse(a.endedAt ?? a.createdAt) || 0)).slice(0, 20));
  let changed = false;
  const retained = items.filter(item => active(item) || recent.has(item));
  for (const item of retained) if (!active(item) && typeof item.output === 'string' && item.output.length > 16384) {
    item.output = item.output.slice(-16384); item.truncated = true; changed = true;
  }
  if (retained.length !== items.length) { workspace.phantomControllers = retained; changed = true; }
  return changed;
}
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const identifier = value => { text(value, 'Phantom ID', 200); if (value.startsWith('-')) throw new Error('Invalid Phantom ID'); return value; };
export async function discoverPhantomCLI(explicit) {
  const candidates = explicit ? [explicit] : process.env.PHANTOM_CLI ? [process.env.PHANTOM_CLI] : [path.join(homedir(), '.local/lib/node_modules/phantom-harness/bin/phantom.mjs'), defaultCLI];
  for (const candidate of candidates) {
    try { const resolved = await realpath(candidate); if ((await stat(resolved)).isFile()) return resolved; } catch { /* Try next installation candidate. */ }
  }
  throw new Error(`Phantom CLI not found. Configure phantomPath or PHANTOM_CLI. Tried: ${candidates.join(', ')}`);
}
function configuration(workspace, context) {
  const config = validatePluginPreferences(workspace.plugins).phantom.config;
  return Object.fromEntries(['phantomPath', 'phantomData', 'model'].map(key => [key, config[key] || context.state?.settings?.[key] || undefined]));
}
async function client(payload, context) {
  const { root, workspace } = await workspaceRoot(context, payload);
  const config = configuration(workspace, context);
  const cli = await discoverPhantomCLI(config.phantomPath);
  const flags = ['--json'];
  const data = config.phantomData;
  const nativeHome = await externalStatePath(data ?? process.env.PHANTOM_HOME ?? path.join(process.env.XDG_STATE_HOME ?? path.join(homedir(), '.local/state'), 'phantom'), root);
  if (data !== undefined) {
    text(data, 'phantomData', 4096);
    // Native Phantom owns this database. Never copy or open it through Store.
    flags.push('--data', nativeHome);
  }
  const call = args => jsonCommand(context, process.execPath, [cli, ...args, ...flags], { cwd: root, maxBuffer: PHANTOM_MAX_BUFFER, timeout: 30000 });
  return { root, workspace, cli, flags, call, config, nativeHome, backend: createHash('sha256').update(stable({ root, cli, nativeHome })).digest('hex') };
}
function unavailableReason(error) {
  const reason = error.message.includes('maxBuffer') ? 'el catálogo de Phantom supera el límite de lectura de 64 MiB; archiva o cancela tareas antiguas' : error.killed === true || error.code === 'ETIMEDOUT' ? 'la CLI de Phantom no respondió a tiempo' : error.message;
  return `Phantom unavailable: ${reason}`;
}
export async function phantomStatus(payload, context) {
  await workspaceRoot(context, payload);
  try {
    const c = await client(payload, context);
    // Actually contact the native backend, rather than reporting file presence as health.
    const catalog = await c.call(['list']);
    if (!Array.isArray(catalog)) throw new Error('Phantom returned an invalid catalog');
    let version;
    try { const pkg = JSON.parse(await readFile(path.resolve(path.dirname(c.cli), '../package.json'), 'utf8')); if (typeof pkg.version === 'string') version = pkg.version; } catch { /* Optional package metadata. */ }
    return { available: true, source: 'phantom', cli: c.cli, ...(version ? { version } : {}), observedAt: observedAt() };
  } catch (error) { return { available: false, source: 'phantom', reason: unavailableReason(error), observedAt: observedAt() }; }
}
// Every checkout of this repository, keyed by canonical path, with the branch it holds.
async function family(client, context) {
  const roots = new Map([[client.root, { path: client.root, branch: null, main: true }]]);
  try {
    const { stdout } = await command(context, 'git', ['--no-optional-locks', 'worktree', 'list', '--porcelain', '-z'], { cwd: client.root });
    roots.git = true;
    let current = null;
    for (const entry of stdout.split('\0')) {
      if (entry.startsWith('worktree ')) {
        current = null;
        try { const real = await realpath(entry.slice(9)); current = roots.get(real) ?? { path: real, branch: null, main: false }; roots.set(real, current); } catch { /* Removed worktree. */ }
      } else if (current && entry.startsWith('branch ')) current.branch = entry.slice(7).replace(/^refs\/heads\//, '');
    }
  } catch { /* A non-Git workspace still has an exact canonical scope. */ }
  return roots;
}
async function scopedTask(raw, client, context) {
  const roots = await family(client, context);
  try { return roots.has(await realpath(raw.contract?.workspace)); } catch { return false; }
}
export function normalizePhantom(raw, topic) {
  return { id: raw.id ?? raw.ref?.id, title: raw.contract?.goal ?? raw.title ?? raw.description ?? raw.ref?.id ?? raw.id, kind: topic === 'tasks' ? raw.kind : topic === 'memories' ? raw.kind : 'skill', ...(raw.status !== undefined || raw.state !== undefined ? { status: raw.status ?? raw.state } : {}), ...(raw.body ? { body: raw.body } : {}), source: 'phantom', ...(raw.revision !== undefined ? { revision: raw.revision } : raw.ref?.version ? { revision: raw.ref.version } : {}), ...(raw.ref ? { ref: raw.ref } : {}), raw };
}
async function list(payload, context, c) {
  const topic = payload.topic;
  if (!['tasks', 'memories', 'skills'].includes(topic)) throw new Error('topic must be tasks, memories, or skills');
  if (payload.query !== undefined && (typeof payload.query !== 'string' || payload.query.length > 500)) throw new Error('Invalid Phantom query');
  const locations = new Map();
  const roots = topic === 'tasks' ? await family(c, context) : undefined;
  let raw = await c.call(topic === 'tasks' ? roots.git ? ['list', '--workspace', c.root, '--scope', 'project'] : ['list'] : [topic === 'memories' ? 'memory-list' : 'skill-list', '--workspace', c.root, ...(topic === 'skills' && payload.allVersions ? ['--all-versions'] : [])]);
  if (!Array.isArray(raw)) throw new Error('Phantom returned an invalid catalog');
  if (topic === 'tasks') {
    const filtered = [];
    for (const item of raw) { try { const home = roots.get(await realpath(item.contract?.workspace)); if (home) { filtered.push(item); locations.set(item, home); } } catch { /* Not this workspace. */ } }
    raw = filtered;
  }
  const query = (payload.query ?? '').toLowerCase();
  return { available: true, items: raw.map(item => ({ ...normalizePhantom(item, topic), ...(locations.has(item) ? { location: { ...locations.get(item) } } : {}) })).filter(item => !query || `${item.title}\n${item.body ?? ''}\n${item.id}`.toLowerCase().includes(query)), ...(topic === 'tasks' ? { controllers: (c.workspace.phantomControllers || []).filter(controller => controller.backend === c.backend && raw.some(task => task.id === controller.taskId)).map(controller => ({ ...controller })) } : {}), observedAt: observedAt() };
}
async function events(payload, context, c) {
  if (payload.view !== undefined && payload.view !== 'activity') throw new Error('Invalid Phantom events view');
  // Authorize the canonical task before invoking the CLI event reader. In
  // particular, never fetch a foreign task's events and filter them afterwards.
  const task = await detail({ topic: 'tasks', id: payload.id }, context, c);
  if (task.id !== payload.id) throw new Error('Phantom task ID mismatch');
  const result = await c.call(['events', payload.id]);
  if (!Array.isArray(result)) throw new Error('Phantom returned invalid events');
  if (payload.view === 'activity') {
    const checks = (task.contract ?? task.raw?.contract)?.checks ?? [];
    const grouped = new Map();
    for (const event of result) {
      if (!event.run_id) continue;
      if (!grouped.has(event.run_id)) grouped.set(event.run_id, []);
      grouped.get(event.run_id).push(event);
    }
    let model = null;
    const runs = [...grouped].map(([runId, events], index) => {
      const steps = new Map(), processes = new Map();
      let admitted = false, stopped = false, verifying = false, baseline = 0, round = 0, reason = null, verification = null;
      model = null;
      for (const event of events) {
       const data = event.data || {};
       if (event.type === 'preflight.admitted') admitted = true;
       if (event.type === 'run.error' || event.type === 'task.blocked') { reason = data.reason || reason; stopped = true; }
       if (event.type === 'task.verifying') { verifying = true; verification = null; }
       if (event.type === 'process.intended' && data.kind === 'check' && data.id) {
         if (verifying) {
           if (!verification) { verification = { steps: new Map() }; steps.set(`verification-${round}`, verification); }
           const step = { id: data.id, tool: 'verify', target: checks[verification.steps.size % checks.length]?.name || `Check ${verification.steps.size + 1}`, status: 'running', at: event.at };
           verification.steps.set(data.id, step);
         } else if (!admitted && !stopped) {
           const name = checks[baseline % checks.length]?.name || `Check ${baseline + 1}`;
           baseline++;
           const step = { id: data.id, tool: 'check', target: name, status: 'running', at: event.at };
           steps.set(data.id, step); processes.set(data.id, step);
         }
       }
       if (event.type === 'process.exited' && processes.has(data.id)) processes.get(data.id).status = data.code === 0 ? 'done' : 'error';
       if (event.type === 'verification.recorded') {
         if (!verification) { verification = { steps: new Map() }; steps.set(`verification-${round}`, verification); }
         verification.steps = new Map((data.checks || []).map((check, i) => [`verify-${data.round ?? round}-${i}`, { id: `verify-${data.round ?? round}-${i}`, tool: 'verify', target: check.name || `Check ${i + 1}`, status: check.passed ? 'done' : 'error', at: event.at }]));
         round++; verification = null;
       }
      if (event.type === 'model.requested') model = data.model;
      if (!['action.intended', 'action.observed'].includes(event.type) || !data.callID) continue;
      const previous = steps.get(data.callID), args = data.args || {}, tool = data.tool || previous?.tool || '';
      let target = args.pattern ? `${args.pattern}${args.path ? ` en ${args.path}` : ''}` : args.path;
      target = args.filePath || target || args.command || args.url || args.description || previous?.target || '';
      if (/^(apply_patch|patch)$/i.test(tool) && typeof args.patchText === 'string') target = [...args.patchText.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map(match => match[1]).join(', ');
      const observed = event.type === 'action.observed';
      const failed = data.error || data.status === 'error' || data.metadata?.error || data.metadata?.status === 'error' || data.output?.isError || data.output?.error || data.output?.status === 'error';
      steps.set(data.callID, { id: data.callID, tool, target: String(target).slice(0, 240), status: observed ? failed ? 'error' : 'done' : previous?.status || 'running', at: previous?.at ?? event.at });
      }
      const items = [...steps.values()].flatMap(step => step.steps ? [...step.steps.values()] : [step]);
      return { runId, attempt: index + 1, steps: items.slice(-40), reason, total: items.length };
    });
    const latest = runs.at(-1);
    return { available: true, id: payload.id, source: 'phantom', observedAt: observedAt(), runs, runId: latest?.runId ?? null, model, reason: latest?.reason ?? null, total: latest?.total ?? 0, items: latest?.steps ?? [], truncated: (latest?.total ?? 0) > 40 };
  }
  return { items: result.slice(-100), events: result, id: payload.id, source: 'phantom', observedAt: observedAt(), truncated: result.length > 100 };
}
async function runEvidence(run, c) {
  const unavailable = reason => ({ available: false, reason });
  if (!/^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(run.id ?? '')) return unavailable('ID de ejecución no válido para leer evidencia');
  async function read(name, verification = false) {
    try {
      const file = await safePath(c.nativeHome, `artifacts/${run.id}/${name}`);
      const result = await readBounded(file, 2 * 1024 * 1024);
      if (result.truncated) return unavailable('Artefacto supera el límite de 2 MiB; no se muestra parcialmente');
      const value = JSON.parse(result.text), checks = verification ? value?.checks : value;
      if (!Array.isArray(checks) || checks.some(check => !check || typeof check !== 'object' || Array.isArray(check)
        || ['name', 'cwd', 'stdout', 'stderr', 'error', 'reason', 'signal'].some(key => check[key] != null && typeof check[key] !== 'string')
        || ['argv', 'executedArgv'].some(key => check[key] != null && (!Array.isArray(check[key]) || check[key].some(arg => typeof arg !== 'string')))
        || ['passed', 'executed'].some(key => check[key] != null && typeof check[key] !== 'boolean'))) return unavailable('Formato de evidencia desconocido');
      return { available: true, checks: checks.map(check => Object.fromEntries(['name', 'argv', 'executedArgv', 'cwd', 'passed', 'exitCode', 'signal', 'error', 'tests', 'stdout', 'stderr', 'durationMs', 'executed', 'reason'].filter(key => Object.hasOwn(check, key)).map(key => [key, check[key]]))) };
    } catch (error) { return unavailable(error.code === 'ENOENT' ? 'Artefacto no disponible' : `Evidencia no disponible: ${error.message}`); }
  }
  return { baseline: await read('baseline-checks.json'), verification: await Promise.all([0, 1, 2, 3].map(async round => ({ round, ...await read(`verification-${round}.json`, true) }))) };
}
async function detail(payload, context, c) {
  identifier(payload.id);
  if (payload.topic === 'tasks') {
    const raw = await c.call(['show', payload.id]);
    if (raw.id !== payload.id) throw new Error('Phantom task ID mismatch');
    if (!await scopedTask(raw, c, context)) throw new Error('Phantom task belongs to another workspace');
    return raw.run ? { ...raw, run: { ...raw.run, evidence: await runEvidence(raw.run, c) } } : raw;
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
export function runTimeoutMs(settings) {
  const minutes = settings?.phantomRunTimeoutMinutes;
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes * 60000 : 6 * 3600000;
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
  if (payload.action === 'run') { payload = { ...payload, model: payload.model || c.config.model }; text(payload.model, 'model', 200); }
  const active = [...controllers.values()].find(p => p.descriptor.workspaceId === c.workspace.id && p.descriptor.backend === c.backend && p.descriptor.taskId === task.id && p.descriptor.status === 'running');
  if (active) return active.descriptor;
  const descriptor = { id: randomUUID(), taskId: task.id, workspaceId: c.workspace.id, workspacePath: c.root, backend: c.backend, action: payload.action, status: 'running', source: 'phantom', createdAt: observedAt(), output: '' };
  c.workspace.phantomControllers ??= []; c.workspace.phantomControllers.push(descriptor);
  // Retain descriptors across host restarts; a stale descriptor is never a kill authority.
  for (const old of c.workspace.phantomControllers) if (old !== descriptor && old.status === 'running' && !controllers.has(old.id)) old.status = 'lost';
  prunePhantomControllers(c.workspace);
  await context.persist();
  let child;
  try { child = spawnCommand(context, process.execPath, ['--import', controllerPreload, c.cli, payload.action, task.id, ...(payload.action === 'run' ? ['--model', payload.model] : []), ...c.flags], { cwd: c.root, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { descriptor.status = 'failed'; descriptor.error = error.message; prunePhantomControllers(c.workspace); await context.persist(); throw error; }
  descriptor.pid = child.pid;
  controllers.set(descriptor.id, { descriptor, child });
  let bytes = 0, finished = false;
  const emit = event => context.emit?.({ ...event, workspaceId: c.workspace.id, id: descriptor.id });
  let hardTimer;
  const timer = setTimeout(() => {
    descriptor.timeout = true; child.kill('SIGINT');
    hardTimer = setTimeout(() => child.kill('SIGKILL'), 10000); hardTimer.unref?.();
  }, runTimeoutMs(context.state?.settings)); timer.unref?.();
  const output = data => {
    const chunk = Buffer.from(data), remaining = Math.max(0, 1024 * 1024 - bytes); bytes += chunk.length;
    if (remaining) { const text = chunk.subarray(0, remaining).toString(); descriptor.output = (descriptor.output + text).slice(-65536); emit({ type: 'tool.output', data: text }); }
    if (bytes > 1024 * 1024) descriptor.truncated = true;
  };
  const finish = (code, signal, error) => {
    if (finished) return; finished = true; clearTimeout(timer); clearTimeout(hardTimer);
    Object.assign(descriptor, { status: error || code !== 0 ? 'failed' : 'completed', exitCode: code, signal, endedAt: observedAt(), ...(error ? { error: error.message } : {}) });
    controllers.delete(descriptor.id);
    prunePhantomControllers(c.workspace);
    emit({ type: 'tool.status', status: descriptor.status, result: { ...descriptor } });
    Promise.resolve(context.persist()).catch(() => {});
  };
  child.stdout?.on('data', output); child.stderr?.on('data', output);
  child.once('error', error => finish(null, null, error)); child.once('close', (code, signal) => finish(code, signal));
  emit({ type: 'tool.status', status: 'running', result: { ...descriptor } });
  await context.persist(); return { ...descriptor };
}
export async function phantom(method, payload, context) {
  if (payload.pluginId !== undefined) {
    if (payload.pluginId !== 'phantom') throw new Error('Unknown plugin');
    const { workspace } = await workspaceRoot(context, payload);
    if (['phantom.create', 'phantom.update', 'phantom.control'].includes(method) && !validatePluginPreferences(workspace.plugins).phantom.enabled) throw new Error('Phantom plugin is disabled for this workspace');
  }
  if (method === 'phantom.events' && (typeof payload.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(payload.id))) throw new Error('Invalid Phantom ID');
  // Validate topics outside the availability catch; bad API input is not an unavailable backend.
  if (method === 'phantom.list' && !['tasks', 'memories', 'skills'].includes(payload.topic)) throw new Error('topic must be tasks, memories, or skills');
  if (method === 'phantom.list' && payload.query !== undefined && (typeof payload.query !== 'string' || payload.query.length > 500)) throw new Error('Invalid Phantom query');
  if (method === 'phantom.list') {
    await workspaceRoot(context, payload);
    try { return await list(payload, context, await client(payload, context)); }
    catch (error) { return { available: false, items: [], reason: unavailableReason(error), observedAt: observedAt() }; }
  }
  const c = await client(payload, context);
  if (method === 'phantom.events') return events(payload, context, c);
  if (method === 'phantom.detail') return detail(payload, context, c);
  if (method === 'phantom.controllers') {
    let changed = false;
    let items = (c.workspace.phantomControllers ?? []).filter(item => item.backend === c.backend);
    for (const item of items) if (item.status === 'running' && !controllers.has(item.id)) { item.status = 'lost'; changed = true; }
    changed = prunePhantomControllers(c.workspace) || changed;
    items = (c.workspace.phantomControllers ?? []).filter(item => item.backend === c.backend);
    if (changed) await context.persist();
    return { items: structuredClone(items), observedAt: observedAt() };
  }
  if (method === 'phantom.control') return control(payload, context, c);
  return writeNative(method, payload, context, c);
}

export async function shutdownPhantom() {
  for (const { child, descriptor } of controllers.values()) if (descriptor.status === 'running') child.kill('SIGINT');
}
