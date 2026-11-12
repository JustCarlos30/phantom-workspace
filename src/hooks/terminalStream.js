// Snapshot/live-output handshake, independent of xterm and React for race tests.
export function createTerminalStream({ sessionId, invoke, subscribe, snapshot, output, onStatus, onError, onReady = () => {}, maxBytes = 2 * 1024 * 1024, connected = true }) {
  let disposed = false, epoch = 0, ready = false, running = false, online = connected, attaching = false, refreshing = false, resyncSeq = -1;
  let buffer = [], bytes = 0, pendingBytes = 0, seq = -1, exited = false;
  const byteLength = text => new TextEncoder().encode(text).length;
  const fail = error => {
    ++epoch; ready = false; running = false; attaching = false; buffer = []; bytes = 0; pendingBytes = 0;
    onStatus('lost'); onError(error.message || String(error));
  };
  const deliver = event => {
    if (!Number.isSafeInteger(event.seq) || typeof event.data !== 'string') { fail(new Error('Salida de terminal inválida. Reconecta para recuperar el historial.')); return; }
    if (event.seq <= seq) return;
    if (event.seq !== seq + 1) { fail(new Error('Falta un fragmento de salida. Reconecta para recuperar la captura.')); return; }
    const count = byteLength(event.data), version = epoch;
    if (pendingBytes + count > maxBytes) { fail(new Error('La vista no pudo procesar toda la salida. Reconecta para recuperar una captura acotada.')); return; }
    seq = event.seq; pendingBytes += count;
    Promise.resolve(output(event.data)).then(() => { if (version === epoch) pendingBytes -= count; }, error => { if (!disposed && version === epoch) fail(error); });
  };
  const reconnect = async ({ background = false } = {}) => {
    if (disposed || !online || !sessionId) return;
    const version = ++epoch;
    refreshing = background && running;
    ready = false; if (!refreshing) running = false; attaching = true; exited = false; buffer = []; bytes = 0; pendingBytes = 0;
    if (!refreshing) onStatus('connecting'); onError('');
    const current = () => !disposed && version === epoch && online;
    try {
      const result = await invoke('terminal.attach', { sessionId });
      if (!current()) return;
      if (!Number.isSafeInteger(result.seq) || result.seq < 0 || typeof result.data !== 'string') throw new Error('El host devolvió una captura inválida.');
      seq = result.seq;
      // Wait until xterm has drained old writes and applied the replacement
      // snapshot. All events arriving during this await still enter the buffer.
      await snapshot(result.data, current, result.session);
      if (!current()) return;
      const queued = buffer.sort((a, b) => a.seq - b.seq); buffer = []; bytes = 0;
      for (const event of queued) { deliver(event); if (!current()) return; }
      ready = true; running = !exited && result.session?.status === 'running';
      onStatus(exited ? 'exited' : result.session?.status || 'lost'); onReady();
    } catch (error) { if (current()) fail(error); }
    finally { if (version === epoch) { attaching = false; refreshing = false; if (ready && seq < resyncSeq) reconnect({ background: true }); } }
  };
  // Install the subscription before any attach request can resolve.
  const off = subscribe(event => {
    if (disposed) return;
    if (event.type === 'connection') {
      if (event.status !== 'connected') {
        online = false; ++epoch; ready = false; running = false; attaching = false; buffer = []; bytes = 0; pendingBytes = 0;
        onStatus('disconnected'); onError(event.message || 'Host desconectado. La salida visible se conserva hasta recuperar la conexión.');
      } else if (!online) { online = true; reconnect(); }
      return;
    }
    if (!online || event.sessionId !== sessionId) return;
    if (event.type === 'terminal.resync') {
      if (Number.isSafeInteger(event.seq)) resyncSeq = Math.max(resyncSeq, event.seq);
      if (!attaching) reconnect({ background: true });
      return;
    }
    if (event.type === 'terminal.exit') { exited = true; running = false; onStatus('exited'); }
    if (event.type !== 'terminal.output') return;
    if (ready) deliver(event);
    else {
      // Failure invalidates the current epoch; only an attach in progress may
      // buffer. Without this guard a failed view would grow indefinitely.
      if (!attaching) return;
      if (typeof event.data !== 'string' || !Number.isSafeInteger(event.seq)) { fail(new Error('Salida de terminal inválida.')); return; }
      bytes += byteLength(event.data);
      if (bytes > maxBytes) { fail(new Error('La captura cambió demasiado durante la conexión. Reintenta conectar.')); return; }
      buffer.push(event);
    }
  });
  if (!online) { onStatus('disconnected'); onError('Host desconectado. La sesión se recuperará cuando vuelva la conexión.'); }
  return { start: reconnect, retry: reconnect, version: () => epoch, canWrite: () => !disposed && online && (ready || refreshing) && running, fail,
    dispose() { disposed = true; ++epoch; ready = false; running = false; off(); },
  };
}
