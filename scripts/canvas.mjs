// Canvas control for agents (and people) from a shell: list, arrange, move,
// resize, rename, hide/show and zone panels of the current project. It talks to
// the running host over its socket with the same RPCs the UI uses, so every
// change is validated by the host and appears live on the canvas.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { invokeAgent } from './agent.mjs';

const USAGE = `Uso: canvas.mjs <acción> [opciones]
  list [--all] [--json]                 Paneles del proyecto (id corto, tipo, título, rama, posición)
  arrange [--by type|branch|status|none] [--zones] [--gap N] [--dry-run]
                                        Ordena los paneles visibles sin solaparlos; las zonas
                                        propias se mueven con su contenido. --zones dibuja una
                                        zona por grupo (sustituye las zonas automáticas previas).
  move ID X Y | resize ID ANCHO ALTO | rename ID "Título"
  hide ID… | show ID…|--all             Oculta/muestra paneles (no detiene sesiones)
  zone "Nombre" ID… [--color iris|mint|amber|rose|slate]
  unzone ID…                            Borra zonas (los paneles se quedan)
ID: prefijo del id, del título o de la rama del panel. Opción global: --workspace RUTA`;

export const ZONE_COLORS = ['iris', 'mint', 'amber', 'rose', 'slate'];
const ZONE_PAD = 40, ZONE_HEADER = 24, ROW_WIDTH = 3600, GROUP_GAP = 120, MAX_COLS = 4;

const inside = (n, z) => n.x >= z.x && n.y >= z.y && n.x + n.width <= z.x + z.width && n.y + n.height <= z.y + z.height;
const spaceOf = n => n.data?.spaceId ?? null;

const TYPE_LABELS = { terminal: 'Terminales', browser: 'Navegadores', note: 'Notas', tasks: 'Tareas', context: 'Contexto', git: 'Git', branches: 'Ramas', services: 'Servicios', docker: 'Docker', mission: 'Misiones', workflows: 'Flujos', playwright: 'Playwright', playground: 'Playground', plugins: 'Plugins', 'phantom-cards': 'Cards', 'phantom-skills': 'Skills', 'skills-catalog': 'Skills', 'command-center': 'Centro de mando', incorporaciones: 'Incorporaciones' };
export function groupKey(node, by) {
  if (by === 'type') return TYPE_LABELS[node.type] || node.type;
  if (by === 'branch') return node.data?.worktree?.branch || 'Sin rama';
  if (by === 'status') return { working: 'Trabajando', blocked: 'Bloqueado', review: 'En revisión', idle: 'En espera' }[node.data?.agent?.status] || 'Sin estado';
  return '';
}

// Pure layout: returns { moves:[{id,x,y}], zones:[{title,x,y,width,height,color,spaceId}], removeZones:[id] }.
// Each space is laid out independently, since spaces are separate views.
export function planArrange(nodes, { by = 'type', zones = false, gap = 48 } = {}) {
  const visible = nodes.filter(n => !n.data?.hidden), moves = [], newZones = [], removeZones = [];
  const autoZones = visible.filter(n => n.type === 'zone' && n.data?.auto === 'canvas');
  if (zones) removeZones.push(...autoZones.map(z => z.id));
  const manualZones = visible.filter(n => n.type === 'zone' && !(zones && n.data?.auto === 'canvas'));
  for (const space of [...new Set(visible.map(spaceOf))]) {
    const inSpace = visible.filter(n => spaceOf(n) === space), blocks = [], claimed = new Set();
    // Kept zones travel as rigid blocks with the panels fully inside them.
    for (const z of manualZones.filter(z => spaceOf(z) === space).sort((a, b) => a.y - b.y || a.x - b.x)) {
      const members = inSpace.filter(n => n.type !== 'zone' && !claimed.has(n.id) && inside(n, z));
      members.forEach(n => claimed.add(n.id));
      blocks.push({ width: z.width, height: z.height, place: (x, y) => { moves.push({ id: z.id, x, y }); for (const n of members) moves.push({ id: n.id, x: x + n.x - z.x, y: y + n.y - z.y }); } });
    }
    const loose = inSpace.filter(n => n.type !== 'zone' && !claimed.has(n.id) && !(n.data?.auto === 'canvas'));
    const groups = new Map();
    for (const n of [...loose].sort((a, b) => a.y - b.y || a.x - b.x)) { const key = groupKey(n, by); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(n); }
    let color = 0;
    for (const [key, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const cols = Math.min(MAX_COLS, Math.ceil(Math.sqrt(members.length))), rows = [];
      for (let i = 0; i < members.length; i += cols) rows.push(members.slice(i, i + cols));
      const rowHeights = rows.map(r => Math.max(...r.map(n => n.height))), colWidths = Array.from({ length: cols }, (_, c) => Math.max(0, ...rows.map(r => r[c]?.width ?? 0)));
      const innerW = colWidths.reduce((a, b) => a + b, 0) + gap * (cols - 1), innerH = rowHeights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
      const framed = zones && key && members.length > 1, padX = framed ? ZONE_PAD : 0, padTop = framed ? ZONE_PAD + ZONE_HEADER : 0, padBottom = framed ? ZONE_PAD : 0;
      const zoneColor = ZONE_COLORS[color++ % ZONE_COLORS.length];
      blocks.push({ width: innerW + padX * 2, height: innerH + padTop + padBottom, place: (x, y) => {
        if (framed) newZones.push({ title: key, x, y, width: innerW + padX * 2, height: innerH + padTop + padBottom, color: zoneColor, spaceId: space });
        let top = y + padTop;
        rows.forEach((row, r) => { let left = x + padX; row.forEach((n, c) => { moves.push({ id: n.id, x: left, y: top }); left += colWidths[c] + gap; }); top += rowHeights[r] + gap; });
      } });
    }
    // Shelf packing: blocks fill rows of ROW_WIDTH, each row as tall as its tallest block.
    // Anchored at the space's current top-left so the camera keeps looking at the panels.
    const anchored = inSpace.filter(n => !removeZones.includes(n.id)), originX = anchored.length ? Math.min(...anchored.map(n => n.x)) : 0, originY = anchored.length ? Math.min(...anchored.map(n => n.y)) : 0;
    let x = originX, y = originY, shelf = 0;
    for (const b of blocks) {
      if (x > originX && x - originX + b.width > ROW_WIDTH) { x = originX; y += shelf + GROUP_GAP; shelf = 0; }
      b.place(Math.round(x), Math.round(y)); x += b.width + GROUP_GAP; shelf = Math.max(shelf, b.height);
    }
  }
  return { moves: moves.map(m => ({ ...m, x: Math.round(m.x), y: Math.round(m.y) })), zones: newZones, removeZones };
}

export function resolve(nodes, ref) {
  const q = String(ref).toLowerCase(), exact = nodes.filter(n => n.id === ref);
  if (exact.length) return exact[0];
  const hits = nodes.filter(n => n.id.startsWith(q) || n.title.toLowerCase().startsWith(q) || (n.data?.worktree?.branch || '').toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  throw new Error(hits.length ? `"${ref}" es ambiguo: ${hits.map(n => `${n.id.slice(0, 8)} (${n.title})`).join(', ')}` : `No hay ningún panel que coincida con "${ref}"`);
}

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (['--all', '--json', '--zones', '--dry-run'].includes(a)) out[a.slice(2)] = true;
    else if (['--by', '--gap', '--workspace', '--color'].includes(a)) { if (i + 1 >= args.length) throw new Error(`Falta el valor de ${a}\n\n${USAGE}`); out[a.slice(2)] = args[++i]; }
    else if (a.startsWith('--')) throw new Error(`Opción desconocida: ${a}\n\n${USAGE}`);
    else out._.push(a);
  }
  return out;
}
const num = (value, label) => { const n = Number(value); if (!Number.isFinite(n) || Math.abs(n) > 1e7) throw new Error(`${label} debe ser un número`); return Math.round(n); };

export function describe(n) {
  return { id: n.id.slice(0, 8), type: n.type, title: n.title, branch: n.data?.worktree?.branch || '', status: n.data?.agent?.status || '', x: n.x, y: n.y, width: n.width, height: n.height, hidden: !!n.data?.hidden, zone: n.type === 'zone' ? (n.data?.auto === 'canvas' ? 'auto' : 'manual') : '' };
}

export async function main(args = process.argv.slice(2), env = process.env, call = (method, payload) => invokeAgent(method, payload, env.PHANTOM_WORKSPACE_SOCKET || (env.PHANTOM_WORKSPACE_HOME && path.join(env.PHANTOM_WORKSPACE_HOME, 'host.sock')))) {
  const [action, ...rest] = args, opt = flags(rest), ids = opt._;
  if (!action || action === 'help' || action === '--help') return USAGE;
  const state = await call('state.get', {}), folder = path.resolve(opt.workspace || process.cwd());
  const w = state.workspaces.find(w => folder === w.canonicalPath || folder.startsWith(w.canonicalPath + path.sep)) ?? state.workspaces.find(w => w.id === state.activeWorkspaceId);
  if (!w) throw new Error('No encontré el proyecto en Phantom Workspace. Usa --workspace RUTA.');
  const nodes = w.nodes, update = (id, patch) => call('node.update', { workspaceId: w.id, id, patch });
  const need = (count, exact = true) => { if (exact ? ids.length !== count : ids.length < count) throw new Error(USAGE); };
  if (action === 'list') { const rows = nodes.filter(n => opt.all || !n.data?.hidden).map(describe); return opt.json ? rows : rows.length ? rows.map(r => `${r.id}  ${r.type.padEnd(14)} ${r.title.slice(0, 40).padEnd(40)} ${String(r.x).padStart(6)},${String(r.y).padEnd(6)} ${r.width}x${r.height}${r.branch ? `  [${r.branch}]` : ''}${r.status ? `  ${r.status}` : ''}${r.hidden ? '  (oculto)' : ''}${r.zone ? `  (zona ${r.zone})` : ''}`).join('\n') : 'No hay paneles visibles.'; }
  if (action === 'arrange') {
    const by = opt.by || 'type'; if (!['type', 'branch', 'status', 'none'].includes(by)) throw new Error('--by debe ser type, branch, status o none');
    const plan = planArrange(nodes, { by, zones: !!opt.zones, gap: opt.gap === undefined ? 48 : num(opt.gap, '--gap') });
    if (opt['dry-run']) return plan;
    for (const id of plan.removeZones) await call('node.remove', { workspaceId: w.id, id });
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const m of plan.moves) { const n = byId.get(m.id); if (n.x !== m.x || n.y !== m.y) await update(m.id, { x: m.x, y: m.y }); }
    for (const z of plan.zones) await call('node.create', { workspaceId: w.id, type: 'zone', title: z.title, x: z.x, y: z.y, width: z.width, height: z.height, data: { color: z.color, auto: 'canvas', ...(z.spaceId ? { spaceId: z.spaceId } : {}) } });
    return `Ordenados ${plan.moves.length} paneles${plan.zones.length ? ` en ${plan.zones.length} zonas` : ''}${plan.removeZones.length ? ` (quitadas ${plan.removeZones.length} zonas automáticas anteriores)` : ''}.`;
  }
  if (action === 'move') { need(3); const n = resolve(nodes, ids[0]); await update(n.id, { x: num(ids[1], 'X'), y: num(ids[2], 'Y') }); return `Movido ${n.title}.`; }
  if (action === 'resize') { need(3); const n = resolve(nodes, ids[0]), width = num(ids[1], 'ANCHO'), height = num(ids[2], 'ALTO'); if (width < 240 || height < 160) throw new Error('Tamaño mínimo 240x160'); await update(n.id, { width, height }); return `Redimensionado ${n.title}.`; }
  if (action === 'rename') { need(2); const n = resolve(nodes, ids[0]), title = ids[1].trim(); if (!title || title.length > 512) throw new Error('Título inválido'); if (n.type === 'terminal') await call('terminal.agent.update', { workspaceId: w.id, nodeId: n.id, patch: { name: title } }); else await update(n.id, { title }); return `Renombrado a ${title}.`; }
  if (action === 'hide' || action === 'show') {
    const targets = action === 'show' && opt.all ? nodes.filter(n => n.data?.hidden) : (need(1, false), ids.map(id => resolve(nodes, id)));
    for (const n of targets) await update(n.id, { data: { ...n.data, hidden: action === 'hide' } });
    return `${action === 'hide' ? 'Ocultados' : 'Mostrados'} ${targets.length} paneles.`;
  }
  if (action === 'zone') {
    need(2, false); const color = opt.color || 'iris'; if (!ZONE_COLORS.includes(color)) throw new Error(`--color: ${ZONE_COLORS.join(', ')}`);
    const picked = ids.slice(1).map(id => resolve(nodes.filter(n => n.type !== 'zone'), id)), spaces = new Set(picked.map(spaceOf));
    if (spaces.size > 1) throw new Error('Los paneles están en espacios distintos');
    const left = Math.min(...picked.map(n => n.x)) - ZONE_PAD, top = Math.min(...picked.map(n => n.y)) - ZONE_PAD - ZONE_HEADER;
    const right = Math.max(...picked.map(n => n.x + n.width)) + ZONE_PAD, bottom = Math.max(...picked.map(n => n.y + n.height)) + ZONE_PAD, spaceId = [...spaces][0];
    await call('node.create', { workspaceId: w.id, type: 'zone', title: ids[0], x: left, y: top, width: right - left, height: bottom - top, data: { color, ...(spaceId ? { spaceId } : {}) } });
    return `Zona "${ids[0]}" creada con ${picked.length} paneles.`;
  }
  if (action === 'unzone') { need(1, false); const targets = ids.map(id => resolve(nodes.filter(n => n.type === 'zone'), id)); for (const z of targets) await call('node.remove', { workspaceId: w.id, id: z.id }); return `Quitadas ${targets.length} zonas.`; }
  throw new Error(USAGE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then(value => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2)), error => { console.error(error.message); process.exitCode = 1; });
