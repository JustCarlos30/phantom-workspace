// Real-app check of the reference board: paste an image, drop a link, add a
// video, comment at a timestamp. Run after `npm run build`; needs ffmpeg.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/opencode', { recursive: true });
const temp = await mkdtemp('/tmp/opencode/phantom-references-');
const folder = path.join(temp, 'Board fixture');
await mkdir(folder);
const still = path.join(temp, 'still.png'), clip = path.join(temp, 'clip.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-frames:v', '1', still]);
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '20', '-c:v', 'libvpx', '-b:v', '300k', '-f', 'webm', clip.replace('.mp4', '.webm')]);
const png = await readFile(still);
const site = http.createServer((req, res) => {
  if (req.url === '/cover.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); }
  else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Estudio de color</title><meta property="og:description" content="Paletas para video"><meta property="og:image" content="/cover.png">'); }
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${site.address().port}`;
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: path.join(temp, 'profile'), PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/sh' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PHANTOM_RENDERER_URL;
const app = await electron.launch({ args: [root, '--ozone-platform=headless'], cwd: root, env });
const appProcess = app.process();
let page, host;
const errors = [];
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.locator('.app-shell').waitFor();
  host = (await invoke('system.info')).pid;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
  const workspace = await invoke('workspace.open', { path: folder });
  await page.reload();
  const canvas = page.locator('.canvas');
  await canvas.waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const references = page.locator('.canvas-node[data-type="reference"]');

  // Ctrl+V with an image on the clipboard: a reference appears under the pointer.
  await page.mouse.move(700, 420);
  await canvas.focus();
  await page.evaluate(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, [...png]);
  await references.first().waitFor();
  const image = references.first().locator('.reference-media img');
  await page.waitForFunction(el => el.complete && el.naturalWidth === 640, await image.elementHandle());
  const box = await references.first().boundingBox();
  assert.ok(Math.abs(box.x + box.width / 2 - 700) < 4 && Math.abs(box.y + box.height / 2 - 420) < 4, 'the pasted image is centred on the pointer');
  assert.ok(Math.abs((box.height - 70) / box.width - 360 / 640) < .02, 'the panel hugs the image ratio');

  // A pasted URL becomes a link card with the page's own title and preview.
  await page.mouse.move(1150, 300);
  await page.evaluate(url => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', url);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, `${base}/palettes`);
  const link = page.locator('.reference-link');
  await link.waitFor();
  assert.equal(await link.locator('strong').textContent(), 'Estudio de color');
  await page.waitForFunction(el => el.complete && el.naturalWidth === 640, await link.locator('img').elementHandle());

  // Typing in an input keeps paste for that input.
  const caption = references.first().locator('.reference-caption input');
  await caption.fill('paleta fría');
  await caption.evaluate(el => { const transfer = new DataTransfer(); transfer.setData('text/plain', 'https://example.com'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); });
  await delay(300);
  assert.equal(await references.count(), 2, 'a paste inside a field never creates a panel');

  // A video streams through the reference protocol and seeks by byte range.
  const video = await invoke('reference.add', { workspaceId: workspace.id, path: clip.replace('.mp4', '.webm'), x: 60, y: 520, title: 'Corte 1' });
  const player = page.locator(`[data-node-id="${video.id}"] video`);
  await player.waitFor();
  await page.waitForFunction(el => el.readyState >= 1 && el.duration > 19, await player.elementHandle());
  await player.evaluate(el => new Promise(resolve => { el.addEventListener('seeked', resolve, { once: true }); el.currentTime = 12.5; }));
  assert.ok(Math.abs(await player.evaluate(el => el.currentTime) - 12.5) < .2, 'the video seeks');

  // C, click on the video: the pin keeps the timestamp and follows the panel.
  await canvas.focus();
  await page.keyboard.press('c');
  await page.locator('.comment-hint').waitFor();
  const frame = await player.boundingBox();
  await page.mouse.click(frame.x + frame.width * .5, frame.y + frame.height * .4);
  await page.locator('.comment-thread textarea').fill('Este corte va más rápido');
  await page.keyboard.press('Enter');
  const pin = page.locator('.comment-pin:not(.draft)');
  await pin.waitFor();
  const comments = (await invoke('state.get')).workspaces[0].comments;
  assert.equal(comments.length, 1); assert.equal(comments[0].nodeId, video.id); assert.equal(comments[0].time, 12.5);
  assert.equal(await page.locator('.reference-timeline button').count(), 1, 'the comment marks the video timeline');
  await page.keyboard.press('Escape');
  const before = await pin.boundingBox();
  await invoke('node.update', { workspaceId: workspace.id, id: video.id, patch: { x: 260 } });
  await page.waitForFunction(([el, x]) => Math.abs(el.getBoundingClientRect().x - x) < 2, [await pin.elementHandle(), before.x + 200]);
  await player.evaluate(el => { el.currentTime = 0; });
  await pin.click();
  await page.locator('.comment-thread .comment-time').waitFor();
  await page.waitForFunction(el => Math.abs(el.currentTime - 12.5) < .2, await player.elementHandle());
  await page.locator('.comment-thread textarea').fill('Hecho');
  await page.keyboard.press('Enter');
  await page.locator('.comment-thread li').nth(1).waitFor();
  await page.screenshot({ path: path.join(temp, 'board.png') });
  await page.locator('.comment-thread [aria-label="Resolver comentario"]').click();
  await pin.waitFor({ state: 'detached' });

  const stored = await readdir(path.join(temp, 'profile', 'references', workspace.id));
  assert.equal(stored.length, 2, 'the pasted image and the link preview share one file; the video is the other');
  assert.deepEqual(await readdir(folder), [], 'the project folder stays untouched');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, screenshot: path.join(temp, 'board.png') }));
} catch (error) {
  await page?.screenshot({ path: path.join(temp, 'failure.png') }).catch(() => {});
  console.error(error.stack, '\nerrors:', errors, '\nscreenshot:', path.join(temp, 'failure.png'));
  process.exitCode = 1;
} finally {
  site.close();
  if (host) {
    const command = await readFile(`/proc/${host}/cmdline`, 'utf8').catch(() => '');
    if (command.includes(path.join(temp, 'profile'))) {
      await Promise.race([invoke('host.shutdown').catch(() => {}), delay(2500)]);
      try { process.kill(host, 'SIGTERM'); } catch {}
    }
  }
  await Promise.race([app.close().catch(() => {}), delay(2500)]);
  killElectronGroup(appProcess);
}
