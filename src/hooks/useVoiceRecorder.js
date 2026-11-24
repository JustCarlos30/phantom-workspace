import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createResampler, floatToPCM16 } from './voiceStream.mjs';
import { STREAM_RATE } from './voice-pcm.js';
import { createDictationSession } from './voice-backup.mjs';

// One lease covers permission, capture AND transcription across every surface.
let microphoneOwner = null;
let activeCapture = null;
export function cancelVoiceRecording(scopePrefix) {
  if (activeCapture && (!scopePrefix || String(activeCapture.scopeId).startsWith(scopePrefix))) activeCapture.cancel();
}
const listeners = new Set();
const subscribeMicrophone = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const publish = () => listeners.forEach(listener => listener());

const DRAIN_MS = 350;
// Send audio to the host at least every PUMP_MS once 100 ms is queued.
const PUMP_MS = 250;
const EMPTY = { confirmed: '', partial: '' };

// Manual dictation: the microphone is live only between start() and stop(); there is
// no clock or size limit. While recording, PCM is streamed to the host (voice.stream.*)
// in small ordered pushes and the transcript is shown as it forms. If the host has no
// live engine, or it fails, the host keeps the audio on disk and transcribes it in
// segments when the user stops (see voice-backup.mjs). Text is only handed to onText;
// nothing is sent anywhere else and no action runs on its own.
export function useVoiceRecorder({ api, workspaceId, scopeId = workspaceId, enabled = true, onText }) {
  const [status, setStatus] = useState('idle'); // idle | requesting | recording | transcribing
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState(EMPTY);
  const [mode, setMode] = useState(null); // null | preparing | live | batch
  const [notice, setNotice] = useState('');
  const stream = useRef(null), generation = useRef(0), meter = useRef(null), cancelled = useRef(false), liveRef = useRef(null);
  const owner = useRef(Symbol('voice')), phase = useRef('idle');
  const lease = useSyncExternalStore(subscribeMicrophone, () => microphoneOwner);
  const transition = value => { phase.current = value; setStatus(value); };
  const release = () => { if (microphoneOwner === owner.current) { microphoneOwner = null; activeCapture = null; publish(); } };
  const onTextRef = useRef(onText); onTextRef.current = onText;
  const apiRef = useRef(api); apiRef.current = api;
  const stopTracks = () => {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
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
    clearInterval(session.timer); clearTimeout(session.drainTimer); session.draining = false; session.closed = true;
    session.ctl.cancel();
  };
  const dispose = useCallback(() => {
    generation.current++;
    stopTracks(); closeLive(); release(); phase.current = 'idle';
  }, []);
  useEffect(() => { transition('idle'); setError(''); setLive(EMPTY); setMode(null); setNotice(''); return dispose; }, [dispose, workspaceId, scopeId]);
  useEffect(() => { if (!enabled) { dispose(); transition('idle'); } }, [enabled, dispose]);
  // Load the speech model before the first dictation so live text starts at once.
  useEffect(() => { if (enabled && workspaceId) apiRef.current('voice.stream.warm', { workspaceId }).catch(() => {}); }, [enabled, workspaceId]);
  const stop = useCallback(() => {
    if (phase.current !== 'recording') return;
    cancelled.current = false; transition('transcribing');
    const session = liveRef.current, token = generation.current;
    if (!session || session.closed) return;
    clearInterval(session.timer); session.draining = true;
    session.drainTimer = setTimeout(() => {
      if (token !== generation.current || session.closed || liveRef.current !== session) return;
      session.draining = false; session.flushCapture(); stopTracks(); session.finalize();
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
      const session = { timer: 0, drainTimer: 0, draining: false, closed: false, finalizing: false, finalize: null, flushCapture: null, ctl: null };
      session.ctl = createDictationSession({
        api: apiRef.current, workspaceId, isCurrent: () => current() && !session.closed,
        onLive: setLive, onMode: setMode, onNotice: setNotice,
        onReady: () => { if (phase.current === 'recording') session.timer = setInterval(() => { if (phase.current === 'recording') session.ctl.pump(); }, PUMP_MS); },
        onUnavailable: message => { dispose(); transition('idle'); setMode(null); setError(`${message} Configura la voz con «npm run setup:voice» o escribe tu mensaje.`); },
        // The host cannot keep up: stop capturing and transcribe what was recorded instead of growing memory.
        onOverflow: () => {
          if (phase.current !== 'recording') return;
          setNotice('El dictado no avanza al ritmo del audio; se detuvo la captura y se transcribirá lo grabado.');
          clearInterval(session.timer); clearTimeout(session.drainTimer); session.draining = false; stopTracks(); session.finalize();
        },
      });
      session.flushCapture = () => session.ctl.write(floatToPCM16(resample(new Float32Array(0), true)));
      liveRef.current = session;
      tap.onaudioprocess = event => {
        event.outputBuffer.getChannelData(0).fill(0);
        if (!current() || session.closed || (phase.current !== 'recording' && !session.draining)) return;
        session.ctl.write(floatToPCM16(resample(event.inputBuffer.getChannelData(0))));
      };

      // Drains the last audio, finishes and delivers the whole text once, even after a late live failure.
      session.finalize = async () => {
        if (!current() || cancelled.current || session.closed || session.finalizing) return;
        session.finalizing = true;
        stopTracks();
        transition('transcribing');
        clearInterval(session.timer);
        let outcome;
        try { outcome = await session.ctl.finish(); } catch (e) { outcome = { text: '', error: e.message }; }
        if (!current() || session.closed || outcome.cancelled) return;
        if (outcome.text) { setLive({ confirmed: outcome.text, partial: '' }); deliver?.(outcome.text, outcome.result); }
        if (outcome.error) setError(outcome.error);
        else if (!outcome.text) setError('No se reconoció voz. Acerca el micrófono y vuelve a grabar.');
        closeLive(); release(); transition('idle'); setMode(null);
      };

      transition('recording');
    } catch (e) {
      if (current()) { dispose(); transition('idle'); setMode(null); setError(e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Habilítalo en los permisos del sistema y vuelve a grabar.' : e.message); }
    }
  }, [workspaceId, scopeId, enabled, dispose, stop, cancel]);
  return { status, error, level, live, liveText: live, mode, notice, start, stop, cancel, busyElsewhere: !!lease && lease !== owner.current, clearError: () => setError('') };
}
