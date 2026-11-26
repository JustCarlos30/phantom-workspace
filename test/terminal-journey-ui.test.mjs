import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Rendered acceptance of the «Recorrido» panel (TerminalJourney) with its real CSS in headless Chromium
// (esbuild stdin bundle + page.setContent, no fixture file, no HTTP server). Data: SYNTHETIC runs passed through the real
// terminalJourney(). It does not prove ChatCard/TerminalPanel mounting nor a human visual approval. Screenshots go outside the Git tree.
const artifacts = '/tmp/phantom-terminal-journey';
const results = [], measurements = [];
let browser, bundle;

const contents = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import TerminalJourney from './src/components/TerminalJourney.jsx';
import { terminalJourney } from './src/hooks/terminal-journey.mjs';
import './src/styles.css';
import './src/studio.css';
import './src/canvas-ui.css';
import './src/chat.css';
const NOW = Date.parse('2026-11-26T12:00:00Z');
const at = seconds => new Date(NOW - seconds * 1000).toISOString();
let root;
window.mountJourney = ({ width, phase, round = 0, blocker = null, compact = false }) => {
  const run = { taskId: 'synthetic-0002', phase, activity: phase === 'blocked' ? '' : 'edit · test/synthetic-journey.test.mjs', startedAt: at(300), lastEventAt: at(12), elapsedMs: 300000, idleMs: 12000, round, children: { done: 0, total: 0, items: [] }, stalled: false, looping: false, log: [], blocker, observedAt: at(12) };
  const view = terminalJourney({ node: { id: 'synthetic', data: { agent: { status: 'working', run } } }, now: NOW });
  const host = document.getElementById('fixture');
  host.style.width = width + 'px';
  root = createRoot(host);
  root.render(<div className="pc-journey"><TerminalJourney view={view} compact={compact} /></div>);
};
`;

before(async () => {
  await mkdir(artifacts, { recursive: true });
  bundle = await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'jsx', sourcefile: 'terminal-journey-entry.jsx' }, bundle: true, write: false, outdir: `${artifacts}/bundle`, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' } });
  let executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath) && fs.existsSync('/ms-playwright')) {
    const installed = fs.readdirSync('/ms-playwright').filter(name => name.startsWith('chromium-'));
    executablePath = installed.flatMap(name => ['chrome-linux', 'chrome-linux64'].map(dir => `/ms-playwright/${name}/${dir}/chrome`)).find(file => fs.existsSync(file));
    assert.ok(executablePath, 'Chromium preinstalado en la imagen declarada');
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  await mkdir(artifacts, { recursive: true });
  await writeFile(`${artifacts}/terminal-journey-verification.md`, [
    '# Verificación renderizada del Recorrido', '',
    `Generado por \`node --test test/terminal-journey-ui.test.mjs\` el ${new Date().toISOString()}.`,
    'TerminalJourney productivo con su CSS real, Chromium headless, bundle esbuild y page.setContent. Datos sintéticos. No acredita el montaje en ChatCard/TerminalPanel ni aprobación visual humana.', '',
    '## Aceptaciones observadas', ...(results.length ? results.map(result => `- ${result}`) : ['Ninguna aceptación completada. Este informe no acredita éxito.']), '',
    '## Geometría', '| Escenario | Ancho | Overflow horizontal px |', '| --- | ---: | ---: |', ...measurements.map(m => `| ${m.scenario} | ${m.width} | ${m.overflow} |`), '',
  ].join('\n'));
});

const BLOCKER = { category: 'budget', autonomy: 'human', summary: 'Se agotó el presupuesto sintético tras dos rondas.', remedy: 'Amplía el presupuesto del encargo sintético.', commands: ['node scripts/synthetic.mjs retry synthetic-0002'], retryAt: '' };
const SCENARIOS = {
  checks: { phase: 'checks' },
  repair: { phase: 'repair', round: 1 },
  blocked: { phase: 'blocked', round: 2, blocker: BLOCKER },
  unknown: { phase: 'blocked', round: 1, blocker: { category: 'invented', autonomy: 'invented', summary: 'Motivo sintético.', remedy: '', commands: [], retryAt: '' } },
};

async function render(scenario, width) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body class="app-shell"><div id="fixture"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: 'body.app-shell { margin: 0; min-width: 0; display: block; } #fixture { box-sizing: border-box; max-width: 100%; }' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.evaluate(options => window.mountJourney(options), { ...SCENARIOS[scenario], width });
  await page.locator('.tj').waitFor();
  page.check = () => { assert.deepEqual(errors, []); assert.deepEqual(requests, [], 'Render estrictamente offline'); };
  return page;
}
const box = async locator => (await locator.boundingBox());

test('en reparación la línea ocupa una sola fila de ≤ 32 px a 880 px', async () => {
  const page = await render('repair', 880);
  const tj = await box(page.locator('.tj'));
  assert.ok(tj.height <= 32, `alto ${tj.height}`);
  const pad = await page.locator('.pc-journey').evaluate(el => { const s = getComputedStyle(el); return [parseFloat(s.paddingTop), parseFloat(s.paddingBottom)]; });
  assert.ok(pad.every(value => value <= 8), `padding vertical ${pad}`);
  const labels = await page.locator('.tj-phase').allInnerTexts();
  assert.equal(labels.length, 4);
  assert.match(labels[2], /Reparación · 1 ronda/);
  assert.equal(await page.locator('.tj-phase[data-status="done"]').count(), 2);
  assert.equal(await page.locator('ol[aria-label="Fases"] [aria-current="step"]').count(), 1);
  await page.screenshot({ path: `${artifacts}/reparacion-880.png` });
  page.check();
  await page.close();
  results.push('Reparación a 880 px: una línea de ≤ 32 px, Desarrollo y Checks hechos, «Reparación · 1 ronda»');
});

test('los pasos son contiguos y arrancan en el mismo borde izquierdo que el estado', async () => {
  const page = await render('checks', 880);
  const status = await box(page.locator('.tj-status'));
  const wrapper = await box(page.locator('.tj'));
  const marks = page.locator('.tj-mark');
  const xs = [];
  for (let index = 0; index < await marks.count(); index++) xs.push((await box(marks.nth(index))).x);
  assert.ok(xs.length >= 3);
  for (let index = 1; index < xs.length; index++) assert.ok(xs[index] - xs[index - 1] <= 200, `distancia ${xs[index] - xs[index - 1]}`);
  assert.ok(Math.abs(status.x - wrapper.x) <= 1, 'el estado arranca en el borde izquierdo del panel');
  assert.ok(xs[0] - (status.x + status.width) <= 24, 'los pasos siguen al estado, no se estiran');
  const strip = await box(page.locator('.tj-strip'));
  assert.ok(strip.width < wrapper.width / 2, `franja ${strip.width}`);
  const rows = new Set(await page.locator('.tj-mark').evaluateAll(list => list.map(el => Math.round(el.getBoundingClientRect().y))));
  assert.equal(rows.size, 1, 'todos los pasos en la misma fila');
  await page.screenshot({ path: `${artifacts}/checks-880.png` });
  page.check();
  await page.close();
  results.push('Checks a 880 px: pasos contiguos (≤ 200 px entre marcas), misma fila y alineados con el estado');
});

test('bloqueado conserva el camino recorrido y muestra el motivo una sola vez', async () => {
  const page = await render('blocked', 880);
  const steps = await page.locator('.tj-phase').evaluateAll(list => list.map(el => [el.querySelector('.tj-phase-label').textContent, el.dataset.status]));
  assert.deepEqual(steps.map(step => step[1]), ['done', 'done', 'done', 'blocked']);
  assert.match(steps[2][0], /Reparación · 2 rondas/);
  assert.match(steps[3][0], /Bloqueado/);
  assert.equal(await page.locator('.tj-blocker-summary').count(), 1);
  assert.equal(((await page.locator('.tj').innerText()).match(/Se agotó el presupuesto sintético/g) || []).length, 1);
  await page.getByRole('button', { name: 'Detalles' }).click();
  assert.equal(((await page.locator('.tj').innerText()).match(/Se agotó el presupuesto sintético/g) || []).length, 1, 'abrir Detalles no repite el motivo');
  await page.screenshot({ path: `${artifacts}/bloqueado-880.png` });
  page.check();
  await page.close();
  const unknown = await render('unknown', 880);
  const text = await unknown.locator('.tj').innerText();
  assert.ok((text.match(/Bloqueo sin clasificar/g) || []).length <= 1);
  assert.equal((text.match(/Motivo sintético/g) || []).length, 1);
  unknown.check();
  await unknown.close();
  results.push('Bloqueado tras 2 rondas: camino Desarrollo · Checks · Reparación · Bloqueado y motivo una sola vez');
});

test('Detalles abre alineado a la izquierda, con etiqueta–valor en dos columnas y el chevrón girado', async () => {
  const page = await render('blocked', 880);
  const toggle = page.getByRole('button', { name: 'Detalles' });
  const before = await toggle.locator('svg').evaluate(el => getComputedStyle(el).transform);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  const after = await toggle.locator('svg').evaluate(el => getComputedStyle(el).transform);
  assert.notEqual(before, after);
  const wrapper = await box(page.locator('.tj'));
  const facts = await box(page.locator('.tj-facts'));
  assert.ok(Math.abs(facts.x - wrapper.x) <= 1);
  const names = await page.locator('.tj-facts dt').allInnerTexts();
  assert.deepEqual(names, ['Remedio', 'Comando']);
  const dt = await box(page.locator('.tj-facts dt').first()), dd = await box(page.locator('.tj-facts dd').first());
  assert.ok(dd.x > dt.x + dt.width - 1, 'valor en la segunda columna');
  assert.equal(await page.locator('.tj-facts dd code').first().evaluate(el => getComputedStyle(el).userSelect), 'text');
  const toggleBox = await box(toggle);
  assert.ok(toggleBox.x + toggleBox.width >= wrapper.x + wrapper.width - 2, 'Detalles al extremo derecho');
  await page.screenshot({ path: `${artifacts}/detalles-880.png` });
  page.check();
  await page.close();
  results.push('Detalles: cuerpo alineado con el estado, lista de dos columnas, chevrón rotado y comandos seleccionables');
});

test('sin overflow horizontal a 260, 320 y 880 px', async () => {
  for (const scenario of ['repair', 'blocked']) for (const width of [260, 320, 880]) {
    const page = await render(scenario, width);
    if (scenario === 'blocked') await page.getByRole('button', { name: 'Detalles' }).click();
    const overflow = await page.evaluate(() => {
      const panel = document.querySelector('.pc-journey');
      return Math.max(0, panel.scrollWidth - panel.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    });
    measurements.push({ scenario, width, overflow });
    assert.equal(overflow, 0, `${scenario} a ${width} px`);
    if (width === 260) {
      const hidden = await page.locator('.tj-phase:not([aria-current]) .tj-phase-label').evaluateAll(list => list.every(el => getComputedStyle(el).display === 'none'));
      assert.ok(hidden, 'bajo 320 px solo el paso actual conserva etiqueta');
    }
    await page.screenshot({ path: `${artifacts}/${scenario}-${width}.png` });
    page.check();
    await page.close();
  }
  results.push('Sin overflow horizontal a 260, 320 y 880 px (reparación y bloqueado con Detalles abierto)');
});
