import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { TextDecoder } from 'node:util';
import { parseVideoLog } from '../shared/video-log.mjs';
import { validatePluginPreferences } from '../shared/plugins.mjs';

export const MAX_VIDEO_LOG_BYTES = 512 * 1024;
// Called only with the workspace's saved configuration, never a payload path.
export async function readVideoLog(workspace) {
  const prefs = validatePluginPreferences(workspace.plugins)['video-log'];
  const base = { source: 'video-log', observedAt: new Date().toISOString(), origins: [], insights: [] };
  if (!prefs.enabled) return { ...base, available: false, state: 'disabled', reason: 'Plugin desactivado. Activa Bitácora de videos en el Centro de Plugins.' };
  if (!prefs.config.sourcePath) return { ...base, available: false, state: 'unconfigured', reason: 'Configura un archivo Markdown con ruta absoluta en el Centro de Plugins.' };
  let file;
  try {
    // Nonblocking open also keeps a mistakenly selected FIFO from hanging the host.
    file = await open(prefs.config.sourcePath, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('La fuente debe ser un archivo regular.');
    if (stat.size > MAX_VIDEO_LOG_BYTES) throw new Error('La fuente supera el límite de 512 KiB.');
    const buffer = Buffer.alloc(MAX_VIDEO_LOG_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_VIDEO_LOG_BYTES) throw new Error('La fuente supera el límite de 512 KiB.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    const parsed = parseVideoLog(text);
    return { ...base, ...parsed, available: true, state: !text.trim() ? 'empty' : parsed.insights.length ? 'ready' : 'no-insights', sourcePath: prefs.config.sourcePath, bytes: size };
  } catch (error) {
    const reason = ({ ENOENT: 'El archivo no existe.', EACCES: 'No hay permiso para leer el archivo.', EPERM: 'No hay permiso para leer el archivo.', EISDIR: 'La fuente debe ser un archivo regular.', ERR_ENCODING_INVALID_ENCODED_DATA: 'El archivo no contiene texto UTF-8 válido.' })[error.code] || error.message;
    return { ...base, available: false, state: 'inaccessible', reason: `No se pudo leer la bitácora: ${reason} Revisa la ruta guardada y vuelve a actualizar.` };
  } finally { await file?.close(); }
}
