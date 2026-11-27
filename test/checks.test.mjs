import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../host/checks.mjs';

test('integration checks run one suite at a time across the host', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-checks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Each run fails if another one holds the lock file while it starts.
  const command = 'if [ -e lock ]; then exit 3; fi; touch lock; sleep 0.2; rm lock';
  const results = await Promise.all([runChecks(dir, command), runChecks(dir, command), runChecks(dir, command)]);
  assert.deepEqual(results.map(result => result.ok), [true, true, true]);
  const failed = await runChecks(dir, 'exit 1');
  assert.equal(failed.ok, false);
  assert.equal((await runChecks(dir, 'true')).ok, true, 'a failed run does not block the next one');
});
