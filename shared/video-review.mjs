// Coordinates are relative to decoded content, never panel chrome or contain bars.
export function contentBox(box, width, height) {
  if (!box || ![box.width, box.height, width, height].every(n => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.min(box.width / width, box.height / height);
  const w = width * scale, h = height * scale;
  return { x: (box.x ?? box.left ?? 0) + (box.width - w) / 2, y: (box.y ?? box.top ?? 0) + (box.height - h) / 2, width: w, height: h };
}
export function contentPoint(box, x, y) {
  if (!box || !Number.isFinite(x) || !Number.isFinite(y) || x < box.x || y < box.y || x > box.x + box.width || y > box.y + box.height) return null;
  return { x: (x - box.x) / box.width, y: (y - box.y) / box.height };
}
export const frameAt = (time, fps) => Math.max(0, Math.round(time * fps));
export function stepTime(time, delta, fps, duration) {
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) throw new Error('Indica FPS entre 0 y 240');
  if (!Number.isFinite(time) || time < 0 || !Number.isInteger(delta) || !Number.isFinite(duration) || duration <= 0) throw new Error('Espera a que el video cargue su duración');
  return Math.max(0, Math.min(Math.max(0, duration - 1 / fps), (frameAt(time, fps) + delta) / fps));
}
export function validateReview(r) {
  const need = (ok, message) => { if (!ok) throw new Error(message); };
  need(r && r.schema === 1, 'Revisión no compatible');
  need(typeof r.file === 'string' && /^[a-f0-9]{32}\.(png|jpg|gif|webp|avif|mp4|mov|webm)$/.test(r.file), 'Archivo de revisión inválido');
  need(typeof r.hash === 'string' && /^[a-f0-9]{64}$/.test(r.hash) && r.file.startsWith(r.hash.slice(0, 32)), 'Hash de revisión inválido');
  need(['image', 'video'].includes(r.kind), 'Media de revisión inválida');
  if (r.capture !== undefined) need(/^[a-f0-9]{32}\.png$/.test(r.capture), 'Captura inválida');
  const a = r.region;
  need(a && ['point', 'rect'].includes(a.type) && [a.x, a.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1), 'Región inválida');
  if (a.type === 'rect') need([a.width, a.height].every(n => Number.isFinite(n) && n > 0) && a.x + a.width <= 1.000001 && a.y + a.height <= 1.000001, 'Rectángulo fuera del contenido');
  need(['instant', 'range', 'all'].includes(r.scope), 'Alcance inválido');
  if (r.scope !== 'range') need(r.end === undefined, 'El final solo corresponde a un tramo');
  if (r.kind === 'video') {
    need(Number.isFinite(r.fps) && r.fps > 0 && r.fps <= 240, 'FPS explícito requerido (máximo 240)');
    need(Number.isFinite(r.time) && r.time >= 0 && r.time <= 1e6 && Number.isSafeInteger(r.frame) && r.frame === frameAt(r.time, r.fps), 'Tiempo/frame inválido');
    if (r.scope === 'range') need(Number.isFinite(r.end) && r.end > r.time && r.end <= 1e6, 'El final del tramo debe ser posterior al inicio');
  } else need(r.scope === 'all', 'Una imagen usa alcance completo');
  for (const key of ['element', 'editableSource', 'captureLimit']) if (r[key] !== undefined) need(typeof r[key] === 'string' && r[key].length <= 4096, 'Elemento o fuente demasiado largo');
  return r;
}
export function reviewBrief(r) {
  if (!r) return '';
  return `Revisión audiovisual (coordenadas normalizadas del contenido):\n${JSON.stringify(r, null, 2)}\nEl elemento es una descripción del usuario, no una selección semántica automática. El alcance «all» expresa intención; no acredita detección de apariciones. Entregar contexto no acredita modificar la fuente ni resolver el comentario.`;
}
