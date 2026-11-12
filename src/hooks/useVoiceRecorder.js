import { useCallback, useEffect, useRef, useState } from 'react';

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
export function useVoiceRecorder({ api, workspaceId, onText }) {
  const [status, setStatus] = useState('idle'); // idle | requesting | recording | transcribing
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const recorder = useRef(null), stream = useRef(null), timer = useRef(null), generation = useRef(0), meter = useRef(null), cancelled = useRef(false);
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
    recorder.current = null; stopTracks();
  }, []);
  useEffect(() => dispose, [dispose, workspaceId]);
  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') { cancelled.current = false; setStatus('transcribing'); recorder.current.stop(); stopTracks(); }
  }, []);
  const cancel = useCallback(() => { cancelled.current = true; dispose(); setStatus('idle'); }, [dispose]);
  const start = useCallback(async () => {
    if (recorder.current || !workspaceId) return;
    const token = ++generation.current;
    setError(''); setStatus('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este entorno no permite grabar audio. Escribe tu mensaje.');
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== generation.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      // A live level so the user sees the microphone is hearing them.
      try {
        const context = new AudioContext(), analyser = context.createAnalyser(); analyser.fftSize = 256;
        context.createMediaStreamSource(input).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => { analyser.getByteTimeDomainData(data); let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128)); setLevel(Math.min(1, peak / 64)); meter.current.frame = requestAnimationFrame(tick); };
        meter.current = { context, frame: 0 }; tick();
      } catch { /* The level is a courtesy; recording works without it. */ }
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
      recording.onerror = () => { dispose(); setStatus('idle'); setError('La grabación falló. Revisa el micrófono.'); };
      recording.onstop = async () => {
        stopTracks(); recorder.current = null;
        if (token !== generation.current || cancelled.current) return;
        if (oversized || !bytes) { setStatus('idle'); setError(oversized ? 'El audio supera 1 MiB. Graba un fragmento más corto.' : 'La grabación está vacía.'); return; }
        setStatus('transcribing');
        try {
          const audio = new Blob(chunks, { type: recording.mimeType || 'audio/webm' }); chunks = [];
          const audioBase64 = await blobBase64(audio);
          if (token !== generation.current) return;
          const value = await api('voice.transcribe', { workspaceId, audioBase64, mimeType: audio.type });
          if (token !== generation.current) return;
          const text = String(value?.text || '').trim();
          if (text) onTextRef.current?.(text); else setError('No se reconoció voz en la grabación.');
        } catch (e) {
          if (token === generation.current) setError(`${e.message} Configura la voz con «npm run setup:voice» o escribe tu mensaje.`);
        }
        if (token === generation.current) setStatus('idle');
      };
      recording.start(1000); setStatus('recording');
      timer.current = setTimeout(stop, MAX_MS);
    } catch (e) {
      if (token === generation.current) { stopTracks(); recorder.current = null; setStatus('idle'); setError(e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado.' : e.message); }
    }
  }, [api, workspaceId, dispose, stop]);
  return { status, error, level, start, stop, cancel, clearError: () => setError('') };
}
