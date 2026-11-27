import test from 'node:test';
import assert from 'node:assert/strict';
import { pulseState, PIXEL_KIND } from './terminalBorderState.mjs';
import { sessionState } from './activityModel.mjs';

const node = { type: 'terminal', data: {} };
const resolve = session => pulseState(node, session);

test('only a process exited with numeric zero announces success', () => {
  assert.equal(resolve({ status: 'exited', exitCode: 0 }), 'pulse-success');
  for (const exitCode of [undefined, null, '', '0', '7', false, true, NaN, Infinity, -Infinity, {}, []]) {
    assert.equal(resolve({ status: 'exited', exitCode }), '', `Unknown code ${String(exitCode)}`);
  }
  for (const status of ['running', 'unknown', undefined]) {
    assert.equal(resolve({ status, exitCode: 0 }), '');
  }
});

test('terminated sessions outrank stale working, approval, review and agent errors', () => {
  for (const agentState of ['working', 'awaiting_approval', 'review', 'failed']) {
    const stale = { agentState, screen: 'working', needsYou: true };
    assert.equal(resolve({ ...stale, status: 'exited', exitCode: 0 }), 'pulse-success');
    assert.equal(resolve({ ...stale, status: 'exited', exitCode: 7 }), 'pulse-error');
    assert.equal(resolve({ ...stale, status: 'exited' }), '');
    assert.equal(resolve({ ...stale, status: 'lost', exitCode: 0 }), 'pulse-error');
  }
});

test('success is revoked when the same session changes to unknown, lost or a new running turn', () => {
  const session = { status: 'running', agentState: 'working', screenState: 'working' };
  assert.equal(resolve(session), 'pulse-working');
  Object.assign(session, { status: 'exited', exitCode: 0 });
  assert.equal(resolve(session), 'pulse-success');
  session.exitCode = undefined;
  assert.equal(resolve(session), '');
  Object.assign(session, { status: 'lost', exitCode: 0 });
  assert.equal(resolve(session), 'pulse-error');
  Object.assign(session, { status: 'running', agentState: 'review' });
  assert.equal(resolve(session), 'pulse-turn');
  session.agentState = 'working';
  assert.equal(resolve(session), 'pulse-working');
});

test('real process and declared agent failures are red before attention or work', () => {
  for (const exitCode of [-1, 1, 7, 137]) assert.equal(resolve({ status: 'exited', exitCode }), 'pulse-error');
  for (const agentState of ['failed', 'error']) {
    assert.equal(resolve({ status: 'running', agentState, needsYou: true, screen: 'awaiting_approval' }), 'pulse-error');
    assert.equal(pulseState({ ...node, data: { agent: { status: agentState } } }, { status: 'running' }), 'pulse-error');
    assert.equal(resolve({ status: 'running', agent: { status: agentState } }), 'pulse-error');
  }
});

test('approval and intervention stay amber before working', () => {
  for (const agentState of ['blocked', 'needs_input', 'awaiting_input', 'waiting_for_input', 'awaiting_approval', 'needs_approval']) {
    assert.equal(resolve({ status: 'running', agentState, screen: 'working' }), 'pulse-attention');
  }
  assert.equal(resolve({ status: 'running', agentState: 'working', screen: 'awaiting_approval' }), 'pulse-attention');
});

test('raw host screen signals and actual activity projection preserve precedence', () => {
  const project = session => ({ ...session, ...sessionState(session) });
  for (const screenState of ['working', 'awaiting_approval', 'awaiting_input']) {
    const session = { status: 'running', agent: { status: 'working' }, screenState };
    const expected = { working: 'pulse-working', awaiting_approval: 'pulse-attention', awaiting_input: 'pulse-turn' }[screenState];
    assert.equal(resolve(session), expected);
    assert.equal(resolve(project(session)), expected);
    for (const [status, exitCode, pulse] of [['exited', 0, 'pulse-success'], ['exited', 9, 'pulse-error'], ['exited', undefined, ''], ['lost', 0, 'pulse-error']]) {
      assert.equal(resolve(project({ ...session, status, exitCode })), pulse);
    }
  }
  assert.equal(resolve(project({ status: 'running', agent: { status: 'error' }, screenState: 'awaiting_approval' })), 'pulse-error');
});

test('review asks for a turn; finished agents yield to a working screen', () => {
  for (const agentState of ['review', 'waiting']) {
    assert.equal(resolve({ status: 'running', agentState, screen: 'working', exitCode: 0 }), 'pulse-turn');
  }
  for (const agentState of ['done', 'completed', 'finished']) {
    assert.equal(resolve({ status: 'running', agentState, screen: 'working' }), 'pulse-working');
    assert.equal(resolve({ status: 'running', agentState, needsYou: true }), 'pulse-success');
  }
  assert.equal(resolve({ status: 'running', needsYou: true }), 'pulse-turn');
  assert.equal(resolve({ status: 'running', agentState: 'working' }), 'pulse-working');
});

const withRun = (phase, status) => ({ type: 'terminal', data: { agent: { status, run: { phase } } } });

test('a completed Phantom run announces success while the screen is idle', () => {
  assert.equal(pulseState(withRun('completed'), { status: 'running' }), 'pulse-success');
  assert.equal(pulseState(withRun('completed', 'idle'), { status: 'running', needsYou: true }), 'pulse-success');
  assert.equal(pulseState(withRun(undefined, 'done'), { status: 'running' }), 'pulse-success');
});

test('a completed run still yields to approval, input, errors and work in progress', () => {
  assert.equal(pulseState(withRun('completed'), { status: 'running', screenState: 'awaiting_approval' }), 'pulse-attention');
  assert.equal(pulseState(withRun('completed'), { status: 'running', screen: 'awaiting_input' }), 'pulse-turn');
  assert.equal(pulseState(withRun('completed'), { status: 'running', agentState: 'needs_approval' }), 'pulse-attention');
  assert.equal(pulseState(withRun('completed'), { status: 'running', agentState: 'failed' }), 'pulse-error');
  assert.equal(pulseState(withRun('completed'), { status: 'running', screen: 'working' }), 'pulse-working');
});

test('a blocked run is attention and a cancelled run is not finished', () => {
  assert.equal(pulseState(withRun('blocked'), { status: 'running' }), 'pulse-attention');
  assert.equal(pulseState(withRun('blocked', 'done'), { status: 'running', screen: 'working' }), 'pulse-attention');
  assert.equal(pulseState(withRun('cancelled'), { status: 'running' }), '');
  assert.equal(pulseState(withRun('cancelled', 'done'), { status: 'running' }), '');
});

test('chat owns its signal independently of PTY completion; other panels stay neutral', () => {
  const chat = { type: 'terminal', data: { chat: { provider: 'claude' } } };
  for (const pulse of ['', 'pulse-working', 'pulse-attention', 'pulse-turn', 'pulse-error', 'pulse-success']) {
    assert.equal(pulseState(chat, { status: 'exited', exitCode: 0 }, pulse), pulse);
  }
  assert.equal(pulseState(chat, { status: 'lost' }), '');
  assert.equal(pulseState({ type: 'note' }, { status: 'exited', exitCode: 0 }), '');
  assert.equal(resolve(undefined), '');
  assert.equal(resolve({ status: 'running', agentState: 'unrecognized' }), '');
});

test('PixelField preserves its signal mapping and adds a distinct green emission', () => {
  assert.deepEqual(PIXEL_KIND, { 'pulse-attention': 'call', 'pulse-turn': 'turn', 'pulse-error': 'error', 'pulse-success': 'success', 'pulse-working': 'work' });
});
