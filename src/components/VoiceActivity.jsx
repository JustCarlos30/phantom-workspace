import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../voice.css';

const LABELS = { requesting: 'Esperando permiso del micrófono…', recording: 'Te escucho…', transcribing: 'Transcribiendo…' };
const MODES = { preparing: 'preparando motor en vivo…', live: 'en vivo', batch: 'se transcribe al detener' };
// Surfaces that light up as a whole while they own the microphone.
export const VOICE_SURFACES = '.canvas-node, .phantom-chat, [data-voice-surface]';

const SIZE = 40, KS = [2, 3, 4, 5, 6], AMP = 4.5, SPRING_K = 224, SPRING_C = 2 * Math.sqrt(224) * 0.4;
const POINTS = 96, MAX_DEFORM = 0.14, SPRING_MAX = 1.15;
const WEIGHTS = [1, 0.8, 0.25, 0.2, 0.15], WSUM = WEIGHTS.reduce((a, b) => a + b, 0);
// Per-harmonic share of the radius; Σ|A_k·s_k| ≤ MAX_DEFORM·r0 even at the spring clamp.
const AK = WEIGHTS.map(w => MAX_DEFORM / SPRING_MAX * w / WSUM);
const weight = k => WEIGHTS[KS.indexOf(k)];
const drift = k => 0.4 + ((k * 0.37) % 0.8);
const noise = (k, t) => 0.5 + 0.5 * Math.sin(t * (0.9 + k * 0.31) + k * 1.7) * Math.cos(t * (0.4 + k * 0.17));

// Fluid "wave orb": the only input is the scalar mic level; harmonics are
// jelly springs fed by it. One rAF while the voice status is not idle.
function VoiceOrb({ status, level }) {
  const canvas = useRef(null), live = useRef({ status, level });
  live.current = { status, level };
  const [reduced, setReduced] = useState(() => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext?.('2d');
    if (!ctx) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    el.width = SIZE * dpr; el.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const read = name => getComputedStyle(el).getPropertyValue(name).trim();
    const working = read('--working') || '#8ab4ff', muted = read('--muted') || '#8a8f98';
    const s = KS.map(() => 0), v = KS.map(() => 0);
    let fast = 0, last = performance.now(), t = 0, raf = 0, lastWrite = -1e9;
    const trace = (r0, shift, speed) => {
      const pts = [];
      for (let i = 0; i < POINTS; i++) {
        const th = i / POINTS * Math.PI * 2;
        let r = r0;
        KS.forEach((k, j) => { r += r0 * AK[j] * s[j] * Math.sin(k * th + shift + k * 0.9 + t * drift(k) * speed); });
        pts.push([SIZE / 2 + Math.cos(th) * r, SIZE / 2 + Math.sin(th) * r]);
      }
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const m0 = mid(pts[POINTS - 1], pts[0]);
      ctx.beginPath();
      ctx.moveTo(m0[0], m0[1]);
      for (let i = 0; i < POINTS; i++) {
        const m = mid(pts[i], pts[(i + 1) % POINTS]);
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
      }
      ctx.closePath();
    };
    const frame = now => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      const { status: st, level: lv } = live.current;
      const rec = st === 'recording', trans = st === 'transcribing';
      const input = rec ? 1 - Math.exp(-2.2 * Math.max(0, Math.min(1, lv))) : 0;
      ctx.clearRect(0, 0, SIZE, SIZE);
      let energy = 0;
      if (reduced) {
        const r = (st === 'requesting' ? 7 : trans ? 8 : 10) + (rec ? Math.round(input * 4) : 0);
        ctx.globalAlpha = trans ? 0.5 : 1; ctx.fillStyle = st === 'requesting' ? muted : working;
        ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2); ctx.fill();
      } else {
        const tau = input > fast ? 0.025 : 0.12;
        fast += (input - fast) * (1 - Math.exp(-dt / tau));
        const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
        KS.forEach((k, j) => {
          const target = input * weight(k) * (0.6 + 0.4 * noise(k, t));
          for (let n = 0; n < steps; n++) { v[j] += (SPRING_K * (target - s[j]) - SPRING_C * v[j]) * h; s[j] += v[j] * h; }
          s[j] = Math.max(-0.15, Math.min(SPRING_MAX, s[j]));
          energy += Math.abs(s[j]) * AMP * WEIGHTS[j] / WSUM * KS.length;
        });
        energy /= KS.length;
        const speed = trans ? 0.4 : 1;
        const base = st === 'requesting' ? 7 : trans ? 8 : 11;
        const r0 = base + (rec || trans ? Math.sin(t * 1.6) * 0.5 * (energy < 0.3 ? 1 : 0) : 0) + fast * 4;
        const color = st === 'requesting' ? muted : working;
        const wave = st === 'requesting' ? 0 : 1;
        KS.forEach((_, j) => { if (!wave) s[j] = v[j] = 0; });
        ctx.globalAlpha = trans ? 0.5 : 1;
        const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, r0 + 8);
        g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
        trace(r0, 0, speed); ctx.fillStyle = g; ctx.globalAlpha *= 0.55; ctx.fill();
        ctx.globalAlpha = trans ? 0.5 : 1;
        ctx.lineWidth = 1.2; ctx.strokeStyle = color; trace(r0, 0, speed); ctx.stroke();
        ctx.globalAlpha *= 0.28; ctx.lineWidth = 1;
        trace(r0 - 2, 0.7, speed); ctx.stroke();
        ctx.strokeStyle = muted; ctx.globalAlpha *= 0.7; trace(r0 - 4, 1.4, speed); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (now - lastWrite >= 100) { lastWrite = now; el.dataset.amplitude = energy.toFixed(2); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  return <canvas ref={canvas} className="voice-waves" width={SIZE} height={SIZE} data-motion={reduced ? 'reduced' : 'full'} data-amplitude="0.00" aria-hidden="true" />;
}

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
  return <>
    <div ref={strip} className="voice-activity" data-state={voice.status} data-mode={voice.mode || undefined} style={{ '--voice-level': level }}>
      <div className="voice-activity-row">
        <VoiceOrb status={voice.status} level={level} />
        <span role="status" title={voice.status === 'recording' ? MODES[voice.mode] : undefined}>{LABELS[voice.status]}</span>
        <button type="button" onClick={voice.cancel}>Cancelar audio</button>
      </div>
      {(hasText || voice.mode === 'live') && voice.status !== 'requesting' && <p ref={transcript} className="voice-live" aria-live="polite" aria-atomic="true">
        {hasText ? <>{text.confirmed && <span className="voice-live-confirmed">{text.confirmed} </span>}{text.partial && <span className="voice-live-partial">{text.partial}</span>}</> : <span className="voice-live-partial">Habla, te escucho…</span>}
      </p>}
      {voice.notice && <p className="voice-notice">{voice.notice}</p>}
    </div>
    {host && createPortal(<span className="voice-aura" data-state={voice.status} aria-hidden="true"></span>, host)}
  </>;
}
