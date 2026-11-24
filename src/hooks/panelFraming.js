const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function frameFor(node, area, view) {
  if (!view.width || !view.height) return null;
  const n = node.type === 'zone' ? { ...node, y: node.y - 44, height: node.height + 44 } : node;
  const a = area, w = Math.max(160, view.width - a.left - a.right), h = Math.max(80, view.height - a.top - a.bottom);
  const zoom = clamp(Math.min(1, (w - 64) / n.width, (h - 24) / n.height), .15, 1);
  return { x: a.left + (w - n.width * zoom) / 2 - n.x * zoom, y: a.top + (h - n.height * zoom) / 2 - n.y * zoom, zoom };
}

export function reframeOnResize(camera, bounds, area, size) {
  const { left, top, right, bottom } = bounds, a = area, c = camera, z = c.zoom;
  if (left * z + c.x >= a.left + 12 && right * z + c.x <= size.width - a.right - 12 && top * z + c.y >= a.top && bottom * z + c.y <= size.height - a.bottom) return null;
  const w = size.width - a.left - a.right - 24, h = size.height - a.top - a.bottom;
  const fitsX = (right - left) * z <= w, fitsY = (bottom - top) * z <= h;
  return {
    x: fitsX ? a.left + 12 + (w - (right - left) * z) / 2 - left * z : a.left + 12 - left * z,
    y: fitsY ? a.top + (h - (bottom - top) * z) / 2 - top * z : a.top - top * z,
    zoom: z
  };
}

export function needsFraming({ clipped, zoom, target, type }) {
  if (clipped || !Number.isFinite(target)) return clipped;
  if (type === 'zone') return false;
  return zoom < target * .85 || zoom > target * 1.15;
}
