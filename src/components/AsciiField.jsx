import React, { useEffect, useRef } from 'react';
import { createCreatures, stepCreatures, renderFrame, RAMP } from '../hooks/asciiField.mjs';

export default function AsciiField({ paused = false }) {
  const canvasRef = useRef(null);
  const pausedRef = useRef(paused);
  const resumeRef = useRef(null);
  useEffect(() => { pausedRef.current = paused; resumeRef.current?.(); }, [paused]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, last = 0, time = 0, cols = 0, rows = 0, width = 0, height = 0, cellWidth = 0;
    let creatures = [], colors = {}, font = '';
    const draw = () => {
      const frame = renderFrame(creatures, time, { cols, rows });
      context.clearRect(0, 0, width, height);
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const char = frame.chars[row][col];
        if (char === ' ') continue;
        const creature = creatures[frame.tint[row * cols + col] - 1];
        context.fillStyle = colors[creature.kind][creature.hue < .5 ? 0 : 1];
        context.globalAlpha = .35 + .2 * RAMP.indexOf(char) / (RAMP.length - 1);
        context.fillText(char, col * cellWidth, row * 13);
      }
      context.globalAlpha = 1;
    };
    const tick = now => {
      raf = 0;
      if (document.hidden || pausedRef.current || motion.matches) { last = 0; return; }
      if (!last) last = now;
      if (now - last >= 1000 / 24) {
        const dt = Math.min((now - last) / 1000, .1);
        time += dt;
        creatures = stepCreatures(creatures, dt, { cols, rows });
        draw();
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    const resume = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      if (!document.hidden && !pausedRef.current && !motion.matches) raf = requestAnimationFrame(tick);
    };
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      font = `13px ${style.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace'}`;
      width = rect.width; height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = font; context.textBaseline = 'top';
      cellWidth = context.measureText('M').width;
      cols = Math.floor(width / cellWidth); rows = Math.floor(height / 13);
      colors = {
        jelly: [style.getPropertyValue('--ascii-cyan').trim(), style.getPropertyValue('--ascii-violet').trim()],
        butterfly: [style.getPropertyValue('--ascii-amber').trim(), style.getPropertyValue('--ascii-rose').trim()],
        ghost: [style.getPropertyValue('--ascii-lilac').trim(), style.getPropertyValue('--ascii-lilac').trim()],
      };
      creatures = createCreatures({ cols, rows, seed: 1701 });
      draw();
    };
    const changeMotion = () => { if (motion.matches) draw(); resume(); };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);
    document.addEventListener('visibilitychange', resume);
    motion.addEventListener('change', changeMotion);
    resumeRef.current = resume;
    resize(); resume();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', resume);
      motion.removeEventListener('change', changeMotion);
      resumeRef.current = null;
    };
  }, []);
  return <canvas ref={canvasRef} className="ascii-field" aria-hidden="true" />;
}
