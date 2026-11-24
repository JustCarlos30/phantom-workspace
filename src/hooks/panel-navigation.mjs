const visiblePanel = node => node && typeof node.id === 'string' && node.id && node.type !== 'zone' && !node.hidden && !node.data?.hidden;
const hasGeometry = node => [node.x, node.y, node.width, node.height].every(Number.isFinite) && node.width > 0 && node.height > 0;

/**
 * Vecino visible no zona, devuelto como ID o null. Coordenadas del canvas, sin
 * cámara. direction: left/right/up/down. El centro debe avanzar en ese eje;
 * se prioriza solapamiento perpendicular, distancia entre bordes y distancia
 * entre centros. Empates exactos: ID lexicográfico, independiente del orden.
 * El llamador filtra los espacios inactivos antes de pasar nodes.
 */
export function directionalNeighbor(nodes, currentId, direction) {
  if (!Array.isArray(nodes) || !['left', 'right', 'up', 'down'].includes(direction)) return null;
  const panels = nodes.filter(node => visiblePanel(node) && hasGeometry(node));
  const current = panels.find(node => node.id === currentId);
  if (!current) return null;
  const horizontal = direction === 'left' || direction === 'right';
  const axis = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x';
  const size = horizontal ? 'width' : 'height', crossSize = horizontal ? 'height' : 'width';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  let best = null, bestRank = null;
  for (const node of panels) {
    if (node.id === currentId) continue;
    const advance = sign * (node[axis] + node[size] / 2 - current[axis] - current[size] / 2);
    if (advance <= 0) continue;
    const offset = node[cross] + node[crossSize] / 2 - current[cross] - current[crossSize] / 2;
    const crossGap = Math.max(0, node[cross] - current[cross] - current[crossSize], current[cross] - node[cross] - node[crossSize]);
    const gap = Math.max(0, sign > 0 ? node[axis] - current[axis] - current[size] : current[axis] - node[axis] - node[size]);
    const rank = [crossGap === 0 ? 0 : 1, gap ** 2 + crossGap ** 2, advance ** 2 + offset ** 2];
    const difference = bestRank ? rank.map((value, i) => value - bestRank[i]).find(value => value !== 0) || 0 : -1;
    if (difference < 0 || (difference === 0 && node.id < best.id)) {
      best = node;
      bestRank = rank;
    }
  }
  return best?.id || null;
}

/**
 * Cicla IDs de terminales visibles (incluye chats y sesiones finalizadas) en el
 * orden recibido, sin exigir PTY ni geometría. delta es un entero con signo;
 * sin selección empieza por el primero/último. Lista vacía o delta inválido →
 * null; un único terminal se devuelve a sí mismo. No modifica nodes.
 */
export function cycleSession(nodes, currentId, delta) {
  if (!Array.isArray(nodes) || !Number.isSafeInteger(delta) || delta === 0) return null;
  const sessions = nodes.filter(node => visiblePanel(node) && node.type === 'terminal');
  if (!sessions.length) return null;
  const index = sessions.findIndex(node => node.id === currentId);
  if (index < 0) return sessions[delta > 0 ? 0 : sessions.length - 1].id;
  const next = (index + delta % sessions.length + sessions.length) % sessions.length;
  return sessions[next].id;
}
