#!/usr/bin/env node
// Explicit installation only. No network or processes run when imported.
// State path: <PHANTOM_WORKSPACE_HOME or XDG_STATE_HOME/phantom-workspace>/voice-runtime.
import { access, chmod, copyFile, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executableOnPath, runCommand, stateDirectory } from '../integrations/run-manager.mjs';

export const MODEL_REPOS = Object.freeze(JSON.parse(readFileSync(new URL('./transcribe.py', import.meta.url), 'utf8').match(/^MODEL_REPOS = (.+)$/m)[1]));

export const HELP = `Usage: node scripts/setup-voice.mjs [--data <app-state-dir>] [--model ${Object.keys(MODEL_REPOS).join('|')}] [--device cpu|cuda] [--replace]
Installs Python venv + faster-whisper + multilingual model in app data.
Default: ${stateDirectory()}/voice-runtime (outside project folders).
Model provenance: Systran/faster-whisper-<model>; large-v3-turbo: mobiuslabsgmbh/faster-whisper-large-v3-turbo (https://huggingface.co).
Python dependency: https://pypi.org/project/faster-whisper/ (isolated venv only).
Existing config is preserved unless --replace is supplied; replacement keeps a backup.
An explicit settings.voiceProvider/localWhisperCommand has precedence over discovery.
No microphone is accessed. Setup has a total ten-minute deadline.`;

export function parseArgs(argv) {
  const options = { dataDir: stateDirectory(), model: 'base', help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--data' && argv[index + 1] && !argv[index + 1].startsWith('--')) options.dataDir = path.resolve(argv[++index]);
    else if (arg === '--model' && Object.hasOwn(MODEL_REPOS, argv[index + 1])) options.model = argv[++index];
    else if (arg === '--device' && ['cpu', 'cuda'].includes(argv[index + 1])) options.device = argv[++index];
    else if (arg === '--replace') options.replace = true;
    else throw new Error(`Argumento inválido: ${arg}\n${HELP}`);
  }
  return options;
}

async function exists(filename) {
  try { await access(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function setupVoice({ dataDir = stateDirectory(), model = 'base', device = 'cpu', replace = false } = {}) {
  if (!Object.hasOwn(MODEL_REPOS, model)) throw new Error(`Modelos permitidos: ${Object.keys(MODEL_REPOS).join(', ')}`);
  if (!['cpu', 'cuda'].includes(device)) throw new Error('Dispositivo permitido: cpu o cuda');
  const computeType = device === 'cuda' ? 'int8_float16' : 'int8';
  const root = path.resolve(dataDir);
  const project = await realpath(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const relative = path.relative(project, root);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('El runtime debe estar en app data, fuera del proyecto');
  const configPath = path.join(root, 'voice-runtime', 'config.json');
  // Inspect only the app's own public config, never unrelated histories/files.
  if (await exists(configPath) && !replace) throw new Error(`Ya hay un motor configurado en ${configPath}. No se reemplazó.\n${HELP}`);
  const statePath = path.join(root, 'state.json');
  if (await exists(statePath)) {
    const metadata = await stat(statePath);
    if (metadata.size > 16 * 1024 * 1024) throw new Error('Estado demasiado grande para comprobar configuración; revisa tu configuración de voz antes de instalar');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (state.settings?.localWhisperCommand || (state.settings?.voiceProvider && !['auto', 'local'].includes(state.settings.voiceProvider))) throw new Error(`Ya hay un comando/proveedor de voz explícito en ${statePath}. No se modificó.\n${HELP}`);
  }
  const python = await executableOnPath('python3');
  if (!python) throw new Error('Python3 no disponible. Instala Python3 con soporte venv y vuelve a ejecutar npm run setup:voice');
  const runtime = path.join(root, 'voice-runtime');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(root);
  const realRelative = path.relative(project, canonicalRoot);
  if (!realRelative || (!realRelative.startsWith(`..${path.sep}`) && realRelative !== '..' && !path.isAbsolute(realRelative))) throw new Error('App data no puede apuntar por symlink al proyecto');
  const lock = await open(path.join(runtime, 'setup.lock'), 'wx', 0o600).catch(error => { throw new Error(error.code === 'EEXIST' ? `Hay otro setup activo o un lock antiguo: ${path.join(runtime, 'setup.lock')}. Compruébalo antes de reintentar.` : error.message); });
  const engine = path.join(runtime, 'engines', `${model}-${randomUUID()}`);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 600_000);
  let installed = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await mkdir(engine, { recursive: true, mode: 0o700 });
    const env = { ...process.env, PYTHONNOUSERSITE: '1', HF_HOME: path.join(engine, 'cache'), HF_HUB_CACHE: path.join(engine, 'cache', 'hub'), XDG_CACHE_HOME: path.join(engine, 'cache'), HF_ENDPOINT: 'https://huggingface.co', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DOWNLOAD_TIMEOUT: '30' };
    for (const key of ['PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE']) delete env[key];
    const execute = async (bin, args, timeoutMs) => {
      const result = await runCommand(bin, args, { cwd: engine, env, signal: abort.signal, timeoutMs, outputLimit: 256 * 1024, onOutput: text => process.stdout.write(text) });
      if (result.code !== 0) throw new Error(`Setup falló: ${path.basename(bin)} terminó con código ${result.code}`);
      return result.output;
    };
    console.log(`Creando runtime local ${model}: ${engine}`);
    const venv = path.join(engine, 'venv');
    await execute(python, ['-I', '-m', 'venv', venv], 60_000);
    const venvPython = path.join(venv, 'bin', 'python');
    // PyAV 17+ removes metadata_errors, still used by faster-whisper 1.2.1.
    await execute(venvPython, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--no-input', '--no-cache-dir', '--index-url', 'https://pypi.org/simple', 'faster-whisper==1.2.1', 'av>=14,<17'], 300_000);
    let gpuLibraryPath;
    if (device === 'cuda') {
      await execute(venvPython, ['-I', '-m', 'pip', '--isolated', 'install', '--no-input', '--no-cache-dir', '--index-url', 'https://pypi.org/simple', 'nvidia-cublas-cu12', 'nvidia-cudnn-cu12==9.*'], 300_000);
      gpuLibraryPath = (await execute(venvPython, ['-I', '-c', 'import sysconfig,os; p=sysconfig.get_paths()["purelib"]; print(os.path.join(p,"nvidia/cublas/lib")+":"+os.path.join(p,"nvidia/cudnn/lib"))'], 10_000)).trim();
      env.LD_LIBRARY_PATH = [gpuLibraryPath, env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
    }
    const runner = path.join(engine, 'transcribe.py');
    await copyFile(new URL('./transcribe.py', import.meta.url), runner, constants.COPYFILE_EXCL);
    await chmod(runner, 0o600);
    const streaming = path.join(engine, 'voice-stream.py');
    await copyFile(new URL('./voice-stream.py', import.meta.url), streaming, constants.COPYFILE_EXCL);
    await chmod(streaming, 0o600);
    const hardwareArgs = ['--device', device, '--compute-type', computeType];
    const prepared = await execute(venvPython, ['-I', runner, '--prepare', '--model', model, '--cache-dir', path.join(engine, 'cache', 'hub'), ...hardwareArgs], 300_000);
    const provenance = JSON.parse(prepared.trim().split('\n').at(-1));
    const argv = [venvPython, '-I', runner, '{input}', '{outputDir}', '--model', provenance.modelPath, ...hardwareArgs];
    const streamArgv = [venvPython, '-I', '-u', streaming, '--model', provenance.modelPath, ...hardwareArgs];
    const config = { schemaVersion: 1, engine: 'faster-whisper', model, device, computeType, argv, streamArgv, gpuLibraryPath, nativeAudio: true, provenance: { ...provenance, source: `https://huggingface.co/${provenance.repo}`, pythonPackage: 'https://pypi.org/project/faster-whisper/1.2.1/' }, createdAt: new Date().toISOString() };
    // Exclusive create protects a config another process/user wrote during setup.
    if (replace && await exists(configPath)) {
      await copyFile(configPath, `${configPath}.${Date.now()}.bak`, constants.COPYFILE_EXCL);
      const temporary = `${configPath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, configPath);
    } else await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    installed = true;
    console.log(JSON.stringify({ configured: true, configPath, engine, modelPath: provenance.modelPath, model, argv }, null, 2));
    return config;
  } finally {
    clearTimeout(timer);
    if (!installed) await rm(engine, { recursive: true, force: true });
    await lock.close();
    await rm(path.join(runtime, 'setup.lock'), { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else await setupVoice(options);
  } catch (error) { console.error(`Voz local no configurada: ${error.message}\nPuedes reintentar con npm run setup:voice -- --model tiny`); process.exitCode = 1; }
}
