import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { hostGitEnv } from './merge-guard.mjs';

// Integration checks: the command that must pass in the project checkout after a
// merge, before the merge is allowed to stay. The project chooses it
// (workspace.integration.checks); null means "detect": `npm test` when
// package.json declares a test script. An empty string means "no checks".
export const CHECKS_TIMEOUT = 15 * 60 * 1000;
const OUTPUT_TAIL = 6000;

export function detectChecks(source) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    const script = manifest?.scripts?.test;
    if (typeof script === 'string' && script.trim() && !/no test specified/.test(script)) return 'npm test';
  } catch { /* No manifest: nothing to detect. */ }
  return '';
}
export function checksFor(w, source) {
  const configured = w.integration?.checks;
  return typeof configured === 'string' ? configured.trim() : detectChecks(source);
}
export function validateChecks(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 1000 || /[\x00\n\r]/.test(value)) throw new Error('Los checks deben ser un solo comando de hasta 1000 caracteres.');
  return value.trim();
}

// One suite at a time across the host: concurrent merges would otherwise run several
// full test suites at once and saturate the machine (and the UI with it).
let queue = Promise.resolve();
export function runChecks(cwd, command, options) {
  const run = queue.then(() => runChecksNow(cwd, command, options));
  queue = run.catch(() => {});
  return run;
}

// Runs in its own process group so a timeout stops the whole tree (npm → node --test → children).
function runChecksNow(cwd, command, { timeout = CHECKS_TIMEOUT } = {}) {
  const started = Date.now();
  return new Promise(resolve => {
    let output = '', timedOut = false;
    const child = spawn('sh', ['-c', command], { cwd, env: hostGitEnv({ CI: '1', FORCE_COLOR: '0' }), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = chunk => { output = (output + chunk).slice(-OUTPUT_TAIL * 2); };
    child.stdout.setEncoding('utf8').on('data', keep); child.stderr.setEncoding('utf8').on('data', keep);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ } }, timeout);
    const finish = code => { clearTimeout(timer); resolve({ command, ok: code === 0 && !timedOut, code, timedOut, durationMs: Date.now() - started, output: output.slice(-OUTPUT_TAIL) }); };
    child.once('error', error => { output += `\n${error.message}`; finish(127); });
    child.once('close', code => finish(code ?? 1));
  });
}
