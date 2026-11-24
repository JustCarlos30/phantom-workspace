import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePs, parseLsof, lsofPorts, ownedProcesses, foregroundProcess, processIdentity, managedPortsDarwin } from '../host/process-inspect.mjs';

const PS = `  100     1   100   100 Mon Nov 23 10:00:00 2026 /bin/zsh
  101   100   101   101 Mon Nov 23 10:00:05 2026 /usr/local/bin/node
  102   101   101   101 Mon Nov 23 10:00:06 2026 /Applications/Visual Studio Code.app/Contents/MacOS/Electron
  200     1   200    -1 Mon Nov 23 09:00:00 2026 /usr/sbin/cron
`;
const run = (outputs) => (cmd, args) => { const key = [cmd, ...args].join(' '); for (const [k, v] of Object.entries(outputs)) if (key.includes(k)) return v; throw new Error(`unexpected ${key}`); };
const darwin = outputs => ({ platform: 'darwin', run: run(outputs) });

test('parsePs reads macOS ps output with lstart and spaced comm', () => {
  const rows = parsePs(PS);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { pid: 100, parent: 1, session: 100, tpgid: 100, start: 'Mon Nov 23 10:00:00 2026', comm: '/bin/zsh' });
  assert.equal(rows[2].comm, '/Applications/Visual Studio Code.app/Contents/MacOS/Electron');
  assert.equal(rows[3].tpgid, -1);
});
test('ownedProcesses returns descendants and group members on darwin', () => {
  const owned = ownedProcesses(100, darwin({ '-axo': PS }));
  assert.deepEqual(owned.map(p => p.pid), [100, 101, 102]);
  assert.equal(owned[0].start, 'Mon Nov 23 10:00:00 2026');
  assert.deepEqual(ownedProcesses(100, darwin({})), []);
});
test('processIdentity darwin uses ps -p and returns null on failure', () => {
  const id = processIdentity(101, darwin({ '-p 101': '  101   100   101   101 Mon Nov 23 10:00:05 2026 node\n' }));
  assert.deepEqual(id, { pid: 101, parent: 100, session: 101, start: 'Mon Nov 23 10:00:05 2026' });
  assert.equal(processIdentity(999, darwin({})), null);
});
test('foregroundProcess resolves tpgid to the foreground command', () => {
  const fg = foregroundProcess(100, darwin({ '-axo': PS.replace('100   100 Mon', '100   101 Mon'), 'args=': 'node /x/claude-code/cli.js\n' }));
  assert.equal(fg.tpgid, 101);
  assert.equal(fg.comm, 'node');
  assert.deepEqual(fg.argv, ['node', '/x/claude-code/cli.js']);
  assert.equal(foregroundProcess(200, darwin({ '-axo': PS })), null);
});
test('parseLsof -F output becomes listening ports', () => {
  const out = 'p101\nn*:3000\np102\nn127.0.0.1:5173\nn[::1]:8080\n';
  assert.deepEqual(parseLsof(out), [{ pid: 101, name: '*:3000' }, { pid: 102, name: '127.0.0.1:5173' }, { pid: 102, name: '[::1]:8080' }]);
  assert.deepEqual(lsofPorts(out).map(p => p.port), [3000, 5173, 8080]);
});
test('managedPortsDarwin attributes ports of descendants inside root', () => {
  const ports = managedPortsDarwin([{ id: 's1', pid: 100 }], '/proj', (root, p) => p.startsWith(root), {
    run: run({ '-axo': PS, '-d cwd': 'p101\nn/proj\np102\nn/elsewhere\n', '-iTCP': 'p101\nn*:3000\np102\nn*:4000\n' })
  });
  assert.deepEqual(ports, [{ port: 3000, owner: { pid: 101, sessionId: 's1' } }]);
});
test('linux platform reads /proc and never runs commands', () => {
  const files = {
    '/proc/100/stat': '100 (zsh) S 1 100 100 34816 101 0 0 0 0 0 0 0 0 0 20 0 1 0 555 0 0',
    '/proc/101/stat': '101 (node) S 100 101 100 34816 101 0 0 0 0 0 0 0 0 0 20 0 1 0 777 0 0',
    '/proc/101/comm': 'node\n', '/proc/101/cmdline': 'node\0/x/cli.js\0'
  };
  const fsx = { readFileSync: p => { if (p in files) return files[p]; throw new Error('ENOENT'); }, readdirSync: () => ['100', '101', 'self'] };
  const opts = { platform: 'linux', fs: fsx, run: () => { throw new Error('must not exec'); } };
  assert.deepEqual(processIdentity(100, opts), { pid: 100, parent: 1, session: 100, start: '555' });
  assert.deepEqual(ownedProcesses(100, opts).map(p => p.pid), [100, 101]);
  assert.deepEqual(foregroundProcess(100, opts), { tpgid: 101, comm: 'node', argv: ['node', '/x/cli.js'] });
});
