import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Square, X } from 'lucide-react';
import { Button, DataView, ErrorNotice, Field, NativeForm, ToolErrorBoundary, useOperation } from './ToolPanels.jsx';
import { Presence } from './Presence';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { VoiceActivity } from './VoiceActivity';
import '../tools.css';

export function VoiceCapture(props) {
  return createPortal(<Presence show={props.open}>{props.open && <ToolErrorBoundary key={props.workspace?.id || 'voice'} title="Voz e intención" onClose={props.onClose}><VoiceCaptureContent {...props} /></ToolErrorBoundary>}</Presence>, document.body);
}

function VoiceCaptureContent({ workspace, api, refresh, notify, onClose, initialText = '', connected = true }) {
  const [text, setText] = useState(initialText), [provider, setProvider] = useState(null);
  const [intent, setIntent] = useState(null), [action, setAction] = useState('task'), [title, setTitle] = useState('');
  const [results, setResults] = useState(null), [nativeCard, setNativeCard] = useState(false);
  const generation = useRef(0), dialog = useRef(null), first = useRef(null);
  const voice = useVoiceRecorder({ api, workspaceId: workspace?.id, enabled: connected, onText: (value, result) => { setText(previous => previous.trim() ? `${previous.trimEnd()} ${value}` : value); setProvider(result?.provider); setIntent(null); } });
  const { status, start, stop } = voice;
  const op = useOperation(notify);
  useEffect(() => {
    const previous = document.activeElement;
    first.current?.focus();
    return () => { generation.current++; previous?.focus?.(); };
  }, [workspace?.id]);
  const close = () => { generation.current++; voice.cancel(); setText(''); setIntent(null); onClose(); };
  const analyze = () => op.run(async () => {
    const token = generation.current;
    const value = await api('voice.intent', { workspaceId: workspace.id, text });
    if (token !== generation.current) return;
    setIntent(value); setAction(value.action); setTitle(value.title || value.query || value.text); setNativeCard(false); setResults(null);
  });
  const execute = () => op.run(async () => {
    const token = generation.current;
    if (action === 'task' || action === 'card') {
      if (!title.trim()) throw new Error('Escribe un título para el borrador.');
      await api('task.create', { workspaceId: workspace.id, kind: 'draft', status: 'todo', title: title.trim(), description: text, refs: [] });
      await refresh(); notify?.('Borrador local creado; no se inició ninguna ejecución.', 'success');
    } else if (action === 'search') {
      const value = await api('context.scan', { workspaceId: workspace.id, query: title });
      if (token === generation.current) setResults(value);
    } else if (action === 'open') {
      let url; try { url = new URL(title.trim()); } catch { throw new Error('Para abrir un navegador escribe una URL completa http o https. Para localizar documentos elige Buscar contexto.'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo se admiten direcciones http o https.');
      await api('node.create', { workspaceId: workspace.id, type: 'browser', title: url.host, data: { url: url.href } });
      await refresh(); notify?.('Panel de navegador creado en el workspace.', 'success');
    }
  });
  const statusText = { idle: 'Micrófono apagado', requesting: 'Esperando permiso del micrófono', recording: 'Grabando · micrófono activo · máximo 2 minutos', transcribing: 'Micrófono apagado · transcribiendo audio' }[status];
  return <div className="tw-overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div className="tw-voice" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="tw-voice-title" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') { const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary')]; const start = controls[0], end = controls.at(-1); if (e.shiftKey && document.activeElement === start) { e.preventDefault(); end?.focus(); } else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); start?.focus(); } }
  }}><header className="tw-inspector-header"><h2 id="tw-voice-title">Voz e intención</h2><Button icon={X} aria-label="Cancelar y cerrar captura" onClick={close} /></header><div className="tw-content"><p className="tw-target"><b>Destino explícito: {workspace?.name || 'Sin workspace'}</b><span title={workspace?.canonicalPath || workspace?.path}>{workspace?.canonicalPath || workspace?.path}</span></p><p className={`tw-recording ${status === 'recording' ? 'tw-live' : ''}`} role="status"><Mic size={16} aria-hidden="true" />{statusText}</p>
    <VoiceActivity voice={voice} />
    <div className="tw-row"><Button ref={first} icon={status === 'recording' ? Square : Mic} tone={status === 'recording' ? 'danger' : 'primary'} disabled={!workspace || !connected || op.busy || voice.busyElsewhere || ['requesting', 'transcribing'].includes(status)} onClick={status === 'recording' ? stop : start}>{status === 'recording' ? 'Detener y transcribir' : 'Iniciar grabación manual'}</Button>{status === 'idle' && <Button onClick={() => { voice.cancel(); op.clear(); }}>Cancelar audio</Button>}</div>
    {voice.busyElsewhere && <p role="status" className="tw-muted">Otro dictado está usando el micrófono. Detén o cancela su audio antes de grabar aquí.</p>}
    <p className="tw-muted">El micrófono solo se activa al pulsar grabar (máximo 1 MiB o 2 minutos). Si ASR no está disponible, escribe el texto y continúa. Ninguna intención ejecuta acciones automáticamente.</p><ErrorNotice error={voice.error} clear={voice.clearError} /><ErrorNotice error={op.error} clear={op.clear} />{op.busy && <p role="status" className="tw-muted">Procesando solicitud…</p>}
    <Field label="Transcripción editable / texto escrito" hint={provider ? `Última transcripción: proveedor ${provider}` : 'Texto manual disponible sin proveedor de voz.'}><textarea rows={5} maxLength={32768} value={text} onChange={e => { setText(e.target.value); setIntent(null); }} /></Field><Button disabled={op.busy || !text.trim() || status !== 'idle'} onClick={analyze}>Interpretar como borrador editable</Button>
    {intent && <section className="tw-section"><h3>Revisar antes de aplicar</h3><DataView value={intent} label="Intención propuesta (sin ejecutar)" /><Field label="Acción explícita"><select value={action} onChange={e => { setAction(e.target.value); setNativeCard(false); setResults(null); }}><option value="task">Crear borrador local</option><option value="decision">Declarar decisión en Phantom</option><option value="card">Preparar card Phantom</option><option value="search">Buscar contexto</option><option value="open">Crear panel de navegador</option></select></Field>
      {action === 'decision' ? <NativeForm key={`decision:${text}`} kind="decision" workspace={workspace} api={api} refresh={refresh} notify={notify} initialText={text} /> : <><Field label={action === 'open' ? 'URL a abrir' : action === 'search' ? 'Consulta de contexto' : 'Título editable'}><input value={title} onChange={e => setTitle(e.target.value)} /></Field>{action === 'card' && <><p className="tw-warning">El dictado no contiene por sí solo un contrato válido. Puedes guardar un borrador local o completar el contrato nativo antes de crear la card.</p><Button onClick={() => setNativeCard(!nativeCard)}>{nativeCard ? 'Cerrar contrato sin guardar' : 'Completar contrato de card'}</Button>{nativeCard && <NativeForm kind="card" workspace={workspace} api={api} refresh={refresh} notify={notify} initialText={text} />}</>}<Button tone="primary" disabled={op.busy || !title.trim()} onClick={execute}>{action === 'open' ? 'Crear navegador con esta URL' : action === 'search' ? 'Buscar en fuentes permitidas' : 'Crear borrador local revisado'}</Button></>}
      {results && <><p className="tw-muted">{results.items?.length || 0} resultados reales{results.truncated ? ' · listado truncado; afina la consulta' : ''}</p><DataView value={results} label="Resultados de contexto" /></>}
    </section>}<Button onClick={close}>Cancelar y cerrar</Button></div></div></div>;
}
