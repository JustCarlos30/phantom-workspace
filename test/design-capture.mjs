import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], captures = [];
let app, appProcess, page, host;
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const shot = async scene => {
  await delay(700);
  const file = path.join(evidence, `design-${label}-${scene}.png`);
  await page.screenshot({ path: file });
  captures.push(file);
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
  await page.waitForFunction(() => innerWidth === 1520);
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
