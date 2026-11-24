import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'node:http';
import { killElectronGroup } from './support/electron-process.mjs';
import { invokeAgent } from '../scripts/agent.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp('/tmp/opencode/phantom-markdown-');
const folder = path.join(temp, 'SYNTHETIC-project'); await mkdir(folder);
// A capture outside the project reproduces agent-generated review links.
const image = path.join(temp, 'captura con espacios.png');
await copyFile(path.join(root, 'assets/gengar.png'), image);
const missing = path.join(temp, 'missing.png');
const corrupt = path.join(temp, 'corrupt.png'); await writeFile(corrupt, 'not an image');
const server = createServer((request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<title>Documentación local</title><p>Fixture</p>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/docs`;
const reply = `[Ver captura del lanzador actualizado](${pathToFileURL(image)})\n\n![Imagen integrada](${pathToFileURL(image)})\n\n[Captura ausente](${pathToFileURL(missing)})\n\n[Captura dañada](${pathToFileURL(corrupt)})\n\n[Enlace inseguro](javascript:alert)\n\n[Documentación](${url})`;
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
  await app.evaluate(({ shell }) => { shell.__testURLs = []; shell.openExternal = async url => { shell.__testURLs.push(url); }; });
  const otherFolder = path.join(temp, 'OTHER-project'); await mkdir(otherFolder);
  const other = await invoke('workspace.open', { path: otherFolder });
  await invoke('workspace.select', { id: w.id });
  await page.getByRole('button', { name: 'Documentación', exact: true }).waitFor();
  for (const activation of ['click', 'Enter']) {
    const before = (await invoke('state.get')).workspaces.find(item => item.id === w.id).nodes.filter(item => item.type === 'browser');
    const documentation = page.getByRole('button', { name: 'Documentación', exact: true });
    if (activation === 'click') await documentation.click();
    else { await documentation.focus(); await page.keyboard.press('Enter'); }
    const panel = page.locator('.canvas-node.focused[data-type="browser"]');
    await panel.waitFor({ state: 'visible' });
    const id = await panel.getAttribute('data-node-id');
    assert.ok(!before.some(item => item.id === id));
    const state = await invoke('state.get');
    assert.equal(state.activeWorkspaceId, w.id);
    assert.equal(state.workspaces.find(item => item.id === w.id).nodes.find(item => item.id === id).data.url, url);
    assert.equal(state.workspaces.find(item => item.id === other.id).nodes.filter(item => item.type === 'browser').length, 0);
    const deadline = Date.now() + 15000;
    let visible = false;
    do {
      visible = await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().some(window =>
        window.contentView.children.some(view => view.webContents?.getURL() === url && view.getVisible()
          && view.getBounds().width > 0 && view.getBounds().height > 0)), url);
      if (!visible) await new Promise(resolve => setTimeout(resolve, 100));
    } while (!visible && Date.now() < deadline);
    assert.ok(visible, 'native browser view is visible at the requested URL');
    assert.deepEqual(await app.evaluate(({ shell }) => shell.__testURLs), []);
    await page.locator('.focus-return').getByRole('button', { name: 'Volver al mapa', exact: true }).click();
  }
  await assert.rejects(invoke('desktop.openBrowser', { url: 'javascript:alert(1)' }));
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
  console.log('PASS Electron: inline image, file URL with encoded spaces, keyboard activation, close/reopen, integrated web links by click/Enter, workspace isolation, no external calls, missing/corrupt files, unsafe target blocked, IPC root restriction, no renderer errors');
  console.log(`Evidence: ${temp}/preview.png`);
} finally {
  const bounded = async (operation, label) => {
    let timer;
    try {
      await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} cleanup timeout`)), 5000); })]);
    } finally { clearTimeout(timer); }
  };
  try {
    try { await bounded(app.close(), 'Electron'); }
    catch (error) { console.error('Electron cleanup:', error); }
    finally { killElectronGroup(app.process()); }
    const child = app.process();
    if (child.exitCode === null && child.signalCode === null) {
      await bounded(new Promise(resolve => child.once('exit', resolve)), 'Electron exit');
    }
    const socket = path.join(env.PHANTOM_WORKSPACE_HOME, 'host.sock');
    await invokeAgent('host.shutdown', {}, socket, 5000);
    const deadline = Date.now() + 5000;
    for (;;) {
      try { await access(socket); }
      catch (error) { if (error.code === 'ENOENT') break; throw error; }
      assert.ok(Date.now() < deadline, 'isolated host socket removed after shutdown');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
