const PANEL_SHORTCUTS = { t: 'terminal', b: 'browser', n: 'note', z: 'zone' };

export function panelShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return null;
  return PANEL_SHORTCUTS[event.key?.toLowerCase()] || null;
}
