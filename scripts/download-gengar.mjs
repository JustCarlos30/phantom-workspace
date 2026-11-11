import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/94.png';
const assets = new URL('../assets/', import.meta.url);
const destination = new URL('gengar.png', assets);
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

function isValidPng(bytes) {
  return bytes.length > 1000 && bytes.subarray(0, 8).equals(pngSignature);
}

async function downloadGengar() {
  try {
    const existing = await readFile(destination);
    if (isValidPng(existing)) {
      console.log(`Gengar PNG already available: ${existing.length} bytes`);
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw new Error(`Gengar download failed: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!isValidPng(bytes)) {
    throw new Error('Gengar download must have a PNG signature and exceed 1000 bytes');
  }

  await mkdir(assets, { recursive: true });
  await writeFile(destination, bytes);
  console.log(`Downloaded assets/gengar.png: ${bytes.length} bytes`);
}

await downloadGengar();
