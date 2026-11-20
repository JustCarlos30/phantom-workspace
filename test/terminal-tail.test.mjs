import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { createHost } from '../host/server.mjs';
import { detectAgent, tailLines, screenSignal, nextScreenState } from '../host/terminals.mjs';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');
async function until(fn, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 30)); } throw new Error('Timed out'); }
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));

const rendererImports = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './useWorkspace' && context.parentURL === new URL('../src/hooks/useTerminalTail.js', import.meta.url).href) {
      return { url: 'data:text/javascript,export const subscribe = () => () => {};', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
let shareTerminalTail, shouldResetTerminalTail;
try {
  ({ shareTerminalTail, shouldResetTerminalTail } = await import('../src/hooks/useTerminalTail.js'));
} finally {
  rendererImports.deregister();
}

test('the same terminal session does not reset the tail', () => {
  assert.equal(shouldResetTerminalTail('session-a', 'session-a'), false);
});

test('a different terminal session resets the tail', () => {
  assert.equal(shouldResetTerminalTail('session-a', 'session-b'), true);
  assert.equal(shouldResetTerminalTail('session-a', null), true);
  assert.equal(shouldResetTerminalTail(null, 'session-a'), true);
});

test('identical terminal tails retain the previous reference', () => {
  const previous = { lines: ['hello', '> '], screenState: 'awaiting_input', foreground: { command: 'bash', shell: true } };
  assert.equal(shareTerminalTail(previous, structuredClone(previous)), previous);
});

for (const [field, value] of Object.entries({ lines: ['changed'], screenState: 'working', foreground: { command: 'codex', shell: false } })) {
  test(`a change in terminal tail ${field} produces a new reference`, () => {
    const previous = { lines: ['hello', '> '], screenState: 'awaiting_input', foreground: { command: 'bash', shell: true } };
    const next = { ...structuredClone(previous), [field]: value };
    const shared = shareTerminalTail(previous, next);
    assert.notEqual(shared, previous);
    assert.deepEqual(shared, next);
  });
}

test('detectAgent recognises agent CLIs by comm, argv and install path', () => {
  assert.equal(detectAgent('opencode', ['opencode']), 'OpenCode');
  assert.equal(detectAgent('claude', ['claude']), 'Claude Code');
  assert.equal(detectAgent('node', ['node', '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js']), 'Claude Code');
  assert.equal(detectAgent('node', ['node', '/home/u/.npm/bin/codex.js']), 'Codex');
  assert.equal(detectAgent('bash', ['/bin/bash']), null);
  assert.equal(detectAgent('npm', ['npm', 'test']), null);
});

test('tailLines rejoins soft wraps, drops trailing blanks and returns the alternate screen', async () => {
  const terminal = new Terminal({ cols: 10, rows: 6, allowProposedApi: true });
  await write(terminal, 'one\r\ntwo\r\n0123456789abcdef\r\n\r\n');
  assert.deepEqual(tailLines(terminal, 2), { screen: 'normal', lines: ['two', '0123456789abcdef'] });
  assert.deepEqual(tailLines(terminal, 9).lines, ['one', 'two', '0123456789abcdef']);
  await write(terminal, '\x1b[?1049h\x1b[2J\x1b[2;1HTUI top\x1b[4;1H> input');
  assert.deepEqual(tailLines(terminal, 2), { screen: 'alternate', lines: ['TUI top', '', '> input'] });
  terminal.dispose();
});

test('terminal.tail reads live PTY text without ANSI and replays closed snapshots', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-tail-'));
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: root });
  const { session } = await host.invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' });
  await host.invoke('terminal.write', { sessionId: session.id, data: "printf '\\033[32mTAIL_GREEN\\033[0m\\n'\n" });
  const live = await until(async () => { const tail = await host.invoke('terminal.tail', { sessionId: session.id, lines: 4 }); return tail.lines.includes('TAIL_GREEN') ? tail : null; });
  assert.equal(live.status, 'running');
  assert.equal(live.screen, 'normal');
  assert.ok(live.lines.length <= 4);
  assert.ok(live.lines.every(line => !line.includes('\x1b')));
  assert.equal(live.foreground.shell, true);
  assert.equal(live.foreground.agent, null);
  await assert.rejects(host.invoke('terminal.tail', { sessionId: session.id, lines: 0 }), /line count/);
  await host.invoke('terminal.stop', { sessionId: session.id });
  await until(() => host.terminals.get(session.id).status === 'exited');
  const closed = await host.invoke('terminal.tail', { sessionId: session.id });
  assert.equal(closed.status, 'exited');
  assert.equal(closed.foreground, null);
  assert.ok(closed.lines.includes('TAIL_GREEN'));
});

test('screenSignal reads whose turn it is from visible agent chrome', () => {
  assert.equal(screenSignal(['✻ Thinking… (12s · esc to interrupt)', '> ']), 'working');
  assert.equal(screenSignal(['• Working (3s • Esc to interrupt)']), 'working');
  assert.equal(screenSignal([' Bash command', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No']), 'awaiting_approval');
  assert.equal(screenSignal(['Overwrite config? [y/N]']), 'awaiting_approval');
  assert.equal(screenSignal(['Permission required', 'Allow once   Allow always   Reject']), 'awaiting_approval');
  assert.equal(screenSignal(['Accessing workspace: /home/carlosj/project', '', 'Quick safety check: Is this a project you created or one you trust?', '', '❯ No, exit', '  Yes, I trust this folder', 'Enter to confirm · Esc to cancel']), 'awaiting_approval');
  assert.equal(screenSignal(['> ', '  ? for shortcuts']), null);
  // An old prompt scrolled far above the recent rows is not a live question.
  assert.equal(screenSignal(['Continue? (y/n)', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)]), null);
});

test('nextScreenState hands the turn over only after the agent was active', () => {
  assert.equal(nextScreenState(null, null, 'Claude Code'), null);
  assert.equal(nextScreenState('working', null, 'Claude Code'), 'awaiting_input');
  assert.equal(nextScreenState('awaiting_approval', null, 'Codex'), 'awaiting_input');
  assert.equal(nextScreenState('working', null, null), null);
  assert.equal(nextScreenState('awaiting_input', 'working', 'Claude Code'), 'working');
});
