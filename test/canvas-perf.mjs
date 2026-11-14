// Canvas frame-time benchmark: N terminals streaming output while the map pans
// and zooms. Usage: node test/canvas-perf.mjs [--root DIR] [--renderer dom|webgl] [--terminals 6]
// Headless Electron uses software GL, so treat absolute numbers as relative.
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { killElectronGroup } from './support/electron-process.mjs';

const { values } = parseArgs({ options: { root: { type: 'string' }, renderer: { type: 'string', default: 'dom' }, terminals: { type: 'string', default: '6' } } });
const root = path.resolve(values.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const count = Number(values.terminals);
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/phantom-perf-');
const folder = path.join(temp, 'Perf fixture');
await mkdir(folder);
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile'), PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let hostPid, sessions = [], invoke;
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
  await page.locator('.app-shell').waitFor();
  hostPid = (await invoke('system.info')).pid;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
  await page.evaluate(renderer => localStorage.setItem('phantom.terminalRenderer', renderer), values.renderer);
  const workspace = await invoke('workspace.open', { path: folder });
  await page.reload();
  await page.locator('.app-shell').waitFor();
  for (let i = 0; i < count; i++) {
    await page.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.waitForFunction(n => document.querySelectorAll('.status-dot.running').length >= n, i + 1);
  }
  sessions = await invoke('terminal.list', { workspaceId: workspace.id });
  // Continuous colored output in every terminal.
  for (const s of sessions) await invoke('terminal.write', { sessionId: s.id, data: "while :; do printf '\\033[3%dm%s line %06d \\033[0m%s\\n' $((RANDOM%7+1)) \"$(date +%T.%N)\" $RANDOM 'lorem ipsum dolor sit amet consectetur adipiscing elit'; done\r" });
  const canvas = page.locator('.canvas');
  await page.keyboard.press('Escape');
  await canvas.focus();
  await page.keyboard.press('0');
  await delay(800);
  const box = await canvas.boundingBox();
  const zoomText = await page.locator('.zoom-value').innerText();
  await page.evaluate(() => {
    window.__perf = { frames: [], long: [] };
    let last = performance.now();
    const tick = now => { window.__perf.frames.push(now - last); last = now; if (!window.__perf.stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    new PerformanceObserver(list => list.getEntries().forEach(e => window.__perf.long.push(e.duration))).observe({ entryTypes: ['longtask'] });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const before = await metrics();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .2);
  const started = Date.now();
  let phase = 0;
  while (Date.now() - started < 6000) {
    phase++;
    if (phase % 40 < 20) await page.mouse.wheel(phase % 80 < 40 ? 14 : -14, 6);
    else { await page.keyboard.down('Control'); await page.mouse.wheel(0, phase % 80 < 60 ? 8 : -8); await page.keyboard.up('Control'); }
    await delay(8);
  }
  const result = await page.evaluate(() => {
    window.__perf.stop = true;
    const f = window.__perf.frames.slice(5).sort((a, b) => a - b);
    const sum = f.reduce((a, b) => a + b, 0);
    return { frames: f.length, avgMs: +(sum / f.length).toFixed(1), fps: +(1000 * f.length / sum).toFixed(1), p95Ms: +f[Math.floor(f.length * .95)].toFixed(1), over50ms: f.filter(x => x > 50).length, longTasks: window.__perf.long.length, longTaskMs: Math.round(window.__perf.long.reduce((a, b) => a + b, 0)) };
  });
  const after = await metrics();
  const cost = Object.fromEntries(['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'].map(k => [k.replace('Duration', 'Ms'), Math.round((after[k] - before[k]) * 1000)]));
  cost.LayoutCount = after.LayoutCount - before.LayoutCount; cost.RecalcStyleCount = after.RecalcStyleCount - before.RecalcStyleCount;
  const canvases = await page.locator('.terminal-host canvas').count();
  console.log(JSON.stringify({ root, renderer: values.renderer, terminals: count, fitZoom: zoomText.replace(/\s/g, ''), webglCanvases: canvases, ...result, ...cost }));
} finally {
  // Output loops never exit on their own: interrupt them, then don't let close hang.
  for (const s of sessions) await invoke?.('terminal.write', { sessionId: s.id, data: '\u0003exit\r' }).catch(() => {});
  await Promise.race([app.close().catch(() => {}), delay(5000)]);
  killElectronGroup(app.process());
  if (hostPid) try { process.kill(hostPid, 'SIGKILL'); } catch {}
}
