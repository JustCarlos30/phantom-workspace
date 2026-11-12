import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSocketOutput } from '../host/socket-output.mjs';

test('twenty noisy terminals resynchronize after a slow reader without disconnecting or losing RPC results', () => {
  const socket = new EventEmitter();
  socket.writableLength = 0; socket.destroyed = false;
  const sent = [];
  socket.write = line => { sent.push(JSON.parse(line)); socket.writableLength += Buffer.byteLength(line); };
  socket.destroy = () => { socket.destroyed = true; };
  const send = createSocketOutput(socket, {highWater: 1024});
  for (let seq = 1; seq <= 100; seq++) for (let n = 0; n < 20; n++) send({event: {type: 'terminal.output', sessionId: String(n), workspaceId: 'workspace', seq, data: 'x'.repeat(128)}});
  const queued = socket.writableLength;
  assert.ok(queued < 1400, `live output stayed bounded: ${queued}`);
  send({id: 'control', result: {ok: true}});
  assert.equal(socket.destroyed, false);
  assert.ok(sent.some(message => message.id === 'control'));
  const resyncs = [];
  while (resyncs.length < 20) {
    const before = sent.length; socket.writableLength = 0; socket.emit('drain');
    resyncs.push(...sent.slice(before).filter(message => message.event?.type === 'terminal.resync'));
    assert.ok(sent.length > before);
  }
  assert.equal(new Set(resyncs.map(message => message.event.sessionId)).size, 20);
  assert.ok(resyncs.every(message => message.event.seq === 100));
  assert.equal(socket.destroyed, false);
  socket.writableLength = 0;
  send({event: {type: 'terminal.output', sessionId: '0', seq: 101, data: 'resumed'}});
  assert.equal(sent.at(-1).event.data, 'resumed');
});
