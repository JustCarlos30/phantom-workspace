// Pure helpers for the canvas board: what a paste or a drop means, and how
// references and comment times are shown. No DOM state lives here.
import { reviewBrief } from '../../shared/video-review.mjs';
export const referenceURL = (workspaceId, file) => `phantom-ref://${workspaceId}/${file}`;
export const INLINE_LIMIT = 11 * 1024 * 1024;
const WEB = /^https?:\/\/[^\s]+$/i;

export function timecode(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.floor(seconds), h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
}

// A clipboard or drag payload → ordered intents. Files win over the text that
// browsers add next to a copied image; a block of URLs becomes one link each.
export function readTransfer(transfer) {
  const files = [...(transfer?.files || [])].filter(file => /^(image|video)\//.test(file.type) || /\.(png|jpe?g|gif|webp|avif|mp4|mov|webm|m4v)$/i.test(file.name || ''));
  if (files.length) return files.map(file => ({ kind: 'file', file }));
  const uris = (transfer?.getData('text/uri-list') || '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && WEB.test(line));
  if (uris.length) return uris.map(url => ({ kind: 'link', url }));
  const text = (transfer?.getData('text/plain') || '').trim();
  if (!text) return [];
  const lines = text.split(/\s*\n\s*/).filter(Boolean);
  if (lines.length <= 24 && lines.every(line => WEB.test(line))) return lines.map(url => ({ kind: 'link', url }));
  return [{ kind: 'note', text }];
}

export const toBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
  reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
  reader.readAsDataURL(blob);
});

// Pins of one view, numbered in the order they were made. `nodes` are the
// panels on screen; canvas pins belong to the space they were dropped in.
export function visibleComments(comments, nodes, spaceId = null) {
  const ids = new Set(nodes.map(n => n.id));
  return (comments || []).map((comment, index) => ({ ...comment, number: index + 1 })).filter(c => c.nodeId ? ids.has(c.nodeId) : (c.spaceId || null) === (spaceId || null));
}

// What an agent needs to act on a thread: the panel, its file and the words.
export function commentBrief(comment, node, filePath) {
  const where = node ? `${node.type === 'reference' ? 'Referencia' : 'Panel'} "${node.title}"${filePath ? ` (${filePath})` : node.data?.url ? ` (${node.data.url})` : ''}` : 'Canvas';
  const at = [node ? `posición ${Math.round(comment.x * 100)}%, ${Math.round(comment.y * 100)}%${comment.review ? ' del contenido normalizado' : ''}` : '', comment.time !== undefined ? `minuto ${timecode(comment.time)}` : ''].filter(Boolean).join(' · ');
  const capture = comment.review?.capture && filePath ? `${filePath.slice(0, filePath.lastIndexOf('/') + 1)}${comment.review.capture}` : null;
  return [`Comentario en ${where}${at ? ` — ${at}` : ''}:`, ...(comment.review ? [reviewBrief(comment.review)] : []), ...(capture ? [`Captura: ${capture}`] : []), ...comment.messages.map(m => `- ${m.author}: ${m.text}`)].join('\n');
}
