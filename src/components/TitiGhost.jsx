import React, { useEffect, useRef } from 'react';
import { Rig, drawGhost, LOD } from './titi/ghost.js';
import { P } from './titi/parameters.js';
import { STATES as NEW_STATES } from './titi/estados.js';
import { STATES as BASE_STATES } from './titi/states-v4.js';

const STATES = { ...BASE_STATES, ...NEW_STATES };
const MOOD_STATE = { calm: 'esperando', working: 'pensando', grin: 'necesita', unsure: 'fallo', asleep: 'idle' };
const STEP = 1 / 60;

export default function TitiGhost({ size = 32, mood = 'calm', className = '', ...props }) {
  const canvasRef = useRef(null);
  const moodRef = useRef(mood);
  const apiRef = useRef(null);
  moodRef.current = mood;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const u = Math.max(2, Math.floor((size * dpr) / 8));
    const lod = LOD[u] || {};
    canvas.width = canvas.height = 8 * u;
    const rig = new Rig(P, { states: STATES });
    rig.setup();
    let t = 0, shown = null, raf = 0, last = 0, visible = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');

    const apply = () => {
      const k = MOOD_STATE[moodRef.current] || 'esperando';
      if (k !== shown) { shown = k; rig.setState(k); }
    };
    const step = dt => { t += dt; apply(); rig.update(dt, t); };
    const paint = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const G = lod.snap && u <= 4 ? rig.small || rig.G : rig.G;
      drawGhost(ctx, u, u * 0.5, u, G, lod, P);
    };
    const still = () => { for (let i = 0; i < 90; i++) step(STEP); paint(); };
    const frame = now => {
      raf = 0;
      if (!visible || reduce?.matches) return;
      const dt = Math.min((now - (last || now)) / 1000, 0.05);
      last = now;
      step(dt); paint();
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      if (raf) return;
      if (!visible || reduce?.matches) { still(); return; }
      last = 0; raf = requestAnimationFrame(frame);
    };
    apiRef.current = { refresh: () => { if (!raf) { apply(); for (let i = 0; i < 90; i++) step(STEP); paint(); } else apply(); } };

    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([e]) => {
          visible = e.isIntersecting;
          if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; }
          run();
        })
      : null;
    io?.observe(canvas);
    const onMotion = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } run(); };
    reduce?.addEventListener?.('change', onMotion);
    run();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io?.disconnect();
      reduce?.removeEventListener?.('change', onMotion);
      apiRef.current = null;
    };
  }, [size]);

  useEffect(() => { apiRef.current?.refresh(); }, [mood]);

  return <canvas ref={canvasRef} {...props} style={{ width: size, height: size, ...props.style }} aria-hidden="true" className={`phantom-face titi-ghost is-${mood} ${className}`.trim()} data-mood={mood} />;
}
