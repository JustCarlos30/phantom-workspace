import { STREAM_RATE, PcmQueue, MAX_PUSH_BYTES, bytesToBase64, liveTranscript } from './voice-pcm.js';

// 100 ms of PCM16: below this a push is not worth a round trip.
export const MIN_PUSH = STREAM_RATE * 2 / 10;
// Captured-but-unsent audio is bounded: two minutes of PCM16 (about 3.8 MB).
export const MAX_PENDING_BYTES = STREAM_RATE * 2 * 120;
const SEGMENT_ATTEMPTS = 2;

const joinText = (...parts) => parts.filter(Boolean).join(' ').trim();
export const joinLive = value => joinText(value?.confirmed, value?.partial);
const reason = error => String(error?.message ?? error ?? 'error desconocido');
const sentence = message => `${reason(message).replace(/\.?\s*$/, '.')}`;

// One dictation, end to end, with no clock and no total-size limit. Audio goes to the
// host in small ordered pushes; the host keeps a disk copy, so if the live engine
// fails (even minutes in) the whole dictation is transcribed afterwards in
// independently decodable segments instead of keeping a growing blob in memory.
// Callbacks: onLive(transcript) onMode('preparing'|'live'|'batch') onNotice(text)
// onReady() onUnavailable(message) onOverflow().
export function createDictationSession({ api, workspaceId, onLive = () => {}, onMode = () => {}, onNotice = () => {}, onReady = () => {}, onUnavailable = () => {}, onOverflow = () => {}, isCurrent = () => true }) {
  const queue = new PcmQueue();
  const s = { id: null, sequence: 0, inflight: null, live: false, failed: false, closed: false, finished: false, lastLive: null, ready: null, overflowed: false, sent: 0 };
  const active = () => !s.closed && isCurrent();
  const cancelHost = () => { if (s.id && !s.finished) api('voice.stream.cancel', { workspaceId, sessionId: s.id }).catch(() => {}); s.finished = true; };

  const attach = (result, live) => {
    if (s.closed || !isCurrent()) { api('voice.stream.cancel', { workspaceId, sessionId: result.sessionId }).catch(() => {}); return false; }
    s.id = result.sessionId; s.live = live;
    onMode(live ? 'live' : 'batch');
    return true;
  };

  // Live engine first; without one the same audio is kept on disk and transcribed at the end.
  s.ready = (async () => {
    onMode('preparing');
    try {
      const started = await api('voice.stream.start', { workspaceId });
      if (!attach(started, true)) return;
    } catch (error) {
      if (!active()) return;
      onNotice(`Transcripción en vivo no disponible: ${sentence(error)} Se transcribirá al detener.`);
      try {
        const started = await api('voice.stream.start', { workspaceId, spool: true });
        if (!attach(started, false)) return;
      } catch (second) {
        if (active()) { s.unavailable = reason(error); onUnavailable(s.unavailable); }
        return;
      }
    }
    if (active()) onReady();
  })();

  // The live engine died mid-dictation: audio keeps flowing to the disk copy only.
  const degrade = message => {
    if (!s.live) return;
    s.live = false;
    if (active()) { onMode('batch'); onNotice(`Transcripción en vivo interrumpida: ${sentence(message)} Se transcribirá al detener sin perder el audio.`); }
  };
  const lose = message => {
    // The host session is unusable (transport or protocol failure): keep what was heard.
    s.failed = true; s.failure = reason(message); queue.clear();
    if (active()) onNotice(`La transcripción se interrumpió: ${sentence(message)}`);
  };

  async function sendNext() {
    const bytes = queue.take(), sequence = s.sequence;
    try {
      const result = await api('voice.stream.push', { workspaceId, sessionId: s.id, sequence, audioBase64: bytesToBase64(bytes) });
      s.sequence = sequence + 1; s.sent += bytes.length;
      if (result?.degraded) degrade(result.reason);
      else if (s.live) { s.lastLive = liveTranscript(result); if (active()) onLive(s.lastLive); }
    } catch (error) { lose(error.message); }
  }
  const take = () => { s.inflight = sendNext().finally(() => { s.inflight = null; }); return s.inflight; };

  return {
    state: s,
    get pending() { return queue.size; },
    // Captured PCM16; never blocks the audio callback.
    write(bytes) {
      if (s.closed || s.failed || s.unavailable || s.overflowed) return;
      queue.push(bytes);
      if (queue.size > MAX_PENDING_BYTES) { s.overflowed = true; if (active()) onOverflow(); }
    },
    // One push at a time, in order; catches up without waiting for the next tick.
    pump() {
      if (!s.id || s.inflight || s.closed || s.failed || queue.size < MIN_PUSH) return s.inflight;
      return take().then(() => (queue.size >= MAX_PUSH_BYTES ? this.pump() : undefined));
    },
    // Drain the last audio, finish, and return the whole text exactly once.
    async finish() {
      await s.ready;
      if (s.closed || !isCurrent()) return { cancelled: true, text: '' };
      if (s.unavailable) return { text: '', unavailable: s.unavailable };
      await s.inflight;
      while (active() && !s.failed && queue.size) await take();
      if (!active()) return { cancelled: true, text: '' };
      const heard = s.lastLive ? joinLive(s.lastLive) : '';
      if (s.failed) { cancelHost(); return { text: heard, error: `${sentence(s.failure)} Se conservó el texto hasta el corte; el resto del audio no se pudo transcribir.` }; }
      let finished;
      try { finished = await api('voice.stream.finish', { workspaceId, sessionId: s.id }); }
      catch (error) { lose(error.message); cancelHost(); return { text: heard, error: `${sentence(error)} Se conservó el texto hasta el corte; el resto del audio no se pudo transcribir.` }; }
      if (!finished?.degraded) {
        s.finished = true;
        const text = joinLive(liveTranscript(finished));
        if (active()) onLive({ confirmed: text, partial: '' });
        return { text, result: finished };
      }
      if (s.live) degrade(finished.reason);
      return this.recover(finished, heard);
    },
    // Segment-by-segment transcription of the host's disk copy; the live text is discarded
    // (the segments cover the whole audio), so nothing is duplicated.
    async recover(finished, heard) {
      const parts = [];
      let failure = '';
      // A disk error cut the copy short: the saved prefix is still transcribed, but the result is
      // always reported as incomplete, never as a full dictation.
      const incomplete = finished.complete === false;
      if (incomplete) failure = `El audio temporal del dictado no se pudo guardar completo${finished.diskError ? ` (${finished.diskError})` : ''}.`;
      if (!incomplete && finished.bytes === 0) { s.finished = true; return { text: '' }; }
      for (let index = 0; ; index++) {
        let segment = null, lastError = '';
        for (let attempt = 0; attempt < SEGMENT_ATTEMPTS && !segment; attempt++) {
          if (!active()) return { cancelled: true, text: '' };
          try { segment = await api('voice.stream.recover', { workspaceId, sessionId: s.id, index }); }
          catch (error) { lastError = reason(error); }
        }
        if (!segment) { if (!incomplete) failure = lastError; break; }
        if (segment.text) parts.push(segment.text);
        if (active()) onLive({ confirmed: joinText(...parts), partial: '' });
        if (segment.done) {
          if (incomplete) break;
          s.finished = true; return { text: joinText(...parts) };
        }
      }
      // Keep the better single copy; never concatenate the two (they overlap).
      const recovered = joinText(...parts);
      cancelHost();
      const text = recovered.length >= heard.length ? recovered : heard;
      return { text, error: `${sentence(failure)} Se conservó ${text ? 'el texto disponible' : 'lo capturado'}; la transcripción quedó incompleta.` };
    },
    cancel() {
      if (s.closed) return;
      s.closed = true; queue.clear(); cancelHost();
    },
  };
}
