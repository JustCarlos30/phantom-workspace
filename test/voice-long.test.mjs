import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleVoice, shutdownVoice } from '../integrations/voice.mjs';
import { streamTiming } from '../integrations/voice-stream.mjs';
import { createSpool, appendSpool, readSegment, commitSegment, destroySpool, SEGMENT_SECONDS } from '../integrations/voice-upload.mjs';
import { createDictationSession, MAX_PENDING_BYTES } from '../src/hooks/voice-backup.mjs';
import { bytesToBase64 } from '../src/hooks/voice-pcm.js';
import { validateInvocation } from '../desktop/security.mjs';
import { requestTimeout } from '../desktop/host-client.mjs';

// Everything here uses fake engines and simulated audio time: no GPU, model, network or microphone.
// "Ten minutes" means 600 s of PCM pushed in 2 s fragments, not ten minutes of wall clock.
const CHUNK = 64000; // 2 s of PCM16 mono 16 kHz, the host's per-push cap
const MINUTES = 10, CHUNKS = MINUTES * 30;

const ENGINE = String.raw`
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const failAt = arg('--fail-push') === null ? Infinity : Number(arg('--fail-push')), log = arg('--log');
let pushes = 0, words = [];
console.log(JSON.stringify({ ready: true }));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  const reply = body => console.log(JSON.stringify({ id: request.id, ...body }));
  if (request.type === 'reset') { pushes = 0; words = []; reply({ result: { text: '', confirmed: '', partial: '' } }); continue; }
  const bytes = Buffer.from(request.audioBase64 || '', 'base64').length;
  if (request.type === 'push' && pushes >= failAt) { reply({ error: 'motor roto' }); continue; }
  if (log) appendFileSync(log, bytes + '\n');
  if (request.type === 'push') words.push(('t' + pushes++).padEnd(120, 'x'));
  const text = words.join(' ');
  reply({ result: { text, confirmed: text, partial: '' } });
}
`;

const CLI = String.raw`
import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
const [, , input, outDir] = process.argv, dir = process.env.FAKE_STT_DIR;
if (existsSync(path.join(dir, 'fail-always'))) { console.error('boom'); process.exit(1); }
if (existsSync(path.join(dir, 'fail-once'))) { rmSync(path.join(dir, 'fail-once')); console.error('boom'); process.exit(1); }
const wav = readFileSync(input), size = wav.length - 44;
const valid = wav.toString('latin1', 0, 4) === 'RIFF' && wav.toString('latin1', 8, 16) === 'WAVEfmt ' && wav.readUInt16LE(22) === 1
  && wav.readUInt32LE(24) === 16000 && wav.readUInt32LE(40) === size && wav.readUInt32LE(4) === 36 + size && size > 0 && size <= 960000;
if (!valid) { writeFileSync(path.join(outDir, 'transcript.txt'), 'BADWAV'); process.exit(0); }
const pcm = wav.subarray(44);
appendFileSync(path.join(dir, 'pcm.bin'), pcm);
let silent = true;
for (let i = 0; i < pcm.length; i += 2) if (pcm.readInt16LE(i) !== 0) { silent = false; break; }
writeFileSync(path.join(outDir, 'transcript.txt'), silent ? '' : '[' + pcm.readInt16LE(0) + '-' + pcm.readInt16LE(pcm.length - 2) + ':' + pcm.length / 2 + ']');
`;

async function fixture(t, { stream = true, engineArgs = [] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-voice-long-'));
  const previous = process.env.FAKE_STT_DIR;
  const cwd = path.join(root, 'project'), dataDir = path.join(root, 'data'), work = path.join(root, 'work');
  await mkdir(cwd); await mkdir(work); await mkdir(path.join(dataDir, 'voice-runtime'), { recursive: true });
  process.env.FAKE_STT_DIR = work;
  const timing = { ...streamTiming };
  t.after(async () => {
    await shutdownVoice();
    Object.assign(streamTiming, timing);
    if (previous === undefined) delete process.env.FAKE_STT_DIR; else process.env.FAKE_STT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const engine = path.join(root, 'engine.mjs'), cli = path.join(root, 'cli.mjs'), log = path.join(work, 'engine.log');
  await writeFile(engine, ENGINE); await writeFile(cli, CLI);
  const config = { schemaVersion: 1, engine: 'faster-whisper', model: 'fake', device: 'cpu', computeType: 'int8', argv: [process.execPath, cli, '{input}', '{outputDir}'] };
  if (stream) config.streamArgv = [process.execPath, engine, '--log', log, ...engineArgs];
  await writeFile(path.join(dataDir, 'voice-runtime', 'config.json'), JSON.stringify(config), { mode: 0o600 });
  const workspace = { id: randomUUID(), canonicalPath: cwd };
  const other = { id: randomUUID(), canonicalPath: cwd };
  const context = { dataDir, state: { settings: { voiceFillers: 'keep' } }, workspace, getWorkspace: id => [workspace, other].find(item => item.id === id) ?? null };
  const calls = [];
  const api = async (method, payload) => { calls.push(method); return (await handleVoice(method, payload, context)).result; };
  const events = { live: [], notices: [], modes: [], overflow: 0, unavailable: [] };
  const session = () => createDictationSession({ api, workspaceId: workspace.id, onLive: value => events.live.push(value), onNotice: value => events.notices.push(value),
    onMode: value => events.modes.push(value), onOverflow: () => events.overflow++, onUnavailable: value => events.unavailable.push(value) });
  const spoolDir = path.join(dataDir, 'voice-spool');
  const spools = async () => (await readdir(spoolDir).catch(() => [])).length;
  const engineBytes = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).reduce((sum, line) => sum + Number(line), 0);
  const heardAudio = () => readFile(path.join(work, 'pcm.bin')).catch(() => Buffer.alloc(0));
  return { root, work, context, workspace, other, api, calls, events, session, spools, engineBytes, heardAudio };
}

// Chunk k carries the constant sample value valueOf(k) so any loss, repeat or reorder is detectable.
const makeAudio = (count, valueOf = k => 1 + k) => Array.from({ length: count }, (_, k) => {
  const chunk = Buffer.alloc(CHUNK);
  const value = valueOf(k);
  for (let i = 0; i < CHUNK; i += 2) chunk.writeInt16LE(value, i);
  return chunk;
});

// Emulates microphone callbacks of 4000 bytes and one pump per 2 s of audio.
async function dictate(ctl, chunks) {
  await ctl.state.ready;
  let maxPending = 0;
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.length; offset += 4000) ctl.write(new Uint8Array(chunk.subarray(offset, offset + 4000)));
    maxPending = Math.max(maxPending, ctl.pending);
    await ctl.pump();
  }
  return maxPending;
}

const tokens = text => [...text.matchAll(/t(\d+)x+/g)].map(match => Number(match[1]));
const range = count => Array.from({ length: count }, (_, k) => k);
const eventually = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await new Promise(resolve => setTimeout(resolve, 20)); }
  return check();
};

test('spool: 12 minutes (23 MB) come back as independent WAV segments, in order, with no loss or repeat', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-spool-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const spool = await createSpool(root);
  const parts = [];
  for (let k = 0; k < 360; k++) { const chunk = Buffer.alloc(CHUNK, k % 251); parts.push(chunk); assert.equal(await appendSpool(spool, chunk), true); }
  const original = Buffer.concat(parts);
  assert.ok(original.length > 10 * 1024 * 1024 * 2);
  const recovered = [];
  let segment, count = 0;
  while ((segment = await readSegment(spool))) {
    const size = segment.wav.length - 44;
    assert.equal(segment.wav.toString('latin1', 0, 4), 'RIFF');
    assert.equal(segment.wav.readUInt32LE(40), size);
    assert.ok(size > 0 && size <= SEGMENT_SECONDS * 32000);
    // A segment that is not committed is read again identically (retry after a failure).
    assert.equal(Buffer.compare((await readSegment(spool)).wav, segment.wav), 0);
    recovered.push(segment.wav.subarray(44)); commitSegment(spool, segment); count++;
    if (segment.last) break;
  }
  assert.ok(count >= 24);
  assert.equal(Buffer.compare(Buffer.concat(recovered), original), 0);
  assert.equal(await readSegment(spool), null);
  await destroySpool(spool);
  assert.deepEqual(await readdir(root), []);
});

// In-memory file handle with injectable short writes/reads, zero progress and failures.
// `store: false` keeps only the size (reads synthesize a position-derived pattern), so
// crossing gigabytes costs no memory or disk.
const pattern = position => position % 251;
function fakeDisk({ maxWrite = Infinity, maxRead = Infinity, store = true, write, read } = {}) {
  let data = Buffer.alloc(0), size = 0;
  const calls = { write: 0, read: 0 };
  const handle = {
    async write(buffer, offset, length, position) {
      calls.write++;
      if (write) { const outcome = write(calls.write, length); if (outcome) return outcome; }
      const n = Math.min(length, maxWrite);
      if (store) {
        if (data.length < position + n) { const grown = Buffer.alloc(Math.max(data.length * 2, position + n)); data.copy(grown); data = grown; }
        buffer.copy(data, position, offset, offset + n);
      }
      size = Math.max(size, position + n);
      return { bytesWritten: n };
    },
    async read(buffer, offset, length, position) {
      calls.read++;
      if (read) { const outcome = read(calls.read, length); if (outcome) return outcome; }
      const n = Math.max(0, Math.min(length, maxRead, size - position));
      for (let i = 0; i < n; i++) buffer[offset + i] = store ? data[position + i] : pattern(position + i);
      return { bytesRead: n };
    },
    async close() {},
  };
  return { handle, calls, get size() { return size; } };
}
const withFake = async (t, disk, now) => {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-spool-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return createSpool(root, { io: { open: async () => disk.handle, ...(now ? { now } : {}) } });
};

test('spool: no total ceiling — crossing the old 1 GiB limit keeps appending and reading back correctly', async t => {
  const disk = fakeDisk({ store: false });
  const spool = await withFake(t, disk);
  const block = Buffer.alloc(32 * 1024 * 1024);
  for (let k = 0; k < 33; k++) assert.equal(await appendSpool(spool, block), true);
  assert.equal(spool.bytes, 33 * block.length);
  assert.ok(spool.bytes > 1024 ** 3);
  assert.equal(spool.full, false);
  assert.equal(spool.error, null);
  // Audio recorded after the former threshold is read back intact, in a final independent segment.
  spool.offset = 1024 ** 3 + 2;
  const segment = await readSegment(spool);
  assert.ok(segment.wav.length - 44 <= SEGMENT_SECONDS * 32000);
  const first = spool.offset;
  assert.equal(segment.wav[44], pattern(first));
  assert.equal(segment.wav[45], pattern(first + 1));
  spool.offset = spool.bytes - 100000;
  const last = await readSegment(spool);
  assert.equal(last.last, true);
  assert.equal(last.wav.length - 44, 100000);
  assert.equal(last.wav[44 + 99999], pattern(spool.bytes - 1));
  await destroySpool(spool);
});

test('spool: short writes and short reads are completed; only bytes actually written are counted', async t => {
  const disk = fakeDisk({ maxWrite: 997, maxRead: 1013 });
  const spool = await withFake(t, disk);
  const original = Buffer.alloc(3 * CHUNK + 4000);
  for (let i = 0; i < original.length; i++) original[i] = (i * 7 + 3) % 256;
  for (let offset = 0; offset < original.length; offset += CHUNK) assert.equal(await appendSpool(spool, original.subarray(offset, offset + CHUNK)), true);
  assert.equal(spool.bytes, original.length);
  assert.equal(disk.size, original.length);
  assert.ok(disk.calls.write > original.length / 997 - 1);
  const recovered = [];
  for (let segment; (segment = await readSegment(spool));) { recovered.push(segment.wav.subarray(44)); commitSegment(spool, segment); if (segment.last) break; }
  assert.equal(Buffer.compare(Buffer.concat(recovered), original), 0);
  assert.ok(disk.calls.read > original.length / 1013 - 1);
  await destroySpool(spool);
});

test('spool: zero-progress or failing writes mark the copy incomplete without counting phantom bytes', async t => {
  const stalled = await withFake(t, fakeDisk({ write: () => ({ bytesWritten: 0 }) }));
  await assert.rejects(appendSpool(stalled, Buffer.alloc(100)), /sin progreso/);
  assert.equal(stalled.bytes, 0);
  assert.equal(stalled.full, true);
  assert.match(stalled.error, /sin progreso/);
  assert.equal(await appendSpool(stalled, Buffer.alloc(100)), false);
  assert.equal(stalled.bytes, 0);
  await destroySpool(stalled);

  // The disk accepts part of a chunk and then reports ENOSPC: the chunk is not counted, the error survives.
  const failing = await withFake(t, fakeDisk({ write: call => (call === 1 ? { bytesWritten: 3 } : call === 2 ? (() => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); })() : null) }));
  await appendSpool(failing, Buffer.alloc(10)).then(() => assert.fail('should reject'), error => assert.equal(error.code, 'ENOSPC'));
  assert.equal(failing.bytes, 0);
  assert.equal(failing.full, true);
  assert.match(failing.error, /ENOSPC/);
  assert.equal(await readSegment(failing), null, 'nothing is readable from a chunk that did not fully land');
  await destroySpool(failing);

  // An absurd bytesWritten is a broken disk, not progress.
  const liar = await withFake(t, fakeDisk({ write: () => ({ bytesWritten: 999 }) }));
  await assert.rejects(appendSpool(liar, Buffer.alloc(10)), /sin progreso/);
  assert.equal(liar.bytes, 0);
  await destroySpool(liar);
});

test('spool: unexpected EOF, zero-progress reads and disk errors never yield zero-filled audio', async t => {
  const disk = fakeDisk();
  const spool = await withFake(t, disk);
  await appendSpool(spool, Buffer.alloc(64000, 5));
  // File shorter than recorded (lost audio): EOF mid-segment.
  spool.bytes = 64000 + 2000;
  await assert.rejects(readSegment(spool), /truncado/);
  assert.equal(spool.offset, 0, 'a failed segment is not committed');
  spool.bytes = 64000;
  const ok = await readSegment(spool);
  assert.equal(ok.wav.length - 44, 64000);
  assert.equal(ok.wav[44], 5);
  await destroySpool(spool);

  const stalled = await withFake(t, fakeDisk({ read: () => ({ bytesRead: 0 }) }));
  stalled.bytes = 4000;
  await assert.rejects(readSegment(stalled), /truncado/);
  await destroySpool(stalled);

  const broken = await withFake(t, fakeDisk({ read: () => { throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }); } }));
  broken.bytes = 4000;
  await assert.rejects(readSegment(broken), /EIO/);
  await destroySpool(broken);
});

test('spool sweep: orphans are removed but a live, long-running session is never swept', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-spool-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const HOUR = 3_600_000, start = Date.now();
  const live = await createSpool(root);
  await appendSpool(live, Buffer.alloc(3200, 1));
  const orphan = path.join(root, 'voice-spool-orphan'), writing = path.join(root, 'voice-spool-writing'), foreign = path.join(root, 'notes');
  for (const dir of [orphan, writing, foreign]) { await mkdir(dir); await writeFile(path.join(dir, 'audio.pcm'), 'x'); }
  // A directory whose own mtime is ancient but whose audio file was written an hour ago.
  await utimes(writing, new Date(start - 48 * HOUR), new Date(start - 48 * HOUR));
  await utimes(path.join(writing, 'audio.pcm'), new Date(start + 29 * HOUR), new Date(start + 29 * HOUR));
  // 30 hours later by the simulated clock: the live session's directory mtime looks 30 h old.
  const later = { io: { now: () => start + 30 * HOUR } };
  const next = await createSpool(root, later);
  const names = await readdir(root);
  assert.ok(names.includes(path.basename(live.dir)), 'the active session survives however old its mtime looks');
  assert.ok(names.includes('voice-spool-writing'), 'a spool with a recently written file survives');
  assert.ok(names.includes('notes'), 'foreign directories are never touched');
  assert.equal(names.includes('voice-spool-orphan'), false, 'a real orphan is swept');
  // The live session keeps working and its audio is intact.
  assert.equal(await appendSpool(live, Buffer.alloc(3200, 2)), true);
  assert.equal((await readSegment(live)).wav.length - 44, 6400);
  await destroySpool(next);
  await destroySpool(live);
  assert.equal((await readdir(root)).includes(path.basename(live.dir)), false);
});

test('the client reports a disk-truncated backup as incomplete, with the disk error, and never as a full dictation', async () => {
  const calls = [];
  const api = async (method, payload) => {
    calls.push(method);
    if (method === 'voice.stream.start') return { sessionId: 's' };
    if (method === 'voice.stream.push') return { degraded: true, reason: 'motor roto', text: '', confirmed: '', partial: '' };
    if (method === 'voice.stream.finish') return { degraded: true, complete: false, diskError: 'ENOSPC: no space', bytes: 64000, text: '', confirmed: '', partial: '' };
    if (method === 'voice.stream.recover') return { index: payload.index, text: 'prefijo', done: true };
    return {};
  };
  const ctl = createDictationSession({ api, workspaceId: 'w' });
  await dictate(ctl, makeAudio(1));
  const outcome = await ctl.finish();
  assert.equal(outcome.text, 'prefijo');
  assert.match(outcome.error, /ENOSPC/);
  assert.match(outcome.error, /incompleta/);
  assert.ok(calls.includes('voice.stream.recover'), 'the saved prefix is still transcribed');
});

test('a 10-minute live dictation (19 MB, 300 pushes, >32768 characters) is never cut and keeps every word once, in order', async t => {
  const f = await fixture(t);
  const ctl = f.session();
  const chunks = makeAudio(CHUNKS);
  const maxPending = await dictate(ctl, chunks);
  assert.ok(maxPending <= CHUNK, `pending audio stays at one fragment, saw ${maxPending}`);
  const outcome = await ctl.finish();
  assert.equal(outcome.error, undefined);
  assert.ok(outcome.text.length > 32768, `text has ${outcome.text.length} characters`);
  assert.deepEqual(tokens(outcome.text), range(CHUNKS));
  assert.equal(await f.engineBytes(), CHUNKS * CHUNK);
  assert.ok(CHUNKS * CHUNK > 10 * 1024 * 1024);
  assert.equal(f.calls.filter(method => method === 'voice.stream.push').length, CHUNKS);
  assert.equal(f.calls.includes('voice.stream.cancel'), false, 'no automatic stop or cancel');
  assert.equal(f.calls.includes('voice.stream.recover'), false);
  assert.deepEqual(f.events.modes, ['preparing', 'live']);
  assert.equal(f.events.live.at(-1).confirmed, outcome.text);
  // Resources are released after finish.
  assert.equal(await f.spools(), 0);
  await assert.rejects(f.api('voice.stream.push', { workspaceId: f.workspace.id, sessionId: ctl.state.id, sequence: CHUNKS, audioBase64: bytesToBase64(new Uint8Array(4)) }), /no encontrada/);
});

test('finish drains audio still queued so the last words are not lost', async t => {
  const f = await fixture(t);
  const ctl = f.session();
  await ctl.state.ready;
  for (const chunk of makeAudio(3)) ctl.write(new Uint8Array(chunk));
  ctl.write(new Uint8Array(30000));
  const outcome = await ctl.finish();
  assert.equal(await f.engineBytes(), 3 * CHUNK + 30000);
  assert.deepEqual(tokens(outcome.text), [0, 1, 2, 3]);
});

test('late engine failure after 5 minutes: the whole dictation is recovered from disk segments, once and in order', async t => {
  const f = await fixture(t, { engineArgs: ['--fail-push', '150'] });
  const ctl = f.session();
  // Chunks 30-49 are a 40 s silence: a whole segment without speech must not fail the recovery.
  const chunks = makeAudio(CHUNKS, k => (k >= 30 && k < 50 ? 0 : 1 + k));
  await dictate(ctl, chunks);
  assert.equal(ctl.state.live, false);
  assert.ok(f.events.notices.some(text => /interrumpida/.test(text)));
  assert.equal(f.events.modes.at(-1), 'batch');
  const outcome = await ctl.finish();
  assert.equal(outcome.error, undefined, outcome.error);
  // Texts are the engine-less segment markers [first-last:samples]; none of the live words survive.
  assert.deepEqual(tokens(outcome.text), []);
  const segments = [...outcome.text.matchAll(/\[(-?\d+)-(-?\d+):(\d+)\]/g)].map(match => ({ first: +match[1], last: +match[2], samples: +match[3] }));
  assert.ok(segments.length >= 18, `${segments.length} segments`);
  assert.ok(segments.every(item => item.samples * 2 <= SEGMENT_SECONDS * 32000));
  // The fake recognizer received exactly the audio that was spoken: same bytes, same order, once.
  assert.equal(Buffer.compare(await f.heardAudio(), Buffer.concat(chunks)), 0);
  assert.equal(outcome.text.split(' ').length, segments.length);
  assert.equal(f.calls.filter(method => method === 'voice.stream.push').length, CHUNKS);
  assert.equal(await f.spools(), 0);
  await assert.rejects(f.api('voice.stream.recover', { workspaceId: f.workspace.id, sessionId: ctl.state.id, index: 0 }), /no encontrada/);
});

test('without a live runtime the same dictation is spooled and transcribed in segments when it stops', async t => {
  const f = await fixture(t, { stream: false });
  const ctl = f.session();
  const chunks = makeAudio(180);
  await dictate(ctl, chunks);
  assert.ok(f.events.notices.some(text => /no disponible/.test(text)));
  assert.equal(f.events.modes.at(-1), 'batch');
  const outcome = await ctl.finish();
  assert.equal(outcome.error, undefined, outcome.error);
  assert.equal(Buffer.compare(await f.heardAudio(), Buffer.concat(chunks)), 0);
  assert.ok(outcome.text.length > 0);
  assert.equal(await f.spools(), 0);
});

test('a transient segment failure is retried; a persistent one is reported without dropping the live text', async t => {
  const once = await fixture(t, { engineArgs: ['--fail-push', '20'] });
  const first = once.session();
  const audio = makeAudio(60);
  await dictate(first, audio);
  await writeFile(path.join(once.work, 'fail-once'), '');
  const retried = await first.finish();
  assert.equal(retried.error, undefined, retried.error);
  assert.equal(Buffer.compare(await once.heardAudio(), Buffer.concat(audio)), 0);

  const broken = await fixture(t, { engineArgs: ['--fail-push', '20'] });
  const second = broken.session();
  await dictate(second, makeAudio(60));
  await writeFile(path.join(broken.work, 'fail-always'), '');
  const outcome = await second.finish();
  // Never silent: the error is explicit, and the text is one copy of what the live engine heard.
  assert.match(outcome.error, /incompleta/);
  assert.deepEqual(tokens(outcome.text), range(20));
  assert.equal(await eventually(async () => (await broken.spools()) === 0), true);
});

test('cancelling releases the host session and its temporary audio', async t => {
  const f = await fixture(t);
  const ctl = f.session();
  await dictate(ctl, makeAudio(5));
  assert.equal(await f.spools(), 1);
  ctl.cancel();
  assert.equal(await eventually(async () => (await f.spools()) === 0), true);
  await assert.rejects(f.api('voice.stream.push', { workspaceId: f.workspace.id, sessionId: ctl.state.id, sequence: 5, audioBase64: bytesToBase64(new Uint8Array(4)) }), /no encontrada/);
  // Audio written after cancelling goes nowhere.
  ctl.write(new Uint8Array(4000));
  assert.equal(ctl.pending, 0);
});

test('cancelling before the host answers start still releases the session', async t => {
  const f = await fixture(t);
  const ctl = f.session();
  ctl.cancel();
  await ctl.state.ready;
  assert.equal(await eventually(async () => (await f.spools()) === 0), true);
  assert.equal(f.calls.filter(method => method === 'voice.stream.cancel').length, 1);
});

test('sessions expire by inactivity, not by age: activity renews the lease and silence frees it', async t => {
  const f = await fixture(t, { stream: false });
  streamTiming.sessionIdleMs = 250;
  const { sessionId } = await f.api('voice.stream.start', { workspaceId: f.workspace.id, spool: true });
  const push = sequence => f.api('voice.stream.push', { workspaceId: f.workspace.id, sessionId, sequence, audioBase64: bytesToBase64(new Uint8Array(3200)) });
  const started = Date.now();
  for (let k = 0; k < 14; k++) { await push(k); await new Promise(resolve => setTimeout(resolve, 80)); }
  // Well past the idle window in total age, yet still alive because it kept receiving audio.
  assert.ok(Date.now() - started > 3 * streamTiming.sessionIdleMs);
  await push(14);
  assert.equal(await f.spools(), 1);
  assert.equal(await eventually(async () => (await f.spools()) === 0, 3000), true);
  await assert.rejects(push(15), /no encontrada/);
});

test('validation survives: base64, sequence, PCM alignment, workspace ownership and recovery order', async t => {
  const f = await fixture(t);
  const { sessionId } = await f.api('voice.stream.start', { workspaceId: f.workspace.id });
  const push = (payload, workspaceId = f.workspace.id) => f.api('voice.stream.push', { workspaceId, sessionId, ...payload });
  const good = bytesToBase64(new Uint8Array(3200));
  await assert.rejects(push({ sequence: 5, audioBase64: good }), /fuera de orden/);
  await assert.rejects(push({ sequence: 0, audioBase64: 'no es base64!' }), /PCM16/);
  await assert.rejects(push({ sequence: 0, audioBase64: bytesToBase64(new Uint8Array(3)) }), /PCM16/);
  await assert.rejects(push({ sequence: 0, audioBase64: bytesToBase64(new Uint8Array(64002)) }), /PCM16|demasiado grande/);
  await assert.rejects(push({ sequence: 0, audioBase64: good }, f.other.id), /no encontrada/);
  await assert.rejects(push({ sequence: 0, audioBase64: good }, randomUUID()), /Workspace/);
  await push({ sequence: 0, audioBase64: good });
  await assert.rejects(f.api('voice.stream.recover', { workspaceId: f.workspace.id, sessionId, index: 0 }), /sin audio pendiente|no tiene audio/);
  await f.api('voice.stream.cancel', { workspaceId: f.workspace.id, sessionId });

  const spooled = await f.api('voice.stream.start', { workspaceId: f.workspace.id, spool: true });
  const send = sequence => f.api('voice.stream.push', { workspaceId: f.workspace.id, sessionId: spooled.sessionId, sequence, audioBase64: bytesToBase64(new Uint8Array(CHUNK)) });
  await send(0); await send(1);
  const finished = await f.api('voice.stream.finish', { workspaceId: f.workspace.id, sessionId: spooled.sessionId });
  assert.equal(finished.degraded, true);
  assert.equal(finished.bytes, 2 * CHUNK);
  await assert.rejects(send(2), /fuera de orden/);
  await assert.rejects(f.api('voice.stream.recover', { workspaceId: f.workspace.id, sessionId: spooled.sessionId, index: 1 }), /fuera de orden/);
  await assert.rejects(f.api('voice.stream.recover', { workspaceId: f.other.id, sessionId: spooled.sessionId, index: 0 }), /no encontrada/);
  const segment = await f.api('voice.stream.recover', { workspaceId: f.workspace.id, sessionId: spooled.sessionId, index: 0 });
  assert.equal(segment.done, true);
  assert.equal(await f.spools(), 0);
});

test('captured audio waiting to be sent is bounded: overflow stops growth instead of queueing without limit', async () => {
  const api = async method => (method === 'voice.stream.start' ? { sessionId: 'slow' } : new Promise(() => {}));
  let overflow = 0;
  const ctl = createDictationSession({ api, workspaceId: 'w', onOverflow: () => overflow++ });
  await ctl.state.ready;
  ctl.pump();
  for (let written = 0; written < MAX_PENDING_BYTES * 2; written += 4000) ctl.write(new Uint8Array(4000));
  assert.equal(overflow, 1);
  assert.ok(ctl.pending <= MAX_PENDING_BYTES + 4000);
});

test('a transport failure after minutes keeps the text already heard and says so', async () => {
  let pushes = 0;
  const api = async (method, payload) => {
    if (method === 'voice.stream.start') return { sessionId: 's' };
    if (method === 'voice.stream.push') {
      if (++pushes > 3) throw new Error('Host disconnected');
      return { confirmed: `palabra${pushes}`, partial: '', text: `palabra${pushes}` };
    }
    return {};
  };
  const ctl = createDictationSession({ api, workspaceId: 'w' });
  await dictate(ctl, makeAudio(6));
  const outcome = await ctl.finish();
  assert.equal(outcome.text, 'palabra3');
  assert.match(outcome.error, /Se conservó el texto/);
});

test('the desktop bridge allows the segment protocol without widening RPC limits', () => {
  assert.doesNotThrow(() => validateInvocation('voice.stream.recover', { workspaceId: 'w', sessionId: 's', index: 3 }));
  assert.doesNotThrow(() => validateInvocation('voice.stream.push', { workspaceId: 'w', sessionId: 's', sequence: 0, audioBase64: bytesToBase64(new Uint8Array(CHUNK)) }));
  assert.throws(() => validateInvocation('voice.stream.push', { workspaceId: 'w', sessionId: 's', sequence: 0, audioBase64: 'A'.repeat(2 * 1024 * 1024) }), /demasiado grande/);
  assert.ok(requestTimeout('voice.stream.recover') <= 180000);
  assert.equal(requestTimeout('voice.stream.push'), 60000);
});
