import React from 'react';

// One glyph and one hue per provider, wherever it appears (mode switch, card
// identity, chat avatar). Drawn on lucide's 24px grid so they sit with the rest.
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

// A compact angular Phantom mark: pointed silhouette, two cut-in eyes.
export function PhantomGlyph({ size = 20, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M4 4l5 3h6l5-3-1 11-7 5-7-5Z" /><path d="m7.5 11 3 1.5M16.5 11l-3 1.5" /></svg>;
}

// The same mark with a mood: the one character in the app, living in the
// activity notch. Only the eyes and the grin change, and only with real state.
//   asleep  host disconnected          eyes shut
//   unsure  readings stale or failing  one eye shut
//   calm    nothing needs you          the brand mark; blinks now and then
//   grin    something needs you        eyes lit, and it grins
export function PhantomFace({ mood = 'calm', size = 16, ...props }) {
  const eyes = {
    asleep: <path d="M7.5 12h3M13.5 12h3" />,
    unsure: <path d="m7.5 11 3 1.5M13.5 12.2h3" />,
    calm: <path d="m7.5 11 3 1.5M16.5 11l-3 1.5" />,
    grin: <path d="M7.2 10.2l3.6 1.9-3.1.9ZM16.8 10.2l-3.6 1.9 3.1.9Z" fill="currentColor" />,
  }[mood] || null;
  return <svg width={size} height={size} {...base} className={`phantom-face is-${mood}`} {...props}>
    <path d="M4 4l5 3h6l5-3-1 11-7 5-7-5Z" />
    <g className="phantom-face-eyes">{eyes}</g>
    {mood === 'grin' && <path className="phantom-face-grin" d="M9 15.4c1.9 1.1 4.1 1.1 6 0" />}
  </svg>;
}

export function ClaudeGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /></svg>;
}

export function OpenCodeGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" stroke="none" /></svg>;
}

// A rounded hexagon holding a code caret: distinct from the shell's prompt box.
export function CodexGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m9.5 9-3 3 3 3M14.5 9l3 3-3 3" /></svg>;
}

export function ShellGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
}

export function AgentGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" /></svg>;
}

const GLYPHS = { claude: ClaudeGlyph, opencode: OpenCodeGlyph, codex: CodexGlyph, agent: AgentGlyph, shell: ShellGlyph };

// Maps a provider id or a detected process name to its identity key.
export function providerKey(name, kind = 'shell') {
  const value = String(name || '').toLowerCase();
  if (value.includes('claude')) return 'claude';
  if (value.includes('opencode')) return 'opencode';
  if (value.includes('codex')) return 'codex';
  return kind === 'agent' ? 'agent' : 'shell';
}

export function ProviderGlyph({ provider = 'shell', size = 14 }) {
  const Icon = GLYPHS[provider] || ShellGlyph;
  return <Icon size={size} aria-hidden="true" />;
}

// The glyph on its tinted tile; sized in em so it scales with the card label.
export function ProviderTile({ provider = 'shell' }) {
  return <span className="pt-glyph" data-provider={provider} aria-hidden="true"><ProviderGlyph provider={provider} /></span>;
}
