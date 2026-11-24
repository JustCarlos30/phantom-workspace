export function keyboardInitFromBrowserEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || event.type !== 'browser.key') return null;
  const { key, code, ctrlKey, altKey, shiftKey, metaKey } = event;
  if (typeof key !== 'string' || !key.length || key.length > 32 ||
      typeof code !== 'string' || !code.length || code.length > 32 ||
      [ctrlKey, altKey, shiftKey, metaKey].some(value => typeof value !== 'boolean')) return null;
  if (!(ctrlKey || altKey || metaKey) || (ctrlKey && altKey && !metaKey) ||
      ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(key)) return null;
  return { key, code, ctrlKey, altKey, shiftKey, metaKey };
}
