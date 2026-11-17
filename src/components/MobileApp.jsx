import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import '../mobile.css';
import { readBrowserPairingCode } from '../phone-pairing.mjs';

const initialPairCode = readBrowserPairingCode(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
const TOKEN_KEY = 'phantom:mobile:bearer';
const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const actionID = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const digest = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
const defaultName = () => `${/Android/.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'Teléfono'} · ${/Edg/.test(navigator.userAgent) ? 'Edge' : /Firefox/.test(navigator.userAgent) ? 'Firefox' : /Chrome|CriOS/.test(navigator.userAgent) ? 'Chrome' : 'Safari'}`;
function keysDB(value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('phantom-mobile', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keys');
    open.onerror = () => reject(new Error('No se pudo abrir el almacén de llaves; vuelve a vincular'));
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('keys', value ? 'readwrite' : 'readonly'), store = tx.objectStore('keys');
      const request = value ? store.put(value, 'device') : store.get('device');
      tx.oncomplete = () => { resolve(request.result); db.close(); };
      tx.onabort = tx.onerror = () => { reject(new Error('No se pudo guardar o leer la llave del dispositivo')); db.close(); };
    };
  });
}

function Question({ part, disabled, answer }) {
  const [answers, setAnswers] = useState({});
  return <form className="mobile-prompt" onSubmit={e => { e.preventDefault(); answer(answers); }}>
    <strong>Pregunta pendiente</strong>
    {part.questions.map((q, i) => <label key={i}>{q.question}
      {!!q.options?.length && <small>{q.options.map(option => option.label).join(' · ')}</small>}
      <textarea required maxLength={4000} value={answers[q.question] || ''} onChange={e => setAnswers({ ...answers, [q.question]: e.target.value })} />
    </label>)}
    <div className="mobile-actions"><button disabled={disabled} type="submit">Responder</button><button disabled={disabled} type="button" onClick={() => answer(null)}>Omitir</button></div>
  </form>;
}

function Session({ item, view, terminal, connected, busy, action, onBack }) {
  const [draft, setDraft] = useState(''), [atEnd, setAtEnd] = useState(true);
  const scroller = useRef(null), follow = useRef(true);
  useLayoutEffect(() => {
    if (follow.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [view]);
  const bottom = () => { follow.current = true; setAtEnd(true); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'auto' }); };
  const disabled = busy || !connected;
  const send = async e => {
    e.preventDefault(); if (!draft.trim() || disabled) return;
    const ok = await action(terminal ? 'terminal.write' : 'chat.send', terminal ? { sessionId: terminal.id, data: draft + '\r' } : { nodeId: item.nodeId, text: draft });
    if (ok) { setDraft(''); bottom(); }
  };
  return <section className="mobile-session">
    <header><button onClick={onBack}>← Sesiones</button><h2>{item.title}</h2><span>{terminal ? view?.status || terminal.status : view?.running ? 'Respondiendo' : item.provider}</span></header>
    <div className="mobile-thread" ref={scroller} role="log" aria-label={terminal ? 'Salida de terminal' : 'Conversación'} onScroll={() => { const el = scroller.current; follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48; setAtEnd(follow.current); }}>
    {!view ? <p>Cargando sesión…</p> : terminal ? <><p className="mobile-muted">Pantalla reciente, hasta 40 líneas de historial · la entrada solo se envía con el botón.</p><pre>{view.text || view.lines?.join('\n') || 'Sin salida.'}</pre></> : <>
        {view.truncated && <p className="mobile-muted">Vista acotada a los mensajes recientes y sus primeras 100 partes. El hilo completo está en el escritorio.</p>}
        {!view.messages.length && <p className="mobile-muted">No hay mensajes. Escribe para conversar con esta sesión.</p>}
        {view.messages.map(message => <article key={message.id} className="mobile-message"><strong>{message.role === 'user' ? 'Tú' : 'Asistente'}</strong>
          {message.parts.map((part, i) => part.type === 'question' && part.status === 'pending' ? <Question key={part.id} part={part} disabled={disabled} answer={answers => action('chat.question.answer', { nodeId: item.nodeId, requestId: part.id, answers })} /> : part.type === 'permission' && part.status === 'pending' ? <div className="mobile-prompt" key={part.id}><strong>Permiso pendiente: {part.tool}</strong><p>{part.detail}</p><p>{part.reason}</p><div className="mobile-actions"><button disabled={disabled} onClick={() => action('chat.permission.answer', { nodeId: item.nodeId, requestId: part.id, decision: 'allow' })}>Permitir una vez</button><button disabled={disabled} onClick={() => action('chat.permission.answer', { nodeId: item.nodeId, requestId: part.id, decision: 'deny' })}>Rechazar</button></div></div> : <div key={part.id || i}>{part.type === 'text' ? <p>{part.text}</p> : part.type === 'tool' ? <details><summary>{part.name} · {part.status}</summary><pre>{part.detail}</pre></details> : part.type === 'permission' || part.type === 'question' ? <small>{part.type === 'permission' ? 'Permiso' : 'Pregunta'} · {part.status}</small> : null}</div>)}
          {message.error && <p role="alert">{message.error}</p>}
        </article>)}
        {!!view.queue?.length && <p role="status">{view.queue.length} mensaje(s) en cola. Gestiona la cola desde el escritorio.</p>}
      </>}
    </div>
    {!atEnd && <button className="mobile-bottom" onClick={bottom}>Volver al final ↓</button>}
    <form className="mobile-composer" onSubmit={send}>
      <label htmlFor="mobile-input">{terminal ? 'Entrada de terminal' : 'Mensaje'}</label>
      <textarea id="mobile-input" rows={3} maxLength={terminal ? 15000 : undefined} value={draft} onChange={e => setDraft(e.target.value)} placeholder={terminal ? 'Entrada explícita al proceso existente' : 'Escribe un mensaje…'} />
      <div className="mobile-actions"><button className="mobile-primary" disabled={disabled || !draft.trim() || (terminal && view?.status !== 'running')} type="submit">Enviar</button><button type="button" disabled={disabled || (terminal ? view?.status !== 'running' : !view?.running)} onClick={() => action(terminal ? 'terminal.stop' : 'chat.stop', terminal ? { sessionId: terminal.id } : { nodeId: item.nodeId })}>Parar</button></div>
    </form>
  </section>;
}

export default function MobileApp() {
  const [token, setToken] = useState(() => initialPairCode ? '' : readToken()), [connected, setConnected] = useState(() => !initialPairCode && !!readToken());
  const [code, setCode] = useState(initialPairCode), [name, setName] = useState(defaultName), [error, setError] = useState(() => crypto.subtle ? '' : 'Abre la dirección https:// de Ajustes');
  const [pending, setPending] = useState(null), [time, setTime] = useState(Date.now());
  const autoPair = useRef(false), pairingGeneration = useRef(0);
  const [catalog, setCatalog] = useState(null), [selected, setSelected] = useState(null), [view, setView] = useState(null);
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const controllers = useRef(new Set()), writeLock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const controller of controllers.current) controller.abort(); }; }, []);
  const saveToken = value => { sessionStorage.setItem(TOKEN_KEY, value); setToken(value); };
  const disconnect = useCallback((message, unauthorized = false) => {
    setConnected(false); setError(message);
    if (unauthorized) { try { sessionStorage.removeItem(TOKEN_KEY); } catch {} setToken(''); setCatalog(null); setView(null); setSelected(null); }
  }, []);
  const request = useCallback(async (route, body, signal) => {
    const controller = new AbortController(); controllers.current.add(controller);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 12000);
    try {
      const rawBody = JSON.stringify(body), headers = { 'Content-Type': 'application/json' };
      if (route === '/api/rpc') {
        if (!crypto.subtle) throw Object.assign(new Error('Abre la dirección https:// de Ajustes'), { status: 401 });
        const saved = await keysDB();
        if (!saved?.keys?.privateKey || saved.token !== token) throw Object.assign(new Error('Falta la llave del dispositivo; vuelve a vincular'), { status: 401 });
        const time = String(Date.now()), signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, saved.keys.privateKey, new TextEncoder().encode(`${time}\n${route}\n${hex(await digest(rawBody))}`));
        Object.assign(headers, { Authorization: `Bearer ${token}`, 'X-Phantom-Time': time, 'X-Phantom-Signature': btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') });
      }
      const response = await fetch(route, { method: 'POST', credentials: 'omit', cache: 'no-store', headers, body: rawBody, signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || 'Solicitud rechazada'), { status: response.status });
      return data;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); signal?.removeEventListener('abort', abort); }
  }, [token]);
  useEffect(() => {
    if (!connected || !token) return;
    let cancelled = false, timer, activeController, reading = false;
    const poll = async () => {
      if (cancelled || document.hidden || reading) return;
      reading = true; activeController = new AbortController();
      try {
        const { result } = await request('/api/rpc', { method: 'sessions.list' }, activeController.signal);
        if (cancelled) return; setCatalog(result);
        if (selected) {
          const item = result.sessions.find(s => s.nodeId === selected.nodeId);
          if (!item || (selected.sessionId && !item.terminals.some(t => t.id === selected.sessionId))) { setSelected(null); setView(null); return; }
          const { result: thread } = await request('/api/rpc', { method: selected.sessionId ? 'terminal.attach' : 'chat.get', payload: selected.sessionId ? { sessionId: selected.sessionId } : { nodeId: item.nodeId } }, activeController.signal);
          if (!cancelled) setView(thread);
        }
      } catch (e) { if (!cancelled && !activeController.signal.aborted) disconnect(e.status ? e.message : 'Desconectado. Comprueba la Wi-Fi y el acceso en Ajustes.', e.status === 401); }
      finally { reading = false; if (!cancelled && !document.hidden) timer = setTimeout(poll, 2000); }
    };
    const visibility = () => { clearTimeout(timer); if (document.hidden) activeController?.abort(); else { if (reading) timer = setTimeout(poll, 100); else poll(); } };
    document.addEventListener('visibilitychange', visibility); poll();
    return () => { cancelled = true; clearTimeout(timer); activeController?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [token, connected, selected, revision, request, disconnect]);
  const action = async (method, payload) => {
    if (writeLock.current || !connected) return false;
    writeLock.current = true; setBusy(true); setError('');
    try { await request('/api/rpc', { method, payload, requestId: actionID() }); if (mounted.current) setRevision(n => n + 1); return true; }
    catch (e) { if (mounted.current) disconnect(`${e.status ? e.message : 'Respuesta no confirmada.'} No se reenvió la acción. Reconecta y consulta la sesión antes de volver a enviarla.`, e.status === 401); return false; }
    finally { writeLock.current = false; if (mounted.current) setBusy(false); }
  };
  const pair = async e => {
    e?.preventDefault(); if (writeLock.current) return; writeLock.current = true; setBusy(true); setError('');
    const generation = ++pairingGeneration.current;
    try {
      if (!crypto.subtle) throw new Error('Abre la dirección https:// de Ajustes');
      const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      const exported = await crypto.subtle.exportKey('jwk', keys.publicKey), publicKey = Object.fromEntries(['kty', 'crv', 'x', 'y'].map(k => [k, exported[k]]));
      await keysDB({ keys, token: '' });
      const sas = String(new DataView(await digest(`${code.trim()}\n${publicKey.x}.${publicKey.y}`)).getUint32(0) % 1000000).padStart(6, '0');
      const result = await request('/api/pair', { code: code.trim(), name, publicKey });
      if (mounted.current && generation === pairingGeneration.current) { setPending({ ...result, sas, keys }); setCode(''); setConnected(false); saveToken(''); }
    }
    catch (e) { if (mounted.current) setError(e.message || 'No se pudo conectar. Comprueba el acceso en Ajustes.'); }
    finally { writeLock.current = false; setBusy(false); }
  };
  useEffect(() => { if (initialPairCode && !autoPair.current) { autoPair.current = true; pair(); } }, []);
  useEffect(() => {
    if (!pending) return;
    let cancelled = false, timer; const controller = new AbortController();
    const clock = setInterval(() => setTime(Date.now()), 1000);
    const poll = async () => {
      try {
        const result = await request('/api/pair/status', { requestId: pending.requestId, poll: pending.poll }, controller.signal);
        if (cancelled) return;
        if (result.state === 'approved') {
          await keysDB({ keys: pending.keys, token: result.token });
          if (cancelled) return; saveToken(result.token); setPending(null); setCatalog(null); setSelected(null); setConnected(true); return;
        }
        if (result.state !== 'pending') { setPending(null); setError(result.state === 'rejected' ? 'Vinculación rechazada. Escanea de nuevo el QR de Ajustes.' : 'La solicitud ha caducado. Escanea de nuevo el QR de Ajustes.'); return; }
        timer = setTimeout(poll, 1000);
      } catch (e) { if (!cancelled) { setPending(null); setError(e.message || 'No se pudo consultar la aprobación. Escanea de nuevo el QR de Ajustes.'); } }
    };
    poll(); return () => { cancelled = true; controller.abort(); clearTimeout(timer); clearInterval(clock); };
  }, [pending, request]);
  const item = catalog?.sessions.find(s => s.nodeId === selected?.nodeId), terminal = item?.terminals.find(t => t.id === selected?.sessionId);
  const open = (session, terminalId) => { setSelected({ nodeId: session.nodeId, sessionId: terminalId || null }); setView(null); };
  return <main className="mobile-app">
    <header className="mobile-heading"><div><h1>Phantom</h1><p>{catalog?.workspace.name || 'Conexión móvil local'}</p></div><span role="status">{connected ? 'Conectado' : 'Desconectado'}</span></header>
    {error && <div className="mobile-error" role="alert">{error}</div>}
    {pending ? <section className="mobile-pair"><h2>Esperando aprobación</h2><strong className="mobile-sas">{pending.sas.slice(0, 3)} {pending.sas.slice(3)}</strong><p>Compáralo con el que aparece en tu escritorio y pulsa Vincular allí</p><p role="status">Caduca en {Math.max(0, Math.ceil((pending.expiresAt - time) / 1000))} s</p><button onClick={() => { pairingGeneration.current++; setPending(null); setError('Vinculación cancelada. Escanea de nuevo el QR de Ajustes.'); }}>Cancelar</button></section> : !token ? <form className="mobile-pair" onSubmit={pair}><h2>Emparejar con tu escritorio</h2><p>En la misma Wi-Fi, escanea el QR de Ajustes de Phantom o pega el código temporal. Compara la huella del certificado antes de vincular.</p><label>Nombre del dispositivo<input maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label><label>Código de emparejamiento<input autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={128} value={code} onChange={e => setCode(e.target.value)} /></label><button className="mobile-primary" disabled={busy} type="submit">Emparejar</button></form> : <>
      {!connected && <div className="mobile-actions"><button disabled={busy} onClick={() => { setError(''); setConnected(true); setRevision(n => n + 1); }}>Reconectar</button><button onClick={() => disconnect('Introduce un código nuevo generado en Ajustes.', true)}>Emparejar de nuevo</button></div>}
      {item ? <Session key={`${item.nodeId}:${selected.sessionId}`} item={item} terminal={terminal} view={view} connected={connected} busy={busy} action={action} onBack={() => { setSelected(null); setView(null); }} /> : <section className="mobile-list"><h2>Sesiones</h2>{!catalog ? <p>Consultando sesiones…</p> : !catalog.sessions.length ? <p>No hay sesiones en este proyecto.</p> : catalog.sessions.map(session => <article key={session.nodeId}><h3>{session.title}</h3>{session.kind === 'chat' && <button disabled={!connected} onClick={() => open(session)}>Abrir conversación · {session.provider}</button>}{session.terminals.map(t => <button key={t.id} disabled={!connected} onClick={() => open(session, t.id)}>Abrir terminal · {t.status} · {t.createdAt ? new Date(t.createdAt).toLocaleString() : ''}</button>)}{session.kind !== 'chat' && !session.terminals.length && <p className="mobile-muted">Sin proceso existente. Inícialo desde el escritorio.</p>}</article>)}</section>}
    </>}
  </main>;
}
