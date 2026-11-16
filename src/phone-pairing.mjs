import qrcode from 'qrcode-generator';

export function buildAppPairingPayload({ bootstrap, code }) {
  return JSON.stringify({ t: 'phantom-pair', v: 1, b: bootstrap, c: code });
}

export function parseAppPairingPayload(text) {
  try {
    const value = JSON.parse(text);
    if (value?.t !== 'phantom-pair' || value.v !== 1 || !value.b ||
        new URL(value.b.url).protocol !== 'https:' ||
        typeof value.b.fingerprint !== 'string' || !value.b.fingerprint.trim() ||
        typeof value.c !== 'string' || !value.c.trim()) throw new Error();
    return { bootstrap: value.b, code: value.c };
  } catch { throw new Error('Código QR de vinculación no válido: requiere HTTPS, huella y código.'); }
}

export const buildBrowserPairingUrl = (url, code) => `${url}#pair=${encodeURIComponent(code)}`;
export const readBrowserPairingCode = hash => new URLSearchParams(hash.replace(/^#/, '')).get('pair') || '';

export function qrMatrix(text) {
  try {
    const qr = qrcode(0, 'M');
    qrcode.stringToBytes = value => Array.from(new TextEncoder().encode(value));
    qr.addData(text, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    return { size, modules: Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => qr.isDark(y, x))) };
  } catch { throw new Error('Los datos de vinculación no caben en un código QR.'); }
}
