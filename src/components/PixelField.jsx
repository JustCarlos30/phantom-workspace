import React, { useEffect, useRef } from 'react';

// Background pulses: soft vector waves that leave the panel's edge and travel
// outward, like sonar. Each birth is a rounded outline the shape of the panel
// that expands on an ease-out curve while it thins and fades, followed by a
// fainter echo. Painted antialiased at the display's native rate, and only
// while something moves: at rest the field paints nothing (or a static halo),
// so the workspace stays still and focus is never stolen.
//
// `call` is an approval, `turn` your move, `error` a failure, `work` an agent
// working. Every new state announces itself with one wave; only the hero
// (needs > failure > done, then whoever waited longest) keeps calling on the
// 2.4 s bar until the 30 s backoff. Working breathes a quiet wave forever.
const WAVE = { reach: 84, minPx: 28, maxPx: 132, life: 1.6, echo: .22, bar: 2.4, backoff: 30 };
const PLAN = {
  call: { halo: true, rings: Infinity, rank: 0, alpha: .62, width: 2.6 },
  error: { halo: false, rings: 1, rank: 1, alpha: .7, width: 2.6 },
  turn: { halo: true, rings: 2, rank: 2, alpha: .5, width: 2.2 },
  work: { halo: false, rings: Infinity, rank: 9, alpha: .26, width: 1.6, bar: 3.2, reach: .55, forever: true },
};
const COLOR = { call: '--attention', turn: '--attention', error: '--danger', work: '--working' };
const RADIUS = 10;

const easeOut = t => 1 - Math.pow(1 - t, 3);

// Ages (s) of every wave birth still alive for this state.
function waveAges(plan, since, now) {
  const bar = plan.bar || WAVE.bar, ages = [];
  const alive = WAVE.life + WAVE.echo;
  let first = 0;
  if (plan.forever) first = Math.max(0, Math.floor((now - since - alive) / bar));
  for (let k = first; k < plan.rings; k++) {
    const t = since + k * bar;
    if (t > now || (!plan.forever && t - since >= WAVE.backoff)) break;
    if (now - t < alive) ages.push(now - t);
  }
  return ages;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function PixelField({ targets, cameraRef, paintRef, hidden }) {
  const canvas = useRef(null);
  const states = useRef(new Map());
  const live = useRef({ targets, hidden }); live.current = { targets, hidden };
  const loop = useRef({ frame: null });
  const colors = useRef({});

  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const readColors = () => { const css = getComputedStyle(el); for (const [kind, name] of Object.entries(COLOR)) colors.current[kind] = css.getPropertyValue(name).trim() || '#e9b46a'; };
    const resize = () => {
      const ratio = window.devicePixelRatio || 1, { width, height } = el.getBoundingClientRect();
      el.width = Math.max(1, Math.round(width * ratio)); el.height = Math.max(1, Math.round(height * ratio));
      readColors(); paint();
    };
    // Returns whether anything is still moving, so the loop can stop itself.
    function paint() {
      const { targets: list, hidden: off } = live.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.width, el.height);
      if (off || !list.length) return false;
      const ratio = window.devicePixelRatio || 1, cam = cameraRef.current, now = performance.now() / 1000;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);   // draw in CSS pixels, crisp on any DPR
      const W = el.width / ratio, H = el.height / ratio;
      let moving = false;
      // The hero: most urgent kind, then whoever has waited longest.
      let hero = null;
      for (const t of list) {
        const state = states.current.get(t.id), plan = PLAN[t.kind];
        if (!state || !plan || plan.forever) continue;
        if (!hero || plan.rank < hero.rank || (plan.rank === hero.rank && state.since < hero.since)) hero = { id: t.id, rank: plan.rank, since: state.since };
      }
      for (const t of list) {
        const base = PLAN[t.kind], state = states.current.get(t.id);
        if (!base || !state) continue;
        const plan = base.forever || t.id === hero?.id ? base : { ...base, rings: 1 };
        // Panel rectangle on screen (CSS px).
        const x = t.x * cam.zoom + cam.x, y = t.y * cam.zoom + cam.y, w = t.width * cam.zoom, h = t.height * cam.zoom;
        const reach = Math.min(WAVE.maxPx, Math.max(WAVE.minPx, WAVE.reach * cam.zoom)) * (plan.reach || 1);
        if (x + w + reach < 0 || y + h + reach < 0 || x - reach > W || y - reach > H) continue;
        const radius = RADIUS * Math.max(cam.zoom, .45);
        const color = colors.current[t.kind];
        ctx.strokeStyle = color; ctx.shadowColor = color;
        if (plan.halo) {
          // A steady soft halo hugging the edge for as long as it's your move.
          const o = 4;
          ctx.globalAlpha = .32; ctx.lineWidth = 1.25; ctx.shadowBlur = 8;
          roundRect(ctx, x - o, y - o, w + o * 2, h + o * 2, radius + o); ctx.stroke();
        }
        if (reduced.matches) continue;
        for (const age of waveAges(plan, state.since, now)) {
          // Main wave, then a fainter echo trailing it.
          for (const [delay, gain] of [[0, 1], [WAVE.echo, .45]]) {
            const p = (age - delay) / WAVE.life;
            if (p < 0 || p >= 1) continue;
            moving = true;
            const e = easeOut(p), o = 1 + e * reach;
            ctx.globalAlpha = plan.alpha * gain * Math.pow(1 - p, 1.6);
            ctx.lineWidth = Math.max(.5, plan.width * (1 - e * .7));
            ctx.shadowBlur = 6 + 10 * e;
            roundRect(ctx, x - o, y - o, w + o * 2, h + o * 2, radius + o); ctx.stroke();
          }
        }
        if (plan.forever) moving = true;
        else {
          const rings = Math.min(plan.rings, Math.ceil(WAVE.backoff / WAVE.bar));
          if (now < state.since + (rings - 1) * WAVE.bar + WAVE.life + WAVE.echo) moving = true;
        }
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      return moving;
    }
    function tick() {
      const moving = paint();
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
    paintRef.wake?.();
  }, [targets, hidden, paintRef]);

  return <canvas ref={canvas} className="pixel-field" aria-hidden="true" />;
}
