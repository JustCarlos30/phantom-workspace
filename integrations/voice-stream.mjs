import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireWorkspace, stateDirectory, executableOnPath } from './run-manager.mjs';

const engines = new Map();
const sessions = new Map();
const METHODS = new Set(['voice.stream.start', 'voice.stream.push', 'voice.stream.finish', 'voice.stream.cancel']);

export function resolveStreamScript(argv, bundledScript) {
  return argv.map(arg => path.basename(arg) === 'voice-stream.py' ? bundledScript : arg);
}

export function buildStreamArgv(argv, settings = {}) {
  const language = settings.voiceLanguage ?? 'es';
  const vocabulary = settings.voiceVocabulary ?? '';
  const pause = settings.voicePauseMs ?? 700;
  const vad = settings.voiceVadThreshold ?? 0.5;
  if (typeof language !== 'string' || !/^(auto|[a-z]{2,3})$/.test(language)) throw new Error('Idioma del dictado inválido');
  if (typeof vocabulary !== 'string' || vocabulary.length > 500 || /\p{Cc}/u.test(vocabulary)) throw new Error('Vocabulario inválido: máximo 500 caracteres sin controles');
  if (!Number.isInteger(pause) || pause < 300 || pause > 2000) throw new Error('Pausa inválida: debe estar entre 300 y 2000 ms');
  if (typeof vad !== 'number' || !Number.isFinite(vad) || vad < 0.2 || vad > 0.8) throw new Error('Sensibilidad VAD inválida: debe estar entre 0.2 y 0.8');
  return [...argv, '--language', language, '--vocabulary', vocabulary, '--pause-ms', String(pause), '--vad-threshold', String(vad)];
}

class Engine {
  constructor(config, cwd) {
    this.config = config;
    this.pending = new Map();
    this.closed = false;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    const [executable, ...args] = config.streamArgv;
    const env = { ...process.env, PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' };
    delete env.PYTHONPATH; delete env.PYTHONHOME;
    if (config.gpuLibraryPath) env.LD_LIBRARY_PATH = [config.gpuLibraryPath, env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
    this.child = spawn(executable, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(resolve => this.child.once('close', resolve));
    this.child.stdin.on('error', error => this.close(error));
    this.child.once('error', error => this.close(error));
    this.child.once('close', () => this.close(new Error(`Motor de dictado cerrado. ${this.diagnostic || ''}`)));
    this.child.stderr.on('data', chunk => { this.diagnostic = ((this.diagnostic || '') + chunk.toString()).slice(-4096); });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 256 * 1024) return this.close(new Error('Salida del motor demasiado grande'));
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const message = JSON.parse(line);
          if (message.ready) { clearTimeout(this.startTimer); this.resolveReady(); }
          else {
            const pending = this.pending.get(message.id);
            if (!pending) continue;
            clearTimeout(pending.timer); this.pending.delete(message.id);
            message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result);
          }
        } catch { this.close(new Error('Respuesta inválida del motor de dictado')); }
      }
    });
    this.startTimer = setTimeout(() => this.close(new Error('El motor no inició en 45 segundos')), 45_000);
  }
  async request(type, audioBase64) {
    await this.ready;
    if (this.closed) throw new Error('Motor de dictado no disponible');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('El motor de dictado excedió 45 segundos')), 45_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, type, audioBase64 }) + '\n');
    });
  }
  close(error = new Error('Dictado detenido')) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.startTimer); clearTimeout(this.idleTimer);
    this.rejectReady(error);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.child.kill('SIGTERM');
    const escalation = setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGKILL'); }, 500);
    escalation.unref();
  }
}

function release(session) {
  clearTimeout(session.timer);
  sessions.delete(session.id);
  session.engine.session = null;
  session.engine.idleTimer = setTimeout(() => session.engine.close(), 300_000);
  session.engine.idleTimer.unref();
}

export async function shutdownVoiceStreams() {
  for (const session of [...sessions.values()]) release(session);
  const owned = [...engines.values()];
  for (const engine of owned) engine.close();
  await Promise.all(owned.map(engine => engine.exited));
  engines.clear();
}

export async function handleVoiceStream(method, payload, context) {
  if (!METHODS.has(method)) return { handled: false };
  const { workspace } = await requireWorkspace(payload, context);
  if (method === 'voice.stream.start') {
    const settings = context.state?.settings ?? context.state?.data?.settings ?? {};
    if (settings.voiceProvider === 'openai' || settings.localWhisperCommand) throw new Error('El dictado en vivo requiere el runtime local descubierto. Revisa el proveedor de voz.');
    const root = stateDirectory(context);
    const filename = path.join(root, 'voice-runtime', 'config.json');
    const stat = await lstat(filename).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw new Error('Instala dictado en vivo: npm run setup:voice -- --model large-v3-turbo --device cuda --replace');
    const config = JSON.parse(await readFile(filename, 'utf8'));
    if (config.schemaVersion !== 1 || config.engine !== 'faster-whisper' || !Array.isArray(config.streamArgv)
      || config.streamArgv.length < 2 || config.streamArgv.length > 40
      || config.streamArgv.some(arg => typeof arg !== 'string' || !arg || arg.length > 4096 || arg.includes('\0'))
      || (config.gpuLibraryPath !== undefined && (typeof config.gpuLibraryPath !== 'string' || config.gpuLibraryPath.length > 8192))) throw new Error('Runtime sin streaming; ejecuta npm run setup:voice -- --model large-v3-turbo --device cuda --replace');
    const bundled = fileURLToPath(new URL('../scripts/voice-stream.py', import.meta.url));
    const bundledStat = await lstat(bundled).catch(() => null);
    if (bundledStat?.isFile() && !bundledStat.isSymbolicLink()) config.streamArgv = resolveStreamScript(config.streamArgv, bundled);
    config.streamArgv = buildStreamArgv(config.streamArgv, settings);
    let engine = engines.get(root);
    if (engine?.session) throw new Error('Ya hay un dictado activo. Detén o cancela la otra captura.');
    if (!engine || engine.closed || JSON.stringify(engine.config) !== JSON.stringify(config)) {
      if (!await executableOnPath(config.streamArgv[0])) throw new Error('Ejecutable de voz no disponible');
      engine?.close();
      engine = new Engine(config, root); engines.set(root, engine);
    }
    clearTimeout(engine.idleTimer);
    const session = { id: randomUUID(), workspaceId: workspace.id, root, engine, sequence: 0, samples: 0, busy: false };
    engine.session = session;
    sessions.set(session.id, session);
    session.timer = setTimeout(() => { engine.close(new Error('Sesión de dictado caducada')); release(session); }, 180_000);
    session.timer.unref();
    try {
      await engine.request('reset');
      return { handled: true, result: { sessionId: session.id, provider: 'local', model: config.model, device: config.device, computeType: config.computeType, sampleRate: 16000 } };
    } catch (error) { release(session); throw error; }
  }
  const session = sessions.get(payload.sessionId);
  if (!session || session.workspaceId !== workspace.id || session.root !== stateDirectory(context)) throw new Error('Sesión de voz no encontrada para este workspace');
  if (method === 'voice.stream.cancel') {
    session.engine.close(); release(session);
    return { handled: true, result: { cancelled: true } };
  }
  if (session.busy) throw new Error('Espera la transcripción anterior antes de enviar más audio');
  let encoded;
  if (method === 'voice.stream.push') {
    encoded = payload.audioBase64;
    if (payload.sequence !== session.sequence || typeof encoded !== 'string' || !encoded.length || encoded.length > 85336) throw new Error('Fragmento de voz fuera de orden o demasiado grande');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > 64000 || bytes.length % 2 || bytes.toString('base64') !== encoded) throw new Error('Se requiere PCM16 mono a 16000 Hz');
    if (session.samples + bytes.length / 2 > 16000 * 120) throw new Error('Dictado supera dos minutos');
    session.samples += bytes.length / 2; session.sequence++;
  }
  session.busy = true;
  try {
    const result = await session.engine.request(method.endsWith('finish') ? 'finish' : 'push', encoded);
    if (typeof result?.text !== 'string' || result.text.length > 32768 || typeof result.confirmed !== 'string' || typeof result.partial !== 'string') throw new Error('Respuesta de transcripción inválida');
    return { handled: true, result: { ...result, provider: 'local' } };
  } catch (error) { session.engine.close(); release(session); throw error; }
  finally { session.busy = false; if (method.endsWith('finish') && sessions.has(session.id)) release(session); }
}
