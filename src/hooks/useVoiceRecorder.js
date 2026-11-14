import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// One lease covers permission, capture AND transcription across every surface.
let microphoneOwner = null;
let activeCapture = null;
export function cancelVoiceRecording(scopePrefix) {
  if (activeCapture && (!scopePrefix || String(activeCapture.scopeId).startsWith(scopePrefix))) activeCapture.cancel();
}
const listeners = new Set();
const subscribeMicrophone = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const publish = () => listeners.forEach(listener => listener());

// Leave room for Base64 and RPC framing beneath the host's 2 MiB message cap.
const MAX_AUDIO = 1024 * 1024;
const MAX_MS = 120000;
const blobBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('No se pudo leer la grabación.'));
  reader.readAsDataURL(blob);
});

// Manual dictation: the microphone is live only between start() and stop().
// The recording is transcribed by the host (voice.transcribe) and handed to
// onText; nothing is sent anywhere else and no action runs on its own.
export function useVoiceRecorder({ api, workspaceId, scopeId = workspaceId, enabled = true, onText }) {
  const [status, setStatus] = useState('idle'); // idle | requesting | recording | transcribing
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const recorder = useRef(null), stream = useRef(null), timer = useRef(null), generation = useRef(0), meter = useRef(null), cancelled = useRef(false);
  const owner = useRef(Symbol('voice')), phase = useRef('idle');
  const lease = useSyncExternalStore(subscribeMicrophone, () => microphoneOwner);
  const transition = value => { phase.current = value; setStatus(value); };
  const release = () => { if (microphoneOwner === owner.current) { microphoneOwner = null; activeCapture = null; publish(); } };
  const onTextRef = useRef(onText); onTextRef.current = onText;
  const stopTracks = () => {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    clearTimeout(timer.current);
    if (meter.current) { cancelAnimationFrame(meter.current.frame); meter.current.context.close().catch(() => {}); meter.current = null; }
    setLevel(0);
  };
  const dispose = useCallback(() => {
    generation.current++;
    const current = recorder.current;
    if (current) { current.ondataavailable = null; current.onstop = null; current.onerror = null; if (current.state !== 'inactive') current.stop(); }
    recorder.current = null; stopTracks(); release(); phase.current = 'idle';
  }, []);
  useEffect(() => { transition('idle'); setError(''); return dispose; }, [dispose, workspaceId, scopeId]);
  useEffect(() => { if (!enabled) { dispose(); transition('idle'); } }, [enabled, dispose]);
  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') { cancelled.current = false; transition('transcribing'); recorder.current.stop(); stopTracks(); }
  }, []);
  const cancel = useCallback(() => { cancelled.current = true; dispose(); transition('idle'); setError(''); }, [dispose]);
  const start = useCallback(async () => {
    if (phase.current !== 'idle' || !workspaceId || !enabled) return;
    if (microphoneOwner && microphoneOwner !== owner.current) { setError('Hay otro dictado en curso. Detén o cancela su audio antes de grabar aquí.'); return; }
    microphoneOwner = owner.current; activeCapture = { scopeId, cancel }; publish();
    const token = ++generation.current;
    const deliver = onTextRef.current;
    cancelled.current = false; setError(''); transition('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este entorno no permite grabar audio. Escribe tu mensaje.');
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== generation.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      // A live level so the user sees the microphone is hearing them.
      try {
        const context = new AudioContext(), analyser = context.createAnalyser(); analyser.fftSize = 256;
        meter.current = { context, frame: 0 };
        context.createMediaStreamSource(input).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => { if (!meter.current) return; analyser.getByteTimeDomainData(data); let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128)); setLevel(Math.min(1, peak / 64)); meter.current.frame = requestAnimationFrame(tick); };
        tick();
        context.resume().catch(() => {});
      } catch { if (meter.current) { cancelAnimationFrame(meter.current.frame); meter.current.context.close().catch(() => {}); meter.current = null; } }
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(input, mimeType ? { mimeType } : undefined);
      recorder.current = recording;
      let chunks = [], bytes = 0, oversized = false;
      recording.ondataavailable = event => {
        if (token !== generation.current || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_AUDIO) { oversized = true; chunks = []; stop(); return; }
        chunks.push(event.data);
      };
      recording.onerror = () => { dispose(); transition('idle'); setError('La grabación falló. Revisa el micrófono y vuelve a grabar.'); };
      recording.onstop = async () => {
        stopTracks(); recorder.current = null;
        if (token !== generation.current || cancelled.current) return;
        if (oversized || !bytes) { release(); transition('idle'); setError(oversized ? 'El audio supera 1 MiB. Graba un fragmento más corto.' : 'La grabación está vacía. Vuelve a grabar.'); return; }
        transition('transcribing');
        try {
          const audio = new Blob(chunks, { type: recording.mimeType || 'audio/webm' }); chunks = [];
          const audioBase64 = await blobBase64(audio);
          if (token !== generation.current) return;
          const value = await api('voice.transcribe', { workspaceId, audioBase64, mimeType: audio.type });
          if (token !== generation.current) return;
          const text = String(value?.text || '').trim();
          if (text) deliver?.(text, value); else setError('No se reconoció voz. Acerca el micrófono y vuelve a grabar.');
        } catch (e) {
          if (token === generation.current) setError(`${e.message} Configura la voz con «npm run setup:voice» o escribe tu mensaje.`);
        }
        if (token === generation.current) { release(); transition('idle'); }
      };
      recording.start(1000); transition('recording');
      timer.current = setTimeout(stop, MAX_MS);
    } catch (e) {
      if (token === generation.current) { dispose(); transition('idle'); setError(e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Habilítalo en los permisos del sistema y vuelve a grabar.' : e.message); }
    }
  }, [api, workspaceId, scopeId, enabled, dispose, stop, cancel]);
  return { status, error, level, start, stop, cancel, busyElsewhere: !!lease && lease !== owner.current, clearError: () => setError('') };
}
