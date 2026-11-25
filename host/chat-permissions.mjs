import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Permission policy for chat cards. A headless agent cannot ask in a terminal,
// so every permission it would prompt for comes here (through the approval
// gate) and is either granted at once or shown to the user in the card.
//
// The line Autónomo draws: the agent works without interruptions and asks only
// for what cannot be taken back or leaves the machine — deleting or writing
// beyond its folder (temporary folders are fine), commits outside the card's
// own worktree, pushes and shared
// Git refs, external MCP tools, external services and providers, databases,
// privilege and the system. "Pregunta todo" keeps the stricter folder rule.
// Total is YOLO except what "puede romper algo" (danger()): destructive Git,
// credentials and .env, installing or changing the system, disks and shutting
// the machine down. Reading credential files asks in every mode.
// The shell classifiers are heuristics over the command text: a guard against
// surprises, not a sandbox.

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch', 'TodoWrite', 'TodoRead', 'Task', 'Agent', 'Skill', 'ToolSearch', 'BashOutput', 'TaskOutput', 'KillShell', 'KillBash', 'TaskStop', 'Monitor', 'EnterPlanMode', 'ExitPlanMode', 'ListMcpResourcesTool', 'ReadMcpResourceTool']);
const EDIT_TOOLS = { Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };

// Resolve symlinks through the nearest existing ancestor so a link inside the
// folder cannot smuggle a write outside it.
function real(target) {
  let current = path.resolve(target);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(current), ...rest.reverse()); }
    catch { const parent = path.dirname(current); if (parent === current) return path.resolve(target); rest.push(path.basename(current)); current = parent; }
  }
}
export function inside(root, target) {
  if (!root || typeof target !== 'string' || !target) return false;
  if (/^~|\$/.test(target)) return false;
  const base = real(root), resolved = real(path.isAbsolute(target) ? target : path.join(root, target));
  return resolved === base || resolved.startsWith(base + path.sep);
}

// Split a command line into words and control operators, honouring quotes.
// Returns null when the line uses constructs that hide what runs.
export function tokenize(line) {
  if (/\$\(|`|<\(|>\(/.test(line)) return null;
  const out = []; let word = '', quoted = false, i = 0;
  const flush = () => { if (word || quoted) out.push({ word }); word = ''; quoted = false; };
  while (i < line.length) {
    const c = line[i];
    if (c === "'") { const end = line.indexOf("'", i + 1); if (end < 0) return null; word += line.slice(i + 1, end); quoted = true; i = end + 1; continue; }
    if (c === '"') { let j = i + 1, value = ''; while (j < line.length && line[j] !== '"') { if (line[j] === '\\' && j + 1 < line.length) j++; value += line[j++]; } if (j >= line.length) return null; word += value; quoted = true; i = j + 1; continue; }
    if (c === '\\' && i + 1 < line.length) { word += line[i + 1]; i += 2; continue; }
    if (c === '\n' || c === ';') { flush(); out.push({ op: ';' }); i++; continue; }
    if (c === '&' || c === '|') { flush(); const two = line.slice(i, i + 2); if (two === '&&' || two === '||') { out.push({ op: two }); i += 2; } else if (c === '&' && line[i + 1] === '>') { out.push({ redirect: '&>' }); i += line[i + 2] === '>' ? 3 : 2; } else { out.push({ op: c }); i++; } continue; }
    if (c === '>' || c === '<') {
      // A leading fd number belongs to the redirect, not to the command.
      if (/^[0-9]*$/.test(word) && !quoted) word = ''; else flush();
      // fd duplication (2>&1, >&2) touches no file.
      const dup = /^[<>]&[0-9-]+/.exec(line.slice(i));
      if (dup) { i += dup[0].length; continue; }
      const op = line[i + 1] === c ? c + c : c; out.push({ redirect: op }); i += op.length; continue;
    }
    if (/\s/.test(c)) { flush(); i++; continue; }
    word += c; i++;
  }
  flush();
  return out;
}

const READ_COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'sort', 'uniq', 'cut', 'tr', 'echo', 'printf', 'pwd', 'which', 'type', 'command', 'diff', 'cmp', 'file', 'stat', 'tree', 'jq', 'less', 'more', 'basename', 'dirname', 'realpath', 'readlink', 'du', 'df', 'date', 'true', 'false', 'test', '[', 'column', 'nl', 'od', 'xxd', 'hexdump', 'strings', 'sha256sum', 'md5sum', 'fd', 'bat', 'whoami', 'uname', 'id', 'ps', 'lsof', 'printenv', 'seq', 'sleep', 'git-status']);
const LOCAL_COMMANDS = new Set(['mkdir', 'touch', 'cp', 'mv', 'rm', 'rmdir', 'ln', 'chmod', 'tee', 'tar', 'unzip', 'gzip', 'gunzip', 'patch', 'make', 'tsc', 'vite', 'vitest', 'jest', 'eslint', 'prettier', 'playwright', 'cargo', 'go', 'pytest', 'ruff', 'black', 'mypy', 'deno', 'bunx']);
const SCRIPT_RUNNERS = new Set(['node', 'python', 'python3', 'bun', 'tsx', 'ts-node']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
// Programs that act beyond the folder whatever their arguments: privilege,
// processes, services, the network, other machines, the system's packages.
const OUTSIDE_COMMANDS = new Set(['sudo', 'su', 'doas', 'pkexec', 'kill', 'pkill', 'killall', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'netcat', 'telnet', 'ftp', 'socat', 'mail', 'sendmail', 'shutdown', 'reboot', 'poweroff', 'halt', 'systemctl', 'service', 'launchctl', 'crontab', 'at', 'mount', 'umount', 'chown', 'chgrp', 'dd', 'fdisk', 'parted', 'wipefs', 'apt', 'apt-get', 'dpkg', 'brew', 'pacman', 'yay', 'paru', 'dnf', 'yum', 'zypper', 'snap', 'flatpak', 'pip', 'pip3', 'pipx', 'gem', 'eval', 'exec', 'source', '.', 'xargs', 'env', 'open', 'xdg-open', 'osascript', 'iptables', 'ufw', 'useradd', 'userdel', 'usermod', 'passwd', 'visudo', 'aws', 'gcloud', 'az', 'terraform', 'vercel', 'netlify', 'fly', 'flyctl', 'heroku']);
// CLIs whose subcommand decides: these only look, the rest act outside.
const DOCKER_READ = new Set(['ps', 'images', 'logs', 'inspect', 'version', 'info', 'stats', 'top', 'port', 'history', 'search', 'diff', 'events']);
const SUBCOMMAND_READ = { docker: DOCKER_READ, podman: DOCKER_READ, kubectl: new Set(['get', 'describe', 'logs', 'top', 'explain', 'version', 'api-resources', 'api-versions', 'cluster-info']) };
const GH_READ = new Set(['pr list', 'pr view', 'pr status', 'pr diff', 'pr checks', 'issue list', 'issue view', 'issue status', 'repo view', 'run list', 'run view', 'run watch', 'release list', 'release view', 'workflow list', 'workflow view', 'auth status', 'search repos', 'search issues', 'search prs', 'search code', 'search commits', 'status', 'label list', 'cache list']);
const pathLike = arg => arg.includes('/') || arg.startsWith('.') || arg.startsWith('~') || arg.includes('$');
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const NPM_LOCAL = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'test', 't', 'run', 'run-script', 'exec', 'x', 'rebuild', 'dedupe', 'prune', 'pack', 'start', 'build', 'dev', 'lint', 'audit', 'fund', 'ls', 'list', 'outdated', 'view', 'info', 'why', 'explain', 'help', 'version', '--version', '-v']);
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'grep', 'ls-files', 'ls-tree', 'rev-parse', 'rev-list', 'blame', 'describe', 'shortlog', 'reflog', 'cat-file', 'merge-base', 'name-rev', 'whatchanged', 'help', 'version', '--version']);
const GIT_LOCAL = new Set(['add', 'commit', 'restore', 'checkout', 'switch', 'stash', 'rm', 'mv', 'reset', 'merge', 'rebase', 'cherry-pick', 'revert', 'apply', 'am', 'clean', 'notes', 'tag', 'format-patch', 'bisect', 'init']);

const flagValue = (args, ...names) => { for (let i = 0; i < args.length; i++) if (names.includes(args[i])) return args[i + 1]; };
const pathArgs = args => args.filter(arg => !arg.startsWith('-'));

function classifyGit(args, cwd) {
  const rest = [...args];
  while (rest[0]?.startsWith('-')) {
    const flag = rest.shift();
    if (flag === '-C') { const dir = rest.shift(); if (!inside(cwd, dir)) return { scope: 'outside', reason: `git en otra carpeta (${dir})` }; }
    else if (flag === '-c') rest.shift();
    else if (['--git-dir', '--work-tree'].includes(flag) || /^--(git-dir|work-tree)=/.test(flag)) return { scope: 'outside', reason: 'git apuntando a otro repositorio' };
  }
  const [sub = '', ...tail] = rest;
  if (GIT_READ.has(sub)) return { scope: 'read' };
  if (sub === 'branch') {
    if (tail.some(arg => /^-(d|D|m|M|c|C|f)$|^--(delete|move|copy|force|set-upstream-to|unset-upstream)/.test(arg))) return { scope: 'outside', reason: 'git branch modifica ramas compartidas por todos los worktrees' };
    return { scope: tail.some(arg => !arg.startsWith('-')) ? 'local' : 'read' };
  }
  if (sub === 'remote') return tail.length === 0 || tail.every(arg => arg === '-v' || arg === '--verbose') || tail[0] === 'show' ? { scope: 'read' } : { scope: 'outside', reason: 'git remote cambia remotos compartidos' };
  if (sub === 'config') return tail.some(arg => /^--(global|system)$/.test(arg)) ? { scope: 'outside', reason: 'git config global' } : tail.some(arg => /^(--get|--list|-l|--get-all|--get-regexp)/.test(arg)) ? { scope: 'read' } : { scope: 'local' };
  if (sub === 'worktree') return tail[0] === 'list' ? { scope: 'read' } : { scope: 'outside', reason: 'git worktree afecta a otros worktrees' };
  if (sub === 'stash' && ['list', 'show'].includes(tail[0])) return { scope: 'read' };
  if (sub === 'tag' && (tail.length === 0 || tail.some(arg => /^(-l|--list)$/.test(arg)))) return { scope: 'read' };
  if (GIT_LOCAL.has(sub)) return { scope: 'local' };
  if (['push', 'pull', 'fetch', 'clone', 'submodule', 'update-ref', 'filter-branch', 'gc', 'prune', 'replace', 'symbolic-ref', 'send-email', 'request-pull'].includes(sub)) return { scope: 'outside', reason: `git ${sub} sale del worktree (remotos o refs compartidas)` };
  return { scope: 'outside', reason: `git ${sub || ''} no reconocido`.trim() };
}

function classifySegment(words, cwd) {
  let args = [...words];
  while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) args.shift();
  for (;;) {
    if (args[0] === 'rtk') { args.shift(); if (args[0] === 'proxy') args.shift(); continue; }
    if (args[0] === 'time' || args[0] === 'nice' || args[0] === 'nohup') { args.shift(); continue; }
    if (args[0] === 'timeout') { args.shift(); while (args[0]?.startsWith('-')) args.shift(); args.shift(); continue; }
    break;
  }
  if (!args.length) return { scope: 'read' };
  const [command, ...rest] = args, name = path.basename(command);
  if (command.includes('/')) return inside(cwd, command) ? { scope: 'local' } : { scope: 'outside', reason: `ejecuta ${command} fuera de la carpeta` };
  if (name === 'cd' || name === 'pushd') return !rest[0] || inside(cwd, rest[0]) ? { scope: 'read' } : { scope: 'outside', reason: `cambia a ${rest[0] || '~'}` };
  if (name === 'git') return classifyGit(rest, cwd);
  if (PACKAGE_MANAGERS.has(name)) {
    if (rest.some(arg => /^(-g|--global|--location=global|--prefix|-C|--cwd|--dir)$/.test(arg) || /^--(prefix|cwd|dir)=/.test(arg))) return { scope: 'outside', reason: `${name} global o en otra carpeta` };
    const sub = rest.find(arg => !arg.startsWith('-')) ?? '';
    if (name === 'yarn' && !sub) return { scope: 'local' };
    if (NPM_LOCAL.has(sub) || (name !== 'npm' && sub && !['publish', 'login', 'logout', 'adduser', 'unpublish', 'deprecate', 'owner', 'token', 'config', 'link', 'dist-tag', 'access', 'team', 'org', 'star'].includes(sub))) return { scope: 'local' };
    return { scope: 'outside', reason: `${name} ${sub} publica o configura fuera del proyecto` };
  }
  if (name === 'npx' || name === 'pnpx') return rest.some(arg => /^(-g|--global)$/.test(arg)) ? { scope: 'outside', reason: `${name} global` } : { scope: 'local' };
  if (SHELLS.has(name)) {
    if (rest.some(arg => /^-[a-z]*c/.test(arg) || arg === '-s')) return { scope: 'outside', reason: `${name} ejecuta código en línea` };
    const script = rest.find(arg => !arg.startsWith('-'));
    if (!script) return { scope: 'outside', reason: `${name} ejecuta lo que recibe por la entrada` };
    return inside(cwd, script) ? { scope: 'local' } : { scope: 'outside', reason: `ejecuta ${script} fuera de la carpeta` };
  }
  if (SCRIPT_RUNNERS.has(name)) {
    if (rest.some(arg => /^(-e|--eval|-p|--print|-c)$/.test(arg))) return { scope: 'outside', reason: `${name} ejecuta código en línea` };
    const script = rest.find(arg => !arg.startsWith('-'));
    if (!script || ['-m', 'run', 'test', 'x'].includes(rest[0])) return { scope: 'local' };
    return inside(cwd, script) ? { scope: 'local' } : { scope: 'outside', reason: `ejecuta ${script} fuera de la carpeta` };
  }
  if (name === 'sed' || name === 'perl') {
    if (!rest.some(arg => /^-i|^--in-place/.test(arg))) return name === 'sed' ? { scope: 'read' } : { scope: 'outside', reason: 'perl ejecuta código' };
    const files = pathArgs(rest).slice(1);
    return files.length && files.every(file => inside(cwd, file)) ? { scope: 'local' } : { scope: 'outside', reason: `${name} -i edita fuera de la carpeta` };
  }
  if (name === 'awk' || name === 'gawk') return rest.some(arg => /system\(|print\s*>|\|\s*"/.test(arg)) ? { scope: 'outside', reason: 'awk escribe o ejecuta' } : { scope: 'read' };
  if (name === 'find') {
    if (rest.some(arg => /^-(exec|execdir|ok|okdir|fprint|fprintf|fls)$/.test(arg))) return { scope: 'outside', reason: 'find ejecuta comandos' };
    return rest.includes('-delete') ? (pathArgs(rest).slice(0, 1).every(dir => inside(cwd, dir)) && !rest[0]?.startsWith('/') ? { scope: 'local' } : { scope: 'outside', reason: 'find -delete fuera de la carpeta' }) : { scope: 'read' };
  }
  if (name === 'curl' || name === 'wget') {
    if (rest.some(arg => /^(-d|--data.*|-F|--form.*|-T|--upload-file|--post-data|--post-file|--method)$/.test(arg) || /^--data/.test(arg))) return { scope: 'outside', reason: `${name} envía datos` };
    const method = flagValue(rest, '-X', '--request');
    if (method && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') return { scope: 'outside', reason: `${name} ${method}` };
    const target = flagValue(rest, '-o', '--output', '-O', '--output-document');
    if (name === 'curl' && rest.includes('-O')) return { scope: 'local' };
    return target ? (inside(cwd, target) ? { scope: 'local' } : { scope: 'outside', reason: `${name} escribe en ${target}` }) : { scope: 'read' };
  }
  if (READ_COMMANDS.has(name)) return { scope: 'read' };
  if (LOCAL_COMMANDS.has(name)) {
    const outside = pathArgs(rest).find(arg => pathLike(arg) && !inside(cwd, arg));
    if (outside) return { scope: 'outside', reason: `${name} toca ${outside}, fuera de la carpeta` };
    return { scope: 'local' };
  }
  if (OUTSIDE_COMMANDS.has(name) || /^mkfs/.test(name)) return { scope: 'outside', reason: `«${name}» actúa fuera de la carpeta` };
  if (SUBCOMMAND_READ[name]) {
    const sub = rest.find(arg => !arg.startsWith('-')) ?? '';
    return SUBCOMMAND_READ[name].has(sub) ? { scope: 'read' } : { scope: 'outside', reason: `${name} ${sub} actúa fuera de la carpeta`.trim() };
  }
  if (name === 'gh') {
    const subs = rest.filter(arg => !arg.startsWith('-'));
    if (subs[0] === 'api') {
      const method = flagValue(rest, '-X', '--method');
      const sends = rest.some(arg => /^(-f|-F|--field|--raw-field|--input)$|^--(field|raw-field|input|method)=/.test(arg)) || (method && method.toUpperCase() !== 'GET');
      return sends ? { scope: 'outside', reason: 'gh api envía datos a GitHub' } : { scope: 'read' };
    }
    return GH_READ.has(subs.slice(0, 2).join(' ')) || GH_READ.has(subs[0] ?? '') ? { scope: 'read' } : { scope: 'outside', reason: `gh ${subs.slice(0, 2).join(' ')} actúa en GitHub`.trim() };
  }
  // Anything else is judged by what it points at: a program whose path-like
  // arguments (including --flag=value values) all stay inside the folder is
  // working on the folder.
  const outside = rest.map(arg => arg.startsWith('-') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg).find(arg => !arg.startsWith('-') && pathLike(arg) && !inside(cwd, arg));
  if (outside) return { scope: 'outside', reason: `«${name}» toca ${outside}, fuera de la carpeta` };
  return { scope: 'local' };
}

const RANK = { read: 0, local: 1, outside: 2 };
// The whole line is as wide as its widest part.
export function classifyCommand(line, cwd) {
  if (typeof line !== 'string' || !line.trim()) return { scope: 'read' };
  const tokens = tokenize(line);
  if (!tokens) return { scope: 'outside', reason: 'usa sustitución de comandos; no se puede saber qué ejecuta' };
  let worst = { scope: 'read' }, words = [];
  const close = () => { if (words.length) { const verdict = classifySegment(words, cwd); if (RANK[verdict.scope] > RANK[worst.scope]) worst = verdict; } words = []; };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.op) { close(); continue; }
    if (token.redirect) {
      const target = tokens[i + 1]?.word; i++;
      if (token.redirect.startsWith('<')) continue;
      if (target === undefined) return { scope: 'outside', reason: 'redirección incompleta' };
      if (target !== '/dev/null' && !inside(cwd, target)) return { scope: 'outside', reason: `escribe en ${target}, fuera de la carpeta` };
      if (target !== '/dev/null' && RANK[worst.scope] < RANK.local) worst = { scope: 'local' };
      continue;
    }
    words.push(token.word);
  }
  close();
  return worst;
}

// The key a "Siempre" answer remembers for the rest of the conversation.
const KEYED_SUBCOMMANDS = ['git', 'npm', 'pnpm', 'yarn', 'bun', 'docker', 'gh', 'kubectl', 'cargo'];
function commandKey(words) {
  const rest = [...words];
  while (rest.length && (/=/.test(rest[0]) || ['rtk', 'time', 'nice', 'nohup'].includes(rest[0]))) rest.shift();
  const [command = '', sub] = rest, name = path.basename(command);
  return `Bash:${KEYED_SUBCOMMANDS.includes(name) && sub ? `${name} ${sub}` : name}`;
}
function grantKey(tool, input, cwd) {
  if (tool === 'Bash') {
    const tokens = tokenize(String(input?.command || '')) || [];
    const words = []; for (const token of tokens) { if (token.op) break; if (token.word !== undefined) words.push(token.word); }
    return commandKey(words);
  }
  const field = EDIT_TOOLS[tool];
  if (field && typeof input?.[field] === 'string') return `${tool}:${path.dirname(path.resolve(cwd || '/', input[field]))}`;
  return tool;
}

// Hard list used by Autónomo (Total only asks for catastrophes, see below):
// privilege, wiping beyond the folder or the home, rewriting the remote's
// history, the user's keys and shell startup, the system, piping the network
// into a shell, raw disks. Everything else Git-related is left to the merge
// guard's hooks.
const HOME = os.homedir();
const TMP_DIRS = [...new Set(['/tmp', '/var/tmp', os.tmpdir()].flatMap(dir => [dir, real(dir)]))];
const PROTECTED_DIRS = [...['.ssh', '.gnupg', '.aws'].map(dir => path.join(HOME, dir)), '/etc', '/usr', '/boot'];
const PROTECTED_FILES = ['.bashrc', '.bash_profile', '.bash_login', '.zshrc', '.zprofile', '.zshenv', '.profile'].map(file => path.join(HOME, file));
const expandHome = target => target.replace(/^~(?=\/|$)/, HOME).replace(/^\$\{?HOME\}?(?=\/|$)/, HOME);
function protectedPath(target, cwd) {
  if (typeof target !== 'string' || !target) return false;
  const expanded = expandHome(target);
  if (/^~|\$/.test(expanded)) return false;
  const absolute = path.resolve(cwd || '/', expanded);
  return [absolute, real(absolute)].some(candidate => PROTECTED_FILES.includes(candidate) || PROTECTED_DIRS.some(dir => candidate === dir || candidate.startsWith(dir + path.sep)));
}
// A target too wide to wipe or re-permission without asking: the root, the
// home, or anything outside the working folder.
function wideTarget(target, cwd, relaxed) {
  const expanded = expandHome(target).replace(/\/\*?$/, '') || '/';
  if (expanded === '/' || expanded === HOME || /^~|\$/.test(expanded)) return true;
  // Autónomo also lets the agent clear what it left in a temporary folder.
  if (relaxed && path.isAbsolute(expanded) && TMP_DIRS.some(dir => real(expanded).startsWith(dir + path.sep))) return false;
  return !inside(cwd, expanded);
}
const WRITE_COMMANDS = new Set(['cp', 'mv', 'tee', 'install', 'ln', 'touch', 'truncate', 'mkdir', 'rm', 'rmdir', 'rsync', 'chmod', 'chown', 'chgrp', 'unzip', 'tar', 'patch', 'sed', 'perl']);
// These read their sources: only the destination (last argument) is written.
const COPY_COMMANDS = new Set(['cp', 'rsync', 'install', 'ln']);

function hardSegment(words, cwd, relaxed) {
  const args = [...words];
  while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) args.shift();
  for (;;) {
    if (args[0] === 'rtk') { args.shift(); if (args[0] === 'proxy') args.shift(); continue; }
    if (['time', 'nice', 'nohup', 'command', 'builtin', 'exec'].includes(args[0])) { args.shift(); continue; }
    if (args[0] === 'env') { args.shift(); while (args[0] && (args[0].startsWith('-') || args[0].includes('='))) args.shift(); continue; }
    if (args[0] === 'timeout' || args[0] === 'xargs') { const skip = args.shift() === 'timeout'; while (args[0]?.startsWith('-')) args.shift(); if (skip) args.shift(); continue; }
    break;
  }
  if (!args.length) return null;
  const [command, ...rest] = args, name = path.basename(command), paths = pathArgs(rest);
  if (['sudo', 'su', 'doas', 'pkexec'].includes(name)) return `${name} ejecuta con privilegios de administrador`;
  if (/^mkfs/.test(name) || ['fdisk', 'parted', 'wipefs'].includes(name)) return `${name} formatea o reparticiona discos`;
  if (name === 'dd' && rest.some(arg => /^of=\/dev\//.test(arg))) return 'dd escribe directamente en un dispositivo';
  if (name === 'rm' && rest.some(arg => /^-[a-zA-Z]*[rRf]/.test(arg) || /^--(recursive|force)$/.test(arg))) {
    const wide = paths.find(arg => wideTarget(arg, cwd, relaxed));
    if (wide) return `rm borra a la fuerza ${wide}, fuera de la carpeta de trabajo`;
  }
  if (['chmod', 'chown', 'chgrp'].includes(name) && rest.some(arg => /^-[a-zA-Z]*R/.test(arg) || arg === '--recursive')) {
    const wide = paths.slice(1).find(arg => { const at = path.resolve(cwd || '/', expandHome(arg)); return at === '/' || at === HOME || protectedPath(arg, cwd); });
    if (wide) return `${name} -R cambia los permisos de ${wide}`;
  }
  if (name === 'git') {
    const tail = [...rest];
    while (tail[0]?.startsWith('-')) { const flag = tail.shift(); if (flag === '-C' || flag === '-c') tail.shift(); }
    if (tail[0] === 'push') {
      const push = tail.slice(1), refs = pathArgs(push).slice(1);
      if (push.some(arg => /^--(force|force-with-lease|force-if-includes)(=|$)/.test(arg) || /^-[a-zA-Z]*f/.test(arg))) return 'git push --force reescribe la historia del remoto';
      if (push.some(arg => /^(-d|--delete)$/.test(arg)) || refs.some(ref => ref.startsWith(':'))) return 'git push --delete borra una rama del remoto';
      if (refs.some(ref => ref.startsWith('+'))) return 'git push +rama fuerza la rama del remoto';
    }
  }
  if (WRITE_COMMANDS.has(name)) {
    if ((name === 'sed' || name === 'perl') && !rest.some(arg => /^-i|^--in-place/.test(arg))) return null;
    const targets = COPY_COMMANDS.has(name) ? paths.slice(-1) : name === 'tar' ? [flagValue(rest, '-C', '--directory')].filter(Boolean) : paths;
    const target = targets.find(arg => protectedPath(arg, cwd));
    if (target) return `${name} escribe en ${target}, una zona protegida`;
  }
  return null;
}

// Why a Bash line must still ask in Total mode, or null. Autónomo reads it
// `relaxed`: here-document bodies are data and temporary folders can be cleared.
export function hardStopCommand(line, cwd, relaxed = false) {
  if (typeof line !== 'string' || !line.trim()) return null;
  if (relaxed) line = stripHeredocs(line);
  if (/\b(curl|wget)\b[^;&]*\|\s*(sudo\s+)?(env\s+)?(\S*\/)?(ba|z|da|k|fi)?sh\b/.test(line) || /\b(ba|z|da|k)?sh\b[^|;&]*(<\(|\$\(|`)\s*(curl|wget)\b/.test(line)) return 'descarga un script de internet y lo ejecuta';
  // Substitutions run in Total mode rather than being refused, so look inside them too.
  const tokens = tokenize(line.replace(/\$\(|<\(|>\(|`/g, ' ; ').replace(/\)/g, ' ; '));
  if (!tokens) return 'no se puede leer el comando completo (comillas sin cerrar)';
  let words = [], reason = null;
  const close = () => { if (!reason && words.length) reason = hardSegment(words, cwd, relaxed); words = []; };
  for (let i = 0; i < tokens.length && !reason; i++) {
    const token = tokens[i];
    if (token.op) { close(); continue; }
    if (token.redirect) {
      const target = tokens[++i]?.word;
      if (token.redirect.startsWith('<') || target === undefined) continue;
      if (/^\/dev\/(sd|nvme|hd|vd|xvd|disk|mmcblk)/.test(target)) reason = `escribe directamente en ${target}`;
      else if (protectedPath(target, cwd)) reason = `escribe en ${target}, una zona protegida`;
      continue;
    }
    words.push(token.word);
  }
  close();
  return reason;
}

// Total mode's only stops: wiping or re-permissioning the root or the whole
// home, and formatting or writing raw disks. Literal targets only (/, ~,
// $HOME, the absolute home); an unparseable line is allowed.
const rootOrHome = target => { const at = expandHome(target).replace(/\/\*?$/, '') || '/'; return at === '/' || at === HOME; };
function catastrophicSegment(words) {
  const args = [...words];
  while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) args.shift();
  for (;;) {
    if (args[0] === 'rtk') { args.shift(); if (args[0] === 'proxy') args.shift(); continue; }
    if (['time', 'nice', 'nohup', 'command', 'builtin', 'exec', 'sudo', 'doas'].includes(args[0])) { args.shift(); continue; }
    if (args[0] === 'env') { args.shift(); while (args[0] && (args[0].startsWith('-') || args[0].includes('='))) args.shift(); continue; }
    break;
  }
  if (!args.length) return null;
  const [command, ...rest] = args, name = path.basename(command), paths = pathArgs(rest);
  if (/^mkfs/.test(name) || ['fdisk', 'parted', 'wipefs'].includes(name)) return `${name} formatea o reparticiona discos`;
  if (name === 'dd' && rest.some(arg => /^of=\/dev\//.test(arg))) return 'dd escribe directamente en un dispositivo';
  if (name === 'rm' && rest.some(arg => /^-[a-zA-Z]*[rR]/.test(arg) || arg === '--recursive')) {
    const wide = paths.find(rootOrHome);
    if (wide) return `rm borra ${wide} entero`;
  }
  if (['chmod', 'chown', 'chgrp'].includes(name) && rest.some(arg => /^-[a-zA-Z]*R/.test(arg) || arg === '--recursive')) {
    const wide = paths.slice(1).find(rootOrHome);
    if (wide) return `${name} -R cambia los permisos de ${wide}`;
  }
  return null;
}
export function catastrophicCommand(line) {
  if (typeof line !== 'string' || !line.trim()) return null;
  const tokens = tokenize(line.replace(/\$\(|<\(|>\(|`/g, ' ; ').replace(/\)/g, ' ; '));
  if (!tokens) return null;
  let words = [], reason = null;
  const close = () => { if (!reason && words.length) reason = catastrophicSegment(words); words = []; };
  for (let i = 0; i < tokens.length && !reason; i++) {
    const token = tokens[i];
    if (token.op) { close(); continue; }
    if (token.redirect) {
      const target = tokens[++i]?.word;
      if (!token.redirect.startsWith('<') && target !== undefined && /^\/dev\/(sd|nvme|hd|vd|xvd|disk|mmcblk)/.test(target)) reason = `escribe directamente en ${target}`;
      continue;
    }
    words.push(token.word);
  }
  close();
  return reason;
}
export function catastrophic(tool, input) {
  return tool === 'Bash' ? catastrophicCommand(input?.command) : null;
}

// Why any tool call must still ask in Total mode, or null.
export function hardStop(tool, input, cwd, relaxed = false) {
  if (tool === 'Bash') return hardStopCommand(input?.command, cwd, relaxed);
  const field = EDIT_TOOLS[tool];
  if (field && protectedPath(input?.[field], cwd)) return `escribe en ${input[field]}, una zona protegida`;
  return null;
}

// ---- Autónomo: what still asks -------------------------------------------
// Everything not named here runs without a prompt.

const under = (dir, target) => target === dir || target.startsWith(dir + path.sep);
// Where a path lands: 'in' the folder, in a 'tmp' folder, 'out' of both, or
// 'unknown' when a variable hides it. `at` is the directory the shell is in.
function reach(target, root, at) {
  if (typeof target !== 'string' || !target) return 'unknown';
  const expanded = expandHome(target).replace(/^\$\{?PWD\}?(?=\/|$)/, at || '$PWD').replace(/^\$\{?TMPDIR\}?(?=\/|$)/, os.tmpdir());
  if (/^~|\$/.test(expanded) || (!path.isAbsolute(expanded) && !at)) return 'unknown';
  const absolute = real(path.resolve(at || '/', expanded));
  if (under('/dev', absolute)) return 'in';
  if (root && under(real(root), absolute)) return 'in';
  return TMP_DIRS.some(dir => absolute.startsWith(dir + path.sep)) ? 'tmp' : 'out';
}

const NETWORK_COMMANDS = new Set(['ssh', 'scp', 'sftp', 'nc', 'ncat', 'netcat', 'telnet', 'ftp', 'socat', 'mail', 'mailx', 'sendmail']);
const SYSTEM_COMMANDS = new Set(['service', 'launchctl', 'at', 'mount', 'umount', 'shutdown', 'reboot', 'poweroff', 'halt', 'iptables', 'nft', 'ufw', 'useradd', 'userdel', 'usermod', 'groupadd', 'passwd', 'visudo', 'osascript', 'apt', 'apt-get', 'dpkg', 'brew', 'pacman', 'yay', 'paru', 'dnf', 'yum', 'zypper', 'snap', 'flatpak']);
const PROVIDER_COMMANDS = new Set(['aws', 'gcloud', 'gsutil', 'bq', 'az', 'terraform', 'tofu', 'pulumi', 'cdk', 'sam', 'serverless', 'sls', 'vercel', 'netlify', 'fly', 'flyctl', 'heroku', 'firebase', 'supabase', 'wrangler', 'doctl', 'railway', 'render', 'eas', 'ansible', 'ansible-playbook', 'helm', 'stripe', 'twilio', 'sentry-cli']);
// Subcommands of those CLIs that only run or check things on this machine.
const PROVIDER_LOCAL = new Set(['dev', 'help', 'version', 'fmt', 'validate', 'status', 'start', 'stop', 'emulators:start', 'emulators:exec', 'lint', 'template', 'synth']);
const DATABASE_COMMANDS = new Set(['psql', 'pg_dump', 'pg_dumpall', 'pg_restore', 'dropdb', 'createdb', 'dropuser', 'createuser', 'mysql', 'mariadb', 'mysqldump', 'mysqladmin', 'mongosh', 'mongo', 'mongodump', 'mongorestore', 'mongoimport', 'mongoexport', 'redis-cli', 'sqlcmd', 'bcp', 'cqlsh', 'clickhouse', 'clickhouse-client', 'influx', 'cockroach', 'turso', 'pscale', 'neonctl']);
const FILE_DATABASES = new Set(['sqlite3', 'sqlite', 'duckdb']);
// Migration and schema tools reached through a runner (npx prisma migrate…).
const MIGRATION = /(^|\s)(prisma\s+(migrate|db)\b|drizzle-kit\s+(push|migrate|drop)\b|knex\s+(migrate|seed)|typeorm\s+(migration|schema):|sequelize(-cli)?\s+db:|(rails|rake)\s+db:|\S*manage\.py\s+(migrate|flush|sqlflush|loaddata)\b|alembic\s+(upgrade|downgrade)\b|(flyway|liquibase|dbmate|atlas)\s+\S)/;
const DOCKER_ASK = new Set(['push', 'login', 'logout', 'rm', 'rmi', 'prune', 'kill', 'system', 'volume', 'network', 'image', 'container', 'swarm', 'stack', 'context', 'buildx']);
const GH_LOCAL = new Set(['pr checkout', 'repo clone', 'release download', 'run download']);
const NPM_PUBLISH = new Set(['publish', 'unpublish', 'login', 'logout', 'adduser', 'deprecate', 'owner', 'token', 'dist-tag', 'access', 'team', 'org']);
const DELETERS = new Set(['rm', 'rmdir', 'shred', 'mv']);
const LOCAL_HOST = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)([:/]|$)/;

function sensitiveGit(rest, ownBranch) {
  const tail = [...rest];
  while (tail[0]?.startsWith('-')) { const flag = tail.shift(); if (flag === '-C' || flag === '-c') tail.shift(); }
  const [sub = '', ...args] = tail, has = pattern => args.some(arg => pattern.test(arg));
  if (sub === 'commit') return ownBranch || has(/^--dry-run$/) ? null : 'git commit registra un commit';
  if (sub === 'push') return has(/^(-n|--dry-run)$/) ? null : 'git push publica en el remoto';
  if (sub === 'branch' && has(/^-(d|D|m|M|f)$|^--(delete|move|force)$/)) return 'git branch borra o mueve ramas compartidas por todos los worktrees';
  if (sub === 'tag' && has(/^(-d|--delete)$/)) return 'git tag borra una etiqueta';
  if (sub === 'worktree' && ['remove', 'prune', 'move'].includes(args[0])) return `git worktree ${args[0]} afecta a otros worktrees`;
  if (sub === 'remote' && ['add', 'remove', 'rm', 'rename', 'set-url', 'set-head', 'set-branches'].includes(args[0])) return 'git remote cambia los remotos del repositorio';
  if (sub === 'config' && has(/^--(global|system)$/)) return 'git config global cambia la configuración de todos tus repositorios';
  if (sub === 'stash' && ['drop', 'clear'].includes(args[0])) return `git stash ${args[0]} descarta trabajo guardado`;
  if (sub === 'reflog' && ['expire', 'delete'].includes(args[0])) return 'git reflog borra el historial de recuperación';
  if (sub === 'symbolic-ref' && pathArgs(args).length < 2) return null;
  if (['update-ref', 'symbolic-ref', 'filter-branch', 'filter-repo', 'replace', 'send-email'].includes(sub)) return `git ${sub} reescribe refs compartidas o sale del repositorio`;
  return null;
}

// Why one simple command asks in Autónomo, or null. `state.at` follows cd.
function sensitiveSegment(words, root, state, depth, ownBranch) {
  const args = [...words];
  if (args[0]) args[0] = args[0].replace(/^[({]+/, '');
  if (args.length) args[args.length - 1] = args.at(-1).replace(/[)}]+$/, '');
  for (;;) {
    while (args.length && (!args[0] || /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0]))) args.shift();
    if (args[0] === 'rtk') { args.shift(); if (args[0] === 'proxy') args.shift(); continue; }
    if (['time', 'nice', 'nohup', 'command', 'builtin', 'exec', 'then', 'do', 'else', 'if', 'while', '!'].includes(args[0])) { args.shift(); continue; }
    if (args[0] === 'env') { args.shift(); while (args[0] && (args[0].startsWith('-') || args[0].includes('='))) args.shift(); continue; }
    if (args[0] === 'timeout') { args.shift(); while (args[0]?.startsWith('-')) args.shift(); args.shift(); continue; }
    if (args[0] === 'xargs') { args.shift(); while (args[0]?.startsWith('-')) { if (/^-[nIPLds]$/.test(args.shift())) args.shift(); } continue; }
    break;
  }
  if (!args.length) return null;
  const [command, ...rest] = args, name = path.basename(command), paths = pathArgs(rest), at = state.at;
  const sub = rest.find(arg => !arg.startsWith('-')) ?? '';
  const beyond = (target, strict = false) => { const where = reach(target, root, at); return where === 'out' || (strict && where === 'unknown'); };
  if (name === 'cd' || name === 'pushd') {
    const where = !rest[0] ? HOME : rest[0] === '-' ? null : expandHome(rest[0]);
    state.at = where && !/^~|\$/.test(where) && (path.isAbsolute(where) || at) ? path.resolve(at || '/', where) : null;
    return null;
  }
  if (name === 'eval') return sensitiveCommand(rest.join(' '), root, depth + 1, ownBranch)?.reason ?? null;
  if (SHELLS.has(name)) {
    const inline = rest.findIndex(arg => /^-[a-z]*c[a-z]*$/.test(arg));
    if (inline >= 0) return sensitiveCommand(rest[inline + 1] ?? '', root, depth + 1, ownBranch)?.reason ?? null;
    return paths.length ? null : `${name} ejecuta lo que recibe por la entrada`;
  }
  if (name === 'git') return sensitiveGit(rest, ownBranch);
  if (DATABASE_COMMANDS.has(name)) return `«${name}» opera sobre una base de datos`;
  if (FILE_DATABASES.has(name)) { const file = paths.find(arg => beyond(arg, true)); return file ? `«${name}» abre una base de datos fuera de la carpeta (${file})` : null; }
  if (MIGRATION.test(` ${args.join(' ')}`)) return 'ejecuta migraciones o cambios de esquema en una base de datos';
  if (NETWORK_COMMANDS.has(name)) return `«${name}» se conecta a otra máquina`;
  if (PROVIDER_COMMANDS.has(name)) return PROVIDER_LOCAL.has(sub) || !sub ? null : `«${name} ${sub}» actúa en un proveedor externo`;
  if (name === 'kubectl') return SUBCOMMAND_READ.kubectl.has(sub) || !sub ? null : `kubectl ${sub} actúa en el clúster`;
  if (name === 'docker' || name === 'podman') {
    if (sub === 'compose') return rest.includes('rm') || rest.includes('push') || (rest.includes('down') && rest.some(arg => /^(-v|--volumes)$/.test(arg))) ? `${name} compose borra contenedores o volúmenes` : null;
    return DOCKER_ASK.has(sub) ? `${name} ${sub} borra o publica fuera de la carpeta` : null;
  }
  if (name === 'gh') {
    const subs = rest.filter(arg => !arg.startsWith('-')), two = subs.slice(0, 2).join(' ');
    if (subs[0] === 'api') {
      const method = flagValue(rest, '-X', '--method');
      return rest.some(arg => /^(-f|-F|--field|--raw-field|--input)$|^--(field|raw-field|input|method)=/.test(arg)) || (method && method.toUpperCase() !== 'GET') ? 'gh api envía datos a GitHub' : null;
    }
    return !subs.length || GH_READ.has(two) || GH_READ.has(subs[0]) || GH_LOCAL.has(two) ? null : `gh ${two} actúa en GitHub`;
  }
  if (PACKAGE_MANAGERS.has(name) || name === 'npx' || name === 'pnpx') {
    if (rest.some(arg => /^(-g|--global|--location=global)$/.test(arg))) return `${name} instala o cambia paquetes globales`;
    return NPM_PUBLISH.has(sub) && PACKAGE_MANAGERS.has(name) ? `${name} ${sub} publica o cambia tu cuenta del registro` : null;
  }
  if (['claude', 'codex', 'opencode'].includes(name) && rest[0] === 'mcp' && rest[1] && !['list', 'get'].includes(rest[1])) return `${name} mcp ${rest[1]} conecta o cambia servidores MCP`;
  if (name === 'systemctl' || name === 'crontab') {
    const reads = name === 'crontab' ? rest.includes('-l') : ['status', 'is-active', 'is-enabled', 'is-failed', 'list-units', 'list-unit-files', 'list-timers', 'show', 'cat'].includes(sub);
    return reads ? null : `«${name}» cambia servicios o tareas programadas del sistema`;
  }
  if (SYSTEM_COMMANDS.has(name)) return `«${name}» actúa sobre el sistema`;
  if (name === 'curl' || name === 'wget') {
    const method = flagValue(rest, '-X', '--request');
    const sends = rest.some(arg => /^(-d|--data.*|--json|-F|--form.*|-T|--upload-file|--post-data.*|--post-file.*|--method.*|--body-data.*)$/.test(arg) || /^-X(?!GET$|HEAD$)\w+$/.test(arg)) || (method && !['GET', 'HEAD'].includes(method.toUpperCase()));
    const urls = rest.filter(arg => /^https?:\/\//.test(arg) || LOCAL_HOST.test(arg));
    if (sends && !(urls.length && urls.every(url => LOCAL_HOST.test(url)))) return `${name} envía datos a un servicio externo`;
    const target = flagValue(rest, '-o', '--output', '-O', '--output-document');
    return target && beyond(target) ? `${name} escribe en ${target}, fuera de la carpeta` : null;
  }
  if (name === 'rsync' && paths.some(arg => /^[^/]+:/.test(arg))) return 'rsync copia hacia o desde otra máquina';
  if (name === 'find') {
    const roots = []; for (const arg of rest) { if (arg.startsWith('-') || arg === '(' || arg === '!') break; roots.push(arg); }
    const removes = rest.includes('-delete') || rest.some((arg, i) => /^-(exec|execdir|ok)$/.test(arg) && ['rm', 'shred', 'mv'].includes(path.basename(rest[i + 1] || '')));
    const wide = removes && roots.find(dir => beyond(dir, true));
    return wide ? `find borra dentro de ${wide}, fuera de la carpeta` : null;
  }
  if (name === 'dd') { const to = rest.find(arg => arg.startsWith('of='))?.slice(3); return to && beyond(to) ? `dd escribe en ${to}, fuera de la carpeta` : null; }
  if (WRITE_COMMANDS.has(name) || name === 'shred' || name === 'unzip') {
    const edits = rest.some(arg => /^-i|^--in-place/.test(arg));
    if ((name === 'sed' || name === 'perl') && !edits) return null;
    const targets = name === 'sed' || name === 'perl' ? (rest.some(arg => /^(-e|-f|--expression|--file)/.test(arg)) ? paths : paths.slice(1))
      : name === 'tar' ? [flagValue(rest, '-C', '--directory')].filter(Boolean)
      : name === 'unzip' ? [flagValue(rest, '-d')].filter(Boolean)
      : COPY_COMMANDS.has(name) ? paths.slice(-1) : paths;
    const target = targets.find(arg => beyond(arg, DELETERS.has(name)));
    if (target) return DELETERS.has(name) ? `${name} borra o mueve ${target}, fuera de la carpeta de trabajo` : `${name} escribe en ${target}, fuera de la carpeta de trabajo`;
  }
  return null;
}

// Here-document bodies are data, not commands.
function stripHeredocs(line) {
  const mark = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g, rows = line.split('\n'), kept = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; kept.push(row.replace(mark, ' '));
    for (const found of row.matchAll(mark)) { i++; while (i < rows.length && rows[i].trim() !== found[2]) i++; }
  }
  return kept.join('\n');
}
// Pull $(…), `…` and <(…) out so each is judged as a command of its own.
function unnest(line) {
  const inner = []; let text = line, before;
  do { before = text; text = text.replace(/\$\(([^()]*)\)|[<>]\(([^()]*)\)|`([^`]*)`/g, (_, a, b, c) => { inner.push(a ?? b ?? c); return '$SUBST'; }); } while (text !== before && inner.length < 64);
  return [text, ...inner];
}

// Why a Bash line asks in Autónomo: { reason, key } or null.
export function sensitiveCommand(line, cwd, depth = 0, ownBranch = false) {
  if (typeof line !== 'string' || !line.trim()) return null;
  const unreadable = { reason: 'no se puede leer el comando completo', key: 'Bash:?' };
  if (depth > 3) return unreadable;
  const parts = unnest(stripHeredocs(line));
  if (/\$\((?!\()|`/.test(parts[0])) return unreadable;
  for (const part of parts) {
    const tokens = tokenize(part);
    if (!tokens) return unreadable;
    const state = { at: cwd }; let words = [], found = null;
    const close = () => { if (!found && words.length) { const reason = sensitiveSegment(words, cwd, state, depth, ownBranch); if (reason) found = { reason, key: commandKey(words) }; } words = []; };
    for (let i = 0; i < tokens.length && !found; i++) {
      const token = tokens[i];
      if (token.op) { close(); continue; }
      if (token.redirect) {
        const target = tokens[++i]?.word;
        if (token.redirect.startsWith('<') || target === undefined) continue;
        if (reach(target, cwd, state.at) === 'out') found = { reason: `escribe en ${target}, fuera de la carpeta de trabajo`, key: commandKey(words) };
        continue;
      }
      words.push(token.word);
    }
    close();
    if (found) return found;
  }
  return null;
}

// Why any tool call asks in Autónomo: { reason, key? } or null.
export function sensitive(tool, input, cwd, ownBranch = false) {
  if (tool === 'Bash') { const found = sensitiveCommand(input?.command, cwd, 0, ownBranch); return found && { ...found, reason: `Acción delicada: ${found.reason}` }; }
  const field = EDIT_TOOLS[tool];
  if (field) {
    const target = input?.[field];
    if (typeof target === 'string' && /(^|\/)\.?mcp(_servers)?\.json$/.test(target)) return { reason: 'Quiere cambiar la configuración de servidores MCP' };
    return ['in', 'tmp'].includes(reach(target, cwd, cwd)) ? null : { reason: `Quiere escribir fuera de la carpeta de trabajo (${target})` };
  }
  if (tool.startsWith('mcp__')) return { reason: `Herramienta externa ${tool.split('__')[1] || ''}`.trim() };
  return null;
}

// Phantom's own MCP tools (and its approval gate) only read and organize
// this app's context.
// The read-only agent history tool (phantom_workspace.traces) is the only tool of the Codex server allowed by name:
// the CLI tool of that server runs shell-equivalent commands and keeps going through phantomCliAllowed.
export const phantomTool = tool => typeof tool === 'string' && /^mcp__phantom(_workspace_chat)?__|^mcp__phantom_workspace__traces$/.test(tool);

// Phantom Workspace's own CLIs talk to this app (its socket), not to the
// system: every agent — Claude, Codex, OpenCode — may run them in any mode,
// the same way the policy and the server prompt tell it to. Only subcommands
// that stay inside the app count; branches' commit/integrate/publish and a
// Remotion export (writes a folder) keep the normal rules.
export const PHANTOM_SCRIPTS = fileURLToPath(new URL('../scripts', import.meta.url));
const PHANTOM_CLIS = {
  'agent.mjs': args => args[0] !== 'events' || (args.length <= 2 && args.slice(1).every(arg => /^[A-Za-z0-9_-]{1,200}$/.test(arg))),
  'canvas.mjs': args => !args.some(arg => arg === '--remotion' || arg.startsWith('--remotion=')),
  'workspace-browser.mjs': () => true,
  'branches.mjs': args => args.length === 0 || ['status', 'help', '--help', '-h'].includes(args[0]),
};
// The same rule, asked by name (the Phantom MCP server for sandboxed agents).
export const phantomCliAllowed = (name, args) => Object.hasOwn(PHANTOM_CLIS, name) && args.every(arg => typeof arg === 'string') && PHANTOM_CLIS[name](args);
const PHANTOM_ENV_CLIS = { PHANTOM_AGENT_CLI: 'agent.mjs', PHANTOM_BROWSER_CLI: 'workspace-browser.mjs' };
const envName = word => /^\$(?:\{([A-Z_]+)(?::-[^}]*)?\}|([A-Z_]+))$/.exec(word)?.slice(1).find(Boolean);
const nodeWord = word => word === 'node' || envName(word) === 'PHANTOM_AGENT_NODE' || word === process.execPath || /^\/\S*\/node$/.test(word);
function phantomScript(word) {
  const name = PHANTOM_ENV_CLIS[envName(word)];
  if (name) return name;
  if (!path.isAbsolute(word)) return null;
  return real(path.dirname(word)) === real(PHANTOM_SCRIPTS) && Object.hasOwn(PHANTOM_CLIS, path.basename(word)) ? path.basename(word) : null;
}
// One plain command: node + a Phantom CLI + arguments. Pipes, lists,
// redirections to files and substitutions are not this.
export function phantomCommand(line) {
  const tokens = typeof line === 'string' ? tokenize(line.trim()) : null;
  if (!tokens?.length || tokens.some(token => token.word === undefined)) return false;
  const [runner, script, ...args] = tokens.map(token => token.word);
  if (!nodeWord(runner) || !script) return false;
  const name = phantomScript(script);
  return Boolean(name && PHANTOM_CLIS[name](args));
}

// ---- Dangerous: what still asks in Total, flagged "Puede romper algo" ------
// Credential files are also guarded against READING, in every mode.
const SECRET_DIRS = ['.ssh', '.gnupg', '.aws'].map(dir => path.join(HOME, dir));
const SECRET_FILES = ['.netrc', '.npmrc', '.pypirc', '.docker/config.json', '.kube/config', '.config/gh/hosts.yml', '.git-credentials'].map(file => path.join(HOME, file));
function isSecret(file) {
  const base = path.basename(file);
  return SECRET_FILES.includes(file) || SECRET_DIRS.some(dir => under(dir, file))
    || (/^\.env(\..+)?$/.test(base) && !/^\.env\.(example|sample|template)$/.test(base))
    || /\.(pem|key)$/.test(base) || /^id_(rsa|ed25519)/.test(base);
}
function secretPath(target, cwd) {
  if (typeof target !== 'string' || !target) return false;
  const expanded = expandHome(target);
  if (/^~|\$/.test(expanded)) return false;
  const absolute = path.resolve(cwd || '/', expanded);
  return [absolute, real(absolute)].some(isSecret);
}
function systemPath(target, cwd) {
  if (typeof target !== 'string' || !target) return false;
  const expanded = expandHome(target);
  if (/^~|\$/.test(expanded)) return false;
  const absolute = real(path.resolve(cwd || '/', expanded));
  if (under('/var/tmp', absolute)) return false;
  return ['/etc', '/usr', '/boot', '/var', '/opt'].some(dir => under(dir, absolute));
}
const startupFile = (target, cwd) => typeof target === 'string' && target && !/^~$|\$/.test(expandHome(target)) && PROTECTED_FILES.includes(path.resolve(cwd || '/', expandHome(target)));
const sensitiveWrite = (target, cwd) => secretPath(target, cwd) || startupFile(target, cwd) || systemPath(target, cwd);

const SECRET_READERS = new Set(['cat', 'tac', 'nl', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'strings', 'base64', 'xxd', 'od', 'hexdump', 'bat', 'source', '.']);
const PKG_INSTALL = new Set(['apt', 'apt-get', 'dnf', 'yum', 'pacman', 'yay', 'paru', 'zypper', 'brew', 'snap', 'flatpak']);
const SYSTEM_PROCESSES = new Set(['Xorg', 'X', 'Xwayland', 'systemd', 'init', 'sshd', 'dbus-daemon', 'NetworkManager', 'gdm', 'sddm', 'lightdm', 'gnome-shell', 'plasmashell', 'pipewire', 'login']);

function bashFindings(line, cwd) {
  const out = [], add = (kind, reason) => out.push({ kind, reason });
  if (typeof line !== 'string' || !line.trim()) return out;
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(line)) add('other', 'fork bomb: agota los procesos de la máquina');
  if (/\/proc\/[^\s/]*\/environ/.test(line)) add('other', 'vuelca el entorno de un proceso');
  const tokens = tokenize(line.replace(/\$\(|<\(|>\(|`/g, ' ; ').replace(/\)/g, ' ; '));
  if (!tokens) return out;
  const segment = words => {
    const args = [...words];
    for (;;) {
      while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) args.shift();
      if (args[0] === 'rtk') { args.shift(); if (args[0] === 'proxy') args.shift(); continue; }
      if (['time', 'nice', 'nohup', 'command', 'builtin', 'exec', 'sudo', 'doas', 'pkexec'].includes(args[0])) { args.shift(); continue; }
      if (args[0] === 'env') { args.shift(); while (args[0] && (args[0].startsWith('-') || args[0].includes('='))) args.shift(); if (!args.length) add('other', 'env vuelca todo el entorno'); continue; }
      if (args[0] === 'timeout' || args[0] === 'xargs') { const skip = args.shift() === 'timeout'; while (args[0]?.startsWith('-')) args.shift(); if (skip) args.shift(); continue; }
      break;
    }
    if (!args.length) return;
    const [command, ...rest] = args, name = path.basename(command), paths = pathArgs(rest), sub = paths[0] ?? '';
    const has = re => rest.some(arg => re.test(arg));
    if (name === 'printenv' && !paths.length) add('other', 'printenv vuelca todo el entorno');
    if (name === 'export' && rest.includes('-p')) add('other', 'export -p vuelca todo el entorno');
    if (name === 'set' && !rest.length) add('other', 'set vuelca todo el entorno');
    if (['security', 'secret-tool', 'pass'].includes(name) || (/^gpg2?$/.test(name) && rest.includes('--export-secret-keys'))) add('other', `${name} accede a secretos del sistema`);
    if (SECRET_READERS.has(name)) { const file = paths.find(arg => secretPath(arg, cwd)); if (file) add('read', `lee ${file}, un archivo de credenciales`); }
    if (WRITE_COMMANDS.has(name) && !((name === 'sed' || name === 'perl') && !has(/^-i|^--in-place/))) {
      const copies = COPY_COMMANDS.has(name) || name === 'tar';
      const secret = paths.find(arg => secretPath(arg, cwd));
      if (secret) add(copies ? 'read' : 'other', `${name} toca ${secret}, un archivo de credenciales`);
      const targets = COPY_COMMANDS.has(name) ? paths.slice(-1) : name === 'tar' ? [flagValue(rest, '-C', '--directory')].filter(Boolean) : paths;
      const target = targets.find(arg => sensitiveWrite(arg, cwd));
      if (target) add('other', `${name} escribe en ${target}, una zona sensible del sistema o de credenciales`);
    }
    if (name === 'git') {
      const tail = [...rest];
      while (tail[0]?.startsWith('-')) { const flag = tail.shift(); if (flag === '-C' || flag === '-c') tail.shift(); }
      const [gsub = '', ...a] = tail, g = re => a.some(arg => re.test(arg));
      if (gsub === 'reset' && g(/^--hard$/)) add('other', 'git reset --hard descarta cambios sin guardar');
      if (gsub === 'clean' && g(/^-[a-zA-Z]*f|^--force$/)) add('other', 'git clean -f borra archivos sin seguimiento');
      if (gsub === 'branch' && (g(/^-[a-zA-Z]*D/) || ((g(/^--delete$/) || g(/^-[a-zA-Z]*d/)) && (g(/^--force$/) || g(/^-[a-zA-Z]*f/))))) add('other', 'git branch -D borra una rama aunque no esté integrada');
      if (['filter-branch', 'filter-repo'].includes(gsub)) add('other', `git ${gsub} reescribe toda la historia`);
      if (gsub === 'update-ref' && g(/^(-d|--delete)$/)) add('other', 'git update-ref -d borra una referencia');
      if (gsub === 'reflog' && ['expire', 'delete'].includes(a[0])) add('other', 'git reflog borra el historial de recuperación');
      if (gsub === 'stash' && ['clear', 'drop'].includes(a[0])) add('other', `git stash ${a[0]} descarta trabajo guardado`);
      if (gsub === 'worktree' && a[0] === 'remove' && g(/^(--force|-[a-zA-Z]*f)$/)) add('other', 'git worktree remove --force descarta un worktree con cambios');
      if (gsub === 'config' && g(/^--(global|system)$/)) add('other', 'git config global cambia la configuración de todos tus repositorios');
    }
    if (name === 'rm' && has(/^-[a-zA-Z]*[rR]|^--recursive$/)) { const git = paths.find(arg => path.basename(arg.replace(/\/+$/, '')) === '.git'); if (git) add('other', `rm borra el directorio ${git} y toda su historia`); }
    if (PACKAGE_MANAGERS.has(name) && npmGlobal(name, rest)) add('other', `${name} instala paquetes globales`);
    if (['pip', 'pip3'].includes(name) && sub === 'install' && has(/^(--user|--break-system-packages)$/)) add('other', `${name} install fuera de un entorno virtual`);
    if (['pipx', 'cargo', 'go', 'gem'].includes(name) && sub === 'install') add('other', `${name} install instala software en tu usuario`);
    if (PKG_INSTALL.has(name) && has(/^(install|remove|purge|-S\w*|-R\w*|-U\w*)$/)) add('other', `${name} instala o quita paquetes del sistema`);
    if ((name === 'systemctl' || name === 'service') && has(/^(start|stop|restart|enable|disable|mask)$/)) add('other', `${name} cambia servicios del sistema`);
    if (name === 'systemctl' && has(/^(poweroff|reboot|suspend|halt|hibernate)$/)) add('other', `systemctl ${sub} apaga o suspende la máquina`);
    if (['shutdown', 'reboot', 'poweroff', 'halt'].includes(name)) add('other', `${name} apaga o reinicia la máquina`);
    if (name === 'crontab' && !(rest.length && rest.every(arg => arg === '-l'))) add('other', 'crontab cambia las tareas programadas');
    if (['chmod', 'chown', 'chgrp'].includes(name) && has(/^-[a-zA-Z]*R|^--recursive$/)) { const wide = paths.slice(1).find(arg => !inside(cwd, arg)); if (wide) add('other', `${name} -R cambia permisos de ${wide}, fuera de la carpeta`); }
    if (name === 'kill' && (rest.includes('1') || rest.at(-1) === '-1')) add('other', 'kill sobre el PID 1 o sobre todos los procesos');
    if (name === 'killall' && (has(/^-(9|KILL|SIGKILL)$/) || paths.some(proc => SYSTEM_PROCESSES.has(proc)))) add('other', 'killall mata procesos del sistema');
    if (name === 'pkill' && (has(/^-(9|KILL|SIGKILL)$/) && (rest.includes('-1') || paths.some(proc => ['systemd', 'init'].includes(proc))))) add('other', 'pkill -9 sobre procesos del sistema');
  };
  let words = [];
  const close = () => { if (words.length) segment(words); words = []; };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.op) { close(); continue; }
    if (token.redirect) {
      const target = tokens[++i]?.word;
      if (target === undefined) continue;
      if (token.redirect.startsWith('<')) { if (secretPath(target, cwd)) add('read', `lee ${target}, un archivo de credenciales`); }
      else if (sensitiveWrite(target, cwd)) add('other', `escribe en ${target}, una zona sensible del sistema o de credenciales`);
      continue;
    }
    words.push(token.word);
  }
  close();
  return out;
}
const npmGlobal = (name, rest) => rest.some(arg => /^(-g|--global|--location=global)$/.test(arg)) || (name === 'yarn' && rest[0] === 'global');

const SECRET_READ_FIELDS = { Read: 'file_path', NotebookRead: 'notebook_path', Grep: 'path', Glob: 'path', LS: 'path' };
// Why reading would expose credentials, or null. Checked in every mode.
export function secretRead(tool, input, cwd) {
  if (tool === 'Bash') return bashFindings(input?.command, cwd).find(found => found.kind === 'read')?.reason ?? null;
  const target = input?.[SECRET_READ_FIELDS[tool]];
  return secretPath(target, cwd) ? `lee ${target}, un archivo de credenciales` : null;
}

// Why a call still asks in Total mode (it "puede romper algo"), or null.
export function danger(tool, input, cwd) {
  const read = secretRead(tool, input, cwd);
  if (read) return read;
  const field = EDIT_TOOLS[tool];
  if (field && sensitiveWrite(input?.[field], cwd)) return `escribe en ${input[field]}, una zona sensible del sistema o de credenciales`;
  const hard = hardStop(tool, input, cwd);
  if (hard) return hard;
  const bad = catastrophic(tool, input);
  if (bad) return bad;
  return tool === 'Bash' ? bashFindings(input?.command, cwd)[0]?.reason ?? null : null;
}

export const PERMISSION_MODES = ['ask', 'auto', 'full'];

// mode 'full' (YOLO): everything goes except danger(): destructive Git,
// credentials and .env, installing or changing the system, disks and the
// machine itself. Those ask with danger:true ("Puede romper algo").
// mode 'auto': everything goes except the hard list and the sensitive actions
// above (destructive, commit/push, external tools and services, databases).
// mode 'ask': it may read anything but credentials; every change asks.
export function permissionDecision({ tool, input = {}, cwd, mode = 'ask', ownBranch = false }) {
  const key = grantKey(tool, input, cwd);
  const secret = secretRead(tool, input, cwd);
  if (secret) return { allow: false, key, danger: true, reason: `Puede romper algo: ${secret}` };
  if (READ_TOOLS.has(tool) || phantomTool(tool)) return { allow: true, key };
  if (tool === 'Bash' && phantomCommand(input.command)) return { allow: true, key };
  if (mode === 'full') {
    const reason = danger(tool, input, cwd);
    return reason ? { allow: false, key, danger: true, reason: `Puede romper algo: ${reason}` } : { allow: true, key };
  }
  if (mode === 'auto') {
    const hard = hardStop(tool, input, cwd, true);
    if (hard) return { allow: false, key, danger: true, reason: `Acción delicada: ${hard}` };
    const found = sensitive(tool, input, cwd, ownBranch);
    return found ? { allow: false, key: found.key || key, reason: found.reason } : { allow: true, key };
  }
  const field = EDIT_TOOLS[tool];
  if (field) return { allow: false, key, reason: inside(cwd, input[field]) ? 'Quiere editar un archivo de esta carpeta' : `Quiere escribir fuera de la carpeta de trabajo (${input[field]})` };
  if (tool === 'Bash') {
    const verdict = classifyCommand(input.command, cwd);
    if (verdict.scope === 'read') return { allow: true, key };
    return { allow: false, key, reason: verdict.scope === 'local' ? 'Quiere ejecutar un comando que modifica esta carpeta' : `Comando fuera del trabajo: ${verdict.reason}` };
  }
  if (tool.startsWith('mcp__')) return { allow: false, key, reason: `Herramienta externa ${tool.split('__')[1] || ''}`.trim() };
  return { allow: false, key, reason: `Herramienta ${tool}` };
}
