import React from 'react';
import { Cpu, Terminal } from 'lucide-react';

// One glyph and one hue per provider, wherever it appears (mode switch, card
// identity, chat avatar). Drawn on lucide's 24px grid so they sit with the rest.
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

// A compact angular Phantom mark: pointed silhouette, two cut-in eyes.
export function PhantomGlyph({ size = 20, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M4 4l5 3h6l5-3-1 11-7 5-7-5Z" /><path d="m7.5 11 3 1.5M16.5 11l-3 1.5" /></svg>;
}

export function ClaudeGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" /></svg>;
}

export function OpenCodeGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9.5 12.5h5v4h-5z" fill="currentColor" stroke="none" /></svg>;
}

const GLYPHS = { claude: ClaudeGlyph, opencode: OpenCodeGlyph, agent: Cpu, shell: Terminal };

// Maps a provider id or a detected process name to its identity key.
export function providerKey(name, kind = 'shell') {
  const value = String(name || '').toLowerCase();
  if (value.includes('claude')) return 'claude';
  if (value.includes('opencode')) return 'opencode';
  return kind === 'agent' ? 'agent' : 'shell';
}

export function ProviderGlyph({ provider = 'shell', size = 14 }) {
  const Icon = GLYPHS[provider] || Terminal;
  return <Icon size={size} aria-hidden="true" />;
}

// The glyph on its tinted tile; sized in em so it scales with the card label.
export function ProviderTile({ provider = 'shell' }) {
  return <span className="pt-glyph" data-provider={provider} aria-hidden="true"><ProviderGlyph provider={provider} /></span>;
}
