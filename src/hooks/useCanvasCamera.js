import { useCallback, useEffect, useRef, useState } from 'react';

// Zoom levels where the rendered canvas changes shape (overview cards, compact
// summaries). React only needs to re-render when one of these is crossed.
// Above 100% (-1) terminals switch to the crisp DOM renderer.
export const cameraTier = zoom => zoom > 1 ? -1 : zoom < .25 ? 2 : zoom < .45 ? 1 : 0;

// Input can arrive faster than the display. Paint once per frame through
// `onFrame` (imperative DOM writes, no React render), re-render React only
// when the zoom tier changes or navigation settles, and persist after settle.
export function useCanvasCamera(value, onCommit, onFrame) {
  const [camera, setCamera] = useState(value);
  const current = useRef(value);
  const rendered = useRef(value);
  const frame = useRef(null), timer = useRef(null), animation = useRef(null);
  const pending = useRef(false), commit = useRef(onCommit), paint = useRef(onFrame);
  const external = useRef(value);
  commit.current = onCommit;
  paint.current = onFrame;
  const render = useCallback(next => { rendered.current = next; setCamera(next); }, []);
  const flush = useCallback(() => {
    cancelAnimationFrame(animation.current);
    clearTimeout(timer.current);
    if (rendered.current !== current.current) render(current.current);
    if (pending.current) { pending.current = false; commit.current(current.current); }
  }, [render]);
  const update = useCallback(next => {
    cancelAnimationFrame(animation.current);
    current.current = next;
    pending.current = true;
    if (frame.current === null) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const latest = current.current;
      paint.current?.(latest);
      if (cameraTier(latest.zoom) !== cameraTier(rendered.current.zoom)) render(latest);
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 180);
  }, [flush, render]);
  const navigate = useCallback(next => {
    cancelAnimationFrame(animation.current);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { update(next); return; }
    const start = { ...current.current }, time = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - time) / 180), ease = 1 - (1 - progress) ** 3;
      update(Object.fromEntries(['x', 'y', 'zoom'].map(key => [key, start[key] + (next[key] - start[key]) * ease])));
      if (progress < 1) animation.current = requestAnimationFrame(tick);
    };
    animation.current = requestAnimationFrame(tick);
  }, [update]);
  useEffect(() => {
    const previous = external.current;
    external.current = value;
    if (['x', 'y', 'zoom'].every(key => previous[key] === value[key])) return;
    // A delayed acknowledgement of our own commit must not interrupt a newer gesture.
    if (pending.current) return;
    cancelAnimationFrame(animation.current);
    clearTimeout(timer.current);
    pending.current = false;
    current.current = value;
    paint.current?.(value);
    render(value);
  }, [value, render]);
  useEffect(() => {
    window.addEventListener('blur', flush);
    return () => {
      window.removeEventListener('blur', flush);
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(animation.current);
      flush();
    };
  }, [flush]);
  return { camera, cameraRef: current, updateCamera: update, navigate, flushCamera: flush };
}
