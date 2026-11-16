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
  if (!['claude:request-v1', 'opencode:request-v1', 'codex:request-v1'].includes(meta?.contextSource) || !Number.isFinite(meta?.contextTokens) || meta.contextTokens <= 0) return null;
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
// Large windows (1M) make shares misleading: precision drops with absolute
// length, so a known window is also capped by size and the worse band wins.
export const CONTEXT_SIZE_CAPS = { watch: 150_000, compact: 300_000 };
const bandOf = (value, limits) => value >= limits.compact ? 'compact' : value >= limits.watch ? 'watch' : 'ok';
export function contextAdvice(use) {
  if (!use) return null;
  const rank = { ok: 0, watch: 1, compact: 2 };
  let band, cause;
  if (use.ratio == null) { band = bandOf(use.tokens, CONTEXT_TOKEN_BANDS); cause = 'size'; }
  else {
    const byShare = bandOf(use.ratio, CONTEXT_BANDS), bySize = bandOf(use.tokens, CONTEXT_SIZE_CAPS);
    cause = rank[bySize] > rank[byShare] ? 'size' : 'share';
    band = cause === 'size' ? bySize : byShare;
  }
  const copy = {
    ok: ['Hay margen', 'El agente recuerda bien toda la conversación.'],
    watch: ['Empieza a alargarse', 'Cada turno ya cuesta más. Al cerrar esta tarea, empieza una conversación nueva.'],
    compact: ['Conversación muy larga', 'El agente empieza a olvidar detalles y cada turno sale caro. Empieza una conversación nueva.'],
  }[band];
  return { band, cause, title: copy[0], hint: copy[1] };
}

// A friendly heads-up when the conversation crosses into a costlier band.
// `dismissed` is the highest band rank the user already waved off: the nudge
// only returns when the context climbs past it. Figures are the provider's.
export const BAND_RANK = { ok: 0, watch: 1, compact: 2 };
export function nudgeDismissal(previous, rank) {
  return rank == null ? previous : Math.min(previous, rank);
}
export function contextNudge(use, dismissed = 0) {
  const advice = contextAdvice(use);
  if (!advice || BAND_RANK[advice.band] <= dismissed) return null;
  // When size, not share, raised the band, the share would read as reassuring.
  const where = use.window && advice.cause === 'share' ? `${Math.round(use.ratio * 100)}% del contexto` : `${formatTokens(use.tokens)} tokens de contexto`;
  const resend = `Cada mensaje reenvía ${formatTokens(use.tokens)} tokens`;
  return advice.band === 'compact'
    ? { band: 'compact', rank: 2, title: `Vas en ${where}`, body: `${resend} y el agente puede olvidar detalles. Conviene empezar una conversación nueva.` }
    : { band: 'watch', rank: 1, title: `Vas en ${where}`, body: `${resend}. Al cerrar esta tarea, empieza una conversación nueva.` };
}
