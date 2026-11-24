import qrcode from 'qrcode-generator';

const prefix = 'phantom-pair:v2:';
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const invalid = () => new Error('Código QR de vinculación no válido: requiere IPv4 HTTPS, huella, código y caducidad futura de hasta 120 s.');
function validateExpiry(expiresAt, now) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 120000 || expiresAt > 281474976710655) throw invalid();
}

export function buildAppPairingPayload({ bootstrap, code, expiresAt, now = Date.now() }) {
  try {
    validateExpiry(expiresAt, now);
    const match = /^https:\/\/((?:\d{1,3}\.){3}\d{1,3})(?::([0-9]+))?\/?$/.exec(bootstrap.url);
    if (!match) throw invalid();
    const ip = match[1].split('.').map(Number), port = Number(match[2] ?? 443);
    if (ip.some((value, index) => value > 255 || String(value) !== match[1].split('.')[index]) || !Number.isInteger(port) || port < 1 || port > 65535) throw invalid();
    const raw = bootstrap.fingerprint;
    const fingerprint = typeof raw === 'string' && /^(?:[\da-fA-F]{2}:){31}[\da-fA-F]{2}$/.test(raw) ? raw.replace(/:/g, '').toLowerCase() : raw;
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || typeof code !== 'string' || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(code)) throw invalid();
    const bytes = new Uint8Array(76);
    bytes.set(ip); new DataView(bytes.buffer).setUint16(4, port);
    bytes.set(fingerprint.match(/../g).map(hex => parseInt(hex, 16)), 6);
    bytes.set(decode(code), 38);
    let expiry = expiresAt;
    for (let i = 75; i >= 70; i--) { bytes[i] = expiry % 256; expiry = Math.floor(expiry / 256); }
    return prefix + encode(bytes);
  } catch { throw invalid(); }
}

export function parseAppPairingPayload(text, { now = Date.now() } = {}) {
  try {
    if (typeof text !== 'string' || !text.startsWith(prefix) || !/^[A-Za-z0-9_-]{101}[AQgw]$/.test(text.slice(prefix.length))) throw invalid();
    const bytes = decode(text.slice(prefix.length));
    if (bytes.length !== 76 || encode(bytes) !== text.slice(prefix.length)) throw invalid();
    const port = new DataView(bytes.buffer).getUint16(4);
    const expiresAt = bytes.slice(70).reduce((value, byte) => value * 256 + byte, 0);
    validateExpiry(expiresAt, now);
    if (!port) throw invalid();
    return { bootstrap: { url: `https://${bytes.slice(0, 4).join('.')}:${port}`, fingerprint: Array.from(bytes.slice(6, 38), byte => byte.toString(16).padStart(2, '0')).join('') }, code: encode(bytes.slice(38, 70)), expiresAt };
  } catch { throw invalid(); }
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
