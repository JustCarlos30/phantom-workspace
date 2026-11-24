import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Isolated component journey: shared Titi rig, notch and empty-state anatomy/CSS.
// Synthetic source readings only; no host, PTY, user profile or network assets.
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = '/tmp/phantom-gengar-identity';
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderOpen, Layers, StickyNote, TerminalSquare } from 'lucide-react';
import EmptyState from '/src/components/EmptyState.jsx';
import TitiMascot from '/src/components/GengarMascot.jsx';
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
  root.render(React.createElement('div', { className: 'app-shell ' + (gengar ? 'studio-character ' : '') + (concentration ? 'studio-concentration' : ''), style: { '--identity-opacity': intensity } },
    React.createElement('main', { className: 'workspace-main', style: { width: '100%', height: '100vh' } },
      React.createElement('div', { className: 'create-dock activity-dock' }, React.createElement(ActivityNotch, { activity, identity: gengar && screen === 'populated', open: false, onToggle: () => { window.fixtureAction = 'needs'; } })),
      React.createElement('div', { className: 'canvas-region', style: { flex: 1 } },
        React.createElement('section', { className: 'canvas ' + (welcome ? 'welcome-canvas' : ''), style: { height: '100%' } },
          screen !== 'populated' && React.createElement(EmptyState, { className: 'canvas-empty', size: 'hero', heading: welcome ? 'h1' : 'h2',
            icon: gengar ? React.createElement(TitiMascot) : (welcome ? FolderOpen : Layers),
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
      res.end('<!doctype html><html lang="es"><title>Titi · isolated journey</title><div id="root"></div><script type="module" src="/__gengar.jsx"></script></html>');
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
   const sprite = page.locator('[data-identity]');
   const assertSprite = async (motion, size) => {
     await page.waitForFunction(({ motion, size }) => {
       const canvas = document.querySelector('canvas[data-identity]');
       return canvas?.dataset.motion === motion && canvas.getBoundingClientRect().width === size && canvas.getBoundingClientRect().height === size
         && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
     }, { motion, size });
     assert.equal(await sprite.count(), 1, 'One identity placement per scene');
     assert.equal(await sprite.evaluate(el => getComputedStyle(el).imageRendering), 'pixelated');
     assert.equal(await page.locator('img[src*="gengar"]').count(), 0);
   };
  for (const screen of ['welcome', 'empty']) {
    await render({ screen });
     assert.equal(await sprite.isVisible(), true);
     await assertSprite('stopped', 88);
     assert.equal(await page.locator('.activity-notch .phantom-face').count(), 0);
    await capture(screen);
    await page.getByRole('button', { name: screen === 'welcome' ? 'Abrir carpeta' : 'Crear terminal', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixtureAction), screen === 'welcome' ? 'Abrir carpeta' : 'Crear terminal');
  }
  for (const [state, mood] of [['offline', 'asleep'], ['loading', 'unsure'], ['stale', 'unsure'], ['error', 'unsure'], ['grin', 'grin'], ['working', 'working'], ['calm', 'calm']]) {
     await render({ screen: 'populated', state });
    assert.equal(await page.locator('.activity-notch .phantom-face').getAttribute('data-mood'), mood);
    const face = await page.locator('.activity-notch .phantom-face').evaluate(el => ({ tag: el.tagName, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, src: el.src, opacity: getComputedStyle(el).opacity, filter: getComputedStyle(el).filter, animation: getComputedStyle(el).animationName }));
     assert.equal(face.tag, 'CANVAS'); assert.equal(face.width, 28); assert.equal(face.height, 28);
     assert.equal(face.animation, 'none'); assert.equal(face.filter, 'none');
     await assertSprite('stopped', 28);
    const label = await page.locator('.activity-notch').getAttribute('aria-label');
    assert.ok(label.includes(await page.locator('.activity-notch strong').innerText()));
    await capture(`face-${state}`);
  }
  await page.locator('.activity-notch').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.fixtureAction), 'needs');
  await render({ gengar: false });
   assert.equal(await sprite.count(), 0);
   assert.equal(await page.locator('.activity-notch .phantom-face').count(), 0);
  assert.equal(await page.locator('.notch-state-fallback').isVisible(), true);
  await capture('hidden');
  await render({ intensity: 0 });
   assert.equal(await sprite.evaluate(el => getComputedStyle(el).opacity), '0');
   await assertSprite('stopped', 88);
  await render({ concentration: true, intensity: 1 });
   assert.equal(await sprite.evaluate(el => getComputedStyle(el).opacity), '0.12');
   await assertSprite('stopped', 88);
  assert.equal(await page.locator('.phantom-face').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  await capture('concentration');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
   await render({ screen: 'populated', state: 'working' });
   await assertSprite('running', 28);
   await render({ screen: 'populated', state: 'calm' });
   await assertSprite('stopped', 28);
   const rest = await sprite.evaluate(el => el.toDataURL());
   await page.waitForTimeout(500);
   assert.equal(await sprite.evaluate(el => el.toDataURL()), rest, 'rest has no decorative loop');
   await render({ screen: 'populated', state: 'grin' });
   await assertSprite('running', 28);
   await render({ screen: 'populated', state: 'working', concentration: true });
   await assertSprite('stopped', 28);
   await render({ screen: 'populated', state: 'working' });
   await assertSprite('running', 28);
  // Visibility lifecycle without moving focus to a real user's window.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
   await assertSprite('stopped', 28);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
   await assertSprite('running', 28);
   await sprite.evaluate(el => { el.style.transform = 'translateX(3000px)'; });
   await assertSprite('stopped', 28);
   await sprite.evaluate(el => { el.style.transform = ''; });
   await assertSprite('running', 28);
  await page.setViewportSize({ width: 1100, height: 699 });
  await render({ screen: 'empty' });
   await assertSprite('stopped', 66);
   const bounds = await sprite.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1100 && bounds.y + bounds.height <= 699);
  await capture('compact');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidence, 'gengar-identity-checks.json'), JSON.stringify({ capturedAt: new Date().toISOString(), executablePath, scope: 'Isolated shipping components with synthetic readings; not a host/Electron integration test or human visual approval.', captures, errors }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
