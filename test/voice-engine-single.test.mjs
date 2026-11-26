import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleVoice, shutdownVoice } from '../integrations/voice.mjs';

// Fake engine: records one line per process start, then answers "ready".
const ENGINE = String.raw`
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
appendFileSync(process.argv[2], process.pid + '\n');
console.log(JSON.stringify({ ready: true }));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  console.log(JSON.stringify({ id: request.id, result: { text: '', confirmed: '', partial: '' } }));
}
`;

test('precargas simultáneas comparten un solo motor (sin modelos huérfanos en la GPU)', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-voice-single-'));
  t.after(async () => { await shutdownVoice(); await rm(root, { recursive: true, force: true }); });
  const cwd = path.join(root, 'project'), dataDir = path.join(root, 'data');
  await mkdir(cwd); await mkdir(path.join(dataDir, 'voice-runtime'), { recursive: true });
  const engine = path.join(root, 'engine.mjs'), starts = path.join(root, 'starts.log');
  await writeFile(engine, ENGINE);
  const config = { schemaVersion: 1, engine: 'faster-whisper', model: 'fake', device: 'cpu', computeType: 'int8',
    argv: [process.execPath, engine, '{input}', '{outputDir}'], streamArgv: [process.execPath, engine, starts] };
  await writeFile(path.join(dataDir, 'voice-runtime', 'config.json'), JSON.stringify(config), { mode: 0o600 });
  const workspace = { id: randomUUID(), canonicalPath: cwd };
  const context = { dataDir, state: { settings: { voiceFillers: 'keep' } }, workspace, getWorkspace: id => (id === workspace.id ? workspace : null) };
  const warm = () => handleVoice('voice.stream.warm', { workspaceId: workspace.id }, context);
  const results = await Promise.all([warm(), warm(), warm()]);
  for (const out of results) assert.deepEqual(out.result, { ready: true });
  const pids = (await readFile(starts, 'utf8')).split('\n').filter(Boolean);
  assert.equal(pids.length, 1, `se lanzaron ${pids.length} motores para la misma configuración`);
});
