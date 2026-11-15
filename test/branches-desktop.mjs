import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// SYNTHETIC fixtures for the Ramas panel on the canvas. With BRANCHES_REAL=<repo>
// the overview is read (never written) from that repository through the real
// host module, for local review only. Captures stay outside the repo.
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = '/tmp/opencode/phantom-branches-review';
await mkdir(evidence, { recursive: true });
const real = process.env.BRANCHES_REAL || '';
const server = await createServer({ root, configFile: false, base: '/', cacheDir: path.join(evidence, 'vite-cache'), server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  if (real) {
    const { Branches } = await import('../host/branches.mjs');
    const git = (...args) => execFileSync('git', ['-C', real, ...args], { encoding: 'utf8' }).trim();
    const workspace = { id: 'synthetic-branches', path: real, canonicalPath: real, nodes: [] };
    const branches = new Branches({ store: { getWorkspace: () => workspace }, terminals: { sessions: [] }, mutate() {}, merges: { running: new Set(), base: async () => ({ source: git('rev-parse', '--show-toplevel'), branch: git('symbolic-ref', '--short', 'HEAD'), oid: git('rev-parse', 'HEAD') }) } });
    await page.exposeFunction('__realBranches', () => branches.handle('branch.overview', { workspaceId: workspace.id }));
  }
  await page.addInitScript(useReal => {
    const uuid = n => `${String(n).repeat(8)}-6c0b-498c-81c8-aab82e02f145`;
    const terminal = (n, title) => ({ id: `t${n}`, type: 'terminal', title, x: 900, y: n * 40, width: 300, height: 200, data: { hidden: true, worktree: { branch: `phantom/terminal-${uuid(n)}`, path: `/synthetic/worktrees/${uuid(n)}` } } });
    const workspace = { id: 'synthetic-branches', name: 'SYNTHETIC · Ramas', path: '/synthetic/project', canonicalPath: '/synthetic/project', camera: { x: 40, y: 30, zoom: 1 }, tasks: [], contextRefs: [], missions: [], workflows: [], services: [], attention: [],
      nodes: [{ id: 'branches-node', type: 'branches', title: 'Ramas', x: 250, y: 30, width: 820, height: 860, data: {} }, terminal(1, 'SYNTHETIC · Sidebar'), terminal(2, 'SYNTHETIC · Notch')] };
    const state = { schemaVersion: 1, settings: {}, activeWorkspaceId: workspace.id, workspaces: [workspace] };
    const row = (name, extra = {}) => ({ name, oid: 'b'.repeat(40), isBase: false, last: { at: '2026-11-11T09:30:00Z', author: 'SYNTHETIC', subject: 'SYNTHETIC commit' }, worktree: { path: `/synthetic/worktrees/${name.split('-').slice(1).join('-') || name}`, exists: true, main: false, locked: false }, terminal: null, ahead: 0, behind: 0, committed: [], committedCount: 0, changes: [], changeCount: 0, conflicts: null, overlaps: [], request: null, work: 'none', ...extra });
    const overview = () => ({ available: true, observedAt: new Date().toISOString(), integration: { enabled: false }, base: { branch: 'main', oid: 'a'.repeat(40), path: '/synthetic/project' }, branches: [
      row('main', { isBase: true, oid: 'a'.repeat(40), worktree: { path: '/synthetic/project', exists: true, main: true }, work: 'dirty', changeCount: 1, changes: [{ status: ' M', path: 'README.md' }] }),
      row(`phantom/terminal-${uuid(1)}`, { work: 'dirty', behind: 14, changeCount: 3, changes: [{ status: ' M', path: 'src/App.jsx' }, { status: '??', path: 'src/sidebar-new.css' }, { status: ' D', path: 'src/old.css' }], terminal: { nodeId: 't1', title: 'SYNTHETIC · Sidebar', running: true, step: 'SYNTHETIC · Ajustando jerarquía', status: 'working' }, overlaps: [{ path: 'src/App.jsx', with: ['SYNTHETIC · Notch'] }] }),
      row(`phantom/terminal-${uuid(2)}`, { work: 'ready', ahead: 2, behind: 1, conflicts: [], committed: ['src/App.jsx', 'src/activity.css'], committedCount: 2, terminal: { nodeId: 't2', title: 'SYNTHETIC · Notch', running: false, step: '', status: 'idle' }, overlaps: [{ path: 'src/App.jsx', with: ['SYNTHETIC · Sidebar'] }] }),
      row(`phantom/terminal-${uuid(3)}`, { work: 'ready', ahead: 1, behind: 6, conflicts: ['src/chat.css'], committed: ['src/chat.css'], committedCount: 1 }),
      row(`phantom/terminal-${uuid(4)}`, { behind: 21 }),
      row(`phantom/terminal-${uuid(5)}`, { behind: 21, worktree: { path: `/synthetic/worktrees/${uuid(5)}`, exists: false, main: false, locked: false } }),
    ] });
    const calls = window.__branchCalls = [];
    window.phantom = {
      onEvent() { return () => {}; },
      async invoke(method, payload = {}) {
        calls.push([method, payload]);
        if (method === 'state.get') return structuredClone(state);
        if (method === 'terminal.list') return [];
        if (method === 'workspace.update' || method === 'node.update') return {};
        if (method === 'branch.overview') return useReal ? window.__realBranches() : overview();
        if (method === 'phantom.list') return { available: true, items: useReal ? [] : [{ id: 'card-1', title: 'SYNTHETIC · Card en worktree', location: { path: '/w', branch: `phantom/terminal-${uuid(1)}`, main: false } }] };
        if (method === 'skills.catalog') return { items: useReal ? [] : [{ id: '/w/SKILL.md', name: 'synthetic-skill', origin: 'worktree', branch: `phantom/terminal-${uuid(1)}`, drift: 'new' }], roots: [] };
        if (useReal) throw new Error('Solo lectura en revisión real');
        if (method === 'branch.commit') return { branch: payload.branch, oid: 'c'.repeat(40), files: 3 };
        if (method === 'branch.integrate') return payload.branch.includes('1111') ? { status: 'conflict', branch: payload.branch, base: 'main', conflicts: ['src/App.jsx'] } : { status: 'merged', branch: payload.branch, base: 'main', mergedOid: 'd'.repeat(40) };
        if (method === 'branch.update') return { status: 'updated', branch: payload.branch, base: 'main', oid: 'a'.repeat(40) };
        if (method === 'branch.remove') return { status: 'removed', branch: payload.branch };
        throw new Error(`Unexpected fixture API: ${method}`);
      },
    };
  }, Boolean(real));
  await page.goto(server.resolvedUrls.local[0]);
  const panel = page.locator('.br-root');
  await panel.waitFor(); await page.locator('.br-row').first().waitFor();
  await page.screenshot({ path: path.join(evidence, `canvas${real ? '-real' : ''}.png`) });
  if (!real) {
    const calls = method => page.evaluate(name => window.__branchCalls.filter(([m]) => m === name).map(([, p]) => p), method);
    // main plus five branches, each with one state chip, ordered by urgency.
    assert.equal(await page.locator('.br-row').count(), 6);
    assert.equal(await page.locator('.br-group-title').textContent(), '5 ramas de tus sesiones');
    assert.deepEqual(await page.locator('.br-row .br-chip').allTextContents(), ['Sin guardar', 'Conflicto', 'Lista', 'Trabajando', 'En main', 'En main']);
    assert.equal(await page.getByText('Sin Card de Phantom asociada').count(), 0);
    const rowOf = title => page.locator('.br-row', { has: page.locator('.br-title', { hasText: title }) });
    // Saving asks for a message; integrating on save is opt-in.
    const mainRow = rowOf('main');
    await mainRow.getByRole('button', { name: 'Guardar' }).click();
    await mainRow.getByLabel('Mensaje').fill('SYNTHETIC save');
    await page.screenshot({ path: path.join(evidence, 'save-form.png') });
    await mainRow.getByRole('button', { name: 'Guardar 1 archivo' }).click();
    await page.waitForFunction(() => window.__branchCalls.some(([m]) => m === 'branch.commit'));
    assert.deepEqual((await calls('branch.commit')).map(p => p.message), ['SYNTHETIC save']);
    assert.equal((await calls('branch.integrate')).length, 0);
    // A conflict offers no forced action; a ready branch integrates on the second click.
    const clash = rowOf('Sesión cerrada · 33333333');
    assert.equal(await clash.locator('.br-slot').getByRole('button').count(), 0);
    const notch = rowOf('Notch');
    await notch.getByRole('button', { name: 'Integrar', exact: true }).click();
    assert.equal((await calls('branch.integrate')).length, 0);
    await notch.getByRole('button', { name: 'Confirmar integrar' }).click();
    await page.locator('.br-notice.is-ok', { hasText: 'Integrada en main' }).waitFor();
    // Selecting a row opens its detail: the road to main, its files and its actions.
    await notch.locator('button.br-main').click();
    await page.locator('.br-detail-body .mp-steps').waitFor();
    await page.locator('.br-detail-body').getByText('Detalles').waitFor();
    await page.screenshot({ path: path.join(evidence, 'detail.png') });
    await notch.locator('button.br-main').click();
    // Cleaning is confirmed first and only offered for branches without a session.
    await page.getByRole('button', { name: 'Limpiar 2 ramas ya integradas' }).click();
    await page.screenshot({ path: path.join(evidence, 'bulk-confirm.png') });
    assert.equal((await calls('branch.remove')).length, 0);
    await page.getByRole('button', { name: 'Limpiar todas' }).click();
    await page.waitForFunction(() => window.__branchCalls.filter(([m]) => m === 'branch.remove').length === 2);
    await page.locator('.br-search input').fill('sidebar-new');
    assert.equal(await page.locator('.br-group .br-row').count(), 2);
    await page.locator('.br-search input').fill('');
  }
  await page.evaluate(() => { const node = document.querySelector('.br-root'); node.closest('.tw-tool-panel').parentElement.style.width = '420px'; });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(evidence, `narrow${real ? '-real' : ''}.png`) });
  assert.deepEqual(errors, []);
  console.log(`PASS branches panel renders (${real ? 'real' : 'synthetic'}) · captures in ${evidence}`);
} finally {
  await browser?.close();
  await server.close();
}
