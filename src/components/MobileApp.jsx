import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import '../mobile.css';
import { readBrowserPairingCode } from '../phone-pairing.mjs';

const TOKEN_KEY = 'phantom:mobile:bearer';
const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const actionID = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

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
      <textarea id="mobile-input" rows={3} maxLength={terminal ? 15000 : 30000} value={draft} onChange={e => setDraft(e.target.value)} placeholder={terminal ? 'Entrada explícita al proceso existente' : 'Escribe un mensaje…'} />
      <div className="mobile-actions"><button className="mobile-primary" disabled={disabled || !draft.trim() || (terminal && view?.status !== 'running')} type="submit">Enviar</button><button type="button" disabled={disabled || (terminal ? view?.status !== 'running' : !view?.running)} onClick={() => action(terminal ? 'terminal.stop' : 'chat.stop', terminal ? { sessionId: terminal.id } : { nodeId: item.nodeId })}>Parar</button></div>
    </form>
  </section>;
}

export default function MobileApp() {
  const [token, setToken] = useState(readToken), [connected, setConnected] = useState(!!readToken());
  const [code, setCode] = useState(''), [name, setName] = useState('Mi móvil'), [error, setError] = useState('');
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
      const response = await fetch(route, { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: controller.signal });
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
  const pair = async (e, pairingCode = code) => {
    e.preventDefault(); if (writeLock.current) return; writeLock.current = true; setBusy(true); setError('');
    try { const result = await request('/api/pair', { code: pairingCode.trim(), name }); saveToken(result.token); setCode(''); setCatalog(null); setSelected(null); setConnected(true); }
    catch (e) { setError(e.message || 'No se pudo conectar. Comprueba el acceso en Ajustes.'); }
    finally { writeLock.current = false; setBusy(false); }
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      const value = readBrowserPairingCode(location.hash);
      if (!value) return;
      setCode(value);
      history.replaceState(history.state, '', location.pathname + location.search);
      pair({ preventDefault() {} }, value);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const item = catalog?.sessions.find(s => s.nodeId === selected?.nodeId), terminal = item?.terminals.find(t => t.id === selected?.sessionId);
  const open = (session, terminalId) => { setSelected({ nodeId: session.nodeId, sessionId: terminalId || null }); setView(null); };
  return <main className="mobile-app">
    <header className="mobile-heading"><div><h1>Phantom</h1><p>{catalog?.workspace.name || 'Conexión móvil local'}</p></div><span role="status">{connected ? 'Conectado' : 'Desconectado'}</span></header>
    {error && <div className="mobile-error" role="alert">{error}</div>}
    {!token ? <form className="mobile-pair" onSubmit={pair}><h2>Emparejar con tu escritorio</h2><p>Escanea el QR en Configuración &gt; Teléfono de Phantom o pega el código</p><label>Nombre del dispositivo<input maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label><label>Código de emparejamiento<input autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={128} value={code} onChange={e => setCode(e.target.value)} /></label><button className="mobile-primary" disabled={busy} type="submit">Emparejar</button></form> : <>
      {!connected && <div className="mobile-actions"><button disabled={busy} onClick={() => { setError(''); setConnected(true); setRevision(n => n + 1); }}>Reconectar</button><button onClick={() => disconnect('Introduce un código nuevo generado en Ajustes.', true)}>Emparejar de nuevo</button></div>}
      {item ? <Session key={`${item.nodeId}:${selected.sessionId}`} item={item} terminal={terminal} view={view} connected={connected} busy={busy} action={action} onBack={() => { setSelected(null); setView(null); }} /> : <section className="mobile-list"><h2>Sesiones</h2>{!catalog ? <p>Consultando sesiones…</p> : !catalog.sessions.length ? <p>No hay sesiones en este proyecto.</p> : catalog.sessions.map(session => <article key={session.nodeId}><h3>{session.title}</h3>{session.kind === 'chat' && <button disabled={!connected} onClick={() => open(session)}>Abrir conversación · {session.provider}</button>}{session.terminals.map(t => <button key={t.id} disabled={!connected} onClick={() => open(session, t.id)}>Abrir terminal · {t.status} · {t.createdAt ? new Date(t.createdAt).toLocaleString() : ''}</button>)}{session.kind !== 'chat' && !session.terminals.length && <p className="mobile-muted">Sin proceso existente. Inícialo desde el escritorio.</p>}</article>)}</section>}
    </>}
  </main>;
}
