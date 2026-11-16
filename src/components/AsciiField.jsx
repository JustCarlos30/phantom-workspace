import React, { useEffect, useRef } from 'react';
import { createCreatures, stepCreatures, renderFrame, RAMP, SHADES, creatureGradient, OCEAN_COLORS, createBubbles, stepBubbles, createPlants, renderPlants } from '../hooks/asciiField.mjs';

const FONT_SIZE = 8;
const ROW_HEIGHT = 8;
const DENSITIES = Object.fromEntries([...RAMP].map((char, index) => [char, index]));

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
    let creatures = [], bubbles = [], plants = [], colors = [], ocean, font = '';
    const draw = () => {
      const frame = renderFrame(creatures, time, { cols, rows });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      context.fillStyle = ocean;
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#52666a';
      context.globalAlpha = .22;
      for (const bubble of bubbles) context.fillText(bubble.char, bubble.x * cellWidth, bubble.y * ROW_HEIGHT);
      context.globalAlpha = .25;
      for (const plant of renderPlants(plants, time, { cols, rows })) {
        context.fillStyle = plant.color;
        context.fillText(plant.char, plant.x * cellWidth, plant.y * ROW_HEIGHT);
      }
      const batches = new Map();
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const cell = row * cols + col;
        if (!frame.tint[cell]) continue;
        const char = frame.chars[row][col];
        const index = frame.tint[cell] - 1;
        const density = DENSITIES[char];
        const key = (index * SHADES + frame.shade[cell]) * RAMP.length + density;
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push([char, col * cellWidth, row * ROW_HEIGHT]);
      }
      context.shadowBlur = 5;
      for (const [key, cells] of batches) {
        const zone = Math.floor(key / RAMP.length), density = key % RAMP.length;
        const index = Math.floor(zone / SHADES), shade = zone % SHADES;
        context.fillStyle = colors[index][shade][density];
        context.shadowColor = colors[index][shade][0];
        context.globalAlpha = .85 + .15 * density / (RAMP.length - 1);
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
      font = `${FONT_SIZE}px ${style.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace'}`;
      width = rect.width; height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = font; context.textBaseline = 'top';
      cellWidth = context.measureText('M').width;
      cols = Math.floor(width / cellWidth); rows = Math.floor(height / ROW_HEIGHT);
      ocean = context.createLinearGradient(0, 0, 0, Math.max(1, height));
      OCEAN_COLORS.forEach((color, index) => ocean.addColorStop(index / (OCEAN_COLORS.length - 1), color));
      creatures = createCreatures({ cols, rows, seed: 1701 });
      colors = creatures.map(creature => creatureGradient(creature).map(hex => [...RAMP].map((_, index) =>
        `#${[1, 3, 5].map(offset => {
          const channel = parseInt(hex.slice(offset, offset + 2), 16);
          return Math.round(channel + (255 - channel) * .3 * index / (RAMP.length - 1)).toString(16).padStart(2, '0');
        }).join('')}`)));
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
