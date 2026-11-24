// Spacing of the dot grid in screen pixels: the world grid scaled by the zoom,
// doubled until dots sit at least `min` pixels apart. Closed form on purpose:
// a doubling loop never ends for a zoom that is zero or negative.
export function gridStep(grid, zoom, min = 14) {
  const base = grid * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  if (base >= min) return base;
  let step = base * 2 ** Math.ceil(Math.log2(min / base));
  if (step < min) step *= 2;
  return step;
}
