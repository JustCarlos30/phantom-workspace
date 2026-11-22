import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

export function codexCompactionCapability(help) {
  if (!/Usage:.*codex exec/s.test(help) || !/resume/.test(help)) throw new Error('No se pudo comprobar la interfaz exec de Codex instalada');
  return {
    kind: 'continuation', source: 'codex exec --help',
    evidence: createHash('sha256').update(help).digest('hex'),
    reason: /\bcompact\b/i.test(help)
      ? 'La instalación menciona compactación, pero este transporte exec no tiene un protocolo de compactación verificado. Puedes abrir una sesión nueva con un resumen revisado.'
      : 'Codex exec instalado no expone compactación explícita. La API app-server no está integrada ni verificada en este chat. Puedes abrir una sesión nueva con un resumen revisado; no es compactación.',
  };
}

export async function probeCodexCompaction(bin, cwd, signal) {
  const help = await new Promise((resolve, reject) => execFile(bin, ['exec', '--help'], { cwd, signal, timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  return codexCompactionCapability(help);
}

export async function codexRolloutPath(sessionId, home) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(sessionId)) return null;
  const entries = async dir => { try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; } };
  const root = path.join(home, 'sessions');
  for (const year of await entries(root)) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
    for (const month of await entries(path.join(root, year.name))) {
      if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue;
      for (const day of await entries(path.join(root, year.name, month.name))) {
        if (!day.isDirectory() || !/^\d{2}$/.test(day.name)) continue;
        const dir = path.join(root, year.name, month.name, day.name);
        for (const file of await entries(dir)) if (file.isFile() && file.name.startsWith('rollout-') && file.name.endsWith(`-${sessionId}.jsonl`)) return path.join(dir, file.name);
      }
    }
  }
  return null;
}

export async function codexContextReading(file) {
  if (!file) return null;
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const { size } = await handle.stat(), start = Math.max(0, size - 1024 * 1024);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(lines[i]), info = event.payload?.info;
        if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue;
        const tokens = info?.last_token_usage?.total_tokens, window = info?.model_context_window;
        if (Number.isFinite(tokens) && tokens > 0) return { tokens, ...(Number.isFinite(window) && window > 0 ? { window } : {}) };
      } catch { /* Ignore incomplete or invalid JSONL. */ }
    }
  } catch { return null; }
  finally { await handle?.close(); }
  return null;
}
