import { mkdtemp, writeFile, readFile, readdir, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getRunManager, requireWorkspace, executableOnPath, runCommand, stateDirectory } from './run-manager.mjs';
import { handleVoiceStream, shutdownVoiceStreams } from './voice-stream.mjs';

const MAX_AUDIO = 10 * 1024 * 1024;
const MAX_TEXT = 32 * 1024;
const MIME_EXTENSIONS = new Map([
  ['audio/webm', 'webm'], ['audio/ogg', 'ogg'], ['audio/wav', 'wav'], ['audio/x-wav', 'wav'],
  ['audio/mpeg', 'mp3'], ['audio/mp4', 'm4a'], ['audio/flac', 'flac'],
]);
const active = new Set();

export async function discoverLocalVoice(context = {}) {
  const configPath = path.join(stateDirectory(context), 'voice-runtime', 'config.json');
  let metadata;
  try { metadata = await lstat(configPath); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 32768) throw new Error(`Configuración de voz local inválida: ${configPath}`);
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch { throw new Error(`JSON de voz local inválido: ${configPath}`); }
  if (config.schemaVersion !== 1 || !Array.isArray(config.argv)) throw new Error(`Configuración de voz local incompatible: ${configPath}`);
  await localTemplate({ localWhisperCommand: JSON.stringify(config.argv) });
  return { localWhisperCommand: JSON.stringify(config.argv), nativeAudio: config.engine === 'faster-whisper' && config.nativeAudio === true, gpuLibraryPath: config.gpuLibraryPath };
}

export async function shutdownVoice() {
  await shutdownVoiceStreams();
  const jobs = [...active];
  for (const job of jobs) job.abort.abort();
  await Promise.allSettled(jobs.map(job => job.done));
}

function intent(text, workspaceId) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Dictado vacío o demasiado largo (máximo 32768 caracteres)');
  const normalized = text.trim().replace(/\s+/g, ' ');
  const patterns = [
    ['task', /^(?:(?:crea|crear|añade|añadir|agrega|agregar)\s+(?:una?\s+)?tarea|(?:create|add)\s+(?:a\s+)?task|tarea|task)\b\s*[:,-]?\s*/iu],
    ['decision', /^(?:(?:registra|registrar|crea|crear|añade|añadir)\s+(?:una\s+)?decisi[oó]n|(?:record|create|add)\s+(?:a\s+)?decision|decisi[oó]n|decision)\b\s*[:,-]?\s*/iu],
    ['open', /^(?:abre|abrir|open)\b\s*[:,-]?\s*/iu],
    ['search', /^(?:busca|buscar|search(?:\s+for)?|find)\b\s*[:,-]?\s*/iu],
  ];
  let action = 'task', body = normalized;
  for (const [candidate, prefix] of patterns) {
    if (prefix.test(normalized)) { action = candidate; body = normalized.replace(prefix, '').trim(); break; }
  }
  if (!body) throw new Error('El intent necesita contenido después del comando');
  // Literal drafts only: shell fragments, URLs and selectors are never evaluated.
  return { workspaceId, action, text: body, ...(['task', 'decision'].includes(action) ? { title: body.slice(0, 240) } : { query: body }) };
}

function decodeAudio(payload) {
  if (typeof payload.mimeType !== 'string' || payload.mimeType.length > 128) throw new Error('mimeType de audio requerido');
  const mime = payload.mimeType.split(';')[0].trim().toLowerCase();
  const extension = MIME_EXTENSIONS.get(mime);
  if (!extension) throw new Error('Tipo de audio no admitido (WebM, Ogg, WAV, MP3, MP4 o FLAC)');
  const encoded = payload.audioBase64;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(MAX_AUDIO / 3) * 4) throw new Error('Audio vacío o supera 10 MiB');
  if (encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('audioBase64 inválido');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_AUDIO || bytes.toString('base64') !== encoded) throw new Error('audioBase64 inválido o demasiado grande');
  return { bytes, mime, extension };
}

async function localTemplate(settings) {
  if (settings.localWhisperCommand) {
    let argv;
    try { argv = JSON.parse(settings.localWhisperCommand); } catch { throw new Error('localWhisperCommand debe ser un array JSON de argv, sin shell'); }
    if (!Array.isArray(argv) || !argv.length || argv.length > 40 || argv.some(arg => typeof arg !== 'string' || !arg || arg.length > 4096 || arg.includes('\0'))) throw new Error('localWhisperCommand contiene argv inválidos');
    if (argv[0].includes('{') || !argv.slice(1).some(arg => arg.includes('{input}'))) throw new Error('El comando local necesita {input} como argumento, nunca en el ejecutable');
    if (argv.some(arg => /\{[^{}]*\}/g.test(arg.replaceAll('{input}', '').replaceAll('{outputDir}', '')))) throw new Error('Placeholders admitidos: {input}, {outputDir}');
    const executable = await executableOnPath(argv[0]);
    if (!executable) throw new Error(`Motor local no disponible: ${path.basename(argv[0])}. Ejecuta npm run setup:voice o revisa localWhisperCommand`);
    return [executable, ...argv.slice(1)];
  }
  const whisper = await executableOnPath('whisper');
  if (whisper) return [whisper, '{input}', '--output_format', 'txt', '--output_dir', '{outputDir}'];
  const cpp = await executableOnPath('whisper-cli');
  throw new Error(cpp
    ? 'whisper-cli detectado: configura localWhisperCommand como argv JSON incluyendo el modelo, {input} y salida txt en {outputDir}; o ejecuta npm run setup:voice'
    : 'Transcripción local no disponible. Ejecuta npm run setup:voice para instalar el motor aislado sin credenciales; también puedes configurar localWhisperCommand (argv JSON)');
}

async function transcribeLocal(audio, settings, directory, cwd, signal) {
  const template = await localTemplate(settings);
  let input = path.join(directory, `audio.${audio.extension}`);
  await writeFile(input, audio.bytes, { mode: 0o600 });
  // Whisper engines commonly require PCM WAV. Conversion is an owned, bounded child.
  if (audio.extension !== 'wav' && !settings.nativeAudio) {
    const ffmpeg = await executableOnPath('ffmpeg');
    if (!ffmpeg) throw new Error('Este formato requiere ffmpeg en el host para convertirlo a WAV');
    const wav = path.join(directory, 'audio.wav');
    const converted = await runCommand(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-y', '-i', input, '-t', '120', '-ar', '16000', '-ac', '1', '-fs', '8000000', wav], { cwd, signal, timeoutMs: 20_000, outputLimit: 8192 });
    if (converted.code !== 0) throw new Error(`ffmpeg no pudo convertir el audio (código ${converted.code})`);
    input = wav;
  }
  const [executable, ...args] = template.map(arg => arg.replaceAll('{input}', input).replaceAll('{outputDir}', directory));
  const env = { ...process.env };
  if (settings.gpuLibraryPath) env.LD_LIBRARY_PATH = [settings.gpuLibraryPath, env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  const result = await runCommand(executable, args, { cwd, env, signal, timeoutMs: 60_000, outputLimit: 64 * 1024 });
  if (result.code !== 0) throw new Error(`Motor local falló (código ${result.code}). Revisa el runtime local o ejecuta npm run setup:voice`);
  let text;
  if (settings.localWhisperOutput === 'stdout') text = result.output;
  else {
    const files = (await readdir(directory)).filter(name => name.endsWith('.txt')).sort();
    if (!files.length || files.length > 10) throw new Error('El motor local no produjo transcripción .txt; revisa output_dir o configura localWhisperOutput="stdout"');
    const chunks = [];
    let size = 0;
    for (const name of files) {
      const file = path.join(directory, name);
      const stat = await lstat(file);
      size += stat.size;
      if (!stat.isFile() || stat.isSymbolicLink() || size > MAX_TEXT) throw new Error('Salida de transcripción inválida o demasiado grande');
      chunks.push(await readFile(file, 'utf8'));
    }
    text = chunks.join('\n');
  }
  return { text: validateText(text), provider: 'local' };
}

function validateText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('El motor no produjo texto de transcripción');
  if (text.length > MAX_TEXT) throw new Error('Transcripción supera 32768 caracteres');
  return text.trim();
}

function apiURL(settings) {
  const base = settings.voiceBaseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  let url;
  try { url = new URL(base); } catch { throw new Error('voiceBaseURL inválida'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) throw new Error('voiceBaseURL requiere HTTPS (HTTP solo en loopback), sin credenciales/query');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/audio/transcriptions`;
  return url;
}

async function transcribeAPI(audio, settings, signal) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Transcripción API no disponible: falta OPENAI_API_KEY en el entorno del host');
  const url = apiURL(settings);
  const form = new FormData();
  form.set('file', new Blob([audio.bytes], { type: audio.mime }), `audio.${audio.extension}`);
  const model = settings.voiceModel || 'whisper-1';
  if (typeof model !== 'string' || model.length > 128) throw new Error('voiceModel inválido');
  form.set('model', model);
  let response;
  try { response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal, redirect: 'error' }); }
  catch { throw new Error(signal.aborted ? 'Transcripción detenida o tiempo límite excedido' : 'No se pudo conectar al proveedor de transcripción'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Proveedor de transcripción respondió HTTP ${response.status}`); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Proveedor devolvió una respuesta vacía');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128 * 1024) throw new Error('Respuesta de transcripción demasiado grande');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Proveedor no devolvió JSON válido'); }
  return { text: validateText(data.text), provider: 'openai' };
}

export async function handleVoice(method, payload = {}, context = {}) {
  if (method.startsWith('voice.stream.')) return handleVoiceStream(method, payload, context);
  if (!['voice.transcribe', 'voice.intent'].includes(method)) return { handled: false };
  const { workspace, cwd } = await requireWorkspace(payload, context);
  if (method === 'voice.intent') return { handled: true, result: intent(payload.text, workspace.id) };
  const audio = decodeAudio(payload);
  if (active.size >= 4) throw new Error('Demasiadas transcripciones activas (máximo 4)');
  const settings = context.state?.settings ?? context.state?.data?.settings ?? {};
  const provider = settings.voiceProvider || 'auto';
  if (!['auto', 'local', 'openai'].includes(provider)) throw new Error('voiceProvider debe ser auto, local u openai');
  const abort = new AbortController();
  const job = { abort, done: null };
  active.add(job);
  const id = randomUUID();
  const timer = setTimeout(() => abort.abort(), 90_000);
  job.done = (async () => {
    let directory, manager;
    const emit = event => manager?.emit(context, { ...event, id, workspaceId: workspace.id, source: 'voice' });
    try {
      manager = await getRunManager(context, cwd, workspace.id);
      if (abort.signal.aborted) throw new Error('Transcripción detenida');
      directory = await mkdtemp(path.join(manager.root, workspace.id, 'voice-'));
      emit({ type: 'tool.status', status: 'running' });
      const discovered = !settings.localWhisperCommand && provider !== 'openai' ? await discoverLocalVoice(context) : null;
      const useAPI = provider === 'openai' || (provider === 'auto' && !settings.localWhisperCommand && !discovered && process.env.OPENAI_API_KEY);
      emit({ type: 'tool.output', data: `Transcripción ${useAPI ? 'API' : 'local'} iniciada\n` });
      const localSettings = discovered ? { ...settings, ...discovered } : settings;
      const result = useAPI ? await transcribeAPI(audio, settings, abort.signal) : await transcribeLocal(audio, localSettings, directory, cwd, abort.signal);
      emit({ type: 'tool.status', status: 'completed', result: { provider: result.provider } });
      return { handled: true, result: { ...result, workspaceId: workspace.id } };
    } catch (error) {
      emit({ type: 'tool.status', status: abort.signal.aborted ? 'stopped' : 'failed', error: error.message });
      throw error;
    } finally {
      clearTimeout(timer);
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      finally { active.delete(job); }
    }
  })();
  return job.done;
}
