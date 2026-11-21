import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

// The controller runs this file against the production build. All fixtures and
// captures are temporary; no application profile or project files are reused.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/phantom-sidebar-');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile'), PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Sidebar browser fixture</title><h1>Native browser fixture</h1><input aria-label="Native input">'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let app, page, host, appProcess;
const errors = [], checks = [];
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await fn()) return; await delay(80); }
  assert.fail(message);
}
async function size(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(580, 500); win.setContentSize(w, h);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
}
const nativeViews = () => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  return win.contentView.children.filter(view => view.webContents && view.webContents.id !== win.webContents.id)
    .map(view => ({ visible: view.getVisible(), bounds: view.getBounds(), url: view.webContents.getURL() }));
});
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
async function layout(drawer = false) {
  const rail = await page.locator('.project-rail').boundingBox();
  // The expanded rail fills the available height with a 12px window inset.
  assert.ok(Math.abs(rail.x - 12) <= 1 / 64); assert.ok(Math.abs(rail.y - 12) <= 1 / 64); assert.ok(Math.abs(rail.width - 272) <= 1 / 64);
  assert.ok(Math.abs(rail.height - ((await page.evaluate(() => innerHeight)) - 24)) <= 1, 'Rail stops one gap short of the bottom edge');
  if (!drawer) {
    const canvas = await page.locator('.canvas').boundingBox();
    assert.equal(canvas.x, 0, 'Canvas runs under the rail, edge to edge');
    for (const selector of ['.canvas-navigation', '.dock-main']) {
      const bounds = await page.locator(selector).boundingBox();
      assert.ok(!overlap(rail, bounds), `${selector} clears the rail`);
    }
  }
  const overflow = await page.locator('.project-rail').evaluate(el => {
    const projects = el.querySelector('.project-list'), panels = el.querySelector('.rail-panels nav');
    return { rail: el.scrollWidth > el.clientWidth + 1, projects: projects.scrollHeight > projects.clientHeight, panels: panels.scrollHeight > panels.clientHeight,
      rows: [...projects.querySelectorAll('button')].every(row => row.getBoundingClientRect().height >= 36),
      truncatedNames: ['.project-label strong', '.rail-panel-label>span:first-child'].every(selector => [...el.querySelectorAll(selector)].some(label => label.scrollWidth > label.clientWidth && getComputedStyle(label).textOverflow === 'ellipsis')),
      horizontal: [projects, panels].some(list => list.scrollWidth > list.clientWidth + 1) };
  });
  assert.deepEqual(overflow, { rail: false, projects: true, panels: true, rows: true, truncatedNames: true, horizontal: false });
  assert.equal(await page.locator('.project-switcher > summary > .project-initials').isVisible(), false, 'Project heading starts at the shared text inset');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Long names do not widen the document');
}

// One detector process, after the interaction pass, also when that pass fails.
// PHANTOM_IMPECCABLE_BIN lets the controller supply its installed launcher.
async function detector() {
  const command = process.env.PHANTOM_IMPECCABLE_BIN || path.join(homedir(), '.claude/skills/impeccable/scripts/impeccable');
  const argv = ['detect', '--target', 'src/studio.css'];
  const result = await new Promise(resolve => {
    let stdout = '', stderr = '';
    const child = spawn(command, argv, { cwd: root, env: process.env, shell: false, timeout: 30000 });
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => resolve({ command, argv, error: error.message, stdout, stderr }));
    child.on('close', (code, signal) => resolve({ command, argv, code, signal, stdout, stderr }));
  });
  await writeFile(path.join(temp, 'impeccable-detector.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ detector: result }));
  assert.ok(!result.error && [0, 1].includes(result.code), 'Impeccable detector must run; exit 1 records findings, not visual approval');
}

try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
  appProcess = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor(); host = (await invoke('system.info')).pid;
  await size(1520, 980); await page.emulateMedia({ reducedMotion: 'reduce' });

  const folders = [];
  for (let i = 0; i < 14; i++) {
    const folder = path.join(temp, `Proyecto ${String(i).padStart(2, '0')} — nombre largo para revisar navegación y rutas del espacio`);
    await mkdir(folder); await invoke('workspace.open', { path: folder }); folders.push(folder);
  }
  const state = await invoke('state.get');
  const project = state.workspaces.find(w => w.path === folders[0]);
  const other = state.workspaces.find(w => w.path === folders[1]);
  const terminal = await invoke('node.create', { workspaceId: project.id, type: 'terminal', title: 'Terminal de desarrollo', x: 0, y: 60, width: 640, height: 640, data: {} });
  const { session } = await invoke('terminal.create', { workspaceId: project.id, nodeId: terminal.id, cols: 80, rows: 24 });
  await invoke('node.update', { workspaceId: project.id, id: terminal.id, patch: { data: { sessionId: session.id } } });
  const browser = await invoke('node.create', { workspaceId: project.id, type: 'browser', title: 'Navegador local', x: 700, y: 60, width: 700, height: 500, data: { url: `http://127.0.0.1:${server.address().port}/` } });
  for (let i = 0; i < 28; i++) await invoke('node.create', { workspaceId: project.id, type: 'note', title: `Nota ${i} — contexto extenso con un nombre que debe truncarse sin ensanchar la navegación`, x: 1500 + i * 440, y: 60, width: 420, height: 340, data: { text: 'Contenido sintético de prueba' } });
  await invoke('workspace.select', { id: project.id }); await page.reload(); await page.locator('.rail-panel-row').first().waitFor();
  const rail = page.locator('.project-rail');
  const projectButton = id => rail.locator('.project-item').filter({ has: page.locator(`#project-path-${id}`) });
  await projectButton(other.id).focus(); await page.keyboard.press('Enter');
  await until(async () => (await invoke('state.get')).activeWorkspaceId === other.id, 'Keyboard selects project');
  await until(async () => await rail.locator('.rail-empty').count() > 0, 'Empty panel state appears');
  await projectButton(project.id).click(); await page.locator('.rail-panel-row').first().waitFor();
  // Presence retains the previous project's inert canvas during its exit.
  // Wait for unmount before using unique canvas/panel layout locators.
  await until(async () => await page.locator('.canvas').count() === 1, 'Previous project canvas finishes its exit');
  assert.equal(await projectButton(project.id).getAttribute('aria-current'), 'true');
  assert.ok(await projectButton(project.id).getAttribute('aria-describedby'));
  await projectButton(project.id).focus(); await page.keyboard.press('End');
  assert.equal(await rail.locator('.project-item').last().evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Home');
  assert.equal(await rail.locator('.project-item').first().evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await rail.locator('.project-item').nth(1).evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('ArrowUp');
  assert.equal(await rail.locator('.project-item').first().evaluate(el => document.activeElement === el), true);
  assert.equal((await invoke('state.get')).activeWorkspaceId, project.id, 'List navigation moves focus without changing projects');
  checks.push('Project selection by keyboard and pointer, empty panel state and accessible paths');

  const lastPanel = rail.locator('.rail-panel-row>button:first-child').last();
  await rail.locator('.rail-panel-row>button:first-child').first().focus(); await page.keyboard.press('End');
  assert.equal(await rail.locator('.rail-panel-focus').last().evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('ArrowUp');
  assert.equal(await lastPanel.evaluate(el => document.activeElement === el), true);
  await lastPanel.click();
  assert.equal(await lastPanel.getAttribute('aria-current'), 'true', 'Last overflowing panel remains reachable');

  const mapTerminal = rail.getByRole('button', { name: 'Ver Terminal de desarrollo en el mapa', exact: true });
  const focusTerminal = rail.getByRole('button', { name: 'Enfocar Terminal de desarrollo', exact: true });
  await page.locator('.canvas').focus(); await page.mouse.move(700, 20);
  // Headless Electron may report no hover capability. The touch fallback keeps
  // secondary actions visible intentionally; wait for settled CSS in either mode.
  const noHover = await page.evaluate(() => matchMedia('(hover: none)').matches);
  await until(async () => await focusTerminal.evaluate(el => getComputedStyle(el).opacity) === (noHover ? '1' : '0'), 'Secondary action respects the real hover capability');
  await mapTerminal.hover();
  const row = mapTerminal.locator('..'), badge = row.locator('.rail-agent-mark');
  const bounds = await row.boundingBox(), badgeFill = await badge.evaluate(el => getComputedStyle(el).backgroundColor);
  assert.ok(Math.abs(bounds.height - 56) <= 1 / 64); assert.ok(Math.abs((await badge.boundingBox()).width - 32) <= 1 / 64);
  assert.ok(Math.abs((await badge.locator('svg').boundingBox()).width - 18) <= 1 / 64);
  assert.equal(await row.evaluate(el => getComputedStyle(el).borderRadius), '12px');
  assert.equal(await row.locator('.rail-session-dot').count(), 0);
  await page.mouse.down();
  assert.deepEqual(await row.boundingBox(), bounds, 'Press never scales or displaces the row');
  assert.equal(await badge.evaluate(el => getComputedStyle(el).backgroundColor), badgeFill);
  await page.mouse.up();
  await until(async () => await focusTerminal.evaluate(el => getComputedStyle(el).opacity) === '1', 'Hover exposes secondary action');
  await mapTerminal.focus(); await page.keyboard.press('Enter');
  await page.locator('.canvas-node.selected').waitFor();
  assert.equal(await mapTerminal.getAttribute('aria-current'), 'true');
  assert.equal(await badge.evaluate(el => getComputedStyle(el).backgroundColor), badgeFill, 'Selection keeps badge identity');
  assert.equal(await mapTerminal.evaluate(el => {
    const style = getComputedStyle(el), width = parseFloat(style.outlineWidth);
    return el.matches(':focus-visible') && style.outlineStyle === 'solid' && style.getPropertyValue('--focus-width').trim() === '2px'
      && width > 0 && Math.abs(width - 2) < 1 / devicePixelRatio;
  }), true, 'Keyboard focus remains visible at the desktop zoom');
  assert.equal(await row.locator('.rail-session-status').evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= el.closest('.rail-panel-label').getBoundingClientRect().right + 1), true);
  await page.mouse.move(700, 20);
  await until(async () => await focusTerminal.evaluate(el => getComputedStyle(el).opacity) === '1', 'Focus-within exposes secondary action');
  assert.equal(await mapTerminal.evaluate(el => document.activeElement === el), true, 'Terminal selection preserves keyboard ownership in the rail');
  await page.keyboard.press('Tab'); assert.equal(await focusTerminal.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Enter'); await page.locator('.canvas-node.focused .terminal-host').waitFor();
  assert.equal(await focusTerminal.getAttribute('aria-pressed'), 'true');
  const terminalBounds = await page.locator('.canvas-node.focused .terminal-host').boundingBox();
  assert.ok(!overlap(await rail.boundingBox(), terminalBounds));
  await page.locator('.canvas-node.focused .xterm-screen').click();
  await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'));
  await page.keyboard.type('sidebar-input');
  await until(async () => (await invoke('terminal.attach', { sessionId: session.id })).data.includes('sidebar-input'), 'Sidebar focus action retains real PTY input');
  await page.locator('.focus-return button').click();
  await page.waitForFunction(() => !document.querySelector('.canvas-node.focused'));
  assert.equal(await mapTerminal.getAttribute('aria-current'), 'true');
  checks.push('Panel selection, keyboard focus action, real PTY focus and return to map');

  await rail.getByRole('button', { name: 'Personalizar espacio' }).click();
  await page.locator('.appearance-panel').waitFor();
  await page.getByRole('button', { name: 'Marea', exact: true }).click(); await page.locator('.studio-tide').waitFor();
  await page.locator('.inspector-switcher').getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  await rail.getByRole('button', { name: 'Centro de Plugins', exact: true }).click();
  await page.locator('.canvas-node.focused .plugin-surface').waitFor();
  await rail.locator('.rail-map-action').click();
  await rail.getByRole('button', { name: 'Configuración', exact: true }).click();
  assert.equal(await page.getByLabel('Herramienta contextual').inputValue(), 'settings');
  await page.locator('.inspector-switcher').getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  await rail.getByRole('button', { name: /Comandos/ }).click();
  await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).waitFor(); await page.keyboard.press('Escape');
  await rail.getByRole('status').filter({ hasText: 'Host local conectado' }).waitFor();
  assert.equal(await rail.getByRole('button', { name: 'Abrir carpeta', exact: true }).isEnabled(), true);
  checks.push('Appearance changes, real Plugins panel, settings, commands, folder and connection access');

  // Compare computed text/background colors rather than assuming dark tokens
  // automatically satisfy the contrast floor.
  const contrast = await rail.evaluate(el => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
    const luminance = value => rgb(value).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const bg = luminance(getComputedStyle(el).backgroundColor);
    return ['.rail-heading', '.project-item.active', '.host-indicator', '.open-folder'].map(selector => {
      const style = getComputedStyle(el.querySelector(selector));
      const surface = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? bg : luminance(style.backgroundColor);
      const ink = luminance(style.color); return { selector, ratio: (Math.max(ink, surface) + .05) / (Math.min(ink, surface) + .05) };
    });
  });
  for (const sample of contrast) assert.ok(sample.ratio >= 4.5, `${sample.selector} text contrast ${sample.ratio}`);
  await layout(); await page.screenshot({ path: path.join(temp, 'sidebar-desktop.png') });
  await size(1100, 760); await layout();
  await rail.getByRole('button', { name: 'Personalizar espacio' }).click(); await page.locator('.appearance-panel').waitFor();
  const inspector = await page.locator('.inspector-host').boundingBox();
  for (const selector of ['.canvas-navigation', '.dock-main']) assert.ok(!overlap(inspector, await page.locator(selector).boundingBox()), `${selector} clears narrow inspector`);
  await page.screenshot({ path: path.join(temp, 'sidebar-narrow.png') });
  await page.locator('.inspector-switcher').getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  checks.push('Desktop/narrow captures, text contrast, long-name truncation, independent overflowing lists and inspector clearance');

  await rail.getByRole('button', { name: 'Enfocar Navegador local', exact: true }).click();
  await until(async () => (await nativeViews()).some(view => view.visible && view.url.includes('127.0.0.1')), 'Real native browser visible');
  for (const view of (await nativeViews()).filter(view => view.visible)) assert.ok(!overlap(await rail.boundingBox(), view.bounds), 'Native browser clears desktop rail');
  await size(850, 700);
  const toggle = page.getByRole('button', { name: 'Ver proyectos', exact: true });
  assert.equal(await rail.getAttribute('inert'), '');
  await toggle.focus(); await page.keyboard.press('Enter');
  await rail.getByRole('button', { name: 'Cerrar proyectos', exact: true }).waitFor();
  await until(async () => (await nativeViews()).every(view => !view.visible), 'Drawer obscures native browser');
  assert.equal(await rail.getAttribute('aria-modal'), 'true');
  assert.equal(await page.locator('.main-workspace').getAttribute('inert'), '');
  const close = rail.getByRole('button', { name: 'Cerrar proyectos', exact: true });
  assert.equal(await close.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await rail.getByRole('button', { name: /Comandos/ }).evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Tab'); assert.equal(await close.evaluate(el => document.activeElement === el), true);
  await layout(true); await page.screenshot({ path: path.join(temp, 'sidebar-drawer.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.matches('.rail-toggle'));
  await until(async () => (await nativeViews()).some(view => view.visible), 'Native browser returns after closing drawer');
  await toggle.click(); await page.locator('.rail-scrim').click({ position: { x: 700, y: 300 } });
  await page.waitForFunction(() => !document.querySelector('.project-rail.rail-open'));
  await size(580, 500); await toggle.click();
  await rail.getByRole('button', { name: /Comandos/ }).focus();
  assert.equal(await rail.getByRole('button', { name: /Comandos/ }).evaluate(el => document.activeElement === el), true);
  await projectButton(other.id).click();
  await until(async () => (await invoke('state.get')).activeWorkspaceId === other.id, 'Drawer project selection reaches the host');
  await page.waitForFunction(() => !document.querySelector('.project-rail.rail-open'));
  await toggle.click(); await projectButton(project.id).click();
  await until(async () => await rail.locator('.rail-panel-row').count() > 0, 'Original project panels return');
  await toggle.click(); await mapTerminal.click();
  await page.waitForFunction(() => !document.querySelector('.project-rail.rail-open'));
  await page.locator('.canvas-node.selected .terminal-host').waitFor();
  await toggle.click(); await focusTerminal.click();
  await page.locator('.canvas-node.focused .xterm-screen').click();
  await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'));
  await toggle.click();
  await page.keyboard.type('DRAWER_MUST_NOT_REACH_PTY');
  assert.ok(!(await invoke('terminal.attach', { sessionId: session.id })).data.includes('DRAWER_MUST_NOT_REACH_PTY'), 'Drawer keyboard ownership blocks PTY writes');
  await page.keyboard.press('Escape');
  checks.push('Drawer at 850px, short-window footer access, project/panel selection, focus trap/restore, Escape/scrim, PTY blocking and native-browser occlusion');
  assert.deepEqual(errors, []);
  await writeFile(path.join(temp, 'sidebar-checks.json'), JSON.stringify({ checks, contrast, errors }, null, 2));
  console.log(JSON.stringify({ interactionsPassed: true, checks, evidence: temp }));
} catch (error) {
  await page?.screenshot({ path: path.join(temp, 'failure.png') }).catch(() => {});
  console.error({ evidence: temp, errors }); throw error;
} finally {
  try {
    if (host) {
      const command = await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '');
      if (command.includes(path.join(temp, 'profile'))) {
        await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2500)]);
        try { process.kill(host, 'SIGTERM'); } catch {}
      }
    }
    if (app) await Promise.race([app.close().catch(() => {}), delay(2500)]);
    killElectronGroup(appProcess);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await detector();
  }
}
