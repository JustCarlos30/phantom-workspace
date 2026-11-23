import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
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
const errors = [], captures = [], observations = [];
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
      const fillProbe = document.createElement('div'); el.append(fillProbe);
      fillProbe.style.position = 'absolute';
      fillProbe.style.backgroundImage = 'var(--object-fill)';
      const expectedFill = getComputedStyle(fillProbe).backgroundImage;
      fillProbe.remove();
      if (style.backgroundColor !== 'rgb(11, 11, 12)' || style.backgroundImage !== expectedFill) throw new Error(`Missing object material: ${el.className}`);
      if (style.backdropFilter !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some(side => style[`border${side}Width`] !== '0px')) throw new Error(`Blur or extra edge: ${el.className}`);
      const probe = document.createElement('div'); el.append(probe);
      probe.style.position = 'absolute';
      probe.style.backgroundImage = el.matches('.canvas-node.selected')
        ? 'linear-gradient(var(--selected-edge-top), var(--selected-edge-bottom))'
        : 'linear-gradient(var(--object-edge-top), var(--object-edge-bottom))';
      if (el.matches('.canvas-node[data-panel-state="attention"]')) probe.style.background = 'var(--attention-ring)';
      probe.style.mask = 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)';
      probe.style.maskComposite = 'exclude';
      const expected = getComputedStyle(probe);
      const maskProperties = ['maskImage', 'maskClip', 'maskOrigin', 'maskComposite'];
      const invalidRing = ['none', 'normal'].includes(ring.content) || ring.display === 'none'
        || ring.visibility !== 'visible' || ring.opacity !== '1'
        || ring.position !== 'absolute' || ring.pointerEvents !== 'none' || ring.zIndex !== '3'
         || ring.backgroundImage !== expected.backgroundImage || ring.backgroundColor !== expected.backgroundColor || ring.borderRadius !== style.borderRadius
        || maskProperties.some(property => ring[property] !== expected[property])
        || ['top', 'right', 'bottom', 'left'].some(side => ring[side] !== '0px')
        || ['Top', 'Right', 'Bottom', 'Left'].some(side => !(Math.abs(parseFloat(ring[`padding${side}`]) - (el.matches('.overview') ? Number(style.getPropertyValue('--ov')) : 1)) <= .01));
      const mask = Object.fromEntries(maskProperties.map(property => [property, { actual: ring[property], expected: expected[property] }]));
      probe.remove();
      if (invalidRing) throw new Error(`Missing non-interactive masked ring: ${el.className} ${JSON.stringify(mask)}`);
      if (el.matches('.canvas-node.selected') && style.outlineWidth !== '0px') throw new Error('Selection has a second contour');
      if (el.matches('.canvas-node')) {
        const label = el.querySelector('.node-header > .panel-state');
        if (!label?.getClientRects().length || !label.textContent) throw new Error('Missing header state');
        if (el.dataset.panelState === 'working') {
          const rects = [...el.querySelectorAll('.activity-trace rect')];
          if (rects.length !== 5 || rects.some(rect => rect.getAttribute('pathLength') !== '100' || getComputedStyle(rect).strokeWidth !== '1.5px' || getComputedStyle(rect).filter !== 'none')) throw new Error('Invalid comet A');
        } else if (el.querySelector('.activity-trace')) throw new Error('Only work has a comet');
      }
    }
    if (document.querySelector('.pixel-field')) throw new Error('Exterior panel waves are mounted');
    const identities = [...document.querySelectorAll('[data-identity]')];
    if (identities.length > 1) throw new Error('Repeated scene identity');
    if (document.querySelector('img[src*="gengar"], .brand .titi-ghost, .phantom-chat-mark .titi-ghost, .phantom-chat-empty .titi-ghost')) throw new Error('Retired or duplicate identity');
    if (getComputedStyle(document.querySelector('.canvas-region'), '::after').backgroundImage !== 'none') throw new Error('Repeated background identity');
    for (const glyph of document.querySelectorAll('[data-operation-glyph="titi"]')) if (glyph.dataset.motion !== 'stopped') throw new Error('Operational glyph has a decorative loop');
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
  app = await electron.launch({ args: [root, '--ozone-platform=headless', '--autoplay-policy=no-user-gesture-required'], cwd: root, env, timeout: 20000 });
  activeProcess = appProcess = app.process();
  page = await app.firstWindow({ timeout: 10000 });
  page.setDefaultTimeout(10000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
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
  if (standardized) {
    await page.getByRole('button', { name: 'Configuración', exact: true }).click();
    await page.getByRole('button', { name: 'Apariencia', exact: true }).click();
    await page.getByRole('switch', { name: 'Mostrar Titi', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar configuración', exact: true }).click();
    assert.equal(await page.locator('[data-identity="hero"]').count(), 1);
    assert.equal(await page.locator('[data-identity]').count(), 1);
    await page.waitForFunction(() => document.querySelector('[data-identity]')?.dataset.motion === 'stopped');
  }
  await shot('empty');

  const create = page.getByRole('toolbar', { name: 'Crear panel' });
  const toMap = async () => { const back = page.getByRole('button', { name: /Volver al mapa/ }); if (await back.count()) await back.first().click(); await delay(500); };
   await create.locator('button[data-type="terminal"]').click();
  await page.locator('.canvas-node').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.create-dock button[data-type="terminal"]')?.disabled);
  if (!await page.locator('.canvas-node.focused').count()) await page.locator('.canvas-node').first().getByRole('button', { name: 'Enfocar panel', exact: true }).click();
  await shot('focus');
  await toMap();
  await create.getByRole('button', { name: /Nota/ }).first().click();
  await page.locator('.canvas-node').nth(1).waitFor();
  await toMap();
  await page.keyboard.press('Shift+1').catch(() => {});
  await shot('map-selected');
  await page.mouse.click(1440, 300);
  await shot('map-rest');
  if (standardized) {
    assert.equal(await page.locator('[data-identity]').count(), 1);
    assert.equal(await page.locator('.activity-dock [data-identity="dock"]').count(), 1);
  }
  const state = await invoke('state.get'), workspaceId = state.activeWorkspaceId;
  const originalNodes = state.workspaces.find(workspace => workspace.id === workspaceId).nodes;
  const stateNodes = [], chats = {};
  for (const [index, panelState] of ['working', 'attention', 'finished', 'error', 'rest'].entries()) {
    const node = await invoke('node.create', { workspaceId, type: 'terminal', title: `Sintético · ${panelState}`, x: index % 3 * 450, y: Math.floor(index / 3) * 310, width: 418, height: 280, data: { chat: { provider: 'claude' } } });
    stateNodes.push({ ...node, panelState });
    chats[node.id] = { provider: 'claude', running: ['working', 'attention'].includes(panelState), queue: [], meta: {}, messages: panelState === 'rest' ? [] : [
      { id: `${node.id}-reply`, role: 'assistant', status: panelState === 'error' ? 'error' : panelState === 'finished' ? 'done' : 'streaming', createdAt: new Date().toISOString(), parts: [
        { type: 'text', text: `SYNTHETIC · ${panelState}. Fixture visual sin ejecutar proveedor.` },
        ...(panelState === 'attention' ? [{ id: 'permission', type: 'permission', status: 'pending', tool: 'Edit', input: { file_path: 'synthetic.txt' } }] : []),
      ] },
    ] };
  }
  await app.evaluate(({ ipcMain }, chats) => {
    const original = ipcMain._invokeHandlers?.get('phantom:invoke');
    if (!original) throw new Error('Electron IPC fixture seam unavailable');
    globalThis.designFixture = { original, chats };
    ipcMain.removeHandler('phantom:invoke');
    ipcMain.handle('phantom:invoke', (event, method, payload = {}) => {
      if (method === 'chat.get' && chats[payload.nodeId]) return chats[payload.nodeId];
      if (method === 'chat.models') return { items: [], note: 'SYNTHETIC' };
      if (chats[payload.nodeId] && method.startsWith('chat.')) throw new Error(`Visual fixture cannot execute ${method}`);
      return original(event, method, payload);
    });
  }, chats);
  for (const node of originalNodes) await invoke('node.update', { workspaceId, id: node.id, patch: { data: { ...node.data, hidden: true } } });
  await page.reload(); await page.locator('.canvas-node').first().waitFor();
  await page.getByRole('button', { name: 'Ajustar todos los paneles', exact: true }).click();
  if (standardized) for (const node of stateNodes) await page.waitForFunction(({ id, state }) => document.querySelector(`[data-node-id="${id}"]`)?.dataset.panelState === state, { id: node.id, state: node.panelState });
  // State language on one screen. The classes are the ones the app sets from
  // real activity; here they are forced so the colours can be reviewed without
  // waiting for an agent to work, ask or fail.
  await page.evaluate(() => {
    const row = document.querySelector('.rail-session');
    const variant = (title, status, tone, needs, selected = false) => {
      const copy = row.cloneNode(true), inner = copy.querySelector('.rail-session-row');
      copy.dataset.designFixture = 'rail-state';
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
      if (details) details.textContent = ' · Terminal · fixture de metadatos largos';
      else {
        meta.querySelector('.rail-session-type').textContent = 'Terminal';
        meta.querySelector('.rail-session-time')?.remove();
        const time = document.createElement('span');
        time.className = 'rail-session-time'; time.textContent = 'hace 2 min'; meta.append(time);
        meta.id = `fixture-${title.replaceAll(' ', '-')}`;
        button.setAttribute('aria-describedby', meta.id);
        meta.title = `Terminal · ${status} · hace 2 min`;
      }
      const dot = copy.querySelector('.rail-session-dot');
      if (dot) dot.className = `rail-session-dot ${tone}`;
      else inner.dataset.state = needs ? 'attention' : tone === 'working' ? 'working' : 'rest';
      copy.querySelector('.rail-session-resources')?.remove();
      row.parentNode.append(copy);
    };
    variant('Trabajo', 'Trabajando', 'working', false);
    variant('Permiso', 'Pide permiso', 'warning', true);
    variant('Permiso seleccionado', 'Pide permiso', 'warning', true, true);
    variant('Pregunta', 'Te hizo una pregunta', 'warning', true);
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
    // The bell only exists when the rail is collapsed or narrow.
    document.querySelector('.attention-button')?.insertAdjacentHTML('beforeend', '<i></i>');
  });
  const railStatuses = await page.locator('.rail-session-status').evaluateAll(elements => elements.map(el => {
    const rect = el.getBoundingClientRect();
    const parent = el.closest('.rail-panel-label').getBoundingClientRect();
    return { text: el.textContent, fontSize: getComputedStyle(el).fontSize,
      clipped: el.scrollWidth > el.clientWidth || rect.right > parent.right + 1 || rect.bottom > parent.bottom + 1 };
  }));
  observations.push({ scene: 'synthetic-rail-status', samples: railStatuses });
  for (const status of railStatuses) {
    assert.equal(status.fontSize, '12px', 'Status must use 12px type');
    if (standardized) assert.equal(status.clipped, false, `Clipped status: ${status.text}`);
  }
  await shot('synthetic-states');
  if (standardized) {
    await page.locator('[data-design-fixture="rail-state"]').evaluateAll(elements => elements.forEach(element => element.remove()));
    const layoutUnit = 1 / 64;
    const dimension = (actual, expected, name) => assert.ok(Math.abs(actual - expected) <= layoutUnit, `${name}: ${actual} vs ${expected}`);
    const measureChrome = async scene => {
      const measurement = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const rail = document.querySelector('.project-rail'), dock = document.querySelector('.activity-dock');
        const rs = getComputedStyle(rail), ds = getComputedStyle(dock), coarse = matchMedia('(pointer: coarse)').matches;
        const rows = [...rail.querySelectorAll('.rail-session-row')].map(row => {
          const badge = row.querySelector('.rail-agent-mark'), glyph = badge.querySelector('svg');
          const status = row.querySelector('.rail-session-status'), label = row.querySelector('.rail-panel-label');
          const bs = getComputedStyle(badge), title = label.firstElementChild;
          return { bounds: rect(row), badge: rect(badge), glyph: rect(glyph), ink: bs.color, fill: bs.backgroundColor, image: bs.backgroundImage, shadow: bs.boxShadow, radius: bs.borderRadius, stroke: getComputedStyle(glyph).strokeWidth, state: row.dataset.state,
            titleLines: getComputedStyle(title).whiteSpace, clipped: status.scrollWidth > status.clientWidth || rect(status).right > rect(label).right + 1,
            jump: rect(row.firstElementChild), focus: rect(row.querySelector('.rail-panel-focus')) };
        });
        const controls = [...document.querySelectorAll('.workspace-header button, .canvas-navigation button, .activity-dock button, .rail-panel-focus, .rail-heading button, .rail-system > button')].filter(el => el.getClientRects().length && getComputedStyle(el).display !== 'none').map(el => {
          const s = getComputedStyle(el), hit = el.closest('.control-segmented') ? getComputedStyle(el, '::after') : null;
          return { name: el.getAttribute('aria-label') || el.textContent, bounds: rect(el), border: ['Top', 'Right', 'Bottom', 'Left'].map(side => s[`border${side}Width`]), shadow: s.boxShadow, scale: s.scale, translate: s.translate, hitHeight: rect(el).height + (hit ? -parseFloat(hit.top) - parseFloat(hit.bottom) : 0) };
        });
        const stage = document.querySelector('.canvas-stage');
        const seg = document.querySelector('.canvas-navigation .control-segmented');
        const primary = dock.querySelector('.dock-primary'), ps = getComputedStyle(primary);
        const host = rail.querySelector('.host-indicator'), mark = rail.querySelector('.project-switcher > summary > .project-initials');
        return { rail: rect(rail), padding: ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(rs[`padding${side}`])), window: { width: innerWidth, height: innerHeight }, dock: rect(dock), dockRadius: ds.borderRadius, stage: rect(stage), nav: rect(document.querySelector('.canvas-navigation')), coarse, rows, controls,
          primary: { bounds: rect(primary), icon: rect(primary.querySelector('svg')), label: rect(primary.querySelector('span')), direction: ps.flexDirection, padding: [ps.paddingLeft, ps.paddingRight], gap: ps.gap },
          host: { text: host.textContent, clipped: host.scrollWidth > host.clientWidth, bounds: rect(host), next: rect(host.nextElementSibling) },
          projectMark: { bounds: rect(mark), text: mark.textContent, radius: getComputedStyle(mark).borderRadius },
          tokens: Object.fromEntries(['rail-width', 'gutter', 'box-pad', 'row-detail', 'badge-size', 'glyph-primary', 'dock-h', 'dock-clearance', 'seg-height', 'seg-pad', 'seg-gap', 'focus-width'].map(name => [name, rs.getPropertyValue(`--${name}`).trim()])),
          segment: seg && { height: rect(seg).height, padding: getComputedStyle(seg).padding, gap: getComputedStyle(seg).gap, children: [...seg.children].filter(el => getComputedStyle(el).display !== 'none').map(el => rect(el).height) } };
      });
      assert.deepEqual(measurement.tokens, { 'rail-width': '272px', gutter: '12px', 'box-pad': '12px', 'row-detail': '56px', 'badge-size': '32px', 'glyph-primary': '18px', 'dock-h': '64px', 'dock-clearance': '24px', 'seg-height': '36px', 'seg-pad': '4px', 'seg-gap': '4px', 'focus-width': '2px' });
      dimension(measurement.rail.width, 272, 'Rail width'); dimension(measurement.rail.x, 12, 'Rail left'); dimension(measurement.rail.y, 12, 'Rail top');
      for (const padding of measurement.padding) dimension(padding, 12, 'Rail padding');
      assert.ok(Math.abs(measurement.window.height - measurement.rail.bottom - 12) <= 1);
      dimension(measurement.dock.height, 64, 'Dock height'); assert.equal(measurement.dockRadius, '999px');
      assert.ok(Math.abs(measurement.window.height - measurement.dock.bottom - 24) <= 1, 'Dock clears the window by 24px');
      assert.ok(measurement.dock.y - measurement.stage.bottom >= 24 - layoutUnit, 'Clipped work stage clears dock by at least 24px');
      assert.ok(measurement.dock.x - measurement.rail.right >= 24 - layoutUnit, 'Dock clears the rail');
      assert.ok(measurement.nav.x - measurement.dock.right >= 24 - layoutUnit, 'View tools sit right of the dock with at least 24px');
      dimension(measurement.nav.bottom, measurement.dock.bottom, 'View tools share the dock baseline');
      dimension(measurement.stage.x, measurement.rail.right, 'Working stage excludes the expanded rail');
      assert.equal(measurement.primary.direction, 'row'); assert.deepEqual(measurement.primary.padding, ['18px', '18px']); assert.equal(measurement.primary.gap, '8px');
      dimension(measurement.primary.bounds.height, measurement.coarse ? 44 : 40, 'Primary height');
      const { bounds, icon, label } = measurement.primary;
      dimension(label.x - icon.right, 8, 'Primary icon-label gap');
      dimension(icon.y + icon.height / 2, label.y + label.height / 2, 'Primary contents share a centre line');
      dimension(icon.x - bounds.x, bounds.right - label.right, 'Primary contents are centred');
      assert.ok(icon.y >= bounds.y && icon.bottom <= bounds.bottom && label.y >= bounds.y && label.bottom <= bounds.bottom, 'Primary contents fit inside the pill');
      assert.equal(measurement.host.text, 'Host local conectado'); assert.equal(measurement.host.clipped, false, 'Host status is complete');
      assert.ok(measurement.host.bounds.right <= measurement.host.next.x, 'Host status does not overlap the controls');
      dimension(measurement.projectMark.bounds.width, 32, 'ProjectMark width'); dimension(measurement.projectMark.bounds.height, 32, 'ProjectMark height');
      assert.equal(measurement.projectMark.text, 'TF'); assert.equal(measurement.projectMark.radius, '50%');
      for (const row of measurement.rows) {
        dimension(row.bounds.height, 56, 'Row height'); dimension(row.badge.width, 32, 'Badge width'); dimension(row.badge.height, 32, 'Badge height');
        dimension(row.glyph.width, 18, 'Glyph width'); dimension(row.glyph.height, 18, 'Glyph height'); assert.equal(row.stroke, '1.75px');
        dimension(row.badge.x - row.bounds.x, 16, 'Badge inset'); assert.equal(row.ink, 'rgb(255, 255, 255)');
        assert.equal(row.image, 'none'); assert.equal(row.shadow, 'none'); assert.equal(row.radius, '50%');
        assert.equal(row.titleLines, 'nowrap'); assert.equal(row.clipped, false);
        assert.ok(row.jump.height >= 44 - layoutUnit); assert.ok(row.focus.width >= (measurement.coarse ? 44 : 40) - layoutUnit);
        assert.ok(Math.abs(row.focus.right - (row.focus.width - 36) / 2 - (row.bounds.right - 16)) <= 1, 'Actions share the right inset');
        if (row.state === 'working') assert.equal(row.fill, 'rgb(93, 117, 33)');
        else if (row.state === 'attention') assert.equal(row.fill, 'rgb(181, 135, 47)');
        else assert.match(row.fill, /^oklch\(0\.36 0\.008 260\)$/);
      }
      for (const control of measurement.controls) {
        assert.deepEqual(control.border, ['0px', '0px', '0px', '0px'], control.name);
        assert.equal(control.shadow, 'none', control.name); assert.equal(control.scale, 'none', control.name); assert.equal(control.translate, 'none', control.name);
        if (measurement.coarse) assert.ok(control.hitHeight >= 44 - layoutUnit, `${control.name}: coarse target ${control.hitHeight}`);
      }
      if (measurement.segment) {
        assert.ok(measurement.segment.children.length >= 2);
        dimension(measurement.segment.height, 36, 'Segmented height');
        assert.equal(measurement.segment.padding, '4px'); assert.equal(measurement.segment.gap, '4px');
        for (const height of measurement.segment.children) dimension(height, 28, 'Segment height');
      }
      observations.push({ scene, ...measurement });
    };
    await measureChrome('rail-state-desktop');
    const framedPanels = await page.locator('.canvas-node').evaluateAll(elements => elements.map(el => {
      const panel = el.getBoundingClientRect(), stage = el.closest('.canvas-stage').getBoundingClientRect();
      return { id: el.dataset.nodeId, left: panel.left, right: panel.right, stageLeft: stage.left, stageRight: stage.right };
    }));
    for (const panel of framedPanels) assert.ok(panel.left >= panel.stageLeft && panel.right <= panel.stageRight, `Fit keeps ${panel.id} clear of the rail: ${JSON.stringify(panel)}`);
    const attentionRow = page.getByRole('button', { name: `Ver ${stateNodes[1].title} en el mapa`, exact: true }).locator('..');
    const badgeSnapshot = () => attentionRow.locator('.rail-agent-mark').evaluate(el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return { fill: s.backgroundColor, ink: s.color, shape: el.innerHTML, width: r.width, height: r.height, x: r.x, y: r.y };
    });
    await attentionRow.scrollIntoViewIfNeeded(); await page.mouse.move(900, 20); await delay(250);
    const badgeBefore = await badgeSnapshot(), boundsBefore = await attentionRow.boundingBox();
    const rowFill = async token => attentionRow.evaluate((el, token) => {
      const probe = document.createElement('div'); probe.style.backgroundColor = `var(${token})`; el.append(probe);
      const expected = getComputedStyle(probe).backgroundColor; probe.remove();
      const s = getComputedStyle(el);
      return { actual: s.backgroundColor, expected, radius: s.borderRadius, clip: s.backgroundClip, transform: s.transform, scale: s.scale };
    }, token);
    for (const pressed of [false, true]) {
      await attentionRow.locator('button').first().hover(); if (pressed) await page.mouse.down();
      await delay(150);
      const fill = await rowFill(pressed ? '--row-press' : '--row-hover');
      assert.equal(fill.actual, fill.expected); assert.equal(fill.radius, '12px'); assert.equal(fill.clip, 'padding-box');
      assert.equal(fill.transform, 'none'); assert.equal(fill.scale, 'none');
      assert.deepEqual(await attentionRow.boundingBox(), boundsBefore); assert.deepEqual(await badgeSnapshot(), badgeBefore);
      await shot(pressed ? 'rail-pressed' : 'rail-hover');
    }
    await page.mouse.up(); await delay(250);
    assert.equal(await attentionRow.locator('button').first().getAttribute('aria-current'), 'true');
    assert.deepEqual(await badgeSnapshot(), badgeBefore, 'Selection preserves the badge');
    const selectedFill = await rowFill('--row-selected-hover'); assert.equal(selectedFill.actual, selectedFill.expected);
    const selection = await attentionRow.evaluate(row => [row, ...row.querySelectorAll('button')].map(el => ({ outline: getComputedStyle(el).outlineWidth, shadow: getComputedStyle(el).boxShadow, keyboardFocus: el.matches(':focus-visible') })));
    for (const item of selection) assert.deepEqual(item, { outline: '0px', shadow: 'none', keyboardFocus: false }, 'Pointer selection has no extra contour');
    observations.push({ scene: 'rail-selected', selection });
    await shot('rail-selected');
    await attentionRow.locator('button').first().focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const focus = await attentionRow.locator('button').first().evaluate(el => {
      const style = getComputedStyle(el);
      return { visible: el.matches(':focus-visible'), style: style.outlineStyle, width: parseFloat(style.outlineWidth), token: style.getPropertyValue('--focus-width').trim(), pixelRatio: devicePixelRatio };
    });
    assert.equal(focus.visible, true); assert.equal(focus.style, 'solid'); assert.equal(focus.token, '2px');
    assert.ok(focus.width > 0 && Math.abs(focus.width - 2) < 1 / focus.pixelRatio, 'Focus outline retains 2 CSS px with device-pixel snapping');
    observations.push({ scene: 'rail-keyboard-focus', ...focus });
    await shot('rail-keyboard-focus');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 760)); await delay(400);
    await measureChrome('rail-state-1100'); await shot('rail-narrow');
    const dockActions = page.locator('.dock-main button');
    assert.deepEqual(await page.locator('.dock-main [data-type]').evaluateAll(elements => elements.map(el => el.dataset.type)), ['terminal', 'browser', 'note', 'zone']);
    const dockNames = ['Nueva sesión', 'Navegador', 'Nota', 'Zona', 'Trabajo', 'Git', 'Entorno', 'Más'];
    assert.equal(await dockActions.count(), dockNames.length);
    await dockActions.first().focus(); await page.keyboard.press('Shift+Tab');
    for (const name of dockNames) {
      await page.keyboard.press('Tab');
      const action = create.getByRole('button', { name, exact: true });
      assert.equal(await action.count(), 1, `Dock tool has an accessible name: ${name}`);
      const reachability = await action.evaluate(el => {
        const r = el.getBoundingClientRect(), shelf = el.closest('.dock-main').getBoundingClientRect();
        return { focused: document.activeElement === el, tabbable: el.tabIndex >= 0 && !el.disabled, visible: el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          contained: r.width > 0 && r.height > 0 && r.left >= shelf.left - 1 && r.right <= shelf.right + 1 && r.top >= shelf.top - 1 && r.bottom <= shelf.bottom + 1 && r.left >= 0 && r.right <= innerWidth,
          named: !!el.getAttribute('title') || el.getAttribute('aria-label') === 'Más' };
      });
      assert.deepEqual(reachability, { focused: true, tabbable: true, visible: true, contained: true, named: true }, `Every dock tool remains reachable by keyboard: ${name}`);
      observations.push({ scene: 'dock-keyboard', name, ...reachability });
    }
    await page.keyboard.press('Enter');
    await page.getByRole('menu', { name: 'Más hubs', exact: true }).waitFor();
    for (const name of ['Contexto', 'Automatizar', 'Todas las herramientas']) {
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('menuitem', { name, exact: true }).evaluate(el => document.activeElement === el), true, `Menu item reachable by Tab: ${name}`);
    }
    await page.keyboard.press('Escape');
    await page.locator('.dock-more-menu').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: 'Más', exact: true }).evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Enter');
    for (let index = 0; index < 3; index++) await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const catalogue = page.getByRole('dialog', { name: 'Añadir a la mesa', exact: true });
    await catalogue.waitFor();
    assert.deepEqual((await catalogue.locator('.tool-item strong').allTextContents()).sort(), ['Terminal', 'Navegador', 'Nota', 'Zona', 'Trabajo', 'Git', 'Entorno', 'Contexto', 'Automatizar', 'Revisión de video', 'Bitácora de videos'].sort());
    assert.equal(await catalogue.getByRole('textbox', { name: 'Buscar herramienta' }).evaluate(el => document.activeElement === el), true);
    await shot('dock-catalogue');
    await page.keyboard.press('Escape'); await catalogue.waitFor({ state: 'detached' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }); await delay(400);
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    await measureChrome('rail-state-coarse'); await shot('rail-coarse');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980)); await delay(400);
    const working = stateNodes[0], panel = page.locator(`[data-node-id="${working.id}"]`);
    for (const scene of ['map-flash', 'map-flash-selected']) {
      if (scene === 'map-flash-selected') assert.equal(await panel.getAttribute('aria-current'), 'true');
      await panel.evaluate(el => {
        window.mapFlashObservation = null;
        const observe = async event => {
          if (event.target !== el || event.pseudoElement !== '::after' || event.animationName !== 'map-flash') return;
          el.removeEventListener('animationstart', observe);
          try {
            const animations = el.getAnimations({ subtree: true }).filter(animation => animation.animationName === 'map-flash');
            if (animations.length !== 1) throw new Error(`Expected one observable ring timeline, found ${animations.length}`);
            const [animation] = animations;
            animation.pause();
            await animation.ready;
            const ring = getComputedStyle(el, '::before'), flash = getComputedStyle(el, '::after');
            for (const property of ['position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'borderRadius', 'padding', 'maskImage', 'maskClip', 'maskOrigin', 'maskComposite', 'pointerEvents', 'zIndex']) {
              if (flash[property] !== ring[property]) throw new Error(`Flash differs from the panel ring: ${property}`);
            }
            if (flash.content === 'none' || flash.display === 'none' || flash.visibility !== 'visible' || flash.transform !== 'none') throw new Error('Flash ring is hidden or displaced');
            const opacity = [0, 162].map(time => { animation.currentTime = time; return Number(getComputedStyle(el, '::after').opacity); });
            const timing = animation.effect.getTiming();
            const observation = { id: el.dataset.nodeId, state: el.dataset.panelState, trace: el.querySelectorAll('.activity-trace rect').length,
              targets: [...document.querySelectorAll('.canvas-node.map-flash')].map(panel => panel.dataset.nodeId), opacity, duration: timing.duration, iterations: timing.iterations };
            animation.currentTime = 0; animation.play();
            await animation.finished;
            opacity.push(Number(getComputedStyle(el, '::after').opacity));
            window.mapFlashObservation = observation;
          } catch (error) { window.mapFlashObservation = { error: error.message }; }
        };
        el.addEventListener('animationstart', observe);
      });
      await page.getByRole('button', { name: `Ver ${working.title} en el mapa`, exact: true }).click();
      await page.waitForFunction(() => window.mapFlashObservation !== null);
      const flash = await page.evaluate(() => window.mapFlashObservation);
      assert.deepEqual(flash, { id: working.id, state: 'working', trace: 5, targets: [working.id], opacity: [0, 1, 0], duration: 900, iterations: 1 });
      observations.push({ scene, ...flash });
      assert.equal(await page.locator('.canvas-node.focused').count(), 0);
      await page.waitForFunction(id => !document.querySelector(`[data-node-id="${id}"]`)?.classList.contains('map-flash'), working.id);
      await shot(scene);
    }
    await delay(400);
    const mapRect = await panel.boundingBox();
    const mapGeometry = await panel.evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height]);
    await page.evaluate(() => {
      window.focusObservations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) {
        const animation = animate.call(this, frames, options);
        if (options?.id === 'focus-flip') {
          animation.pause();
          const rects = [0, 160, 320].map(time => { animation.currentTime = time; const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
          window.focusObservations.push({ id: this.dataset.nodeId, duration: options.duration, rects });
          animation.currentTime = 0; animation.play();
        }
        return animation;
      };
    });
    const near = (a, b) => { for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(a[key] - b[key]) <= 2, `${key}: ${a[key]} vs ${b[key]}`); };
    await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
    await page.waitForFunction(() => window.focusObservations.length === 1);
    await shot('focus-flip');
    const open = await page.evaluate(() => window.focusObservations[0]);
    assert.equal(open.id, working.id); assert.equal(open.duration, 320);
    near(open.rects[0], mapRect); near(open.rects[2], await panel.boundingBox());
    assert.notDeepEqual(open.rects[1], open.rects[0]); assert.notDeepEqual(open.rects[1], open.rects[2]);
    await page.locator('.canvas').focus(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.focusObservations.length === 2);
    await shot('focus-flip-return');
    const back = await page.evaluate(() => window.focusObservations[1]);
    near(back.rects[0], open.rects[2]); near(back.rects[2], mapRect);
    assert.deepEqual(await panel.evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height]), mapGeometry);
    assert.equal(await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).evaluate(el => el === document.activeElement), true);
    observations.push({ scene: 'focus-flip', open, back });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: `Ver ${working.title} en el mapa`, exact: true }).click();
    await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
    await shot('focus-flip-reduced');
    await page.locator('.focus-return button').click(); await delay(400);
    assert.equal(await page.evaluate(() => window.focusObservations.length), 2, 'Reduced motion applies layout without FLIP');
    assert.equal(await panel.evaluate(el => el.getAnimations({ subtree: true }).filter(animation => ['map-flash', 'trace-orbit'].includes(animation.animationName)).length), 0);
    observations.push({ scene: 'focus-flip-reduced', animations: 0 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // A new unread reply keeps its canonical pulse-turn, but never asks for intervention.
    const finished = stateNodes[2];
    await app.evaluate(({ BrowserWindow }, { id, workspaceId }) => {
      globalThis.designFixture.chats[id].messages[0].id += '-unread';
      BrowserWindow.getAllWindows()[0].webContents.send('phantom:event', { type: 'chat.update', reset: true, workspaceId, nodeId: id });
    }, { id: finished.id, workspaceId });
    await page.waitForFunction(id => document.querySelector(`[data-node-id="${id}"]`)?.classList.contains('pulse-turn'), finished.id);
    assert.equal(await page.locator(`[data-node-id="${finished.id}"]`).getAttribute('data-panel-state'), 'finished');
    await page.getByRole('button', { name: 'Ajustar todos los paneles', exact: true }).click();
  }
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
    if (action.backgroundColor !== 'rgb(236, 230, 216)' || action.color !== 'rgb(20, 20, 20)') throw new Error('Attention action must be ivory/dark');
    const toggle = fixture.querySelector('.inc-switch');
    if (getComputedStyle(toggle).backgroundColor !== 'rgb(236, 230, 216)' || getComputedStyle(toggle.querySelector('i')).backgroundColor !== 'rgb(20, 20, 20)') throw new Error('Incorporation switch must be ivory/dark');
  });
  await shot('attention');
  await page.locator('#color-fixture').evaluate(el => el.remove());
  for (const node of stateNodes) await invoke('node.remove', { workspaceId, id: node.id });
  for (const node of originalNodes) await invoke('node.update', { workspaceId, id: node.id, patch: { data: node.data } });
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('phantom:invoke');
    ipcMain.handle('phantom:invoke', globalThis.designFixture.original);
    delete globalThis.designFixture;
  });
  await page.reload();
  await page.locator('.canvas-node').first().waitFor();
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('navigation', { name: 'Categorías de configuración' }).waitFor();
  if (standardized) {
    await page.locator('.st-ico').evaluateAll(icons => {
      if (icons.length !== 8) throw new Error('Expected all eight settings categories');
      const tones = ['neutral', 'steel', 'neutral', 'violet', 'neutral', 'neutral', 'steel', 'neutral'];
      for (const [index, icon] of icons.entries()) {
        const style = getComputedStyle(icon), glyph = getComputedStyle(icon.querySelector('svg'));
        const probe = document.createElement('i'); icon.append(probe); probe.style.background = `var(--badge-${tones[index]})`;
        const expected = getComputedStyle(probe).backgroundColor; probe.remove();
        if (icon.dataset.tone !== tones[index] || style.backgroundColor !== expected || style.color !== 'rgb(255, 255, 255)' || style.backgroundImage !== 'none') throw new Error('Unstable category palette');
        const dimension = (value, expected) => Math.abs(parseFloat(value) - expected) <= 1 / 64;
        if (!dimension(style.width, 32) || !dimension(style.height, 32) || style.borderRadius !== '50%' || !dimension(glyph.width, 18) || glyph.strokeWidth !== '1.75px') throw new Error('Invalid settings badge geometry');
      }
    });
    const category = page.getByRole('button', { name: 'Apariencia', exact: true });
    await category.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.settings-sheet').getAnimations().every(animation => animation.playState !== 'running' && !animation.pending));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const rest = await category.evaluate(el => ({ rect: el.getBoundingClientRect().toJSON(), badge: getComputedStyle(el.querySelector('.st-ico')).backgroundColor }));
    await category.hover(); await delay(150);
    await page.mouse.down();
    try {
      const pressed = await category.evaluate(el => ({ rect: el.getBoundingClientRect().toJSON(), badge: getComputedStyle(el.querySelector('.st-ico')).backgroundColor, radius: getComputedStyle(el).borderRadius, scale: getComputedStyle(el).scale,
        dividers: [getComputedStyle(el.parentElement, '::before').opacity, getComputedStyle(el.parentElement.nextElementSibling, '::before').opacity] }));
      assert.deepEqual(pressed.rect, rest.rect); assert.equal(pressed.badge, rest.badge);
      assert.equal(pressed.radius, '12px'); assert.equal(pressed.scale, 'none'); assert.deepEqual(pressed.dividers, ['0', '0']);
      observations.push({ scene: 'settings-row-press', ...pressed });
    } finally { await page.mouse.move(0, 0); await page.mouse.up(); }
  }
  await shot('settings-categories');
  await page.getByRole('button', { name: 'Apariencia', exact: true }).click();
  if (standardized) {
    await delay(350);
    const settings = await page.locator('.settings-sheet').evaluate(el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect(), parent = el.offsetParent.getBoundingClientRect();
      const pane = el.querySelector('.st-pane');
      const groups = [...el.querySelectorAll('.st-list')].filter(group => group.checkVisibility()).map(group => {
        const style = getComputedStyle(group); return { fill: style.backgroundColor, image: style.backgroundImage, border: style.borderTopWidth, radius: style.borderRadius, shadow: style.boxShadow };
      });
      const controls = [...el.querySelectorAll('button, input, select')].filter(control => control.checkVisibility()).map(control => ({ border: getComputedStyle(control).borderLeftWidth, right: control.getBoundingClientRect().right }));
      const rows = [...el.querySelectorAll('.st-row:has(.st-switch)')].map(row => {
        const box = row.getBoundingClientRect(), control = row.querySelector('.st-row-control').getBoundingClientRect();
        return { height: box.height, rightInset: box.right - control.right };
      });
      return { width: s.width, right: parent.right - r.right, top: r.top - parent.top, groups, controls, rows, pane: { width: pane.clientWidth, scrollWidth: pane.scrollWidth, height: pane.clientHeight, scrollHeight: pane.scrollHeight } };
    });
    assert.ok(Math.abs(parseFloat(settings.width) - 320) <= 1 / 64); assert.ok(Math.abs(settings.right - 12) <= 1); assert.ok(Math.abs(settings.top - 12) <= 1);
    assert.ok(settings.groups.length >= 5);
    for (const group of settings.groups) assert.deepEqual(group, { fill: 'rgb(17, 17, 19)', image: 'none', border: '0px', radius: '12px', shadow: 'none' });
    for (const control of settings.controls) assert.equal(control.border, '0px');
    for (const row of settings.rows) { assert.ok(row.height >= 60 - 1 / 64); assert.ok(Math.abs(row.rightInset - 16) <= 1 / 64, 'Settings controls share the right edge'); }
    assert.ok(settings.pane.scrollWidth <= settings.pane.width); assert.ok(settings.pane.scrollHeight > settings.pane.height);
    const slider = page.locator('#background-intensity');
    const previous = Number(await slider.inputValue());
    await slider.focus(); await page.keyboard.press('ArrowLeft');
    assert.equal(Number(await slider.inputValue()), previous - 1);
    await page.keyboard.press('ArrowRight'); assert.equal(Number(await slider.inputValue()), previous);
    const pill = await page.locator('.st-slider').first().evaluate(el => ({ height: getComputedStyle(el).height, border: getComputedStyle(el).borderTopWidth, shadow: getComputedStyle(el).boxShadow }));
    assert.ok(Math.abs(parseFloat(pill.height) - 32) <= 1 / 64); assert.equal(pill.border, '0px'); assert.equal(pill.shadow, 'rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset');
    observations.push({ scene: 'settings-inspector', ...settings, pill });
    await page.locator('.st-pane').evaluate(el => { el.scrollTop = 0; });
    await shot('settings-appearance');
  }
  const gridSwitch = page.getByRole('switch', { name: 'Retícula de puntos', exact: true });
  await gridSwitch.scrollIntoViewIfNeeded();
  if (standardized) await gridSwitch.evaluate(el => {
    if (el.getAttribute('aria-checked') !== 'true') throw new Error('Expected enabled grid in isolated profile');
    if (getComputedStyle(el).backgroundColor !== 'rgb(236, 230, 216)' || getComputedStyle(el.querySelector('i')).backgroundColor !== 'rgb(20, 20, 20)') throw new Error('Active switch must be ivory/dark');
    const style = getComputedStyle(el), thumb = getComputedStyle(el.querySelector('i'));
    const dimension = (value, expected) => Math.abs(parseFloat(value) - expected) <= 1 / 64;
    if (!dimension(style.width, 44) || !dimension(style.height, 26) || !dimension(thumb.width, 20) || thumb.transform !== 'matrix(1, 0, 0, 1, 18, 0)' || style.borderTopWidth !== '0px') throw new Error('Switch geometry differs from Appearance');
  });
  await shot('settings-switches');
  if (standardized) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 760)); await delay(400);
    assert.equal(await page.locator('.st-pane').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'Compact inspector contains controls');
    await gridSwitch.scrollIntoViewIfNeeded(); await shot('settings-switches-compact');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980)); await delay(400);
    await page.getByRole('switch', { name: 'Mostrar Titi', exact: true }).click();
    assert.equal(await page.locator('[data-identity]').count(), 0);
    assert.equal(await page.locator('#gengar-intensity').isDisabled(), true);
    await page.getByRole('switch', { name: 'Mostrar Titi', exact: true }).click();
    assert.equal(await page.locator('[data-identity]').count(), 1);
    await page.locator('.st-back').click();
    for (const name of ['Agentes', 'Git e integración', 'Voz', 'Teléfono', 'Conexiones', 'Datos y respaldo', 'Avanzado']) {
      await page.getByRole('button', { name, exact: true }).click();
      assert.equal(await page.locator('#st-pane-title').innerText(), name);
      const containment = await page.locator('.st-pane').evaluate(el => ({
        width: el.clientWidth, scrollWidth: el.scrollWidth,
        overflowing: [...el.querySelectorAll('.st-list, .st-row, .st-row-control, .st-input, .st-select, .st-command')].filter(child => child.checkVisibility() && child.getBoundingClientRect().right > el.getBoundingClientRect().right).map(child => ({ className: child.className, width: child.clientWidth, scrollWidth: child.scrollWidth })),
      }));
      assert.ok(containment.scrollWidth <= containment.width, `${name}: contained settings ${JSON.stringify(containment)}`);
      await page.locator('.st-back').click();
    }
  }
  await page.getByRole('button', { name: 'Cerrar configuración', exact: true }).click();
   await page.locator('.space-switcher-trigger').click();
   await page.locator('.context-menu-panel').waitFor({ state: 'visible' });
   await shot('space-menu');
   await page.keyboard.press('Escape');
   await page.locator('.canvas-node[data-type="terminal"] .node-glyph').first().dblclick();
   await page.locator('.canvas-node.focused .pc-model').first().click();
   await page.locator('.pc-models').waitFor({ state: 'visible' });
   await shot('model-menu');
   await page.keyboard.press('Escape');
   await toMap();
    const notch = page.locator('.activity-notch').first();
    await notch.click(); await shot('tray');
    await notch.click();
    if (standardized) {
      const session = await invoke('node.create', { workspaceId, type: 'terminal', title: 'SYNTHETIC · Sesión v2', x: 40, y: 40, width: 484, height: 804, data: { chat: { provider: 'claude' } } });
      const runId = 'task_55555555-5555-4555-8555-555555555555';
      await app.evaluate(({ ipcMain }, { nodeId, workspaceId, runId }) => {
        const original = ipcMain._invokeHandlers.get('phantom:invoke');
        const f = globalThis.sessionDesignFixture = { original, nodeId, workspaceId, runId, pending: [], sent: [], total: 2, sequence: 0,
          chat: { provider: 'claude', running: false, messages: [], queue: [], meta: { model: 'SYNTHETIC modelo' } } };
        ipcMain.removeHandler('phantom:invoke');
        ipcMain.handle('phantom:invoke', async (event, method, payload = {}) => {
          if (method === 'chat.get' && [nodeId, `phantom:${workspaceId}`].includes(payload.nodeId)) return f.chat;
          if (method === 'chat.models') return { items: [], note: 'SYNTHETIC · sin proveedor' };
          if (method === 'chat.send') { f.sent.push(payload); return {}; }
          if (method === 'voice.stream.warm') return { available: true };
          if (method === 'voice.stream.start') return { sessionId: `synthetic-e5-${++f.sequence}` };
          if (method === 'voice.stream.push') return { confirmed: 'SYNTHETIC confirmado.', partial: 'Texto parcial' };
          if (method === 'voice.stream.cancel') return {};
          if (method === 'voice.stream.finish') { await new Promise(resolve => f.pending.push(resolve)); return { confirmed: 'SYNTHETIC dictado final.', partial: '' }; }
          if (method === 'phantom.controllers') return { available: true, items: [] };
          if (method === 'phantom.detail' && payload.id === runId) return { task: { id: runId, status: 'running', contract: { goal: 'SYNTHETIC · checks medidos', checks: [] } }, runs: [{ evidence: { verification: [{ available: true, checks: Array.from({ length: f.total }, (_, i) => ({ name: `SYNTHETIC check ${i + 1}`, passed: i === 0, executed: i === 0 })) }] } }] };
          if (method === 'phantom.events' && payload.id === runId) return { steps: [], total: 0 };
          if (payload.nodeId === nodeId && method.startsWith('chat.') && method !== 'chat.configure') throw new Error(`Session visual fixture cannot execute ${method}`);
          return original(event, method, payload);
        });
      }, { nodeId: session.id, workspaceId, runId });
      await page.addInitScript(() => {
        window.sessionDesignAudio = { gains: [], tracks: [] };
        if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
          const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination();
          gain.gain.value = .4; oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
          window.sessionDesignAudio.gains.push(gain);
          for (const track of destination.stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => { stop(); oscillator.stop(); context.close(); };
            window.sessionDesignAudio.tracks.push(track);
          }
          return destination.stream;
        } });
      });
      await page.reload();
      const panel = page.locator(`[data-node-id="${session.id}"]`);
      await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
      await panel.locator('.pc-providers').waitFor();
      const input = panel.getByLabel('Mensaje para Claude', { exact: true });
      const recipe = async surface => surface.locator('.pc-composer').evaluate(el => {
        const s = getComputedStyle(el), field = getComputedStyle(el.querySelector('.pc-field')), input = getComputedStyle(el.querySelector('textarea')), controls = getComputedStyle(el.querySelector('.pc-controls'));
        // Fill and ring change with focus and dictation; the recipe records that they exist.
        return { padding: s.padding, gap: s.gap, background: s.backgroundColor, thread: getComputedStyle(el.parentElement.querySelector(':scope > .pc-thread')).backgroundColor, field: field.backgroundColor !== 'rgba(0, 0, 0, 0)', radius: field.borderRadius, border: field.borderTopWidth, shadow: field.boxShadow !== 'none', input: { padding: input.padding, radius: input.borderRadius, background: input.backgroundColor, border: input.borderWidth, shadow: input.boxShadow, minimum: input.minHeight, font: input.font, transition: input.transitionProperty }, controls: { padding: controls.padding, gap: controls.gap } };
      });
      const common = await recipe(panel);
      assert.equal(common.padding, '0px 24px 24px'); assert.equal(common.gap, '12px');
      assert.equal(common.background, common.thread, 'Composer shares the thread well');
      const { background: _background, thread: _thread, ...shape } = common;
      assert.equal(common.field, true, 'Composer island has a translucent fill');
      assert.equal(common.radius, '24px'); assert.equal(common.shadow, true, 'Composer island has its ring'); assert.equal(common.border, '0px');
      assert.equal(common.input.padding, '8px 12px'); assert.equal(common.input.radius, '12px');
      assert.equal(common.input.background, 'rgba(0, 0, 0, 0)'); assert.equal(common.input.border, '0px'); assert.equal(common.input.shadow, 'none');
      assert.equal(common.input.minimum, '40px'); assert.equal(common.input.transition, 'none'); assert.equal(common.controls.gap, '8px');
      assert.equal(await panel.locator('.pc-providers [role="radio"]').count(), 1, 'Only the enabled Claude provider is offered');
      assert.deepEqual(await panel.locator('.pc-modes [role="radio"]').allTextContents(), ['Chat', 'Terminal']);
      const provider = panel.locator('.pc-providers [role="radio"]');
      await provider.focus(); await page.keyboard.press('End'); await page.keyboard.press('Home');
      assert.equal(await provider.getAttribute('aria-checked'), 'true');
      const scenes = async name => {
        for (const [suffix, width, height] of [['', 1520, 980], ['-narrow', 1100, 760]]) {
          await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), [width, height]);
          await delay(300);
          const { background, thread, ...current } = await recipe(panel);
          assert.deepEqual(current, shape, `${name}${suffix}: same composer`);
          assert.equal(background, thread, `${name}${suffix}: composer shares the thread well`);
          if (name === 'session-working') assert.equal(background, 'rgb(4, 4, 5)');
          assert.equal(await panel.locator('.pc-controls').evaluate(el => {
            const bounds = el.closest('.pc').getBoundingClientRect(), r = el.getBoundingClientRect();
            return el.scrollWidth <= el.clientWidth && r.left >= bounds.left - .001 && r.right <= bounds.right + .001 && r.bottom <= bounds.bottom + .001;
          }), true, 'Composer controls stay contained');
          if (await panel.locator('.pc-message.is-user').count()) {
            const quote = await panel.locator('.pc-message.is-user').evaluate(el => {
              const bar = el.getBoundingClientRect(), text = el.querySelector('.md').getBoundingClientRect(), next = el.nextElementSibling.getBoundingClientRect();
              const style = getComputedStyle(el);
              return { height: bar.height, textHeight: text.height, textTop: text.top - bar.top, nextTurnGap: next.top - bar.bottom, width: parseFloat(style.borderLeftWidth), token: style.getPropertyValue('--quote-width').trim(), pixelRatio: devicePixelRatio };
            });
            assert.ok(quote.textHeight > 0, `${name}${suffix}: quote has text`);
            assert.ok(Math.abs(quote.height - quote.textHeight) <= .5, `${name}${suffix}: quote bar follows text height ${JSON.stringify(quote)}`);
            assert.ok(Math.abs(quote.textTop) <= .5, `${name}${suffix}: quote bar starts with text`);
            assert.ok(Math.abs(quote.nextTurnGap - 20) <= .5, `${name}${suffix}: next turn is 20px after quote ${JSON.stringify(quote)}`);
            assert.equal(quote.token, '2px');
            assert.ok(quote.width > 0 && Math.abs(quote.width - 2) < 1 / quote.pixelRatio, 'Quote bar retains 2 CSS px with device-pixel snapping');
            observations.push({ scene: `${name}${suffix}`, quote });
          }
          if (name === 'session-dictating') {
            await input.evaluate(el => el.blur());
            await delay(200);
            const rest = await input.evaluate(el => getComputedStyle(el.closest('.pc-field')).backgroundColor);
            await input.press('ArrowLeft');
            await delay(200);
            const field = await input.evaluate(el => {
              const s = getComputedStyle(el), preview = getComputedStyle(el.parentElement.querySelector('.voice-live'));
              return { focused: el.matches(':focus-visible'), padding: s.padding, radius: s.borderRadius, fill: getComputedStyle(el.closest('.pc-field')).backgroundColor, outline: { style: s.outlineStyle }, preview: { padding: preview.padding, radius: preview.borderRadius, font: preview.font } };
            });
            assert.equal(field.focused, true, 'Dictation retains keyboard focus');
            assert.equal(field.padding, common.input.padding); assert.equal(field.radius, common.input.radius);
            assert.equal(field.outline.style, 'none', 'The field shows focus with the island light, not an outline');
            assert.notEqual(field.fill, rest, 'Focused island steps its fill');
            assert.deepEqual(field.preview, { padding: common.input.padding, radius: common.input.radius, font: common.input.font });
            observations.push({ scene: `${name}${suffix}`, dictationField: field });
          }
          await shot(`${name}${suffix}`);
        }
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
      };
      await scenes('session-new');
      const update = async (messages, running = false) => {
        await app.evaluate(({ BrowserWindow }, { messages, running }) => {
          const f = globalThis.sessionDesignFixture; f.chat.messages = messages; f.chat.running = running;
          BrowserWindow.getAllWindows()[0].webContents.send('phantom:event', { type: 'chat.update', reset: true, workspaceId: f.workspaceId, nodeId: f.nodeId });
        }, { messages, running });
      };
      const user = { id: 'e5-user', role: 'user', status: 'done', parts: [{ type: 'text', text: 'SYNTHETIC · Revisa la sesión y conserva los detalles.' }] };
      const working = { id: 'e5-agent', role: 'assistant', status: 'streaming', createdAt: new Date().toISOString(), parts: [
        { type: 'text', text: 'SYNTHETIC · Leo el contexto y reviso el cambio. Esta escena no ejecuta un proveedor.' },
        { id: 'e5-read', type: 'tool', name: 'Read', detail: 'src/components/ChatCard.jsx', status: 'done', output: 'SYNTHETIC · detalle expandible' },
        { id: 'e5-phantom', type: 'tool', name: 'phantom_context', detail: 'Contexto de la sesión', status: 'done', output: 'SYNTHETIC · contexto' },
        { id: 'e5-subagent', type: 'tool', name: 'Agent', detail: 'SYNTHETIC · revisión delegada', status: 'running', agent: { type: 'review', total: 1, steps: [{ id: 'e5-step', name: 'Read', detail: 'test/design-tokens.test.mjs', status: 'running' }], prompt: 'SYNTHETIC · conservar contención y estado' } },
      ] };
      await update([user, working], true); await panel.locator('.pc-working').waitFor();
      assert.equal(await panel.locator('progress').count(), 0, 'No measured total means no progress bar');
      assert.equal(await panel.locator('.pc-message.is-user').evaluate(el => el.tagName), 'BLOCKQUOTE');
      assert.equal(await panel.locator('.pc-subagent').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
      assert.equal(await panel.locator('[data-operation-glyph="titi"]').count(), 1);
      const detail = panel.locator('summary.pc-tool-row').first(); await detail.focus(); await page.keyboard.press('Enter');
      await panel.getByText('SYNTHETIC · detalle expandible', { exact: true }).waitFor(); await page.keyboard.press('Enter');
      await panel.locator('.pc-thread').evaluate(el => { el.scrollTop = 0; });
      await scenes('session-working');
      const linked = { ...working, id: 'e5-measured', parts: [{ id: 'e5-run', type: 'tool', name: 'Bash', status: 'done', input: `phantom run ${runId}`, detail: `SYNTHETIC · ${runId}`, output: 'SYNTHETIC · enlace de seguimiento' }] };
      await update([user, linked], true); await panel.locator('progress').waitFor();
      assert.deepEqual(await panel.locator('progress').evaluate(el => [el.value, el.max]), [1, 2]);
      await shot('session-working-measured');
      await app.evaluate(() => { globalThis.sessionDesignFixture.total = 0; });
      await update([user, { ...linked, id: 'e5-unmeasured' }], true);
      await panel.locator('progress').waitFor({ state: 'hidden' });
      await panel.locator('.pc-phantom-run').waitFor();
      assert.equal(await panel.locator('progress').count(), 0, 'Phantom tracking without checks has no invented total');
      await update([user, { ...working, id: 'e5-dictation-reply', status: 'done', parts: [{ type: 'text', text: 'SYNTHETIC · Puedes dictar el siguiente mensaje.' }], usage: { durationMs: 1400, costUsd: .03 } }]);
      await panel.locator('.pc-working').waitFor({ state: 'hidden' });
      await input.fill('Borrador previo.'); await panel.getByRole('button', { name: 'Dictar a Claude', exact: true }).click();
      await panel.locator('.pc-input .voice-live-partial').waitFor();
      assert.equal(await panel.locator('.voice-live-confirmed').textContent(), 'Borrador previo. SYNTHETIC confirmado.');
      assert.equal(await panel.locator('.voice-live-partial').textContent(), ' Texto parcial');
      assert.equal(await panel.locator('.voice-aura,.voice-waves').count(), 0);
      await scenes('session-dictating');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.deepEqual(await panel.locator('.voice-bars i').evaluateAll(elements => elements.map(el => [getComputedStyle(el).animationName, getComputedStyle(el).transitionDuration])), Array.from({ length: 6 }, () => ['none', '0s']));
      await page.evaluate(() => window.sessionDesignAudio.gains.forEach(gain => { gain.gain.value = 0; }));
      await page.waitForFunction(() => [...document.querySelectorAll('.voice-bars i')].every(el => parseFloat(getComputedStyle(el).height) <= 2.1));
      await shot('session-dictating-reduced');
      await input.press('Escape'); assert.equal(await input.inputValue(), 'Borrador previo.');
      assert.equal(await app.evaluate(() => globalThis.sessionDesignFixture.sent.length), 0);
      await panel.getByRole('button', { name: 'Dictar a Claude', exact: true }).click();
      await panel.locator('.voice-activity[data-state="recording"]').waitFor();
      await input.press('Enter'); await panel.locator('.voice-activity[data-state="transcribing"]').waitFor(); await input.press('Enter');
      await page.waitForFunction(() => window.sessionDesignAudio.tracks.every(track => track.readyState === 'ended'));
      await app.evaluate(async () => { const f = globalThis.sessionDesignFixture; for (let i = 0; i < 100 && !f.pending.length; i++) await new Promise(resolve => setTimeout(resolve, 20)); if (!f.pending.length) throw new Error('No synthetic final transcription pending'); f.pending.splice(0).forEach(resolve => resolve()); });
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Mensaje para Claude"]')?.value === '');
      assert.deepEqual(await app.evaluate(() => globalThis.sessionDesignFixture.sent.map(call => call.text)), ['Borrador previo. SYNTHETIC dictado final.']);
      await page.getByRole('button', { name: 'Abrir Phantom', exact: true }).click();
      await page.locator('.phantom-chat .pc-field').waitFor();
      const { background: sideBackground, thread: sideThread, ...side } = await recipe(page.locator('.phantom-chat'));
      assert.deepEqual(side, shape, 'Side composer shares the session recipe');
      assert.equal(sideBackground, sideThread, 'Side composer shares its thread well');
      await page.locator('.phantom-chat').getByRole('button', { name: 'Cerrar Phantom', exact: true }).click();
      await toMap();
      await page.locator('.canvas').focus(); await page.keyboard.press('1');
      await panel.locator('.pc-composer').waitFor();
      const { background: mapBackground, thread: mapThread, ...map } = await recipe(panel);
      assert.deepEqual(map, shape, 'Map composer shares the focus recipe');
      assert.equal(mapBackground, mapThread, 'Map composer shares its thread well');
      observations.push({ scene: 'session-v2', fixture: 'SYNTHETIC chat, delegation and ASR; WebAudio oscillator, no provider or microphone', composer: common, explicitSends: 1 });
      await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('phantom:invoke'); ipcMain.handle('phantom:invoke', globalThis.sessionDesignFixture.original); delete globalThis.sessionDesignFixture; });
      await invoke('node.remove', { workspaceId, id: session.id });
    }
    if (paintFailed || errors.length) throw new Error(`Design capture failed: ${errors.join('; ')}`);
  console.log(JSON.stringify({ label, captures, observations, errors }, null, 2));
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
    .filter(file => /\.(css|jsx|js|mjs)$/.test(file));
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
await Promise.all([
  new Promise(resolve => process.stdout.write('', resolve)),
  new Promise(resolve => process.stderr.write('', resolve)),
]);
process.exit(process.exitCode || 0);
