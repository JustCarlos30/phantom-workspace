// A worktree directory is named after a UUID / hex id: never a useful label.
const opaque = name => /^[0-9a-f]{8}(-[0-9a-f]{4,12}){0,4}$/i.test(name) || /^[0-9a-f]{24,}$/i.test(name);

export function sessionChipLabel({ cwd, branch, workspaceName } = {}) {
  const own = /^phantom\/terminal-/.test(String(branch || ''));
  if (own && workspaceName) return { name: workspaceName, own };
  const base = String(cwd || '').split('/').filter(Boolean).at(-1) || '';
  if (workspaceName && opaque(base)) return { name: workspaceName, own };
  return { name: base || 'Sesión', own };
}
