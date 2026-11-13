import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export const SETUP_TIMEOUT_MS = 240000;
export const SETUP_MARKER = '.phantom-worktree-setup.json';
const queues = new Map();
const hash = value => createHash('sha256').update(value).digest('hex');
const exists = filename => { try { return fs.lstatSync(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const cancelled = signal => { if (signal.aborted) throw signal.reason; };

function waitForTurn(previous, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    previous.catch(() => {}).then(() => { signal.removeEventListener('abort', abort); resolve(); });
    if (signal.aborted) abort();
  });
}

function inputs(cwd) {
  const manifestPath = path.join(cwd, 'package.json');
  if (!exists(manifestPath)) return { skip: 'non-node' };
  const manifest = fs.readFileSync(manifestPath, 'utf8'), pkg = JSON.parse(manifest);
  // Conflicting locks are deliberately conservative, even with packageManager=npm.
  if ((pkg.packageManager && !/^npm@/.test(pkg.packageManager)) ||
      (pkg.devEngines?.packageManager && pkg.devEngines.packageManager.name !== 'npm') ||
      ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].some(name => exists(path.join(cwd, name)))) return { skip: 'non-npm' };
  // Shrinkwrap support is deliberately outside the initial package-lock scope.
  // Skip even when both exist: never fingerprint a different lock than npm uses.
  if (exists(path.join(cwd, 'npm-shrinkwrap.json'))) return { skip: 'unsupported-shrinkwrap' };
  const lockName = 'package-lock.json';
  if (!exists(path.join(cwd, lockName))) return { skip: 'no-npm-lock' };
  return { manifest, lockName, lock: fs.readFileSync(path.join(cwd, lockName), 'utf8') };
}

function fingerprint(input) {
  return hash(JSON.stringify([input.manifest, input.lockName, input.lock, process.platform, process.arch, process.versions.modules]));
}

function inventory(modules) {
  return fs.readdirSync(modules, { recursive: true, withFileTypes: true })
    .map(entry => ({ entry, name: path.relative(modules, path.join(entry.parentPath, entry.name)) }))
    .filter(({ name }) => name !== SETUP_MARKER)
    .map(({ entry, name }) => `${entry.isSymbolicLink() ? 'l' : entry.isDirectory() ? 'd' : 'f'}:${name}`);
}

function validInstallation(modules, marker) {
  if (!Array.isArray(marker.inventory)) return false;
  const actual = new Set(inventory(modules));
  return marker.inventory.every(item => actual.has(item) && (item[0] !== 'l' || fs.existsSync(path.join(modules, item.slice(2)))));
}

// Since electron@45 the package has no postinstall: npm ci leaves it without
// dist/ and the binary only appears on the first require('electron'). Phantom
// prepares it explicitly (from ~/.cache/electron when available) so desktop
// checks never find a worktree "ready" without its runtime.
function electronRuntime(modules) {
  const dir = path.join(modules, 'electron'), installer = path.join(dir, 'install.js');
  if (!exists(installer)) return null;
  let executable;
  try { executable = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim(); } catch {}
  return { installer, ready: Boolean(executable) && Boolean(exists(path.join(dir, 'dist', executable))) };
}

const npmCI = (cwd, signal, env, onProgress) => run(cwd, 'npm', ['ci', '--include=dev', '--no-audit', '--no-fund', '--foreground-scripts'], 'npm ci', signal, env, onProgress);

async function prepareElectron(cwd, modules, signal, env, onProgress) {
  const runtime = electronRuntime(modules);
  if (!runtime || runtime.ready) return;
  onProgress({ status: 'installing', output: 'Preparando el binario de Electron…' });
  await run(cwd, process.execPath, [runtime.installer], 'La instalación de Electron', signal, env, onProgress);
  cancelled(signal);
  if (!electronRuntime(modules)?.ready) throw new Error('Electron se instaló sin su ejecutable (node_modules/electron/dist).');
}

// A detached process group includes npm's lifecycle shells/native builders on Linux.
// Always reap the group, even if npm exits before a stubborn descendant does.
function run(cwd, command, args, label, signal, env, onProgress) {
  return new Promise((resolve, reject) => {
    cancelled(signal);
    let tail = '', stopped = false, failure, killTimer;
    const child = spawn(command, args, {
      cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env, npm_config_update_notifier: 'false' },
    });
    const groupSignal = signalName => { if (child.pid) try { process.kill(-child.pid, signalName); } catch (error) { if (error.code !== 'ESRCH') failure ||= error; } };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      groupSignal('SIGTERM');
      killTimer = setTimeout(() => groupSignal('SIGKILL'), 700);
    };
    const abort = () => { failure = signal.reason; stop(); };
    let progressTimer;
    const publish = () => { progressTimer = null; onProgress({ status: 'installing', output: tail }); };
    const output = chunk => { tail = (tail + chunk.toString()).slice(-12000); if (!progressTimer) progressTimer = setTimeout(publish, 150); };
    child.stdout.on('data', output); child.stderr.on('data', output);
    child.once('error', error => { failure ||= error; });
    // Lifecycle children may inherit npm's pipes. Reap them on exit rather than
    // waiting for 'close', which those same children could keep pending forever.
    child.once('exit', stop);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.once('close', async (code, exitSignal) => {
      stop();
      clearTimeout(progressTimer); publish();
      // Also await the escalation when stdio closed before grandchildren exited.
      await new Promise(r => setTimeout(r, 725));
      clearTimeout(killTimer);
      signal.removeEventListener('abort', abort);
      if (failure || code !== 0) reject(new Error(`${failure?.message || `${label} terminó con ${exitSignal || code}`}${tail ? `\n${tail}` : ''}`));
      else resolve();
    });
  });
}

async function prepare(cwd, signal, env, onProgress) {
  cancelled(signal);
  onProgress({ status: 'checking', output: '' });
  const input = inputs(cwd);
  if (input.skip) return { status: 'skipped', reason: input.skip, cwd };
  const modules = path.join(cwd, 'node_modules'), markerPath = path.join(modules, SETUP_MARKER);
  const stat = exists(modules);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('node_modules debe ser un directorio independiente, no un enlace. Mueve o elimina explícitamente esa instalación y reintenta.');
  let marker;
  try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Marcador de node_modules ilegible. Mueve o elimina explícitamente node_modules y reintenta.'); }
  if (stat && fs.readdirSync(modules).length && marker?.owner !== 'phantom-worktree-setup-v1') throw new Error('node_modules contiene una instalación manual sin marcador de Phantom; se conserva. Mueve o elimina explícitamente node_modules y reintenta para permitir npm ci.');
  const key = fingerprint(input);
  const writeMarker = value => {
    const temporary = `${markerPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ owner: 'phantom-worktree-setup-v1', fingerprint: key, ...value }) + '\n');
    fs.renameSync(temporary, markerPath);
  };
  if (marker?.state === 'ready' && marker.fingerprint === key && validInstallation(modules, marker)) {
    // Installations marked ready before Electron preparation existed: complete
    // only the runtime instead of repeating npm ci.
    if (electronRuntime(modules)?.ready === false) {
      onProgress({ status: 'installing', output: '' });
      await prepareElectron(cwd, modules, signal, env, onProgress);
      writeMarker({ state: 'ready', inventory: inventory(modules) });
    }
    return { status: 'reused', cwd };
  }
  fs.mkdirSync(modules, { recursive: true });
  writeMarker({ state: 'incomplete' });
  try {
    onProgress({ status: 'installing', output: '' });
    await npmCI(cwd, signal, env, onProgress);
    cancelled(signal);
    const current = inputs(cwd);
    if (current.skip || fingerprint(current) !== key) throw new Error('package.json o el lock cambió durante npm ci; reintenta con los archivos actuales.');
    fs.mkdirSync(modules, { recursive: true });
    await prepareElectron(cwd, modules, signal, env, onProgress);
    const installed = inventory(modules);
    if (installed.some(item => item[0] === 'l' && !fs.existsSync(path.join(modules, item.slice(2))))) throw new Error('npm ci dejó enlaces incompletos en node_modules.');
    writeMarker({ state: 'ready', inventory: installed });
    return { status: 'installed', cwd };
  } catch (error) {
    // npm ci removes the initial marker; restore ownership after failure/abort.
    fs.mkdirSync(modules, { recursive: true });
    writeMarker({ state: 'incomplete' });
    throw error;
  }
}

/** Explicit session preparation only. Calls for a canonical cwd serialize;
 * each caller owns its cancellation, including time spent waiting in the queue.
 * env is useful for offline fixtures and npm configuration; argv is never shell text.
 */
export async function prepareWorktree(cwd, { signal, timeoutMs = SETUP_TIMEOUT_MS, env, onProgress = () => {} } = {}) {
  cwd = fs.realpathSync(cwd);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason || new Error('Preparación cancelada'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error(`Preparación excedió ${timeoutMs} ms`)), timeoutMs);
  const previous = queues.get(cwd) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => prepare(cwd, controller.signal, env, progress => { try { onProgress(progress); } catch {} }));
  queues.set(cwd, pending);
  // Keep the reservation chained even when a queued caller cancels immediately.
  pending.finally(() => { if (queues.get(cwd) === pending) queues.delete(cwd); }).catch(() => {});
  try { await waitForTurn(previous, controller.signal); return await pending; }
  catch (error) { throw new Error(`No se pudieron preparar dependencias en ${cwd}: ${error.message}\nCorrige el problema y vuelve a crear la sesión en esta misma terminal; se conserva su worktree. Para reemplazar una instalación manual o un marcador ilegible, mueve/elimina explícitamente node_modules y reintenta.`, { cause: error }); }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}
