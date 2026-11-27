import { useCallback, useEffect, useRef, useState } from 'react';

// Zoom levels where the rendered canvas changes shape (overview cards, compact
// summaries). React only needs to re-render when one of these is crossed.
// Above 100% (-1) terminals switch to the crisp DOM renderer.
export const cameraTier = zoom => zoom > 1 ? -1 : zoom < .25 ? 2 : zoom < .45 ? 1 : 0;

// Input can arrive faster than the display. Paint once per frame through
// `onFrame` (imperative DOM writes, no React render), re-render React only
// once navigation settles (tier changes included: switching every terminal's
// renderer mid-pinch is what made zoom stutter), and persist after settle.
export function useCanvasCamera(value, onCommit, onFrame) {
  const [camera, setCamera] = useState(value);
  const current = useRef(value);
  const rendered = useRef(value);
  const frame = useRef(null), timer = useRef(null), animation = useRef(null);
  const destination = useRef(null);
  const pending = useRef(false), commit = useRef(onCommit), paint = useRef(onFrame);
  const external = useRef(value);
  commit.current = onCommit;
  paint.current = onFrame;
  const render = useCallback(next => { rendered.current = next; setCamera(next); }, []);
  const flush = useCallback(() => {
    cancelAnimationFrame(animation.current);
    animation.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = null;
    clearTimeout(timer.current);
    timer.current = null;
    // Blur/save can arrive before the first navigation frame. Persist the
    // requested destination, never an arbitrary intermediate animation frame.
    if (destination.current) current.current = destination.current;
    destination.current = null;
    if (pending.current) paint.current?.(current.current);
    if (rendered.current !== current.current) render(current.current);
    if (pending.current) { pending.current = false; commit.current(current.current); }
  }, [render]);
  const update = useCallback(next => {
    cancelAnimationFrame(animation.current);
    animation.current = null;
    destination.current = null;
    current.current = next;
    pending.current = true;
    if (frame.current === null) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      paint.current?.(current.current);
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 180);
  }, [flush, render]);
  const navigate = useCallback(next => {
    cancelAnimationFrame(animation.current);
    animation.current = null;
    clearTimeout(timer.current);
    timer.current = null;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { update(next); return; }
    destination.current = next;
    pending.current = true;
    const start = { ...current.current }, time = performance.now();
    const duration = Math.min(360, 180 + 90 * Math.abs(Math.log2(next.zoom / start.zoom)));
    const tick = now => {
      animation.current = null;
      // A frame's timestamp can predate the navigate() call when the renderer
      // is busy. Negative progress would extrapolate past the start (a zoom
      // below zero), so progress never leaves 0..1.
      const progress = Math.max(0, Math.min(1, (now - time) / duration)), ease = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      // Animation owns its RAF; deliberate input still interrupts via update.
      if (progress < 1) {
        current.current = Object.fromEntries(['x', 'y', 'zoom'].map(key => [key, start[key] + (next[key] - start[key]) * ease]));
        paint.current?.(current.current);
        if (cameraTier(current.current.zoom) !== cameraTier(rendered.current.zoom)) render(current.current);
        animation.current = requestAnimationFrame(tick);
      } else {
        current.current = next;
        flush();
      }
    };
    animation.current = requestAnimationFrame(tick);
  }, [update, flush, render]);
  useEffect(() => {
    const previous = external.current;
    external.current = value;
    if (['x', 'y', 'zoom'].every(key => previous[key] === value[key])) return;
    // A delayed acknowledgement of our own commit must not interrupt a newer gesture.
    if (pending.current) return;
    cancelAnimationFrame(animation.current);
    animation.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = null;
    clearTimeout(timer.current);
    timer.current = null;
    destination.current = null;
    pending.current = false;
    current.current = value;
    paint.current?.(value);
    render(value);
  }, [value, render]);
  useEffect(() => {
    window.addEventListener('blur', flush);
    return () => {
      window.removeEventListener('blur', flush);
      flush();
    };
  }, [flush]);
  return { camera, cameraRef: current, updateCamera: update, navigate, flushCamera: flush };
}
