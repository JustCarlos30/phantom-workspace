import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// SYNTHETIC fixtures for the redesigned Phantom Cards desk and Skills library.
// Captures stay outside the repository.
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = '/tmp/opencode/phantom-panels-review';
await mkdir(evidence, { recursive: true });
const server = await createServer({ root, configFile: false, base: '/', cacheDir: path.join(evidence, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const errors = [];

function fixture(panelType) {
  const now = Date.now(), ago = minutes => new Date(now - minutes * 60000).toISOString();
  const workspace = { id: 'synthetic-phantom', name: 'SYNTHETIC · Phantom', path: '/synthetic/project', canonicalPath: '/synthetic/project',
    camera: { x: 360, y: 20, zoom: 1 }, tasks: [], contextRefs: [], missions: [], workflows: [], services: [], attention: [],
    plugins: { phantom: { enabled: true, config: { phantomPath: '', phantomData: '', model: '' } } },
    nodes: [{ id: 'panel', type: panelType, title: panelType === 'phantom-cards' ? 'Cards' : 'Skills', x: 0, y: 0, width: 1180, height: 700, data: { pluginId: 'phantom', panelId: panelType === 'phantom-cards' ? 'cards' : 'skills' } }] };
  const raw = (id, status, goal, extra = {}) => ({ id, kind: 'card', status, createdAt: ago(300), updatedAt: ago(extra.age ?? 30),
    contract: { goal, workspace: '/synthetic/project', lane: 'coordinated', scope: ['host/worktree-setup.mjs', 'host/terminals.mjs', 'test/worktree-setup.test.mjs'],
      checks: [{ name: 'Pruebas de preparación', argv: ['node', '--test', 'test/worktree-setup.test.mjs'] }, { name: 'Smoke de escritorio', argv: ['node', 'test/desktop-smoke.mjs'] }],
      dependencies: extra.deps || [], budget: { timeoutMs: 1500000, maxTurns: 40 } }, ...extra });
  const tasks = [
    raw('task_721f', 'blocked', 'SYNTHETIC · Corregir timeouts al preparar worktrees con npm ci', { reason: 'La verificación tras la reconciliación falló: desktop-smoke superó 240 s.', deps: ['task_06db'], age: 12 }),
    raw('task_7f2c', 'blocked', 'SYNTHETIC · Decidir alcance de la recuperación automática del host', { reason: 'Phantom espera una decisión del operador sobre el alcance.', age: 50 }),
    raw('task_06db', 'running', 'SYNTHETIC · Reconexión automática del escritorio tras reinicio', { age: 4 }),
    raw('task_9a10', 'ready', 'SYNTHETIC · Catálogo de Skills en el canvas', { age: 90 }),
    raw('task_b210', 'ready', 'SYNTHETIC · Empaquetar versión 0.2', { deps: ['task_7f2c'], age: 200 }),
    raw('task_7f69', 'completed', 'SYNTHETIC · Verificar flujos integrados del escritorio', { age: 1400 }),
  ];
  const skills = [
    { id: 'proyecto/revisar-cambios', title: 'Revisión guiada de un diff antes de integrar.', ref: { id: 'proyecto/revisar-cambios', scope: 'workspace', version: '1.2.0', sha256: 'a'.repeat(64) }, raw: { description: 'SYNTHETIC · Revisión guiada de un diff antes de integrar.' } },
    { id: 'proyecto/worktree-setup', title: 'Preparar dependencias de un worktree nuevo.', ref: { id: 'proyecto/worktree-setup', scope: 'workspace', version: '1.0.0', sha256: 'b'.repeat(64) }, raw: { description: 'SYNTHETIC · Preparar dependencias de un worktree nuevo.' } },
    { id: 'phantom/card-contract', title: 'Redactar un contrato de Card con checks reales.', ref: { id: 'phantom/card-contract', scope: 'global', version: '3.0.1', sha256: 'c'.repeat(64) }, raw: { description: 'SYNTHETIC · Redactar un contrato de Card con checks reales.' } },
  ];
  return { workspace, tasks, skills };
}

try {
  await server.listen();
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  for (const panelType of ['phantom-cards', 'phantom-skills']) {
    const page = await browser.newPage({ viewport: { width: 1520, height: 980 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ data }) => {
      const { workspace, tasks, skills } = data;
      const state = { schemaVersion: 1, settings: {}, activeWorkspaceId: workspace.id, workspaces: [workspace] };
      let firstRead = 0;
      const body = '# Uso\n\nRevisa el diff **antes** de integrar.\n\n1. Lee `git diff`.\n2. Resume riesgos.\n\n```sh\ngit diff --stat\n```';
      window.phantom = {
        onEvent() { return () => {}; },
        async invoke(method, payload = {}) {
          if (method === 'state.get') return structuredClone(state);
          if (method === 'terminal.list') return [];
          if (['workspace.update', 'node.update'].includes(method)) return {};
          if (method === 'plugins.list') return { items: [{ id: 'phantom', name: 'Phantom', version: '1.0.0', enabled: true, config: { model: 'synthetic/model' }, panels: [], actions: [] }] };
          if (method === 'phantom.list' && payload.topic === 'tasks') {
            firstRead ||= Date.now();
            const items = tasks.map(raw => ({ id: raw.id, title: raw.contract.goal, kind: 'card', status: raw.status, source: 'phantom', raw }));
            // After 2.5 s Phantom reports the ready card as blocked (a live change).
            if (Date.now() - firstRead > 2500) { const moved = items.find(item => item.id === 'task_9a10'); moved.status = 'blocked'; moved.raw = { ...moved.raw, status: 'blocked', reason: 'SYNTHETIC · un check de aceptación falló.' }; }
            return { available: true, items, controllers: [{ id: 'ctl', taskId: 'task_06db', status: 'running', action: 'run', createdAt: new Date(Date.now() - 252000).toISOString(), output: 'leyendo host-client.mjs\n✓ desktop/host-client.mjs editado\n' }] };
          }
          if (method === 'phantom.detail' && payload.topic === 'tasks') { const raw = tasks.find(task => task.id === payload.id); return { ...raw, run: { id: 'run_2', status: 'failed', mode: 'verification', startedAt: new Date(Date.now() - 900000).toISOString(), endedAt: new Date(Date.now() - 658000).toISOString(), turns: 12, tools: 31, recoveryOf: 'run_1' } }; }
          if (method === 'phantom.events') return { items: [{ id: 1, at: new Date(Date.now() - 720000).toISOString(), type: 'verification.failed' }, { id: 2, at: new Date(Date.now() - 1900000).toISOString(), type: 'run.reconciled' }], truncated: false };
          if (method === 'phantom.controllers') return { items: [] };
          if (method === 'phantom.list' && payload.topic === 'skills') return { available: true, items: structuredClone(skills) };
          if (method === 'phantom.detail' && payload.topic === 'skills') { const item = skills.find(skill => skill.id === payload.id); return { ...item, source: 'phantom', manifest: { id: item.id, version: item.ref.version, description: item.raw.description, actions: ['revisar', 'resumir'], requiresTools: ['git'], body, resources: [{ name: 'checklist.md', mediaType: 'text/markdown', content: '- Tests verdes\n- Sin secretos' }] } }; }
          throw new Error(`Unexpected fixture API: ${method}`);
        },
      };
    }, { data: fixture(panelType) });
    await page.goto(server.resolvedUrls.local[0]);
    if (panelType === 'phantom-cards') {
      const cards = page.locator('.pc-root');
      await cards.locator('.pc-zone-decide .pc-card').first().waitFor();
      await cards.getByRole('button', { name: 'Ejecutar con synthetic/model' }).first().waitFor();
      assert.equal(await cards.locator('.pc-zone-decide .pc-card').count(), 2);
      await page.screenshot({ path: path.join(evidence, 'cards-desk.png') });
      // Live poll moves task_9a10 into the decision zone and keeps it lit.
      await cards.locator('.pc-card.is-fresh').waitFor({ timeout: 9000 });
      assert.equal(await cards.locator('.pc-zone-decide .pc-card').count(), 3);
      await page.screenshot({ path: path.join(evidence, 'cards-fresh.png') });
      await cards.getByRole('button', { name: 'SYNTHETIC · Corregir timeouts al preparar worktrees con npm ci', exact: true }).click();
      await cards.locator('.pc-contract .pc-summary').waitFor();
      await page.screenshot({ path: path.join(evidence, 'cards-contract.png') });
      await cards.getByRole('button', { name: 'Tablero', exact: true }).click();
      await cards.locator('.plugin-board-column').first().waitFor();
      await page.screenshot({ path: path.join(evidence, 'cards-board.png') });
      await cards.getByRole('button', { name: 'Nueva Card', exact: true }).click();
      await cards.locator('.plugin-card-form').waitFor();
      await page.screenshot({ path: path.join(evidence, 'cards-form.png') });
      await cards.locator('.pc-budget').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidence, 'cards-form-budget.png') });
    } else {
      const skills = page.locator('.plugin-skills');
      await skills.locator('.plugin-skill-list .plugin-skill').first().waitFor();
      await page.screenshot({ path: path.join(evidence, 'skills-list.png') });
      await skills.locator('.plugin-skill').first().click();
      await skills.locator('.sk-instructions .md').waitFor();
      await page.screenshot({ path: path.join(evidence, 'skills-detail.png') });
      await skills.getByRole('button', { name: /checklist\.md/ }).click();
      await page.screenshot({ path: path.join(evidence, 'skills-resource.png') });
    }
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.locator('.canvas-node').getByLabel('Enfocar panel', { exact: true }).click();
    await page.locator('.canvas-node.focused').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(evidence, `${panelType}-narrow.png`) });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS phantom panels render · captures in ${evidence}`);
} finally {
  await browser?.close();
  await server.close();
}
