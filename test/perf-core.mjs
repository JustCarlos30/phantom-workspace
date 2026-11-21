// Banco sintético del núcleo (Store real). No es end-to-end: sin UI, sockets, gateway, Docker ni procesos externos.
// Uso: node test/perf-core.mjs [--quick] [--repetitions N] [--samples N] [--warmup N] [--compare A.json B.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Store } from '../host/store.mjs';

export const SCHEMA_VERSION = 1;
export const SCALES = { small: { projects: 1, nodes: 20 }, heavy: { projects: 5, nodes: 170 } };
const PRESETS = { quick: { repetitions: 1, samples: 30, warmup: 5 }, default: { repetitions: 3, samples: 150, warmup: 20 } };
const LIMITS = { repetitions: [1, 10], samples: [5, 2000], warmup: [0, 500] };
const tick = () => new Promise(resolve => setImmediate(resolve));
const nsToMs = n => n / 1e6;

export function parseArgs(argv) {
  const opts = { quick: false, compare: null };
  const given = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') opts.quick = true;
    else if (a === '--compare') {
      const files = argv.slice(i + 1, i + 3);
      if (files.length !== 2 || files.some(f => f.startsWith('--'))) throw new Error('--compare requiere dos archivos JSON');
      opts.compare = files; i += 2;
    } else if (a === '--repetitions' || a === '--samples' || a === '--warmup') {
      const key = a.slice(2), raw = argv[++i];
      if (raw === undefined || !/^\d+$/.test(raw)) throw new Error(`${a} requiere un entero`);
      const n = Number(raw), [lo, hi] = LIMITS[key];
      if (n < lo || n > hi) throw new Error(`${a} fuera de rango (${lo}-${hi})`);
      given[key] = n;
    } else throw new Error(`Argumento desconocido: ${a}`);
  }
  return { ...opts, ...(opts.quick ? PRESETS.quick : PRESETS.default), ...given };
}

export function summarize(samples) {
  if (!Array.isArray(samples)) throw new TypeError('samples debe ser un arreglo');
  for (const s of samples) if (typeof s !== 'number' || !Number.isFinite(s)) throw new TypeError('muestra no finita');
  if (!samples.length) return { count: 0, p50: null, p95: null, max: null, min: null, mean: null, reason: 'sin muestras' };
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return { count: sorted.length, p50: rank(0.5), p95: rank(0.95), max: sorted.at(-1), min: sorted[0], mean: sorted.reduce((a, b) => a + b, 0) / sorted.length };
}

function buildFixture(root, scale) {
  const dir = path.join(root, 'data');
  const store = new Store(dir);
  for (let p = 0; p < scale.projects; p++) {
    const folder = path.join(root, `project-${p}`); fs.mkdirSync(folder);
    const w = store.open(folder);
    for (let i = 0; i < scale.nodes; i++) w.nodes.push({ id: randomUUID(), type: 'note', title: `Nota ${i}`, x: i * 10, y: p * 10, width: 400, height: 300, data: { text: 'n'.repeat(64) } });
  }
  store.persist(); store.flush();
  return { dir, store };
}

async function runScale(name, scale, opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-perf-core-'));
  let store, delay;
  try {
    const t0 = performance.now();
    ({ store } = buildFixture(root, scale));
    const dir = store.dir, file = path.join(dir, 'state.json');
    store.close(); store = undefined;
    const loadMs = [];
    const tl = performance.now(); store = new Store(dir); loadMs.push(performance.now() - tl);
    const setupMs = performance.now() - t0;
    const bump = i => { store.transaction(() => { store.state.workspaces[0].nodes[0].x = i; }); };
    // Warmup fuera de muestras.
    for (let i = 0; i < opts.warmup; i++) { bump(i); store.flush(); if (i % 5 === 0) await tick(); }

    const txMs = [], flushMs = [], rssSnaps = [process.memoryUsage().rss];
    delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
    const cpu0 = process.cpuUsage(), wall0 = performance.now();
    for (let i = 0; i < opts.samples; i++) {
      let a = performance.now(); bump(i + 1000); txMs.push(performance.now() - a);
      a = performance.now(); store.flush(); flushMs.push(performance.now() - a);
      // Cede el loop para que el histograma registre el retraso real de los timers.
      await tick();
      if (i % 10 === 0) rssSnaps.push(process.memoryUsage().rss);
    }
    await new Promise(r => setTimeout(r, 25));
    const wallMs = performance.now() - wall0, cpu = process.cpuUsage(cpu0);
    delay.disable();
    rssSnaps.push(process.memoryUsage().rss);
    const loopOk = delay.count > 0;
    return {
      name, projects: scale.projects, nodesPerProject: scale.nodes,
      persistedStateBytes: fs.statSync(file).size,
      loadMs: summarize(loadMs), setupMs,
      transactionMs: summarize(txMs), flushMs: summarize(flushMs),
      eventLoopDelayMs: loopOk
        ? { count: delay.count, p50: nsToMs(delay.percentile(50)), p95: nsToMs(delay.percentile(95)), max: nsToMs(delay.max), resolutionMs: 10, note: 'histograma de monitorEventLoopDelay durante la fase medida; incluye el retraso de timers de 10 ms' }
        : { count: 0, p50: null, p95: null, max: null, reason: 'el histograma no registró muestras' },
      cpu: { userMicros: cpu.user, systemMicros: cpu.system, wallMs, cpuToWallRatio: wallMs > 0 ? (cpu.user + cpu.system) / 1000 / wallMs : null, scope: 'proceso completo durante la fase medida' },
      rss: { startBytes: rssSnaps[0], endBytes: rssSnaps.at(-1), maxSnapshotBytes: Math.max(...rssSnaps), snapshots: rssSnaps.length, scope: 'snapshots del proceso en puntos de cesión; NO es el pico real' },
    };
  } finally {
    delay?.disable();
    try { store?.close(); } catch { /* limpieza best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runBenchmark(options = {}) {
  const opts = { ...PRESETS.default, ...options };
  const started = new Date();
  const scenarios = [];
  for (let rep = 1; rep <= opts.repetitions; rep++) for (const [name, scale] of Object.entries(SCALES)) scenarios.push({ repetition: rep, ...(await runScale(name, scale, opts)) });
  let maxRss = null, maxRssReason = null;
  try { const r = process.resourceUsage().maxRSS; if (Number.isFinite(r) && r > 0) maxRss = r * 1024; else maxRssReason = 'maxRSS no disponible'; } catch (e) { maxRssReason = e.message; }
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'phantom-perf-core',
    date: started.toISOString(),
    durationMs: Date.now() - started.getTime(),
    synthetic: true,
    config: { quick: !!opts.quick, repetitions: opts.repetitions, samples: opts.samples, warmup: opts.warmup, scales: SCALES },
    environment: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, os: os.release(), cpuModel: os.cpus()[0]?.model ?? null, cpuCount: os.cpus().length },
    processMaxRss: { bytes: maxRss, reason: maxRssReason, scope: 'pico del proceso Node completo desde su inicio (incluye import y fixtures), no solo una fase' },
    scenarios,
  };
}

// Compara p50 de dos reportes por escala: ratio = b/a. Sin umbrales; la lectura es del usuario.
export function compareReports(a, b) {
  if (a?.schemaVersion !== SCHEMA_VERSION || b?.schemaVersion !== SCHEMA_VERSION) throw new Error('schemaVersion incompatible');
  const med = (r, scale, metric) => summarize(r.scenarios.filter(s => s.name === scale).map(s => s[metric].p50).filter(Number.isFinite)).p50;
  const out = {};
  for (const scale of Object.keys(SCALES)) for (const metric of ['transactionMs', 'flushMs', 'loadMs']) {
    const x = med(a, scale, metric), y = med(b, scale, metric);
    out[`${scale}.${metric}`] = { a: x, b: y, ratio: x && y !== null ? y / x : null, reason: x ? undefined : 'sin datos en A' };
  }
  return out;
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.compare) { const [a, b] = opts.compare.map(f => JSON.parse(fs.readFileSync(f, 'utf8'))); console.log(JSON.stringify(compareReports(a, b), null, 2)); return; }
    console.log(JSON.stringify(await runBenchmark(opts), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
