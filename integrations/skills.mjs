// Read-only discovery of filesystem skills (SKILL.md) for the project folder and
// the agent installations of this user. Phantom-native skills stay with the
// Phantom integration; the renderer merges both catalogs.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_DEPTH = 4, MAX_PER_ROOT = 400, MAX_SKILL_BYTES = 512 * 1024, MAX_FILES = 200;
const SKIP = new Set(['node_modules', '.git', '.venv', '__pycache__', 'dist', 'out']);

async function exists(target) { try { await fs.access(target); return true; } catch { return false; } }
async function readJSON(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }

// Every root carries its origin so the UI can group and explain it.
export async function skillRoots({ workspacePath, home = os.homedir() } = {}) {
  const roots = [];
  const add = (dir, origin, agent, label, extra = {}) => roots.push({ dir, origin, agent, label, ...extra });
  if (workspacePath) {
    for (const [rel, agent] of [['.claude/skills', 'Claude Code'], ['.agents/skills', 'Agentes'], ['.codex/skills', 'Codex'], ['.opencode/skill', 'OpenCode'], ['.opencode/skills', 'OpenCode'], ['skills', 'Carpeta']]) {
      add(path.join(workspacePath, rel), 'project', agent, `${rel}`);
    }
  }
  add(path.join(home, '.claude/skills'), 'installed', 'Claude Code', 'Claude Code · usuario');
  const installed = await readJSON(path.join(home, '.claude/plugins/installed_plugins.json'));
  for (const [key, entries] of Object.entries(installed?.plugins || {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (typeof entry?.installPath !== 'string' || !path.isAbsolute(entry.installPath)) continue;
      const [plugin, marketplace] = key.split('@');
      add(path.join(entry.installPath, 'skills'), 'installed', 'Claude Code', `Plugin ${plugin}${entry.version ? ` ${entry.version}` : ''}`, { plugin, marketplace, pluginVersion: entry.version });
    }
  }
  add(path.join(home, '.agents/skills'), 'installed', 'Agentes', 'Agentes · compartidas');
  add(path.join(home, '.codex/skills'), 'installed', 'Codex', 'Codex · usuario');
  try {
    for (const market of await fs.readdir(path.join(home, '.codex/plugins/cache'), { withFileTypes: true })) {
      if (!market.isDirectory()) continue;
      for (const plugin of await fs.readdir(path.join(home, '.codex/plugins/cache', market.name), { withFileTypes: true })) {
        if (plugin.isDirectory()) add(path.join(home, '.codex/plugins/cache', market.name, plugin.name), 'installed', 'Codex', `Plugin Codex ${plugin.name}`, { plugin: plugin.name, marketplace: market.name });
      }
    }
  } catch { /* No Codex plugins installed. */ }
  for (const rel of ['.config/opencode/skill', '.config/opencode/skills']) add(path.join(home, rel), 'installed', 'OpenCode', 'OpenCode · usuario');
  return roots;
}

async function findSkillFiles(dir, depth = 0, found = []) {
  if (depth > MAX_DEPTH || found.length >= MAX_PER_ROOT) return found;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return found; }
  if (entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')) { found.push(path.join(dir, 'SKILL.md')); return found; }
  for (const entry of entries) {
    if (found.length >= MAX_PER_ROOT) break;
    if ((entry.isDirectory() || entry.isSymbolicLink()) && !SKIP.has(entry.name)) {
      const child = path.join(dir, entry.name);
      try { if ((await fs.stat(child)).isDirectory()) await findSkillFiles(child, depth + 1, found); } catch { /* Broken link. */ }
    }
  }
  return found;
}

const unquote = value => {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1).replace(/\\"/g, '"');
  return v;
};
// Minimal frontmatter reader: scalars, quoted strings, folded/literal blocks and
// one nesting level (metadata.version). Unknown structure is ignored, never executed.
export function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { meta: {}, body: source };
  const meta = {}, lines = match[1].split(/\r?\n/);
  let parent = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line), nested = /^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (top) {
      const [, key, raw] = top;
      if (raw === '' ) { parent = key; meta[key] ??= {}; continue; }
      parent = null;
      if (/^[>|][-+]?$/.test(raw)) {
        const block = [];
        while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i].trim());
        meta[key] = raw.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
      } else meta[key] = unquote(raw);
    } else if (nested && parent && typeof meta[parent] === 'object') meta[parent][nested[1]] = unquote(nested[2]);
    else if (/^\s+-\s+/.test(line) && parent) { meta[parent] = Array.isArray(meta[parent]) ? meta[parent] : []; meta[parent].push(unquote(line.replace(/^\s+-\s+/, ''))); }
  }
  return { meta, body: source.slice(match[0].length) };
}

async function listFiles(dir, base = dir, depth = 0, files = []) {
  if (depth > 3 || files.length >= MAX_FILES) return files;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= MAX_FILES || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(full, base, depth + 1, files);
    else if (entry.isFile() && full !== path.join(base, 'SKILL.md')) {
      let size = 0; try { size = (await fs.stat(full)).size; } catch { /* Removed meanwhile. */ }
      files.push({ path: path.relative(base, full), size });
    }
  }
  return files;
}

const text = value => typeof value === 'string' ? value : '';
async function describe(file, root) {
  const handle = await fs.open(file, 'r');
  let head;
  try { const buffer = Buffer.alloc(16 * 1024); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); head = buffer.subarray(0, bytesRead).toString('utf8'); }
  finally { await handle.close(); }
  const { meta } = parseFrontmatter(head);
  const dir = path.dirname(file), metadata = meta.metadata && typeof meta.metadata === 'object' ? meta.metadata : {};
  const files = await listFiles(dir);
  // Nested bundles under a user root (synced/<id>/x, superset/skills/x) form their own group.
  const segments = path.relative(root.dir, dir).split(path.sep);
  let group = root.label;
  if (segments.length > 1 && root.label.endsWith('· usuario')) {
    group = segments[0] === 'synced' ? `${root.agent} · sincronizadas` : `${root.agent} · paquete ${segments[0]}`;
  }
  return {
    id: file, name: text(meta.name) || path.basename(dir), description: text(meta.description),
    version: text(meta.version) || text(metadata.version) || null,
    allowedTools: text(meta['allowed-tools']) || null,
    origin: root.origin, agent: root.agent, group,
    plugin: root.plugin || null, marketplace: root.marketplace || null,
    path: dir, relative: path.relative(root.dir, dir) || path.basename(dir),
    fileCount: files.length, folders: [...new Set(files.filter(item => item.path.includes(path.sep)).map(item => item.path.split(path.sep)[0]))],
  };
}

export async function skillsCatalog(payload, context) {
  const workspace = context.workspace;
  if (!workspace) throw new Error('Workspace not found');
  const roots = await skillRoots({ workspacePath: workspace.canonicalPath || workspace.path, home: context.home });
  const seen = new Set(), items = [], scanned = [];
  for (const root of roots) {
    if (!await exists(root.dir)) continue;
    let real; try { real = await fs.realpath(root.dir); } catch { continue; }
    const files = await findSkillFiles(real);
    scanned.push({ dir: root.dir, origin: root.origin, agent: root.agent, label: root.label, count: files.length, truncated: files.length >= MAX_PER_ROOT });
    for (const file of files) {
      if (seen.has(file)) continue; seen.add(file);
      try { items.push(await describe(file, { ...root, dir: real })); } catch { /* Unreadable skill is skipped, root still listed. */ }
    }
  }
  return { items, roots: scanned, observedAt: new Date().toISOString() };
}

export async function skillsRead(payload, context) {
  if (typeof payload.id !== 'string' || !path.isAbsolute(payload.id) || path.basename(payload.id) !== 'SKILL.md') throw new Error('Invalid skill reference');
  // Authorize against a fresh catalog: only discovered SKILL.md files are readable.
  const catalog = await skillsCatalog({}, context);
  const item = catalog.items.find(entry => entry.id === payload.id);
  if (!item) throw new Error('Skill not found in this catalog');
  const stat = await fs.stat(item.id);
  const handle = await fs.open(item.id, 'r');
  let source;
  try { const buffer = Buffer.alloc(Math.min(stat.size, MAX_SKILL_BYTES)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); source = buffer.subarray(0, bytesRead).toString('utf8'); }
  finally { await handle.close(); }
  const { meta, body } = parseFrontmatter(source);
  return { ...item, meta, body, truncated: stat.size > MAX_SKILL_BYTES, size: stat.size, files: await listFiles(item.path), observedAt: new Date().toISOString() };
}
