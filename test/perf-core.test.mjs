import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { parseArgs, summarize, runBenchmark, compareReports, SCHEMA_VERSION } from './perf-core.mjs';

test('summarize calcula p50/p95/max y usa null con motivo sin muestras', () => {
  const s = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual([s.count, s.p50, s.p95, s.max, s.min], [100, 50, 95, 100, 1]);
  const empty = summarize([]);
  assert.equal(empty.count, 0); assert.equal(empty.p50, null); assert.ok(empty.reason);
  assert.throws(() => summarize([1, NaN]), TypeError);
  assert.throws(() => summarize([Infinity]), TypeError);
});

test('parseArgs valida parámetros y aplica presets acotados', () => {
  assert.equal(parseArgs(['--quick']).samples < parseArgs([]).samples, true);
  assert.equal(parseArgs(['--samples', '10']).samples, 10);
  for (const bad of [['--nope'], ['--samples'], ['--samples', 'x'], ['--repetitions', '0'], ['--repetitions', '999'], ['--compare', 'a.json']])
    assert.throws(() => parseArgs(bad), Error, bad.join(' '));
});

test('importar el módulo no crea archivos ni ejecuta el benchmark', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('pw-perf-core-')).length;
  await import('./perf-core.mjs');
  assert.equal(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('pw-perf-core-')).length, before);
});

test('ejecución quick aislada produce JSON válido, métricas finitas y limpia fixtures', async () => {
  const count = () => fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('pw-perf-core-')).length;
  const before = count();
  const report = JSON.parse(JSON.stringify(await runBenchmark({ quick: true, repetitions: 1, samples: 8, warmup: 2 })));
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(report.scenarios.map(s => s.name), ['small', 'heavy']);
  assert.equal(report.scenarios[1].projects, 5); assert.equal(report.scenarios[1].nodesPerProject, 170);
  for (const s of report.scenarios) {
    for (const m of ['transactionMs', 'flushMs']) {
      assert.equal(s[m].count, 8);
      for (const k of ['p50', 'p95', 'max']) assert.ok(Number.isFinite(s[m][k]) && s[m][k] >= 0);
      assert.ok(s[m].p50 <= s[m].p95 && s[m].p95 <= s[m].max);
    }
    assert.ok(s.persistedStateBytes > 0);
    assert.ok(Number.isFinite(s.cpu.userMicros));
    assert.ok(s.rss.maxSnapshotBytes >= s.rss.startBytes && /NO es el pico/.test(s.rss.scope));
    assert.ok(s.eventLoopDelayMs.count === 0 ? s.eventLoopDelayMs.reason && s.eventLoopDelayMs.p50 === null : Number.isFinite(s.eventLoopDelayMs.p95));
  }
  assert.ok(report.scenarios[1].persistedStateBytes > report.scenarios[0].persistedStateBytes);
  assert.ok(report.environment.node && report.date && report.config.warmup === 2);
  assert.equal(count(), before, 'fixtures temporales eliminados');
  const cmp = compareReports(report, report);
  assert.equal(cmp['heavy.transactionMs'].ratio, 1);
  assert.throws(() => compareReports({ schemaVersion: 0 }, report));
});
