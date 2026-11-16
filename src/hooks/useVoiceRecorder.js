import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createResampler, floatToPCM16 } from './voiceStream.mjs';
import { STREAM_RATE, PcmQueue, bytesToBase64, liveTranscript } from './voice-pcm.js';

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
const DRAIN_MS = 350;
// Send audio to the live engine at least every PUMP_MS once 100 ms is queued.
const PUMP_MS = 250;
const MIN_PUSH = STREAM_RATE * 2 / 10;
const EMPTY = { confirmed: '', partial: '' };
const blobBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('No se pudo leer la grabación.'));
  reader.readAsDataURL(blob);
});
const joinLive = value => [value.confirmed, value.partial].filter(Boolean).join(' ').trim();

// Manual dictation: the microphone is live only between start() and stop().
// While recording, PCM is streamed to the host (voice.stream.*) and the
// transcript is shown as it forms. If the host has no live engine, the same
// capture falls back to one voice.transcribe when the user stops. Text is only
// handed to onText; nothing is sent anywhere else and no action runs on its own.
export function useVoiceRecorder({ api, workspaceId, scopeId = workspaceId, enabled = true, onText }) {
  const [status, setStatus] = useState('idle'); // idle | requesting | recording | transcribing
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState(EMPTY);
  const [mode, setMode] = useState(null); // null | preparing | live | batch
  const [notice, setNotice] = useState('');
  const recorder = useRef(null), stream = useRef(null), timer = useRef(null), generation = useRef(0), meter = useRef(null), cancelled = useRef(false), liveRef = useRef(null);
  const owner = useRef(Symbol('voice')), phase = useRef('idle');
  const lease = useSyncExternalStore(subscribeMicrophone, () => microphoneOwner);
  const transition = value => { phase.current = value; setStatus(value); };
  const release = () => { if (microphoneOwner === owner.current) { microphoneOwner = null; activeCapture = null; publish(); } };
  const onTextRef = useRef(onText); onTextRef.current = onText;
  const apiRef = useRef(api); apiRef.current = api;
  const stopTracks = () => {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    clearTimeout(timer.current);
    if (meter.current) {
      const graph = meter.current; meter.current = null;
      cancelAnimationFrame(graph.frame);
      if (graph.tap) graph.tap.onaudioprocess = null;
      graph.source?.disconnect(); graph.analyser?.disconnect(); graph.tap?.disconnect(); graph.mute?.disconnect();
      graph.context.close().catch(() => {});
    }
    setLevel(0);
  };
  const closeLive = () => {
    const session = liveRef.current; liveRef.current = null;
    if (!session) return;
    clearInterval(session.timer); clearTimeout(session.drainTimer); session.draining = false; session.closed = true; session.queue.clear();
    if (session.id && !session.finished) session.api('voice.stream.cancel', { workspaceId: session.workspaceId, sessionId: session.id }).catch(() => {});
  };
  const dispose = useCallback(() => {
    generation.current++;
    const current = recorder.current;
    if (current) { current.ondataavailable = null; current.onstop = null; current.onerror = null; if (current.state !== 'inactive') current.stop(); }
    recorder.current = null; stopTracks(); closeLive(); release(); phase.current = 'idle';
  }, []);
  useEffect(() => { transition('idle'); setError(''); setLive(EMPTY); setMode(null); setNotice(''); return dispose; }, [dispose, workspaceId, scopeId]);
  useEffect(() => { if (!enabled) { dispose(); transition('idle'); } }, [enabled, dispose]);
  const stop = useCallback(() => {
    if (phase.current !== 'recording') return;
    cancelled.current = false; transition('transcribing');
    const current = recorder.current;
    const session = liveRef.current, token = generation.current;
    if (!session || session.closed) return;
    clearInterval(session.timer); clearTimeout(timer.current); session.draining = true;
    session.drainTimer = setTimeout(() => {
      if (token !== generation.current || session.closed || liveRef.current !== session) return;
      session.draining = false; session.flushCapture(); stopTracks();
      if (current?.state === 'recording') current.stop(); else session.finalize(null);
    }, DRAIN_MS);
  }, []);
  const cancel = useCallback(() => { cancelled.current = true; dispose(); transition('idle'); setError(''); setLive(EMPTY); setMode(null); }, [dispose]);
  const start = useCallback(async () => {
    if (phase.current !== 'idle' || !workspaceId || !enabled) return;
    if (microphoneOwner && microphoneOwner !== owner.current) { setError('Hay otro dictado en curso. Detén o cancela su audio antes de grabar aquí.'); return; }
    microphoneOwner = owner.current; activeCapture = { scopeId, cancel }; publish();
    const token = ++generation.current;
    const deliver = onTextRef.current;
    const current = () => token === generation.current;
    cancelled.current = false; setError(''); setLive(EMPTY); setMode(null); setNotice(''); transition('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') throw new Error('Este entorno no permite grabar audio. Escribe tu mensaje.');
      const input = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!current()) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;

      // One audio graph: the level meter the user sees and the PCM the engine hears.
      let context;
      try { context = new AudioContext({ sampleRate: STREAM_RATE }); } catch { context = new AudioContext(); }
      const graph = { context, frame: 0 };
      meter.current = graph;
      const source = context.createMediaStreamSource(input), analyser = context.createAnalyser(); analyser.fftSize = 256;
      Object.assign(graph, { source, analyser });
      const tap = context.createScriptProcessor(4096, 1, 1), mute = context.createGain(); mute.gain.value = 0;
      Object.assign(graph, { tap, mute });
      source.connect(analyser); source.connect(tap); tap.connect(mute); mute.connect(context.destination);
      const resample = createResampler(context.sampleRate, STREAM_RATE);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => { if (!meter.current) return; analyser.getByteTimeDomainData(data); let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128)); setLevel(Math.min(1, peak / 64)); meter.current.frame = requestAnimationFrame(tick); };
      tick();
      context.resume().catch(() => {});

      // Live session: audio is queued from the first sample, even while the engine warms up.
      const session = { workspaceId, api: apiRef.current, id: null, queue: new PcmQueue(), sequence: 0, inflight: null, failed: false, finished: false, closed: false, timer: 0, finalize: null, finalizing: false, cancellation: null };
      session.flushCapture = () => {
        if (!session.failed && !session.closed) session.queue.push(floatToPCM16(resample(new Float32Array(0), true)));
      };
      liveRef.current = session;
      const fail = message => {
        if (session.failed) return;
        session.failed = true; session.queue.clear(); clearInterval(session.timer);
        if (session.id && !session.finished && !session.closed) {
          session.cancellation = session.api('voice.stream.cancel', { workspaceId, sessionId: session.id }).catch(() => {});
          session.id = null;
        }
        if (current()) { setMode('batch'); setNotice(`Transcripción en vivo no disponible: ${String(message).replace(/\.?\s*$/, '.')} Se transcribirá al detener.`); }
      };
      const sendNext = () => {
        const bytes = session.queue.take(), sequence = session.sequence;
        session.inflight = session.api('voice.stream.push', { workspaceId, sessionId: session.id, sequence, audioBase64: bytesToBase64(bytes) })
          .then(result => { session.sequence = sequence + 1; if (current() && !session.closed) setLive(liveTranscript(result)); })
          .catch(e => { if (current() && !session.closed) fail(e.message); })
          .finally(() => { session.inflight = null; });
        return session.inflight;
      };
      tap.onaudioprocess = event => {
        event.outputBuffer.getChannelData(0).fill(0);
        if (!current() || session.failed || session.closed || (phase.current !== 'recording' && !session.draining)) return;
        session.queue.push(floatToPCM16(resample(event.inputBuffer.getChannelData(0))));
      };
      setMode('preparing');
      const ready = session.api('voice.stream.start', { workspaceId }).then(result => {
        if (session.closed || !current()) { session.api('voice.stream.cancel', { workspaceId, sessionId: result.sessionId }).catch(() => {}); return; }
        session.id = result.sessionId; setMode('live');
        if (phase.current === 'recording') session.timer = setInterval(() => { if (phase.current === 'recording' && !session.closed && session.id && !session.inflight && !session.failed && session.queue.size >= MIN_PUSH) sendNext(); }, PUMP_MS);
      }, e => { if (current() && !session.closed) fail(e.message); });

      // Backup capture, used only if the live engine is unavailable or fails.
      const mimeType = typeof MediaRecorder === 'undefined' ? null : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      let chunks = [], bytes = 0, oversized = false, recording = null;
      if (typeof MediaRecorder !== 'undefined') {
        recording = new MediaRecorder(input, mimeType ? { mimeType } : undefined);
        recorder.current = recording;
        recording.ondataavailable = event => {
          if (!current() || !event.data.size || oversized) return;
          bytes += event.data.size;
          if (bytes > MAX_AUDIO) { oversized = true; chunks = []; if (session.failed) stop(); return; }
          chunks.push(event.data);
        };
        recording.onerror = () => { if (session.failed) { dispose(); transition('idle'); setError('La grabación falló. Revisa el micrófono y vuelve a grabar.'); } };
        recording.onstop = () => {
          recorder.current = null;
          // A backup that dies mid-dictation must not end a healthy live session.
          if (phase.current !== 'transcribing') { chunks = []; bytes = 0; return; }
          session.finalize(oversized || !bytes ? null : new Blob(chunks, { type: recording.mimeType || 'audio/webm' })); chunks = [];
        };
      }

      session.finalize = async backup => {
        if (!current() || cancelled.current || session.closed || session.finalizing) return;
        session.finalizing = true;
        stopTracks();
        transition('transcribing');
        let text = '', result = null;
        try {
          await ready;
          if (!current() || session.closed) return;
          if (!session.failed && session.id) {
            clearInterval(session.timer);
            await session.inflight;
            if (!current() || session.closed) return;
            while (current() && !session.closed && !session.failed && session.queue.size) await sendNext();
            if (!current() || session.closed) return;
            if (!session.failed) {
              result = await session.api('voice.stream.finish', { workspaceId, sessionId: session.id });
              session.finished = true;
              const final = liveTranscript(result);
              if (current()) setLive(final);
              text = joinLive(final);
            }
          }
        } catch (e) { if (current() && !session.closed) fail(e.message); }
        if (!current()) return;
        try {
          if (session.failed) {
            await session.cancellation;
            if (!current() || session.closed) return;
            if (!backup) throw new Error(oversized ? 'El audio supera 1 MiB. Graba un fragmento más corto.' : 'La grabación está vacía. Vuelve a grabar.');
            const audioBase64 = await blobBase64(backup);
            if (!current()) return;
            result = await session.api('voice.transcribe', { workspaceId, audioBase64, mimeType: backup.type });
            if (!current()) return;
            text = String(result?.text || '').trim();
            setLive({ confirmed: text, partial: '' });
          }
          if (text) deliver?.(text, result); else setError('No se reconoció voz. Acerca el micrófono y vuelve a grabar.');
        } catch (e) {
          if (current()) setError(/supera|vacía/.test(e.message) ? e.message : `${e.message} Configura la voz con «npm run setup:voice» o escribe tu mensaje.`);
        }
        if (current()) { closeLive(); release(); transition('idle'); setMode(null); }
      };

      recording?.start(1000); transition('recording');
      timer.current = setTimeout(stop, MAX_MS - DRAIN_MS);
    } catch (e) {
      if (current()) { dispose(); transition('idle'); setMode(null); setError(e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Habilítalo en los permisos del sistema y vuelve a grabar.' : e.message); }
    }
  }, [workspaceId, scopeId, enabled, dispose, stop, cancel]);
  return { status, error, level, live, liveText: live, mode, notice, start, stop, cancel, busyElsewhere: !!lease && lease !== owner.current, clearError: () => setError('') };
}
