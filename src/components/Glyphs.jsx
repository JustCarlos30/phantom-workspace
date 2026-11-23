import React from 'react';
import TitiGhost from './TitiGhost.jsx';

// One glyph and one hue per provider, wherever it appears (mode switch, card
// identity, chat avatar). Drawn on lucide's 24px grid so they sit with the rest.
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

// Phantom's mark is Titi, the procedural ghost.
export function PhantomGlyph({ size = 20, mood = 'calm', ...props }) {
  return <PhantomFace {...props} mood={mood} size={size} still data-operation-glyph="titi" />;
}

export function PhantomFace({ mood = 'calm', size = 30, className = '', ...props }) {
  return <TitiGhost {...props} mood={mood} size={size} className={`phantom-face titi-ghost is-${mood} ${className}`} data-mood={mood} />;
}

// A radial burst of eight uneven rays, after Anthropic's spark.
export function ClaudeGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M12 2.5v6.5M12 15v6.5M2.5 12H9M15 12h6.5M5.3 5.3 9.4 9.4M14.6 14.6l4.1 4.1M18.7 5.3l-4.1 4.1M9.4 14.6l-4.1 4.1" /></svg>;
}

// A terminal frame with a prompt chevron and cursor.
export function OpenCodeGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m7.5 9.5 3 2.5-3 2.5M13 15h3.5" /></svg>;
}

// A hexagonal bloom: three interlaced rounded petals inside a hexagon.
export function CodexGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4Z" /><path d="M12 7.5v4.5l-3.9 2.25M12 12l3.9 2.25" /></svg>;
}

export function ShellGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
}

// A diamond with a central dot for an unidentified agent process.
export function AgentGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M12 3l9 9-9 9-9-9Z" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></svg>;
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
