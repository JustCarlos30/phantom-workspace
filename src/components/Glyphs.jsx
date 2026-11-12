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
  return <svg width={size} height={size} {...base} {...props}><path d="m12 2 .4 6.2M17 3.4l-2.7 5.2M21 7l-5.7 3M22 12l-6.2.3M20.4 17l-5.1-2.7M17 21l-3-5.7M12 22l-.4-6.2M7 20.6l2.7-5.2M3 17l5.7-3M2 12l6.2-.3M3.6 7l5.1 2.7M7 3l3 5.7" /></svg>;
}

export function OpenCodeGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M5 3.5h14v17H5z" /><path d="M5 8h14" opacity=".5" /><path d="M10 12h5v5h-5z" fill="currentColor" stroke="none" /></svg>;
}

// A rounded hexagon holding a code caret: distinct from the shell's prompt box.
export function CodexGlyph({ size = 14, ...props }) {
  return <svg width={size} height={size} {...base} {...props}><path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4Z" /><path d="m9.6 9.6-2.4 2.4 2.4 2.4M14.4 9.6l2.4 2.4-2.4 2.4" /></svg>;
}

const GLYPHS = { claude: ClaudeGlyph, opencode: OpenCodeGlyph, codex: CodexGlyph, agent: Cpu, shell: Terminal };

// Maps a provider id or a detected process name to its identity key.
export function providerKey(name, kind = 'shell') {
  const value = String(name || '').toLowerCase();
  if (value.includes('claude')) return 'claude';
  if (value.includes('opencode')) return 'opencode';
  if (value.includes('codex')) return 'codex';
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
