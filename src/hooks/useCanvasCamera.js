import { useCallback, useEffect, useRef, useState } from 'react';

// Input can arrive faster than the display. Paint once per frame and persist
// only after navigation settles, rather than updating the entire app per event.
export function useCanvasCamera(value, onCommit) {
  const [camera, setCamera] = useState(value);
  const current = useRef(value);
  const frame = useRef(null), timer = useRef(null), animation = useRef(null);
  const pending = useRef(false), commit = useRef(onCommit);
  const external = useRef(value);
  commit.current = onCommit;
  const flush = useCallback(() => {
    cancelAnimationFrame(animation.current);
    clearTimeout(timer.current);
    if (pending.current) { pending.current = false; commit.current(current.current); }
  }, []);
  const update = useCallback(next => {
    cancelAnimationFrame(animation.current);
    current.current = next;
    pending.current = true;
    if (frame.current === null) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setCamera(current.current);
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 180);
  }, [flush]);
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
    setCamera(value);
  }, [value]);
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
