import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../voice.css';

const LABELS = { requesting: 'Esperando permiso del micrófono…', recording: 'Te escucho…', transcribing: 'Transcribiendo…' };
const MODES = { preparing: 'preparando motor en vivo…', live: 'en vivo', batch: 'se transcribe al detener' };
// Surfaces that light up as a whole while they own the microphone.
export const VOICE_SURFACES = '.canvas-node, .phantom-chat, [data-voice-surface]';

// Geometry is driven by the analyser, never a simulated listening animation.
// The aura wraps the whole card/terminal/dock that is dictating; `surface`
// overrides the default (the nearest surface around this strip).
export function VoiceActivity({ voice, surface = null }) {
  const strip = useRef(null), transcript = useRef(null), [host, setHost] = useState(null);
  const active = voice.status !== 'idle';
  const text = voice.live || voice.liveText || { confirmed: '', partial: '' };
  const level = Number.isFinite(voice.level) ? Math.max(0, Math.min(1, voice.level)) : 0;
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [text.confirmed, text.partial]);
  useLayoutEffect(() => {
    if (!active) { setHost(null); return; }
    const element = surface || strip.current?.closest(VOICE_SURFACES) || null;
    if (!element?.isConnected) { setHost(null); return; }
    element.setAttribute('data-voice-aura', '');
    setHost(element);
    return () => { element.removeAttribute('data-voice-aura'); element.style.removeProperty('--voice-level'); };
  }, [active, surface]);
  // Written straight onto the surface so the aura breathes without re-rendering it.
  useLayoutEffect(() => { if (active && host) host.style.setProperty('--voice-level', String(level)); }, [active, host, level]);
  if (!active) return null;
  const hasText = !!(text.confirmed || text.partial);
  const orbLevel = voice.status === 'recording' ? level : 0;
  return <>
    <div ref={strip} className="voice-activity" data-state={voice.status} data-mode={voice.mode || undefined} style={{ '--voice-level': level }}>
      <div className="voice-activity-row">
        <span className="voice-waves" aria-hidden="true" style={{ animationPlayState: voice.status === 'recording' && orbLevel === 0 ? 'paused' : 'running' }}>{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ transform: `translate(${Math.cos(i * Math.PI / 6) * orbLevel * 5}px, ${Math.sin(i * Math.PI / 6) * orbLevel * 5}px) scale(${.72 + orbLevel * (.18 + .1 * (i % 3))})` }} />)}</span>
        <span role="status" title={voice.status === 'recording' ? MODES[voice.mode] : undefined}>{LABELS[voice.status]}</span>
        <button type="button" onClick={voice.cancel}>Cancelar audio</button>
      </div>
      {(hasText || voice.mode === 'live') && voice.status !== 'requesting' && <p ref={transcript} className="voice-live" aria-live="polite" aria-atomic="true">
        {hasText ? <>{text.confirmed && <span className="voice-live-confirmed">{text.confirmed} </span>}{text.partial && <span className="voice-live-partial">{text.partial}</span>}</> : <span className="voice-live-partial">Habla, te escucho…</span>}
      </p>}
      {voice.notice && <p className="voice-notice">{voice.notice}</p>}
    </div>
    {host && createPortal(<span className="voice-aura" data-state={voice.status} aria-hidden="true"><span className="voice-aura-ring" /><span className="voice-aura-glow" /></span>, host)}
  </>;
}
