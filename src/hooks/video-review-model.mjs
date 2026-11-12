export const validReviewId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
export function createReviewId(uuid = globalThis.crypto.randomUUID()) {
  const id = `nota-${uuid}`;
  if (!validReviewId(id)) throw new Error('ID de comentario inválido.');
  return id;
}
export function clampFrame(frame, total) {
  if (!Number.isFinite(Number(frame)) || !Number.isInteger(total) || total < 1) throw new Error('Frame o duración inválidos.');
  return Math.max(0, Math.min(total - 1, Math.floor(Number(frame))));
}
export function frameToTime(frame, fps) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('FPS inválidos.');
  return frame / fps;
}
export function timeToFrame(time, fps, total) {
  return clampFrame(time / frameToTime(1, fps) + 1e-7, total);
}
export function clampRange(start, end, total) {
  const a = clampFrame(start, total), b = clampFrame(end, total);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
export function videoRect(box, width, height) {
  if (![box.width, box.height, width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Dimensiones inválidas.');
  const scale = Math.min(box.width / width, box.height / height);
  return { left: (box.width - width * scale) / 2, top: (box.height - height * scale) / 2, width: width * scale, height: height * scale };
}
export function validRegion(r) {
  return !!r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= 1 && r.y + r.height <= 1;
}
export function normalizeRegion(from, to, rect) {
  const unit = (n, offset, size) => Math.max(0, Math.min(1, (n - offset) / size));
  const x = [unit(from.x, rect.left, rect.width), unit(to.x, rect.left, rect.width)].sort((a, b) => a - b);
  const y = [unit(from.y, rect.top, rect.height), unit(to.y, rect.top, rect.height)].sort((a, b) => a - b);
  const region = { x: x[0], y: y[0], width: x[1] - x[0], height: y[1] - y[0] };
  return validRegion(region) ? region : null;
}
export function elementsForRange(elements, range) {
  return elements.filter(element => !element.range || element.range.start <= range.start && element.range.end >= range.end);
}
