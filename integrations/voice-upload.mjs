import { open, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

// Temporary on-disk copy of the PCM16 mono 16 kHz audio a dictation session received.
// Memory stays at one chunk; the file lets a failed or engine-less dictation be
// transcribed afterwards in independently decodable WAV segments.
export const RATE = 16000;
export const SEGMENT_SECONDS = 30;
// There is no total size or duration limit: the copy grows with the dictation and only a
// real disk error (ENOSPC, EIO, a write that makes no progress) marks it incomplete.
const SEARCH_SECONDS = 4, FRAME = 800;
const PREFIX = 'voice-spool-';
const STALE_MS = 24 * 3_600_000;
// Directories of spools this process owns: never swept, however old their mtime looks.
const owned = new Set();

// io: { open, now } can be replaced to simulate disks and clocks in tests.
export async function createSpool(root, { io = {} } = {}) {
  const openFile = io.open ?? open, now = io.now ?? Date.now;
  await mkdir(root, { recursive: true, mode: 0o700 });
  // A crash leaves its directory behind: sweep orphans before making a new one. A directory's
  // mtime does not move when its audio file is written, so the file's mtime counts too,
  // and spools owned by a live session are skipped outright.
  for (const name of await readdir(root).catch(() => [])) {
    const target = path.join(root, name);
    if (!name.startsWith(PREFIX) || owned.has(target)) continue;
    const [info, audio] = await Promise.all([stat(target).catch(() => null), stat(path.join(target, 'audio.pcm')).catch(() => null)]);
    if (info && now() - Math.max(info.mtimeMs, audio?.mtimeMs ?? 0) > STALE_MS) await rm(target, { recursive: true, force: true }).catch(() => {});
  }
  const dir = await mkdtemp(path.join(root, PREFIX));
  const file = path.join(dir, 'audio.pcm');
  let handle;
  try { handle = await openFile(file, 'a+', 0o600); }
  catch (error) { await rm(dir, { recursive: true, force: true }).catch(() => {}); throw error; }
  owned.add(dir);
  return { dir, file, handle, bytes: 0, full: false, error: null, offset: 0, destroyed: false };
}

// Appends validated PCM completely or not at all: bytes are counted only once written. A disk
// error or a write that makes no progress marks the copy incomplete (never corrupt) and throws.
export async function appendSpool(spool, bytes) {
  if (spool.destroyed || spool.full) return false;
  let written = 0;
  try {
    while (written < bytes.length) {
      const remaining = bytes.length - written;
      const { bytesWritten } = await spool.handle.write(bytes, written, remaining, spool.bytes + written);
      if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) throw new Error('el disco no aceptó más audio (escritura sin progreso)');
      written += bytesWritten;
    }
  } catch (error) {
    // Whatever landed past spool.bytes is never read back.
    spool.full = true; spool.error = String(error?.message ?? error);
    throw error;
  }
  spool.bytes += written;
  return true;
}

export function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Quietest 50 ms frame near the end of the window, so a cut rarely lands inside a word.
function quietCut(pcm, start, end) {
  const frames = Math.floor(SEARCH_SECONDS * RATE / FRAME);
  let best = end, energy = Infinity;
  for (let k = 1; k <= frames; k++) {
    const from = end - k * FRAME * 2;
    if (from <= start) break;
    let sum = 0;
    for (let i = from; i < from + FRAME * 2; i += 2) sum += Math.abs(pcm.readInt16LE(i));
    if (sum < energy) { energy = sum; best = from + FRAME; }
  }
  return best - ((best - start) % 2);
}

// Next segment after spool.offset as a standalone WAV, or null when all audio was read.
// Offsets are only advanced by commitSegment, so a failed segment can be retried.
export async function readSegment(spool) {
  if (spool.destroyed) throw new Error('Audio temporal ya liberado');
  const start = spool.offset;
  if (start >= spool.bytes) return null;
  const limit = Math.min(spool.bytes, start + SEGMENT_SECONDS * RATE * 2);
  const pcm = Buffer.alloc(limit - start);
  // A short read is completed; EOF or no progress means the file lost audio: fail rather than
  // hand zero-filled bytes to the recognizer as if they were speech.
  for (let filled = 0; filled < pcm.length;) {
    const remaining = pcm.length - filled;
    const { bytesRead } = await spool.handle.read(pcm, filled, remaining, start + filled);
    if (!Number.isInteger(bytesRead) || bytesRead <= 0 || bytesRead > remaining) throw new Error('El audio temporal está truncado o no se pudo leer completo');
    filled += bytesRead;
  }
  const end = limit < spool.bytes ? start + quietCut(pcm, 0, pcm.length) : limit;
  return { wav: wavFromPcm(pcm.subarray(0, end - start)), next: end, last: end >= spool.bytes };
}

export function commitSegment(spool, segment) { spool.offset = segment.next; }

export async function destroySpool(spool) {
  if (!spool || spool.destroyed) return;
  spool.destroyed = true;
  owned.delete(spool.dir);
  await spool.handle.close().catch(() => {});
  await rm(spool.dir, { recursive: true, force: true }).catch(() => {});
}
