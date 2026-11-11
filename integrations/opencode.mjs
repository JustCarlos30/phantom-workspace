import { realpath } from 'node:fs/promises';
import { workspaceRoot, jsonCommand, command, observedAt } from './common.mjs';

// Read-only catalog. A directory match establishes scope, not PTY ownership or activity.
export async function opencodeSessions(payload, context) {
  const { workspace, root } = await workspaceRoot(context, payload);
  const roots = new Set([root]);
  try {
    const { stdout } = await command(context, 'git', ['--no-optional-locks','worktree','list','--porcelain','-z'], { cwd: root });
    for (const entry of stdout.split('\0')) if (entry.startsWith('worktree ')) {
      try { roots.add(await realpath(entry.slice(9))); } catch { /* Removed tree. */ }
    }
  } catch { /* Plain folder. */ }
  try {
    const rows = await jsonCommand(context, context.state?.settings?.opencodePath || 'opencode', ['session','list','--format','json','--max-count','1000'], { cwd: root });
    if (!Array.isArray(rows)) throw new Error('OpenCode devolvió un catálogo inválido');
    const items = [];
    for (const row of rows) {
      if (typeof row.id !== 'string' || !/^ses_[a-zA-Z0-9]+$/.test(row.id) || typeof row.directory !== 'string') continue;
      try {
        if (roots.has(await realpath(row.directory))) items.push({ id: row.id, title: String(row.title || row.id).slice(0,512), directory: row.directory, updated: row.updated });
      } catch { /* Inaccessible session folder. */ }
    }
    return { available: true, items, workspaceId: workspace.id, observedAt: observedAt(), limit: 1000 };
  } catch (error) { return { available: false, items: [], reason: `OpenCode no disponible: ${error.message}`, observedAt: observedAt() }; }
}
