import test from 'node:test';
import assert from 'node:assert/strict';
import { writeOwnedTerminalInput } from './inputOwnership.js';

test('wheel ownership routes to the hovered PTY without granting keyboard ownership or bypassing modal/disconnection guards', async () => {
  const calls = [];
  const options = {
    sessionId: 'hovered-terminal', stream: { canWrite: () => true },
    active: false, element: { contains: () => false }, focusedElement: {},
    invoke: async (method, payload) => calls.push([method, payload]),
    text: '\x1b[<64;12;6M',
  };
  await writeOwnedTerminalInput({ ...options, wheelOwned: true });
  assert.deepEqual(calls, [['terminal.write', { sessionId: 'hovered-terminal', data: options.text }]]);
  // Later keyboard input must still belong to its selected, focused terminal.
  for (const text of [' ', '\x03', '\x1b[A']) {
    assert.equal(writeOwnedTerminalInput({ ...options, text }), null);
  }
  assert.equal(writeOwnedTerminalInput({ ...options, wheelOwned: true, blocked: true }), null);
  assert.equal(writeOwnedTerminalInput({ ...options, wheelOwned: true, stream: { canWrite: () => false } }), null);
  assert.equal(calls.length, 1);
});

test('wheel writes do not relax keyboard ownership for a selected but blurred terminal or an inactive focused terminal', async () => {
  const calls = [], input = {}, otherPanel = {};
  const options = {
    stream: { canWrite: () => true }, sessionId: 'terminal',
    element: { contains: target => target === input },
    invoke: async (method, payload) => calls.push([method, payload]),
  };
  for (const [active, focusedElement] of [[true, otherPanel], [false, input], [false, otherPanel]]) {
    await writeOwnedTerminalInput({ ...options, active, focusedElement, wheelOwned: true, text: '\x1b[<65;1;1M' });
    const count = calls.length;
    for (const text of [' ', '\x03', '\x1b[A', '0', 'h', '\x1b']) {
      assert.equal(writeOwnedTerminalInput({ ...options, active, focusedElement, text }), null);
    }
    assert.equal(calls.length, count);
  }
  await writeOwnedTerminalInput({ ...options, active: true, focusedElement: input, text: 'owned' });
  assert.equal(calls.at(-1)[1].data, 'owned');
  for (const guard of [{ blocked: true }, { stream: { canWrite: () => false } }, { stream: null }]) {
    for (const wheelOwned of [true, false]) {
      assert.equal(writeOwnedTerminalInput({ ...options, active: true, focusedElement: input, text: 'blocked', wheelOwned, ...guard }), null);
    }
  }
  assert.equal(calls.length, 4);
});
