export const panelGap = 32;
export function rectanglesOverlap(a, b, gap = panelGap) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

// Only place the new rectangle. Existing positions, sizes and camera are inputs,
// never changed. Edge candidates support mixed sizes without a rigid grid.
export function findPanelPlacement({ nodes = [], width, height, camera = { x: 64, y: 64, zoom: 1 }, viewport = { width: 1000, height: 700 } }) {
  const visible = nodes.filter(n => !n.data?.hidden);
  const usableWidth = Math.max(320, viewport.width - 112), usableHeight = Math.max(240, viewport.height - 160);
  const anchor = { x: Math.round((viewport.width / 2 - camera.x) / camera.zoom - width / 2), y: Math.round(((viewport.height - 80) / 2 - camera.y) / camera.zoom - height / 2) };
  if (visible.every(n => !rectanglesOverlap({ ...anchor, width, height }, n))) return anchor;
  const xs = new Set([anchor.x]), ys = new Set([anchor.y]);
  for (const n of visible) {
    [n.x, n.x + n.width + panelGap, n.x - width - panelGap].forEach(x => xs.add(x));
    [n.y, n.y + n.height + panelGap, n.y - height - panelGap].forEach(y => ys.add(y));
  }
  const bounds = visible.length ? { left: Math.min(...visible.map(n => n.x)), right: Math.max(...visible.map(n => n.x + n.width)), top: Math.min(...visible.map(n => n.y)), bottom: Math.max(...visible.map(n => n.y + n.height)) } : null;
  let best, bestScore = Infinity;
  for (const x of xs) for (const y of ys) {
    const candidate = { x, y, width, height };
    if (visible.some(n => rectanglesOverlap(candidate, n))) continue;
    const spanX = bounds ? Math.max(bounds.right, x + width) - Math.min(bounds.left, x) : width;
    const spanY = bounds ? Math.max(bounds.bottom, y + height) - Math.min(bounds.top, y) : height;
    const distance = Math.hypot((x - anchor.x) / usableWidth, (y - anchor.y) / usableHeight);
    const score = Math.max(spanX / usableWidth, spanY / usableHeight) + distance * .08;
    if (score < bestScore) { bestScore = score; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  // An outer edge is always available, including in very dense imported maps.
  return best || { x: Math.round((bounds?.right || anchor.x) + panelGap), y: anchor.y };
}
