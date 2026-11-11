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
