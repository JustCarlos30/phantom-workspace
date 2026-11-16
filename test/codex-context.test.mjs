import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { codexRolloutPath, codexContextReading } from '../host/codex-context.mjs';

const count = info => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info } }) + '\n';
test('Codex localiza sesiones antiguas y lee la última medición válida de la cola', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-context-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'sessions', '2025', '01', '02'), id = 'session-12345678';
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `rollout-date-${id}.jsonl`);
  await fs.writeFile(file, 'x'.repeat(1024 * 1024 + 30) + '\n' + count({ last_token_usage: { total_tokens: 144871 }, model_context_window: 258400 }) + count(null) + '{invalid}\n');
  assert.equal(await codexRolloutPath(id, home), file);
  assert.deepEqual(await codexContextReading(file), { tokens: 144871, window: 258400 });
  for (const window of [undefined, NaN, -1, 0]) {
    await fs.writeFile(file, count({ last_token_usage: { total_tokens: 42 }, model_context_window: window }) + count({ last_token_usage: { total_tokens: -1 } }));
    assert.deepEqual(await codexContextReading(file), { tokens: 42 });
  }
  await fs.writeFile(file, count(null) + count({ last_token_usage: { total_tokens: 0 } }));
  assert.equal(await codexContextReading(file), null);
  assert.equal(await codexContextReading(path.join(home, 'missing')), null);
  assert.equal(await codexRolloutPath('missing-session', home), null);
  for (const id of ['../escape', 'short', 'x'.repeat(81), null]) assert.equal(await codexRolloutPath(id, home), null);
});
