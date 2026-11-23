import { packager } from '@electron/packager';
import { build } from 'vite';
import { cp, mkdir, access, writeFile, chmod, readFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'out');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
// A packaged app exports PLAYWRIGHT_BROWSERS_PATH into out/, which packaging
// deletes; fall back to the user's Playwright cache instead.
if (path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH || '/').startsWith(out + path.sep)) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
const { chromium } = await import('playwright');

// The bundled runtime is the official nodejs.org build of this Node version:
// distro builds (e.g. Arch) link dozens of system libraries and break on the
// next upgrade. Verified against SHASUMS256 and cached outside out/.
async function officialNode(version = process.version) {
  const name = `node-${version}-linux-x64`, cache = path.join(os.homedir(), '.cache', 'phantom-workspace', 'node');
  const binary = path.join(cache, name, 'bin', 'node');
  try { await access(binary, constants.X_OK); return binary; } catch {}
  const base = `https://nodejs.org/dist/${version}/`;
  const fetchOk = async url => { const res = await fetch(url); if (!res.ok) throw new Error(`No se pudo descargar ${url} (${res.status})`); return res; };
  const sums = await (await fetchOk(base + 'SHASUMS256.txt')).text();
  const expected = sums.split('\n').map(line => line.trim().split(/\s+/)).find(([, file]) => file === `${name}.tar.xz`)?.[0];
  if (!expected) throw new Error(`SHASUMS256 de ${version} no lista ${name}.tar.xz`);
  const archive = Buffer.from(await (await fetchOk(`${base}${name}.tar.xz`)).arrayBuffer());
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`SHA-256 de ${name}.tar.xz no coincide (${actual} ≠ ${expected})`);
  await mkdir(cache, { recursive: true });
  const staging = path.join(cache, `.${name}-${process.pid}`), tarball = `${staging}.tar.xz`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging);
  await writeFile(tarball, archive);
  execFileSync('tar', ['-xJf', tarball, '-C', staging, `${name}/bin/node`]);
  await rm(path.join(cache, name), { recursive: true, force: true });
  await rename(path.join(staging, name), path.join(cache, name));
  await rm(staging, { recursive: true, force: true }); await rm(tarball, { force: true });
  return binary;
}

// Everything that can fail runs before packager wipes out/.
const node = await officialNode();
const executable = chromium.executablePath();
try { await access(executable, constants.X_OK); } catch { throw new Error('Falta Chromium. Ejecuta: node node_modules/playwright/cli.js install chromium'); }
await build();
const outputs = await packager({
  dir: root, out, overwrite: true,
  name: 'Phantom Workspace', executableName: 'phantom-workspace',
  platform: 'linux', arch: 'x64', electronVersion: metadata.devDependencies.electron,
  asar: false, prune: true,
  ignore: [/^\/out(?:\/|$)/, /^\/test(?:\/|$)/, /^\/\.test-artifacts(?:\/|$)/, /^\/\.impeccable(?:\/|$)/, /^\/src(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/node_modules\/\.cache(?:\/|$)/],
});
for (const output of outputs) {
  const resources = path.join(output, 'resources');
  await mkdir(path.join(resources, 'runtime'), { recursive: true });
  await cp(node, path.join(resources, 'runtime', 'node'));
  await chmod(path.join(resources, 'runtime', 'node'), 0o755);
  // Bundle only the selected Chromium build: no unrelated browser cache or user data.
  const browserBuild = path.dirname(path.dirname(executable));
  await mkdir(path.join(resources, 'browsers'), { recursive: true });
  await cp(browserBuild, path.join(resources, 'browsers', path.basename(browserBuild)), { recursive: true });
  const source = path.resolve(root, '../harness_engineer');
  const bundled = path.join(resources, 'app', 'vendor', 'phantom');
  await mkdir(bundled, { recursive: true });
  for (const item of ['bin', 'src', 'integrations', 'toolkit', 'package.json', 'README.md', 'INSTALL.md', 'COORDINATION.md', 'RECOVERY.md', 'SKILLS.md']) {
    await cp(path.join(source, item), path.join(bundled, item), { recursive: true });
  }
  for (const dependency of ['zod', 'jsonc-parser', 'smol-toml']) {
    await cp(path.join(source, 'node_modules', dependency), path.join(bundled, 'node_modules', dependency), { recursive: true });
  }
  const mobileSource = path.resolve(root, '../phantom-mobile');
  const mobileBundled = path.join(resources, 'phantom-mobile');
  await mkdir(mobileBundled, { recursive: true });
  for (const item of ['host', 'package.json']) {
    await cp(path.join(mobileSource, item), path.join(mobileBundled, item), { recursive: true });
  }
  const executablePath = path.join(output, 'phantom-workspace');
  const iconPath = path.join(resources, 'app', 'assets', 'phantom-icon.png');
  try {
    const svg = await readFile(path.join(root, 'assets', 'phantom.svg'), 'utf8');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>${svg}`);
      await writeFile(iconPath, await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } }));
    } finally { await browser.close(); }
  } catch (error) { console.warn(`No se pudo generar el icono PNG: ${error.message}`); }
  const entry = `[Desktop Entry]\nType=Application\nName=Phantom Workspace\nComment=Sesiones, herramientas y contexto por proyecto\nExec="${executablePath}"\nIcon=${iconPath}\nTerminal=false\nCategories=Development;IDE;\nStartupNotify=true\nStartupWMClass=${metadata.name}\n`;
  await writeFile(path.join(root, 'Phantom Workspace.desktop'), entry, { mode: 0o755 });
  try {
    const applications = path.join(os.homedir(), '.local', 'share', 'applications');
    await mkdir(applications, { recursive: true });
    await writeFile(path.join(applications, 'phantom-workspace.desktop'), entry, { mode: 0o755 });
  } catch (error) { console.warn(`No se pudo instalar el .desktop: ${error.message}`); }
  await writeFile(path.join(output, 'BUILD.json'), JSON.stringify({ version: metadata.version, node: process.version, electron: metadata.devDependencies.electron, builtAt: new Date().toISOString(), phantom: '0.5.0', platform: 'linux-x64' }, null, 2));
  console.log(`Paquete listo: ${executablePath}`);
}
