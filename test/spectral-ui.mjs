import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

// Built Electron, real isolated host/layout, synthetic chat responses only.
// No provider process or production fixture hook. Controller runs after build.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const evidence = await mkdtemp('/tmp/opencode/spectral-ui-');
const temp = await mkdtemp('/tmp/phantom-spectral-');
const profile = path.join(temp, 'profile');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const captures = [], errors = [];
let app, appProcess, page, host;
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const shot = async name => {
  await delay(300);
  const file = path.join(evidence, `${name}.png`);
  await page.screenshot({ path: file }); captures.push(file);
};
const overflow = async () => {
  const bad = await page.evaluate(() => {
    const selectors = ['html', 'body', '.app-shell', '.pc', '.pc-thread', '.pc-column', '.pc-composer', '.pc-field', '.pc-controls', '.pc-bar'];
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length && el.clientWidth && el.scrollWidth > el.clientWidth).map(el => `${selector}: ${el.scrollWidth} > ${el.clientWidth}`));
  });
  assert.deepEqual(bad, [], 'No horizontal overflow in shell or conversation');
};
// Visibility alone misses a translucent island intercepting a real action.
// Sample the interior, not only the centre Playwright chooses for a click.
const unobscured = async (locator, label) => {
  await locator.waitFor({ state: 'visible' });
  const misses = await locator.evaluate(el => {
    const r = el.getBoundingClientRect(), misses = [];
    for (const fx of [.15, .5, .85]) for (const fy of [.15, .5, .85]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) misses.push({ x, y, hit: hit?.className?.baseVal ?? hit?.className ?? null });
    }
    return misses;
  });
  assert.deepEqual(misses, [], `${label}: full hit target is exposed`);
};
const chromeClear = async () => {
  const overlaps = await page.evaluate(() => {
    const stage = document.querySelector('.canvas-stage').getBoundingClientRect();
    const chrome = [...document.querySelectorAll('.canvas-navigation,.canvas-minimap,.create-dock')].filter(el => el.getClientRects().length);
    const rects = chrome.map(el => ({ name: el.className, floats: el.matches('.canvas-minimap'), r: el.getBoundingClientRect() }));
    const intersects = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    // The minimap floats over the stage's corner (etapa 6·3); it still stays clear of the shelf islands.
    return rects.flatMap(({ name, floats, r }, i) => [
      ...(!floats && intersects(r, stage) ? [`${name} overlaps working stage`] : []),
      ...rects.slice(i + 1).filter(other => intersects(r, other.r)).map(other => `${name} overlaps ${other.name}`),
    ]);
  });
  assert.deepEqual(overlaps, [], 'Chrome islands have separate space');
  for (const control of await page.locator('.canvas-navigation button,.create-dock button').all()) await unobscured(control, 'Chrome control');
};
try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
  appProcess = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  const project = path.join(temp, 'SYNTHETIC-espectral'); await mkdir(project);
  const workspace = await invoke('workspace.open', { path: project });
  const node = await invoke('node.create', { workspaceId: workspace.id, type: 'terminal', title: 'SYNTHETIC · Conversación espectral', x: 0, y: 0, width: 680, height: 560, data: { chat: { provider: 'claude' } } });
  await invoke('node.update', { workspaceId: workspace.id, id: node.id, patch: { x: 0, y: 0, width: 680, height: 560 } });
  await invoke('workspace.update', { id: workspace.id, patch: { camera: { x: 310, y: 100, zoom: 1 } } });

  // Electron exposes its registered handlers in the main process. Preserve the
  // actual handler for every non-fixture call; fail explicitly if that test
  // seam changes in a future Electron release. Nothing is patched on disk.
  await app.evaluate(({ ipcMain }, nodeId) => {
    const original = ipcMain._invokeHandlers?.get('phantom:invoke');
    if (!original) throw new Error('Electron IPC fixture seam unavailable');
    globalThis.spectralFixture = { nodeId, chat: null, original, calls: [] };
    ipcMain.removeHandler('phantom:invoke');
    ipcMain.handle('phantom:invoke', (event, method, payload = {}) => {
      const fixture = globalThis.spectralFixture;
      if (payload.nodeId === fixture.nodeId && method === 'chat.get' && fixture.chat) return fixture.chat;
      if (method === 'chat.models') return { items: [], note: 'SYNTHETIC · sin proveedor externo' };
      if (payload.nodeId === fixture.nodeId && ['chat.permission.answer', 'chat.send', 'chat.stop'].includes(method)) {
        fixture.calls.push({ method, payload });
        if (method === 'chat.permission.answer') {
          const part = fixture.chat.messages.flatMap(message => message.parts).find(part => part.id === payload.requestId);
          if (!part || part.status !== 'pending' || payload.decision !== 'allow') throw new Error('Invalid synthetic permission response');
          part.status = 'allowed';
        } else if (method === 'chat.send') {
          if (!payload.text?.trim()) throw new Error('Empty synthetic send');
          fixture.chat.messages.push({ id: `sent-${fixture.calls.length}`, role: 'user', status: 'done', createdAt: new Date().toISOString(), parts: [{ type: 'text', text: payload.text }] });
          fixture.chat.running = true;
        } else fixture.chat.running = false;
        event.sender.send('phantom:event', { type: 'chat.update', reset: true, workspaceId: payload.workspaceId, nodeId: fixture.nodeId });
        return fixture.chat;
      }
      if (method.startsWith('chat.') && !['chat.get', 'chat.models'].includes(method)) throw new Error(`Synthetic review cannot execute ${method}`);
      return original(event, method, payload);
    });
  }, node.id);
  const setState = async (state, running = state !== 'rest') => {
    const createdAt = new Date().toISOString();
    const chat = { provider: 'claude', running, queue: [], meta: { model: 'synthetic/review', contextTokens: 4200, contextWindow: 200000 }, messages: [
      { id: 'user', role: 'user', status: 'done', createdAt, parts: [{ type: 'text', text: 'SYNTHETIC · Refina la jerarquía del workspace sin distraer de la conversación.' }] },
      { id: 'reply', role: 'assistant', status: state === 'rest' ? 'done' : 'streaming', createdAt, parts: [
        { type: 'text', text: '## Un espacio para concentrarse\n\nEl contenido conserva su plano opaco. La actividad vive en el perímetro y la selección aclara el mismo aro.\n\n- Cabecera clara\n- Lectura tranquila\n- Compositor accesible por teclado' },
        ...(state === 'attention' ? [{ id: 'permission', type: 'permission', status: 'pending', tool: 'Edit', input: { file_path: 'src/synthetic-example.css' }, reason: 'SYNTHETIC · Confirmar el cambio visual' }] : []),
      ] },
    ] };
    await app.evaluate(({ BrowserWindow }, { chat, workspaceId }) => {
      const fixture = globalThis.spectralFixture; fixture.chat = chat;
      BrowserWindow.getAllWindows()[0].webContents.send('phantom:event', { type: 'chat.update', reset: true, workspaceId, nodeId: fixture.nodeId });
    }, { chat, workspaceId: workspace.id });
  };
  await setState('rest');
  await page.evaluate(id => localStorage.setItem(`phantom.chatSeen.${id}`, 'reply'), node.id);
  await page.reload();
  const card = page.locator(`[data-node-id="${node.id}"]`);
  await card.locator('.pc-message.is-agent').waitFor();
  const zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  assert.ok(Number.isFinite(zoom) && zoom > 0, 'Native interface zoom is valid');
  const exerciseActions = async (state, label, keyboard = false) => {
    const input = card.getByRole('textbox', { name: 'Mensaje para Claude' });
    const method = state === 'attention' ? 'chat.permission.answer' : state === 'working' ? 'chat.stop' : 'chat.send';
    const button = state === 'attention' ? card.getByRole('button', { name: 'Aprobar', exact: true }) : card.getByRole('button', { name: state === 'working' ? 'Detener respuesta' : 'Enviar mensaje', exact: true });
    if (state === 'rest') await input.fill(`SYNTHETIC · ${label}`);
    await unobscured(button, `${label} ${method}`);
    assert.equal(await button.isEnabled(), true, `${label}: action enabled`);
    const count = await app.evaluate(() => globalThis.spectralFixture.calls.length);
    if (keyboard) { await button.focus(); await page.keyboard.press('Enter'); }
    else await button.click();
    if (state === 'attention') await card.locator('.pc-ask-state').filter({ hasText: 'Aprobado' }).waitFor();
    else if (state === 'working') await card.getByRole('button', { name: 'Enviar mensaje', exact: true }).waitFor();
    else await card.getByRole('button', { name: 'Detener respuesta' }).waitFor();
    const calls = await app.evaluate(() => globalThis.spectralFixture.calls);
    assert.equal(calls.length, count + 1, `${label}: exactly one action reaches IPC`);
    assert.equal(calls.at(-1).method, method);
    assert.equal(calls.at(-1).payload.nodeId, node.id);
    if (state === 'attention') {
      assert.equal(calls.at(-1).payload.decision, 'allow');
      assert.equal(calls.at(-1).payload.requestId, 'permission');
      assert.equal(await card.getByRole('button', { name: 'Aprobar', exact: true }).count(), 0);
    }
    if (state === 'rest') assert.equal(calls.at(-1).payload.text, `SYNTHETIC · ${label}`);
  };
  for (const [size, width, height] of [['wide', 1520, 980], ['narrow', 1100, 760]]) {
    await app.evaluate(({ BrowserWindow }, { width, height }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(580, 500); win.setContentSize(width, height); }, { width, height });
    // Chromium quantizes native size / zoom to either adjacent CSS integer.
    await page.waitForFunction(({ width, height, zoom }) => [innerWidth, innerHeight].every((size, i) => {
      const cssSize = [width, height][i] / zoom;
      return size === Math.floor(cssSize) || size === Math.ceil(cssSize);
    }), { width, height, zoom });
    for (const mode of ['map', 'selected', 'focus']) {
    await page.locator('.canvas').focus(); await page.keyboard.press('Escape');
    if (mode !== 'map') await card.locator('.node-glyph').click();
    const mapTransform = await page.locator('.canvas-world').evaluate(el => el.style.transform);
    if (mode === 'focus') {
      await page.locator('.canvas').focus(); await page.keyboard.press('Control+Shift+Enter');
      await page.locator('.canvas-node.focused').waitFor();
    }
    for (const state of ['rest', 'working', 'attention']) {
      if (mode === 'map') { await page.locator('.canvas').focus(); await page.keyboard.press('Escape'); }
      await setState(state);
      await page.waitForFunction(({ id, state }) => {
        const node = document.querySelector(`[data-node-id="${id}"]`);
        return node && (state === 'rest' ? !/pulse-/.test(node.className) : node.classList.contains(`pulse-${state}`));
      }, { id: node.id, state });
      await delay(300);
      assert.equal(await page.locator('.pixel-field').count(), 0, 'No exterior waves or panel halos');
      assert.equal(await card.locator('.panel-state').innerText(), state === 'rest' ? 'Terminó' : state === 'working' ? 'Trabajando' : 'Te necesita');
      const ring = await card.evaluate(el => ({ image: getComputedStyle(el, '::before').backgroundImage, mask: getComputedStyle(el, '::before').maskComposite, outline: getComputedStyle(el).outlineWidth }));
      assert.deepEqual(ring.mask.split(',').map(value => value.trim()), ['exclude', 'exclude']); assert.equal(ring.outline, '0px');
      assert.equal(ring.image === 'none', state === 'attention');
      assert.equal(await card.evaluate(el => el.classList.contains('focused')), mode === 'focus');
      assert.equal(await card.evaluate(el => el.classList.contains('selected')), mode !== 'map');
      if (mode !== 'focus') assert.deepEqual(await card.evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height]), ['0px', '0px', '680px', '560px'], 'Map panel geometry is unchanged');
      await overflow();
      await chromeClear();
      await unobscured(card.getByRole('button', { name: state === 'rest' ? 'Enviar mensaje' : 'Detener respuesta', exact: true }), `${size}-${mode}-${state} composer`);
      if (state === 'attention') await unobscured(card.getByRole('button', { name: 'Aprobar', exact: true }), `${size}-${mode} permission`);
      await shot(`${size}-${mode}-${state}`);
      if (state === 'working') {
        const trace = await card.evaluate(async el => {
          const head = el.querySelector('.activity-trace__head');
          const animation = head?.getAnimations().find(a => a.animationName === 'trace-orbit');
          if (!animation) return null;
          animation.pause();
          const sample = async time => {
            animation.currentTime = time;
            await new Promise(requestAnimationFrame);
            return parseFloat(getComputedStyle(head).strokeDashoffset);
          };
          const start = await sample(0), quarter = await sample(1400);
          animation.play();
          return { start, quarter, duration: animation.effect.getTiming().duration, easing: getComputedStyle(head).animationTimingFunction,
            dash: getComputedStyle(head).strokeDasharray, width: getComputedStyle(head).strokeWidth,
            tails: el.querySelector('.activity-trace__tail').getAttribute('pathLength'), pointer: getComputedStyle(head).pointerEvents };
        });
        assert.ok(trace, 'Working mounts the perimeter trace');
        assert.equal(trace.start, 2.5); assert.equal(trace.quarter, -22.5, 'Clockwise quarter turn');
        assert.equal(trace.duration, 5600); assert.equal(trace.easing, 'linear');
        assert.deepEqual(trace.dash.match(/[\d.]+/g).map(Number), [2.5, 97.5]); assert.equal(trace.width, '1.5px');
        assert.equal(trace.tails, '100'); assert.equal(trace.pointer, 'none');
        assert.equal(await card.locator('.pc-column').evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.effect?.getComputedTiming().iterations === Infinity).length), 0, 'Thread remains still');
      }
      if (state === 'rest') assert.equal(await card.locator('.activity-trace').count(), 0, 'Rest has no activity layer');
      if (state === 'attention') assert.equal(await card.locator('.pc').getAttribute('data-agent'), 'approval');
      await exerciseActions(state, `${size}-${mode}-${state}`, mode === 'focus');
      if (mode !== 'focus') {
        // The map remains usable, including its pointer route and toggle.
        await unobscured(page.locator('.canvas-minimap'), 'Minimap');
        await page.locator('.canvas-minimap').click({ position: { x: 94, y: 62 } });
        await page.getByRole('button', { name: 'Mostrar minimapa' }).click();
        assert.equal(await page.locator('.canvas-minimap').count(), 0);
        await setState(state);
        await page.waitForFunction(({ id, state }) => {
          const panel = document.querySelector(`[data-node-id="${id}"]`);
          return state === 'rest' ? !/pulse-/.test(panel.className) : panel.classList.contains(`pulse-${state}`);
        }, { id: node.id, state });
        await exerciseActions(state, `${size}-${mode}-${state}-minimap-off`);
        await page.getByRole('button', { name: 'Mostrar minimapa' }).click();
        await page.locator('.canvas-minimap').waitFor();
        await chromeClear();
      }
    }
    await page.locator('.canvas').focus(); await page.keyboard.press('Escape');
    await page.locator('.canvas-node:not(.focused)').waitFor();
    if (mode === 'focus') {
      await delay(550);
      assert.equal(await page.locator('.canvas-world').evaluate(el => el.style.transform), mapTransform, 'Focus round trip preserves map camera');
      assert.deepEqual(await card.evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height]), ['0px', '0px', '680px', '560px']);
    }
    }
  }
  await setState('working');
  await page.waitForFunction(id => document.querySelector(`[data-node-id="${id}"]`)?.classList.contains('pulse-working'), node.id);
  await card.locator('.node-glyph').click();
  await page.waitForFunction(id => document.querySelector(`[data-node-id="${id}"]`)?.classList.contains('selected'), node.id);
   const selection = await card.evaluate(el => ({ width: getComputedStyle(el).outlineWidth, animation: getComputedStyle(el.querySelector('.activity-trace__head')).animationName }));
   assert.equal(selection.width, '0px', 'Selection brightens the single ring');
  assert.equal(selection.animation, 'trace-orbit');
  const pauses = await card.evaluate(async el => {
    const trace = el.querySelector('.activity-trace'), head = trace.querySelector('.activity-trace__head');
    const shell = el.closest('.app-shell');
    const frame = () => new Promise(requestAnimationFrame);
    const sample = () => ({ state: getComputedStyle(head).animationPlayState, offset: getComputedStyle(head).strokeDashoffset });
    const check = async () => {
      const before = sample();
      await new Promise(resolve => setTimeout(resolve, 160));
      return { before, after: sample() };
    };
    let concentration, hidden;
    try {
      shell.classList.add('studio-concentration'); await frame();
      concentration = await check();
      shell.classList.remove('studio-concentration');
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange')); await frame();
      hidden = await check();
    } finally {
      shell.classList.remove('studio-concentration');
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    }
    return { concentration, hidden };
  });
  for (const [reason, samples] of Object.entries(pauses)) {
    assert.equal(samples.before.state, 'paused', `${reason} pauses the timeline`);
    assert.deepEqual(samples.before, samples.after, `${reason} holds the exact perimeter position`);
  }
  const previousTransform = await card.evaluate(el => { const previous = el.style.transform; el.style.transform = 'translateX(-100000px)'; return previous; });
  try {
    await page.waitForFunction(id => document.querySelector(`[data-node-id="${id}"] .activity-trace`)?.dataset.visible === 'false', node.id);
    assert.equal(await card.locator('.activity-trace__head').evaluate(el => getComputedStyle(el).animationPlayState), 'paused', 'Offscreen panels pause');
  } finally { await card.evaluate((el, previous) => { el.style.transform = previous; }, previousTransform); }
  await page.waitForFunction(id => document.querySelector(`[data-node-id="${id}"] .activity-trace`)?.dataset.visible === 'true', node.id);
  assert.equal(await card.locator('.activity-trace__head').evaluate(el => getComputedStyle(el).animationPlayState), 'running', 'Visible panels resume');
  await shot('selected-working');
  await card.locator('.node-glyph').dblclick();
  await page.locator('.canvas-node.focused').waitFor();
  const input = card.getByRole('textbox', { name: 'Mensaje para Claude' });
  await input.focus(); await input.fill('Borrador sintético — sin enviar');
  await page.keyboard.press('Tab');
  assert.equal(await card.evaluate(el => el.contains(document.activeElement)), true, 'Tab stays in the card controls');
  await overflow(); await shot('focused-working-keyboard');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const state of ['working', 'attention']) {
    await setState(state);
    await page.waitForFunction(({ id, state }) => {
      const panel = document.querySelector(`.canvas-node[data-node-id="${id}"]`);
      if (panel?.dataset.panelState !== state) return false;
      const head = panel.querySelector('.activity-trace__head');
      return state === 'working' ? head && getComputedStyle(head).animationName === 'none' : !head;
    }, { id: node.id, state });
    const unstable = await card.evaluate((el, state) => new Promise(resolve => {
      const start = performance.now(), failures = [];
      const head = el.querySelector('.activity-trace__head');
      const offset = head && getComputedStyle(head).strokeDashoffset;
      const sample = now => {
        if (el.dataset.panelState !== state || (head && (getComputedStyle(head).animationName !== 'none' || getComputedStyle(head).strokeDashoffset !== offset))) failures.push(el.dataset.panelState);
        if (now - start >= 350) resolve(failures);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }), state);
    assert.deepEqual(unstable, [], 'Reduced motion keeps the expected state steady on every frame');
    await overflow(); await shot(`reduced-motion-${state}`);
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-reduced-transparency', value: 'reduce' }] });
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches), true);
  assert.equal(await page.locator('.project-rail').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
  assert.equal(await page.locator('.canvas-region').evaluate(el => getComputedStyle(el, '::before').display), 'none');
  await shot('reduced-transparency');
  await cdp.detach();
  // Pending permissions must remain visible even if the transport reports a
  // non-running turn. This tests state precedence, not a painted CSS class.
  await setState('attention', false);
  await card.locator('.pt-state.is-approval').waitFor();
  assert.equal(await card.locator('.pc').getAttribute('data-agent'), 'approval');
  assert.equal(await card.locator('.pc-working').count(), 0);
  await page.evaluate(id => localStorage.setItem(`phantom:studio:${id}`, JSON.stringify({ background: 'plain', accent: 'iris', grid: false, intensity: 23, image: '' })), workspace.id);
  await page.reload(); await card.locator('.pc').waitFor();
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#a78bda', 'Unversioned iris project accent migrates to lilac');
  assert.equal(await page.locator('.app-shell.studio-plain.studio-no-grid').count(), 1, 'Unversioned appearance preserves plain background and disabled grid');
  await page.evaluate(id => localStorage.setItem(`phantom:studio:${id}`, JSON.stringify({ background: 'plain', accent: 'iris', grid: false, intensity: 23, image: '', v: 3 })), workspace.id);
  await page.reload(); await card.locator('.pc').waitFor();
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#8fa2ff', 'Version 3 project appearance preserves iris accent');
  assert.equal(await page.locator('.app-shell.studio-plain.studio-no-grid').count(), 1, 'Version 3 appearance preserves plain background and disabled grid');
  assert.deepEqual(errors, [], 'No renderer errors');
  console.log(JSON.stringify({ captures, errors, fixtures: 'SYNTHETIC chat and action responses, isolated Electron/host', checks: ['wide/narrow map/selection/focus states', 'nine-point action hit-testing', 'chrome clearance', 'permission/send/stop IPC and UI response', 'minimap pointer/toggle', 'overflow', 'edge motion', 'quiet thread', 'selection', 'keyboard', 'reduced motion/transparency'] }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  console.error(JSON.stringify({ error: error.stack, captures, errors })); process.exitCode = 1;
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
    await rm(temp, { recursive: true, force: true });
  }
}
