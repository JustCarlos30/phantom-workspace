import React, { useRef } from 'react';
import gengarIcon from '../../assets/gengar-icon.png';
import { useSpriteMotion } from './GengarMascot.jsx';

// One glyph and one hue per provider, wherever it appears (mode switch, card
// identity, chat avatar). Drawn on lucide's 24px grid so they sit with the rest.
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

// A compact angular Phantom mark: pointed silhouette, two cut-in eyes.
export function PhantomGlyph({ size = 20, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M4 4l5 3h6l5-3-1 11-7 5-7-5Z" /><path d="m7.5 11 3 1.5M16.5 11l-3 1.5" /></svg>;
}

// Kept as the shared identity API; always uses the native, unscaled icon.
export function PhantomFace({ mood = 'calm', size: _size, className = '', ...props }) {
  const ref = useRef(null);
  const moving = useSpriteMotion(ref);
  return <img {...props} ref={ref} src={gengarIcon} width="40" height="30" alt="" aria-hidden="true" draggable="false" className={`phantom-face gengar-icon is-${mood} ${className}`} data-mood={mood} data-motion={moving ? 'running' : 'stopped'} />;
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
