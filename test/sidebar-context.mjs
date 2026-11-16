import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

// Run against the controller's production build, with an isolated host/profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.env.PHANTOM_TEST_EXECUTABLE;
const executablePath = packaged || path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(root, 'node_modules/electron/dist'), 'electron');
try { await access(executablePath, constants.X_OK); }
catch { throw new Error(`Electron no está preparado: ${executablePath}. El controlador debe proporcionar el runtime antes del test.`); }
const temp = await mkdtemp('/tmp/phantom-sidebar-context-');
const profile = path.join(temp, 'profile');
const fixtures = path.join(temp, 'fixtures');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
let app, page, host, appProcess;
const errors = [], screenshots = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
async function until(fn, message) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await fn()) return; await delay(80); }
  assert.fail(message);
}
async function resize(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(580, 500); win.setContentSize(w, h);
  }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
}
async function capture(name) {
  const file = path.join(temp, `${name}.png`);
  await page.locator('.project-rail').screenshot({ path: file }); screenshots.push(file);
}

try {
  app = await electron.launch({ executablePath, args: [...(packaged ? [] : [root]), '--ozone-platform=headless'], cwd: root, env, timeout: 20000 });
  appProcess = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  await resize(1200, 800);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const folders = [];
  for (let i = 0; i < 16; i++) {
    const folder = path.join(fixtures, `equipo-${i}`, i < 2 ? 'Homónimo' : `Proyecto ${i} con nombre largo para navegación`);
    await mkdir(folder, { recursive: true });
    await invoke('workspace.open', { path: folder }); folders.push(folder);
  }
  const state = await invoke('state.get');
  const project = state.workspaces.find(w => w.path === folders[0]);
  const other = state.workspaces.find(w => w.path === folders[1]);
  assert.ok(project && other, 'Homonymous projects retained');
  const spaces = Array.from({ length: 30 }, (_, i) => ({ id: randomUUID(), name: `Espacio ${String(i).padStart(2, '0')} de desarrollo`, camera: { x: 0, y: 0, zoom: 1 } }));
  await invoke('workspace.update', { id: project.id, patch: { spaces } });
  for (const [title, spaceId] of [['Sesión Principal', null], ['Sesión Desarrollo', spaces[0].id]]) {
    const node = await invoke('node.create', { workspaceId: project.id, type: 'terminal', title, x: 300, y: 80, width: 640, height: 600, data: spaceId ? { spaceId } : {} });
    await invoke('terminal.create', { workspaceId: project.id, nodeId: node.id, cols: 80, rows: 24 });
  }
  for (let i = 0; i < 18; i++) await invoke('node.create', { workspaceId: project.id, type: 'note', title: `Nota ${i} de contexto con nombre extenso`, x: 1200 + i * 450, y: 100, width: 420, height: 340, data: {} });
  await invoke('workspace.select', { id: project.id });
  await page.reload(); await page.locator('.space-switcher-trigger').waitFor();
  const rail = page.locator('.project-rail');
  const projects = rail.locator('.project-switcher');
  const projectTrigger = projects.locator('summary');
  const spaceTrigger = rail.locator('.space-switcher-trigger');
  const projectSearch = rail.getByRole('textbox', { name: 'Buscar proyectos por nombre o ruta' });
  const spaceSearch = rail.getByRole('textbox', { name: 'Buscar espacios', exact: true });
  const spaceName = rail.getByRole('textbox', { name: 'Nombre del espacio', exact: true });
  const selectSpace = name => rail.locator('.space-select').filter({ has: page.locator('span', { hasText: name }) });
  const storedProject = async () => (await invoke('state.get')).workspaces.find(w => w.id === project.id);
  async function expectClosed() {
    await page.waitForFunction(() => !document.querySelector('.context-menu-panel'));
  }
  async function checkLayout(menu = false) {
    const metrics = await rail.evaluate(el => {
      const rail = el.getBoundingClientRect(), bottom = el.querySelector('.rail-bottom').getBoundingClientRect();
      const menu = el.querySelector('.context-menu-panel')?.getBoundingClientRect();
      return { overflow: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
        utilities: bottom.bottom <= innerHeight && bottom.top >= rail.top,
        sessions: el.querySelector('.rail-panel-scroll').clientHeight,
        menuContained: !menu || menu.left >= rail.left && menu.right <= rail.right && menu.bottom <= bottom.top + 1,
        documentOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(metrics.overflow, false, 'Rail itself has no overflow');
    assert.equal(metrics.documentOverflow, false);
    assert.equal(metrics.utilities, true, 'Utilities remain in the viewport');
    assert.ok(metrics.sessions > 40, 'Sessions retain usable height');
    if (menu) assert.equal(metrics.menuContained, true, 'Popover stays inside rail, clear of utilities/native views');
  }

  assert.match(await projectTrigger.innerText(), /Proyecto.*Homónimo/s);
  assert.match(await spaceTrigger.innerText(), /Espacio.*Principal/s);
  await projectTrigger.click();
  assert.equal(await projectSearch.evaluate(el => document.activeElement === el), true);
  assert.equal(await projects.locator('.project-item[aria-current=true]').count(), 1);
  assert.equal(await projects.locator('.project-list').evaluate(el => el.scrollHeight > el.clientHeight), true);
  await projectSearch.fill('Homónimo');
  assert.equal(await projects.locator('.project-item').count(), 2);
  const paths = await projects.locator('.project-item small').allTextContents();
  assert.ok(paths.includes(folders[0]) && paths.includes(folders[1]), 'Paths distinguish identical names');
  await projectSearch.fill('equipo-1/');
  assert.equal(await projects.locator('.project-item').count(), 2, 'Search by path plus pinned current project');
  await projectSearch.fill('sin-resultados-xyz');
  await rail.getByRole('status').filter({ hasText: 'Sin proyectos' }).waitFor();
  assert.equal(await rail.getByRole('button', { name: 'Abrir carpeta', exact: true }).isEnabled(), true);
  await page.keyboard.press('Escape'); await expectClosed();
  assert.equal(await projectTrigger.evaluate(el => document.activeElement === el), true);
  await projectTrigger.click(); assert.equal(await projectSearch.inputValue(), '');
  await projectSearch.fill('equipo-1/');
  await page.keyboard.press('ArrowDown'); // Current project remains first.
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await until(async () => (await invoke('state.get')).activeWorkspaceId === other.id, 'Keyboard project change reaches host');
  await until(async () => await projectTrigger.getAttribute('title') === other.path, 'Selected project renders');
  await expectClosed();
  await projectTrigger.click(); await projectSearch.fill(folders[0]);
  await projects.locator('.project-item').filter({ has: page.locator(`small[id="project-path-${project.id}"]`) }).click();
  await until(async () => (await invoke('state.get')).activeWorkspaceId === project.id, 'Return to original project');
  await until(async () => await projectTrigger.getAttribute('title') === project.path, 'Original project renders');
  await expectClosed(); await rail.locator('.rail-panel-row').first().waitFor();

  await spaceTrigger.click();
  assert.equal(await spaceSearch.evaluate(el => document.activeElement === el), true);
  assert.equal(await rail.locator('.space-list').evaluate(el => el.scrollHeight > el.clientHeight), true);
  await spaceSearch.fill('Espacio 29');
  assert.equal(await selectSpace('Principal').isVisible(), true);
  await selectSpace('Espacio 29').click(); await expectClosed();
  assert.match(await spaceTrigger.innerText(), /Espacio 29/);
  await spaceTrigger.click(); await spaceSearch.fill('sin-espacios-xyz');
  await rail.getByRole('status').filter({ hasText: 'Sin espacios' }).waitFor();
  assert.equal(await selectSpace('Principal').count(), 1);
  assert.equal(await rail.locator('.space-select[aria-current=true]').count(), 1);
  await page.keyboard.press('Escape'); await expectClosed();
  assert.equal(await spaceTrigger.evaluate(el => document.activeElement === el), true);
  await spaceTrigger.click(); assert.equal(await spaceSearch.inputValue(), '');
  // Moving focus between selectors closes the previous one before opening next.
  await projectTrigger.focus(); await page.keyboard.press('Enter');
  assert.equal(await rail.locator('.context-menu-panel').count(), 1);
  assert.equal(await spaceTrigger.getAttribute('aria-expanded'), 'false');
  await rail.locator('.brand').click(); await expectClosed();

  await spaceTrigger.click();
  await rail.getByRole('button', { name: 'Nuevo espacio', exact: true }).click();
  await spaceName.fill('Espacio cancelado'); await page.keyboard.press('Escape');
  assert.equal(await spaceSearch.evaluate(el => document.activeElement === el), true);
  assert.equal((await storedProject()).spaces.length, 30);
  await rail.getByRole('button', { name: 'Nuevo espacio', exact: true }).click();
  await spaceName.fill('Espacio creado'); await page.keyboard.press('Enter');
  await spaceSearch.focus();
  await until(async () => (await storedProject()).spaces.length === 31, 'Create persists exactly once after Enter and blur');
  assert.match(await spaceTrigger.innerText(), /Espacio creado/);
  await rail.getByRole('button', { name: 'Renombrar espacio Espacio creado', exact: true }).click();
  await spaceName.fill('No guardar'); await page.keyboard.press('Escape'); await spaceSearch.focus();
  assert.equal((await storedProject()).spaces.some(s => s.name === 'No guardar'), false);
  await rail.getByRole('button', { name: 'Renombrar espacio Espacio creado', exact: true }).click();
  await spaceName.fill('Espacio renombrado'); await page.keyboard.press('Enter');
  await until(async () => (await storedProject()).spaces.some(s => s.name === 'Espacio renombrado'), 'Explicit rename persists');
  await selectSpace('Espacio renombrado').dblclick();
  await spaceName.fill('Renombrado doble clic'); await page.keyboard.press('Enter');
  await until(async () => (await storedProject()).spaces.some(s => s.name === 'Renombrado doble clic'), 'Double-click rename retained');
  await page.keyboard.press('Escape'); await expectClosed();
  await spaceTrigger.focus(); await page.keyboard.press('Alt+2');
  await until(async () => (await spaceTrigger.innerText()).includes(spaces[0].name), 'Alt+2 selects first named space');
  await rail.getByRole('button', { name: 'Enfocar Sesión Desarrollo', exact: true }).click();
  await page.locator('.canvas-node.focused .terminal-host').waitFor();
  await rail.locator('.rail-map-action').click();
  await spaceTrigger.click();
  await rail.getByRole('button', { name: `Quitar espacio ${spaces[0].name}; sus paneles vuelven a Principal`, exact: true }).click();
  await until(async () => !(await storedProject()).spaces.some(s => s.id === spaces[0].id), 'Remove space persists');
  const afterRemove = await storedProject();
  assert.equal(afterRemove.nodes.filter(n => n.type === 'terminal').length, 2, 'Removing space preserves terminals');
  assert.equal(afterRemove.nodes.find(n => n.title === 'Sesión Desarrollo').data.spaceId, undefined);
  await page.keyboard.press('Escape'); await expectClosed();
  await rail.getByRole('button', { name: 'Enfocar Sesión Principal', exact: true }).click();
  await page.locator('.canvas-node.focused .terminal-host').waitFor();
  await rail.locator('.rail-map-action').click();
  await checkLayout(); await capture('sidebar-context-desktop');

  for (const [width, height] of [[1000, 600], [580, 500]]) {
    await resize(width, height);
    if (width <= 850) await page.getByRole('button', { name: 'Ver proyectos', exact: true }).click();
    await checkLayout();
    await projectTrigger.click(); await checkLayout(true); await capture(`sidebar-projects-${width}`);
    await page.keyboard.press('Escape'); await expectClosed();
    await spaceTrigger.click(); await checkLayout(true); await capture(`sidebar-spaces-${width}`);
    await page.keyboard.press('Escape'); await expectClosed();
    await rail.getByRole('button', { name: 'Configuración', exact: true }).click();
    await page.getByLabel('Herramienta contextual').waitFor();
    assert.equal(await page.getByLabel('Herramienta contextual').inputValue(), 'settings');
    await page.getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
    if (width <= 850) await page.getByRole('button', { name: 'Ver proyectos', exact: true }).click();
    await rail.getByRole('button', { name: /Comandos/ }).click();
    await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).waitFor();
    await page.keyboard.press('Escape');
  }
  // Project identity remounts Spaces: no draft or filter crosses projects.
  await resize(1200, 800);
  await spaceTrigger.click(); await spaceSearch.fill('Espacio 20');
  await invoke('workspace.select', { id: other.id });
  await until(async () => await projectTrigger.getAttribute('title') === other.path, 'New project context renders');
  await expectClosed();
  await spaceTrigger.click(); assert.equal(await spaceSearch.inputValue(), '');
  assert.equal(await rail.locator('.space-select').count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots }));
} catch (error) {
  const failure = path.join(temp, 'failure.png');
  await page?.screenshot({ path: failure }).catch(() => {});
  console.error(JSON.stringify({ screenshots, failure, errors })); throw error;
} finally {
  // Only the host launched with this test's profile may be terminated.
  if (host) {
    const command = await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '');
    if (command.includes(profile)) {
      await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2500)]);
      try { process.kill(host, 'SIGTERM'); } catch {}
    }
  }
  if (app) await Promise.race([app.close().catch(() => {}), delay(2500)]);
  killElectronGroup(appProcess);
  await rm(profile, { recursive: true, force: true });
  await rm(fixtures, { recursive: true, force: true });
}
