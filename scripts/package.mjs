import { packager } from '@electron/packager';
import { build } from 'vite';
import { chromium } from 'playwright';
import { cp, mkdir, access, writeFile, chmod, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await build();
const outputs = await packager({
  dir: root, out: path.join(root, 'out'), overwrite: true,
  name: 'Phantom Workspace', executableName: 'phantom-workspace',
  platform: 'linux', arch: 'x64', electronVersion: metadata.devDependencies.electron,
  asar: false, prune: true,
  ignore: [/^\/out(?:\/|$)/, /^\/test(?:\/|$)/, /^\/\.test-artifacts(?:\/|$)/, /^\/\.impeccable(?:\/|$)/, /^\/src(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/node_modules\/\.cache(?:\/|$)/],
});
for (const output of outputs) {
  const resources = path.join(output, 'resources');
  await mkdir(path.join(resources, 'runtime'), { recursive: true });
  await cp(process.execPath, path.join(resources, 'runtime', 'node'));
  await chmod(path.join(resources, 'runtime', 'node'), 0o755);
  // Bundle only the selected Chromium build: no unrelated browser cache or user data.
  const executable = chromium.executablePath();
  try {
    await access(executable, constants.X_OK);
    const browserBuild = path.dirname(path.dirname(executable));
    await mkdir(path.join(resources, 'browsers'), { recursive: true });
    await cp(browserBuild, path.join(resources, 'browsers', path.basename(browserBuild)), { recursive: true });
  } catch {
    throw new Error('Falta Chromium. Ejecuta: node node_modules/playwright/cli.js install chromium');
  }
  const source = path.resolve(root, '../harness_engineer');
  const bundled = path.join(resources, 'app', 'vendor', 'phantom');
  await mkdir(bundled, { recursive: true });
  for (const item of ['bin', 'src', 'integrations', 'toolkit', 'package.json', 'README.md', 'INSTALL.md', 'COORDINATION.md', 'RECOVERY.md', 'SKILLS.md']) {
    await cp(path.join(source, item), path.join(bundled, item), { recursive: true });
  }
  for (const dependency of ['zod', 'jsonc-parser', 'smol-toml']) {
    await cp(path.join(source, 'node_modules', dependency), path.join(bundled, 'node_modules', dependency), { recursive: true });
  }
  const executablePath = path.join(output, 'phantom-workspace');
  const entry = `[Desktop Entry]\nType=Application\nName=Phantom Workspace\nComment=Sesiones, herramientas y contexto por proyecto\nExec="${executablePath}"\nIcon=${path.join(resources, 'app', 'assets', 'phantom.svg')}\nTerminal=false\nCategories=Development;IDE;\nStartupNotify=true\n`;
  await writeFile(path.join(root, 'Phantom Workspace.desktop'), entry, { mode: 0o755 });
  await writeFile(path.join(output, 'BUILD.json'), JSON.stringify({ version: metadata.version, node: process.version, electron: metadata.devDependencies.electron, builtAt: new Date().toISOString(), phantom: '0.5.0', platform: 'linux-x64' }, null, 2));
  console.log(`Paquete listo: ${executablePath}`);
}
