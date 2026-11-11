import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareWorktree } from '../host/worktree-setup.mjs';

export async function setupCurrentWorktree(options) {
  return prepareWorktree(fileURLToPath(new URL('../', import.meta.url)), options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Preparación cancelada por cierre'));
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  try { console.log(JSON.stringify(await setupCurrentWorktree({ signal: controller.signal }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel); }
}
