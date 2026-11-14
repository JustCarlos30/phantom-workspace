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
await writeFile(path.join(bin, 'docker'), `#!${process.execPath}\nconst a=process.argv.slice(2); if(a[0]==='context'&&a[1]==='show') console.log('fixture'); else if(a[0]==='context') console.log(JSON.stringify([{Endpoints:{docker:{Host:'unix:///fixture'}}}])); else if(a.includes('ps')) console.log(''); else if(a.includes('config')) console.log(JSON.stringify({services:{web:{ports:[{target:80}]},['service'+'long'.repeat(30)]:{ports:[{target:5432}]}}})); else if(a.includes('logs')) console.log('SYNTHETIC Docker log');\n`, { mode: 0o755 });
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('PHANTOM_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'COMPOSE_FILE'].includes(key)) delete env[key];
}
Object.assign(env, { PATH: `${bin}:/usr/bin:/bin`, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile'), PHANTOM_NODE_BINARY: process.execPath, HOME: temp, XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_DATA_HOME: path.join(temp, 'data'), XDG_STATE_HOME: path.join(temp, 'state'), XDG_CACHE_HOME: path.join(temp, 'cache') });
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
  for (const [index, { width, scale }] of [{ width: 1280, scale: 1 }, { width: 870, scale: 1 }, { width: 870, scale: 1.25 }].entries()) {
    const zoom = await app.evaluate(({ BrowserWindow }, { width, scale }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setMinimumSize(600, 500);
      window.setContentSize(width, 773);
      window.webContents.setZoomFactor(scale);
      return window.webContents.getZoomFactor();
    }, { width, scale });
    await page.waitForFunction(expected => Math.abs(window.innerWidth - expected) < 2, width / zoom);
    const compact = await page.evaluate(() => matchMedia('(max-width: 850px)').matches);
    if (compact) await page.getByRole('button', { name: 'Ver proyectos' }).click();
    const switcher = page.locator('.project-switcher');
    await switcher.locator('summary').click();
    const target = index % 2 === 0 ? first : second;
    await switcher.getByRole('button', { name: index % 2 === 0 ? /SYNTHETIC-web/ : /SYNTHETIC-empty/ }).click();
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
      return { railRight: rail.right, viewLeft: view.left, viewRight: view.right, viewportRight: innerWidth, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, overflowing };
    });
    if (!compact) assert.ok(geometry.viewLeft >= geometry.railRight - 1, JSON.stringify(geometry));
    assert.ok(geometry.viewRight <= geometry.viewportRight + 1, JSON.stringify(geometry));
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
    await page.screenshot({ path: path.join(temp, `sitios-${width}${scale === 1 ? '' : '-escala-125'}.png`) });
  }
  assert.equal(await page.locator('.sites-canvas-content').evaluate(el => el.inert), true);
  await sites.getByLabel('Proyecto', { exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('.sites-service')), true, 'Tab avanza desde el filtro a los servicios');
  const canvasBefore = await page.locator('.canvas').evaluate(el => ({ transform: el.querySelector('.canvas-world')?.getAttribute('style'), selected: el.querySelectorAll('.canvas-node.selected').length }));
  await sites.getByRole('button', { name: 'Cerrar Sitios' }).focus();
  await page.keyboard.press('Escape');
  await sites.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.sites-canvas-content').evaluate(el => el.inert), false);
  assert.deepEqual(await page.locator('.canvas').evaluate(el => ({ transform: el.querySelector('.canvas-world')?.getAttribute('style'), selected: el.querySelectorAll('.canvas-node.selected').length })), canvasBefore);
  assert.deepEqual(errors, []);
  console.log(`PASS Sitios UI: datos y Docker simulados, navegación, filtro, acciones, logs y geometría. Capturas: ${temp}/sitios-{1280,870,870-escala-125}.png`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
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
// Playwright may retain a pending dispatcher after a timed-out Electron close.
// Cleanup above is bounded; don't let that connection hold the check open.
process.exit(process.exitCode || 0);
