import test from 'node:test';
import assert from 'node:assert/strict';
import { createResampler, floatToPCM16, chunkPCM, audioBase64, createPushQueue } from './voiceStream.mjs';

test('resampling preserves phase across callbacks at 48 kHz and 44.1 kHz', () => {
  for (const rate of [48000, 44100, 16000]) {
    const input = Float32Array.from({ length: rate }, (_, i) => Math.sin(i / 20));
    const whole = createResampler(rate)(input, true);
    const resample = createResampler(rate), pieces = [];
    for (let i = 0; i < input.length; i += 4096) pieces.push(...resample(input.slice(i, i + 4096)));
    pieces.push(...resample(new Float32Array(0), true));
    assert.ok(Math.abs(whole.length - 16000) <= 1);
    assert.equal(pieces.length, whole.length);
    pieces.forEach((value, i) => assert.ok(Math.abs(value - whole[i]) < 0.00001));
  }
});

test('PCM16 clips and encodes little endian; chunks preserve all bytes', () => {
  assert.deepEqual([...floatToPCM16(new Float32Array([-2, -1, 0, 1, 2]))], [0, 128, 0, 128, 0, 0, 255, 127, 255, 127]);
  const bytes = Uint8Array.from({ length: 150000 }, (_, i) => i % 256);
  const chunks = chunkPCM(bytes);
  assert.deepEqual(chunks.map(chunk => chunk.length), [64000, 64000, 22000]);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes));
  assert.equal(audioBase64(bytes), Buffer.from(bytes).toString('base64'));
  assert.throws(() => chunkPCM(new Uint8Array(3)));
});

test('queue serializes pushes, drains new audio and assigns strict sequences', async () => {
  let active = 0, maximum = 0;
  const calls = [], responses = [];
  const queue = createPushQueue({ push: async fragment => {
    active++; maximum = Math.max(maximum, active); calls.push(fragment);
    await new Promise(resolve => setTimeout(resolve, 1));
    if (fragment.sequence === 0) queue.enqueue(new Uint8Array(100));
    active--; return fragment.sequence;
  }, onResponse: value => responses.push(value) });
  queue.enqueue(new Uint8Array(150000));
  await Promise.all([queue.flush(), queue.flush()]);
  assert.equal(maximum, 1);
  assert.deepEqual(calls.map(call => call.sequence), [0, 1, 2]);
  assert.deepEqual(responses, [0, 1, 2]);
  assert.equal(calls.reduce((sum, call) => sum + Buffer.from(call.audioBase64, 'base64').length, 0), 150100);
  assert.ok(calls.every(call => Buffer.from(call.audioBase64, 'base64').length <= 64000));
});

test('cancellation drops queued audio and ignores an in-flight response', async () => {
  let resolvePush, calls = 0, responses = 0;
  const queue = createPushQueue({ push: () => { calls++; return new Promise(resolve => { resolvePush = resolve; }); }, onResponse: () => responses++ });
  queue.enqueue(new Uint8Array(128000));
  const pending = queue.flush();
  queue.cancel(); queue.enqueue(new Uint8Array(100)); resolvePush({ text: 'tardío' });
  await pending; await queue.flush();
  assert.equal(calls, 1); assert.equal(responses, 0);
});

test('push failures stop the queue without retrying a sequence', async () => {
  let calls = 0;
  const queue = createPushQueue({ push: async () => { calls++; throw new Error('fallo'); } });
  queue.enqueue(new Uint8Array(128000));
  await assert.rejects(queue.flush(), /fallo/);
  await assert.rejects(queue.flush(), /fallo/);
  assert.equal(calls, 1);
});

test('cancellation ignores an in-flight rejection and permits harmless flushes', async () => {
  let rejectPush, calls = 0;
  const queue = createPushQueue({
    push: () => { calls++; return new Promise((resolve, reject) => { rejectPush = reject; }); },
    onResponse: () => assert.fail('No debe publicar respuestas tras cancelar'),
  });
  queue.enqueue(new Uint8Array(128000));
  const pending = queue.flush();
  queue.cancel();
  rejectPush(new Error('Respuesta tardía'));
  await pending;
  queue.enqueue(new Uint8Array(100));
  await queue.flush();
  assert.equal(calls, 1);
});

test('queue coalesces capture callbacks and resumes sequencing after an idle flush', async () => {
  const calls = [];
  const queue = createPushQueue({ push: async fragment => { calls.push(fragment); } });
  await queue.flush();
  queue.enqueue(new Uint8Array([1, 2]));
  queue.enqueue(new Uint8Array([3, 4]));
  await queue.flush();
  queue.enqueue(new Uint8Array([5, 6]));
  await queue.flush();
  assert.deepEqual(calls.map(call => call.sequence), [0, 1]);
  assert.deepEqual(calls.map(call => [...Buffer.from(call.audioBase64, 'base64')]), [[1, 2, 3, 4], [5, 6]]);
});

test('a final flush drains audio appended before an empty flush settles', async () => {
  const calls = [];
  const queue = createPushQueue({ push: async fragment => { calls.push(fragment); } });
  const idle = queue.flush();
  queue.enqueue(new Uint8Array([1, 2]));
  await queue.flush();
  assert.deepEqual(calls.map(call => [...Buffer.from(call.audioBase64, 'base64')]), [[1, 2]]);
  await idle;
});

test('a final flush rechecks audio appended as the previous push settles', async () => {
  let resolvePush;
  const calls = [];
  const queue = createPushQueue({ push: fragment => {
    calls.push(fragment);
    return fragment.sequence === 0 ? new Promise(resolve => { resolvePush = resolve; }) : Promise.resolve();
  } });
  queue.enqueue(new Uint8Array([1, 2]));
  const first = queue.flush();
  resolvePush();
  // The drain loop completes in the next microtask, before its finally runs.
  await Promise.resolve();
  queue.enqueue(new Uint8Array([3, 4]));
  await queue.flush();
  assert.deepEqual(calls.map(call => call.sequence), [0, 1]);
  assert.deepEqual(calls.map(call => [...Buffer.from(call.audioBase64, 'base64')]), [[1, 2], [3, 4]]);
  await first;
});
