import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createResampler, floatToPCM16, createPushQueue } from './voiceStream.mjs';

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
// Prefer live PCM transcription, falling back to voice.transcribe at stop.
// Only the final text is handed to onText; no action runs on its own.
export function useVoiceRecorder({ api, workspaceId, scopeId = workspaceId, enabled = true, onText }) {
  const [status, setStatus] = useState('idle'); // idle | requesting | recording | transcribing
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [liveText, setLiveText] = useState({ confirmed: '', partial: '' });
  const streaming = useRef(null);
  const recorder = useRef(null), stream = useRef(null), timer = useRef(null), generation = useRef(0), meter = useRef(null), cancelled = useRef(false);
  const owner = useRef(Symbol('voice')), phase = useRef('idle');
  const lease = useSyncExternalStore(subscribeMicrophone, () => microphoneOwner);
  const transition = value => { phase.current = value; setStatus(value); };
  const release = () => { if (microphoneOwner === owner.current) { microphoneOwner = null; activeCapture = null; publish(); } };
  const onTextRef = useRef(onText); onTextRef.current = onText;
  const stopTracks = () => {
    const session = streaming.current;
    if (session) {
      clearInterval(session.interval);
      if (session.processor) session.processor.onaudioprocess = null;
      if (session.processor?.port) {
        session.processor.port.onmessage = null;
        session.processor.port.close();
      }
      session.processor?.disconnect();
      session.source?.disconnect();
      session.processor = null; session.source = null;
    }
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    clearTimeout(timer.current);
    if (meter.current) { cancelAnimationFrame(meter.current.frame); meter.current.context.close().catch(() => {}); meter.current = null; }
    setLevel(0);
  };
  const dispose = useCallback(() => {
    generation.current++;
    const session = streaming.current;
    if (session) { session.queue.cancel(); session.cancel(); }
    const current = recorder.current;
    if (current) { current.ondataavailable = null; current.onstop = null; current.onerror = null; if (current.state !== 'inactive') current.stop(); }
    recorder.current = null; stopTracks(); streaming.current = null; release(); phase.current = 'idle'; setLiveText({ confirmed: '', partial: '' });
  }, []);
  useEffect(() => { transition('idle'); setError(''); return dispose; }, [dispose, workspaceId, scopeId]);
  useEffect(() => { if (!enabled) { dispose(); transition('idle'); } }, [enabled, dispose]);
  const stop = useCallback(() => {
    const session = streaming.current;
    if (session && phase.current === 'recording') {
      transition('transcribing'); stopTracks();
      session.queue.enqueue(floatToPCM16(session.resample(new Float32Array(0), true)));
      void (async () => {
        try {
          await session.queue.flush();
          if (session.token !== generation.current) return;
          const value = await session.finish();
          if (session.token !== generation.current) return;
          const text = String(value?.text || '').trim();
          if (text) session.deliver?.(text, value);
          else setError('No se reconoció voz. Acerca el micrófono y vuelve a grabar.');
        } catch (e) {
          session.cancel();
          if (session.token === generation.current) setError(e.message);
        }
        if (session.token === generation.current) { streaming.current = null; release(); transition('idle'); }
      })();
      return;
    }
    if (recorder.current?.state === 'recording') { cancelled.current = false; transition('transcribing'); recorder.current.stop(); stopTracks(); }
  }, []);
  const cancel = useCallback(() => { cancelled.current = true; dispose(); transition('idle'); setError(''); }, [dispose]);
  const start = useCallback(async () => {
    if (phase.current !== 'idle' || !workspaceId || !enabled) return;
    if (microphoneOwner && microphoneOwner !== owner.current) { setError('Hay otro dictado en curso. Detén o cancela su audio antes de grabar aquí.'); return; }
    microphoneOwner = owner.current; activeCapture = { scopeId, cancel }; publish();
    const token = ++generation.current;
    const deliver = onTextRef.current;
    cancelled.current = false; setError(''); setLiveText({ confirmed: '', partial: '' }); transition('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este entorno no permite grabar audio. Escribe tu mensaje.');
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
      let started = null;
      try { started = await api('voice.stream.start', { workspaceId }); } catch { /* Older runtimes and batch providers remain supported. */ }
      let sessionCancelled = false;
      const cancelSession = () => {
        if (!started?.sessionId || sessionCancelled) return;
        sessionCancelled = true;
        void Promise.resolve().then(() => api('voice.stream.cancel', { workspaceId, sessionId: started.sessionId })).catch(() => {});
      };
      if (token !== generation.current) { cancelSession(); return; }
      if (started?.sessionId) {
        try {
          const context = meter.current?.context || new AudioContext();
          if (!meter.current) meter.current = { context, frame: 0 };
          const source = context.createMediaStreamSource(input);
          let processor;
          if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
            const url = URL.createObjectURL(new Blob([`
              registerProcessor('phantom-voice-pcm', class extends AudioWorkletProcessor {
                process(inputs) {
                  const channels = inputs[0];
                  if (channels?.length && channels[0].length) {
                    const mono = new Float32Array(channels[0].length);
                    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
                    this.port.postMessage(mono, [mono.buffer]);
                  }
                  return true;
                }
              });
            `], { type: 'text/javascript' }));
            try {
              await context.audioWorklet.addModule(url);
              processor = new AudioWorkletNode(context, 'phantom-voice-pcm');
            } catch { /* ScriptProcessor supports environments without worklets. */ }
            finally { URL.revokeObjectURL(url); }
          }
          if (token !== generation.current) { source.disconnect(); processor?.port?.close(); processor?.disconnect(); cancelSession(); return; }
          processor ||= context.createScriptProcessor(4096, 1, 1);
          const resample = createResampler(context.sampleRate);
          const queue = createPushQueue({
            push: fragment => api('voice.stream.push', { workspaceId, sessionId: started.sessionId, ...fragment }),
            onResponse: value => { if (token === generation.current) setLiveText({ confirmed: String(value?.confirmed || ''), partial: String(value?.partial || '') }); },
          });
          const session = { token, deliver, source, processor, resample, queue, cancel: cancelSession,
            finish: () => api('voice.stream.finish', { workspaceId, sessionId: started.sessionId }) };
          streaming.current = session;
          const capture = samples => {
            if (token !== generation.current || phase.current !== 'recording') return;
            queue.enqueue(floatToPCM16(resample(samples)));
          };
          if (processor.port) processor.port.onmessage = event => capture(event.data);
          else processor.onaudioprocess = event => capture(event.inputBuffer.getChannelData(0));
          source.connect(processor); processor.connect(context.destination);
          await context.resume();
          if (token !== generation.current) return;
          transition('recording');
          session.interval = setInterval(() => { void queue.flush().catch(e => {
            if (token !== generation.current) return;
            dispose(); transition('idle'); setError(e.message);
          }); }, 750);
          timer.current = setTimeout(stop, MAX_MS);
          return;
        } catch (e) { cancelSession(); throw e; }
      }
      if (typeof MediaRecorder === 'undefined') throw new Error('Este entorno no permite grabar audio. Escribe tu mensaje.');
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
        if (token !== generation.current || cancelled.current) return;
        stopTracks(); recorder.current = null;
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
  return { status, error, level, liveText, start, stop, cancel, busyElsewhere: !!lease && lease !== owner.current, clearError: () => setError('') };
}
