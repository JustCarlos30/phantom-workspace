import http from 'node:http';
import { Readable } from 'node:stream';

// Only Phantom's long-running, local message POST bypasses Undici.
export function createPhantomFetch(originalFetch = globalThis.fetch) {
  return async function phantomFetch(input, init) {
    let url;
    try { url = new URL(input instanceof Request ? input.url : input); }
    catch { return originalFetch(input, init); }
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\./.test(url.hostname);
    if (url.protocol !== 'http:' || !loopback || method !== 'POST' || !/^\/session\/[^/]+\/message$/.test(url.pathname)) {
      return originalFetch(input, init);
    }

    const request = new Request(input, init);
    const { signal } = request;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let incoming;
      let upload;
      const cleanup = () => signal.removeEventListener('abort', abort);
      const req = http.request(url, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        agent: false,
      });
      // No header deadline or socket inactivity deadline, even on long runs.
      req.setTimeout(0);
      const abort = () => {
        const reason = signal.reason;
        const error = reason instanceof Error ? reason : new DOMException('The operation was aborted.', 'AbortError');
        reject(reason);
        incoming?.destroy(error);
        req.destroy(error);
      };
      req.on('error', error => {
        cleanup();
        upload?.destroy();
        incoming?.destroy(error);
        reject(error);
      });
      req.on('response', response => {
        incoming = response;
        response.once('end', cleanup);
        response.once('close', cleanup);
        response.on('error', error => { cleanup(); reject(error); });
        const headers = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        }
        try {
          const bodyless = [204, 205, 304].includes(response.statusCode);
          const result = new Response(bodyless ? null : Readable.toWeb(response), {
            status: response.statusCode,
            statusText: response.statusMessage,
            headers,
          });
          Object.defineProperty(result, 'url', { value: url.href });
          if (bodyless) response.resume();
          resolve(result);
        } catch (error) {
          req.destroy(error);
          reject(error);
        }
      });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      if (request.body) {
        upload = Readable.fromWeb(request.body);
        upload.on('error', error => req.destroy(error));
        upload.pipe(req);
      } else {
        req.end();
      }
    });
  };
}

globalThis.fetch = createPhantomFetch(globalThis.fetch);
