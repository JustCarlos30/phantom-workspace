import React from 'react';
import '../voice.css';

const LABELS = { requesting: 'Esperando permiso del micrófono…', recording: 'Escuchando · micrófono activo', transcribing: 'Transcribiendo · micrófono apagado' };

// Geometry is driven by the analyser, never a simulated listening animation.
export function VoiceActivity({ voice }) {
  if (voice.status === 'idle') return null;
  return <div className="voice-activity" data-state={voice.status} style={{ '--voice-level': voice.level }}>
    <span className="voice-waves" aria-hidden="true">{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ transform: `scaleY(${.08 + voice.level * (.25 + .75 * Math.sin((i + 1) / 18 * Math.PI))})` }} />)}</span>
    <span role="status">{LABELS[voice.status]}</span>
    <button type="button" onClick={voice.cancel}>Cancelar audio</button>
  </div>;
}
