import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';

// Incorporaciones: every terminal owns one branch; only the orchestrator session
// integrates. The guard is a pair of Git hooks in the project's common .git.
// It restricts Phantom terminals only (identified by their environment), so the
// user's own Git usage is never affected. It is a guardrail against mistakes,
// not a sandbox: a process that strips its environment can bypass it.
const execute = promisify(execFile);
export const GUARD_MARKER = 'phantom-workspace merge guard';
const HOOKS = ['reference-transaction', 'pre-push'];
const TERMINAL_KEYS = ['PHANTOM_TERMINAL_SESSION_ID', 'PHANTOM_TERMINAL_ROLE', 'PHANTOM_TERMINAL_BRANCH', 'PHANTOM_MERGE_TOKEN'];

// Git run by the host is never a terminal's Git, even if the host itself was
// started from inside a Phantom terminal.
export function hostGitEnv(extra = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
  for (const key of TERMINAL_KEYS) delete env[key];
  return { ...env, ...extra };
}
export async function git(cwd, args, { env, timeout = 30000 } = {}) {
  try {
    const { stdout } = await execute('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, env: hostGitEnv(env) });
    return stdout.trim();
  } catch (error) {
    const detail = `${error.stderr || ''}\n${error.stdout || ''}`.trim();
    if (detail) error.message = detail.slice(-2000);
    throw error;
  }
}

export function mergeToken(stateDir, workspaceId) {
  const directory = path.join(stateDir, 'merge-guard');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${workspaceId}.token`);
  try { const saved = fs.readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(saved)) return saved; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}
const digestOf = token => createHash('sha256').update(token).digest('hex');

export function guardScript(digest) {
  return `#!/bin/sh
# ${GUARD_MARKER} v1. Managed by Phantom Workspace (Incorporaciones).
# Turn Incorporaciones off in the project to remove it. Only Phantom terminals
# are restricted; any other Git usage passes through untouched.
[ -n "$PHANTOM_TERMINAL_SESSION_ID$PHANTOM_TERMINAL_ROLE" ] || exit 0
hook=\${0##*/}
if [ "$hook" = reference-transaction ] && [ "$1" != prepared ]; then exit 0; fi
if [ -n "$PHANTOM_MERGE_TOKEN" ] && command -v sha256sum >/dev/null 2>&1; then
  digest=$(printf %s "$PHANTOM_MERGE_TOKEN" | sha256sum | cut -d' ' -f1)
  [ "$digest" = "${digest}" ] && exit 0
fi
if [ "$hook" = pre-push ]; then
  echo "phantom: esta terminal no puede hacer push. Solo la sesion orquestadora integra y publica; solicita la incorporacion con: agent submit" >&2
  exit 1
fi
own=$PHANTOM_TERMINAL_BRANCH
[ -n "$own" ] || own=$(git symbolic-ref -q --short HEAD 2>/dev/null)
case "$own" in phantom/terminal-*) ;; *) own= ;; esac
while read -r old new ref; do
  case "$ref" in
    refs/heads/*)
      if [ -n "$own" ] && [ "$ref" = "refs/heads/$own" ]; then continue; fi
      echo "phantom: esta terminal solo puede escribir su rama (\${own:-ninguna}). $ref solo la mueve la sesion orquestadora; solicita la incorporacion con: agent submit" >&2
      exit 1;;
  esac
done
exit 0
`;
}

async function hookDirectory(source) {
  const [common, hooks] = (await git(source, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--git-path', 'hooks'])).split('\n');
  const directory = path.resolve(source, hooks);
  // A custom core.hooksPath usually points into the tracked tree (husky): never write there.
  if (directory !== path.join(path.resolve(common), 'hooks')) return { reason: 'El repositorio usa core.hooksPath personalizado; no se instala el guard para no modificar hooks versionados. La regla queda solo como política de los agentes.' };
  return { directory };
}
const ours = file => { try { return fs.readFileSync(file, 'utf8').includes(GUARD_MARKER); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

export async function guardState(source) {
  let location;
  try { location = await hookDirectory(source); } catch (error) { return { installed: false, reason: `Git no disponible: ${error.message}` }; }
  if (!location.directory) return { installed: false, reason: location.reason };
  const states = HOOKS.map(name => ours(path.join(location.directory, name)));
  if (states.every(Boolean)) return { installed: true };
  const foreign = HOOKS.filter((name, index) => states[index] === false);
  return { installed: false, reason: foreign.length ? `Ya existe un hook propio del repositorio (${foreign.join(', ')}); se conserva y el guard no se instala.` : 'El guard no está instalado.' };
}
export async function installGuard(source, stateDir, workspaceId) {
  const location = await hookDirectory(source);
  if (!location.directory) return { installed: false, reason: location.reason };
  const foreign = HOOKS.filter(name => ours(path.join(location.directory, name)) === false);
  if (foreign.length) return { installed: false, reason: `Ya existe un hook propio del repositorio (${foreign.join(', ')}); se conserva y el guard no se instala.` };
  fs.mkdirSync(location.directory, { recursive: true });
  const script = guardScript(digestOf(mergeToken(stateDir, workspaceId)));
  for (const name of HOOKS) { const file = path.join(location.directory, name); fs.writeFileSync(file, script, { mode: 0o755 }); fs.chmodSync(file, 0o755); }
  return { installed: true };
}
export async function removeGuard(source) {
  const location = await hookDirectory(source);
  if (!location.directory) return;
  for (const name of HOOKS) { const file = path.join(location.directory, name); if (ours(file)) fs.unlinkSync(file); }
}

export const roleOf = node => node?.data?.role === 'orchestrator' ? 'orchestrator' : 'worker';
// Environment that identifies a terminal (PTY or chat turn) to the guard.
export function roleEnv({ stateDir, workspace, node, branch }) {
  const role = roleOf(node), env = { PHANTOM_TERMINAL_ROLE: role };
  if (role === 'worker' && branch) env.PHANTOM_TERMINAL_BRANCH = branch;
  if (role === 'orchestrator' && workspace.integration?.enabled) env.PHANTOM_MERGE_TOKEN = mergeToken(stateDir, workspace.id);
  return env;
}

const cli = '"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI"';
export function integrationPolicy({ role, base, branch }) {
  const target = base ? `\`${base}\`` : 'the project integration branch';
  if (role === 'orchestrator') return `## Integration (Incorporaciones): orchestrator session

This is the orchestrator session of this project. It runs in the project checkout on ${target} and is the only session that integrates work. It does not implement features; workers do that in their own worktrees. This section takes precedence over the task rules above for integration work.

- \`${cli} queue\` prints active work, the integration queue (touched files and overlaps between branches) and history as JSON.
- Publish what you intend to do so the user can follow it: \`${cli} plan "text"\`, \`${cli} order ID ID ...\`, \`${cli} note ID "text"\`.
- Integrate one request at a time: \`${cli} merge ID\`. The host merges exactly the submitted commit with --no-ff. A conflicting merge is aborted and returned to its worker automatically. Run the project checks after each merge before taking the next one.
- \`${cli} reject ID "reason"\` returns a request to its worker stating what must change.

Do not resolve a worker's conflicts yourself and do not rewrite worker branches. Keep the checkout clean between merges.
`;
  return `## Integration (Incorporaciones): worker terminal

This terminal is a worker. Its only writable branch is ${branch ? `\`${branch}\`` : 'its own terminal branch'}. A Git guard rejects writes to any other branch, pushes, and commits in the project checkout. Only the orchestrator session integrates work into ${target}.

- Commit your work on your own branch. To pick up newer work, merge or rebase ${target} into your branch inside this worktree and resolve conflicts here.
- Before your final commit, before opening a PR, and before saying the work is committed or ready, pull in the latest ${target}: \`git merge ${base || 'main'}\` inside this worktree, resolve any conflicts here, and rerun the checks. \`submit\` rejects a branch that does not contain the current ${target}.
- When the work is committed, up to date with ${target} and its checks pass, request integration: \`${cli} submit "One-line summary of what this branch delivers"\`.
- \`${cli} queue\` shows the queue and your request. If it comes back as conflict or rejected, read its note, update your branch from ${target}, fix, and submit again. \`${cli} withdraw\` cancels your request.

Never work around the guard (unsetting variables, --no-verify, editing hooks, pushing). If another branch must change, report blocked and say why.
`;
}
