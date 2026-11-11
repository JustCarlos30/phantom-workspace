import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp('/tmp/opencode/phantom-terminal-scroll-');
const env = { ...process.env, PHANTOM_WORKSPACE_HOME: temp, PHANTOM_NODE_BINARY: process.execPath, SHELL: '/bin/bash' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PHANTOM_RENDERER_URL;
const executable = process.env.PHANTOM_TEST_EXECUTABLE;
const app = await electron.launch({ ...(executable ? { executablePath: executable, args: ['--ozone-platform=headless'] } : { args: [root, '--ozone-platform=headless'] }), env, timeout: 15000 });
const page = await app.firstWindow();
page.setDefaultTimeout(8000);
const invoke = (method, payload = {}) => page.evaluate(([m, p]) => window.phantom.invoke(m, p), [method, payload]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 8000;
  do { if (await fn()) return; await delay(80); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let hostPid;
try {
  await page.waitForSelector('.app-shell');
  hostPid = (await invoke('system.info')).pid;
  const workspace = await invoke('workspace.open', { path: temp });
  await page.locator('.create-dock').getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.locator('.status-dot.running').waitFor();
  const session = (await invoke('terminal.list', { workspaceId: workspace.id }))[0];
  const screen = page.locator('.terminal-host .xterm-screen');
  const visible = () => screen.innerText();
  await until(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')), 'terminal focus');
  await page.keyboard.type("for i in {1..160}; do printf 'SCROLL_LINE_%03d\\n' \"$i\"; done");
  await page.keyboard.press('Enter');
  await until(async () => (await visible()).includes('SCROLL_LINE_160'), 'scrollback fixture output');
  // Let the initial jump's debounced camera save settle before comparing it.
  await delay(600);
  const camera = (await invoke('state.get')).workspaces.find(w => w.id === workspace.id).camera;
  const box = await screen.boundingBox();
  const latest = await visible();
  await page.screenshot({ path: '/tmp/opencode/phantom-scroll-before.png' });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await until(async () => (await visible()) !== latest, 'wheel reveals older terminal output');
  console.log('PASS: wheel reveals shell scrollback');
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 600);
  await until(async () => (await visible()) === latest, 'wheel returns to latest output');

  // A real PTY application with mouse reporting, like an agent's full-screen
  // conversation. Its alternate buffer has no browser-owned scrollback.
  const fixture = `${temp}/conversation.py`;
  await fs.writeFile(fixture, `import os, re, sys, termios, tty
old = termios.tcgetattr(0)
tty.setraw(0)
offset = 100
pending = b''
def draw():
    sys.stdout.write('\\x1b[H\\x1b[2JCONVERSATION_ROW_%03d' % offset)
    sys.stdout.flush()
try:
    sys.stdout.write('\\x1b[?1049h\\x1b[?1000h\\x1b[?1006h')
    draw()
    while True:
        data = os.read(0, 1024)
        if b'\\x03' in data: break
        pending += data
        while True:
            match = re.search(rb'\\x1b\\[<(64|65);\\d+;\\d+M', pending)
            if not match: break
            offset += -1 if match[1] == b'64' else 1
            pending = pending[match.end():]
            draw()
finally:
    sys.stdout.write('\\x1b[?1006l\\x1b[?1000l\\x1b[?1049l')
    sys.stdout.flush()
    termios.tcsetattr(0, termios.TCSADRAIN, old)
`);
  await page.keyboard.type(`python3 '${fixture}'`);
  await page.keyboard.press('Enter');
  await until(async () => (await visible()).includes('CONVERSATION_ROW_100'), 'agent conversation fixture');
  await page.mouse.wheel(0, -120);
  await until(async () => !(await visible()).includes('CONVERSATION_ROW_100'), 'focused agent scrolls');
  console.log('PASS: focused agent receives wheel input');
  const conversation = await visible();
  const fontControl = page.getByRole('button', { name: 'Ampliar texto de la terminal', exact: true });
  await fontControl.focus();
  await page.mouse.wheel(0, -120);
  await until(async () => (await visible()) !== conversation, 'agent scrolls after focus leaves terminal input');
  assert.equal(await fontControl.evaluate(el => el === document.activeElement), true, 'scroll must not steal keyboard focus');
  console.log('PASS: agent scrolls while its toolbar has keyboard focus');
  assert.deepEqual((await invoke('state.get')).workspaces.find(w => w.id === workspace.id).camera, camera, 'terminal scroll must not pan or zoom the canvas');

  const canvas = await page.locator('.canvas').boundingBox();
  await page.mouse.click(canvas.x + 5, canvas.y + 5);
  await until(async () => !(await page.locator('.canvas-node.selected').count()), 'terminal deselected');
  const inactiveConversation = await visible();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await until(async () => (await visible()) !== inactiveConversation, 'hovered inactive terminal scrolls');
  assert.equal(await page.locator('.canvas-node.selected').count(), 0, 'scroll does not change selection');
  console.log('PASS: inactive terminal receives wheel input without changing selection');

  await page.locator('.canvas-node').getByLabel('Enfocar panel', { exact: true }).click();
  await page.locator('.canvas-node.focused').waitFor();
  await delay(250);
  await fontControl.focus();
  const focusedConversation = await visible();
  const focusedBox = await screen.boundingBox();
  await page.mouse.move(focusedBox.x + focusedBox.width / 2, focusedBox.y + focusedBox.height / 2);
  await page.mouse.wheel(0, -120);
  await until(async () => (await visible()) !== focusedConversation, 'focused panel scrolls without textarea focus');
  console.log('PASS: conversation scrolls in focused panel mode');
  await page.screenshot({ path: '/tmp/opencode/phantom-scroll-after.png' });
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(await page.locator('.terminal-host').innerText().catch(() => 'Terminal unavailable'));
  throw error;
} finally {
  await Promise.race([invoke('host.shutdown').catch(() => {}), delay(4000)]);
  app.process().kill('SIGKILL');
  if (hostPid) { try { process.kill(hostPid, 'SIGTERM'); } catch {} }
  await fs.rm(temp, { recursive: true, force: true });
}
