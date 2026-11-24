import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Process inspection. Linux reads /proc; macOS (darwin) has no /proc and uses ps/lsof
// with fixed argv. Platform, command runner and fs are injectable for tests.
const PS_FORMAT = 'pid=,ppid=,pgid=,tpgid=,lstart=,comm=';
const defaults = { platform: process.platform, run: execFileSync, fs };
const exec = (run, cmd, args) => String(run(cmd, args, { encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));

// "  123  1  123  123 Mon Nov 23 10:00:00 2026 /bin/zsh" -> rows. session = pgid.
export function parsePs(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
    if (m) rows.push({ pid: Number(m[1]), parent: Number(m[2]), session: Number(m[3]), tpgid: Number(m[4]), start: m[5].replace(/\s+/g, ' '), comm: m[6] });
  }
  return rows;
}
// lsof -F output: "p<pid>" starts a process, "n<name>" lists a file/socket. -> [{pid,name}]
export function parseLsof(text) {
  const out = []; let pid = null;
  for (const line of String(text).split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid !== null) out.push({ pid, name: line.slice(1) });
  }
  return out;
}
export function lsofPorts(text) {
  const ports = [];
  for (const { pid, name } of parseLsof(text)) {
    const port = Number(name.replace(/\s*\(LISTEN\)$/, '').match(/:(\d+)$/)?.[1]);
    if (port) ports.push({ pid, port });
  }
  return ports;
}
export function descendants(rows, pid) {
  const owned = new Set([pid]);
  for (let changed = true; changed;) { changed = false; for (const p of rows) if (!owned.has(p.pid) && (p.session === pid || owned.has(p.parent))) { owned.add(p.pid); changed = true; } }
  return rows.filter(p => owned.has(p.pid));
}
const linuxIdentity = (pid, fsx) => { try { const stat = fsx.readFileSync(`/proc/${pid}/stat`, 'utf8'); const parts = stat.slice(stat.lastIndexOf(')') + 2).split(' '); return { pid: Number(pid), parent: Number(parts[1]), session: Number(parts[3]), start: parts[19] }; } catch { return null; } };

export function processIdentity(pid, { platform, run, fs: fsx } = defaults) {
  if (platform !== 'darwin') return linuxIdentity(pid, fsx ?? fs);
  try { const { tpgid, comm, ...identity } = parsePs(exec(run, 'ps', ['-p', String(pid), '-o', PS_FORMAT]))[0] ?? {}; return identity.pid === Number(pid) ? identity : null; } catch { return null; }
}
export function ownedProcesses(pid, { platform, run, fs: fsx } = defaults) {
  if (platform !== 'darwin') {
    const f = fsx ?? fs;
    return descendants(f.readdirSync('/proc').filter(v => /^\d+$/.test(v)).map(v => linuxIdentity(v, f)).filter(Boolean), pid);
  }
  try { return descendants(parsePs(exec(run, 'ps', ['-axo', PS_FORMAT])).map(({ tpgid, comm, ...p }) => p), pid); } catch { return []; }
}
// Foreground process group of the terminal whose leader is pid -> {tpgid, comm, argv} | null.
export function foregroundProcess(pid, { platform, run, fs: fsx } = defaults) {
  try {
    if (platform !== 'darwin') {
      const f = fsx ?? fs, stat = f.readFileSync(`/proc/${pid}/stat`, 'utf8'), tpgid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[5]);
      if (!(tpgid > 0)) return null;
      return { tpgid, comm: f.readFileSync(`/proc/${tpgid}/comm`, 'utf8').trim(), argv: f.readFileSync(`/proc/${tpgid}/cmdline`, 'utf8').split('\0').filter(Boolean) };
    }
    const rows = parsePs(exec(run, 'ps', ['-axo', PS_FORMAT])), tpgid = rows.find(p => p.pid === pid)?.tpgid;
    if (!(tpgid > 0)) return null;
    const lead = rows.find(p => p.pid === tpgid) ?? rows.find(p => p.session === tpgid);
    if (!lead) return null;
    let argv = [];
    try { argv = exec(run, 'ps', ['-p', String(lead.pid), '-o', 'args=']).trim().split(/\s+/).filter(Boolean); } catch { /* comm alone */ }
    return { tpgid, comm: path.basename(lead.comm), argv };
  } catch { return null; }
}
// Listening TCP ports of the given pids (darwin only; Linux attribution lives in services.mjs).
export function listeningPorts(pids, { run = execFileSync } = {}) {
  if (!pids.length) return [];
  try { return lsofPorts(exec(run, 'lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', pids.join(','), '-Fpn'])); } catch { return []; }
}
export function workingDirectories(pids, { run = execFileSync } = {}) {
  if (!pids.length) return new Map();
  try { return new Map(parseLsof(exec(run, 'lsof', ['-nP', '-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn'])).map(e => [e.pid, e.name])); } catch { return new Map(); }
}
// Darwin equivalent of managedPorts: descendants of running sessions that listen on TCP.
export function managedPortsDarwin(sessions, root, inside, opts = {}) {
  const run = opts.run ?? execFileSync, rows = parsePs(exec(run, 'ps', ['-axo', PS_FORMAT]));
  const owner = new Map();
  for (const s of sessions) for (const p of descendants(rows, s.pid)) if (!owner.has(p.pid)) owner.set(p.pid, s);
  const pids = [...owner.keys()], cwds = workingDirectories(pids, { run });
  return listeningPorts(pids, { run }).filter(p => cwds.has(p.pid) && inside(root, cwds.get(p.pid))).map(p => ({ port: p.port, owner: { pid: p.pid, sessionId: owner.get(p.pid).id } }));
}
