// Desktop owns timeouts and explicit discard. Renderer only acknowledges a
// successful durable drain; retries of the same request are safe and deduped.
export function createCloseHandler({ flush, invoke, onStatus, onError }) {
  const attempts = new Map();
  const cancelled = new Set();
  let latest;
  const request = requestId => {
    if (attempts.has(requestId)) return attempts.get(requestId);
    latest = requestId;
    onStatus({ requestId, status: 'saving' });
    const promise = Promise.resolve().then(async () => {
      await flush();
      if (cancelled.has(requestId)) return false;
      await invoke('desktop.closeReady', { requestId, discard: false });
      if (latest === requestId) onStatus(null);
      return true;
    }).catch(error => {
      if (!cancelled.has(requestId)) {
        if (latest === requestId) onStatus({ requestId, status: 'failed', error: error.message });
        onError(error);
      }
      return false;
    }).finally(() => { attempts.delete(requestId); cancelled.delete(requestId); });
    attempts.set(requestId, promise);
    return promise;
  };
  request.cancel = requestId => {
    if (attempts.has(requestId)) cancelled.add(requestId);
    if (latest === requestId) { latest = null; onStatus(null); }
  };
  return request;
}
