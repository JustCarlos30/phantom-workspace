import React from 'react';

// One glyph and one hue per provider, wherever it appears (mode switch, card
// identity, chat avatar). Drawn on lucide's 24px grid so they sit with the rest.
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

// A compact angular Phantom mark: pointed silhouette, two cut-in eyes.
export function PhantomGlyph({ size = 20, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M4 4l5 3h6l5-3-1 11-7 5-7-5Z" /><path d="m7.5 11 3 1.5M16.5 11l-3 1.5" /></svg>;
}

// Gengar's ears, crown, slanted eyes and toothy smile share a native SVG grid.
// ActivityNotch owns the mood; the drawing never invents activity.
export function PhantomFace({ mood = 'calm', size = 24, ...props }) {
  const eyes = {
    asleep: <path d="m5.5 12 4 1m5 0 4-1" />,
    unsure: <><path d="m5 10 5.5 2.5L6 14Z" fill="currentColor" /><path d="m14 13 4.5-.5" /></>,
    calm: <><path d="m5 10.5 5.5 2L6 14Zm14 0-5.5 2L18 14Z" fill="currentColor" /><path className="phantom-face-pupils" d="m7.5 12 .3 1.3m8.7-1.3-.3 1.3" /></>,
    working: <><path d="m5 11 5.5 1.5L6 14Zm14 0-5.5 1.5L18 14Z" fill="currentColor" /><path className="phantom-face-pupils" d="M8 12v1.4m8-1.4v1.4" /></>,
    grin: <><path d="m4.8 9.5 5.7 2.5L6 14Zm14.4 0L13.5 12l4.5 2Z" fill="currentColor" /><path className="phantom-face-pupils" d="M7.5 11.5V13m9-1.5V13" /></>,
  }[mood] || null;
  return <svg width={size} height={size} {...base} focusable="false" strokeWidth=".85" strokeLinejoin="miter" className={`phantom-face is-${mood}`} data-mood={mood} {...props}>
    <path className="phantom-face-shell" d="M3.5 10 2 2.5l5.5 4L9 5l2 1 1-3 2 3 2-1 1 1.5 5-4-1.5 7.5 2 3-2 1 .5 2-2 1.5C17 22 7 22 5 17.5L2.5 16l.5-2-2-1Z" />
    <path className="phantom-face-ear" d="m3.5 5 1 4 2-1.5Zm17 0-1 4-2-1.5Z" fill="var(--gengar-outline, #34253f)" stroke="none" />
    <g className="phantom-face-eyes">{eyes}</g>
    {mood === 'grin' && <path className="phantom-face-brow" d="m5 8 5 2m4 0 5-2" fill="none" />}
    {mood === 'asleep' || mood === 'unsure'
      ? <path d={mood === 'asleep' ? 'M8 17h8' : 'm7 17 5-.5 5 1'} />
      : <><path className="phantom-face-grin" d="M5.5 14.8Q12 18 18.5 14.8Q17 20 12 20T5.5 14.8Z" fill="var(--gengar-tooth, #d9cfe3)" stroke="var(--gengar-outline, #34253f)" /><path d="m9 16 .5 3.5M15 16l-.5 3.5M12 16.7V20" stroke="var(--gengar-outline, #34253f)" /></>}
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
