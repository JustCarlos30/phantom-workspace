import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../voice.css';

const LABELS = { requesting: 'Esperando permiso del micrófono…', recording: 'Escuchando', transcribing: 'Cerrando transcripción · micrófono apagado' };
const MODES = { preparing: 'preparando motor en vivo…', live: 'en vivo', batch: 'se transcribe al detener' };
// Surfaces that light up as a whole while they own the microphone.
export const VOICE_SURFACES = '.canvas-node, .phantom-chat, [data-voice-surface]';

// Geometry is driven by the analyser, never a simulated listening animation.
// The aura wraps the whole card/terminal/dock that is dictating; `surface`
// overrides the default (the nearest surface around this strip).
export function VoiceActivity({ voice, surface = null }) {
  const strip = useRef(null), [host, setHost] = useState(null);
  const active = voice.status !== 'idle';
  useLayoutEffect(() => {
    if (!active) { setHost(null); return; }
    const element = surface || strip.current?.closest(VOICE_SURFACES) || null;
    if (!element?.isConnected) { setHost(null); return; }
    element.setAttribute('data-voice-aura', '');
    setHost(element);
    return () => { element.removeAttribute('data-voice-aura'); element.style.removeProperty('--voice-level'); };
  }, [active, surface]);
  // Written straight onto the surface so the aura breathes without re-rendering it.
  if (host) host.style.setProperty('--voice-level', String(voice.level));
  if (!active) return null;
  const text = voice.live || { confirmed: '', partial: '' };
  const hasText = !!(text.confirmed || text.partial);
  return <>
    <div ref={strip} className="voice-activity" data-state={voice.status} data-mode={voice.mode || undefined} style={{ '--voice-level': voice.level }}>
      <div className="voice-activity-row">
        <span className="voice-waves" aria-hidden="true">{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ transform: `scaleY(${.08 + voice.level * (.25 + .75 * Math.sin((i + 1) / 18 * Math.PI))})` }} />)}</span>
        <span role="status">{LABELS[voice.status]}{voice.status === 'recording' && voice.mode ? ` · ${MODES[voice.mode]}` : ''}</span>
        <button type="button" onClick={voice.cancel}>Cancelar audio</button>
      </div>
      {(hasText || voice.mode === 'live') && voice.status !== 'requesting' && <p className="voice-live" aria-live="polite">
        {hasText ? <>{text.confirmed && <span className="voice-live-confirmed">{text.confirmed} </span>}{text.partial && <span className="voice-live-partial">{text.partial}</span>}</> : <span className="voice-live-partial">Habla; el texto aparecerá aquí mientras lo reconozco.</span>}
      </p>}
      {voice.notice && <p className="voice-notice">{voice.notice}</p>}
    </div>
    {host && createPortal(<span className="voice-aura" data-state={voice.status} aria-hidden="true"><span className="voice-aura-ring" /><span className="voice-aura-glow" /></span>, host)}
  </>;
}
