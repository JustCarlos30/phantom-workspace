import { execFileSync } from 'node:child_process';
import { constants, accessSync } from 'node:fs';
import path from 'node:path';

export const HOMEBREW_PATH = '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin';
const MERGED_KEYS = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE'];

export function parseEnvZero(output) {
  const env = {};
  for (const entry of String(output).split('\0')) {
    const eq = entry.indexOf('=');
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

export function mergePath(shellPath, currentPath) {
  const seen = new Set();
  return [shellPath, currentPath].flatMap(value => String(value || '').split(':'))
    .filter(dir => dir && !seen.has(dir) && seen.add(dir)).join(':');
}

export function homebrewFallback(currentPath) {
  return mergePath(HOMEBREW_PATH, currentPath);
}

export function mergeShellEnv(env, shellEnv) {
  for (const key of MERGED_KEYS) {
    if (!shellEnv[key]) continue;
    if (key === 'PATH') env.PATH = mergePath(shellEnv.PATH, env.PATH);
    else if (!env[key]) env[key] = shellEnv[key];
  }
  return env;
}

export function loadShellEnvironment({ platform = process.platform, env = process.env, run = execFileSync } = {}) {
  if (platform !== 'darwin') return env;
  try {
    const shell = env.SHELL || '/bin/zsh';
    const output = run(shell, ['-ilc', 'command env -0'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const shellEnv = parseEnvZero(output);
    if (!shellEnv.PATH) throw new Error('PATH ausente');
    mergeShellEnv(env, shellEnv);
  } catch {
    env.PATH = homebrewFallback(env.PATH);
  }
  return env;
}

export function nodeCandidates(platform = process.platform) {
  return platform === 'darwin' ? ['/opt/homebrew/bin/node', '/usr/local/bin/node'] : ['/usr/bin/node'];
}

export function resolveNodeBinary({ platform = process.platform, env = process.env, executable = file => { try { accessSync(file, constants.X_OK); return true; } catch { return false; } } } = {}) {
  if (env.PHANTOM_NODE_BINARY) return env.PHANTOM_NODE_BINARY;
  for (const dir of String(env.PATH || '').split(':')) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const file = path.join(dir, 'node');
    if (executable(file)) return file;
  }
  return nodeCandidates(platform).find(executable) || nodeCandidates(platform)[0];
}

loadShellEnvironment();
