// Fold a host `chat.update` into the loaded conversation: messages are
// upserted by ID, so a streamed reply simply replaces its previous version.
export function mergeChat(chat, event) {
  if (!chat || event.provider !== chat.provider) return chat;
  const messages = [...chat.messages];
  for (const message of event.messages || []) {
    const index = messages.findIndex(m => m.id === message.id);
    if (index >= 0) messages[index] = message; else messages.push(message);
  }
  return { ...chat, running: event.running, meta: event.meta ?? chat.meta, messages, queue: event.queue ?? chat.queue ?? [] };
}

// Compact readings for the card's status line. Values come from the provider;
// nothing here estimates.
export function formatTokens(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1e6) return `${+(value / 1e6).toFixed(value % 1e6 ? 1 : 0)}M`;
  if (value >= 1e3) return `${+(value / 1e3).toFixed(value >= 1e5 ? 0 : 1)}k`;
  return String(Math.round(value));
}
export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '';
  const seconds = milliseconds / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}
// A running clock counts whole seconds; tenths would only flicker.
export function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor((Number.isFinite(milliseconds) ? milliseconds : 0) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
export function formatCost(usd) {
  if (!Number.isFinite(usd)) return '';
  return usd < .01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}
export function contextUse(meta) {
  if (!Number.isFinite(meta?.contextTokens) || meta.contextTokens <= 0) return null;
  const window = Number.isFinite(meta.contextWindow) && meta.contextWindow > 0 ? meta.contextWindow : null;
  return { tokens: meta.contextTokens, window, ratio: window ? meta.contextTokens / window : null };
}

// Quality/cost bands for a conversation's context. Every turn resends the whole
// context, so cost per turn grows with it, and long-context studies (context
// rot, lost-in-the-middle) show precision falling well before the window is
// full. With a known window the bands are shares of it; without one they fall
// back to absolute sizes where most models already degrade.
export const CONTEXT_BANDS = { watch: .4, compact: .7 };
export const CONTEXT_TOKEN_BANDS = { watch: 60_000, compact: 120_000 };
export function contextAdvice(use) {
  if (!use) return null;
  const by = use.ratio != null ? use.ratio : null;
  const band = by != null
    ? by >= CONTEXT_BANDS.compact ? 'compact' : by >= CONTEXT_BANDS.watch ? 'watch' : 'ok'
    : use.tokens >= CONTEXT_TOKEN_BANDS.compact ? 'compact' : use.tokens >= CONTEXT_TOKEN_BANDS.watch ? 'watch' : 'ok';
  const copy = {
    ok: ['Zona óptima', 'Hay margen: el modelo atiende bien todo el historial y cada turno sigue siendo barato.'],
    watch: ['Conviene compactar pronto', 'La precisión empieza a bajar y cada turno reenvía más tokens. Compacta al cerrar la subtarea actual.'],
    compact: ['Compacta ahora', 'Con este volumen el modelo pierde detalles del medio del historial y cada turno cuesta varias veces más que al inicio.'],
  }[band];
  return { band, title: copy[0], hint: copy[1] };
}
