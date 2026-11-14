// Pure helpers for live dictation: microphone floats → PCM16 mono 16 kHz,
// the exact format the host's voice.stream.push accepts.
export const STREAM_RATE = 16000;
// Host cap per voice.stream.push (bytes of PCM16), two seconds of audio.
export const MAX_PUSH_BYTES = 64000;

// Linear resampling is enough for speech recognition at 16 kHz.
export function resample(input, fromRate, toRate = STREAM_RATE) {
  if (fromRate === toRate) return input;
  const length = Math.floor(input.length * toRate / fromRate);
  const output = new Float32Array(length), ratio = fromRate / toRate;
  for (let i = 0; i < length; i++) {
    const position = i * ratio, index = Math.floor(position), fraction = position - index;
    const a = input[index] ?? 0, b = input[index + 1] ?? a;
    output[i] = a + (b - a) * fraction;
  }
  return output;
}

export function floatToPcm16(samples) {
  const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// FIFO of PCM bytes; take() hands out even-sized slices within the host cap.
export class PcmQueue {
  constructor() { this.parts = []; this.size = 0; }
  push(bytes) { if (bytes.length) { this.parts.push(bytes); this.size += bytes.length; } }
  take(limit = MAX_PUSH_BYTES) {
    const wanted = Math.min(this.size, limit - (limit % 2));
    const out = new Uint8Array(wanted);
    let filled = 0;
    while (filled < wanted) {
      const head = this.parts[0], count = Math.min(head.length, wanted - filled);
      out.set(head.subarray(0, count), filled); filled += count;
      if (count === head.length) this.parts.shift(); else this.parts[0] = head.subarray(count);
    }
    this.size -= wanted;
    return out;
  }
  clear() { this.parts = []; this.size = 0; }
}

// What the user sees while speaking: committed words plus the tentative tail.
export function liveTranscript(result) {
  return { confirmed: String(result?.confirmed || '').trim(), partial: String(result?.partial || '').trim() };
}
