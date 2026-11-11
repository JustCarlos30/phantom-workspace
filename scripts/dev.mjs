import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer();
await server.listen();
const address = server.resolvedUrls.local[0];
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, PHANTOM_RENDERER_URL: address, PHANTOM_NODE_BINARY: process.execPath },
});
let ending = false;
async function end(code = 0) {
  if (ending) return;
  ending = true;
  await server.close();
  process.exitCode = code;
}
child.on('error', error => { console.error(error.message); end(1); });
child.on('exit', code => end(code || 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child.kill(signal); });
console.log(`Phantom Workspace: ${address}`);
