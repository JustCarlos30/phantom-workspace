import { lstat, readdir, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { command, workspaceRoot, safePath, readBounded } from './common.mjs';

const HASH = /^[a-f0-9]{64}$/;
// Multiple panels share the workshop lock. Serialize our own CLI calls without
// retrying mutations whose outcome might already have been committed.
const pending = new Map();
async function workshopCommand(root, context, args) {
  const previous = pending.get(root) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => command(context, process.execPath, args, { cwd: root, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }));
  pending.set(root, task);
  try { return await task; }
  finally { if (pending.get(root) === task) pending.delete(root); }
}
export const validSlug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,95}$/.test(value);
export const validRender = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,191}\.mp4$/.test(value);
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function version(value) {
  if (!object(value) || value.schemaVersion !== 1) throw new Error('Contrato de revisión incompatible: se exige schemaVersion 1.');
  return value;
}
async function regular(root, relative) {
  const file = await safePath(root, relative);
  if (!(await lstat(file)).isFile()) throw new Error('Se requiere un archivo regular.');
  return file;
}
export async function verifyReviewRender(root, slug, pkg) {
  if (!validSlug(slug) || !validRender(pkg?.origin?.file?.slice(8)) || pkg.origin.file !== `exports/${pkg.origin.file.slice(8)}`
    || pkg.origin.kind !== 'render' || !HASH.test(pkg.origin.sha256) || !HASH.test(pkg.revision) || pkg.origin.revision !== pkg.revision) throw new Error('Asociación del render inválida. Hay que renderizar de nuevo.');
  const file = await realpath(await regular(await realpath(root), `projects/${slug}/${pkg.origin.file}`));
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('El render no es un archivo regular.');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
    if (hash.digest('hex') !== pkg.origin.sha256) throw new Error('El hash del MP4 no coincide. Hay que renderizar de nuevo.');
    const verified = await handle.stat();
    if (['dev', 'ino', 'size', 'mtimeMs'].some(key => verified[key] !== stat[key])) throw new Error('El render cambió durante la verificación.');
    handle.reviewIdentity = { file, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
export async function videoReview(method, payload, context) {
  const { root } = await workspaceRoot(context, payload);
  try { await regular(root, 'bin/video.mjs'); await regular(root, 'REVIEW.md'); }
  catch (error) { return { available: false, reason: `Esta carpeta no es un taller de videos válido: necesita bin/video.mjs y REVIEW.md sin enlaces simbólicos. ${error.message}` }; }
  if (method === 'review.projects') {
    const items = [];
    let projects;
    try { projects = await safePath(root, 'projects'); await lstat(projects); }
    catch (error) { if (error.code === 'ENOENT') return { available: true, items }; throw error; }
    for (const entry of await readdir(projects, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('No se admiten proyectos con enlaces simbólicos.');
      if (!validSlug(entry.name) || !entry.isDirectory()) continue;
      const renders = [];
      const exports = await safePath(root, `projects/${entry.name}/exports`, { missing: true });
      let files = [];
      try { files = await readdir(exports, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const file of files) {
        if (file.isSymbolicLink()) throw new Error('No se admiten enlaces simbólicos en exports.');
        if (!file.name.endsWith('.mp4.review.json')) continue;
        const render = file.name.slice(0, -12);
        if (!validRender(render)) throw new Error('Nombre de render inválido.');
        try {
          const data = await readBounded(await regular(root, `projects/${entry.name}/exports/${file.name}`));
          if (data.truncated) throw new Error('Sidecar demasiado grande');
          const sidecar = version(JSON.parse(data.text));
          if (!HASH.test(sidecar.revision) || !HASH.test(sidecar.sha256) || typeof sidecar.snapshot !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,191}$/.test(sidecar.snapshot)) throw new Error('Sidecar inválido');
          await regular(root, `projects/${entry.name}/exports/${render}`);
          renders.push({ name: render, revision: sidecar.revision, snapshot: sidecar.snapshot });
        } catch (error) { renders.push({ name: render, reason: `${error.message}. Hay que renderizar de nuevo.` }); }
      }
      for (const file of files) if (validRender(file.name) && !files.some(sidecar => sidecar.name === `${file.name}.review.json`)) renders.push({ name: file.name, reason: 'Render sin sidecar de revisión. Hay que renderizar de nuevo.' });
      items.push({ slug: entry.name, renders: renders.sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return { available: true, items: items.sort((a, b) => a.slug.localeCompare(b.slug)) };
  }
  const action = method.slice(7);
  if (!['export', 'add', 'list', 'resolve'].includes(action)) throw new Error('Acción de revisión desconocida.');
  if (!validSlug(payload.slug)) throw new Error('Slug de proyecto inválido.');
  const project = await safePath(root, `projects/${payload.slug}`);
  if (!(await lstat(project)).isDirectory()) throw new Error('Proyecto inválido.');
  const input = payload.input ?? {};
  if (!object(input)) throw new Error('La entrada debe ser un objeto JSON.');
  if (action === 'export' && input.render !== undefined && !validRender(input.render)) throw new Error('Nombre de render inválido.');
  let output;
  try {
    output = await workshopCommand(root, context, ['bin/video.mjs', 'review', action, payload.slug, '--json', JSON.stringify(input)]);
    if (output.code !== undefined && output.code !== 0 || output.exitCode !== undefined && output.exitCode !== 0) throw new Error(output.stderr || 'El taller terminó con error.');
  } catch (error) {
    const message = (error.stderr || error.message).replace(/^.*?Error:\s*/s, '');
    throw new Error(/lock|bloquead|otro comando/i.test(message) ? `${message.trim()} Reintenta cuando termine el comando activo del taller.` : message.trim());
  }
  let result;
  try { result = JSON.parse(output.stdout); } catch { throw new Error('El taller debe devolver exactamente un objeto JSON.'); }
  if (!object(result)) throw new Error('Respuesta de revisión inválida: se esperaba un objeto.');
  if (['export', 'list'].includes(action) || 'schemaVersion' in result) version(result);
  if (action === 'export') {
    if (result.project !== payload.slug || !HASH.test(result.revision) || !object(result.video) || !Array.isArray(result.elements)
      || !['width', 'height', 'fps', 'durationInFrames'].every(key => Number.isFinite(result.video[key]) && result.video[key] > 0)
      || !Number.isInteger(result.video.durationInFrames)) throw new Error('Paquete de revisión inválido.');
    if (input.render !== undefined && result.origin?.file !== `exports/${input.render}`) throw new Error('El taller devolvió otro render.');
    if (result.origin?.kind === 'render') { const handle = await verifyReviewRender(root, payload.slug, result); await handle.close(); }
  }
  return result;
}
