import { randomUUID } from 'node:crypto';

// `opencode run` answers permission.asked with reject before a host can ask
// the user. Own a loopback server instead and answer through its HTTP API.
// The caller owns the process group; this transport never starts a model CLI.
export async function driveOpenCode(child, { cwd, sessionId, message, model, reasoning, password, onEvent, onPermission, onQuestion }) {
  const controller = new AbortController(), signal = controller.signal;
  let base, reader, failure, buffer = '';
  const stopped = new Promise(resolve => child.once('close', resolve));
  const abort = error => { failure ??= error; controller.abort(error); };
  child.once('error', error => abort(error));
  child.once('close', code => abort(new Error(`OpenCode terminó antes de completar la respuesta (${code ?? 'señal'})`)));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OpenCode no inició su servidor local en 30 segundos')), 30000);
    const cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
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
  const request = async (route, body, bounded = true) => {
    const response = await fetch(`${base}${route}?directory=${encodeURIComponent(cwd)}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: bounded ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : signal,
    });
    if (!response.ok) throw new Error(`OpenCode ${route}: HTTP ${response.status}`);
    return response;
  };
  const seen = new Map(), sessions = new Set(sessionId ? [sessionId] : []);
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
    if (event.type === 'session.error' && sessions.has(p.sessionID)) onEvent({ type: 'error', error: p.error });
    if (event.type === 'permission.asked' && sessions.has(p.sessionID)) {
      (async () => {
        const decision = await onPermission(p);
        if (signal.aborted) return;
        // "Siempre" is scoped and remembered by Phantom's conversation, not
        // installed as a broad persistent grant in OpenCode.
        await request(`/permission/${encodeURIComponent(p.id)}/reply`, {
          reply: decision.behavior === 'allow' ? 'once' : 'reject',
          ...(decision.message ? { message: decision.message } : {}),
        });
      })().catch(abort);
    }
    if (event.type === 'question.asked' && sessions.has(p.sessionID)) {
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
      const decoder = new TextDecoder(); let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) { if (!signal.aborted) abort(new Error('Se cerró el flujo de eventos de OpenCode')); return; }
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
    if (result.info?.error) onEvent({ type: 'error', error: result.info.error });
    if (failure) throw failure;
    controller.abort();
    await reader.cancel().catch(() => {}); await reading;
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw new Error(`OpenCode: ${failure?.message || error.message}`, { cause: error });
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
