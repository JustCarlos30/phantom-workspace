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
  const terminalNode = page.locator('.canvas-node').filter({ has: page.locator('.terminal-host') });
  const fontControl = page.getByRole('button', { name: 'Ampliar texto de la terminal', exact: true });
  const transform = () => page.locator('.canvas-world').evaluate(el => el.style.transform);
  const visible = () => screen.innerText();
  await until(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')), 'terminal focus');
  await page.keyboard.type("for i in {1..160}; do printf 'SCROLL_LINE_%03d\\n' \"$i\"; done");
  await page.keyboard.press('Enter');
  await until(async () => (await visible()).includes('SCROLL_LINE_160'), 'scrollback fixture output');
  // Let the initial jump's debounced camera save settle before comparing it.
  await delay(600);
  const camera = (await invoke('state.get')).workspaces.find(w => w.id === workspace.id).camera;
  const cameraTransform = await transform();
  const box = await screen.boundingBox();
  const latest = await visible();
  await page.screenshot({ path: '/tmp/opencode/phantom-scroll-before.png' });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await until(async () => (await visible()) !== latest, 'wheel reveals older terminal output');
  console.log('PASS: wheel reveals shell scrollback');
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 600);
  await until(async () => (await visible()) === latest, 'wheel returns to latest output');
  await fontControl.focus();
  await page.mouse.wheel(0, -600);
  await until(async () => (await visible()) !== latest, 'shell history scrolls with toolbar focus');
  assert.equal(await fontControl.evaluate(el => el === document.activeElement), true);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 600);
  await until(async () => (await visible()) === latest, 'shell returns to prompt with toolbar focus');
  console.log('PASS: shell scrollback preserves toolbar focus');
  await screen.click();

  // A real PTY application with mouse reporting, like an agent's full-screen
  // conversation. Its alternate buffer has no browser-owned scrollback.
  const fixture = `${temp}/conversation.py`;
  const inputLog = `${temp}/conversation-input.bin`;
  await fs.writeFile(inputLog, '');
  await fs.writeFile(fixture, `import os, re, sys, termios, tty
old = termios.tcgetattr(0)
tty.setraw(0)
offset = 100
pending = b''
reporting = True
def draw():
    sys.stdout.write('\\x1b[H\\x1b[2JCONVERSATION_ROW_%03d MOUSE_%s' % (offset, 'ON' if reporting else 'OFF'))
    sys.stdout.flush()
try:
    sys.stdout.write('\\x1b[?1049h\\x1b[?1000h\\x1b[?1006h')
    draw()
    while True:
        data = os.read(0, 1024)
        with open(${JSON.stringify(inputLog)}, 'ab') as log: log.write(data)
        if b'\\x03' in data: break
        pending += data
        while True:
            match = re.search(rb'\\x1b\\[<(\\d+);\\d+;\\d+[Mm]|([mr])', pending)
            if not match: break
            if match[2]:
                reporting = match[2] == b'r'
                sys.stdout.write('\\x1b[?1000h' if reporting else '\\x1b[?1000l')
            else:
                button = int(match[1])
                if button & 64: offset += 1 if button & 1 else -1
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
  await fontControl.focus();
  await page.mouse.wheel(0, -120);
  await until(async () => (await visible()) !== conversation, 'agent scrolls after focus leaves terminal input');
  assert.equal(await fontControl.evaluate(el => el === document.activeElement), true, 'scroll must not steal keyboard focus');
  console.log('PASS: agent scrolls while its toolbar has keyboard focus');
  for (const modifier of ['Control', 'Alt', 'Meta']) {
    const before = await visible();
    await page.keyboard.down(modifier);
    try { await page.mouse.wheel(0, -120); } finally { await page.keyboard.up(modifier); }
    await until(async () => (await visible()) !== before, `${modifier}+wheel reaches the conversation`);
    assert.equal(await fontControl.evaluate(el => el === document.activeElement), true);
    assert.equal(await transform(), cameraTransform, `${modifier}+wheel over xterm must not zoom the canvas`);
  }
  await delay(350);
  assert.deepEqual((await invoke('state.get')).workspaces.find(w => w.id === workspace.id).camera, camera, 'terminal scroll must not pan or zoom the canvas');

  const canvas = await page.locator('.canvas').boundingBox();
  await page.mouse.click(canvas.x + 5, canvas.y + 5);
  await until(async () => !(await page.locator('.canvas-node.selected').count()), 'terminal deselected');
  await page.locator('.canvas').focus();
  const inactiveConversation = await visible();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await until(async () => (await visible()) !== inactiveConversation, 'hovered inactive terminal scrolls');
  assert.equal(await page.locator('.canvas-node.selected').count(), 0, 'scroll does not change selection');
  assert.equal(await page.locator('.canvas').evaluate(el => el === document.activeElement), true, 'wheel preserves canvas keyboard focus');
  console.log('PASS: inactive terminal receives wheel input without changing selection');

  // A separate editor owns the keyboard while wheel stays with the hovered PTY.
  // Keep the note visible to the right of the wheel target without moving camera.
  await invoke('node.create', {
    workspaceId: workspace.id, type: 'note', title: 'Keyboard owner',
    x: (box.x + box.width * .75 - canvas.x - camera.x) / camera.zoom,
    y: (box.y - canvas.y - camera.y) / camera.zoom,
    width: 320, height: 240, data: { text: '' },
  });
  const note = page.getByRole('textbox', { name: 'Nota: Keyboard owner', exact: true });
  await note.waitFor({ state: 'attached' });
  await note.evaluate(el => el.focus({ preventScroll: true }));
  const otherPanelConversation = await visible();
  await page.mouse.wheel(0, -120);
  await until(async () => (await visible()) !== otherPanelConversation, 'conversation scrolls with another panel owning keyboard focus');
  assert.equal(await note.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.canvas-node.selected').count(), 0);
  const beforeNoteTyping = await fs.readFile(inputLog);
  await page.keyboard.type('h v 0');
  assert.equal(await note.inputValue(), 'h v 0');
  await delay(150);
  assert.deepEqual(await fs.readFile(inputLog), beforeNoteTyping, 'another panel must not proxy keyboard input into the PTY');
  assert.equal(await transform(), cameraTransform);
  console.log('PASS: wheel preserves another panel keyboard ownership and canvas selection');

  await terminalNode.getByLabel('Enfocar panel', { exact: true }).click();
  await page.locator('.canvas-node.focused').waitFor();
  await delay(250);
  await fontControl.focus();
  const focusedConversation = await visible();
  const focusedBox = await screen.boundingBox();
  await page.mouse.move(focusedBox.x + focusedBox.width / 2, focusedBox.y + focusedBox.height / 2);
  await page.mouse.wheel(0, -120);
  await until(async () => (await visible()) !== focusedConversation, 'focused panel scrolls without textarea focus');
  assert.equal(await fontControl.evaluate(el => el === document.activeElement), true);
  console.log('PASS: conversation scrolls in focused panel mode');

  // Disable mouse reporting in the real application. Wheel must not become
  // synthetic Up/Down keys, even when the terminal owns keyboard focus.
  await screen.click();
  await page.keyboard.type('m');
  await until(async () => (await visible()).includes('MOUSE_OFF'), 'fixture disables mouse reporting');
  const noMouseView = await visible();
  const noMouseInput = await fs.readFile(inputLog);
  for (const toolbarFocused of [false, true]) {
    if (toolbarFocused) await fontControl.focus();
    await page.mouse.wheel(0, -120);
    await page.mouse.wheel(0, 120);
    await delay(350);
    assert.deepEqual(await fs.readFile(inputLog), noMouseInput, 'alternate-buffer wheel without reporting must not write any keys to the PTY');
    assert.equal(await visible(), noMouseView, 'no simulated conversation scrolling');
  }
  console.log('PASS: alternate buffer without mouse reporting receives no synthetic arrow keys');
  await screen.click();
  await page.keyboard.type('r');
  await until(async () => (await visible()).includes('MOUSE_ON'), 'fixture restores mouse reporting');
  const restoredView = await visible();
  await page.mouse.wheel(0, -120);
  await until(async () => (await visible()) !== restoredView, 'wheel resumes after mouse reporting is restored');
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
