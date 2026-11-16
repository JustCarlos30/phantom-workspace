import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { killElectronGroup } from './support/electron-process.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp('/tmp/opencode/phantom-markdown-');
const folder = path.join(temp, 'SYNTHETIC-project'); await mkdir(folder);
// A capture outside the project reproduces agent-generated review links.
const image = path.join(temp, 'captura con espacios.png');
await copyFile(path.join(root, 'assets/gengar.png'), image);
const missing = path.join(temp, 'missing.png');
const corrupt = path.join(temp, 'corrupt.png'); await writeFile(corrupt, 'not an image');
const reply = `[Ver captura del lanzador actualizado](${pathToFileURL(image)})\n\n![Imagen integrada](${pathToFileURL(image)})\n\n[Captura ausente](${pathToFileURL(missing)})\n\n[Captura dañada](${pathToFileURL(corrupt)})\n\n[Enlace inseguro](javascript:alert)\n\n[Documentación](https://example.com)`;
const fixture = path.join(temp, 'fixture-claude');
await writeFile(fixture, `#!${process.execPath}\nconst out=o=>console.log(JSON.stringify(o));let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{out({type:'system',subtype:'init',session_id:'fixture'});out({type:'assistant',message:{id:'reply',content:[{type:'text',text:${JSON.stringify(reply)}}]}});out({type:'result',subtype:'success',is_error:false,result:'ok',session_id:'fixture'});});`, { mode: 0o700 });
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile') };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ args: [root], cwd: root, env });
const page = await app.firstWindow(); page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
const invoke = (m,p={}) => page.evaluate(([m,p])=>window.phantom.invoke(m,p), [m,p]);
try {
  await page.waitForSelector('.app-shell');
  await invoke('settings.update', { patch: { claudePath: fixture } });
  const w = await invoke('workspace.open', { path: folder });
  const node = await invoke('node.create', { workspaceId: w.id, type: 'terminal', title: 'SYNTHETIC · Capturas', data: { chat: { provider: 'claude' } } });
  await invoke('chat.send', { workspaceId: w.id, nodeId: node.id, text: 'Mostrar capturas de prueba' });
  await page.reload(); await page.getByRole('button', { name: 'Ver captura del lanzador actualizado', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.md img')].some(i => i.alt === 'Imagen integrada' && i.naturalWidth > 0));
  const link = page.getByRole('button', { name: 'Ver captura del lanzador actualizado', exact: true });
  await link.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.md img')].some(i => i.alt === 'Ver captura del lanzador actualizado' && i.naturalWidth > 0));
  assert.equal(await link.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Enlace inseguro' }).count(), 0);
  // Capture external navigation without launching the user's real browser.
  await app.evaluate(({ shell }) => { shell.openExternal = async url => { shell.__testURL = url; }; });
  await page.getByRole('button', { name: 'Documentación', exact: true }).click();
  assert.equal(await app.evaluate(({ shell }) => shell.__testURL), 'https://example.com/');
  await page.getByRole('button', { name: 'Captura ausente', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No se pudo abrir la imagen' }).waitFor();
  await page.getByRole('button', { name: 'Captura dañada', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Formato no compatible' }).waitFor();
  await assert.rejects(invoke('desktop.previewImage', { path: '/etc/passwd' }), /fuera/);
  await page.locator('.md-attachment').filter({has:link}).getByRole('button', {name:'Cerrar vista previa'}).click();
  assert.equal(await link.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByAltText('Ver captura del lanzador actualizado').count(), 0);
  await link.click(); await page.getByAltText('Ver captura del lanzador actualizado').waitFor();
  await page.screenshot({path:path.join(temp,'preview.png')});
  assert.deepEqual(errors, []);
  console.log('PASS Electron: inline image, file URL with encoded spaces, keyboard activation, close/reopen, external web link, missing/corrupt files, unsafe target blocked, IPC root restriction, no renderer errors');
  console.log(`Evidence: ${temp}/preview.png`);
} finally {
  await invoke('host.shutdown').catch(()=>{});
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
  killElectronGroup(app.process());
}
