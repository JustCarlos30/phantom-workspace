import { frameFor } from './panelFraming.js';

export const CHANGES_GAP = 24;
export const CHANGES_MIN_ZOOM = .9;

export function changesLayout(node, preview, area, view) {
  if (!node) return null;
  const source = { ...node, ...preview };
  if (![source.x, source.y, source.width, source.height].every(Number.isFinite) || source.width <= 0 || source.height <= 0) return null;
  const placement = { left: source.x + source.width + CHANGES_GAP, top: source.y, width: 720, height: Math.min(760, Math.max(480, source.height)) };
  const bounds = { x: source.x, y: source.y, width: source.width + CHANGES_GAP + placement.width, height: Math.max(source.height, placement.height) };
  const camera = frameFor(bounds, area, view);
  return { placement, camera, expanded: !camera || camera.zoom < CHANGES_MIN_ZOOM };
}

export function changesSession(node) {
  return JSON.stringify([node?.data?.worktree?.path, node?.data?.sessionId, node?.data?.chat?.provider, node?.data?.chat?.sessionId]);
}

export function appendReviewComment(draft, comment) {
  const { path, startLine, endLine, text } = comment || {};
  if (typeof path !== 'string' || !path.trim() || typeof text !== 'string' || !text.trim() || !Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(endLine) || endLine < startLine) return draft;
  const range = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
  const quote = `Revisión de ${path}:${range}\n${text.split('\n').map(line => `> ${line}`).join('\n')}`;
  return draft ? `${draft}\n\n${quote}` : quote;
}
