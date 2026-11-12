// References and comments: the canvas as a board. A reference is a panel that
// shows an image, a video or a link; its file lives in the app's data tree
// (never in the project folder), named by content hash. Comments are pins
// anchored to a panel (fractions of its box) or to the canvas (world units),
// optionally at a video time, each with a short thread.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assert, object, text } from './store.mjs';
import { validateReview, reviewBrief } from '../shared/video-review.mjs';

export const MAX_IMAGE = 12 * 1024 * 1024;
export const MAX_VIDEO = 2 * 1024 * 1024 * 1024;
export const REFERENCE_KINDS = ['image', 'video', 'link', 'empty'];
export const REFERENCE_FILE = /^[0-9a-f]{32}\.(png|jpg|gif|webp|avif|mp4|mov|webm)$/;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const HEADER = 36, FOOTER = 34;

// Content decides the type; names and declared MIME types are never trusted.
export function sniff(bytes) {
  const ascii = (from, to) => bytes.toString('latin1', from, to);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', mime: 'image/avif', ext: 'avif' };
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', ext: 'mov' };
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { kind: 'video', mime: 'video/webm', ext: 'webm' };
  return null;
}

// Width/height from the header, so a board can be laid out before anything renders.
export function imageSize(bytes) {
  try {
    const type = sniff(bytes)?.ext;
    if (type === 'png') return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (type === 'gif') return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    if (type === 'webp') {
      const chunk = bytes.toString('latin1', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (chunk === 'VP8L') { const b = bytes.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
      if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (type === 'jpg') {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker === 0xff) { i++; continue; }
        if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        i += 2 + bytes.readUInt16BE(i + 2);
      }
    }
  } catch { /* A truncated header simply has no known size. */ }
  return null;
}

export const referenceDir = (dataDir, workspaceId) => { assert(uuid(workspaceId), 'Invalid workspace ID'); return path.join(dataDir, 'references', workspaceId); };
export const referencePath = (dataDir, workspaceId, file) => { assert(REFERENCE_FILE.test(file), 'Invalid reference file'); return path.join(referenceDir(dataDir, workspaceId), file); };

function place(dataDir, workspaceId, hash, type) {
  const dir = referenceDir(dataDir, workspaceId); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = `${hash.slice(0, 32)}.${type.ext}`;
  return { file, target: path.join(dir, file) };
}
export function storeBytes(dataDir, workspaceId, bytes) {
  const type = sniff(bytes); assert(type, 'Formato no compatible. Usa PNG, JPEG, WebP, GIF, AVIF, MP4, MOV o WebM');
  assert(bytes.length <= (type.kind === 'image' ? MAX_IMAGE : MAX_VIDEO), type.kind === 'image' ? 'La imagen supera el límite de 12 MB' : 'El video supera el límite de 2 GB');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { file, target } = place(dataDir, workspaceId, hash, type);
  if (!fs.existsSync(target)) { const tmp = `${target}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, bytes, { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, target); }
  const size = type.kind === 'image' ? imageSize(bytes) : null;
  return { file, hash, kind: type.kind, mime: type.mime, bytes: bytes.length, ...(size?.width > 0 && size?.height > 0 ? { aspect: size.width / size.height } : {}) };
}
// Local files are copied (videos can be large), hashed as a stream.
export async function storeFile(dataDir, workspaceId, source) {
  text(source, 'path', 4096); assert(path.isAbsolute(source), 'Ruta absoluta requerida');
  const stat = await fs.promises.stat(source); assert(stat.isFile(), 'La referencia no es un archivo');
  const handle = await fs.promises.open(source, 'r');
  let head;
  try { const buffer = Buffer.alloc(Math.min(stat.size, 64 * 1024)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); head = buffer.subarray(0, bytesRead); } finally { await handle.close(); }
  const type = sniff(head); assert(type, 'Formato no compatible. Usa PNG, JPEG, WebP, GIF, AVIF, MP4, MOV o WebM');
  if (type.kind === 'image') { assert(stat.size <= MAX_IMAGE, 'La imagen supera el límite de 12 MB'); return storeBytes(dataDir, workspaceId, await fs.promises.readFile(source)); }
  assert(stat.size <= MAX_VIDEO, 'El video supera el límite de 2 GB');
  // Hash the private copy, not a source that may change between hash and copy.
  const dir = referenceDir(dataDir, workspaceId); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${randomUUID()}.tmp`);
  try {
    await fs.promises.copyFile(source, tmp, fs.constants.COPYFILE_EXCL);
    await fs.promises.chmod(tmp, 0o600);
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of fs.createReadStream(tmp)) { bytes += chunk.length; assert(bytes <= MAX_VIDEO, 'El video supera el límite de 2 GB'); hash.update(chunk); }
    const digest = hash.digest('hex'), { file, target } = place(dataDir, workspaceId, digest, type);
    if (!fs.existsSync(target)) await fs.promises.rename(tmp, target);
    return { file, hash: digest, kind: 'video', mime: type.mime, bytes };
  } finally { await fs.promises.rm(tmp, { force: true }); }
}

function webURL(value) {
  text(value, 'url', 8192); let url;
  try { url = new URL(value); } catch { throw new Error('Usa una URL http:// o https://'); }
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Solo se permite HTTP(S) sin credenciales');
  return url;
}
async function download(url, max, accept) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { accept, 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } });
  assert(response.ok, `La página respondió ${response.status}`);
  const chunks = []; let total = 0;
  for await (const chunk of response.body) { total += chunk.length; if (total > max) { if (accept.startsWith('text/html')) break; throw new Error('El archivo remoto supera el límite de 12 MB'); } chunks.push(chunk); }
  return { bytes: Buffer.concat(chunks), type: response.headers.get('content-type') || '', url: response.url };
}
const decode = value => value.replace(/&(amp|lt|gt|quot|#39|#x27|apos|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", apos: "'", nbsp: ' ' }[e])).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
// Title, description and preview image as the page itself declares them.
export function pageMeta(html, base) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = /\b(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase(), content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (name && content && meta[name] === undefined) meta[name] = decode(content[1] ?? content[2] ?? '');
  }
  const title = meta['og:title'] || meta['twitter:title'] || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '');
  let image = meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || '';
  try { image = image ? new URL(image, base).href : ''; } catch { image = ''; }
  return { title: title.slice(0, 300), description: (meta['og:description'] || meta.description || '').slice(0, 600), site: (meta['og:site_name'] || '').slice(0, 120), image };
}

export function validateReference(data) {
  assert(REFERENCE_KINDS.includes(data.kind), 'Invalid reference kind');
  if (data.file !== undefined) assert(typeof data.file === 'string' && REFERENCE_FILE.test(data.file), 'Invalid reference file');
  if (data.hash !== undefined) assert(/^[a-f0-9]{64}$/.test(data.hash) && data.file?.startsWith(data.hash.slice(0, 32)), 'Invalid reference hash');
  if (data.previousVersion !== undefined) assert(uuid(data.previousVersion), 'Invalid previous version');
  for (const [key, max] of [['note', 4000], ['source', 8192], ['url', 8192], ['description', 600], ['site', 120], ['mime', 64]]) if (data[key] !== undefined) text(data[key], `reference ${key}`, max);
  if (data.aspect !== undefined) assert(Number.isFinite(data.aspect) && data.aspect > 0 && data.aspect < 1000, 'Invalid reference aspect');
  if (data.tags !== undefined) { assert(Array.isArray(data.tags) && data.tags.length <= 32, 'Invalid reference tags'); for (const tag of data.tags) text(tag, 'reference tag', 64); }
}
export function validateComments(comments, nodes) {
  assert(Array.isArray(comments) && comments.length <= 2000, 'Invalid comments'); const seen = new Set();
  for (const c of comments) {
    object(c); assert(uuid(c.id) && !seen.has(c.id), 'Invalid comment ID'); seen.add(c.id);
    assert(c.nodeId === null || nodes.some(n => n.id === c.nodeId), 'Comment points to a missing panel');
    assert(Number.isFinite(c.x) && Number.isFinite(c.y) && Math.abs(c.x) <= 1e7 && Math.abs(c.y) <= 1e7, 'Invalid comment position');
    if (c.nodeId) assert(c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1, 'Comment position must be a fraction of its panel');
    if (c.time !== undefined) assert(Number.isFinite(c.time) && c.time >= 0 && c.time <= 1e6, 'Invalid comment time');
    if (c.review) {
      validateReview(c.review);
      const node = nodes.find(n => n.id === c.nodeId);
      assert(node?.type === 'reference' && node.data.file === c.review.file && node.data.hash === c.review.hash && node.data.kind === c.review.kind, 'Review version mismatch');
      if (c.review.kind === 'video') assert(c.time === c.review.time, 'Review time mismatch');
    }
    if (c.requestId !== undefined) assert(uuid(c.requestId), 'Invalid comment request');
    if (c.handoff) {
      assert(['sending', 'sent', 'queued', 'failed', 'uncertain'].includes(c.handoff.status), 'Invalid handoff state');
      text(c.handoff.brief, 'handoff brief', 100000); text(c.handoff.updatedAt, 'handoff date', 64);
      if (c.handoff.error) text(c.handoff.error, 'handoff error', 4096);
    }
    if (c.spaceId !== undefined) assert(uuid(c.spaceId), 'Invalid comment space');
    assert(typeof c.resolved === 'boolean', 'Invalid comment state');
    assert(Array.isArray(c.messages) && c.messages.length >= 1 && c.messages.length <= 100, 'Invalid comment thread');
    for (const m of c.messages) { object(m); assert(uuid(m.id), 'Invalid message ID'); if (m.requestId !== undefined) assert(uuid(m.requestId), 'Invalid reply request'); text(m.text, 'comment text', 4000); assert(m.text.trim(), 'Empty comment'); text(m.author, 'comment author', 64); text(m.createdAt, 'comment date', 64); }
  }
}

// "@phantom" (or @claude, @agente) in a person's comment hands the thread to the project's agent.
export const MENTION = /(^|[^\w@])@(phantom|claude|agente)\b/i;
const clock = seconds => { const t = Math.floor(seconds), m = Math.floor(t / 60); return `${m}:${String(t % 60).padStart(2, '0')}`; };
export function mentionBrief(w, comment, dataDir, cli) {
  const number = w.comments.indexOf(comment) + 1, node = comment.nodeId ? w.nodes.find(n => n.id === comment.nodeId) : null;
  const file = node?.type === 'reference' && node.data.file ? referencePath(dataDir, w.id, node.data.file) : null;
  const where = node ? `${node.type === 'reference' ? `reference (${node.data.kind})` : `${node.type} panel`} "${node.title}"` : `the canvas at ${comment.x},${comment.y}`;
  return [`The user asked you in comment thread #${number} on ${where}.`,
    node ? `Pin at ${Math.round(comment.x * 100)}% from the left, ${Math.round(comment.y * 100)}% from the top of the ${comment.review ? 'decoded content (not panel chrome)' : 'panel'}${comment.time !== undefined ? `, at ${clock(comment.time)} (${comment.time}s) into the video` : ''}.` : '',
    file ? `File: ${file} — read it to see what they are pointing at.` : '', node?.data?.url ? `Site: ${node.data.url}` : '', node?.data?.source ? `Source: ${node.data.source}` : '', node?.data?.note ? `Their note on this reference: ${node.data.note}` : '',
    reviewBrief(comment.review), comment.review?.capture ? `Captura: ${referencePath(dataDir, w.id, comment.review.capture)}` : '', '', 'Thread:', ...comment.messages.map(m => `- ${m.author}: ${m.text}`), '',
    `Do what they ask. When done, answer in the thread itself: "\${PHANTOM_AGENT_NODE:-node}" ${JSON.stringify(cli)} reply ${number} "<short answer>" --author Phantom. Do not resolve it; the user does.`].filter(line => line !== '').join('\n').replace('Thread:', '\nThread:');
}
const message = p => ({ id: randomUUID(), text: text(p.text, 'comment text', 4000).trim(), author: p.author === undefined ? 'Tú' : text(p.author, 'comment author', 64).trim() || 'Tú', createdAt: new Date().toISOString() });
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export async function handleReference(method, p, { store, mutate, dataDir, mention, brief = (w, c) => mentionBrief(w, c, dataDir, 'scripts/canvas.mjs') }) {
  const w = store.getWorkspace(p.workspaceId);
  if (method === 'reference.add' || method === 'reference.link') {
    let data;
    if (method === 'reference.link') {
      const url = webURL(p.url); let meta = { title: '', description: '', site: '', image: '' }, stored = null;
      try {
        const page = await download(url, 768 * 1024, 'text/html,application/xhtml+xml');
        // A URL that is itself an image becomes an image reference with its source.
        if (sniff(page.bytes)?.kind === 'image' && !/html/i.test(page.type)) stored = { ...storeBytes(dataDir, w.id, (await download(url, MAX_IMAGE, 'image/*')).bytes), direct: true };
        else { meta = pageMeta(page.bytes.toString('utf8'), page.url); if (meta.image) try { stored = storeBytes(dataDir, w.id, (await download(webURL(meta.image), MAX_IMAGE, 'image/*')).bytes); if (stored.kind !== 'image') stored = null; } catch { stored = null; } }
      } catch (error) { if (p.strict) throw error; /* Offline or blocked: the link itself is still a valid reference. */ }
      data = stored?.direct ? { kind: 'image', file: stored.file, hash: stored.hash, mime: stored.mime, ...(stored.aspect ? { aspect: stored.aspect } : {}), source: url.href }
        : { kind: 'link', url: url.href, ...(meta.description ? { description: meta.description } : {}), site: meta.site || url.hostname.replace(/^www\./, ''), ...(stored ? { file: stored.file, mime: stored.mime, ...(stored.aspect ? { aspect: stored.aspect } : {}) } : {}) };
      p = { ...p, title: p.title || meta.title || url.hostname.replace(/^www\./, '') };
    } else {
      assert([p.data, p.path].filter(v => v !== undefined).length === 1, 'Indica data (base64) o path');
      const stored = p.data !== undefined ? storeBytes(dataDir, w.id, Buffer.from(text(p.data, 'reference data', 17 * 1024 * 1024), 'base64')) : await storeFile(dataDir, w.id, p.path);
      data = { kind: stored.kind, file: stored.file, hash: stored.hash, mime: stored.mime, ...(stored.aspect ? { aspect: stored.aspect } : {}), ...(p.source ? { source: webURL(p.source).href } : {}) };
      p = { ...p, title: p.title || (p.path ? path.basename(p.path).replace(/\.[^.]+$/, '') : stored.kind === 'video' ? 'Video' : 'Imagen') };
    }
    if (p.note) data.note = text(p.note, 'reference note', 4000);
    if (p.tags) data.tags = p.tags;
    if (p.previousVersion) {
      const previous = w.nodes.find(n => n.id === p.previousVersion && n.type === 'reference');
      assert(previous && ['image', 'video'].includes(previous.data.kind) && previous.data.kind === data.kind, 'Versión anterior incompatible o fuera del proyecto');
      assert(previous.data.file !== data.file, 'El render es idéntico al original');
      data.previousVersion = previous.id;
    }
    if (p.spaceId) { assert((w.spaces || []).some(s => s.id === p.spaceId), 'Unknown space'); data.spaceId = p.spaceId; }
    validateReference(data);
    // The box hugs the media: header, the picture at its own ratio, the caption line.
    const aspect = data.aspect || (data.kind === 'video' ? 16 / 9 : 4 / 3), width = Math.round(Math.min(960, Math.max(200, finite(p.width, data.kind === 'link' ? 340 : 360))));
    const height = Math.round(finite(p.height, HEADER + FOOTER + (data.kind === 'link' && !data.file ? 96 : width / aspect) + (data.kind === 'link' ? 64 : 0)));
    return mutate(w.id, () => {
      const node = { id: randomUUID(), type: 'reference', title: text(p.title, 'title', 512).slice(0, 200), x: Math.round(finite(p.x, 0) - (p.center ? width / 2 : 0)), y: Math.round(finite(p.y, 0) - (p.center ? height / 2 : 0)), width, height, groupId: null, data };
      store.getWorkspace(w.id).nodes.push(node); return node;
    });
  }
  if (method === 'reference.list') return w.nodes.filter(n => n.type === 'reference').map(n => ({ ...n, path: n.data.file ? referencePath(dataDir, w.id, n.data.file) : null }));
  if (method === 'reference.identity') {
    const node = w.nodes.find(n => n.id === p.id && n.type === 'reference'); assert(node?.data.file, 'Referencia no encontrada');
    if (!node.data.hash) {
      const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(referencePath(dataDir, w.id, node.data.file))) hash.update(chunk);
      const digest = hash.digest('hex'); assert(node.data.file.startsWith(digest.slice(0, 32)), 'El archivo no coincide con su identidad');
      mutate(w.id, () => { node.data.hash = digest; });
    }
    return { file: node.data.file, hash: node.data.hash, kind: node.data.kind };
  }
  if (method === 'comment.list') return w.comments || [];
  // Hands a thread to the agent after it is saved; a failure never loses the comment.
  const prepareHandoff = (comment, said) => {
    if (MENTION.test(said.text) && said.author === 'Tú') comment.handoff = { status: 'sending', brief: brief(store.getWorkspace(w.id), comment), updatedAt: new Date().toISOString() };
  };
  const handOff = async (comment, said, retry = false) => {
    if (!retry && (!MENTION.test(said.text) || said.author !== 'Tú')) return structuredClone(comment);
    const snapshot = comment.handoff.brief;
    if (retry) mutate(w.id, () => { comment.handoff = { status: 'sending', brief: snapshot, updatedAt: new Date().toISOString() }; });
    let delivered = false;
    try {
      assert(mention, 'Agente no disponible');
      const sent = await mention(w, comment, snapshot);
      delivered = true;
      try {
        mutate(w.id, () => { const current = store.getWorkspace(w.id).comments.find(c => c.id === comment.id); current.handoff = { ...current.handoff, status: sent?.queued ? 'queued' : 'sent', ...(sent?.id ? { queueId: sent.id } : {}), updatedAt: new Date().toISOString() }; });
      } catch (error) {
        // Delivery happened: never report this as a safe-to-resend failure.
        mutate(w.id, () => { const current = store.getWorkspace(w.id).comments.find(c => c.id === comment.id); current.handoff = { ...current.handoff, status: 'uncertain', error: `Entregado, pero falló guardar el acuse: ${error.message}`.slice(0, 4096), updatedAt: new Date().toISOString() }; });
      }
    } catch (error) {
      mutate(w.id, () => { const current = store.getWorkspace(w.id).comments.find(c => c.id === comment.id); if (current.handoff.status === 'sending') current.handoff = { ...current.handoff, status: delivered ? 'uncertain' : 'failed', error: error.message.slice(0, 4096), updatedAt: new Date().toISOString() }; });
    }
    const current = store.getWorkspace(w.id).comments.find(c => c.id === comment.id);
    return { ...structuredClone(current), mention: current.handoff.status, mentionError: current.handoff.error };
  };
  if (method === 'comment.add' && p.requestId) {
    assert(uuid(p.requestId), 'Invalid comment request');
    const existing = (w.comments || []).find(c => c.requestId === p.requestId);
    if (existing) return structuredClone(existing);
  }
  if (method === 'comment.add') { const made = mutate(w.id, () => {
    const node = p.nodeId ? w.nodes.find(n => n.id === p.nodeId) : null; assert(!p.nodeId || node, 'Node not found');
    const clamp01 = v => Math.min(1, Math.max(0, finite(v, .5)));
    const comment = { id: randomUUID(), nodeId: node?.id ?? null, x: node ? clamp01(p.x) : finite(p.x, 0), y: node ? clamp01(p.y) : finite(p.y, 0), ...(Number.isFinite(p.time) ? { time: Math.max(0, p.time) } : {}), ...(!node && p.spaceId ? { spaceId: p.spaceId } : {}), resolved: false, messages: [message(p)] };
    if (p.requestId) comment.requestId = p.requestId;
    if (p.review) {
      validateReview(p.review);
      assert(p.review.capture === undefined, 'La captura se adjunta como PNG, no como ruta');
      assert(node?.data.hash === p.review.hash && node.data.file === p.review.file, 'La revisión debe apuntar a esta versión inmutable');
      comment.review = structuredClone(p.review);
      comment.x = p.review.region.x; comment.y = p.review.region.y;
      if (p.capture) {
        const captured = storeBytes(dataDir, w.id, Buffer.from(text(p.capture, 'captura', 900000), 'base64'));
        assert(captured.mime === 'image/png', 'Captura PNG requerida'); comment.review.capture = captured.file;
      }
      if (p.review.kind === 'video') comment.time = p.review.time;
    }
    (w.comments ??= []).push(comment); prepareHandoff(comment, comment.messages[0]); return comment;
  }); return handOff(made, made.messages[0]); }
  const comment = (w.comments || []).find(c => c.id === p.id); assert(comment, 'Comment not found');
  if (method === 'comment.retry') {
    assert(comment.handoff?.status === 'failed', 'Solo se reintenta un envío fallido');
    return handOff(comment, null, true);
  }
  if (method === 'comment.reply') {
    if (p.requestId !== undefined) {
      assert(uuid(p.requestId), 'Invalid reply request');
      if (comment.messages.some(m => m.requestId === p.requestId)) return structuredClone(comment);
    }
    assert(comment.handoff?.status !== 'sending' || !MENTION.test(p.text || ''), 'Espera a que termine el envío actual');
    mutate(w.id, () => { comment.messages.push({ ...message(p), ...(p.requestId ? { requestId: p.requestId } : {}) }); prepareHandoff(comment, comment.messages.at(-1)); }); return handOff(comment, comment.messages.at(-1));
  }
  if (method === 'comment.update') return mutate(w.id, () => {
    object(p.patch); for (const key of Object.keys(p.patch)) assert(['resolved', 'x', 'y', 'text'].includes(key), 'Unsupported comment patch');
    if (p.patch.resolved !== undefined) comment.resolved = p.patch.resolved === true;
    if (p.patch.x !== undefined) comment.x = p.patch.x;
    if (p.patch.y !== undefined) comment.y = p.patch.y;
    if (p.patch.text !== undefined) comment.messages[0].text = text(p.patch.text, 'comment text', 4000).trim();
    return comment;
  });
  if (method === 'comment.remove') return mutate(w.id, () => { w.comments = w.comments.filter(c => c.id !== comment.id); return { ok: true }; });
  throw new Error('Unknown reference method');
}

// Removing a panel takes its comment pins and, when no other panel shows it, its file.
export function forgetNode(w, node, dataDir) {
  if (w.comments) w.comments = w.comments.filter(c => c.nodeId !== node.id);
  const file = node.type === 'reference' ? node.data?.file : null;
  if (file && REFERENCE_FILE.test(file) && !w.nodes.some(n => n.id !== node.id && n.data?.file === file)) fs.rmSync(referencePath(dataDir, w.id, file), { force: true });
}
