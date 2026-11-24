import React, { useEffect, useRef } from 'react';
import { Rig, drawGhost, LOD } from './titi/ghost.js';
import { STATES as BASE } from './titi/states-v4.js';
import { STATES as EXT } from './titi/estados.js';
import { P } from './titi/parameters.js';
import { rng, withRandom } from './titi/motion.js';
import { useSpriteMotion } from './GengarMascot.jsx';

const MOODS = { calm: 'esperando', working: 'pensando', grin: 'necesita', unsure: 'fallo', asleep: 'idle' };
const STEP = 1 / 60;

export default function TitiGhost({ mood = 'calm', size = 30, still = false, className = '', ...props }) {
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const moving = useSpriteMotion(canvasRef, !still && !['calm', 'asleep'].includes(mood));
  const state = MOODS[mood] || MOODS.calm;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const dpr = window.devicePixelRatio || 1;
    const body = getComputedStyle(canvas).getPropertyValue('--identity-ink').trim() || '#ece6d8';
    canvas.width = Math.round(44 * dpr);
    canvas.height = Math.round(44 * dpr);
    const random = rng(1000);
    let sim = simRef.current;
    if (!sim) {
      const rig = new Rig(P, { states: { ...BASE, ...EXT } });
      sim = simRef.current = { rig, random: rng(2000), t: 0 };
      withRandom(random, () => { rig.setup(); rig.setState(state); });
    } else withRandom(random, () => sim.rig.setState(state));
    const { rig } = sim;
    const step = dt => { sim.t += dt; withRandom(sim.random, () => rig.update(dt, sim.t)); };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 44, 44);
      drawGhost(ctx, 4 + 6, 2 + 6, 4, rig.small || rig.G, { ...LOD[4], body }, P);
    };
    let raf = 0;
    if (moving) {
      draw();
      let last = 0;
      const frame = now => {
        const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        step(dt);
        draw();
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    } else {
      if (sim.t === 0) step(0);
      for (let i = 0; i < 120; i += 1) step(STEP);
      draw();
    }
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [state, moving]);

  return <canvas {...props} ref={canvasRef} width={44} height={44} style={{ width: size, height: size, ...props.style }} aria-hidden="true" className={className} data-motion={moving ? 'running' : 'stopped'} />;
}
