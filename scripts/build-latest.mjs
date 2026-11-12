import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const help = `Uso: npm run build:latest -- [--dry-run | --help]
Construye el estado LOCAL actual del worktree principal registrado en Git,
incluidos sus cambios sin commit. No descarga ni integra cambios de Git.
  --dry-run  Muestra fuente, salida y comandos sin instalar ni escribir.
  --help     Muestra esta ayuda.
`;

function run(command, args, cwd, { capture = false, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd, env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw new Error(`No se pudo ejecutar ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} falló (${result.signal || result.status})${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  }
  return result.stdout;
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.find((arg) => !['--help', '--dry-run'].includes(arg));
  if (unknown) throw new Error(`Argumento desconocido: ${unknown}. Usa --help.`);
  if (args.includes('--help')) {
    console.log(help);
    return;
  }
  const scriptRoot = fileURLToPath(new URL('..', import.meta.url));
  const git = (cwd, ...gitArgs) => run('git', ['--no-optional-locks', '-C', cwd, ...gitArgs], cwd, { capture: true });
  const listing = git(scriptRoot, 'worktree', 'list', '--porcelain', '-z');
  const firstRecord = listing.split('\0\0')[0].split('\0');
  const location = firstRecord.find((field) => field.startsWith('worktree '));
  if (!location) throw new Error('Git no devolvió el worktree principal registrado.');
  const folder = location.slice('worktree '.length);
  if (firstRecord.includes('bare')) throw new Error(`El repositorio principal es bare: ${folder}`);
  const commit = git(folder, 'rev-parse', '--verify', 'HEAD').trim();
  const branch = git(folder, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  const dirty = git(folder, 'status', '--porcelain', '-z', '--untracked-files=all').length > 0;
  const source = { commit, branch, dirty, folder };
  // A stable external cache survives the packager's removal of out/.
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(homedir(), '.cache', 'ms-playwright') };
  delete env.ELECTRON_RUN_AS_NODE;
  const output = path.join(folder, 'out', 'Phantom Workspace-linux-x64');
  const executable = path.join(output, 'phantom-workspace');
  const buildFile = path.join(output, 'BUILD.json');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commands = [
    [npm, ['ci', '--include=dev', '--no-audit', '--no-fund']],
    [process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium']],
    [npm, ['run', 'package']],
  ];
  console.log(`Carpeta principal: ${folder}\nRama: ${branch}\nSHA: ${commit}\nCambios sin commit: ${dirty ? 'sí' : 'no'}\nEjecutable: ${executable}`);
  console.log(`PLAYWRIGHT_BROWSERS_PATH=${env.PLAYWRIGHT_BROWSERS_PATH}\nELECTRON_RUN_AS_NODE: eliminado del entorno`);
  for (const [command, commandArgs] of commands) {
    console.log(`En ${JSON.stringify(folder)}: ${[command, ...commandArgs].map((part) => JSON.stringify(part)).join(' ')}`);
  }
  if (args.includes('--dry-run')) {
    console.log(`Dry-run: sin instalaciones ni escrituras. Se verificará el ejecutable y se añadirá source a ${buildFile}`);
    return;
  }
  for (const [command, commandArgs] of commands) run(command, commandArgs, folder, { env });
  try {
    if (!(await stat(executable)).isFile()) throw new Error('La salida no es un archivo');
    await access(executable, constants.X_OK);
    const metadata = JSON.parse(await readFile(buildFile, 'utf8'));
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('BUILD.json no contiene un objeto');
    }
    const previousSource = metadata.source && typeof metadata.source === 'object' && !Array.isArray(metadata.source)
      ? metadata.source : {};
    metadata.source = { ...previousSource, ...source };
    await writeFile(buildFile, `${JSON.stringify(metadata, null, 2)}\n`);
    const saved = JSON.parse(await readFile(buildFile, 'utf8'));
    if (Object.entries(source).some(([key, value]) => saved.source?.[key] !== value)) {
      throw new Error('No se pudieron verificar los metadatos de fuente');
    }
  } catch (error) {
    throw new Error(`No se pudo verificar la salida ${output}: ${error.message}`);
  }
  console.log(`Build completado y verificado: ${executable}\nMetadatos: ${buildFile}`);
}

main().catch((error) => {
  console.error(`build:latest: ${error.message}`);
  process.exitCode = 1;
});
