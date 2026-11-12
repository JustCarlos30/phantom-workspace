// Branch integration from a shell, for Phantom (the project's main chat) and
// people: the same host RPCs as the Ramas panel, so every action keeps its
// guarantees (never force, never discard, checks before a merge stays).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { invokeAgent } from './agent.mjs';

const USAGE = `Uso: branches.mjs <acción> [opciones]
  status [--all] [--json]           Ramas con trabajo: terminal, estado, commits, cambios, conflictos previstos
  commit RAMA "Mensaje"             Commitea todo el worktree de la rama (o concluye un merge en resolución)
  integrate RAMA… [--no-checks]     Integra en la rama base una por una (--no-ff) y corre los checks
                                    tras cada merge; si fallan, el merge se deshace. Se detiene al primer fallo
  update RAMA [--resolve]           Trae la base a la rama. --resolve deja los conflictos en su worktree
  abort RAMA                        Aborta el merge en resolución de esa rama
  publish [RAMA] [--remote NOMBRE]  Push sin forzar (por defecto, la rama base)
  clean [RAMA…] [--dry-run]         Quita ramas ya integradas sin terminal ni cambios (todas si no se indican)
  checks ["comando"|--auto|--none]  Muestra o fija los checks de integración (--auto: npm test si existe)
  incorporaciones on|off            Activa o desactiva la cola y el guard de Git de los workers
RAMA: nombre, sufijo o prefijo del id de la rama, o título/ID de su terminal. Opción global: --workspace RUTA`;

const LONG = 18 * 60 * 1000;
function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (['--all', '--json', '--no-checks', '--resolve', '--dry-run', '--auto', '--none'].includes(a)) out[a.slice(2)] = true;
    else if (['--workspace', '--remote'].includes(a)) { if (i + 1 >= args.length) throw new Error(`Falta el valor de ${a}\n\n${USAGE}`); out[a.slice(2)] = args[++i]; }
    else if (a.startsWith('--')) throw new Error(`Opción desconocida: ${a}\n\n${USAGE}`);
    else out._.push(a);
  }
  return out;
}

// One branch from a loose reference: exact name, terminal-id fragment, or terminal title prefix.
export function resolveBranch(rows, ref) {
  const q = String(ref).toLowerCase(), named = rows.filter(r => r.name);
  const exact = named.find(r => r.name === ref); if (exact) return exact;
  const hits = named.filter(r => !r.isBase && (r.name.toLowerCase().endsWith(q) || r.name.toLowerCase().includes(`/${q}`) || r.name.toLowerCase().includes(`-${q}`) || r.terminal?.nodeId?.startsWith(q) || r.terminal?.title?.toLowerCase().startsWith(q)));
  if (hits.length === 1) return hits[0];
  throw new Error(hits.length ? `"${ref}" es ambiguo: ${hits.map(r => r.name).join(', ')}` : `No hay ninguna rama que coincida con "${ref}"`);
}
const short = name => name.replace(/^phantom\/terminal-([0-9a-f]{8})[0-9a-f-]*$/, 'terminal-$1');

export function summarize(row) {
  const parts = [];
  if (row.ahead) parts.push(`+${row.ahead} commits`); if (row.behind) parts.push(`${row.behind} detrás`);
  if (row.changeCount) parts.push(`${row.changeCount} sin commit${row.inBase ? ` (${row.inBase} ya en base)` : ''}`);
  if (row.conflicts?.length) parts.push(`conflicto previsto: ${row.conflicts.slice(0, 3).join(', ')}${row.conflicts.length > 3 ? '…' : ''}`);
  if (row.request) parts.push(`solicitud ${row.request}`);
  const terminal = row.terminal ? `${row.terminal.title}${row.terminal.running ? ' · activa' : ''}${row.terminal.status && row.terminal.status !== 'idle' ? ` · ${row.terminal.status}` : ''}` : 'sin terminal';
  return `${row.isBase ? '* ' : '  '}${short(row.name ?? '(HEAD separado)').padEnd(22)} ${row.isBase ? 'base' : row.work.padEnd(5)}  ${terminal}${parts.length ? `  — ${parts.join(' · ')}` : ''}`;
}
// Integrated, abandoned-free branches: nothing ahead, nothing unsaved, no terminal, no worktree lock.
export const cleanable = row => row.name && !row.isBase && !row.ahead && !row.changeCount && !row.terminal && !row.worktree?.locked && !row.worktree?.main;

export async function main(args = process.argv.slice(2), env = process.env, call = (method, payload, timeout) => invokeAgent(method, payload, env.PHANTOM_WORKSPACE_SOCKET || (env.PHANTOM_WORKSPACE_HOME && path.join(env.PHANTOM_WORKSPACE_HOME, 'host.sock')), timeout)) {
  const [action, ...rest] = args, opt = flags(rest), ids = opt._;
  if (!action || action === 'help' || action === '--help') return USAGE;
  const state = await call('state.get', {}), folder = path.resolve(opt.workspace || process.cwd());
  // A worktree of the project lives outside its folder: match it through the branch overview instead.
  const w = state.workspaces.find(w => folder === w.canonicalPath || folder.startsWith(w.canonicalPath + path.sep)) ?? state.workspaces.find(w => w.id === state.activeWorkspaceId);
  if (!w) throw new Error('No encontré el proyecto en Phantom Workspace. Usa --workspace RUTA.');
  const workspaceId = w.id, overview = async () => { const data = await call('branch.overview', { workspaceId }); if (!data.available) throw new Error(data.reason || 'Ramas no disponible'); return data; };
  const need = (count, exact = true) => { if (exact ? ids.length !== count : ids.length < count) throw new Error(USAGE); };

  if (action === 'status') {
    const data = await overview(), rows = data.branches.filter(r => opt.all || r.isBase || r.work !== 'none' || r.terminal?.running || r.request);
    if (opt.json) return { base: data.base, checks: data.checks, integration: data.integration, branches: rows };
    const hidden = data.branches.length - rows.length;
    return [`Base ${data.base.branch} · checks: ${data.checks || 'ninguno'} · Incorporaciones ${data.integration.enabled ? 'activo' : 'apagado'}`, ...rows.map(summarize), ...(hidden ? [`  (${hidden} ramas sin trabajo pendiente; --all para verlas, clean para quitarlas)`] : [])].join('\n');
  }
  if (action === 'commit') { need(2); const row = resolveBranch((await overview()).branches, ids[0]); const r = await call('branch.commit', { workspaceId, branch: row.name, message: ids[1] }, 150000); return `${r.concluded ? 'Merge concluido' : 'Commit'} en ${short(row.name)}: ${r.oid.slice(0, 7)} (${r.files} archivos).`; }
  if (action === 'integrate') {
    need(1, false); const rows = (await overview()).branches, targets = ids.map(id => resolveBranch(rows, id)), out = [];
    for (const row of targets) {
      const r = await call('branch.integrate', { workspaceId, branch: row.name, ...(opt['no-checks'] ? { checks: false } : {}) }, LONG);
      if (r.status === 'merged') { out.push(`✓ ${short(row.name)} integrada en ${r.base} (${r.mergedOid.slice(0, 7)})${r.checks ? ` · checks OK en ${Math.round(r.checks.durationMs / 1000)} s` : ' · sin checks'}`); continue; }
      if (r.status === 'conflict') out.push(`✗ ${short(row.name)}: conflicto en ${r.conflicts.join(', ')}. Merge deshecho; ${r.base} sin cambios. Resuélvelo con: update ${short(row.name)} --resolve`);
      else out.push(`✗ ${short(row.name)}: checks fallidos (${r.checks.command}, código ${r.checks.code}${r.checks.timedOut ? ', tiempo agotado' : ''}). Merge deshecho.\n--- salida (final) ---\n${r.checks.output.split('\n').slice(-40).join('\n')}`);
      const left = targets.slice(targets.indexOf(row) + 1).map(r => short(r.name));
      if (left.length) out.push(`Detenido; quedan sin integrar: ${left.join(', ')}`);
      const error = new Error(out.join('\n')); error.partial = true; throw error;
    }
    return out.join('\n');
  }
  if (action === 'update') {
    need(1); const row = resolveBranch((await overview()).branches, ids[0]), r = await call('branch.update', { workspaceId, branch: row.name, ...(opt.resolve ? { resolve: true } : {}) }, 200000);
    if (r.status === 'updated') return `${short(row.name)} al día con ${r.base} (${r.oid.slice(0, 7)}).`;
    if (r.status === 'resolving') return `Conflictos en ${r.worktree}:\n${r.conflicts.map(f => `  ${f}`).join('\n')}\nEdita esos archivos y concluye con: commit ${short(row.name)} "Mensaje" (o abort ${short(row.name)}).`;
    return `Conflicto en ${r.conflicts.join(', ')}; el merge se deshizo. Usa --resolve para resolverlo en el worktree.`;
  }
  if (action === 'abort') { need(1); const row = resolveBranch((await overview()).branches, ids[0]); await call('branch.abort', { workspaceId, branch: row.name }); return `Merge abortado en ${short(row.name)}.`; }
  if (action === 'publish') {
    if (ids.length > 1) throw new Error(USAGE);
    const branch = ids[0] ? resolveBranch((await overview()).branches, ids[0]).name : undefined;
    const r = await call('branch.publish', { workspaceId, ...(branch ? { branch } : {}), ...(opt.remote ? { remote: opt.remote } : {}) }, 240000);
    return `Publicada ${r.branch} en ${r.remote} (${r.oid.slice(0, 7)}).`;
  }
  if (action === 'clean') {
    const rows = (await overview()).branches, targets = ids.length ? ids.map(id => resolveBranch(rows, id)) : rows.filter(cleanable);
    if (!targets.length) return 'No hay ramas integradas que limpiar.';
    if (opt['dry-run']) return `Se quitarían: ${targets.map(r => short(r.name)).join(', ')}`;
    const out = [];
    for (const row of targets) { try { await call('branch.remove', { workspaceId, branch: row.name }, 60000); out.push(`✓ ${short(row.name)}`); } catch (error) { out.push(`· ${short(row.name)}: ${error.message}`); } }
    return out.join('\n');
  }
  if (action === 'checks') {
    if (ids.length > 1 || (ids.length && (opt.auto || opt.none))) throw new Error(USAGE);
    if (ids.length || opt.auto || opt.none) await call('merge.configure', { workspaceId, checks: opt.auto ? null : opt.none ? '' : ids[0] });
    const data = await overview();
    return `Checks de integración: ${data.checks || 'ninguno'}`;
  }
  if (action === 'incorporaciones') {
    need(1); if (!['on', 'off'].includes(ids[0])) throw new Error(USAGE);
    const r = await call('merge.configure', { workspaceId, enabled: ids[0] === 'on' });
    return `Incorporaciones ${r.enabled ? 'activo' : 'apagado'}${r.guard?.installed ? ' · guard de Git instalado' : r.guard?.reason ? ` · guard: ${r.guard.reason}` : ''}.`;
  }
  throw new Error(USAGE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then(value => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2)), error => { console.error(error.message); process.exitCode = 1; });
