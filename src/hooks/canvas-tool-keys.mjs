// Herramienta del canvas resultante de una tecla, o null si la tecla no cambia nada.
// C alterna comentario/selector, V selecciona (también en enfoque), H solo fuera de enfoque.
export function toolForKey(e, { tool, focused = false, editable = false } = {}) {
  if (editable || e.ctrlKey || e.metaKey || e.altKey || typeof e.key !== 'string') return null;
  const key = e.key.toLowerCase();
  if (key === 'c') return tool === 'comment' ? 'select' : 'comment';
  if (key === 'v') return 'select';
  if (key === 'h' && !focused) return 'hand';
  return null;
}
