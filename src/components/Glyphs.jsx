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

// An open circular C monogram with a filled dot.
export function ClaudeGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M18 6A8.5 8.5 0 1 0 18 18" /><circle cx="17.5" cy="12" r="1.6" fill="currentColor" stroke="none" /></svg>;
}

// An open square frame with a solid cursor block.
export function OpenCodeGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M15 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" /><rect x="16" y="9" width="4" height="6" rx="1" fill="currentColor" stroke="none" /></svg>;
}

// A hexagonal codex module holding left-aligned lines of code.
export function CodexGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="M8.5 9.5h7M8.5 12h4.5M8.5 14.5h6" /></svg>;
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
