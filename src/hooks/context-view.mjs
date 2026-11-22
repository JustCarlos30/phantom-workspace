export function pinnedRef(contextRefs, path) {
  if (typeof path !== 'string' || !path) return null;
  return (Array.isArray(contextRefs) ? contextRefs : []).find(ref => ref && (ref.path === path || ref.ref?.path === path)) || null;
}

export function readerKind(path) {
  return typeof path === 'string' && /\.(md|markdown)$/i.test(path) ? 'markdown' : 'code';
}

export function emptyMessage(tab, query) {
  const text = typeof query === 'string' ? query.trim() : '';
  if (text) return `Sin resultados para “${text}”.`;
  return tab === 'decisions' ? 'Aún no hay decisiones. Declara la primera para que los agentes la recuerden.' : 'Este proyecto no tiene documentos Markdown.';
}

export function compactionBlocked(chat, connected = true) {
  if (!connected || !chat) return 'Conecta con el host para consultar la compactación.';
  if (!['opencode', 'codex'].includes(chat.provider)) return 'Compactación explícita no integrada para este proveedor; el historial se conserva.';
  if (chat.running) return 'Espera a que termine la operación en curso.';
  if (chat.queue?.length) return 'Resuelve la cola antes de compactar o abrir otra sesión.';
  if (!chat.sessionId) return 'Primero inicia una conversación con este proveedor.';
  return '';
}
