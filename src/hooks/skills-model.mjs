import { tableStartsAt, parseTable } from './markdownTable.mjs';
// Pure model for the Skills catalog panel (shared by renderer and node tests).
// Three origins, one vocabulary. Labels always accompany the color.
export const ORIGINS = {
  project: { label: 'Proyecto', hint: 'Skills dentro de esta carpeta' },
  worktree: { label: 'En ramas', hint: 'Skills nuevas o modificadas en el worktree de una terminal que aún no están en la carpeta del proyecto' },
  phantom: { label: 'Phantom · MCP', hint: 'Catálogo nativo de Phantom, el mismo que exponen sus herramientas MCP' },
  installed: { label: 'Instaladas', hint: 'Claude Code, plugins, Codex, OpenCode y agentes compartidos' },
};
export const ORDER = ['project', 'worktree', 'phantom', 'installed'];
export const DRIFT = { new: 'Nueva en esta rama', modified: 'Modificada en esta rama' };

export const textOf = value => typeof value === 'string' ? value : '';
export const bytes = size => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

export function phantomEntry(item) {
  const ref = item.ref || item.raw?.ref || {};
  const id = ref.id || item.id;
  return {
    id: `phantom:${ref.scope || ''}:${id}:${ref.version || ''}`, phantomId: id, ref: item.ref || item.raw?.ref || null,
    name: id, description: textOf(item.raw?.description) || (item.title !== id ? textOf(item.title) : ''),
    version: ref.version || item.revision || null, origin: 'phantom', agent: 'Phantom',
    group: ref.scope === 'global' ? 'Phantom · globales' : ref.scope ? 'Phantom · proyecto' : 'Phantom',
    scope: ref.scope || null, folders: [], fileCount: (item.raw?.resources || []).length,
  };
}

// Pure filtering/grouping so it can be tested without a renderer.
export function buildCatalog(entries, { origin = 'all', agent = 'all', query = '' } = {}) {
  const text = query.trim().toLowerCase();
  const copies = new Map();
  for (const entry of entries) copies.set(entry.name.toLowerCase(), [...(copies.get(entry.name.toLowerCase()) || []), entry]);
  const visible = entries.filter(entry => (origin === 'all' || entry.origin === origin) && (agent === 'all' || entry.agent === agent)
    && (!text || `${entry.name}\n${entry.description}\n${entry.group}\n${entry.agent}\n${entry.branch || ''}`.toLowerCase().includes(text)));
  const groups = [];
  for (const key of ORDER) {
    const byGroup = new Map();
    for (const entry of visible.filter(item => item.origin === key)) byGroup.set(entry.group, [...(byGroup.get(entry.group) || []), entry]);
    for (const [title, items] of byGroup) groups.push({ origin: key, title, items: items.sort((a, b) => a.name.localeCompare(b.name)) });
  }
  const counts = Object.fromEntries(ORDER.map(key => [key, entries.filter(entry => entry.origin === key).length]));
  const agents = [...new Set(entries.map(entry => entry.agent))].sort();
  return { groups, counts, agents, total: entries.length, visible: visible.length, copiesOf: entry => (copies.get(entry.name.toLowerCase()) || []).filter(other => other.id !== entry.id) };
}


// Markdown block parser used by Markdown.jsx.
const MAX_LINES = 2500;

export function parseBlocks(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_LINES);
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') }); continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, '') }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: 'rule' }); i++; continue; }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', children: parseBlocks(body.join('\n')) }); continue;
    }
    if (tableStartsAt(lines, i)) { const { block, next } = parseTable(lines, i); blocks.push(block); i = next; continue; }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]), items = [];
      while (i < lines.length) {
        const current = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (current) { items.push({ depth: Math.min(3, Math.floor(current[1].length / 2)), text: current[3] }); i++; }
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items.at(-1).text += ` ${lines[i].trim()}`; i++; }
        else break;
      }
      blocks.push({ type: 'list', ordered, items }); continue;
    }
    const body = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*(```|~~~)|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) body.push(lines[i++].trim());
    blocks.push({ type: 'paragraph', text: body.join(' ') });
  }
  return blocks;
}

