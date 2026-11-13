import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Production Electron/renderer and isolated host. Audio is a WebAudio oscillator
// recorded by Chromium's REAL MediaRecorder. ASR, chats and terminal transport
// are explicitly synthetic IPC fixtures: no microphone, model or shell runs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const evidence = await mkdtemp('/tmp/opencode/voice-desktop-');
const profile = path.join(evidence, 'profile');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
const transcript = 'SYNTHETIC · dictado de prueba';
const errors = [], captures = [], checks = [];
let app, appProcess, page, host;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const fixture = fn => app.evaluate(fn);
const dialog = () => page.getByRole('dialog', { name: 'Dictado por voz', exact: true });
const calls = () => fixture(() => globalThis.voiceFixture.calls);
const release = () => fixture(() => { for (const resolve of globalThis.voiceFixture.pending.splice(0)) resolve(); });
const countVoice = () => fixture(() => globalThis.voiceFixture.calls.filter(call => call.method === 'voice.transcribe').length);
async function waitVoice(count) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await countVoice() >= count) return; await delay(30); }
  throw new Error(`Transcription request ${count} not observed`);
}
async function check(name, fn) { await fn(); checks.push(name); }
async function capture(name) {
  const file = path.join(evidence, `${name}.png`); await page.screenshot({ path: file }); captures.push(file);
}
async function size(width, height) {
  await app.evaluate(({ BrowserWindow }, [width, height]) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(580, 500); win.setContentSize(width, height); }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
}
async function captureBoth(name, surface) {
  for (const [label, width, height] of [['wide', 1520, 980], ['narrow', 1100, 760]]) {
    await size(width, height); await delay(300);
    const overflow = await surface.locator('.voice-activity').evaluate(el => el.scrollWidth > el.clientWidth);
    assert.equal(overflow, false, `${name}: activity fits ${label}`);
    for (const button of await surface.getByRole('button', { name: /^(Detener y transcribir|Cancelar audio)$/ }).all()) {
      const exposure = await button.evaluate(el => {
        const rect = element => {
          const r = element.getBoundingClientRect(), css = getComputedStyle(element);
          return { tag: element.tagName, class: element.className, x: r.x, y: r.y, width: r.width, height: r.height, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, overflow: css.overflow, pointerEvents: css.pointerEvents };
        };
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const ancestors = [];
        for (let parent = el.parentElement; parent; parent = parent.parentElement) ancestors.push(rect(parent));
        return { exposed: el.contains(hit), button: el.getAttribute('aria-label') || el.textContent, bounds: rect(el), hit: hit ? rect(hit) : null, ancestors };
      });
      assert.equal(exposure.exposed, true, `${name}: ${label} capture controls are exposed: ${JSON.stringify(exposure)}`);
    }
    await capture(`${label}-${name}`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await surface.locator('.voice-waves i').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s', `${name}: reduced-motion removes spatial transitions`);
  await capture(`narrow-${name}-reduced`);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await size(1520, 980);
}
async function focusNode(title, id) {
  // Presence retains the previous project's canvas during its inert exit.
  // Wait for the requested panel in the accessible, current canvas first.
  const canvas = page.getByRole('region', { name: 'Lienzo espacial del proyecto', exact: true });
  await canvas.locator(`[data-node-id="${id}"]`).waitFor({ state: 'attached' });
  await canvas.focus();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill(title);
  await page.locator('.tw-palette-results button').filter({ hasText: title }).click();
  await canvas.locator(`[data-node-id="${id}"].focused`).waitFor();
}
async function recording(surface, button) {
  await button.click(); await surface.locator('.voice-activity[data-state="recording"]').waitFor();
  await page.waitForFunction(() => window.voiceAudio.tracks.some(track => track.readyState === 'live'));
  // Let Chromium emit nonempty encoded audio even on slow CI machines.
  await delay(220);
}
async function transcribe(surface) {
  const count = await countVoice();
  await surface.getByRole('button', { name: 'Detener y transcribir', exact: true }).click();
  await waitVoice(count + 1);
  await surface.locator('.voice-activity[data-state="transcribing"]').waitFor();
  assert.equal(await page.evaluate(() => window.voiceAudio.tracks.filter(track => track.readyState === 'live').length), 0, 'Tracks end before ASR resolves');
  await release();
  await surface.locator('.voice-activity').waitFor({ state: 'hidden' });
}

try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless', '--autoplay-policy=no-user-gesture-required'], cwd: root, env });
  appProcess = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor(); host = (await invoke('system.info')).pid;
  const folderA = path.join(evidence, 'SYNTHETIC-proyecto-A'), folderB = path.join(evidence, 'SYNTHETIC-proyecto-B');
  await mkdir(folderA); await mkdir(folderB);
  const workspaceB = await invoke('workspace.open', { path: folderB });
  const workspace = await invoke('workspace.open', { path: folderA });
  const create = (type, title, data = {}) => invoke('node.create', { workspaceId: workspace.id, type, title, x: 0, y: 0, width: 680, height: 560, data });
  const noteA = await create('note', 'SYNTHETIC Nota A', { text: 'Antes después' });
  const noteB = await create('note', 'SYNTHETIC Nota B', { text: 'Otro borrador' });
  const card = await create('terminal', 'SYNTHETIC ChatCard', { chat: { provider: 'claude' } });
  const orchestrator = await create('terminal', 'SYNTHETIC Orquestador', { chat: { provider: 'claude' } });
  const terminal = await create('terminal', 'SYNTHETIC Terminal');

  await app.evaluate(({ ipcMain }, { terminalId, orchestratorId, workspaceId, transcript }) => {
    const original = ipcMain._invokeHandlers?.get('phantom:invoke');
    if (!original) throw new Error('Electron IPC test seam unavailable');
    globalThis.voiceFixture = { original, terminalId, orchestratorId, workspaceId, transcript, sessionId: 'synthetic-voice-session', terminalStatus: 'running', calls: [], pending: [], fail: false };
    ipcMain.removeHandler('phantom:invoke');
    ipcMain.handle('phantom:invoke', async (event, method, payload = {}) => {
      const f = globalThis.voiceFixture;
      if (method === 'voice.transcribe') {
        f.calls.push({ method, payload });
        const fail = f.fail; await new Promise(resolve => f.pending.push(resolve));
        if (fail) throw new Error('SYNTHETIC · proveedor de voz no disponible');
        return { text: f.transcript, provider: 'synthetic-fixture-no-ASR' };
      }
      if (method === 'voice.intent') return { action: 'task', title: 'SYNTHETIC borrador', text: payload.text };
      if (method === 'chat.get') return { provider: 'claude', running: false, messages: [], queue: [], meta: {} };
      if (method === 'chat.models') return { items: [], note: 'SYNTHETIC · sin modelo' };
      // Provider selection is a host-owned mutation, not a node.update patch.
      // Keep it real while chat execution and model discovery stay synthetic.
      if (method === 'chat.configure') { f.calls.push({ method, payload }); return original(event, method, payload); }
      if (method.startsWith('chat.')) { f.calls.push({ method, payload }); return {}; }
      if (method === 'state.get') {
        const state = await original(event, method, payload);
        const node = state.workspaces.find(w => w.id === f.workspaceId)?.nodes.find(n => n.id === f.terminalId);
        if (node) node.data = { ...node.data, sessionId: f.sessionId, chat: null };
        // Renderer-only role fixture: creating a real orchestrator requires an
        // enabled integration and can start work. This test only exercises its
        // voice composer, so the isolated host stores an ordinary chat card.
        const orchestrator = state.workspaces.find(w => w.id === f.workspaceId)?.nodes.find(n => n.id === f.orchestratorId);
        if (orchestrator) orchestrator.data = { ...orchestrator.data, role: 'orchestrator' };
        return state;
      }
      if (payload.sessionId?.startsWith('synthetic-voice')) {
        if (method === 'terminal.attach') return { session: { id: payload.sessionId, status: f.terminalStatus, cols: 80, rows: 24 }, data: 'SYNTHETIC · transporte de terminal, sin shell\r\n$ ', seq: 0 };
        if (method === 'terminal.tail') return { text: '$ ', lines: ['$ '], status: f.terminalStatus, foreground: { kind: 'shell' } };
        if (method === 'terminal.write') { f.calls.push({ method, payload }); return {}; }
        if (method === 'terminal.resize') return {};
      }
      if (method === 'terminal.create') throw new Error('Voice fixture must never launch a shell');
      return original(event, method, payload);
    });
  }, { terminalId: terminal.id, orchestratorId: orchestrator.id, workspaceId: workspace.id, transcript });

  await page.addInitScript(() => {
    const f = window.voiceAudio = { requests: 0, stops: 0, tracks: [], amplitude: .3, defer: false, denied: false, grants: [], gains: [] };
    const acquire = async () => {
      f.requests++;
      if (f.denied) throw new DOMException('SYNTHETIC permission denied', 'NotAllowedError');
      if (f.defer) await new Promise(resolve => f.grants.push(resolve));
      const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 220; gain.gain.value = f.amplitude;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume(); f.gains.push(gain);
      const stream = destination.stream;
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { if (track.readyState === 'ended') return; f.stops++; stop(); oscillator.stop(); context.close(); };
        f.tracks.push(track);
      }
      return stream;
    };
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: acquire, configurable: true });
  });
  await page.reload(); await page.locator('.app-shell').waitFor(); await size(1520, 980);

  await check('Global: normal typing, fixed selection, real audio level, editable review and explicit insertion', async () => {
    await focusNode(noteA.title, noteA.id);
    await page.getByRole('button', { name: 'Abrir Phantom', exact: true }).click();
    const input = page.getByLabel(`Nota: ${noteA.title}`, { exact: true });
    await input.fill('Antes después'); await input.press('End'); await input.press('m');
    assert.equal(await input.inputValue(), 'Antes despuésm'); assert.equal(await dialog().count(), 0);
    await input.fill('Antes después'); await input.evaluate(el => el.setSelectionRange(6, 6));
    await page.keyboard.press('Control+Shift+m'); await dialog().waitFor();
    assert.match(await dialog().textContent(), /SYNTHETIC Nota A/);
    await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    await page.waitForFunction(() => Number(document.querySelector('.voice-dialog .voice-activity')?.style.getPropertyValue('--voice-level')) > .1);
    const liveTransform = await dialog().locator('.voice-waves i').nth(8).evaluate(el => getComputedStyle(el).transform);
    await captureBoth('global-listening', dialog());
    await page.evaluate(() => window.voiceAudio.gains.forEach(gain => { gain.gain.value = 0; }));
    await page.waitForFunction(() => Number(document.querySelector('.voice-dialog .voice-activity')?.style.getPropertyValue('--voice-level')) < .02);
    await delay(150);
    assert.notEqual(await dialog().locator('.voice-waves i').nth(8).evaluate(el => getComputedStyle(el).transform), liveTransform, 'Wave changes with REAL sample amplitude');
    const count = await countVoice(); await dialog().getByRole('button', { name: 'Detener y transcribir' }).click(); await waitVoice(count + 1);
    await capture('wide-global-transcribing');
    // A different field gains focus while transcription is pending; the target
    // remains the original DOM field and original range, never "last focused".
    await page.getByLabel('Mensaje para Phantom', { exact: true }).evaluate(el => el.focus());
    assert.equal(await page.getByLabel('Mensaje para Phantom', { exact: true }).evaluate(el => el === document.activeElement), true, 'Another real editable field gains focus while ASR is pending');
    await release(); await dialog().locator('.voice-activity').waitFor({ state: 'hidden' });
    assert.equal(await input.inputValue(), 'Antes después');
    await dialog().getByLabel('Transcripción editable').fill('texto revisado ');
    await dialog().getByRole('button', { name: 'Insertar en campo' }).click();
    assert.equal(await input.inputValue(), 'Antes texto revisado después');
    assert.equal(await page.getByLabel(`Nota: ${noteB.title}`, { exact: true }).inputValue(), 'Otro borrador');
    assert.equal(await page.getByLabel('Mensaje para Phantom', { exact: true }).inputValue(), '');
    await page.locator('.phantom-chat').getByRole('button', { name: 'Cerrar Phantom', exact: true }).click();
  });

  await check('Permission races: duplicate start, cancel requesting, release late grant, denial recovery', async () => {
    await page.evaluate(() => { window.voiceAudio.defer = true; });
    await page.getByRole('button', { name: 'Dictado por voz', exact: true }).click();
    const before = await page.evaluate(() => window.voiceAudio.requests);
    await dialog().getByRole('button', { name: 'Grabar dictado' }).evaluate(el => { el.click(); el.click(); });
    await dialog().locator('[data-state="requesting"]').waitFor();
    assert.equal(await page.evaluate(() => window.voiceAudio.requests), before + 1);
    const priorTracks = await page.evaluate(() => window.voiceAudio.tracks.length);
    await dialog().getByRole('button', { name: 'Cancelar audio', exact: true }).click();
    await page.evaluate(() => { window.voiceAudio.defer = false; window.voiceAudio.grants.splice(0).forEach(resolve => resolve()); });
    await page.waitForFunction(prior => window.voiceAudio.tracks.length > prior && window.voiceAudio.tracks.every(track => track.readyState === 'ended'), priorTracks);
    await page.evaluate(() => { window.voiceAudio.denied = true; });
    await dialog().getByRole('button', { name: 'Grabar dictado' }).click();
    await dialog().getByRole('alert').filter({ hasText: 'Habilítalo' }).waitFor();
    await page.evaluate(() => { window.voiceAudio.denied = false; });
    await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    await dialog().getByRole('button', { name: 'Cerrar dictado' }).click();
    await page.waitForFunction(() => window.voiceAudio.tracks.every(track => track.readyState === 'ended'));
  });

  await check('ChatCard and Phantom: append to drafts, mutual exclusion, cancellation and retained drafts', async () => {
    await focusNode(card.title, card.id);
    const surface = page.locator(`[data-node-id="${card.id}"]`), input = surface.getByLabel('Mensaje para Claude');
    await input.fill('Borrador card');
    await recording(surface, surface.getByRole('button', { name: 'Dictar a Claude' }));
    await captureBoth('chatcard-listening', surface);
    await page.getByRole('button', { name: 'Abrir Phantom', exact: true }).click();
    const side = page.locator('.phantom-chat');
    assert.equal(await side.getByRole('button', { name: 'Dictar por voz', exact: true }).isDisabled(), true);
    await transcribe(surface);
    assert.equal(await input.inputValue(), `Borrador card ${transcript}`);
    const sideInput = side.getByLabel('Mensaje para Phantom'); await sideInput.fill('Borrador Phantom');
    await recording(side, side.getByRole('button', { name: 'Dictar por voz', exact: true }));
    await captureBoth('phantom-listening', side);
    await transcribe(side); assert.equal(await sideInput.inputValue(), `Borrador Phantom ${transcript}`);
    await recording(side, side.getByRole('button', { name: 'Dictar por voz', exact: true }));
    await side.getByRole('button', { name: 'Cancelar audio', exact: true }).click();
    assert.equal(await sideInput.inputValue(), `Borrador Phantom ${transcript}`);
    await side.getByRole('button', { name: 'Cerrar Phantom', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Phantom', exact: true }).click();
    assert.equal(await sideInput.inputValue(), `Borrador Phantom ${transcript}`);
    assert.equal((await calls()).filter(call => call.method === 'chat.send').length, 0, 'Dictation never sends a chat');
  });

  await check('Orchestrator: shared activity, append, cancel on tab change and preserve its draft', async () => {
    const side = page.locator('.phantom-chat');
    await side.getByRole('tab', { name: /^Orquestador/ }).click();
    const input = side.getByLabel(`Mensaje para ${orchestrator.title}`); await input.fill('Borrador orquestador');
    await recording(side, side.getByRole('button', { name: 'Dictar al orquestador' }));
    await captureBoth('orchestrator-listening', side);
    await transcribe(side); assert.equal(await input.inputValue(), `Borrador orquestador ${transcript}`);
    await recording(side, side.getByRole('button', { name: 'Dictar al orquestador' }));
    await side.getByRole('tab', { name: 'Chat', exact: true }).click();
    await page.waitForFunction(() => window.voiceAudio.tracks.every(track => track.readyState === 'ended'));
    await side.getByRole('tab', { name: /^Orquestador/ }).click();
    assert.equal(await input.inputValue(), `Borrador orquestador ${transcript}`);
    await side.getByRole('button', { name: 'Cerrar Phantom', exact: true }).click();
  });

  await check('Late ChatCard transcription cannot cross a provider change', async () => {
    const surface = page.locator(`[data-node-id="${card.id}"]`), input = surface.getByLabel('Mensaje para Claude');
    const original = await input.inputValue();
    await recording(surface, surface.getByRole('button', { name: 'Dictar a Claude' }));
    const before = await countVoice(); await surface.getByRole('button', { name: 'Detener y transcribir' }).click(); await waitVoice(before + 1);
    await invoke('chat.configure', { workspaceId: workspace.id, nodeId: card.id, provider: 'codex' });
    await surface.getByLabel('Mensaje para Codex').waitFor(); await release(); await delay(100);
    assert.equal(await surface.getByLabel('Mensaje para Codex').inputValue(), '');
    await invoke('chat.configure', { workspaceId: workspace.id, nodeId: card.id, provider: 'claude' });
    await input.waitFor(); assert.equal(await input.inputValue(), original);
  });

  await check('Voice/intention modal uses the same recorder, waves and editable draft', async () => {
    await page.keyboard.press('Control+k'); await page.getByRole('combobox', { name: 'Buscar paneles y herramientas' }).fill('Capturar voz');
    await page.locator('.tw-palette-results button').filter({ hasText: 'Capturar voz' }).click();
    const modal = page.getByRole('dialog', { name: 'Voz e intención', exact: true });
    const input = modal.getByRole('textbox', { name: /Transcripción editable/ }); await input.fill('Intención escrita');
    await recording(modal, modal.getByRole('button', { name: 'Iniciar grabación manual' }));
    await captureBoth('intention-listening', modal); await transcribe(modal);
    assert.equal(await input.inputValue(), `Intención escrita ${transcript}`);
    await modal.getByRole('button', { name: 'Interpretar como borrador editable' }).click();
    await modal.getByRole('heading', { name: 'Revisar antes de aplicar' }).waitFor();
    await modal.getByRole('button', { name: 'Cancelar y cerrar captura' }).click();
  });

  await check('Terminal: writable session pin, reviewed insert, no Enter or control sequences', async () => {
    await focusNode(terminal.title, terminal.id);
    const surface = page.locator(`[data-node-id="${terminal.id}"]`);
    const mic = surface.getByRole('button', { name: 'Dictar en esta terminal' }); await mic.waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Dictar en esta terminal"]')?.disabled);
    await surface.locator('.xterm-helper-textarea').focus();
    const before = (await calls()).filter(call => call.method === 'terminal.write').length;
    await page.keyboard.press('Control+Shift+m');
    assert.match(await dialog().textContent(), /synthetic-voice-session/);
    await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    await captureBoth('terminal-listening', dialog()); await transcribe(dialog());
    assert.equal((await calls()).filter(call => call.method === 'terminal.write').length, before);
    await dialog().getByLabel('Transcripción editable').fill('SYNTHETIC texto\nsegunda línea\r\n');
    // HTML textarea values normalize CRLF to LF before React reads the draft.
    assert.equal(await dialog().getByLabel('Transcripción editable').inputValue(), 'SYNTHETIC texto\nsegunda línea\n');
    await dialog().getByRole('button', { name: 'Insertar en terminal' }).click();
    const writes = (await calls()).filter(call => call.method === 'terminal.write');
    assert.equal(writes.length, before + 1); assert.equal(writes.at(-1).payload.sessionId, 'synthetic-voice-session');
    assert.equal(writes.at(-1).payload.data, 'SYNTHETIC texto segunda línea ');
    assert.doesNotMatch(writes.at(-1).payload.data, /[\x00-\x1f\x7f]/);
  });

  await check('Late terminal result cannot follow a replaced session; session exit stops capture and blocks its shortcut', async () => {
    await page.getByRole('button', { name: 'Dictar en esta terminal' }).click();
    await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    const before = await countVoice(); await dialog().getByRole('button', { name: 'Detener y transcribir' }).click(); await waitVoice(before + 1);
    await fixture(({ BrowserWindow }) => { globalThis.voiceFixture.sessionId = 'synthetic-voice-replacement'; BrowserWindow.getAllWindows()[0].webContents.send('phantom:event', { type: 'state.changed' }); });
    await dialog().waitFor({ state: 'hidden' }); await release();
    assert.equal((await calls()).filter(call => call.method === 'terminal.write').length, 1);
    await page.waitForFunction(() => !document.querySelector('[aria-label="Dictar en esta terminal"]')?.disabled);
    await page.getByRole('button', { name: 'Dictar en esta terminal' }).click();
    await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    await fixture(({ BrowserWindow }) => { globalThis.voiceFixture.terminalStatus = 'exited'; BrowserWindow.getAllWindows()[0].webContents.send('phantom:event', { type: 'terminal.exit', sessionId: globalThis.voiceFixture.sessionId }); });
    await dialog().waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.voiceAudio.tracks.every(track => track.readyState === 'ended'));
    await page.waitForFunction(() => document.querySelector('[aria-label="Dictar en esta terminal"]')?.disabled);
    await page.locator(`[data-node-id="${terminal.id}"] .xterm-helper-textarea`).focus();
    const requests = await page.evaluate(() => window.voiceAudio.requests);
    await page.keyboard.press('Control+Shift+m');
    assert.equal(await dialog().count(), 0, 'The shortcut cannot open dictation for an exited session');
    assert.equal(await page.evaluate(() => window.voiceAudio.requests), requests, 'An exited session cannot acquire the microphone');
    assert.equal((await calls()).filter(call => call.method === 'terminal.write').length, 1);
  });

  await check('Disconnected transport cancels microphone and cannot accept terminal dictation', async () => {
    await fixture(({ BrowserWindow }) => {
      const f = globalThis.voiceFixture; f.terminalStatus = 'running';
      BrowserWindow.getAllWindows()[0].webContents.send('phantom:event', { type: 'connection', status: 'reconnecting', message: 'SYNTHETIC · reconexión' });
      BrowserWindow.getAllWindows()[0].webContents.send('phantom:event', { type: 'connection', status: 'connected' });
    });
    await page.waitForFunction(() => !document.querySelector('[aria-label="Dictar en esta terminal"]')?.disabled);
    await page.getByRole('button', { name: 'Dictar en esta terminal' }).click();
    await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    await fixture(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('phantom:event', { type: 'connection', status: 'reconnecting', message: 'SYNTHETIC · desconectado' }));
    await dialog().waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.voiceAudio.tracks.every(track => track.readyState === 'ended'));
    assert.equal(await page.getByRole('button', { name: 'Dictar en esta terminal' }).isDisabled(), true);
    assert.equal((await calls()).filter(call => call.method === 'terminal.write').length, 1);
    await fixture(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('phantom:event', { type: 'connection', status: 'connected' }));
  });

  await check('Cancel transcription drops late results and an ASR error is actionable', async () => {
    await focusNode(noteA.title, noteA.id);
    await page.getByLabel(`Nota: ${noteA.title}`, { exact: true }).focus();
    await page.keyboard.press('Control+Shift+m'); await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    const before = await countVoice(); await dialog().getByRole('button', { name: 'Detener y transcribir' }).click(); await waitVoice(before + 1);
    assert.equal(await dialog().getByRole('button', { name: 'Grabar dictado' }).isDisabled(), true);
    await dialog().getByRole('button', { name: 'Cancelar audio', exact: true }).click(); await release(); await delay(100);
    assert.equal(await dialog().getByLabel('Transcripción editable').inputValue(), '');
    await fixture(() => { globalThis.voiceFixture.fail = true; });
    await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' })); await transcribe(dialog());
    await dialog().getByRole('alert').filter({ hasText: 'setup:voice' }).waitFor();
    await fixture(() => { globalThis.voiceFixture.fail = false; });
    await dialog().getByRole('button', { name: 'Cerrar dictado' }).click();
  });

  await check('Narrow desktop and reduced motion retain state and accessible keyboard controls', async () => {
    await size(1100, 760); await page.getByLabel(`Nota: ${noteA.title}`, { exact: true }).focus();
    await page.keyboard.press('Control+Shift+m');
    await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    await capture('narrow-field-listening');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const style = await dialog().locator('.voice-waves i').first().evaluate(el => ({ transform: getComputedStyle(el).transform, transition: getComputedStyle(el).transitionDuration }));
    assert.equal(style.transition, '0s'); assert.match(style.transform, /0\.2/);
    await capture('narrow-reduced-motion');
    const before = await countVoice(); await dialog().getByRole('button', { name: 'Detener y transcribir' }).click(); await waitVoice(before + 1);
    assert.equal(await dialog().locator('.voice-waves').evaluate(el => getComputedStyle(el).animationName), 'none');
    await capture('narrow-transcribing'); await release(); await dialog().locator('.voice-activity').waitFor({ state: 'hidden' });
    await dialog().getByRole('button', { name: 'Cancelar', exact: true }).focus(); await page.keyboard.press('Tab');
    assert.equal(await dialog().getByRole('button', { name: 'Cerrar dictado' }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  await check('Concurrent field edits are preserved and removing its panel stops capture', async () => {
    const input = page.getByLabel(`Nota: ${noteA.title}`, { exact: true }); await input.focus();
    await page.keyboard.press('Control+Shift+m'); await dialog().getByLabel('Transcripción editable').fill('SYNTHETIC nuevo texto');
    await input.evaluate(el => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'SYNTHETIC borrador modificado durante el dictado');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await dialog().getByRole('button', { name: 'Insertar en campo' }).click();
    await dialog().getByRole('alert').filter({ hasText: 'El borrador cambió' }).waitFor();
    assert.equal(await input.inputValue(), 'SYNTHETIC borrador modificado durante el dictado');
    await dialog().getByRole('button', { name: 'Cerrar dictado' }).click();
    await focusNode(noteB.title, noteB.id); await page.getByLabel(`Nota: ${noteB.title}`, { exact: true }).focus();
    await page.keyboard.press('Control+Shift+m'); await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    await invoke('node.remove', { workspaceId: workspace.id, id: noteB.id }); await dialog().waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.voiceAudio.tracks.every(track => track.readyState === 'ended'));
    await focusNode(noteA.title, noteA.id);
  });

  await check('Fields that lose editability cancel capture and preserve their draft', async () => {
    // Real DOM fields isolate native editability rules from React fixtures.
    // A textarea inherits :disabled from its fieldset, while .disabled is false.
    await page.evaluate(() => {
      const fixture = document.createElement('fieldset'); fixture.id = 'voice-writable-fixture';
      const input = document.createElement('textarea'); input.setAttribute('aria-label', 'SYNTHETIC campo heredado'); input.value = 'SYNTHETIC borrador conservado';
      const parent = document.createElement('div'); parent.contentEditable = 'true';
      const child = document.createElement('div'); child.contentEditable = 'true'; child.tabIndex = 0; child.setAttribute('aria-label', 'SYNTHETIC campo enriquecido'); child.textContent = 'SYNTHETIC contenido conservado';
      parent.append(child); fixture.append(input, parent); document.body.append(fixture);
    });
    try {
      const input = page.getByLabel('SYNTHETIC campo heredado', { exact: true });
      await input.focus(); await page.keyboard.press('Control+Shift+m');
      await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
      await input.evaluate(el => { el.parentElement.disabled = true; });
      await dialog().waitFor({ state: 'hidden' });
      await page.waitForFunction(() => window.voiceAudio.tracks.every(track => track.readyState === 'ended'));
      assert.equal(await input.evaluate(el => el.disabled), false, 'Native fieldset inheritance is exercised');
      assert.equal(await input.isDisabled(), true);
      assert.equal(await input.inputValue(), 'SYNTHETIC borrador conservado');
      await input.evaluate(el => { el.parentElement.disabled = false; });
      const rich = page.getByLabel('SYNTHETIC campo enriquecido', { exact: true });
      await rich.focus(); await page.keyboard.press('Control+Shift+m');
      await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
      await rich.evaluate(el => { el.contentEditable = 'false'; });
      await dialog().waitFor({ state: 'hidden' });
      await page.waitForFunction(() => window.voiceAudio.tracks.every(track => track.readyState === 'ended'));
      assert.equal(await rich.textContent(), 'SYNTHETIC contenido conservado');
    } finally {
      await page.locator('#voice-writable-fixture').evaluate(el => el.remove());
    }
  });

  await check('Project change cancels pending ASR and active audio without retargeting', async () => {
    const input = page.getByLabel(`Nota: ${noteA.title}`, { exact: true }); const original = await input.inputValue(); await input.focus();
    await page.keyboard.press('Control+Shift+m'); await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    const before = await countVoice(); await dialog().getByRole('button', { name: 'Detener y transcribir' }).click(); await waitVoice(before + 1);
    await invoke('workspace.select', { id: workspaceB.id }); await dialog().waitFor({ state: 'hidden' }); await release();
    await page.getByRole('button', { name: workspaceB.name, exact: true }).first().waitFor();
    assert.equal((await calls()).filter(call => call.method === 'terminal.write').length, 1);
    await invoke('workspace.select', { id: workspace.id }); await focusNode(noteA.title, noteA.id);
    assert.equal(await input.inputValue(), original);
    await input.focus(); await page.keyboard.press('Control+Shift+m'); await recording(dialog(), dialog().getByRole('button', { name: 'Grabar dictado' }));
    await invoke('workspace.select', { id: workspaceB.id }); await dialog().waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.voiceAudio.tracks.every(track => track.readyState === 'ended'));
  });

  const transcriptionCalls = (await calls()).filter(call => call.method === 'voice.transcribe');
  assert.ok(transcriptionCalls.length >= 10);
  for (const call of transcriptionCalls) {
    assert.equal(call.payload.workspaceId, workspace.id); assert.match(call.payload.mimeType, /^audio\//);
    assert.ok(Buffer.from(call.payload.audioBase64, 'base64').length > 32, 'Actual encoded synthetic audio crosses IPC');
  }
  assert.deepEqual(errors, [], 'No renderer errors');
  const report = { passed: true, fixture: 'SYNTHETIC audio + SYNTHETIC transcription, no recognition quality claim', checks, captures, errors };
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  console.error(JSON.stringify({ passed: false, evidence, checks, captures, errors, error: error.stack }, null, 2)); throw error;
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
    if (appProcess?.exitCode === null && appProcess?.signalCode === null) appProcess.kill('SIGKILL');
    await rm(profile, { recursive: true, force: true });
  }
}
