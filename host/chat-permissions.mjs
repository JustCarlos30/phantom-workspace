import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Permission policy for chat cards. A headless agent cannot ask in a terminal,
// so every permission it would prompt for comes here (through the approval
// gate) and is either granted at once or shown to the user in the card.
//
// The line it draws: work that stays inside the card's own folder (normally
// its Phantom worktree) is the agent's job; anything that reaches beyond it —
// other folders, the shared Git refs/remotes, the network, the system — asks.
// The shell classifier is a heuristic over the command text: when it cannot
// tell, it asks. It is a guard against surprises, not a sandbox.

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
function grantKey(tool, input, cwd) {
  if (tool === 'Bash') {
    const tokens = tokenize(String(input?.command || '')) || [];
    const words = []; for (const token of tokens) { if (token.op) break; if (token.word !== undefined) words.push(token.word); }
    while (words.length && (/=/.test(words[0]) || ['rtk', 'time', 'nice', 'nohup'].includes(words[0]))) words.shift();
    const [command = '', sub] = words, name = path.basename(command);
    return `Bash:${['git', 'npm', 'pnpm', 'yarn', 'bun', 'docker', 'gh', 'kubectl', 'cargo'].includes(name) && sub ? `${name} ${sub}` : name}`;
  }
  const field = EDIT_TOOLS[tool];
  if (field && typeof input?.[field] === 'string') return `${tool}:${path.dirname(path.resolve(cwd || '/', input[field]))}`;
  return tool;
}

// Total mode still stops for this short list: privilege, wiping beyond the
// folder or the home, rewriting the remote's history, the user's keys and
// shell startup, the system, piping the network into a shell, raw disks.
// Everything else Git-related is left to the merge guard's hooks.
const HOME = os.homedir();
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
function wideTarget(target, cwd) {
  const expanded = expandHome(target).replace(/\/\*?$/, '') || '/';
  if (expanded === '/' || expanded === HOME || /^~|\$/.test(expanded)) return true;
  return !inside(cwd, expanded);
}
const WRITE_COMMANDS = new Set(['cp', 'mv', 'tee', 'install', 'ln', 'touch', 'truncate', 'mkdir', 'rm', 'rmdir', 'rsync', 'chmod', 'chown', 'chgrp', 'unzip', 'tar', 'patch', 'sed', 'perl']);
// These read their sources: only the destination (last argument) is written.
const COPY_COMMANDS = new Set(['cp', 'rsync', 'install', 'ln']);

function hardSegment(words, cwd) {
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
    const wide = paths.find(arg => wideTarget(arg, cwd));
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

// Why a Bash line must still ask in Total mode, or null.
export function hardStopCommand(line, cwd) {
  if (typeof line !== 'string' || !line.trim()) return null;
  if (/\b(curl|wget)\b[^;&]*\|\s*(sudo\s+)?(env\s+)?(\S*\/)?(ba|z|da|k|fi)?sh\b/.test(line) || /\b(ba|z|da|k)?sh\b[^|;&]*(<\(|\$\(|`)\s*(curl|wget)\b/.test(line)) return 'descarga un script de internet y lo ejecuta';
  // Substitutions run in Total mode rather than being refused, so look inside them too.
  const tokens = tokenize(line.replace(/\$\(|<\(|>\(|`/g, ' ; ').replace(/\)/g, ' ; '));
  if (!tokens) return 'no se puede leer el comando completo (comillas sin cerrar)';
  let words = [], reason = null;
  const close = () => { if (!reason && words.length) reason = hardSegment(words, cwd); words = []; };
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

// Why any tool call must still ask in Total mode, or null.
export function hardStop(tool, input, cwd) {
  if (tool === 'Bash') return hardStopCommand(input?.command, cwd);
  const field = EDIT_TOOLS[tool];
  if (field && protectedPath(input?.[field], cwd)) return `escribe en ${input[field]}, una zona protegida`;
  return null;
}

// Phantom's own MCP tools (and its approval gate) only read and organize
// this app's context.
export const phantomTool = tool => typeof tool === 'string' && /^mcp__phantom(_workspace_chat)?__/.test(tool);

export const PERMISSION_MODES = ['ask', 'auto', 'full'];

// mode 'full': everything goes except the short hard list above, which asks.
// mode 'auto': the agent works freely inside cwd and asks beyond it.
// mode 'ask': it may read anything, but every change asks.
export function permissionDecision({ tool, input = {}, cwd, mode = 'ask' }) {
  const key = grantKey(tool, input, cwd);
  if (READ_TOOLS.has(tool) || phantomTool(tool)) return { allow: true, key };
  if (mode === 'full') {
    const reason = hardStop(tool, input, cwd);
    return reason ? { allow: false, key, reason: `Acción delicada, pregunta incluso en modo Total: ${reason}` } : { allow: true, key };
  }
  const field = EDIT_TOOLS[tool];
  if (field) {
    const target = input[field];
    if (inside(cwd, target)) return mode === 'auto' ? { allow: true, key } : { allow: false, key, reason: 'Quiere editar un archivo de esta carpeta' };
    return { allow: false, key, reason: `Quiere escribir fuera de la carpeta de trabajo (${target})` };
  }
  if (tool === 'Bash') {
    const verdict = classifyCommand(input.command, cwd);
    if (verdict.scope === 'read' || (verdict.scope === 'local' && mode === 'auto')) return { allow: true, key };
    return { allow: false, key, reason: verdict.scope === 'local' ? 'Quiere ejecutar un comando que modifica esta carpeta' : `Comando fuera del trabajo: ${verdict.reason}` };
  }
  if (tool.startsWith('mcp__')) return { allow: false, key, reason: `Herramienta externa ${tool.split('__')[1] || ''}`.trim() };
  return { allow: false, key, reason: `Herramienta ${tool}` };
}
