const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function frameFor(node, area, view, keepZoom) {
  if (!view.width || !view.height) return null;
  const n = node.type === 'zone' ? { ...node, y: node.y - 44, height: node.height + 44 } : node;
  const a = area, w = Math.max(160, view.width - a.left - a.right), h = Math.max(80, view.height - a.top - a.bottom);
  const zoom = Number.isFinite(keepZoom) ? clamp(keepZoom, .15, 1.8) : clamp(Math.min(1, (w - 64) / n.width, (h - 24) / n.height), .15, 1);
  return { x: a.left + (w - n.width * zoom) / 2 - n.x * zoom, y: a.top + (h - n.height * zoom) / 2 - n.y * zoom, zoom };
}

export function needsFraming({ clipped, zoom, target, type }) {
  if (clipped || !Number.isFinite(target)) return clipped;
  if (type === 'zone') return false;
  return zoom < target * .85 || zoom > target * 1.15;
}
