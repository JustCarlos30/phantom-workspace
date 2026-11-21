import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHost } from '../host/server.mjs';
import { killElectronGroup } from './support/electron-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp('/tmp/phantom-terminal-borders-');
const folder = path.join(temp, 'Border fixtures');
const dataDir = path.join(temp, 'profile');
await mkdir(folder);
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: dataDir, PHANTOM_NODE_BINARY: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
let host, app, appProcess, page;
const errors = [], captures = [], checks = [];
const fixtures = [
  { title: 'Éxito · salida 0', status: 'exited', exitCode: 0, agent: 'working', pulse: 'success', token: '--success' },
  { title: 'Error · salida 7', status: 'exited', exitCode: 7, agent: 'blocked', pulse: 'error', token: '--danger' },
  { title: 'Aprobación · intervención', status: 'running', agent: 'blocked', pulse: 'attention', token: '--attention' },
  { title: 'Review · tu turno', status: 'running', agent: 'review', pulse: 'turn', token: '--attention' },
  { title: 'Salida desconocida', status: 'exited', agent: 'working', pulse: '' },
  { title: 'Sesión perdida', status: 'lost', agent: 'working', pulse: 'error', token: '--danger' },
  { title: 'Error declarado del agente', status: 'running', agent: 'working', agentState: 'failed', pulse: 'error', token: '--danger' },
  { title: 'Aprobación declarada del agente', status: 'running', agent: 'working', agentState: 'needs_approval', pulse: 'attention', token: '--attention' },
  { title: 'Código no numérico · sin éxito', status: 'exited', exitCode: '0', agent: 'blocked', pulse: '' },
  { title: 'Trabajo · cometa A', status: 'running', agent: 'working', pulse: 'working', token: '--working' },
];
const capture = async name => {
  const filename = path.join(temp, `${name}.png`);
  await page.screenshot({ path: filename }); captures.push(filename);
};
const settled = () => page.waitForFunction(async () => {
  const world = document.querySelector('.canvas-world');
  if (!world || document.fonts.status !== 'loaded') return false;
  const transform = world.style.transform;
  await new Promise(requestAnimationFrame);
  const scale = new DOMMatrix(getComputedStyle(world).transform).a;
  return world.style.transform === transform
    && Math.abs(scale * Number(getComputedStyle(world).getPropertyValue('--overview-scale')) - 1) < .000001
    && !document.querySelector('.app-shell[data-focus-moving], .canvas[data-sliding]')
    && !document.getAnimations().some(animation => animation.effect?.getTiming().iterations !== Infinity && (animation.pending || animation.playState === 'running'));
});
const style = panel => panel.evaluate(el => {
  const css = getComputedStyle(el), trace = el.querySelector('.activity-trace');
  const head = trace?.querySelector('.activity-trace__head');
  const edge = head ? getComputedStyle(head) : null, ring = getComputedStyle(el, '::before');
  const colors = Object.fromEntries(['--success', '--danger', '--attention', '--working', '--working-head', '--muted', '--attention-ring'].map(token => {
    // The global reduced-motion rule assigns a tiny !important transition
    // duration even to spans. Reusing a probe then samples the previous token
    // while its colour transition is pending. Resolve each token independently
    // with motion disabled on the probe, leaving the panel styles untouched.
    const probe = document.createElement('span');
    probe.style.setProperty('transition', 'none', 'important');
    probe.style.setProperty('animation', 'none', 'important');
    probe.style.color = `var(${token})`;
    el.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return [token, color];
  }));
  const probe = document.createElement('span');
  probe.style.backgroundImage = el.classList.contains('selected') ? 'linear-gradient(var(--selected-edge-top), var(--selected-edge-bottom))' : 'linear-gradient(var(--object-edge-top), var(--object-edge-bottom))';
  probe.style.boxShadow = 'var(--shadow-chrome)';
  el.append(probe); const neutral = getComputedStyle(probe).backgroundImage, shadow = getComputedStyle(probe).boxShadow; probe.remove();
  const label = el.querySelector('.node-header > .panel-state');
  return { colors, neutral, expectedShadow: shadow, state: el.dataset.panelState, label: label?.textContent, labelVisible: !!label?.getClientRects().length, labelColor: label && getComputedStyle(label).color,
    ring: { background: ring.backgroundColor, image: ring.backgroundImage, padding: ring.paddingTop, mask: ring.maskComposite, radius: ring.borderRadius, pointer: ring.pointerEvents, inset: [ring.top, ring.right, ring.bottom, ring.left] },
    widths: ['Top', 'Right', 'Bottom', 'Left'].map(side => css[`border${side}Width`]),
    radius: css.borderRadius, overviewScale: el.matches('.overview') ? Number(css.getPropertyValue('--ov')) : 1, edgeRadius: edge?.rx, stroke: edge?.stroke, strokeWidth: edge?.strokeWidth,
    dash: edge?.strokeDasharray, filter: edge?.filter,
    rects: trace ? [...trace.children].map(rect => { const s = getComputedStyle(rect), box = rect.getBBox(); return { path: rect.getAttribute('pathLength'), length: s.getPropertyValue('--L').trim(), opacity: Number(s.opacity), x: s.x, y: s.y, ry: s.ry, width: box.width, height: box.height, cap: s.strokeLinecap, stroke: s.stroke, filter: s.filter, fill: s.fill }; }) : [],
    traceSize: trace && { width: trace.clientWidth, height: trace.clientHeight, zIndex: getComputedStyle(trace).zIndex },
    pointer: trace ? getComputedStyle(trace).pointerEvents : null,
    outlineWidth: css.outlineWidth, shadow: css.boxShadow,
    animation: edge?.animationName || 'none', iterations: edge?.animationIterationCount, duration: edge?.animationDuration, easing: edge?.animationTimingFunction,
    running: trace?.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length || 0 };
});
const assertEdge = async (panel, fixture) => {
  const state = ({ attention: 'attention', turn: 'attention', success: 'finished', working: 'working', error: 'error' })[fixture.pulse] || 'rest';
  await page.waitForFunction(({ id, state }) => document.querySelector(`[data-node-id="${id}"]`)?.dataset.panelState === state, { id: await panel.getAttribute('data-node-id'), state });
  await settled();
  const css = await style(panel);
  assert.deepEqual(css.widths, ['0px', '0px', '0px', '0px'], 'The mask replaces the CSS border');
  assert.equal(css.outlineWidth, '0px', 'No second selection contour');
  assert.equal(css.shadow, css.expectedShadow, 'Only the black contact shadow, no exterior halo');
  assert.deepEqual(css.ring.mask.split(',').map(value => value.trim()), ['exclude', 'exclude'], 'Both mask layers use exclusion');
  assert.equal(css.ring.radius, css.radius);
  assert.deepEqual(css.ring.inset, ['0px', '0px', '0px', '0px']);
  assert.equal(css.ring.pointer, 'none');
  assert.ok(Math.abs(parseFloat(css.ring.padding) - css.overviewScale) < .01, 'One pixel ring, including semantic zoom');
  assert.ok(css.labelVisible, `${fixture.title}: header state remains visible`);
  assert.equal(css.state, state);
  assert.equal(css.label, ({ attention: 'Te necesita', finished: 'Terminó', working: 'Trabajando', error: 'Error', rest: 'En reposo' })[state]);
  assert.equal(css.labelColor, css.colors[state === 'attention' ? '--attention' : state === 'error' ? '--danger' : '--muted']);
  if (state === 'attention') {
    assert.equal(css.ring.background, css.colors['--attention-ring']);
    assert.equal(css.ring.image, 'none');
  } else assert.equal(css.ring.image, css.neutral, 'Rest, completion and work keep a neutral ring');
  if (state === 'working') {
    assert.equal(parseFloat(css.edgeRadius), parseFloat(css.radius) - .75);
    assert.equal(css.strokeWidth, '1.5px');
    assert.equal(css.stroke, css.colors['--working-head']);
    assert.equal(css.pointer, 'none');
    assert.equal(css.traceSize.zIndex, '4');
    assert.deepEqual(css.rects.map(rect => rect.path), Array(5).fill('100'));
    assert.deepEqual(css.rects.map(rect => rect.length), ['26px', '18px', '11px', '6px', '2.5px']);
    assert.deepEqual(css.rects.map(rect => rect.opacity), [.06, .14, .28, .55, 1]);
    assert.ok(css.rects.every(rect => rect.x === '0.75px' && rect.y === '0.75px' && rect.filter === 'none'));
    for (const rect of css.rects) {
      assert.equal(rect.fill, 'none'); assert.equal(parseFloat(rect.ry), parseFloat(css.radius) - .75);
      assert.ok(Math.abs(rect.width - (css.traceSize.width - 1.5)) <= .5);
      assert.ok(Math.abs(rect.height - (css.traceSize.height - 1.5)) <= .5);
    }
    assert.ok(css.rects.slice(0, 4).every(rect => rect.stroke === css.colors['--working']));
    assert.deepEqual(css.rects.map(rect => rect.cap), ['butt', 'butt', 'butt', 'butt', 'round']);
  } else assert.equal(css.rects.length, 0, 'Only working mounts a trace');
  return css;
};

try {
  // Synthetic sessions only: no PTY, agent, model, or shell is started.
  host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  const workspace = await host.invoke('workspace.open', { path: folder });
  for (const [index, fixture] of fixtures.entries()) {
    const sessionId = randomUUID();
    const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal', title: fixture.title,
      x: (index % 3) * 400, y: 40 + Math.floor(index / 3) * 330, width: 360, height: 280,
      data: { sessionId, agent: { status: fixture.agent } } });
    fixture.nodeId = node.id;
    fixture.sessionId = sessionId;
    host.terminals.sessions.push({ id: sessionId, workspaceId: workspace.id, nodeId: node.id,
      status: fixture.status, exitCode: fixture.exitCode, agentState: fixture.agentState, createdAt: new Date().toISOString(),
      cols: 80, rows: 24, snapshot: '', seq: 0, pid: null });
  }
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
  appProcess = app.process();
  page = await app.firstWindow(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForLoadState('load');
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win.isVisible()) await new Promise(resolve => win.once('show', resolve));
    win.setContentSize(1840, 1200);
  });
  await page.locator('.canvas-node').first().waitFor();
  const zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  assert.ok(Number.isFinite(zoom) && zoom > 0, 'Native interface zoom is valid');
  await page.waitForFunction(zoom => Math.abs(innerWidth - 1840 / zoom) <= 1 && Math.abs(innerHeight - 1200 / zoom) <= 1, zoom);
  const connectedHost = await page.evaluate(() => window.phantom.invoke('system.info', {}));
  assert.equal(connectedHost.dataDir, dataDir, 'Electron uses only the temporary fixture profile');
  assert.equal(connectedHost.pid, process.pid, 'Electron connects to the owned synthetic host');
  await page.getByRole('button', { name: 'Ajustar todos los paneles', exact: true }).click();
  await settled();
  for (const fixture of fixtures) {
    const panel = page.locator(`[data-node-id="${fixture.nodeId}"]`);
    if (!fixture.pulse) {
      assert.equal(await panel.evaluate(el => [...el.classList].some(c => c.startsWith('pulse-'))), false);
      assert.equal(await panel.locator('.activity-trace').count(), 0);
      await assertEdge(panel, fixture);
      continue;
    }
    await page.locator(`[data-node-id="${fixture.nodeId}"].pulse-${fixture.pulse}`).waitFor();
    const css = await assertEdge(panel, fixture);
    if (fixture.pulse === 'working') {
      assert.deepEqual(css.dash.match(/[\d.]+/g).map(Number), [2.5, 97.5]);
      assert.equal(css.duration, '5.6s'); assert.equal(css.iterations, 'infinite');
      assert.equal(css.easing, 'linear');
    } else {
      assert.equal(css.animation, 'none'); assert.equal(css.running, 0);
    }
  }
  await capture('01-states');
  checks.push('Real activity → Canvas: success, failure, approval, review, unknown and lost');

  for (const fixture of fixtures.filter(f => ['success', 'error', 'attention'].includes(f.pulse)).slice(0, 3)) {
    const panel = page.locator(`[data-node-id="${fixture.nodeId}"]`);
    await panel.locator('.node-glyph').click();
    await page.waitForFunction(id => document.querySelector(`[data-node-id="${id}"]`)?.getAttribute('aria-current') === 'true', fixture.nodeId);
    assert.ok((await panel.getAttribute('class')).includes('selected'));
    await panel.hover();
    await panel.locator('.title-button').focus();
    const css = await assertEdge(panel, fixture);
    assert.equal(css.outlineWidth, '0px');
    assert.equal(await panel.getAttribute('aria-current'), 'true');
    const glyph = await panel.locator('.node-glyph').boundingBox();
    await page.mouse.move(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2);
    await page.mouse.down();
    try {
      await page.mouse.move(glyph.x + 45, glyph.y + 25, { steps: 5 });
      await page.locator(`[data-node-id="${fixture.nodeId}"].is-dragging`).waitFor();
      await assertEdge(panel, fixture);
      await capture(`02-drag-${fixture.pulse}`);
    } finally { await page.mouse.up(); }
    await panel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
    await page.locator(`[data-node-id="${fixture.nodeId}"].focused`).waitFor();
    await assertEdge(panel, fixture);
    await capture(`03-focus-${fixture.pulse}`);
    // Focus mode has a dedicated return control outside the clipped stage.
    await page.locator('.focus-return').getByRole('button', { name: 'Volver al mapa', exact: true }).click();
    await page.locator('.canvas.focus-mode').waitFor({ state: 'hidden' });
    await settled();
  }
  checks.push('State survives selection on the same ring, hover, keyboard focus, real drag and focus mode');

  // Exercise the actual camera tier rather than manufacturing overview classes.
  await page.getByRole('button', { name: /Zoom .*Opciones de zoom/ }).click();
  await page.locator('.canvas-zoom-presets').getByRole('button', { name: '25%', exact: true }).click();
  await page.locator('.canvas-node.overview').first().waitFor();
  for (const fixture of fixtures.filter(f => f.token)) {
    await assertEdge(page.locator(`[data-node-id="${fixture.nodeId}"]`), fixture);
  }
  await capture('04-overview');
  assert.equal(await page.locator('.pixel-field').count(), 0, 'No exterior wave field');
  const workingPanel = page.locator(`[data-node-id="${fixtures.at(-1).nodeId}"]`);
  await page.getByRole('button', { name: `Ver ${fixtures.at(-1).title} en el mapa`, exact: true }).click();
  await settled();
  await page.waitForFunction(id => document.querySelector(`[data-node-id="${id}"] .activity-trace`)?.dataset.visible === 'true', fixtures.at(-1).nodeId);
  for (const reason of ['concentration', 'document', 'offscreen', 'panel']) {
    await workingPanel.evaluate((el, reason) => {
      if (reason === 'concentration') document.querySelector('.app-shell').classList.add('studio-concentration');
      if (reason === 'document') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
      if (reason === 'offscreen') el.style.transform = 'translateX(-100000px)';
      if (reason === 'panel') el.style.display = 'none';
    }, reason);
    await page.waitForFunction(({ id, reason }) => {
      const head = document.querySelector(`[data-node-id="${id}"] .activity-trace__head`);
      const animations = head.getAnimations();
      return getComputedStyle(head).animationPlayState === 'paused'
        && animations.length === (reason === 'panel' ? 0 : 1)
        && animations.every(animation => !animation.pending && animation.playState === 'paused');
    }, { id: fixtures.at(-1).nodeId, reason });
    const offsets = await workingPanel.locator('.activity-trace__head').evaluate(async el => {
      const before = getComputedStyle(el).strokeDashoffset;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return [before, getComputedStyle(el).strokeDashoffset];
    });
    assert.equal(offsets[0], offsets[1], `${reason}: paused phase is stable`);
    await workingPanel.evaluate(el => {
      document.querySelector('.app-shell').classList.remove('studio-concentration');
      delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
      el.style.removeProperty('transform'); el.style.removeProperty('display');
    });
    await page.waitForFunction(id => {
      const head = document.querySelector(`[data-node-id="${id}"] .activity-trace__head`);
      const animations = head.getAnimations();
      return getComputedStyle(head).animationPlayState === 'running' && animations.length === 1
        && animations.every(animation => !animation.pending && animation.playState === 'running');
    }, fixtures.at(-1).nodeId);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const fixture of fixtures.filter(f => f.token)) {
    const css = await assertEdge(page.locator(`[data-node-id="${fixture.nodeId}"]`), fixture);
    assert.equal(css.animation, 'none'); assert.equal(css.running, 0);
    if (fixture.pulse === 'working') assert.equal(css.rects.length, 5, 'Reduced motion leaves a static comet');
  }
  await capture('05-reduced-motion');
  await page.getByRole('button', { name: 'Ajustar todos los paneles', exact: true }).click();
  await settled();
  const success = fixtures[0], successPanel = page.locator(`[data-node-id="${success.nodeId}"]`);
  await successPanel.locator('.node-glyph').click();
  await successPanel.hover();
  await successPanel.locator('.title-button').focus();
  const reducedSelected = await assertEdge(successPanel, success);
  assert.equal(reducedSelected.outlineWidth, '0px');
  assert.equal(reducedSelected.animation, 'none'); assert.equal(reducedSelected.running, 0);
  await successPanel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
  await page.locator(`[data-node-id="${success.nodeId}"].focused`).waitFor();
  const reducedFocus = await assertEdge(successPanel, success);
  assert.equal(reducedFocus.animation, 'none'); assert.equal(reducedFocus.running, 0);
  await capture('06-reduced-motion-focus');
  checks.push('Overview follows the ring; hidden panels/document and Concentration pause; reduced motion keeps static states');

  // Drive the real host event → activity → Canvas path without remounting the
  // renderer. Old agent signals must not survive process completion, and a
  // formerly successful session must not leave a green edge behind.
  await page.locator('.focus-return').getByRole('button', { name: 'Volver al mapa', exact: true }).click();
  await page.locator('.canvas.focus-mode').waitFor({ state: 'hidden' });
  const session = host.terminals.sessions.find(s => s.id === success.sessionId);
  for (const [status, exitCode, agentState, pulse, token] of [
    ['running', undefined, 'working', 'working', '--working'],
    ['exited', 0, 'needs_approval', 'success', '--success'],
    ['exited', undefined, 'working', '', undefined],
    ['lost', 0, 'needs_approval', 'error', '--danger'],
    ['running', 0, 'review', 'turn', '--attention'],
    ['exited', 7, 'working', 'error', '--danger'],
  ]) {
    Object.assign(session, { status, exitCode, agentState });
    host.emit({ type: 'session.changed', workspaceId: workspace.id, sessionId: session.id });
    await page.waitForFunction(({ id, pulse }) => {
      const el = document.querySelector(`[data-node-id="${id}"]`);
      const signals = [...(el?.classList || [])].filter(c => c.startsWith('pulse-'));
      return pulse ? signals.length === 1 && signals[0] === `pulse-${pulse}` : el && signals.length === 0;
    }, { id: success.nodeId, pulse });
    if (token) {
      const css = await assertEdge(successPanel, { title: `${status}: ${String(exitCode)}`, pulse, token });
      assert.equal(css.animation, 'none');
    } else {
      await settled();
      const css = await style(successPanel);
      assert.equal(css.ring.image, css.neutral, 'Unknown exit retains the neutral ring');
      assert.equal(css.rects.length, 0, 'Unknown exit leaves no stale trace');
    }
  }
  await capture('07-live-state-transitions');
  checks.push('Live session updates revoke success and override stale agent work/approval without reload');
  assert.equal(host.terminals.live.size, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, captures }));
} catch (error) {
  await page?.screenshot({ path: path.join(temp, 'failure.png') }).catch(() => {});
  console.error({ evidence: temp, errors }); throw error;
} finally {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  await Promise.race([app?.close().catch(() => {}), delay(2500)]);
  killElectronGroup(appProcess);
  await host?.close();
}
