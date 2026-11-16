import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Square, X } from 'lucide-react';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { VoiceActivity } from './VoiceActivity';

export function VoiceDictation({ target, api, connected, onClose }) {
  const [text, setText] = useState(''), [error, setError] = useState(''), [inserting, setInserting] = useState(false);
  const dialog = useRef(null), insertPending = useRef(false);
  const voice = useVoiceRecorder({ api, workspaceId: target.workspaceId, enabled: connected, onText: value => setText(previous => previous ? `${previous}\n${value}` : value) });
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    return () => { requestAnimationFrame(() => { if (previous?.isConnected && (document.activeElement === document.body || document.activeElement?.closest('.voice-dialog'))) previous.focus({ preventScroll: true }); }); };
  }, []);
  useEffect(() => {
    if (target.kind === 'none') return;
    const observer = new MutationObserver(() => { if (!target.valid()) { voice.cancel(); onClose(); } });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-node-id', 'data-provider', 'aria-label', 'aria-labelledby', 'name', 'type', 'disabled', 'readonly', 'contenteditable', 'inert'] });
    return () => observer.disconnect();
  }, [target, voice.cancel, onClose]);
  const close = () => { voice.cancel(); onClose(); };
  const insert = async () => {
    if (insertPending.current) return;
    insertPending.current = true; setInserting(true); setError('');
    try {
      if (!connected || !target.valid?.()) throw new Error('El destino ya no está conectado o disponible. Cierra y selecciona un destino activo.');
      // Terminal dictation is literal text, never control sequences or Enter.
      const value = target.kind === 'terminal' ? text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ') : text;
      await target.insert(value); close();
    } catch (error) { setError(error.message); }
    finally { insertPending.current = false; setInserting(false); }
  };
  return createPortal(<div className="app-modal-backdrop voice-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialog} className="voice-dialog" role="dialog" aria-modal="true" aria-labelledby="voice-dictation-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        event.stopPropagation();
        const controls = [...dialog.current.querySelectorAll('button:not(:disabled),textarea')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <header className="popover-heading"><h2 id="voice-dictation-title">Dictado por voz</h2><button type="button" className="icon-button" aria-label="Cerrar dictado" onClick={close}><X size={17} /></button></header>
      <p>Destino fijado: <strong>{target.label}</strong></p>
      <p>{target.kind === 'terminal' ? 'Revisa el texto antes de insertarlo en esta sesión. Los saltos de línea se convierten en espacios; Enter lo pulsas tú en la terminal.' : target.kind === 'none' ? 'Enfoca un campo de texto o una terminal y vuelve a abrir el dictado. Puedes preparar o copiar texto aquí.' : 'La transcripción se inserta en la selección original. Tu borrador se conserva hasta que pulses Insertar.'}</p>
      <VoiceActivity voice={voice} surface={target.surface} />
      {(voice.error || error) && <p className="voice-error" role="alert">{voice.error || error}</p>}
      {voice.busyElsewhere && <p role="status">Otro dictado está usando el micrófono. Detén o cancela su audio para grabar aquí.</p>}
      <div className="voice-actions"><button type="button" className="button" disabled={!connected || voice.busyElsewhere || ['requesting', 'transcribing'].includes(voice.status)} onClick={voice.status === 'recording' ? voice.stop : voice.start}>{voice.status === 'recording' ? <Square size={14} /> : <Mic size={16} />}{voice.status === 'recording' ? 'Detener y transcribir' : 'Grabar dictado'}</button></div>
      <label>Transcripción editable<textarea rows={5} maxLength={32768} value={text} onChange={event => setText(event.target.value)} /></label>
      <div className="voice-actions"><button type="button" className="button primary" disabled={!text.trim() || target.kind === 'none' || voice.status !== 'idle' || !connected || inserting} onClick={insert}>{inserting ? 'Insertando…' : target.kind === 'terminal' ? 'Insertar en terminal' : 'Insertar en campo'}</button><button type="button" className="button" onClick={close}>Cancelar</button></div>
    </section>
  </div>, document.body);
}
