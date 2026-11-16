import React, { useEffect, useRef } from 'react';
import { createCreatures, stepCreatures, renderFrame, RAMP, creatureColor, OCEAN_COLORS, createBubbles, stepBubbles, createPlants, renderPlants } from '../hooks/asciiField.mjs';

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
    let creatures = [], bubbles = [], plants = [], colors = [], ocean, rays = [], font = '';
    const draw = () => {
      const frame = renderFrame(creatures, time, { cols, rows });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      context.fillStyle = ocean;
      context.fillRect(0, 0, width, height);
      for (const ray of rays) {
        context.fillStyle = ray;
        context.fillRect(0, 0, width, height);
      }
      context.fillStyle = '#83deff';
      context.globalAlpha = .65;
      for (const bubble of bubbles) context.fillText(bubble.char, bubble.x * cellWidth, bubble.y * 13);
      context.globalAlpha = .8;
      for (const plant of renderPlants(plants, time, { cols, rows })) {
        context.fillStyle = plant.color;
        context.fillText(plant.char, plant.x * cellWidth, plant.y * 13);
      }
      const batches = new Map();
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const char = frame.chars[row][col];
        if (char === ' ') continue;
        const index = frame.tint[row * cols + col] - 1;
        const density = RAMP.indexOf(char);
        const key = index * RAMP.length + density;
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push([char, col * cellWidth, row * 13]);
      }
      context.shadowBlur = 3;
      for (const [key, cells] of batches) {
        const index = Math.floor(key / RAMP.length), density = key % RAMP.length;
        context.fillStyle = colors[index][density];
        context.shadowColor = colors[index][0];
        context.globalAlpha = .78 + .22 * density / (RAMP.length - 1);
        for (const [char, x, y] of cells) context.fillText(char, x, y);
      }
      context.shadowBlur = 0;
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
        bubbles = stepBubbles(bubbles, dt, { cols, rows });
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
      ocean = context.createLinearGradient(0, 0, 0, Math.max(1, height));
      OCEAN_COLORS.forEach((color, index) => ocean.addColorStop(index / (OCEAN_COLORS.length - 1), color));
      rays = [.18, .53, .82].map(position => {
        const ray = context.createLinearGradient(width * position - width * .12, 0, width * position + width * .2, height * .35);
        ray.addColorStop(0, '#68e5ff00');
        ray.addColorStop(.5, '#68e5ff0d');
        ray.addColorStop(1, '#68e5ff00');
        return ray;
      });
      creatures = createCreatures({ cols, rows, seed: 1701 });
      colors = creatures.map(creature => [...RAMP].map((_, index) => creatureColor(creature.hue, index / (RAMP.length - 1))));
      bubbles = createBubbles({ cols, rows, seed: 1702 });
      plants = createPlants({ cols, rows, seed: 1703 });
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
