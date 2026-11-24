import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';

export const secret = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export const check = (value, message = 'Solicitud no válida') => { if (!value) fail(400, message); };
export const string = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
export function exact(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).every(k => keys.includes(k)), 'Campo no permitido');
}
export function decode(value, max) {
  check(string(value, max * 2) && /^[A-Za-z0-9_-]+$/.test(value), 'Base64url no válido');
  const bytes = Buffer.from(value, 'base64url');
  check(bytes.length <= max && bytes.toString('base64url') === value, 'Base64url no canónico'); return bytes;
}
export function deviceKey(value) {
  const der = decode(value, 128); let key;
  try { key = createPublicKey({ key: der, type: 'spki', format: 'der' }); } catch { fail(400, 'Clave SPKI no válida'); }
  check(key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails.namedCurve === 'prime256v1'
    && key.export({ type: 'spki', format: 'der' }).equals(der), 'Se requiere P256 SPKI DER');
  return { key, fingerprint: hash(der) };
}
// This order is server-owned. Clients sign the returned bytes, never reserialize.
export function challenge(identity, now, fields) {
  const envelope = { version: 2, hostId: identity.hostId, fingerprint: identity.fingerprint, challengeId: randomUUID(), nonce: secret(), expiresAt: now + 60000, ...fields };
  return { ...envelope, bytes: Buffer.from(JSON.stringify(envelope)).toString('base64url') };
}
export function verifyProof(key, bytes, signature) {
  let ok = false;
  try {
    const der = decode(signature, 72);
    check(der[0] === 0x30 && der[1] === der.length - 2);
    let offset = 2;
    for (let i = 0; i < 2; i++) {
      check(der[offset++] === 2); const size = der[offset++];
      check(size >= 1 && size <= 33 && offset + size <= der.length && der[offset] < 128
        && !(size > 1 && der[offset] === 0 && der[offset + 1] < 128)); offset += size;
    }
    check(offset === der.length);
    ok = verify('sha256', Buffer.from(bytes, 'base64url'), { key, dsaEncoding: 'der' }, der);
  } catch { /* invalid DER */ }
  if (!ok) fail(401, 'Firma no válida');
}
export function bounded(value, budget = 180000, depth = 0) {
  if (depth > 12 || budget < 0) fail(413, 'Vista demasiado grande');
  if (typeof value === 'string') { if (value.length > budget) fail(413, 'Vista demasiado grande'); return budget - value.length; }
  if (value && typeof value === 'object') {
    if (Object.keys(value).length > 1000) fail(413, 'Vista demasiado grande');
    for (const key of Object.keys(value)) budget = bounded(value[key], budget - key.length - 4, depth + 1);
  }
  if (budget < 0) fail(413, 'Vista demasiado grande'); return budget - 8;
}
