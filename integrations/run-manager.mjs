import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const OUTPUT_LIMIT = 64 * 1024;
const managers = new Map();
const activeStatuses = new Set(['starting', 'running', 'stopping']);

export function requireId(id, name = 'id') {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error(`${name} debe ser un UUID válido`);
  return id;
}

export async function requireWorkspace(payload, context) {
  const id = requireId(payload?.workspaceId, 'workspaceId');
  const workspace = context.getWorkspace ? await context.getWorkspace(id)
    : (context.state?.workspaces ?? context.state?.data?.workspaces)?.find(item => item.id === id) ?? context.workspace;
  if (!workspace || workspace.id !== id) throw new Error('Workspace no encontrado o no autorizado');
  const source = workspace.canonicalPath || workspace.path;
  if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('Workspace sin ruta absoluta válida');
  // No fallback: a relocated/deleted workspace must be explicitly fixed by its owner.
  const cwd = await realpath(source);
  return { workspace, cwd };
}

export function stateDirectory(context = {}) {
  const configured = context.dataDir ?? context.state?.dataDir ?? context.state?.data?.dataDir
    ?? context.state?.settings?.dataDir ?? context.state?.data?.settings?.dataDir ?? process.env.PHANTOM_WORKSPACE_HOME;
  return path.resolve(configured || path.join(process.env.XDG_STATE_HOME || path.join(homedir(), '.local/state'), 'phantom-workspace'));
}

export async function executableOnPath(command) {
  const candidates = command.includes('/') ? [command] : (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, command));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return path.resolve(candidate); } catch { /* next */ }
  }
  return null;
}

// No shell, no restored PID is ever sent a signal. Only this closure owns the child.
export function runCommand(executable, args, { cwd, timeoutMs = 30_000, outputLimit = OUTPUT_LIMIT, onOutput = () => {}, onSpawn = () => {}, signal, input, env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Ejecución detenida'));
    let child, timer, bytes = 0, output = '', failure, settled = false;
    const kill = () => {
      if (!child?.pid) return;
      const send = sig => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, sig); } catch { /* already exited */ } };
      send('SIGTERM');
      const escalation = setTimeout(() => send('SIGKILL'), 300);
      escalation.unref();
    };
    const fail = message => { failure ||= new Error(message); kill(); };
    const abort = () => fail('Ejecución detenida');
    const finish = (error, code, exitSignal) => {
      if (settled) return;
      settled = true;
      // A successful parent may have left background descendants with redirected
      // stdio. They belong to this run too, never to a restored descriptor.
      kill();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error || failure) {
        const reason = failure || error;
        reason.output = output;
        reason.exitCode = code;
        reason.exitSignal = exitSignal;
        reject(reason);
      } else resolve({ code, signal: exitSignal, output, pid: child.pid });
    };
    try {
      child = spawn(executable, args, { cwd, env, detached: process.platform !== 'win32', shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.once('spawn', () => onSpawn(child.pid));
      child.once('error', error => finish(error));
      child.once('close', (code, exitSignal) => finish(null, code, exitSignal));
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        const remaining = Math.max(0, outputLimit - bytes);
        bytes += chunk.length;
        const text = chunk.subarray(0, remaining).toString('utf8');
        output += text;
        if (text) onOutput(text);
        if (bytes > outputLimit) fail(`Salida excede el límite de ${outputLimit} bytes`);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => fail(`Tiempo límite excedido (${timeoutMs} ms)`), timeoutMs);
    } catch (error) { kill(); finish(error); }
  });
}

class RunManager {
  constructor(root) { this.root = root; this.records = new Map(); this.controllers = new Map(); this.reservations = new Set(); this.loaded = new Map(); this.writes = Promise.resolve(); }

  async initialize(workspaceId) {
    if (!this.loaded.has(workspaceId)) this.loaded.set(workspaceId, this.load(workspaceId));
    return this.loaded.get(workspaceId);
  }

  async load(workspaceId) {
    const dir = path.join(this.root, workspaceId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const entry of (await readdir(dir, { withFileTypes: true })).slice(0, 2000)) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      try {
        const record = JSON.parse(await readFile(path.join(dir, entry.name, 'run.json'), 'utf8'));
        if (record.id !== entry.name || record.workspaceId !== workspaceId || !['automation', 'playground'].includes(record.kind)) continue;
        record.artifactDir = path.join(dir, entry.name);
        record.output = String(record.output || '').slice(-OUTPUT_LIMIT);
        delete record.pid;
        delete record.viewer;
        if (activeStatuses.has(record.status) || record.browserOpen) {
          record.status = 'lost'; record.error = 'El host anterior terminó; el proceso no se ha restaurado'; record.finishedAt = new Date().toISOString();
        }
        record.browserOpen = false;
        this.records.set(record.id, record);
        await this.save(record);
      } catch { /* corrupt/incomplete descriptors never launch anything */ }
    }
  }

  save(record) {
    const snapshot = JSON.stringify(record, null, 2);
    const target = path.join(record.artifactDir, 'run.json');
    const task = this.writes.catch(() => {}).then(async () => {
      const temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, target);
    });
    this.writes = task;
    return task;
  }

  async create(workspaceId, kind, fields, context) {
    if (this.controllers.size + this.reservations.size >= 8) throw new Error('Demasiadas ejecuciones activas (máximo 8)');
    const id = randomUUID();
    this.reservations.add(id);
    const artifactDir = path.join(this.root, workspaceId, id);
    try {
      await mkdir(artifactDir, { recursive: true, mode: 0o700 });
      const record = { ...fields, id, workspaceId, kind, status: 'starting', artifactDir, output: '', createdAt: new Date().toISOString() };
      this.records.set(id, record);
      await this.save(record);
      this.emit(context, { type: 'tool.status', workspaceId, id, status: record.status });
      return record;
    } catch (error) { this.reservations.delete(id); throw error; }
  }

  own(record, controller) {
    this.reservations.delete(record.id);
    this.controllers.set(record.id, controller);
  }

  async prepare(record, context, callback) {
    try { await callback(); } catch (error) {
      this.reservations.delete(record.id);
      await this.status(record, 'failed', context, { error: error.message });
      throw error;
    }
  }

  emit(context, event) { try { context.emit?.(event); } catch { /* detached subscriber */ } }

  async status(record, status, context, fields = {}) {
    Object.assign(record, fields, { status });
    if (['completed', 'failed', 'stopped'].includes(status)) record.finishedAt = new Date().toISOString();
    await this.save(record);
    this.emit(context, { type: 'tool.status', workspaceId: record.workspaceId, id: record.id, status, ...(record.error ? { error: record.error } : {}), result: this.describe(record) });
  }

  output(record, text, context) {
    const priorBytes = Buffer.byteLength(record.output);
    const chunk = Buffer.from(text);
    const remaining = Math.max(0, OUTPUT_LIMIT - priorBytes);
    // Round-trip avoids a dangling replacement character exceeding a byte cap.
    const bounded = chunk.subarray(0, remaining).toString('utf8').replace(/\uFFFD$/, '');
    record.output += bounded;
    if (bounded) this.emit(context, { type: 'tool.output', workspaceId: record.workspaceId, id: record.id, data: bounded });
    // One serialized write chain preserves order without unbounded per-chunk queues.
    if (!record.outputWritePending) {
      Object.defineProperty(record, 'outputWritePending', { value: true, writable: true, enumerable: false, configurable: true });
      const timer = setTimeout(() => {
        record.outputWritePending = false;
        this.save(record).catch(() => {});
      }, 100);
      timer.unref();
    }
    return chunk.length <= remaining;
  }

  describe(record) { return { ...record, owned: this.controllers.has(record.id) }; }

  get(id, workspaceId, kind) {
    requireId(id);
    const record = this.records.get(id);
    if (!record || record.workspaceId !== workspaceId || record.kind !== kind) throw new Error('Ejecución no encontrada en este workspace');
    return record;
  }

  async stop(record) {
    const controller = this.controllers.get(record.id);
    if (!controller) throw new Error('Esta ejecución ya no tiene un controlador propio en este host');
    await controller.stop();
    return this.describe(record);
  }

  async shutdown() {
    await Promise.allSettled([...this.controllers.values()].map(controller => controller.stop()));
    await this.writes;
  }
}

export async function getRunManager(context, cwd, workspaceId) {
  const dataDir = stateDirectory(context);
  // Refuse app data inside the workspace, including symlink aliases.
  let ancestor = dataDir;
  const suffix = [];
  let existing;
  while (!existing) {
    try { existing = await realpath(ancestor); } catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(ancestor) === ancestor) throw error;
      suffix.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
  const resolvedTarget = path.join(existing, ...suffix);
  const lexical = path.relative(cwd, resolvedTarget);
  if (!lexical || (!lexical.startsWith(`..${path.sep}`) && lexical !== '..' && !path.isAbsolute(lexical))) throw new Error('El directorio de estado debe estar fuera del workspace');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const canonicalData = await realpath(dataDir);
  const relative = path.relative(cwd, canonicalData);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('El directorio de estado debe estar fuera del workspace');
  const root = path.join(canonicalData, 'automation');
  let manager = managers.get(root);
  if (!manager) { manager = new RunManager(root); managers.set(root, manager); }
  await manager.initialize(workspaceId);
  return manager;
}

export async function shutdownAutomation() {
  await Promise.all([...managers.values()].map(manager => manager.shutdown()));
  managers.clear();
}
