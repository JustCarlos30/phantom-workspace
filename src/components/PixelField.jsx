import React, { useEffect, useRef } from 'react';

// Background pulses in nahnotch's pixel grammar (notch/tokens.js · PIXEL, RESPIRA):
// whole squares on the canvas dot grid, only four alphas, 12 fps steps, no
// antialiasing. Motion is spent on real state changes only: at rest the field
// paints nothing, so the workspace stays still and focus is never stolen.
const GRID = 24, FPS = 12, DOT = 4;
const ALPHA = { head: [1, .85, .55, .35], trail: .35, corner: .85, arm: .55 };
// Rings travel `reach` cells outward. Every new state announces itself with one
// ring: a real change. Only the hero (nahnotch: one at a time, needs > failure
// > done) keeps calling, on the 2.4 s bar until the 30 s backoff. `call` is an
// approval, `turn` your move, `error` a failure; the first two keep corner marks.
const RING = { reach: 6, bar: 2.4, backoff: 30 };
const PLAN = { call: { marks: true, rings: Infinity, rank: 0 }, error: { marks: false, rings: 1, rank: 1 }, turn: { marks: true, rings: 2, rank: 2 } };
const COLOR = { call: '--attention', turn: '--attention', error: '--danger' };

// Dots sit at tile centres: world (k + .5) · cell. Cells under the panel span c0..c1.
const span = (start, size, cell) => [Math.ceil(start / cell - .5), Math.floor((start + size) / cell - .5)];
const dist = (c, [lo, hi]) => c < lo ? lo - c : c > hi ? c - hi : 0;

function ringTimes(plan, since, now) {
  const times = [];
  for (let k = 0; k < plan.rings; k++) {
    const t = since + k * RING.bar;
    if (t - since >= RING.backoff || t > now) break;
    times.push(now - t);
  }
  return times;
}

export default function PixelField({ targets, cameraRef, paintRef, hidden }) {
  const canvas = useRef(null);
  const states = useRef(new Map());
  const live = useRef({ targets, hidden }); live.current = { targets, hidden };
  const loop = useRef({ frame: null, lastStep: -1 });
  const colors = useRef({});

  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const readColors = () => { const css = getComputedStyle(el); for (const [kind, name] of Object.entries(COLOR)) colors.current[kind] = css.getPropertyValue(name).trim() || '#ffab40'; };
    const resize = () => {
      const ratio = window.devicePixelRatio || 1, { width, height } = el.getBoundingClientRect();
      el.width = Math.max(1, Math.round(width * ratio)); el.height = Math.max(1, Math.round(height * ratio));
      readColors(); paint();
    };
    // Returns whether anything is still moving, so the loop can stop itself.
    function paint() {
      const { targets: list, hidden: off } = live.current;
      ctx.clearRect(0, 0, el.width, el.height);
      if (off || !list.length) return false;
      const ratio = window.devicePixelRatio || 1, cam = cameraRef.current, now = performance.now() / 1000;
      let cell = GRID; while (cell * cam.zoom < 14) cell *= 2;   // same doubling as the dot grid
      const size = Math.max(2, Math.round(DOT * Math.min(1.5, Math.max(.5, cam.zoom)) * ratio));
      const half = size / 2;
      let moving = false;
      const dot = (cx, cy, alpha) => {
        const sx = Math.round(((cx + .5) * cell * cam.zoom + cam.x) * ratio - half), sy = Math.round(((cy + .5) * cell * cam.zoom + cam.y) * ratio - half);
        if (sx < -size || sy < -size || sx > el.width || sy > el.height) return;
        ctx.globalAlpha = alpha; ctx.fillRect(sx, sy, size, size);
      };
      // Every cell at Chebyshev distance r from the panel's cells: a square ring.
      const ring = (sx, sy, r, alpha, checker) => {
        for (let cx = sx[0] - r; cx <= sx[1] + r; cx++) for (let cy = sy[0] - r; cy <= sy[1] + r; cy++) {
          if (Math.max(dist(cx, sx), dist(cy, sy)) !== r) continue;
          if (checker && (cx + cy) % 2) continue;
          dot(cx, cy, alpha);
        }
      };
      // The hero: most urgent kind, then whoever has waited longest.
      let hero = null;
      for (const t of list) {
        const state = states.current.get(t.id), plan = PLAN[t.kind];
        if (!state || !plan) continue;
        if (!hero || plan.rank < hero.rank || (plan.rank === hero.rank && state.since < hero.since)) hero = { id: t.id, rank: plan.rank, since: state.since };
      }
      for (const t of list) {
        const base = PLAN[t.kind], state = states.current.get(t.id);
        if (!base || !state) continue;
        const plan = t.id === hero?.id ? base : { ...base, rings: 1 };
        const sx = span(t.x, t.width, cell), sy = span(t.y, t.height, cell);
        const reach = (RING.reach + 1) * cell;
        const left = (t.x - reach) * cam.zoom + cam.x, top = (t.y - reach) * cam.zoom + cam.y;
        const right = (t.x + t.width + reach) * cam.zoom + cam.x, bottom = (t.y + t.height + reach) * cam.zoom + cam.y;
        if (right < 0 || bottom < 0 || left * ratio > el.width || top * ratio > el.height) continue;
        ctx.fillStyle = colors.current[t.kind];
        if (plan.marks) {
          // Viewfinder corners one cell out: an L of three pixels per corner.
          for (const [cx, dx] of [[sx[0] - 1, 1], [sx[1] + 1, -1]]) for (const [cy, dy] of [[sy[0] - 1, 1], [sy[1] + 1, -1]]) {
            dot(cx, cy, ALPHA.corner);
            dot(cx + dx, cy, ALPHA.arm); dot(cx, cy + dy, ALPHA.arm);
          }
        }
        if (reduced.matches) continue;
        for (const age of ringTimes(plan, state.since, now)) {
          const step = Math.floor(age * FPS);
          if (step >= RING.reach) continue;
          moving = true;
          const r = step + 1, level = Math.min(3, Math.floor(step * 4 / RING.reach));
          ring(sx, sy, r, ALPHA.head[level], false);
          if (r > 1) ring(sx, sy, r - 1, ALPHA.trail, true);
        }
        const rings = Math.min(plan.rings, Math.ceil(RING.backoff / RING.bar));
        if (now < state.since + (rings - 1) * RING.bar + RING.reach / FPS) moving = true;
      }
      ctx.globalAlpha = 1;
      return moving;
    }
    // Repaint only on 12 fps step boundaries; idle costs nothing.
    function tick() {
      const step = Math.floor(performance.now() / 1000 * FPS);
      let moving = true;
      if (step !== loop.current.lastStep) { loop.current.lastStep = step; moving = paint(); }
      loop.current.frame = moving ? requestAnimationFrame(tick) : null;
    }
    const wake = () => { if (loop.current.frame == null) loop.current.frame = requestAnimationFrame(tick); };
    // Camera frames are painted imperatively; a static frame redraws with them.
    paintRef.current = () => { if (loop.current.frame == null) paint(); };
    paintRef.wake = wake;
    const observer = new ResizeObserver(resize); observer.observe(el);
    reduced.addEventListener('change', wake);
    resize();
    return () => { observer.disconnect(); reduced.removeEventListener('change', wake); cancelAnimationFrame(loop.current.frame); loop.current.frame = null; paintRef.current = null; };
  }, [cameraRef, paintRef]);

  // A state only counts from the moment it begins; re-entering restarts its pulses.
  useEffect(() => {
    const now = performance.now() / 1000, seen = new Set();
    for (const t of targets) {
      seen.add(t.id);
      const previous = states.current.get(t.id);
      if (!previous || previous.kind !== t.kind) states.current.set(t.id, { kind: t.kind, since: now });
    }
    for (const id of states.current.keys()) if (!seen.has(id)) states.current.delete(id);
    loop.current.lastStep = -1;
    paintRef.wake?.();
  }, [targets, hidden, paintRef]);

  return <canvas ref={canvas} className="pixel-field" aria-hidden="true" />;
}
