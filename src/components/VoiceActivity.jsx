import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Mic, X } from 'lucide-react';
import { mergeDictation } from '../hooks/voice-send.mjs';
import '../voice.css';

const LABELS = { requesting: 'Esperando permiso del micrófono…', recording: 'Dictando', transcribing: 'Transcribiendo…' };
const MODES = { preparing: 'preparando motor en vivo…', live: 'en vivo', batch: 'se transcribe al detener' };
export const VOICE_SURFACES = '.canvas-node, .phantom-chat, [data-voice-surface]';

export function dictationPreview(voice, draft) {
  if (voice.status === 'idle') return draft;
  const text = voice.live || voice.liveText || {};
  const confirmed = text.confirmed ? mergeDictation(draft, text.confirmed) : draft;
  return text.partial ? mergeDictation(confirmed, text.partial) : confirmed;
}

export function VoiceTranscript({ voice, draft = '' }) {
  const transcript = useRef(null);
  const text = voice.live || voice.liveText || {};
  const confirmed = text.confirmed ? mergeDictation(draft, text.confirmed) : draft;
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [confirmed, text.partial]);
  if (voice.status === 'idle') return null;
  return <div ref={transcript} className="voice-live" aria-live="polite" aria-atomic="true">
    <span className="voice-live-confirmed">{confirmed}</span>{text.partial && <span className="voice-live-partial">{confirmed ? ' ' : ''}{text.partial}</span>}
  </div>;
}

export function VoiceActivity({ voice, onFinish, hint, finishLabel = 'Terminar dictado y revisar' }) {
  const root = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const focusField = () => root.current?.closest('.pc-composer, .voice-review')?.querySelector('textarea')?.focus({ preventScroll: true });
  useLayoutEffect(() => { if (voice.status !== 'idle') focusField(); }, [voice.status]);
  useEffect(() => {
    if (voice.status === 'idle' || voice.status === 'requesting') { setSeconds(0); return; }
    if (voice.status !== 'recording') return;
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [voice.status]);
  if (voice.status === 'idle') return null;
  const level = voice.status === 'recording' && Number.isFinite(voice.level) ? Math.max(0, Math.min(1, voice.level)) : 0;
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return <div ref={root} className="voice-activity" data-state={voice.status} data-mode={voice.mode || undefined} style={{ '--voice-level': level }}>
    <div className="voice-meter" role="status" aria-label={`${LABELS[voice.status]}, ${time}`} title={MODES[voice.mode]}>
      <Mic size={16} aria-hidden="true" />
      <span className="voice-bars" aria-hidden="true">{[.375, .75, 1, .625, .875, .375].map((weight, i) => <i key={i} style={{ '--bar-level': level * weight }} />)}</span>
      <time dateTime={`PT${seconds}S`}>{time}</time>
    </div>
    {voice.status !== 'recording' && <span className="voice-status">{LABELS[voice.status]}</span>}
    {hint && <span className="voice-hint">{hint}</span>}
    <button type="button" className="voice-discard" aria-label="Descartar dictado" title="Descartar dictado · Esc" onClick={() => { focusField(); voice.cancel(); }}><X size={18} /></button>
    {onFinish && <button type="button" className="voice-finish" aria-label={finishLabel} title={finishLabel} disabled={voice.status !== 'recording'} onClick={onFinish}><Check size={18} /></button>}
    {voice.notice && <p className="voice-notice">{voice.notice}</p>}
  </div>;
}
