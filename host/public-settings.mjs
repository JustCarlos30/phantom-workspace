// Output projection only: private settings remain available to host integrations.
// Names cannot identify arbitrary secrets stored under otherwise public keys.
const sensitiveName = /(secret|token|password|credential|authorization|api.?key)/i;
const normalizedSensitiveName = /(secret|token|password|credential|authorization|apikey|privatekey|signingkey|passphrase)/;

export function publicSettings(value) {
  if (Array.isArray(value)) return value.map(publicSettings);
  if (value === null || typeof value !== 'object') return value;
  // fromEntries creates own data properties, including __proto__, without setters.
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sensitiveName.test(key) && !normalizedSensitiveName.test(key.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .map(([key, child]) => [key, publicSettings(child)]));
}

export function portableSettings(settings) {
  return Object.fromEntries(Object.entries(settings).filter(([key, value]) => {
    if (key === 'theme' || key === 'language') return typeof value === 'string';
    if (key === 'fontSize' || key === 'terminalFontSize') return Number.isFinite(value) && value > 0;
    return false;
  }));
}
