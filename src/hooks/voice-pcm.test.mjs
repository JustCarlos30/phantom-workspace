import test from 'node:test';
import assert from 'node:assert/strict';
import { resample, floatToPcm16, bytesToBase64, PcmQueue, liveTranscript, MAX_PUSH_BYTES } from './voice-pcm.js';

test('resample keeps duration and identity at the same rate', () => {
  const input = new Float32Array(48000).fill(.5);
  assert.equal(resample(input, 16000), input);
  const output = resample(input, 48000);
  assert.equal(output.length, 16000);
  assert.ok(Math.abs(output[100] - .5) < 1e-6);
});

test('PCM16 is little-endian, clamped and two bytes per sample', () => {
  const bytes = floatToPcm16(new Float32Array([0, 1, -1, 2, -2]));
  assert.equal(bytes.length, 10);
  const view = new DataView(bytes.buffer);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => view.getInt16(i * 2, true)), [0, 32767, -32768, 32767, -32768]);
});

test('base64 round-trips large buffers the host validates strictly', () => {
  const bytes = new Uint8Array(100000).map((_, i) => i % 251);
  const encoded = bytesToBase64(bytes);
  assert.equal(Buffer.from(encoded, 'base64').toString('base64'), encoded);
  assert.deepEqual(new Uint8Array(Buffer.from(encoded, 'base64')), bytes);
});

test('queue hands out ordered, even slices within the host cap', () => {
  const queue = new PcmQueue();
  queue.push(new Uint8Array(50000).fill(1)); queue.push(new Uint8Array(30000).fill(2));
  const first = queue.take();
  assert.equal(first.length, MAX_PUSH_BYTES);
  assert.equal(first[49999], 1); assert.equal(first[50000], 2);
  const rest = queue.take();
  assert.equal(rest.length, 16000); assert.equal(queue.size, 0);
  assert.equal(queue.take().length, 0);
  queue.push(new Uint8Array(10)); assert.equal(queue.take(7).length, 6);
});

test('live transcript separates committed words from the tentative tail', () => {
  assert.deepEqual(liveTranscript({ confirmed: ' hola ', partial: 'mundo ' }), { confirmed: 'hola', partial: 'mundo' });
  assert.deepEqual(liveTranscript(null), { confirmed: '', partial: '' });
});
