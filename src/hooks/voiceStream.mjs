export const MAX_CHUNK_BYTES = 64000;

// Preserve interpolation phase and the boundary sample between capture callbacks.
export function createResampler(sampleRate, targetRate = 16000) {
  if (!(sampleRate > 0 && targetRate > 0)) throw new Error('Frecuencia de audio inválida.');
  let pending = new Float32Array(0), position = 0;
  return (input, final = false) => {
    const samples = new Float32Array(pending.length + input.length);
    samples.set(pending); samples.set(input, pending.length);
    const output = [];
    while (position < samples.length * targetRate && (final || position + targetRate < samples.length * targetRate)) {
      const index = Math.floor(position / targetRate), fraction = position / targetRate - index;
      output.push(samples[index] + ((samples[index + 1] ?? samples[index]) - samples[index]) * fraction);
      position += sampleRate;
    }
    const consumed = Math.min(Math.floor(position / targetRate), samples.length);
    pending = samples.slice(consumed); position -= consumed * targetRate;
    return Float32Array.from(output);
  };
}

export function floatToPCM16(samples) {
  const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return bytes;
}

export function chunkPCM(bytes) {
  if (bytes.length % 2) throw new Error('PCM16 incompleto.');
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK_BYTES) chunks.push(bytes.slice(offset, offset + MAX_CHUNK_BYTES));
  return chunks;
}

export function audioBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function createPushQueue({ push, onResponse = () => {} }) {
  let pending = [], sequence = 0, cancelled = false, running = null, failure = null;
  const enqueue = bytes => { if (!cancelled) pending.push(...chunkPCM(bytes)); };
  const flush = async () => {
    // A caller may append audio after an earlier drain has exhausted its loop
    // but before its promise settles. Wait, then check pending again so stop()
    // cannot finish the session with that final audio still in the queue.
    if (running) {
      await running;
      return flush();
    }
    if (cancelled) return;
    if (failure) throw failure;
    if (!pending.length) return;
    running = (async () => {
      while (!cancelled && pending.length) {
        // Coalesce callbacks into full-sized fragments while retaining PCM alignment.
        let length = 0;
        const parts = [];
        while (pending.length && length < MAX_CHUNK_BYTES) {
          const part = pending.shift(), take = Math.min(part.length, MAX_CHUNK_BYTES - length);
          parts.push(part.subarray(0, take)); length += take;
          if (take < part.length) pending.unshift(part.subarray(take));
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        const result = await push({ sequence: sequence++, audioBase64: audioBase64(bytes) });
        if (!cancelled) onResponse(result);
      }
    })().catch(error => {
      // Cancellation also invalidates a late RPC rejection, not only its value.
      if (cancelled) return;
      failure = error; pending = []; throw error;
    }).finally(() => { running = null; });
    return running;
  };
  return { enqueue, flush, cancel: () => { cancelled = true; pending = []; } };
}
