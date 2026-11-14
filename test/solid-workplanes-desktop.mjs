import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Controller-owned execution. Built renderer, isolated real host and PTYs;
// only conversation responses are synthetic, with no provider invocation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const evidence = await mkdtemp('/tmp/opencode/solid-workplanes-');
const temp = await mkdtemp('/tmp/phantom-solid-');
const profile = path.join(temp, 'profile');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const captures = [], errors = [];
let app, child, page, host;
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const shot = async name => {
  const file = path.join(evidence, `${name}.png`);
  await page.screenshot({ path: file }); captures.push(file);
};
const exposed = async locator => {
  await locator.waitFor({ state: 'visible' });
  assert.equal(await locator.isEnabled(), true);
  assert.deepEqual(await locator.evaluate(el => {
    const r = el.getBoundingClientRect(), misses = [];
    for (const x of [.15, .5, .85]) for (const y of [.15, .5, .85]) {
      if (!el.contains(document.elementFromPoint(r.x + r.width * x, r.y + r.height * y))) misses.push([x, y]);
    }
    return misses;
  }), [], 'Control has an unobscured hit target');
};
const materials = async () => {
  const result = await page.evaluate(() => {
    const bad = [], reading = [];
    if (document.querySelector('.app-shell.studio-focused')) {
      const region = document.querySelector('.canvas-region').getBoundingClientRect();
      const panel = document.querySelector('.canvas-node.focused').getBoundingClientRect();
      if (region.left < 0 || region.right > innerWidth || region.top < 0 || region.bottom > innerHeight) bad.push('focused region outside viewport');
      if (panel.left < region.left || panel.right > region.right || panel.top < region.top || panel.bottom > region.bottom) bad.push('focused workplane outside region');
    }
    const alpha = color => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3];
    };
    for (const panel of document.querySelectorAll('.canvas-node[data-type="terminal"]')) {
      const s = getComputedStyle(panel);
      if (alpha(s.backgroundColor) !== 255) bad.push('translucent panel');
      const token = panel.matches('.selected,.focused,.is-dragging') ? '--shadow-workplane-lift' : '--shadow-workplane-rest';
      const probe = document.createElement('div'); panel.append(probe);
      probe.style.boxShadow = `var(${token})`;
      if (s.boxShadow !== getComputedStyle(probe).boxShadow) bad.push(`incorrect elevation ${panel.dataset.nodeId}`);
      probe.remove();
      for (const el of [panel, ...panel.querySelectorAll('.node-body,.pc,.pc-thread,.pt-output,.terminal-wrap')]) {
        const style = getComputedStyle(el);
        if (style.backdropFilter !== 'none') bad.push(`blur ${el.className}`);
      }
      const text = panel.querySelector('.pc-message.is-agent,.pt-output,.terminal-wrap') || panel.querySelector('.node-body');
      const chain = [];
      for (let el = text; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        chain.push([style.filter, style.opacity]);
        if (style.filter !== 'none' || style.opacity !== '1') bad.push(`attenuated reading ${el.className}`);
      }
      reading.push({ id: panel.dataset.nodeId, color: getComputedStyle(text).color, chain });
    }
    const canvas = document.querySelector('.canvas');
    if (alpha(getComputedStyle(canvas).backgroundColor) !== 0) bad.push('canvas hides environmental art');
    const art = getComputedStyle(document.querySelector('.canvas-region'), '::after');
    if (art.backgroundImage === 'none' || Number(art.opacity) <= 0 || Number(getComputedStyle(canvas).zIndex) <= Number(art.zIndex)) bad.push('art missing or above workplanes');
    for (const el of document.querySelectorAll('.project-rail,.canvas-navigation,.activity-dock')) {
      const s = getComputedStyle(el);
      if (!s.backdropFilter.includes('blur(') || alpha(s.backgroundColor) === 255) bad.push(`chrome lost glass ${el.className}`);
    }
    return { bad, reading };
  });
  assert.deepEqual(result.bad, []);
  return result.reading;
};
try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env, timeout: 10000 });
  child = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  const project = path.join(temp, 'SYNTHETIC-solid'); await mkdir(project);
  const workspace = await invoke('workspace.open', { path: project });
  const nodes = [], sessions = [];
  for (let i = 0; i < 4; i++) {
    const geometry = { x: (i % 2) * 560, y: Math.floor(i / 2) * 440, width: 540, height: 420 };
    const node = await invoke('node.create', { workspaceId: workspace.id, type: 'terminal', title: `SYNTHETIC · ${i < 2 ? 'Conversación' : 'Terminal'} ${i + 1}`, ...geometry, data: i < 2 ? { chat: { provider: 'claude' } } : {} });
    await invoke('node.update', { workspaceId: workspace.id, id: node.id, patch: geometry }); nodes.push(node);
    if (i >= 2) {
      const { session } = await invoke('terminal.create', { workspaceId: workspace.id, nodeId: node.id, cols: 80, rows: 24 });
      sessions.push(session);
      await invoke('node.update', { workspaceId: workspace.id, id: node.id, patch: { data: { sessionId: session.id } } });
    }
  }
  await app.evaluate(({ ipcMain }, ids) => {
    const original = ipcMain._invokeHandlers?.get('phantom:invoke');
    if (!original) throw new Error('Electron IPC fixture seam unavailable');
    const chats = Object.fromEntries(ids.map(id => [id, { provider: 'claude', running: false, queue: [], meta: {}, messages: [
      { id: 'question', role: 'user', status: 'done', parts: [{ type: 'text', text: 'SYNTHETIC · Revisa la legibilidad del plano de trabajo.' }] },
      { id: 'reply', role: 'assistant', status: 'done', parts: [{ type: 'text', text: '## Lectura estable\n\nConversaciones opacas, texto ciruela claro y controles accesibles. Seleccionar un vecino conserva esta lectura.' }] },
    ] }]));
    globalThis.solidFixture = { calls: [] };
    ipcMain.removeHandler('phantom:invoke');
    ipcMain.handle('phantom:invoke', (event, method, payload = {}) => {
      if (method === 'chat.models') return { items: [], note: 'SYNTHETIC' };
      const chat = chats[payload.nodeId];
      if (chat && method === 'chat.get') return chat;
      if (chat && ['chat.send', 'chat.stop'].includes(method)) {
        globalThis.solidFixture.calls.push({ method, payload });
        chat.running = method === 'chat.send';
        event.sender.send('phantom:event', { type: 'chat.update', reset: true, workspaceId: payload.workspaceId, nodeId: payload.nodeId });
        return chat;
      }
      if (method.startsWith('chat.') && method !== 'chat.get') throw new Error(`Unexpected provider call: ${method}`);
      return original(event, method, payload);
    });
  }, nodes.slice(0, 2).map(node => node.id));
  await page.evaluate(ids => ids.forEach(id => localStorage.setItem(`phantom.chatSeen.${id}`, 'reply')), nodes.slice(0, 2).map(node => node.id));
  await page.reload();
  await page.locator('.pc-message.is-agent').first().waitFor();
  const card = i => page.locator(`.canvas-node[data-node-id="${nodes[i].id}"]`);
  const map = async () => {
    const settled = () => page.evaluate(async () => {
      const start = performance.now();
      let previous, stableSince = start;
      while (performance.now() - start < 4000) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const region = document.querySelector('.canvas-region');
        const stage = document.querySelector('.canvas-stage');
        const world = document.querySelector('.canvas-world');
        const focused = document.querySelector('.studio-focused,.canvas.focus-mode,.canvas-node.focused');
        const geometry = [region, stage].map(el => {
          const r = el.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        });
        const snapshot = JSON.stringify([geometry, getComputedStyle(world).transform]);
        const now = performance.now();
        if (focused || snapshot !== previous) stableSince = now;
        previous = snapshot;
        // Allow the stage ResizeObserver and its 260ms reframe debounce to
        // commit before fitting; also wait out the resulting camera motion.
        if (!focused && now - stableSince >= 320) return;
      }
      throw new Error('Map geometry/camera did not settle after leaving focus or fitting');
    });
    await page.locator('.canvas').focus();
    await page.keyboard.press('Escape');
    await settled();
    await page.keyboard.press('0');
    await settled();
  };
  for (const [width, height] of [[1520, 980], [1100, 760]]) {
    await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(580, 500); win.setContentSize(...size); }, [width, height]);
    await page.waitForFunction(size => innerWidth === size[0] && innerHeight === size[1], [width, height]);
    await map();
    assert.equal(await page.locator('.canvas-node').count(), 4);
    const before = await materials(); await shot(`${width}-map-rest`);
    await card(1).locator('.node-glyph').click(); await delay(300);
    assert.equal(await card(1).evaluate(el => el.classList.contains('selected')), true);
    assert.deepEqual(await materials(), before, 'Selecting a neighbour leaves text color and ancestor compositing stable');
    await shot(`${width}-selected`);
    await card(0).locator('.node-glyph').click();
    await page.locator('.canvas').focus(); await page.keyboard.press('Control+Shift+Enter');
    await card(0).and(page.locator('.focused')).waitFor(); await delay(350);
    await materials();
    const input = card(0).getByRole('textbox', { name: 'Mensaje para Claude' });
    await input.fill('SYNTHETIC · control usable');
    const send = card(0).getByRole('button', { name: 'Enviar mensaje', exact: true });
    await exposed(send); await send.click();
    const stop = card(0).getByRole('button', { name: 'Detener respuesta', exact: true });
    await exposed(stop); await stop.focus(); await page.keyboard.press('Enter');
    await send.waitFor(); await shot(`${width}-focus-chat`);
    await map(); await card(2).locator('.node-glyph').click();
    await page.locator('.canvas').focus(); await page.keyboard.press('Control+Shift+Enter');
    await card(2).and(page.locator('.focused')).waitFor(); await delay(350);
    const terminal = card(2).locator('.xterm-helper-textarea');
    await terminal.focus(); await page.keyboard.type(`echo SOLID_${width}`); await page.keyboard.press('Enter');
    await page.waitForFunction(async ({ sessionId, marker }) => (await window.phantom.invoke('terminal.attach', { sessionId })).data.includes(marker), { sessionId: sessions[0].id, marker: `SOLID_${width}` });
    await materials(); await shot(`${width}-focus-terminal`);
  }
  const calls = await app.evaluate(() => globalThis.solidFixture.calls);
  assert.deepEqual(calls.map(call => call.method), ['chat.send', 'chat.stop', 'chat.send', 'chat.stop']);
  assert.deepEqual(errors, [], 'No renderer errors');
  console.log(JSON.stringify({ captures, errors, fixture: 'Two synthetic conversations and two isolated real terminals', checks: ['opacity and no backdrop blur', 'stable neighbour reading', 'local matte elevations', 'environmental art below transparent canvas', 'chrome glass', 'send/stop pointer and keyboard', 'real PTY input', 'two sizes, map/selection/chat focus/terminal focus'] }, null, 2));
} catch (error) {
  const failure = path.join(evidence, 'failure.png');
  await page?.screenshot({ path: failure }).then(() => captures.push(failure)).catch(() => {});
  console.error(JSON.stringify({ error: error.stack, captures, errors })); process.exitCode = 1;
} finally {
  try {
    if (host && (await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '')).includes(profile)) {
      await Promise.race([invoke('host.shutdown').catch(() => {}), delay(1000)]);
      try { process.kill(host, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  } finally {
    if (app) await Promise.race([app.close().catch(() => {}), delay(1000)]);
    if (child?.exitCode === null && child?.signalCode === null) child.kill('SIGKILL');
    await rm(temp, { recursive: true, force: true });
  }
}
