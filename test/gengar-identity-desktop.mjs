import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Isolated component journey: local pixel sprites, notch and empty-state anatomy/CSS.
// Synthetic source readings only; no host, PTY, user profile or network assets.
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = '/tmp/phantom-gengar-identity';
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderOpen, Layers, StickyNote, TerminalSquare } from 'lucide-react';
import EmptyState from '/src/components/EmptyState.jsx';
import GengarMascot from '/src/components/GengarMascot.jsx';
import ActivityNotch from '/src/components/ActivityNotch.jsx';
import '/src/styles.css';
import '/src/empty-state.css';
import '/src/studio.css';
import '/src/activity.css';
import '/src/canvas-ui.css';
const root = createRoot(document.getElementById('root'));
window.renderFixture = ({ screen = 'welcome', state = 'calm', gengar = true, intensity = .55, concentration = false } = {}) => {
  const now = Date.now();
  const sources = Object.fromEntries(['tasks', 'sessions', 'merges'].map(key => [key, { at: state === 'loading' ? 0 : now - (state === 'stale' ? 60000 : 0), error: state === 'error' && key === 'tasks' ? 'Synthetic read failure' : null }]));
  const activity = { connected: state !== 'offline', now, sources, needs: state === 'grin' ? [{ id: 'approval' }] : [], inProgress: state === 'working' ? [{ tone: 'working' }] : [], activeSessions: [], integrations: { active: [] }, unread: 0 };
  const welcome = screen === 'welcome';
  const action = label => React.createElement('button', { className: 'button primary', onClick: () => { window.fixtureAction = label; } }, label);
  root.render(React.createElement('div', { className: 'app-shell studio-gengar ' + (gengar ? 'studio-character ' : '') + (concentration ? 'studio-concentration' : ''), style: { '--gengar-intensity': intensity } },
    React.createElement('main', { className: 'workspace-main', style: { width: '100%', height: '100vh' } },
      React.createElement('header', { className: 'workspace-header' }, React.createElement(ActivityNotch, { activity, open: false, onToggle: () => { window.fixtureAction = 'needs'; } })),
      React.createElement('div', { className: 'canvas-region', style: { flex: 1 } },
        React.createElement('section', { className: 'canvas ' + (welcome ? 'welcome-canvas' : ''), style: { height: '100%' } },
          React.createElement(EmptyState, { className: 'canvas-empty', size: 'hero', heading: welcome ? 'h1' : 'h2',
            icon: gengar ? React.createElement(GengarMascot) : (welcome ? FolderOpen : Layers),
            title: welcome ? 'Un espacio para cada proyecto' : 'Tu mesa de trabajo, en un lugar',
            description: welcome ? 'Elige una carpeta de tu equipo. Terminales, páginas y contexto quedan vinculados a ella, listos para volver.' : 'Abre una terminal, toma una nota o pega una imagen, un video o un enlace. Cada panel conserva su lugar en este proyecto.',
            actions: welcome ? action('Abrir carpeta') : React.createElement(React.Fragment, null, action('Crear terminal'), action('Escribir nota')),
            hint: welcome ? 'El trabajo vive en tu equipo · No se crean archivos en la carpeta' : 'Arrastra una cabecera para organizar · Ctrl + V pega referencias · C comenta' }
          )
        )
      )
    )
  ));
};
window.renderFixture();
`;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false }, plugins: [{
  name: 'isolated-gengar-journey',
  configureServer(server) {
    server.middlewares.use('/__gengar.jsx', async (_req, res, next) => {
      try {
        const result = await server.transformRequest('/__gengar-entry.jsx');
        res.setHeader('Content-Type', 'text/javascript');
        res.end(result.code);
      } catch (error) { next(error); }
    });
    server.middlewares.use('/__gengar', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html lang="es"><title>Gengar · isolated journey</title><div id="root"></div><script type="module" src="/__gengar.jsx"></script></html>');
    });
  },
  resolveId(id) { if (id === '/__gengar-entry.jsx') return '\0gengar-entry.jsx'; },
  load(id) { if (id === '\0gengar-entry.jsx') return fixture; },
}] });
let browser;
const errors = [];
const captures = [];
let executablePath;
try {
  await fs.mkdir(evidence, { recursive: true });
  const candidates = [...new Set([
    process.env.PHANTOM_TEST_CHROMIUM,
    chromium.executablePath(),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      executablePath = candidate;
      break;
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  assert.ok(executablePath, `Chromium no está disponible. El controlador debe proporcionar PHANTOM_TEST_CHROMIUM o instalar el runtime de Playwright. Rutas comprobadas: ${candidates.join(', ')}`);
  await server.listen();
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1520, height: 980 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__gengar`);
  await page.waitForFunction(() => typeof window.renderFixture === 'function');
  const render = async options => {
    await page.evaluate(options => window.renderFixture(options), options);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const capture = async name => {
    const filename = `gengar-${name}.png`;
    await page.screenshot({ path: path.join(evidence, filename) });
    captures.push(filename);
  };
  const sprite = page.locator('.gengar-mascot img');
  const assertSprite = async (file, width, height) => {
    await page.waitForFunction(({ file, width, height }) => {
      const img = document.querySelector('.gengar-mascot img');
      return img?.src.includes(file) && img.complete && img.naturalWidth > 0
        && img.getBoundingClientRect().width === width && img.getBoundingClientRect().height === height;
    }, { file, width, height });
    assert.equal(await sprite.evaluate(el => getComputedStyle(el).imageRendering), 'pixelated');
  };
  for (const screen of ['welcome', 'empty']) {
    await render({ screen });
    assert.equal(await page.locator('.gengar-mascot').count(), 1);
    assert.equal(await page.locator('.gengar-mascot').isVisible(), true);
    await assertSprite('gengar-icon.png', 80, 60);
    assert.equal(await page.locator('.gengar-mascot svg').count(), 0);
    await capture(screen);
    await page.getByRole('button', { name: screen === 'welcome' ? 'Abrir carpeta' : 'Crear terminal', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixtureAction), screen === 'welcome' ? 'Abrir carpeta' : 'Crear terminal');
  }
  for (const [state, mood] of [['offline', 'asleep'], ['loading', 'unsure'], ['stale', 'unsure'], ['error', 'unsure'], ['grin', 'grin'], ['working', 'working'], ['calm', 'calm']]) {
    await render({ screen: 'empty', state });
    assert.equal(await page.locator('.activity-notch .phantom-face').getAttribute('data-mood'), mood);
    const face = await page.locator('.activity-notch .phantom-face').evaluate(el => ({ tag: el.tagName, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, src: el.src, opacity: getComputedStyle(el).opacity, filter: getComputedStyle(el).filter, animation: getComputedStyle(el).animationName }));
    assert.equal(face.tag, 'IMG'); assert.equal(face.width, 40); assert.equal(face.height, 30);
    assert.ok(face.src.includes('gengar-icon.png')); assert.equal(face.animation, 'none');
    assert.equal(Number(face.opacity), mood === 'asleep' ? .5 : mood === 'unsure' ? .7 : 1);
    if (mood === 'asleep') assert.match(face.filter, /grayscale\(1\)/);
    if (mood === 'grin') assert.match(face.filter, /drop-shadow/);
    const label = await page.locator('.activity-notch').getAttribute('aria-label');
    assert.ok(label.includes(await page.locator('.activity-notch strong').innerText()));
    await capture(`face-${state}`);
  }
  await page.locator('.activity-notch').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.fixtureAction), 'needs');
  await render({ gengar: false });
  assert.equal(await page.locator('.gengar-mascot').count(), 0);
  assert.equal(await page.locator('.activity-notch .phantom-face').isVisible(), false);
  assert.equal(await page.locator('.notch-state-fallback').isVisible(), true);
  await capture('hidden');
  await render({ intensity: 0 });
  assert.equal(await page.locator('.gengar-mascot').evaluate(el => getComputedStyle(el).opacity), '0');
  assert.equal(await page.locator('.activity-notch .phantom-face').evaluate(el => getComputedStyle(el).opacity), '1');
  await render({ concentration: true, intensity: 1 });
  assert.equal(await page.locator('.gengar-mascot').evaluate(el => getComputedStyle(el).opacity), '0.12');
  await assertSprite('gengar-icon.png', 80, 60);
  assert.equal(await page.locator('.phantom-face').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  await capture('concentration');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await render({ screen: 'empty', state: 'working' });
  await assertSprite('gengar-idle.gif', 148, 126);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.phantom-face')).animationName === 'gengar-hop');
  await render({ screen: 'empty', state: 'calm' });
  assert.equal(await page.locator('.phantom-face').evaluate(el => getComputedStyle(el).animationName), 'none', 'rest has no state animation');
  await render({ screen: 'empty', state: 'grin' });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.phantom-face')).animationDuration === '2.4s');
  await render({ screen: 'empty', concentration: true });
  await assertSprite('gengar-icon.png', 80, 60);
  await render({ screen: 'empty' });
  await assertSprite('gengar-idle.gif', 148, 126);
  // Visibility lifecycle without moving focus to a real user's window.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await assertSprite('gengar-icon.png', 80, 60);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await assertSprite('gengar-idle.gif', 148, 126);
  await page.locator('.gengar-mascot').evaluate(el => { el.style.transform = 'translateX(3000px)'; });
  await assertSprite('gengar-icon.png', 80, 60);
  await page.locator('.gengar-mascot').evaluate(el => { el.style.transform = ''; });
  await assertSprite('gengar-idle.gif', 148, 126);
  await page.setViewportSize({ width: 1100, height: 699 });
  await render({ screen: 'empty' });
  await assertSprite('gengar-idle.gif', 74, 63);
  const bounds = await page.locator('.gengar-mascot').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1100 && bounds.y + bounds.height <= 699);
  await capture('compact');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidence, 'gengar-identity-checks.json'), JSON.stringify({ capturedAt: new Date().toISOString(), executablePath, scope: 'Isolated shipping components with synthetic readings; not a host/Electron integration test or human visual approval.', captures, errors }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
