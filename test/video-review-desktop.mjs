import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { killElectronGroup } from './support/electron-process.mjs';

// Controller-owned entry point: real production Electron, IPC, host, media
// decoder and private persistence. Only the file picker and provider executable
// are synthetic. No real provider, external project or personal profile is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/video-review-'), profile = path.join(temp, 'profile');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: profile, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
let app, page, host, child;
const checks = [], errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (m, p = {}) => page.evaluate(([method, payload]) => window.phantom.invoke(method, payload), [m, p]);
async function until(fn, message) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await fn()) return; await delay(80); }
  assert.fail(message);
}
async function viewport(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [width, height]);
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
}
// Minimal deterministic WebM muxer. VP8 frames come from Chromium's encoder;
// explicit duration avoids MediaRecorder's infinite-duration streaming WebM.
function uint(n) { const a = []; do { a.unshift(n & 255); n = Math.floor(n / 256); } while (n); return Buffer.from(a); }
function ebml(id, data) {
  data = Buffer.isBuffer(data) ? data : Buffer.concat(data);
  let count = 1; while (data.length >= 2 ** (7 * count) - 1) count++;
  let size = BigInt(data.length) | (1n << BigInt(7 * count)); const b = Buffer.alloc(count);
  for (let i = count - 1; i >= 0; i--) { b[i] = Number(size & 255n); size >>= 8n; }
  return Buffer.concat([Buffer.from(id, 'hex'), b, data]);
}
const u = (id, n) => ebml(id, uint(n)), s = (id, text) => ebml(id, Buffer.from(text));
function webm(frames) {
  const duration = Buffer.alloc(8); duration.writeDoubleBE(2000);
  return Buffer.concat([
    ebml('1a45dfa3', [u('4286', 1), u('42f7', 1), u('42f2', 4), u('42f3', 8), s('4282', 'webm'), u('4287', 4), u('4285', 2)]),
    ebml('18538067', [
      ebml('1549a966', [u('2ad7b1', 1000000), s('4d80', 'Phantom fixture'), s('5741', 'Phantom fixture'), ebml('4489', duration)]),
      ebml('1654ae6b', [ebml('ae', [u('d7', 1), u('73c5', 1), u('83', 1), s('86', 'V_VP8'), u('23e383', Math.round(1e9 / 24)), ebml('e0', [u('b0', 320), u('ba', 180)])])]),
      ebml('1f43b675', [u('e7', 0), ...frames.map(f => {
        const head = Buffer.alloc(4); head[0] = 0x81; head.writeInt16BE(Math.round(f.timestamp / 1000), 1); head[3] = f.key ? 0x80 : 0;
        return ebml('a3', Buffer.concat([head, Buffer.from(f.bytes)]));
      })])
    ])
  ]);
}
async function media(color) {
  return page.evaluate(async wing => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d'), chunks = [];
    const encoder = new VideoEncoder({ output: chunk => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); chunks.push({ timestamp: chunk.timestamp, key: chunk.type === 'key', bytes: [...data] }); }, error: error => { throw error; } });
    encoder.configure({ codec: 'vp8', width: 320, height: 180, framerate: 24, bitrate: 180000 });
    for (let i = 0; i < 48; i++) {
      ctx.fillStyle = '#182030'; ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#d8d4ee'; ctx.fillRect(140, 64, 40, 64); ctx.fillRect(152, 48, 32, 24);
      ctx.fillStyle = wing; ctx.fillRect(80, 72 + (i % 2) * 4, 64, 24); ctx.fillRect(96, 96, 48, 16); ctx.fillRect(180, 72, 56, 24);
      ctx.fillStyle = '#15171c'; ctx.fillRect(168, 56, 8, 8);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / 24), duration: Math.round(1e6 / 24) }); encoder.encode(frame, { keyFrame: i === 0 }); frame.close();
    }
    await encoder.flush(); encoder.close();
    return { frames: chunks, image: canvas.toDataURL('image/png').split(',')[1] };
  }, color);
}
async function contentBounds() {
  return page.locator('.canvas-node.focused [data-review-media]').evaluate(el => {
    const b = el.getBoundingClientRect(), scale = Math.min(b.width / (el.videoWidth || el.naturalWidth), b.height / (el.videoHeight || el.naturalHeight));
    const width = (el.videoWidth || el.naturalWidth) * scale, height = (el.videoHeight || el.naturalHeight) * scale;
    return { x: b.x + (b.width - width) / 2, y: b.y + (b.height - height) / 2, width, height, outer: { x: b.x, y: b.y, width: b.width, height: b.height } };
  });
}
async function detector() {
  const command = process.env.PHANTOM_IMPECCABLE_BIN || path.join(homedir(), '.claude/skills/impeccable/scripts/impeccable');
  const argv = ['detect', '--target', 'src/references.css'];
  const result = await new Promise(resolve => {
    let stdout = '', stderr = '';
    const proc = spawn(command, argv, { cwd: root, shell: false, timeout: 30000 });
    proc.stdout.on('data', d => { stdout += d; }); proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', error => resolve({ command, argv, error: error.message, stdout, stderr }));
    proc.on('close', (code, signal) => resolve({ command, argv, code, signal, stdout, stderr }));
  });
  await writeFile(path.join(temp, 'detector.json'), JSON.stringify(result, null, 2));
  assert.ok(!result.error && [0, 1].includes(result.code), 'El detector debe ejecutarse; hallazgos no equivalen a aprobación visual');
}
try {
  app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
  child = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor(); host = (await invoke('system.info')).pid;
  await viewport(1520, 980); await page.emulateMedia({ reducedMotion: 'reduce' });
  const project = path.join(temp, 'project'), otherFolder = path.join(temp, 'other'); await mkdir(project); await mkdir(otherFolder);
  const provider = path.join(temp, 'fixture-provider');
  await writeFile(provider, `#!${process.execPath}\n// Local fixture: holds one turn so the real queue can be exercised.\nprocess.stdin.resume(); setTimeout(() => process.exit(0), 90000);\n`); await chmod(provider, 0o700);
  await invoke('settings.update', { patch: { claudePath: provider, opencodePath: provider, codexPath: provider } });
  const fixture = await media('#a78bda'), nextFixture = await media('#7cc9a0');
  const clip = path.join(temp, 'ave-original.webm'), render = path.join(temp, 'ave-despues.webm'), image = path.join(temp, 'ave.png');
  const bytes = webm(fixture.frames); await writeFile(clip, bytes); await writeFile(render, webm(nextFixture.frames)); await writeFile(image, Buffer.from(fixture.image, 'base64'));
  const w = await invoke('workspace.open', { path: project }), other = await invoke('workspace.open', { path: otherFolder });
  const node = await invoke('reference.add', { workspaceId: w.id, path: clip, title: 'Ave original', x: 320, y: 160, width: 680, height: 520 });
  await invoke('workspace.select', { id: w.id }); await page.reload(); await page.getByRole('button', { name: 'Enfocar Ave original', exact: true }).click();
  const panel = page.locator('.canvas-node.focused'), video = panel.locator('video[data-review-media]');
  await page.waitForFunction(() => { const v = document.querySelector('.canvas-node.focused video'); return v?.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 1; });
  await panel.getByLabel('FPS explícitos').fill('24');
  await panel.getByRole('button', { name: 'Reproducir video', exact: true }).click();
  await until(() => video.evaluate(v => !v.paused && v.currentTime > .1), 'El video reproduce realmente');
  await panel.getByRole('button', { name: 'Pausar video', exact: true }).click();
  const before = await video.evaluate(v => v.currentTime);
  await panel.getByRole('button', { name: 'Frame siguiente', exact: true }).click();
  // Wait against the observed pre-click time, not a sleep or a fake frame state.
  await page.waitForFunction(t => { const v = document.querySelector('.canvas-node.focused video'); return v.paused && !v.seeking && Math.abs(v.currentTime - (Math.round(t * 24) + 1) / 24) < .002; }, before);
  await panel.getByRole('button', { name: 'Frame anterior', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.canvas-node.focused video').seeking);
  checks.push('Reproducción, pausa y paso de frame con FPS explícitos en un WebM local decodificado');

  await panel.getByRole('button', { name: 'Rectángulo', exact: true }).click();
  const b = await contentBounds();
  if (b.y > b.outer.y + 3) await page.mouse.click(b.x + b.width / 2, b.outer.y + 1);
  else if (b.x > b.outer.x + 3) await page.mouse.click(b.outer.x + 1, b.y + b.height / 2);
  assert.equal(await page.getByRole('dialog', { name: 'Nuevo comentario', exact: true }).count(), 0, 'Las bandas no crean anotaciones');
  await page.mouse.move(b.x + .25 * b.width, b.y + .4 * b.height); await page.mouse.down();
  await page.mouse.move(b.x + .45 * b.width, b.y + .65 * b.height, { steps: 8 }); await page.mouse.up();
  const draft = page.getByRole('dialog', { name: 'Nuevo comentario', exact: true }); await draft.waitFor();
  await draft.getByLabel('Alcance de revisión').selectOption('range'); await draft.getByLabel('Fin del tramo', { exact: true }).fill('1.9');
  // Switching away from range must remove end, rather than send undefined over IPC.
  await draft.getByLabel('Alcance de revisión').selectOption('all'); await draft.getByLabel('Alcance de revisión').selectOption('range');
  await draft.getByLabel('Fin del tramo', { exact: true }).fill('1.9');
  await draft.getByLabel('Elemento señalado').fill('ala izquierda del pixel art');
  await draft.getByLabel('Fuente editable', { exact: true }).fill('src/ave.aseprite');
  const words = '@phantom mejora esta ala sin cambiar el cuerpo'; await draft.getByLabel('Texto del comentario').fill(words);
  const main = { workspaceId: w.id, nodeId: `phantom:${w.id}` };
  await invoke('chat.send', { ...main, text: 'Fixture: mantener turno activo' });
  for (let i = 0; i < 20; i++) await invoke('chat.send', { ...main, text: `Fixture en cola ${i}` });
  // Force the real atomic save to fail, retaining the previous state file.
  const stateFile = path.join(profile, 'state.json'), backup = path.join(temp, 'state-backup.json');
  await rename(stateFile, backup); await mkdir(stateFile);
  try {
    await draft.getByRole('button', { name: 'Enviar', exact: true }).click();
    await draft.getByRole('alert').waitFor();
    assert.equal(await draft.getByLabel('Texto del comentario').inputValue(), words);
    assert.equal(await draft.getByLabel('Elemento señalado').inputValue(), 'ala izquierda del pixel art');
    await page.screenshot({ path: path.join(temp, 'save-failed.png') });
  } finally { await rm(stateFile, { recursive: true, force: true }); await rename(backup, stateFile); }
  await draft.getByRole('button', { name: 'Enviar', exact: true }).click();
  const thread = page.getByRole('dialog', { name: 'Hilo del comentario 1', exact: true }); await thread.waitFor();
  await thread.getByRole('button', { name: 'Reintentar envío', exact: true }).waitFor();
  let saved = (await invoke('comment.list', { workspaceId: w.id }))[0];
  assert.equal(saved.handoff.status, 'failed'); assert.equal(saved.messages[0].text, words); assert.equal(saved.resolved, false);
  for (const [key, expected] of Object.entries({ x: .25, y: .4, width: .2, height: .25 })) assert.ok(Math.abs(saved.review.region[key] - expected) < .003, key);
  assert.equal(saved.review.hash, createHash('sha256').update(bytes).digest('hex'));
  assert.ok(saved.review.capture || saved.review.captureLimit, 'La captura o su límite debe constar explícitamente');
  const queued = await invoke('chat.get', main); await invoke('chat.queue.remove', { ...main, id: queued.queue[0].id });
  await thread.getByRole('button', { name: 'Reintentar envío', exact: true }).click();
  await until(async () => (await invoke('comment.list', { workspaceId: w.id }))[0].handoff.status === 'queued', 'El reintento entra en la cola real');
  const comments = await invoke('comment.list', { workspaceId: w.id }); assert.equal(comments.length, 1); assert.equal(comments[0].messages.length, 1);
  const chat = await invoke('chat.get', main); assert.equal(chat.queue.filter(q => q.text.includes(saved.review.hash)).length, 1);
  await page.screenshot({ path: path.join(temp, 'desktop-review.png') });
  checks.push('Rectángulo normalizado sin letterboxing, alcance y fuente; fallo de disco conserva borrador; cola llena y reintento explícito sin duplicados');

  await thread.getByRole('button', { name: 'Cerrar hilo', exact: true }).click();
  await app.evaluate(({ dialog }, chosen) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] }); }, render);
  await panel.getByRole('button', { name: 'Importar versión', exact: true }).click();
  await until(async () => (await invoke('reference.list', { workspaceId: w.id })).length === 2, 'La versión se importa desde la UI');
  const versions = await invoke('reference.list', { workspaceId: w.id }), next = versions.find(n => n.id !== node.id);
  await panel.getByLabel('Comparar versión').selectOption(next.id); await panel.locator('.review-compare video').waitFor();
  assert.equal(next.data.previousVersion, node.id); assert.equal((await invoke('comment.list', { workspaceId: w.id }))[0].nodeId, node.id);
  await viewport(1100, 760); await page.screenshot({ path: path.join(temp, 'compact-comparison.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await panel.locator('.review-tools').evaluate(el => el.scrollWidth > el.clientWidth), false);
  assert.ok((await readFile(path.join(profile, 'references', w.id, node.data.file))).equals(bytes), 'El original sigue intacto');
  await invoke('workspace.select', { id: other.id }); await page.reload();
  assert.equal((await invoke('comment.list', { workspaceId: other.id })).length, 0);
  await invoke('workspace.select', { id: w.id }); await page.reload();
  saved = (await invoke('comment.list', { workspaceId: w.id }))[0]; assert.equal(saved.handoff.status, 'queued'); assert.equal(saved.review.hash, node.data.hash);
  checks.push('Importación y comparación antes/después en escritorio compacto; original y comentarios intactos, aislamiento de proyecto y recarga');

  const still = await invoke('reference.add', { workspaceId: w.id, path: image, title: 'Imagen anotable', x: 1300, y: 100, width: 500, height: 400 });
  await page.getByRole('button', { name: 'Enfocar Imagen anotable', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.canvas-node.focused img[data-review-media]')?.naturalWidth > 0);
  await page.locator('.canvas-node.focused').getByRole('button', { name: 'Marcar centro', exact: true }).click();
  const imageDraft = page.getByRole('dialog', { name: 'Nuevo comentario', exact: true }); await imageDraft.getByLabel('Texto del comentario').fill('Revisión de imagen');
  await imageDraft.getByRole('button', { name: 'Enviar', exact: true }).click();
  const imageComments = await invoke('comment.list', { workspaceId: w.id }); assert.equal(imageComments.find(c => c.nodeId === still.id).review.kind, 'image');
  checks.push('Imágenes anotables con el mismo flujo persistido');
  assert.deepEqual(errors, []);
  await writeFile(path.join(temp, 'checks.json'), JSON.stringify({ checks, errors, media: { fps: 24, duration: 2, codec: 'VP8', synthetic: true }, evidence: temp }, null, 2));
  console.log(JSON.stringify({ interactionsPassed: true, checks, evidence: temp }));
} catch (error) {
  await page?.screenshot({ path: path.join(temp, 'failure.png') }).catch(() => {});
  await writeFile(path.join(temp, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors }, null, 2)); throw error;
} finally {
  try {
    if (host) {
      const cmd = await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '');
      if (cmd.includes(profile)) { await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2000)]); try { process.kill(host, 'SIGTERM'); } catch {} }
    }
    if (app) await Promise.race([app.close().catch(() => {}), delay(2000)]);
    killElectronGroup(child);
  } finally { await detector(); }
}
