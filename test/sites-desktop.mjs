import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic repositories, profile and Docker executable. Never contacts a real daemon.
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp('/tmp/phantom-sites-ui-');
const bin = path.join(temp, 'bin'); await mkdir(bin);
const first = path.join(temp, `SYNTHETIC-web-${'longname'.repeat(8)}`), second = path.join(temp, 'SYNTHETIC-empty');
await mkdir(first); await mkdir(second); await writeFile(path.join(first, 'compose.yaml'), 'services: {}');
await writeFile(path.join(bin, 'docker'), `#!${process.execPath}\nconst a=process.argv.slice(2); if(a[0]==='context'&&a[1]==='show') console.log('fixture'); else if(a[0]==='context') console.log(JSON.stringify([{Endpoints:{docker:{Host:'unix:///fixture'}}}])); else if(a.includes('ps')) console.log(''); else if(a.includes('config')) console.log(JSON.stringify({services:{web:{ports:[{target:80}]},db:{ports:[{target:5432}]}}})); else if(a.includes('logs')) console.log('SYNTHETIC Docker log');\n`, { mode: 0o755 });
const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile') };
for (const key of ['ELECTRON_RUN_AS_NODE', 'PHANTOM_RENDERER_URL', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'COMPOSE_FILE']) delete env[key];
const app = await electron.launch({ args: [root], cwd: root, env });
const electronProcess = app.process();
const page = await app.firstWindow(); page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let hostPid;
try {
  await page.waitForSelector('.app-shell');
  hostPid = (await invoke('system.info')).pid;
  const a = await invoke('workspace.open', { path: first });
  await invoke('workspace.open', { path: second });
  await page.reload(); await page.waitForSelector('.app-shell');
  await page.getByRole('button', { name: 'Sitios', exact: true }).click();
  const sites = page.getByRole('region', { name: 'Sitios globales' });
  await sites.getByText('Sin crear').first().waitFor();
  assert.equal(await sites.getByText('No se encontró un archivo Compose', { exact: false }).count(), 1);
  await sites.getByLabel('Proyecto', { exact: true }).selectOption(a.id);
  assert.equal(await sites.getByText('No se encontró un archivo Compose', { exact: false }).count(), 0);
  await sites.getByRole('button', { name: /Iniciar web en/ }).click();
  await sites.getByRole('button', { name: /Logs web en/ }).click();
  await sites.getByText('SYNTHETIC Docker log').waitFor();
  await sites.getByRole('button', { name: 'Cerrar logs' }).click();
  for (const width of [1280, 870]) {
    const zoom = await app.evaluate(({ BrowserWindow }, width) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setMinimumSize(600, 500);
      window.setContentSize(width, 773);
      return window.webContents.getZoomFactor();
    }, width);
    await page.waitForFunction(expected => Math.abs(window.innerWidth - expected) < 2, width / zoom);
    const compact = await page.evaluate(() => matchMedia('(max-width: 850px)').matches);
    if (compact) await page.getByRole('button', { name: 'Ver proyectos' }).click();
    const switcher = page.locator('.project-switcher');
    await switcher.locator('summary').click();
    const target = width === 1280 ? first : second;
    await switcher.getByRole('button', { name: width === 1280 ? /SYNTHETIC-web/ : /SYNTHETIC-empty/ }).click();
    await page.waitForFunction(name => document.querySelector('.project-switcher summary strong')?.textContent === name, path.basename(target));
    assert.equal(await sites.isVisible(), true, 'Sitios permanece abierto al cambiar de proyecto');
    assert.equal(await sites.getByLabel('Proyecto', { exact: true }).inputValue(), a.id);
    await sites.getByRole('button', { name: 'Actualizar' }).click();
    await page.waitForFunction(() => !document.querySelector('.sites-header-actions .button')?.disabled);
    const geometry = await sites.evaluate(root => {
      const rail = document.querySelector('.project-rail').getBoundingClientRect();
      const view = root.getBoundingClientRect();
      const overflowing = [...root.querySelectorAll('*')].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width && (rect.left < view.left - 1 || rect.right > view.right + 1);
      }).map(el => el.className || el.tagName);
      return { railRight: rail.right, viewLeft: view.left, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, overflowing };
    });
    if (!compact) assert.ok(geometry.viewLeft >= geometry.railRight - 1, JSON.stringify(geometry));
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, JSON.stringify(geometry));
    assert.deepEqual(geometry.overflowing, [], JSON.stringify(geometry));
    for (const name of ['Actualizar', 'Cerrar Sitios', /Iniciar web en/, /Detener web en/, /Reiniciar web en/, /Logs web en/]) {
      const button = sites.getByRole('button', { name });
      await button.scrollIntoViewIfNeeded();
      assert.equal(await button.isVisible(), true, String(name));
      assert.equal(await button.evaluate(el => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && (hit === el || el.contains(hit));
      }), true, `control accesible: ${name} a ${width}px`);
    }
    await sites.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: path.join(temp, `sitios-${width}.png`) });
  }
  assert.equal(await page.locator('.sites-canvas-content').evaluate(el => el.inert), true);
  await sites.getByRole('button', { name: 'Cerrar Sitios' }).focus();
  await page.keyboard.press('Escape');
  await sites.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.sites-canvas-content').evaluate(el => el.inert), false);
  assert.deepEqual(errors, []);
  console.log(`PASS Sitios UI: datos y Docker simulados, navegación, filtro, acciones, logs y geometría. Capturas: ${temp}/sitios-{1280,870}.png`);
} finally {
  if (hostPid) {
    const command = await readFile(`/proc/${hostPid}/cmdline`, 'utf8').catch(() => '');
    if (command.includes(env.PHANTOM_WORKSPACE_HOME)) {
      await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2500)]);
      try { process.kill(hostPid, 'SIGTERM'); } catch {}
    }
  }
  await Promise.race([app.close().catch(() => {}), delay(2500)]);
  if (electronProcess.exitCode === null && electronProcess.signalCode === null) electronProcess.kill('SIGKILL');
}
