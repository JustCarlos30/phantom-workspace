import React, { useRef } from 'react';

const WIDTH = 188, HEIGHT = 124, PAD = 10;

// Miro/Figma-style overview: every panel as a block plus the current viewport.
// Click or drag inside to move the camera there.
export default function Minimap({ nodes, camera, size, selected, onNavigate, onUpdate }) {
  const drag = useRef(null);
  if (!nodes.length) return null;
  const view = { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, width: size.width / camera.zoom, height: size.height / camera.zoom };
  const left = Math.min(view.x, ...nodes.map(n => n.x)), top = Math.min(view.y, ...nodes.map(n => n.y));
  const right = Math.max(view.x + view.width, ...nodes.map(n => n.x + n.width)), bottom = Math.max(view.y + view.height, ...nodes.map(n => n.y + n.height));
  const scale = Math.min((WIDTH - PAD * 2) / (right - left || 1), (HEIGHT - PAD * 2) / (bottom - top || 1));
  const ox = PAD + ((WIDTH - PAD * 2) - (right - left) * scale) / 2 - left * scale;
  const oy = PAD + ((HEIGHT - PAD * 2) - (bottom - top) * scale) / 2 - top * scale;
  const toWorld = e => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
  };
  const center = (point, smooth) => (smooth ? onNavigate : onUpdate)({ ...camera, x: size.width / 2 - point.x * camera.zoom, y: size.height / 2 - point.y * camera.zoom });
  return <div className="canvas-minimap" aria-label="Minimapa del canvas" role="img"
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = true; center(toWorld(e), true); }}
    onPointerMove={e => { if (drag.current) center(toWorld(e), false); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {nodes.map(n => <rect key={n.id} className={`minimap-node type-${n.type} ${selected.includes(n.id) ? 'selected' : ''}`} x={ox + n.x * scale} y={oy + n.y * scale} width={Math.max(2, n.width * scale)} height={Math.max(2, n.height * scale)} rx={2} />)}
      <rect className="minimap-view" x={ox + view.x * scale} y={oy + view.y * scale} width={view.width * scale} height={view.height * scale} rx={3} />
    </svg>
  </div>;
}
