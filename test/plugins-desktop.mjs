import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createHost } from '../host/server.mjs';

// Synthetic backend fixtures only; native CLI round trips are covered in plugins.test.mjs.
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp('/tmp/opencode/phantom-plugins-desktop-');
const folder = path.join(temp, 'SYNTHETIC-project'); await mkdir(folder);
const otherFolder = path.join(temp, 'SYNTHETIC-other'); await mkdir(otherFolder);
const evidence = '/tmp/opencode/phantom-plugins-review'; await mkdir(evidence, { recursive: true });
const dataDir = path.join(temp, 'profile');
const cards = [], skills = [], operations = [];
let rejectCard = true;
const refFor = manifest => ({ scope: `project:${'a'.repeat(64)}`, id: manifest.id, version: manifest.version, sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') });
const globalManifest = { id: 'synthetic/global', version: '1.0.0', description: 'SYNTHETIC global fixture', actions: ['test.read'], body: 'Read only instructions', requiresTools: [], resources: [] };
skills.push({ manifest: globalManifest, ref: { ...refFor(globalManifest), scope: 'global' } });
const host = await createHost({ dataDir, handleIntegration: async (method, p) => {
  if (!method.startsWith('phantom.')) return { handled: false };
  operations.push({ method, payload: structuredClone(p) });
  let result;
  if (method === 'phantom.list') {
    const entries = p.topic === 'tasks' ? cards.map(card => ({ id: card.id, kind: 'card', status: card.status, title: card.contract.goal, raw: card })) : skills.filter(skill => p.allVersions || !skills.some(s => s.ref.id === skill.ref.id && s !== skill && s.manifest.version > skill.manifest.version)).map(skill => ({ id: skill.ref.id, ref: skill.ref, title: skill.manifest.description, raw: { ...skill, description: skill.manifest.description, actions: skill.manifest.actions } }));
    result = { available: true, items: entries, observedAt: new Date().toISOString() };
  } else if (method === 'phantom.detail') {
    result = p.topic === 'tasks' ? cards.find(c => c.id === p.id) : skills.find(s => s.ref.id === p.id && (!p.ref || s.ref.sha256 === p.ref.sha256));
    if (!result) throw new Error('SYNTHETIC · Source not found');
  } else if (method === 'phantom.create' || method === 'phantom.update') {
    if (p.kind === 'card') {
      if (rejectCard) { rejectCard = false; throw new Error('SYNTHETIC · Guardado rechazado; reintenta.'); }
      const card = { id: `task-synthetic-${cards.length + 1}`, kind: 'card', status: 'ready', contract: p.input, updatedAt: new Date().toISOString() };
      cards.push(card); result = { id: card.id, source: 'phantom' };
    } else {
      const skill = { manifest: p.input, ref: refFor(p.input) }; skills.push(skill);
      result = { id: skill.ref.id, ref: skill.ref, source: 'phantom' };
    }
  } else if (method === 'phantom.control') result = { id: 'controller-synthetic', taskId: p.id, status: 'completed', output: 'SYNTHETIC controller response; card status is unchanged.' };
  else throw new Error(`Unexpected fixture method: ${method}`);
  return { handled: true, result };
} });
const workspace = await host.invoke('workspace.open', { path: folder });
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: dataDir }; delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
let app;
try {
  app = await electron.launch({ args: [root], cwd: root, env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const command = async title => { await page.getByRole('button', { name: 'Buscar o ejecutar', exact: false }).click(); await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill(title); await page.getByRole('option').filter({ hasText: title }).first().click(); };
  await page.getByRole('button', { name: /^Plugins/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Cards Phantom', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Activar Phantom', exact: true }).click();
  await page.getByRole('button', { name: 'Desactivar Phantom', exact: true }).waitFor();
  await page.getByLabel('Modelo para ejecutar cards en este proyecto').fill('synthetic/model');
  await page.getByRole('button', { name: 'Guardar conexión y preferencias', exact: true }).click();
  await page.getByRole('button', { name: 'Cards Phantom', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva card', exact: true }).click();
  await page.getByLabel('Objetivo de la card', { exact: true }).fill('SYNTHETIC · Implementar autenticación');
  await page.getByLabel('Archivos editables', { exact: true }).fill('src/auth with spaces.js');
  await page.getByRole('button', { name: 'Añadir comprobación', exact: true }).click();
  await page.getByLabel('Nombre de la comprobación', { exact: true }).fill('SYNTHETIC acceptance');
  await page.getByLabel('Ejecutable', { exact: true }).fill('node');
  await page.getByRole('button', { name: 'Añadir argumento', exact: true }).click();
  await page.getByLabel('Argumento 1', { exact: true }).fill('test/with spaces.mjs');
  await page.getByRole('button', { name: 'Crear card en Phantom', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Guardado rechazado' }).waitFor();
  assert.equal(await page.getByLabel('Objetivo de la card').inputValue(), 'SYNTHETIC · Implementar autenticación');
  await page.getByRole('button', { name: 'Crear card en Phantom', exact: true }).click();
  await page.getByRole('button', { name: 'Todas las cards', exact: true }).waitFor();
  assert.deepEqual(cards[0].contract.checks[0].argv, ['node', 'test/with spaces.mjs']);
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).click();
  await page.getByText('Controlador: completed', { exact: true }).waitFor();
  assert.equal(cards[0].status, 'ready');
  await page.getByRole('button', { name: 'Preparar reemplazo', exact: true }).click();
  await page.getByLabel('Objetivo de la card').fill('SYNTHETIC · Reemplazo');
  await page.getByLabel('Crear una card nueva que reemplaza a la original; conservar ambas').check();
  await page.getByRole('button', { name: 'Crear reemplazo explícito', exact: true }).click();
  await page.getByRole('button', { name: 'Todas las cards', exact: true }).click();
  assert.equal(cards.length, 2); assert.equal(cards[0].contract.goal, 'SYNTHETIC · Implementar autenticación');
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.locator('.plugin-board-column').waitFor();
  assert.equal((await host.invoke('state.get')).workspaces[0].plugins.phantom.preferences.cardsView, 'board');
  console.log('PASS visual Cards create/error/retry, literal argv, controller/card distinction, immutable replacement and board preference');

  await command('Abrir Skills Phantom');
  await page.getByRole('button', { name: 'Nueva skill', exact: true }).click();
  await page.getByLabel('Identificador de skill', { exact: true }).fill('synthetic/desktop');
  await page.getByLabel('Descripción', { exact: true }).fill('SYNTHETIC · UI workflow');
  await page.getByLabel('Acciones de la skill', { exact: true }).fill('test.review');
  await page.getByLabel('Instrucciones', { exact: true }).fill('SYNTHETIC · Preservar instrucciones');
  await page.getByRole('button', { name: 'Añadir recurso', exact: true }).click();
  await page.getByLabel('Nombre del recurso', { exact: true }).fill('reference.md');
  await page.getByLabel('Contenido del recurso', { exact: true }).fill('SYNTHETIC · Recurso original');
  await page.screenshot({ path: path.join(evidence, 'skill-editor.png') });
  await page.getByRole('button', { name: 'Publicar skill en Phantom', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva versión', exact: true }).click();
  assert.equal(await page.getByLabel('Contenido del recurso').inputValue(), 'SYNTHETIC · Recurso original');
  await page.getByLabel('Versión', { exact: true }).fill('1.1.0');
  await page.getByRole('button', { name: 'Publicar nueva versión', exact: true }).click();
  await page.getByRole('button', { name: 'Todas las skills', exact: true }).click();
  await page.getByLabel('Mostrar todas las versiones', { exact: true }).check();
  await page.waitForFunction(() => document.querySelectorAll('.canvas-node.focused .plugin-skill-row').length === 3);
  assert.equal(await page.locator('.plugin-skill-row').count(), 3);
  await page.locator('.plugin-skill-row').filter({ hasText: 'synthetic/global' }).click();
  await page.getByText('Global · Solo lectura', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Nueva versión', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Todas las skills', exact: true }).click();
  console.log('PASS Skills publish/new version preserves resources, exact refs and global read-only detail');

  await page.getByRole('button', { name: /^Plugins/ }).click();
  await page.getByRole('button', { name: 'Desactivar Phantom', exact: true }).click();
  const nodesBefore = (await host.invoke('state.get')).workspaces[0].nodes.length;
  await page.locator('.inspector-switcher').getByRole('button', { name: 'Cerrar inspector', exact: true }).click();
  await page.locator('.canvas-node.focused').getByRole('button', { name: 'Reactivar Phantom', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva skill', exact: true }).waitFor();
  assert.equal((await host.invoke('state.get')).workspaces[0].nodes.length, nodesBefore);
  await page.reload();
  await command('Abrir Cards Phantom');
  await page.locator('.canvas-node.focused .plugin-board-column').first().waitFor();
  console.log('PASS disable/reactivate retains panels, activation/view survive reload, commands open existing panels');

  for (const [width, height, name] of [[1520, 980, 'cards-desktop'], [1100, 760, 'cards-compact']]) {
    await app.evaluate(({ BrowserWindow }, [width, height]) => { const win = BrowserWindow.getAllWindows()[0]; win.setResizable(true); win.setMinimumSize(800, 600); win.setMaximumSize(10000, 10000); win.setContentSize(width, height); }, [width, height]);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(evidence, `${name}.png`) });
  }
  await page.getByRole('button', { name: /^Plugins/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(evidence, 'plugins-compact.png') });
  const other = await host.invoke('workspace.open', { path: otherFolder });
  await page.getByRole('button', { name: 'Activar Phantom', exact: true }).waitFor();
  assert.equal((await host.invoke('plugins.get', { workspaceId: other.id, pluginId: 'phantom' })).enabled, false);
  assert.equal((await host.invoke('plugins.get', { workspaceId: workspace.id, pluginId: 'phantom' })).enabled, true);
  assert.deepEqual(errors, []);
  assert.ok(operations.some(o => o.method === 'phantom.update' && o.payload.kind === 'skill' && o.payload.ref.version === '1.0.0'));
  console.log('PASS project isolation, desktop/compact screenshots, zero renderer errors');
} finally { await app?.close(); await host.close(); await rm(temp, { recursive: true, force: true }); }
