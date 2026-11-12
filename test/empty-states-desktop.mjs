import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Production Electron + real host. No renderer/API mocks or provider prompts.
// The controller builds and runs this script; captures survive fixture cleanup.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = '/tmp/opencode';
await mkdir(evidence, { recursive: true });
const temp = await mkdtemp(path.join(evidence, 'phantom-empty-states-'));
const profile = path.join(temp, 'profile');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const sizes = [[1520, 980], [1100, 760]];
const checks = [], captures = [], errors = [];
let app, appProcess, page, host, current = 'startup';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);

async function size(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(580, 500);
    win.setContentSize(w, h);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
}

async function inspect(label, required) {
  current = label;
  for (const [selector, count] of required) {
    const locator = page.locator(selector);
    await locator.first().waitFor({ state: 'visible' });
    assert.equal(await locator.count(), count, `${label}: expected ${count} instances of ${selector}`);
    for (const item of await locator.all()) assert.ok(await item.isVisible(), `${label}: required state hidden: ${selector}`);
  }
  // Presence/layout transitions must settle before comparing real rectangles.
  await page.waitForFunction(() => document.getAnimations().every(animation =>
    animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await page.evaluate(() => {
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, center: (r.left + r.right) / 2 };
    };
    const identity = el => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().replace(/\s+/g, '.')}` : ''}`;
    const all = [...document.querySelectorAll('.empty-state')];
    const visible = all.filter(el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
    return {
      total: all.length, hidden: all.length - visible.length,
      states: visible.map(el => {
        const content = el.querySelector(':scope > .empty-state__content');
        const parent = el.parentElement;
        const canvas = el.closest('.canvas');
        const compact = el.classList.contains('empty-state--compact');
        const hero = el.classList.contains('empty-state--hero');
        const inspectorHost = document.querySelector('.studio-inspector-open .inspector-host');
        const inspector = hero && inspectorHost?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ? rect(inspectorHost) : null;
        // Measure the free canvas independently of the hero's CSS reservation.
        // Only 851–1100px changes centering; larger viewports keep their reference.
        const freeCanvas = hero && canvas && inspector && innerWidth >= 851 && innerWidth <= 1100
          ? { left: rect(canvas).left, right: Math.min(rect(canvas).right, inspector.left),
              center: (rect(canvas).left + Math.min(rect(canvas).right, inspector.left)) / 2 }
          : null;
        let reference = null, expectedLeft = null;
        if (compact) {
          const group = el.closest('.rail-panel-group');
          if (group) {
            reference = group.querySelector('.rail-heading > span');
            expectedLeft = reference?.getBoundingClientRect().left;
          } else if (el.closest('.panel-index-items')) {
            reference = el.closest('.panel-index').querySelector('.popover-heading > strong');
            expectedLeft = reference?.getBoundingClientRect().left;
          }
          // Unknown compact anatomy is a failure, never a self-referential inset check.
        }
        const overflow = [];
        for (let node = el; node; node = node.parentElement) {
          // The infinite canvas scroll extent includes its world, not just this state.
          if (node.matches('.canvas')) break;
          if (node.scrollWidth > node.clientWidth) overflow.push({ element: identity(node), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth });
        }
        for (const node of el.querySelectorAll('*')) {
          if (node.clientWidth > 0 && node.scrollWidth > node.clientWidth) overflow.push({ element: identity(node), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth });
        }
        return { element: identity(el), text: el.textContent.trim(), compact, hero, inspector, freeCanvas,
          knownSize: ['hero', 'panel', 'compact'].some(size => el.classList.contains(`empty-state--${size}`)),
          box: rect(el), content: content ? rect(content) : null, container: rect(parent), canvas: canvas ? rect(canvas) : null,
          reference: reference ? identity(reference) : null, expectedLeft, overflow };
      }),
    };
  });
  const capture = path.join(evidence, `empty-states-${label}.png`);
  await page.screenshot({ path: capture });
  captures.push(capture);
  assert.ok(result.states.length, `${label}: no visible .empty-state found`);
  for (const state of result.states) {
    const context = `${label}: ${state.element} «${state.text}»`;
    assert.ok(state.knownSize, `${context}: unknown EmptyState size`);
    assert.ok(state.content, `${context}: missing .empty-state__content`);
    if (state.canvas) {
      assert.ok(state.content.left >= state.canvas.left - 1,
        `${context}: content left ${state.content.left}px outside visible canvas left ${state.canvas.left}px (tolerance ±1px)`);
      assert.ok(state.content.right <= state.canvas.right + 1,
        `${context}: content right ${state.content.right}px outside visible canvas right ${state.canvas.right}px (tolerance ±1px)`);
    }
    if (state.hero && state.inspector) {
      const separated = state.content.right + 8 <= state.inspector.left
        || state.content.left - 8 >= state.inspector.right
        || state.content.bottom + 8 <= state.inspector.top
        || state.content.top - 8 >= state.inspector.bottom;
      assert.ok(separated, `${context}: hero content intersects inspector with 8px margin`);
      if (state.freeCanvas) {
        assert.ok(Math.abs(state.content.center - state.freeCanvas.center) <= 2,
          `${context}: hero content center ${state.content.center}px differs from free canvas ${state.freeCanvas.center}px (tolerance ±2px)`);
      }
    }
    if (state.compact) {
      assert.ok(state.reference && Number.isFinite(state.expectedLeft), `${context}: no independent panel/header alignment reference`);
      assert.ok(Math.abs(state.content.left - state.expectedLeft) <= 2,
        `${context}: compact left ${state.content.left}px differs from ${state.reference} ${state.expectedLeft}px (tolerance ±2px)`);
    } else {
      const center = state.freeCanvas?.center ?? state.container.center;
      assert.ok(Math.abs(state.box.center - center) <= 2,
        `${context}: box center ${state.box.center}px differs from container/free canvas ${center}px (tolerance ±2px)`);
      assert.ok(Math.abs(state.content.center - center) <= 2,
        `${context}: content center ${state.content.center}px differs from container/free canvas ${center}px (tolerance ±2px)`);
    }
    assert.deepEqual(state.overflow, [], `${context}: horizontal overflow (scrollWidth must be <= clientWidth): ${JSON.stringify(state.overflow)}`);
  }
  checks.push({ scenario: label, ...result });
}

try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
  appProcess = app.process();
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  assert.equal((await invoke('state.get')).workspaces.length, 0, 'Isolated profile must start with no projects');

  // These are real no-project empty states. The built-in plugin registry and
  // installed Skills are not assumed to be empty on the controller's machine.
  for (const [width, height] of sizes) {
    await size(width, height);
    const suffix = `${width}x${height}`;
    await inspect(`welcome-${suffix}`, [['.welcome-canvas > .empty-state--hero', 1]]);
    await page.getByRole('button', { name: 'Configuración', exact: true }).click();
    await page.getByLabel('Herramienta contextual').selectOption('skills-catalog');
    await inspect(`skills-no-project-${suffix}`, [['.tw-inspector .empty-state--panel', 1], ['.welcome-canvas > .empty-state--hero', 1]]);
    await page.getByLabel('Herramienta contextual').selectOption('plugins');
    await inspect(`plugins-no-project-${suffix}`, [['.plugin-center > .empty-state--panel', 1], ['.welcome-canvas > .empty-state--hero', 1]]);
    await page.locator('.inspector-switcher').getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
    await page.locator('.inspector-host').waitFor({ state: 'hidden' });
  }

  const project = path.join(temp, 'Proyecto vacío');
  await mkdir(project);
  await invoke('workspace.open', { path: project });
  await page.reload();
  await page.locator('.canvas:not(.welcome-canvas) > .empty-state--hero').waitFor();
  const state = await invoke('state.get');
  const workspace = state.workspaces.find(item => item.id === state.activeWorkspaceId);
  assert.ok(workspace, 'Empty project must be active');
  assert.equal(workspace.nodes.length, 0, 'Project must have no canvas panels');
  for (const [width, height] of sizes) {
    await size(width, height);
    const suffix = `${width}x${height}`;
    const required = [['.canvas > .empty-state--hero', 1], ['.rail-panel-group .empty-state--compact', 2]];
    await inspect(`canvas-rail-${suffix}`, required);
    await page.getByRole('button', { name: 'Buscar en paneles', exact: true }).click();
    await inspect(`panel-index-${suffix}`, [...required, ['.panel-index-items > .empty-state--compact', 1]]);
    await page.getByRole('button', { name: 'Cerrar lista', exact: true }).click();
    await page.locator('.panel-index').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Abrir chat con Phantom', exact: true }).click();
    await inspect(`chat-${suffix}`, [...required, ['.phantom-chat .empty-state--panel', 1]]);
    await page.locator('.phantom-chat').getByRole('button', { name: 'Cerrar chat con Phantom', exact: true }).click();
    await page.locator('.phantom-chat').waitFor({ state: 'hidden' });
  }
  assert.deepEqual(errors, [], `Renderer exceptions: ${errors.join('; ')}`);
  console.log(JSON.stringify({ passed: true, scenarios: checks.length, sizes, tolerancePx: 2,
    coverage: 'welcome, no-project Skills/Plugins, empty project canvas, both rail groups, panel index, new Phantom chat',
    checks, captures, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, 'empty-states-failure.png') }).catch(() => {});
  console.error(JSON.stringify({ passed: false, scenario: current, completed: checks.map(check => check.scenario), captures, errors, error: error.message }));
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
    try {
      if (app) await Promise.race([app.close().catch(() => {}), delay(2500)]);
    } finally {
      if (appProcess?.exitCode === null && appProcess?.signalCode === null) appProcess.kill('SIGKILL');
      await rm(temp, { recursive: true, force: true });
    }
  }
}
