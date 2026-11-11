import { readFile, readdir, writeFile, cp, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'out', 'Phantom Workspace-linux-x64');
const bundled = path.join(output, 'resources', 'app');
const files = [];
async function collect(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (/\.(mjs|cjs|js|css|html|svg|py)$/.test(file)) files.push(file);
  }
}
for (const directory of ['desktop', 'host', 'integrations', 'dist', 'assets']) await collect(directory);
files.push('scripts/setup-voice.mjs', 'scripts/transcribe.py');
const hashes = {};
for (const relative of files.sort()) {
  const source = await readFile(path.join(root, relative));
  const packaged = await readFile(path.join(bundled, relative));
  if (!source.equals(packaged)) throw new Error(`Paquete desfasado: ${relative}. Vuelve a ejecutar npm run package.`);
  hashes[relative] = createHash('sha256').update(source).digest('hex');
}
for (const name of ['README.md', 'VERIFICATION.md', 'DESIGN.md']) {
  await cp(path.join(root, name), path.join(bundled, name));
}
await access(path.join(output, 'phantom-workspace'));
const build = JSON.parse(await readFile(path.join(output, 'BUILD.json'), 'utf8'));
const e2e = JSON.parse(await readFile(path.join(root, '.impeccable/review/desktop-checks.final.json'), 'utf8'));
if (e2e.summary.failed || e2e.summary.passed !== 34) throw new Error('La evidencia E2E final no acredita los 34 checks esperados.');
const manifest = { ...build, finalizedAt: new Date().toISOString(), applicationFiles: hashes, e2e: e2e.summary, evidence: '.impeccable/review/desktop-checks.final.json', docsSyncedWithoutRebuildingApplication: true };
await writeFile(path.join(root, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(output, 'RELEASE.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Release verificado: ${files.length} archivos de aplicación idénticos al paquete; E2E ${e2e.summary.passed}/0. Documentación sincronizada.`);
