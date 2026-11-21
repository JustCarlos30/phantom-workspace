import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import { killElectronGroup } from './support/electron-process.mjs';

// Design review captures: production Electron + real host on an isolated
// profile with a synthetic project. Usage: node test/design-capture.mjs <label>
// Builds this worktree explicitly; captures HEAD (before) and the working tree
// (after) with the same scenes and isolated profiles.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedLabel = process.argv[2] || 'now';
let activeProcess, activeHost;
const deadline = setTimeout(() => {
  killElectronGroup(activeProcess);
  if (activeHost) { try { process.kill(activeHost, 'SIGTERM'); } catch {} }
  console.error('Design capture exceeded 270 seconds');
  process.exit(1);
}, 270000);

async function capture(label, standardized) {
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
function railLuminanceDeviation(png, rail) {
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
  const left = Math.max(0, Math.ceil(rail.left * width / rail.viewportWidth));
  const right = Math.min(width, Math.floor(rail.right * width / rail.viewportWidth));
  const top = Math.max(0, Math.ceil(rail.top * height / rail.viewportHeight));
  const bottom = Math.min(height, Math.floor(rail.bottom * height / rail.viewportHeight));
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
    if (y >= top && y < bottom) {
      for (let x = left; x < right; x++) {
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
  if (standardized) await page.evaluate(() => {
    for (const el of document.querySelectorAll('.project-rail,.canvas-node,.inspector-host,.activity-dock,.canvas-navigation,.context-menu-panel,.pc-models')) {
      if (!el.getClientRects().length) continue;
      const style = getComputedStyle(el), ring = getComputedStyle(el, '::before');
      if (style.backgroundColor !== 'rgb(11, 11, 12)' || style.backgroundImage !== 'linear-gradient(rgb(15, 15, 17), rgb(7, 7, 8))') throw new Error(`Missing object material: ${el.className}`);
      if (style.backdropFilter !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some(side => style[`border${side}Width`] !== '0px')) throw new Error(`Blur or extra edge: ${el.className}`);
      if (ring.content === 'none' || ring.maskComposite !== 'exclude' || ring.pointerEvents !== 'none' || ring.zIndex !== '3') throw new Error(`Missing non-interactive masked ring: ${el.className}`);
      if (el.matches('.canvas-node.selected') && style.outlineWidth !== '0px') throw new Error('Selection has a second contour');
    }
  });
  const rail = await page.locator('.project-rail').evaluate(el => {
    const { left, right, top, bottom } = el.getBoundingClientRect();
    return { left, right, top, bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  const file = path.join(evidence, `design-${label}-${scene}.png`);
  // The desktop applies an interface zoom; a Playwright screenshot would crop
  // the window to its unzoomed size and lose the dock. Capture what Electron paints.
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(file, Buffer.from(png, 'base64'));
  captures.push(file);
  try {
    const deviation = railLuminanceDeviation(await readFile(file), rail);
    if (!(deviation >= 8)) throw new Error(`rail luminance standard deviation ${deviation.toFixed(3)} < 8`);
  } catch (error) {
    if (scene === 'space-menu' || scene === 'model-menu') {
      console.log(`${scene}: ${error.message}`);
      return;
    }
    paintFailed = true;
    const message = `${scene}: ${error.message}`;
    errors.push(message);
    console.error(message);
  }
};

try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env, timeout: 20000 });
  activeProcess = appProcess = app.process();
  page = await app.firstWindow({ timeout: 10000 });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  if (await page.locator('body').innerText() === 'Not found') {
    throw new Error(`Electron could not load the local build: ${page.url()}`);
  }
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  const hostCommand = await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '');
  if (hostCommand.includes(profile)) activeHost = host;
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
  // State language on one screen. The classes are the ones the app sets from
  // real activity; here they are forced so the colours can be reviewed without
  // waiting for an agent to work, ask or fail.
  await page.evaluate(() => {
    const row = document.querySelector('.rail-session');
    const variant = (title, status, tone, needs, selected = false) => {
      const copy = row.cloneNode(true), inner = copy.querySelector('.rail-session-row');
      inner.classList.toggle('selected', selected); inner.classList.toggle('needs-you', needs);
      const button = inner.querySelector('button');
      if (selected) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
      button.setAttribute('aria-label', `Estado sintético: ${title}`);
      const heading = copy.querySelector('.rail-panel-label > span');
      heading.textContent = `Sintético: ${title}`;
      heading.title = heading.textContent;
      const meta = copy.querySelector('.rail-session-meta');
      const statusLabel = meta.querySelector('.rail-session-status');
      if (!statusLabel) throw new Error('Missing current rail-session-status markup');
      statusLabel.textContent = status;
      const details = meta.querySelector('.rail-session-details');
      if (!details) throw new Error('Missing current rail-session-details markup');
      details.textContent = ' · Terminal · fixture de metadatos largos';
      copy.querySelector('.rail-session-dot').className = `rail-session-dot ${tone}`;
      copy.querySelector('.rail-session-resources')?.remove();
      row.parentNode.append(copy);
    };
    variant('Trabajo', 'Trabajando', 'working', false);
    variant('Permiso', 'Pide permiso', 'warning', true);
    variant('Permiso seleccionado', 'Pide permiso', 'warning', true, true);
    const attention = document.querySelector('.rail-attention');
    attention.classList.add('needs-you');
    attention.querySelector('span').textContent = 'Te necesitan';
    const count = attention.querySelector('b');
    if (count) count.textContent = '2';
    else attention.insertAdjacentHTML('beforeend', '<b>2</b>');
    attention.title = 'Estado sintético: dos permisos pendientes';
    const notch = document.querySelector('.activity-notch');
    notch.classList.add('needs-you');
    notch.querySelector('strong').textContent = 'Sintético: 2 te necesitan';
    document.querySelector('.attention-button').insertAdjacentHTML('beforeend', '<i></i>');
  });
  await page.locator('.rail-session-status').evaluateAll(elements => {
    for (const el of elements) {
      if (getComputedStyle(el).fontSize !== '12px') throw new Error('Status must use 12px type');
      const rect = el.getBoundingClientRect();
      const parent = el.closest('.rail-panel-label').getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth || rect.right > parent.right + 1 || rect.bottom > parent.bottom + 1) throw new Error(`Clipped status: ${el.textContent}`);
    }
  });
  await shot('synthetic-states');
  await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.id = 'color-fixture';
    fixture.setAttribute('aria-label', 'Estados sintéticos de color');
    Object.assign(fixture.style, { position: 'fixed', left: '360px', top: '120px', width: '520px', padding: '24px', background: 'var(--surface)', zIndex: '1000', display: 'grid', gap: '16px' });
    fixture.innerHTML = `<h2>Sintético · Atención</h2>
      <div class="pt-card" data-agent="approval"><span class="pt-state is-approval">Pide permiso</span><div class="pt-card-screen"><pre>Pozo de terminal · permiso pendiente</pre></div><button class="pt-card-action is-primary">Revisar permiso</button></div>
      <div class="pt-card" data-agent="turn"><span class="pt-state is-turn">Tu turno</span></div>
      <div class="pt-card"><span class="pt-state is-blocked">Bloqueado</span> <span class="pt-state is-review">En revisión</span></div>
      <span class="br-chip" data-tone="attention">Revisar rama</span>
      <span class="rp-pill" data-tone="attention">Revisión pendiente</span>
      <span class="inc-chip" style="--tone: var(--attention)">Pendiente de incorporación</span>
      <div class="activity-tray" style="position: static; width: auto"><span class="activity-item-icon" data-ink="attention">!</span></div>
      <button class="inc-switch" role="switch" aria-label="Switch sintético de incorporación" aria-checked="true"><i></i></button>`;
    document.body.append(fixture);
  });
  if (standardized) await page.locator('#color-fixture').evaluate(fixture => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const assertNeutral = value => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      if (Math.max(...rgb) - Math.min(...rgb) > 1) throw new Error(`Non-neutral state surface: ${value}`);
    };
    for (const el of fixture.querySelectorAll('.pt-state, .br-chip, .rp-pill, .inc-chip, .activity-item-icon')) {
      const style = getComputedStyle(el);
      assertNeutral(style.backgroundColor);
      if (style.color !== 'rgb(245, 192, 74)') throw new Error(`Missing attention ink: ${el.className} ${style.color}`);
      if (style.boxShadow !== 'none') throw new Error(`State ring: ${el.className}`);
    }
    for (const el of fixture.querySelectorAll('.pt-card-screen')) {
      const style = getComputedStyle(el);
      assertNeutral(style.backgroundColor);
      if (style.backgroundImage !== 'none') throw new Error('Attention well must have no wash');
      if (style.boxShadow !== 'none') throw new Error('Attention well must have no ring');
      if (style.borderTopColor !== 'rgba(0, 0, 0, 0)') throw new Error('Attention well must have no coloured edge');
    }
    const action = getComputedStyle(fixture.querySelector('.pt-card-action'));
    if (action.backgroundColor !== 'rgb(242, 240, 235)' || action.color !== 'rgb(20, 20, 20)') throw new Error('Attention action must be ivory/dark');
    const toggle = fixture.querySelector('.inc-switch');
    if (getComputedStyle(toggle).backgroundColor !== 'rgb(242, 240, 235)' || getComputedStyle(toggle.querySelector('i')).backgroundColor !== 'rgb(20, 20, 20)') throw new Error('Incorporation switch must be ivory/dark');
  });
  await shot('attention');
  await page.locator('#color-fixture').evaluate(el => el.remove());
  await page.reload();
  await page.locator('.canvas-node').first().waitFor();
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('navigation', { name: 'Categorías de configuración' }).waitFor();
  if (standardized) await page.locator('.st-ico').evaluateAll(icons => {
    if (icons.length !== 8) throw new Error('Expected all eight settings categories');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    for (const icon of icons) {
      const style = getComputedStyle(icon);
      for (const value of [style.backgroundColor, style.color]) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        if (Math.max(...rgb) - Math.min(...rgb) > 8) throw new Error(`Non-neutral category: ${value}`);
      }
    }
  });
  await shot('settings-categories');
  await page.getByRole('button', { name: 'Apariencia', exact: true }).click();
  const gridSwitch = page.getByRole('switch', { name: 'Retícula de puntos', exact: true });
  await gridSwitch.scrollIntoViewIfNeeded();
  if (standardized) await gridSwitch.evaluate(el => {
    if (el.getAttribute('aria-checked') !== 'true') throw new Error('Expected enabled grid in isolated profile');
    if (getComputedStyle(el).backgroundColor !== 'rgb(242, 240, 235)' || getComputedStyle(el.querySelector('i')).backgroundColor !== 'rgb(20, 20, 20)') throw new Error('Active switch must be ivory/dark');
  });
  await shot('settings-switches');
  await page.getByRole('button', { name: 'Cerrar configuración', exact: true }).click();
  try {
    await page.locator('.space-switcher-trigger').click();
    await page.waitForTimeout(450);
    await shot('space-menu');
    await page.keyboard.press('Escape');
  } catch (error) { console.log('space-menu:', error.message); }
  try {
    await page.locator('.pc-model').first().click({ force: true });
    await page.waitForTimeout(450);
    await shot('model-menu');
    await page.keyboard.press('Escape');
  } catch (error) { console.log('model-menu:', error.message); }
  const notch = page.locator('.activity-notch').first();
  if (await notch.count()) { await notch.click(); await shot('tray'); }
   if (paintFailed || errors.length) throw new Error(`Design capture failed: ${errors.join('; ')}`);
  console.log(JSON.stringify({ label, captures, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, `design-${label}-failure.png`), timeout: 2500 }).catch(() => {});
  console.error(JSON.stringify({ label, captures, errors, error: error.message }));
   throw error;
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
    activeProcess = activeHost = null;
    await rm(temp, { recursive: true, force: true });
  }
}
}

try {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
  console.log(JSON.stringify({ label: requestedLabel, beforeRevision: revision, root }));
  const rendererSources = new Map();
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, '--', 'src'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim().split('\n')
    .filter(file => file.endsWith('.css') || ['src/components/Settings.jsx', 'src/components/TerminalPanel.jsx', 'src/hooks/useAppearance.js'].includes(file));
  for (const file of files) rendererSources.set(path.join(root, file), execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, encoding: 'utf8', timeout: 10000 }));
  const localBuild = async plugins => {
    const result = await build({ root, configFile: path.join(root, 'vite.config.mjs'), plugins, build: { outDir: path.join(root, 'dist'), emptyOutDir: true, write: true } });
    await readFile(path.join(root, 'dist/index.html'));
    for (const bundle of [result].flat()) for (const asset of bundle.output) {
      const file = path.join(root, 'dist', asset.fileName);
      const expected = Buffer.from(asset.type === 'chunk' ? asset.code : asset.source);
      if (!(await readFile(file)).equals(expected)) throw new Error(`Local build artifact differs from Vite output: ${file}`);
    }
  };
  try {
    await localBuild([{ name: 'design-before', enforce: 'pre', load(id) { return rendererSources.get(id) ?? null; } }]);
    await capture(`${requestedLabel}-before`, false);
  } finally {
    await localBuild([]);
  }
  await capture(requestedLabel, true);
} finally {
  clearTimeout(deadline);
}
