import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { killElectronGroup } from './support/electron-process.mjs';

// Design review captures: production Electron + real host on an isolated
// profile with a synthetic project. Usage: node test/design-capture.mjs <label>
// Writes /tmp/opencode/design-<label>-<scene>.png. Run `npm run build` first.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] || 'now';
const evidence = '/tmp/opencode';
await mkdir(evidence, { recursive: true });
const temp = await mkdtemp(path.join(evidence, 'phantom-design-'));
const profile = path.join(temp, 'profile');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('PHANTOM_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV'].includes(key)) delete env[key];
}
Object.assign(env, {
  PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath,
  HOME: temp, XDG_CONFIG_HOME: path.join(temp, 'config'),
  XDG_DATA_HOME: path.join(temp, 'data'), XDG_STATE_HOME: path.join(temp, 'state'),
  XDG_CACHE_HOME: path.join(temp, 'cache'), SHELL: '/bin/sh',
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], captures = [];
let paintFailed = false;

// Electron screenshots are non-interlaced, 8-bit RGB/RGBA PNGs. Reconstruct
// every row before measuring the rail, including pixels outside the crop
// that the PNG predictors depend on.
function railLuminanceDeviation(png) {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG signature');
  let width, height, channels;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error('Truncated PNG chunk');
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const end = offset + 8 + length;
    if (end + 4 > png.length) throw new Error('Truncated PNG data');
    const data = png.subarray(offset + 8, end);
    if (type === 'IHDR') {
      if (length !== 13 || data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('Expected non-interlaced 8-bit RGB/RGBA PNG');
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') chunks.push(data);
    offset = end + 4;
    if (type === 'IEND') break;
  }
  if (!width || !height || !channels || !chunks.length) throw new Error('Missing PNG image data');
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(chunks));
  if (raw.length !== (stride + 1) * height) throw new Error('Unexpected PNG scanline length');
  let previous = Buffer.alloc(stride), row = Buffer.alloc(stride);
  let count = 0, mean = 0, squaredDeviations = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    if (filter > 4) throw new Error(`Unsupported PNG row filter: ${filter}`);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      row[x] = (raw[start + 1 + x] + predictor) & 255;
    }
    if (y >= 100 && y < Math.min(640, height)) {
      for (let x = 30; x < Math.min(300, width); x++) {
        const i = x * channels;
        const luminance = 0.2126 * row[i] + 0.7152 * row[i + 1] + 0.0722 * row[i + 2];
        const delta = luminance - mean;
        mean += delta / ++count;
        squaredDeviations += delta * (luminance - mean);
      }
    }
    [previous, row] = [row, previous];
  }
  if (!count) throw new Error('Rail region is outside the image');
  return Math.sqrt(squaredDeviations / count);
}

let app, appProcess, page, host;
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const shot = async scene => {
  await delay(700);
  const file = path.join(evidence, `design-${label}-${scene}.png`);
  // The desktop applies an interface zoom; a Playwright screenshot would crop
  // the window to its unzoomed size and lose the dock. Capture what Electron paints.
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(file, Buffer.from(png, 'base64'));
  captures.push(file);
  try {
    const deviation = railLuminanceDeviation(await readFile(file));
    if (!(deviation >= 8)) throw new Error(`rail luminance standard deviation ${deviation.toFixed(3)} < 8`);
  } catch (error) {
    paintFailed = true;
    const message = `${scene}: ${error.message}`;
    errors.push(message);
    console.error(message);
  }
};

try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
  appProcess = app.process();
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(580, 500);
    win.setContentSize(1520, 980);
  });
  const zoomFactor = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  await page.waitForFunction(expected => Math.abs(innerWidth - expected) <= 1, Math.round(1520 / zoomFactor));
  const project = path.join(temp, 'taller-fantasma');
  await mkdir(project);
  await invoke('workspace.open', { path: project });
  await page.reload();
  await page.locator('.canvas:not(.welcome-canvas)').waitFor();
  await shot('empty');

  const create = page.getByRole('toolbar', { name: 'Crear panel' });
  const toMap = async () => { const back = page.getByRole('button', { name: /Volver al mapa/ }); if (await back.count()) await back.first().click(); await delay(500); };
  await create.getByRole('button', { name: /Terminal/ }).first().click();
  await page.locator('.canvas-node').first().waitFor();
  await shot('focus');
  await toMap();
  await create.getByRole('button', { name: /Nota/ }).first().click();
  await page.locator('.canvas-node').nth(1).waitFor();
  await toMap();
  await page.keyboard.press('Shift+1').catch(() => {});
  await shot('map-selected');
  await page.mouse.click(1440, 300);
  await shot('map-rest');
  const notch = page.locator('.activity-notch').first();
  if (await notch.count()) { await notch.click(); await shot('tray'); }
  if (paintFailed) process.exitCode = 1;
  console.log(JSON.stringify({ label, captures, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, `design-${label}-failure.png`) }).catch(() => {});
  console.error(JSON.stringify({ label, captures, errors, error: error.message }));
  process.exitCode = 1;
} finally {
  try {
    if (host) {
      const command = await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '');
      if (command.includes(profile)) {
        await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2500)]);
        try { process.kill(host, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  } finally {
    if (app) await Promise.race([app.close().catch(() => {}), delay(2500)]);
    killElectronGroup(appProcess);
    await rm(temp, { recursive: true, force: true });
  }
}
