import { randomUUID } from 'node:crypto';

// `opencode run` answers permission.asked with reject before a host can ask
// the user. Own a loopback server instead and answer through its HTTP API.
// The caller owns the process group; this transport never starts a model CLI.
export async function driveOpenCode(child, { cwd, sessionId, message, model, reasoning, password, onEvent, onPermission, onQuestion, signal: callerSignal }) {
  const controller = new AbortController(), signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
  let base, reader, failure, mainError, completed = false, buffer = '';
  const stopped = new Promise(resolve => child.once('close', resolve));
  const abort = error => { failure ??= error; controller.abort(error); };
  child.once('error', error => abort(error));
  child.once('close', code => abort(new Error(`OpenCode terminó antes de completar la respuesta (${code ?? 'señal'})`)));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OpenCode no inició su servidor local en 30 segundos')), 30000);
    const cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const data = chunk => {
      buffer = (buffer + chunk).slice(-16000);
      const match = /opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(buffer);
      if (match) resolve(match[1]);
    };
    child.stdout.setEncoding('utf8'); child.stdout.on('data', data);
    // Always remove listeners and timers, including failed startup.
    const cleanup = () => { clearTimeout(timer); child.stdout.off('data', data); signal.removeEventListener('abort', cancel); };
    // Attaching via then avoids leaving an unhandled rejected finally promise.
    queueMicrotask(() => ready.then(cleanup, cleanup));
  });
  const headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'content-type': 'application/json' };
  const pause = ms => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
  const retry = async operation => {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try { return await operation(); }
      catch (error) {
        signal.throwIfAborted();
        if (error.transient === false || attempt === 2) throw error;
        await pause(200 * (attempt + 1));
      }
    }
  };
  const request = async (route, body, bounded = true, retries = body === undefined || /^\/(permission|question)\//.test(route)) => {
    const send = async () => {
      signal.throwIfAborted();
      // Limit SSE connection setup, not the lifetime of a healthy stream.
      const connection = route === '/event' ? new AbortController() : null;
      const timer = connection ? setTimeout(() => connection.abort(new Error('OpenCode: tiempo de conexión agotado')), 30000) : null;
      let response;
      try {
        response = await fetch(`${base}${route}?directory=${encodeURIComponent(cwd)}`, {
          method: body === undefined ? 'GET' : 'POST', headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: bounded ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : connection ? AbortSignal.any([signal, connection.signal]) : signal,
        });
      } finally { clearTimeout(timer); }
      if (!response.ok) {
        await response.body?.cancel();
        // An answered/expired request may disappear while its reply is in flight.
        if (response.status === 404 && body !== undefined && /^\/(permission|question)\//.test(route)) return response;
        throw Object.assign(new Error(`OpenCode ${route}: HTTP ${response.status}`), { transient: response.status === 408 || response.status === 429 || response.status >= 500 });
      }
      return response;
    };
    return retries ? retry(send) : send();
  };
  const getJSON = route => retry(async () => {
    const response = await request(route, undefined, true, false);
    try { return await response.json(); }
    catch (error) { if (error instanceof SyntaxError) error.transient = false; throw error; }
  });
  const seen = new Map(), requests = new Set(), sessions = new Set(sessionId ? [sessionId] : []);
  const errorMessage = error => String(error?.data?.message || error?.message || error?.name || 'OpenCode terminó con error');
  const emitPart = part => {
    if (!part?.id || !sessions.has(part.sessionID)) return;
    const signature = JSON.stringify(part);
    if (seen.get(part.id) === signature) return;
    let type;
    if (part.type === 'tool') type = 'tool_use';
    else if (part.type === 'text' && part.time?.end) type = 'text';
    else if (part.type === 'step-finish') type = 'step_finish';
    else return;
    // Final text and usage must be counted once even if metadata changes.
    if (seen.has(part.id) && type !== 'tool_use') return;
    seen.set(part.id, signature);
    onEvent({ type, sessionID: sessionId, part });
  };
  const handle = event => {
    const p = event.properties || {};
    if (event.type === 'session.created' && sessions.has(p.info?.parentID)) sessions.add(p.info.id);
    if (event.type === 'message.part.updated') emitPart(p.part);
    // Child failures belong to the parent's task tool. Even main errors can
    // recover (e.g. automatic compaction); only the prompt result is final.
    if (event.type === 'session.error' && p.sessionID === sessionId) mainError = p.error;
    if (event.type === 'permission.asked' && sessions.has(p.sessionID)) {
      if (signal.aborted || requests.has(`permission:${p.id}`)) return;
      requests.add(`permission:${p.id}`);
      (async () => {
        const child = p.sessionID !== sessionId;
        const decision = await onPermission({ ...p, child });
        if (signal.aborted) return;
        // "Siempre" is scoped and remembered by Phantom's conversation, not
        // installed as a broad persistent grant in OpenCode.
        await request(`/permission/${encodeURIComponent(p.id)}/reply`, {
          reply: decision.behavior === 'allow' ? 'once' : 'reject',
          ...(decision.message && !(child && decision.behavior !== 'allow') ? { message: decision.message } : {}),
        });
      })().catch(abort);
    }
    if (event.type === 'question.asked' && sessions.has(p.sessionID)) {
      if (signal.aborted || requests.has(`question:${p.id}`)) return;
      requests.add(`question:${p.id}`);
      (async () => {
        const decision = await onQuestion(p);
        if (signal.aborted) return;
        const allowed = decision.behavior === 'allow';
        await request(`/question/${encodeURIComponent(p.id)}/${allowed ? 'reply' : 'reject'}`, allowed ? { answers: decision.answers } : {});
      })().catch(abort);
    }
  };
  try {
    base = await ready;
    if (sessionId) await request(`/session/${encodeURIComponent(sessionId)}`);
    else {
      const session = await (await request('/session', {})).json();
      if (typeof session.id !== 'string') throw new Error('OpenCode devolvió una sesión inválida');
      sessionId = session.id; sessions.add(sessionId);
    }
    onEvent({ type: 'step_start', sessionID: sessionId });
    const stream = await request('/event', undefined, false);
    reader = stream.body.getReader();
    const reading = (async () => {
      let reconnects = 0;
      while (!signal.aborted && !completed) {
        try {
          const decoder = new TextDecoder(); let text = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) throw new Error('Se cerró el flujo de eventos de OpenCode');
            text += decoder.decode(value, { stream: true });
            // SSE uses blank lines to delimit events; tolerate CRLF and chunks.
            let match;
            while ((match = /\r?\n\r?\n/.exec(text))) {
              const frame = text.slice(0, match.index); text = text.slice(match.index + match[0].length);
              const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (data) handle(JSON.parse(data));
            }
            if (text.length > 8 * 1024 * 1024) throw new Error('Evento de OpenCode demasiado grande');
          }
        } catch (error) {
          if (signal.aborted || completed) return;
          await reader.cancel().catch(() => {});
          // Bound reconnects across the turn, including streams that open then
          // immediately close. Catch-up shares request-id dedupe with live SSE.
          for (;;) {
            if (reconnects === 3) throw error;
            await pause(200 * Math.min(++reconnects, 2));
            try {
              reader = (await request('/event', undefined, false, false)).body.getReader();
              break;
            } catch (next) { signal.throwIfAborted(); if (next.transient === false) throw next; error = next; }
          }
          for (const kind of ['permission', 'question']) {
            const pending = await getJSON(`/${kind}`);
            for (const properties of pending) handle({ type: `${kind}.asked`, properties });
          }
        }
      }
    })().catch(error => { if (!signal.aborted) abort(error); });
    const [providerID, ...modelID] = (model || '').split('/');
    const result = await (await request(`/session/${encodeURIComponent(sessionId)}/message`, {
      parts: [{ type: 'text', text: message }],
      ...(model ? { model: { providerID, modelID: modelID.join('/') } } : {}),
      ...(reasoning ? { variant: reasoning } : {}),
    }, false)).json();
    // The HTTP result also contains final parts: fill gaps if the last SSE
    // packet and the prompt response arrive in different event-loop turns.
    for (const part of result.parts || []) emitPart(part);
    if (result.info?.error) onEvent({ type: 'error', error: { message: [...new Set([errorMessage(result.info.error), ...(mainError ? [errorMessage(mainError)] : [])])].join('\n') } });
    if (failure) throw failure;
    completed = true;
    controller.abort();
    await reader.cancel().catch(() => {}); await reading;
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw new Error(`OpenCode: ${[...new Set([failure?.message || error.message, ...(mainError ? [errorMessage(mainError)] : [])])].join('\n')}`, { cause: error });
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    const kill = name => { try { process.kill(-child.pid, name); } catch { child.kill(name); } };
    // Also signal the group after an unexpected server exit: its tools can
    // still be alive even when the process that launched them is gone.
    kill('SIGTERM');
    const timer = setTimeout(() => kill('SIGKILL'), 1500); timer.unref();
    await stopped; clearTimeout(timer); kill('SIGKILL');
  }
}

export function openCodeServerEnv(env) {
  return { ...env, OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: randomUUID() };
}
