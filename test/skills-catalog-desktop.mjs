import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// SYNTHETIC fixtures for the Skills catalog panel on the canvas and in the
// inspector. With SKILLS_REAL=1 the file catalog comes from this machine's real
// integration instead (for local review only). Captures stay outside the repo.
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = '/tmp/opencode/phantom-skills-catalog-review';
await mkdir(evidence, { recursive: true });
const real = process.env.SKILLS_REAL === '1';
const server = await createServer({ root, configFile: false, base: '/', cacheDir: path.join(evidence, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1520, height: 980 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  if (real) {
    const { skillsCatalog, skillsRead } = await import('../integrations/skills.mjs');
    const workspace = { path: root, canonicalPath: root };
    await page.exposeFunction('__realSkills', (method, payload) => (method === 'skills.read' ? skillsRead : skillsCatalog)(payload, { workspace }));
  }
  await page.addInitScript(useReal => {
    const workspace = { id: 'synthetic-skills', name: 'SYNTHETIC · Skills', path: '/synthetic/project', canonicalPath: '/synthetic/project',
      camera: { x: 40, y: 30, zoom: 1 }, tasks: [], contextRefs: [], missions: [], workflows: [], services: [], attention: [],
      nodes: [{ id: 'skills-node', type: 'skills-catalog', title: 'Skills', x: 0, y: 0, width: 920, height: 600, data: {} }] };
    const state = { schemaVersion: 1, settings: {}, activeWorkspaceId: workspace.id, workspaces: [workspace] };
    const file = (name, origin, agent, group, extra = {}) => ({ id: `/synthetic/${group}/${name}/SKILL.md`, name, origin, agent, group,
      description: `SYNTHETIC · ${name} explica cuándo usar esta Skill y qué produce para el agente.`, version: null, path: `/synthetic/${group}/${name}`,
      folders: [], fileCount: 0, ...extra });
    const items = [
      file('release-notes', 'project', 'Claude Code', '.claude/skills', { folders: ['scripts'], fileCount: 2, version: '1.2.0' }),
      file('pdf', 'installed', 'Claude Code', 'Claude Code · sincronizadas', { folders: ['references', 'scripts'], fileCount: 9 }),
      file('pdf', 'installed', 'Codex', 'Codex · usuario'),
      file('remotion-render', 'installed', 'Claude Code', 'Plugin remotion 4.0.535', { plugin: 'remotion', version: '4.0.535' }),
      file('phantom', 'installed', 'OpenCode', 'OpenCode · usuario'),
    ];
    const body = '# Uso\n\nEsta Skill **SYNTHETIC** guía al agente.\n\n## Pasos\n\n1. Lee el `contexto`.\n2. Ejecuta el script.\n\n```sh\nnode scripts/run.mjs\n```\n\n> Nota: solo datos de prueba.\n\n| Campo | Valor |\n|---|---|\n| Modo | lectura |';
    const phantom = [{ id: 'proyecto/revisar', title: 'SYNTHETIC · Revisión guiada', source: 'phantom', ref: { id: 'proyecto/revisar', scope: 'workspace', version: '1.0.0', sha256: 'a'.repeat(64) }, raw: { description: 'SYNTHETIC · Revisión guiada de cambios' } }];
    const calls = window.__skillsCalls = [];
    window.phantom = {
      onEvent() { return () => {}; },
      async invoke(method, payload = {}) {
        calls.push(method);
        if (method === 'state.get') return structuredClone(state);
        if (method === 'terminal.list') return [];
        if (method === 'workspace.update' || method === 'node.update') return {};
        if (method === 'skills.catalog') return useReal ? window.__realSkills(method, payload) : { items: structuredClone(items), roots: [], observedAt: new Date().toISOString() };
        if (method === 'skills.read') {
          if (useReal) return window.__realSkills(method, payload);
          const item = items.find(entry => entry.id === payload.id);
          return { ...item, body, size: 2048, files: [{ path: 'scripts/run.mjs', size: 812 }, { path: 'references/guia.md', size: 4096 }] };
        }
        if (method === 'phantom.list') return { available: true, items: structuredClone(phantom) };
        if (method === 'phantom.detail') return { ...phantom[0].raw, ref: phantom[0].ref, manifest: { id: 'proyecto/revisar', description: 'SYNTHETIC', actions: ['revisar', 'resumir'], requiresTools: ['git'], body } };
        throw new Error(`Unexpected fixture API: ${method}`);
      },
    };
  }, real);
  await page.goto(server.resolvedUrls.local[0]);
  const panel = page.locator('.sk-root');
  await panel.waitFor();
  await page.locator('.sk-row').first().waitFor();
  const counts = await page.locator('.sk-segment span').allTextContents();
  if (!real) assert.deepEqual(counts, ['6', '1', '1', '4']);
  await page.screenshot({ path: path.join(evidence, `canvas-list${real ? '-real' : ''}.png`) });
  if (real) await page.locator('.sk-segment', { hasText: 'Instaladas' }).click();
  await page.locator('.sk-row').first().click();
  await page.locator('.sk-detail .md').waitFor();
  await page.screenshot({ path: path.join(evidence, `canvas-detail${real ? '-real' : ''}.png`) });
  await page.locator('.sk-instructions').evaluate(node => node.scrollIntoView());
  await page.screenshot({ path: path.join(evidence, `canvas-instructions${real ? '-real' : ''}.png`) });
  if (!real) {
    assert.equal(await page.locator('.sk-detail .md-table td').first().textContent(), 'Modo');
    await page.locator('.sk-segment', { hasText: 'Phantom' }).click();
    await page.locator('.sk-row').first().click();
    await page.locator('.sk-actions .sk-chip', { hasText: 'revisar' }).waitFor();
    await page.locator('.sk-segment', { hasText: 'Todas' }).click();
    await page.locator('.sk-search input').fill('pdf');
    assert.equal(await page.locator('.sk-row').count(), 2);
    assert.match(await page.locator('.sk-row .is-copy').first().textContent(), /También en/);
    await page.locator('.sk-search input').fill('zzz');
    await page.locator('.sk-empty', { hasText: 'Sin coincidencias' }).waitFor();
  }
  // Narrow layout: list and detail swap with a back button.
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.evaluate(() => { const node = document.querySelector('.sk-root'); node.parentElement.style.width = '520px'; });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(evidence, `canvas-narrow${real ? '-real' : ''}.png`) });
  assert.deepEqual(errors, []);
  console.log(`PASS skills catalog renders (${real ? 'real' : 'synthetic'}) · captures in ${evidence}`);
} finally {
  await browser?.close();
  await server.close();
}
