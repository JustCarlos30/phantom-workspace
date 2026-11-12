import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { authorizedPath } from './security.mjs';

const MAX_BYTES = 12 * 1024 * 1024;

export async function readLocalImage(filename, roots) {
  const target = await authorizedPath(filename, roots);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('La captura no es un archivo');
    if (stat.size > MAX_BYTES) throw new Error('La imagen supera el límite de 12 MB');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_BYTES + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) throw new Error('La imagen supera el límite de 12 MB');
    const bytes = buffer.subarray(0, length);
    const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) ? 'image/gif'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!type) throw new Error('Formato no compatible. Usa PNG, JPEG, WebP o GIF');
    return { path: target, dataUrl: `data:${type};base64,${bytes.toString('base64')}` };
  } finally { await file.close(); }
}
