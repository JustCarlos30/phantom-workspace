import React, { useEffect, useRef } from 'react';
import { createCreatures, stepCreatures, renderFrame, SHADES, creatureGradient, OCEAN_COLORS } from '../hooks/asciiField.mjs';

const FONT_SIZE = 8;
const ROW_HEIGHT = 8;

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
    let creatures = [], colors = [], ocean, font = '';
    const draw = () => {
      const frame = renderFrame(creatures, time, { cols, rows });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      context.fillStyle = ocean;
      context.fillRect(0, 0, width, height);
      const batches = new Map();
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const cell = row * cols + col;
        if (!frame.tint[cell]) continue;
        const char = frame.chars[row][col];
        const index = frame.tint[cell] - 1;
        const level = frame.level[cell];
        const key = (index * SHADES + frame.shade[cell]) * 10 + level;
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push([char, col * cellWidth, row * ROW_HEIGHT]);
      }
      for (const [key, cells] of batches) {
        const zone = Math.floor(key / 10), level = key % 10;
        const index = Math.floor(zone / SHADES), shade = zone % SHADES;
        context.fillStyle = colors[index][shade][level];
        context.shadowColor = colors[index][shade][0];
        context.shadowBlur = creatures[index].depth > .7 ? 4 : 0;
        context.globalAlpha = (.35 + .65 * creatures[index].depth) * (.45 + .55 * level / 9);
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
      colors = creatures.map(creature => creatureGradient(creature).map(hex => Array.from({ length: 10 }, (_, index) =>
        `#${[1, 3, 5].map(offset => {
          const channel = parseInt(hex.slice(offset, offset + 2), 16);
          return Math.round(channel + (255 - channel) * .3 * index / 9).toString(16).padStart(2, '0');
        }).join('')}`)));
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
