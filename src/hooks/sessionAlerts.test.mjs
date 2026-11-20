import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionAlert, chatAlertPulse } from './sessionAlerts.mjs';
import { pulseState } from './terminalBorderState.mjs';

const input = { enabled: true, connected: true, identity: 's1', ready: true, pulse: 'pulse-working' };
const step = (previous, patch = {}) => sessionAlert(previous, { ...input, ...patch });

test('initial snapshots and repeated snapshots stay quiet', () => {
  const first = step(null, { pulse: 'pulse-attention' });
  assert.equal(first.alert, '');
  assert.equal(step(first.state, { pulse: 'pulse-attention' }).alert, '');
});

test('alerts on each transition to attention, turn, error and success', () => {
  let state = step(null).state;
  for (const pulse of ['pulse-attention', 'pulse-turn', 'pulse-error', 'pulse-success']) {
    const result = step(state, { pulse });
    assert.equal(result.alert, pulse);
    assert.equal(step(result.state, { pulse }).alert, '');
    state = result.state;
  }
});

test('a later return to the same state is a new transition', () => {
  const initial = step(null, { pulse: 'pulse-turn' });
  const working = step(initial.state);
  assert.equal(working.alert, '');
  assert.equal(step(working.state, { pulse: 'pulse-turn' }).alert, 'pulse-turn');
});

test('activation, disconnection and missing snapshots reset the baseline', () => {
  const initial = step(null);
  for (const patch of [{ enabled: false }, { connected: false }, { ready: false }, { identity: null }]) {
    const reset = step(initial.state, patch);
    assert.equal(reset.state, null);
    assert.equal(step(reset.state, { pulse: 'pulse-error' }).alert, '');
  }
});

test('replacement session establishes a quiet baseline', () => {
  const initial = step(null);
  const replacement = step(initial.state, { identity: 's2', pulse: 'pulse-error' });
  assert.equal(replacement.alert, '');
  assert.equal(step(replacement.state, { identity: 's2', pulse: 'pulse-success' }).alert, 'pulse-success');
});

test('terminal state resolution drives alerts without duplicating snapshots', () => {
  const node = { type: 'terminal', data: {} };
  const working = pulseState(node, { status: 'running', screen: 'working' });
  const waiting = pulseState(node, { status: 'running', screen: 'awaiting_approval' });
  const state = step(null, { pulse: working }).state;
  const changed = step(state, { pulse: waiting });
  assert.equal(changed.alert, 'pulse-attention');
  assert.equal(step(changed.state, { pulse: waiting }).alert, '');
});

test('chat snapshots detect waiting and completed turns even when viewed', () => {
  const node = { type: 'terminal', data: { chat: { provider: 'claude' } } };
  const running = { running: true, messages: [] };
  const waiting = { running: true, messages: [{ parts: [{ type: 'question', status: 'pending' }] }] };
  const done = { running: false, messages: [{ role: 'assistant', status: 'done', parts: [] }] };
  const failure = { running: false, messages: [{ role: 'assistant', status: 'error', parts: [] }] };
  let state = step(null, { pulse: chatAlertPulse(node, running) }).state;
  for (const [snapshot, expected] of [[waiting, 'pulse-attention'], [done, 'pulse-turn'], [failure, 'pulse-error']]) {
    const result = step(state, { pulse: chatAlertPulse(node, snapshot) });
    assert.equal(result.alert, expected);
    state = result.state;
  }
});

test('chat reconnection and provider replacement start from the newly loaded snapshot', () => {
  const node = { type: 'terminal', data: { chat: { provider: 'claude' } } };
  const running = chatAlertPulse(node, { running: true, messages: [] });
  const done = chatAlertPulse(node, { running: false, messages: [{ role: 'assistant', status: 'done' }] });
  const before = step(null, { identity: 'claude:s1', pulse: running });
  const disconnected = step(before.state, { connected: false });
  const reconnected = step(disconnected.state, { identity: 'claude:s1', pulse: done });
  assert.equal(reconnected.alert, '');
  const replacement = step(before.state, { identity: 'codex:s2', pulse: done });
  assert.equal(replacement.alert, '');
  assert.equal(step(replacement.state, { identity: 'codex:s2', pulse: 'pulse-error' }).alert, 'pulse-error');
});
