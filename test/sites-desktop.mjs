import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic repositories, profile and Docker executable. Never contacts a real daemon.
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp('/tmp/phantom-sites-ui-');
const bin = path.join(temp, 'bin'); await mkdir(bin);
const first = path.join(temp, 'SYNTHETIC-web'), second = path.join(temp, 'SYNTHETIC-empty');
await mkdir(first); await mkdir(second); await writeFile(path.join(first, 'compose.yaml'), 'services: {}');
await writeFile(path.join(bin, 'docker'), `#!${process.execPath}\nconst a=process.argv.slice(2); if(a[0]==='context'&&a[1]==='show') console.log('fixture'); else if(a[0]==='context') console.log(JSON.stringify([{Endpoints:{docker:{Host:'unix:///fixture'}}}])); else if(a.includes('ps')) console.log(''); else if(a.includes('config')) console.log(JSON.stringify({services:{web:{ports:[{target:80}]},db:{ports:[{target:5432}]}}})); else if(a.includes('logs')) console.log('SYNTHETIC Docker log');\n`, { mode: 0o755 });
const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile') };
for (const key of ['ELECTRON_RUN_AS_NODE', 'PHANTOM_RENDERER_URL', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'COMPOSE_FILE']) delete env[key];
const app = await electron.launch({ args: [root], cwd: root, env });
const page = await app.firstWindow(); page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
try {
  await page.waitForSelector('.app-shell');
  const a = await invoke('workspace.open', { path: first });
  const b = await invoke('workspace.open', { path: second });
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
  await page.screenshot({ path: path.join(temp, 'sitios.png') });
  await sites.getByRole('button', { name: 'Cerrar logs' }).click();
  await invoke('workspace.select', { id: b.id }); await page.reload();
  await page.getByRole('button', { name: 'Sitios', exact: true }).click();
  await sites.getByText('Sin crear').first().waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS Sitios UI: datos y Docker simulados, dos repos, filtro, inicio y logs. Captura: ${temp}/sitios.png`);
} finally {
  await invoke('host.shutdown').catch(() => {});
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
