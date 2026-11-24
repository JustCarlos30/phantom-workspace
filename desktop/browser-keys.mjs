export function forwardableKey(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.type !== 'keyDown') return null;
  const { key, code, control, alt, shift, meta } = input;
  if (typeof key !== 'string' || !key.length || key.length > 32 ||
      typeof code !== 'string' || !code.length || code.length > 32 ||
      [control, alt, shift, meta].some(value => typeof value !== 'boolean')) return null;
  if (!(control || alt || meta) || (control && alt && !meta) ||
      ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(key)) return null;
  return { key, code, ctrlKey: control, altKey: alt, shiftKey: shift, metaKey: meta };
}
