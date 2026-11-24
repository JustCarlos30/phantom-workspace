import { mkdir, readFile, writeFile } from 'node:fs/promises';

const assets = new URL('../assets/', import.meta.url);
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const gifSignature = Buffer.from('GIF89a');
const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const resources = [
  { file: 'gengar.png', path: 'other/official-artwork/94.png', signature: pngSignature, minimum: 1000 },
  { file: 'gengar-icon.png', path: 'versions/generation-vii/icons/94.png', signature: pngSignature, minimum: 100, width: 40, height: 30 },
  { file: 'gengar-idle.gif', path: 'versions/generation-v/black-white/animated/94.gif', signature: gifSignature, minimum: 1000, width: 74, height: 63 },
];

function isValid(bytes, resource) {
  if (bytes.length <= resource.minimum || !bytes.subarray(0, resource.signature.length).equals(resource.signature)) return false;
  if (!resource.width) return true;
  const png = resource.signature === pngSignature;
  return (png ? bytes.readUInt32BE(16) : bytes.readUInt16LE(6)) === resource.width
    && (png ? bytes.readUInt32BE(20) : bytes.readUInt16LE(8)) === resource.height;
}

async function downloadGengar(resource) {
  const destination = new URL(resource.file, assets);
  try {
    const existing = await readFile(destination);
    if (isValid(existing, resource)) {
      console.log(`Reutilizado assets/${resource.file}: ${existing.length} bytes`);
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const response = await fetch(base + resource.path, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw new Error(`Gengar download failed: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!isValid(bytes, resource)) {
    throw new Error(`${resource.file}: firma, tamaño mínimo o dimensiones no válidos`);
  }

  await mkdir(assets, { recursive: true });
  await writeFile(destination, bytes);
  console.log(`Descargado assets/${resource.file}: ${bytes.length} bytes`);
}

for (const resource of resources) await downloadGengar(resource);
