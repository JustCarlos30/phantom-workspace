// A slow desktop must not disconnect every PTY. The host retains the authoritative
// terminal screen, so omit live chunks under pressure and request a fresh snapshot.
export function createSocketOutput(socket, { highWater = 1024 * 1024, maxReliableBytes = 32 * 1024 * 1024 } = {}) {
  const stale = new Map();
  function write(message) {
    if (!socket.destroyed) socket.write(JSON.stringify(message) + '\n');
  }
  function recover() {
    if (socket.destroyed) return;
    for (const [sessionId, event] of stale) {
      if (socket.writableLength >= highWater) break;
      stale.delete(sessionId);
      write({ event: { type: 'terminal.resync', sessionId, workspaceId: event.workspaceId, seq: event.seq } });
    }
  }
  socket.on('drain', recover);
  socket.on('close', () => stale.clear());
  return message => {
    if (socket.destroyed) return;
    const event = message.event;
    if (event?.type === 'terminal.output' && (stale.has(event.sessionId) || socket.writableLength >= highWater)) {
      stale.set(event.sessionId, { workspaceId: event.workspaceId, seq: event.seq });
      return;
    }
    // Keep a bound for an unresponsive peer receiving reliable RPC results.
    // Normal terminal traffic never reaches this limit or closes the transport.
    if (socket.writableLength > maxReliableBytes) { socket.destroy(); return; }
    write(message);
    recover();
  };
}
