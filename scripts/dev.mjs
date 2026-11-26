// Development runner: Vite (HMR for src/) + Electron, restarted on desktop/ changes.
//   npm run dev -- --ozone-platform=x11        extra Electron flags after "--"
//   PHANTOM_ELECTRON_FLAGS="--ozone-platform=x11" npm run dev
// The host is a detached daemon that owns the terminal/agent sessions, so it is
// never restarted automatically: host/, integrations/ and shared/ changes only
// print a notice. Restart it yourself when no session is working.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const root = path.resolve(import.meta.dirname, '..');
const flags = [...(process.env.PHANTOM_ELECTRON_FLAGS || '').split(/\s+/).filter(Boolean), ...process.argv.slice(2)];
const RELAUNCH = ['desktop', 'shared'];
const HOST = ['host', 'integrations', 'shared'];
const DEBOUNCE_MS = 300;

const server = await createServer();
await server.listen();
const address = server.resolvedUrls.local[0];
let child = null, ending = false, relaunching = false;

function launch() {
  child = spawn(electron, ['.', ...flags], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, PHANTOM_RENDERER_URL: address, PHANTOM_NODE_BINARY: process.execPath },
  });
  const current = child;
  current.on('error', error => { console.error(error.message); end(1); });
  current.on('exit', code => {
    if (current !== child) return;
    if (relaunching) { relaunching = false; launch(); return; }
    end(code || 0);
  });
}

async function end(code = 0) {
  if (ending) return;
  ending = true;
  watchers.forEach(watcher => watcher.close());
  await server.close();
  process.exitCode = code;
}

function relaunch(file) {
  if (ending || relaunching || !child) return;
  console.log(`[dev] ${file} cambió: reiniciando Electron (el host y sus sesiones siguen vivos)`);
  relaunching = true;
  child.kill('SIGTERM');
}

const pending = new Map();
const debounce = (key, fn) => { clearTimeout(pending.get(key)); pending.set(key, setTimeout(fn, DEBOUNCE_MS)); };
const watchers = [...new Set([...RELAUNCH, ...HOST])].map(dir => watch(path.join(root, dir), { recursive: true }, (_event, name) => {
  if (!name || !/\.(mjs|js|cjs|json)$/.test(name) || /\.test\./.test(name)) return;
  const file = path.join(dir, name);
  if (RELAUNCH.includes(dir)) debounce('electron', () => relaunch(file));
  if (HOST.includes(dir)) debounce('host', () => console.log(`[dev] ${file} cambió: el host corre el código anterior. Reinícialo cuando no haya sesiones trabajando:\n      pkill -f "${path.join(root, 'host/server.mjs')}"  (la app levanta uno nuevo)`));
}));

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { relaunching = false; child?.kill(signal); });
launch();
console.log(`Phantom Workspace: ${address}${flags.length ? ` · flags de Electron: ${flags.join(' ')}` : ''}`);
