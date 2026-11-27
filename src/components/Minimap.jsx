import React, { useCallback, useEffect, useRef, useState } from 'react';
import '../canvas-motion.css';

const WIDTH = 188, HEIGHT = 124, PAD = 10;
// Time constant of the camera glide toward the pointer (ms). Low enough to
// feel attached to the cursor, high enough to absorb jittery pointer input.
const GLIDE = 55;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function measure(nodes, camera, size) {
  const view = { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, width: size.width / camera.zoom, height: size.height / camera.zoom };
  let left = view.x, top = view.y, right = view.x + view.width, bottom = view.y + view.height;
  for (const n of nodes) {
    left = Math.min(left, n.x); top = Math.min(top, n.y);
    right = Math.max(right, n.x + n.width); bottom = Math.max(bottom, n.y + n.height);
  }
  const scale = Math.min((WIDTH - PAD * 2) / (right - left || 1), (HEIGHT - PAD * 2) / (bottom - top || 1));
  return {
    scale,
    ox: PAD + ((WIDTH - PAD * 2) - (right - left) * scale) / 2 - left * scale,
    oy: PAD + ((HEIGHT - PAD * 2) - (bottom - top) * scale) / 2 - top * scale,
  };
}

// Miro/Figma-style overview: every panel as a block plus the current viewport.
// Click to glide there; grab the viewport (or keep dragging after a click) to
// steer the camera continuously.
export default function Minimap({ nodes, camera, cameraRef, frameRef, size, selected, onUpdate }) {
  // The canvas paints camera frames without re-rendering React, so follow
  // them here directly or the viewport rectangle lags behind and then jumps.
  const [live, setLive] = useState(() => cameraRef?.current || camera);
  const [dragging, setDragging] = useState(false);
  const [pulsing, setPulsing] = useState([]);
  const svg = useRef(null);
  const drag = useRef(null);      // { anchor } while the pointer is held
  const frozen = useRef(null);    // layout pinned during a drag/glide
  const target = useRef(null);    // world point the viewport center glides to
  const glide = useRef(null), lastTime = useRef(0);
  const update = useRef(onUpdate); update.current = onUpdate;
  const sizeRef = useRef(size); sizeRef.current = size;

  useEffect(() => {
    if (!frameRef) return undefined;
    frameRef.current = setLive;
    return () => { if (frameRef.current === setLive) frameRef.current = null; };
  }, [frameRef]);
  useEffect(() => { setLive(cameraRef?.current || camera); }, [camera, cameraRef]);
  useEffect(() => () => cancelAnimationFrame(glide.current), []);
  // Brief pulse on the panel the camera just jumped to (selection change).
  const selectedKey = selected.join('|');
  useEffect(() => {
    if (!selectedKey || reducedMotion()) { setPulsing([]); return undefined; }
    setPulsing(selectedKey.split('|'));
    const t = setTimeout(() => setPulsing([]), 700);
    return () => clearTimeout(t);
  }, [selectedKey]);

  const stopGlide = useCallback(() => {
    cancelAnimationFrame(glide.current); glide.current = null;
    target.current = null;
    if (!drag.current) frozen.current = null;
  }, []);

  const step = useCallback(now => {
    const c = cameraRef?.current || camera, s = sizeRef.current, point = target.current;
    if (!point) { glide.current = null; return; }
    const goal = { x: s.width / 2 - point.x * c.zoom, y: s.height / 2 - point.y * c.zoom };
    const dt = Math.min(64, now - (lastTime.current || now - 16)); lastTime.current = now;
    const k = reducedMotion() ? 1 : 1 - Math.exp(-dt / GLIDE);
    const dx = goal.x - c.x, dy = goal.y - c.y;
    const done = Math.hypot(dx, dy) < .5;
    update.current({ ...c, x: done ? goal.x : c.x + dx * k, y: done ? goal.y : c.y + dy * k });
    if (done && !drag.current) { glide.current = null; target.current = null; frozen.current = null; setLive(l => ({ ...l })); return; }
    glide.current = done ? null : requestAnimationFrame(step);
  }, [camera, cameraRef]);

  const steer = useCallback(point => {
    target.current = point;
    if (glide.current === null) { lastTime.current = 0; glide.current = requestAnimationFrame(step); }
  }, [step]);

  if (!nodes.length) return null;
  const layout = frozen.current || measure(nodes, live, size);
  const { scale, ox, oy } = layout;
  const view = { x: -live.x / live.zoom, y: -live.y / live.zoom, width: size.width / live.zoom, height: size.height / live.zoom };
  const toWorld = e => {
    const r = svg.current.getBoundingClientRect();
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
  };
  const inView = p => p.x >= view.x && p.x <= view.x + view.width && p.y >= view.y && p.y <= view.y + view.height;
  const end = () => { if (!drag.current) return; drag.current = null; setDragging(false); if (glide.current === null) stopGlide(); };

  return <div className={`canvas-minimap${dragging ? ' dragging' : ''}`} aria-label="Minimapa del canvas" role="img"
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      frozen.current = layout;
      const p = toWorld(e);
      // Grabbing the viewport keeps the grab offset; clicking elsewhere
      // glides the viewport's center to the click and keeps following.
      const anchor = inView(p) ? { x: p.x - (view.x + view.width / 2), y: p.y - (view.y + view.height / 2) } : { x: 0, y: 0 };
      drag.current = { anchor };
      setDragging(true);
      steer({ x: p.x - anchor.x, y: p.y - anchor.y });
    }}
    onPointerMove={e => {
      const p = toWorld(e);
      if (drag.current) { const { anchor } = drag.current; steer({ x: p.x - anchor.x, y: p.y - anchor.y }); return; }
      e.currentTarget.classList.toggle('over-view', inView(p));
    }}
    onPointerLeave={e => e.currentTarget.classList.remove('over-view')}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <svg ref={svg} width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {nodes.map(n => <rect key={n.id} className={`minimap-node type-${n.type} ${selected.includes(n.id) ? 'selected' : ''}${pulsing.includes(n.id) ? ' pulse' : ''}`} x={ox + n.x * scale} y={oy + n.y * scale} width={Math.max(2, n.width * scale)} height={Math.max(2, n.height * scale)} rx={2} />)}
      <rect className="minimap-view" x={ox + view.x * scale} y={oy + view.y * scale} width={view.width * scale} height={view.height * scale} rx={3} />
    </svg>
  </div>;
}
