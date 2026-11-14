import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

// Real production renderer/Electron and an isolated host. The only chat executable
// is this deterministic Node fixture: no model, external agent or nested task.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/unified-design-');
const profile = path.join(temp, 'profile');
const fixture = path.join(temp, 'fixture-provider');
await writeFile(fixture, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('fixture 1.0'); process.exit(0); }
const out = value => console.log(JSON.stringify(value));
process.stdin.resume();
process.stdin.on('end', () => {
  out({type:'system',subtype:'init',session_id:'unified-fixture'});
  out({type:'assistant',message:{id:'synthetic-reply',content:[{type:'text',text:${JSON.stringify('Contenido sintético para verificar lectura y scroll.\n\n'.repeat(50))}}]}});
  out({type:'result',subtype:'success',is_error:false,result:'ok',session_id:'unified-fixture'});
});
`, { mode: 0o700 });
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const errors = [], captures = [], checks = [];
let app, appProcess, page, host;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function range(selector, value) {
  await page.locator(selector).evaluate((el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await settle();
}
async function size(w, h) {
  await app.evaluate(({ BrowserWindow }, [width, height]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(580, 500); win.setContentSize(width, height);
  }, [w, h]);
  await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, [w, h]);
  await settle();
}
async function capture(name) {
  const file = path.join(temp, `${name}.png`);
  await page.screenshot({ path: file }); captures.push(file);
}
async function geometry(input) {
  await settle();
  return input.evaluate(el => {
    const root = el.closest('.pc'), controls = root.querySelector('.pc-controls'), thread = root.querySelector('.pc-thread');
    const r = root.getBoundingClientRect(), c = controls.getBoundingClientRect();
    return { height: el.offsetHeight, available: root.clientHeight, scroll: el.scrollHeight, client: el.clientHeight,
      thread: thread.clientHeight, controlVisible: c.top >= r.top && c.bottom <= r.bottom + 1 && c.right <= r.right + 1 && c.left >= r.left - 1,
      overflow: getComputedStyle(el).overflowY, transition: getComputedStyle(el).transitionProperty,
      horizontal: root.scrollWidth > root.clientWidth, width: el.clientWidth };
  });
}
async function exercise(input, resize, label) {
  await input.fill('');
  const initial = await geometry(input);
  assert.equal(initial.height, 38, `${label}: common initial height`);
  await input.fill('Una línea para probar el ajuste de ancho. '.repeat(8));
  const wide = await geometry(input);
  await capture(`${label}-tall`);
  await resize('narrow');
  const narrow = await geometry(input);
  assert.ok(narrow.width < wide.width, `${label}: container became narrower`);
  assert.ok(narrow.height > wide.height, `${label}: width resize reflows unchanged draft`);
  await input.fill('Línea sintética larga para scroll interno.\n'.repeat(100));
  const limited = await geometry(input);
  assert.ok(limited.scroll > limited.client, `${label}: text scrolls internally`);
  assert.equal(limited.overflow, 'auto');
  assert.ok(limited.height <= Math.max(38, Math.floor(limited.available * .45)), `${label}: space budget`);
  assert.ok(limited.controlVisible && !limited.horizontal, `${label}: controls fit`);
  assert.ok(limited.thread >= 40, `${label}: conversation keeps reading space`);
  assert.equal(limited.transition, 'none', `${label}: typing has no height animation`);
  await input.evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.ok(await input.evaluate(el => el.scrollTop > 0), `${label}: actual scroll position changes`);
  await resize('short');
  const short = await geometry(input);
  assert.ok(short.height < limited.height, `${label}: height resize reduces unchanged draft`);
  assert.ok(short.controlVisible && short.thread >= 40, `${label}: short container retains controls and thread`);
  await capture(`${label}-narrow-short`);
  await input.fill('Borrador breve');
  assert.equal((await geometry(input)).height, initial.height, `${label}: shrinks after delete`);
  await input.fill('Texto sintético enviado\n'.repeat(12));
  await input.press('Enter');
  await page.waitForFunction(selector => document.querySelector(selector)?.value === '', await input.getAttribute('aria-label').then(name => `textarea[aria-label="${name}"]`));
  assert.equal((await geometry(input)).height, initial.height, `${label}: shrinks after send`);
  const thread = input.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," pc ")][1]').locator('.pc-thread');
  await page.waitForFunction(selector => {
    const el = document.querySelector(selector); return el && el.scrollHeight > el.clientHeight;
  }, label === 'card' ? '.canvas-node .pc-thread' : '.phantom-chat-thread');
  await thread.evaluate(el => { el.scrollTop = 0; });
  assert.equal(await thread.evaluate(el => el.scrollTop), 0, `${label}: conversation owns independent scroll`);
  checks.push({ label, initial, wide, narrow, limited, short });
}

try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
  appProcess = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  assert.equal((await invoke('state.get')).workspaces.length, 0);
  await invoke('settings.update', { patch: { claudePath: fixture, codexPath: fixture, opencodePath: fixture } });
  const folder = path.join(temp, 'Proyecto A'); await mkdir(folder);
  const workspace = await invoke('workspace.open', { path: folder });
  await invoke('node.create', { workspaceId: workspace.id, type: 'terminal', title: 'Compositor sintético', x: 340, y: 80, width: 660, height: 760, data: { chat: { provider: 'claude' } } });
  await page.reload(); await size(1520, 980);
  const card = page.getByLabel('Mensaje para Claude', { exact: true }); await card.waitFor();
  const resizeCard = async mode => {
    const dimensions = mode === 'narrow' ? [340, 760] : [340, 400];
    await page.locator('.canvas-node').filter({ has: card }).evaluate((el, [width, height]) => {
      el.style.width = `${width}px`; el.style.height = `${height}px`;
    }, dimensions);
    await settle();
  };
  await exercise(card, resizeCard, 'card');
  await page.locator('.canvas-node').getByRole('button', { name: 'Enfocar panel', exact: true }).click();
  await page.locator('.canvas-node.focused').waitFor();
  assert.equal((await geometry(card)).height, 38, 'focus retains the common initial height');
  await card.fill('Línea sintética en foco\n'.repeat(100));
  const focused = await geometry(card);
  assert.ok(focused.height <= Math.floor(focused.available * .45));
  assert.ok(focused.controlVisible && focused.scroll > focused.client);
  await capture('card-focused'); await card.fill('');
  await page.locator('.canvas-node.focused').getByRole('button', { name: 'Volver al mapa', exact: true }).click();
  checks.push({ focused });
  await page.getByRole('button', { name: 'Abrir chat con Phantom', exact: true }).click();
  const side = page.getByLabel('Mensaje para Phantom', { exact: true }); await side.waitFor();
  await exercise(side, mode => mode === 'narrow' ? size(1100, 980) : size(1100, 560), 'phantom');
  const materials = await page.evaluate(() => {
    const style = selector => { const css = getComputedStyle(document.querySelector(selector)); return { background: css.backgroundColor, backdrop: css.backdropFilter }; };
    return { side: style('.phantom-chat'), thread: style('.phantom-chat-thread'), field: style('.phantom-chat .pc-field'), rail: style('.project-rail') };
  });
  for (const key of ['side', 'thread', 'field']) {
    assert.match(materials[key].background, /^rgb\(/, `${key}: opaque working surface`);
    assert.equal(materials[key].backdrop, 'none', `${key}: no working-plane glass`);
  }
  assert.notEqual(materials.rail.backdrop, 'none', 'navigation retains glass');
  checks.push({ materials });
  await page.getByRole('complementary', { name: 'Chat con Phantom', exact: true }).getByRole('button', { name: 'Cerrar chat con Phantom', exact: true }).click();
  await size(1520, 980);

  // Migration and actual UI persistence, including a project switch without reload.
  await page.evaluate(id => localStorage.setItem(`phantom:studio:${id}`, JSON.stringify({ v: 2, background: 'gengar', accent: 'iris', grid: false, intensity: 31, image: '' })), workspace.id);
  await page.reload(); await page.getByRole('button', { name: 'Personalizar espacio', exact: true }).click();
  const appearance = page.getByRole('region', { name: 'Apariencia del workspace' });
  // <section aria-label> is a region; controls are native labelled inputs.
  await appearance.waitFor();
  const art = appearance.getByRole('checkbox', { name: /^Mostrar Gengar/ });
  const pulse = appearance.getByRole('checkbox', { name: /^Pulso ambiental/ });
  const concentration = appearance.getByRole('checkbox', { name: /^Concentración/ });
  assert.equal(await pulse.isChecked(), false);
  assert.equal(await appearance.getByRole('button', { name: 'Acento Iris', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#gengar-intensity').inputValue(), '31');
  await art.uncheck();
  assert.equal(await page.locator('.canvas-region').evaluate(el => getComputedStyle(el, '::after').opacity), '0');
  assert.equal(await page.locator('.brand-mark .gengar-icon').isVisible(), false);
  assert.equal(await page.locator('.brand-state-fallback').isVisible(), true);
  await art.check();
  const brandSprite = await page.locator('.brand-mark .gengar-icon').evaluate(el => ({ tag: el.tagName, src: el.src, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, rendering: getComputedStyle(el).imageRendering }));
  assert.equal(brandSprite.tag, 'IMG'); assert.match(brandSprite.src, /gengar-icon/);
  assert.equal(brandSprite.width, 40); assert.equal(brandSprite.height, 30); assert.equal(brandSprite.rendering, 'pixelated');
  assert.equal(await page.locator('.brand-state-fallback').isVisible(), false);
  await range('#background-intensity', 0);
  await range('#gengar-intensity', 70);
  assert.equal(await page.locator('.canvas-region').evaluate(el => getComputedStyle(el, '::after').opacity), '0.7', 'art independent of zero ambient intensity');
  await pulse.check();
  assert.equal(await page.locator('.canvas-region').evaluate(el => getComputedStyle(el, '::before').animationName), 'none', 'reduced-motion suppresses pulse');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('.canvas-region').evaluate(el => getComputedStyle(el, '::before').animationDuration), '16s');
  await concentration.check();
  const quiet = await page.locator('.canvas-region').evaluate(el => ({ art: Number(getComputedStyle(el, '::after').opacity), pulse: getComputedStyle(el, '::before').animationName }));
  assert.ok(Math.abs(quiet.art - .084) < .001); assert.equal(quiet.pulse, 'none');
  for (const sprite of await page.locator('.gengar-icon').all())
    assert.equal(await sprite.evaluate(el => getComputedStyle(el).animationName), 'none', 'Concentración suspende los sprites de estado');
  await capture('concentration');
  const key = `phantom:studio:${workspace.id}`;
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  assert.equal(saved.v, 3); assert.equal(saved.accent, 'iris'); assert.equal(saved.grid, false);
  assert.equal(saved.pulse, true); assert.equal(saved.concentration, true); assert.equal(saved.gengarIntensity, 70);
  await page.reload(); await page.getByRole('button', { name: 'Personalizar espacio', exact: true }).click();
  assert.equal(await concentration.isChecked(), true); assert.equal(await art.isChecked(), true);
  const folderB = path.join(temp, 'Proyecto B'); await mkdir(folderB);
  const other = await invoke('workspace.open', { path: folderB }); await page.reload();
  await page.getByRole('button', { name: 'Personalizar espacio', exact: true }).click();
  assert.equal(await pulse.isChecked(), false); assert.equal(await concentration.isChecked(), false);
  await page.locator('.project-switcher > summary').click();
  await page.getByRole('navigation', { name: 'Proyectos recientes', exact: true }).getByRole('button').filter({ has: page.getByText(workspace.name, { exact: true }) }).click();
  await page.waitForFunction(() => document.querySelector('.app-shell.studio-concentration'));
  // Selecting a project closes the contextual inspector; reopen it through its UI route.
  await appearance.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Personalizar espacio', exact: true }).click();
  await appearance.waitFor();
  assert.equal(await concentration.isChecked(), true);
  assert.equal(await page.evaluate(id => localStorage.getItem(`phantom:studio:${id}`), other.id), null, 'reading a new project does not copy or write preferences');
  await appearance.getByRole('button', { name: 'Restablecer apariencia' }).click();
  assert.equal(await concentration.isChecked(), false); assert.equal(await pulse.isChecked(), false);
  assert.equal(await page.locator('#gengar-intensity').inputValue(), '55');
  // A real failed write must keep the UI and persisted preferences intact.
  const beforeFailure = await page.evaluate(key => localStorage.getItem(key), key);
  await page.evaluate(() => {
    window.__originalStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('phantom:studio:')) throw new DOMException('Fixture quota', 'QuotaExceededError');
      return window.__originalStorageWrite.call(this, key, value);
    };
  });
  try {
    await pulse.click();
    await settle();
    assert.equal(await pulse.isChecked(), false, 'failed preference write does not apply');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), beforeFailure);
    await page.getByText('No se pudo guardar la apariencia local. Libera espacio y vuelve a intentarlo.', { exact: true }).waitFor();
  } finally {
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalStorageWrite; delete window.__originalStorageWrite; });
  }
  await capture('appearance-defaults');
  checks.push({ preferences: 'v2 migration, independent layers, pulse, concentration, reduced-motion, reload, project switch, reset', saved });
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ passed: true, checks, captures, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(temp, 'failure.png') }).catch(() => {});
  console.error(JSON.stringify({ passed: false, checks, captures, errors, error: error.message }));
  throw error;
} finally {
  try {
    if (host) {
      const command = await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '');
      if (command.includes(profile)) {
        await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2500)]);
        try { process.kill(host, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  } finally {
    if (app) await Promise.race([app.close().catch(() => {}), delay(2500)]);
    killElectronGroup(appProcess);
    await rm(profile, { recursive: true, force: true });
  }
}
