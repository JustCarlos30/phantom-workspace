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
];
const capture = async name => {
  const filename = path.join(temp, `${name}.png`);
  await page.screenshot({ path: filename }); captures.push(filename);
};
const style = panel => panel.evaluate(el => {
  const css = getComputedStyle(el), edge = getComputedStyle(el, '::after');
  const colors = Object.fromEntries(['--success', '--danger', '--attention', '--working', '--accent', '--hairline'].map(token => {
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
  return { colors, borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => css[`border${side}Color`]),
    borderStyles: ['Top', 'Right', 'Bottom', 'Left'].map(side => css[`border${side}Style`]),
    widths: ['Top', 'Right', 'Bottom', 'Left'].map(side => css[`border${side}Width`]),
    radius: css.borderRadius, edgeRadius: edge.borderRadius, shadow: edge.boxShadow,
    gradient: edge.backgroundImage, backgroundSize: edge.backgroundSize, opacity: Number(edge.opacity),
    outline: css.outlineColor, outlineWidth: css.outlineWidth, outlineOffset: css.outlineOffset,
    animation: edge.animationName, iterations: edge.animationIterationCount, duration: edge.animationDuration,
    running: el.getAnimations().filter(a => a.playState === 'running').length };
});
const assertEdge = async (panel, fixture) => {
  // Let the actual border-color transition complete before sampling.
  await page.waitForTimeout(220);
  const css = await style(panel), color = css.colors[fixture.token];
  assert.ok(css.borders.every(border => border !== color), `${fixture.title}: activity does not recolor the panel border`);
  assert.ok(css.widths.every(width => width === css.widths[0]), 'Continuous, uniform border');
  assert.ok(parseFloat(css.widths[0]) > 0, 'Ordinary border has visible thickness');
  assert.deepEqual(css.borderStyles, ['solid', 'solid', 'solid', 'solid'], 'Ordinary border is uninterrupted');
  assert.equal(css.edgeRadius, css.radius, 'Pulse inherits the actual panel radius');
  assert.equal(css.shadow, 'none', 'Activity adds no inset perimeter');
  assert.ok(css.gradient.includes('linear-gradient') && css.gradient.includes(color), 'Bottom glint uses the semantic token');
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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1840, 1200));
  await page.locator('.canvas-node').first().waitFor();
  const connectedHost = await page.evaluate(() => window.phantom.invoke('system.info', {}));
  assert.equal(connectedHost.dataDir, dataDir, 'Electron uses only the temporary fixture profile');
  assert.equal(connectedHost.pid, process.pid, 'Electron connects to the owned synthetic host');
  const canvas = page.locator('.canvas');
  await canvas.focus(); await page.keyboard.press('0'); await page.waitForTimeout(300);
  for (const fixture of fixtures) {
    const panel = page.locator(`[data-node-id="${fixture.nodeId}"]`);
    if (!fixture.pulse) {
      assert.equal(await panel.evaluate(el => [...el.classList].some(c => c.startsWith('pulse-'))), false);
      continue;
    }
    await page.locator(`[data-node-id="${fixture.nodeId}"].pulse-${fixture.pulse}`).waitFor();
    const css = await assertEdge(panel, fixture);
    if (['success', 'error'].includes(fixture.pulse)) {
      assert.notEqual(css.animation, 'none', 'Completion announces itself with a pulse');
      assert.ok(css.duration.split(',').every(duration => parseFloat(duration) <= .6), 'Completion glints last at most 0.6 s');
      assert.equal(css.iterations.split(',')[0].trim(), fixture.pulse === 'error' ? '3' : '1', 'Completion glints repeat only as specified');
    }
  }
  await capture('01-states');
  checks.push('Real activity → Canvas: success, failure, approval, review, unknown and lost');

  for (const fixture of fixtures.filter(f => ['success', 'error', 'attention'].includes(f.pulse)).slice(0, 3)) {
    const panel = page.locator(`[data-node-id="${fixture.nodeId}"]`);
    await panel.locator('.node-glyph').click();
    assert.ok((await panel.getAttribute('class')).includes('selected'));
    await panel.hover();
    await panel.locator('.title-button').focus();
    const css = await assertEdge(panel, fixture);
    assert.equal(css.outline, css.colors['--accent'], 'Selection has an independent accent outline');
    assert.equal(css.outlineWidth, '2px'); assert.equal(css.outlineOffset, '3px');
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
  }
  checks.push('State survives selection outline, hover, keyboard focus, real drag and focus mode');

  // Exercise the actual camera tier rather than manufacturing overview classes.
  await page.getByRole('button', { name: /Zoom .*Opciones de zoom/ }).click();
  await page.locator('.canvas-zoom-presets').getByRole('button', { name: '25%', exact: true }).click();
  await page.locator('.canvas-node.overview').first().waitFor();
  for (const fixture of fixtures.filter(f => f.token)) {
    await assertEdge(page.locator(`[data-node-id="${fixture.nodeId}"]`), fixture);
  }
  await capture('04-overview');
  // By now the short success/error pulses must have settled without looping.
  for (const fixture of fixtures.filter(f => ['success', 'error'].includes(f.pulse))) {
    const css = await assertEdge(page.locator(`[data-node-id="${fixture.nodeId}"]`), fixture);
    assert.notEqual(css.iterations, 'infinite'); assert.equal(css.running, 0);
    assert.equal(css.opacity, fixture.pulse === 'error' ? .12 : 0, 'Only failure retains a dim bottom glint');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const fixture of fixtures.filter(f => f.token)) {
    const css = await assertEdge(page.locator(`[data-node-id="${fixture.nodeId}"]`), fixture);
    assert.equal(css.animation, 'none'); assert.equal(css.running, 0);
    assert.equal(css.opacity, .2, 'Reduced motion keeps a dim static bottom glint');
    assert.equal(css.backgroundSize, '35% 0.8px, 35% 3px', 'Static glint stays in the centre of the bottom edge');
  }
  await capture('05-reduced-motion');
  await page.getByRole('button', { name: 'Ajustar todos los paneles', exact: true }).click();
  const success = fixtures[0], successPanel = page.locator(`[data-node-id="${success.nodeId}"]`);
  await successPanel.locator('.node-glyph').click();
  await successPanel.hover();
  await successPanel.locator('.title-button').focus();
  const reducedSelected = await assertEdge(successPanel, success);
  assert.equal(reducedSelected.outline, reducedSelected.colors['--accent']);
  assert.equal(reducedSelected.animation, 'none'); assert.equal(reducedSelected.running, 0);
  await successPanel.getByRole('button', { name: 'Enfocar panel', exact: true }).click();
  await page.locator(`[data-node-id="${success.nodeId}"].focused`).waitFor();
  const reducedFocus = await assertEdge(successPanel, success);
  assert.equal(reducedFocus.animation, 'none'); assert.equal(reducedFocus.running, 0);
  await capture('06-reduced-motion-focus');
  checks.push('Overview inherits radius; terminal pulses settle; reduced motion disables animations');

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
      const css = await assertEdge(successPanel, { title: `${status}: ${String(exitCode)}`, token });
      assert.equal(css.animation, 'none');
    } else {
      await page.waitForTimeout(220);
      const css = await style(successPanel);
      assert.ok(css.borders.every(color => color !== css.colors['--success']), 'Unknown exit revokes the green border');
      assert.equal(css.opacity, 0, 'Unknown exit leaves no stale success inner edge');
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
