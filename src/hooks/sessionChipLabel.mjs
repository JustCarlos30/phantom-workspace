export function sessionChipLabel({ cwd, branch, workspaceName } = {}) {
  const own = /^phantom\/terminal-/.test(String(branch || ''));
  if (own && workspaceName) return { name: workspaceName, own };
  return { name: String(cwd || '').split('/').filter(Boolean).at(-1) || 'Sesión', own };
}
