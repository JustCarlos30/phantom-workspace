import fs from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { X509Certificate, createPrivateKey, createPublicKey, createHash } from 'node:crypto';

const run = promisify(execFile);
export async function loadIdentity(dataDir, address, regenerate = false) {
  if (isIP(address) !== 4) throw new Error('Identidad requiere IPv4 literal');
  const dir = path.join(dataDir, 'mobile-identity');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('Identidad no canónica');
  await fs.chmod(dir, 0o700);
  const certFile = path.join(dir, `${address}.crt`), keyFile = path.join(dir, `${address}.key`);
  const exists = async file => { try { await fs.lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
  const present = [await exists(certFile), await exists(keyFile)];
  if (regenerate || !present.some(Boolean)) {
    const suffix = `.new-${process.pid}`, certTmp = certFile + suffix, keyTmp = keyFile + suffix;
    try {
      await run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-sha256', '-days', '365', '-subj', '/CN=Phantom Workspace', '-addext', `subjectAltName=IP:${address}`, '-keyout', keyTmp, '-out', certTmp], { timeout: 15000, maxBuffer: 16384 });
      await fs.chmod(keyTmp, 0o600); await fs.chmod(certTmp, 0o600);
      await fs.rename(keyTmp, keyFile); await fs.rename(certTmp, certFile);
    } finally { await fs.rm(keyTmp, { force: true }); await fs.rm(certTmp, { force: true }); }
  }
  for (const file of [keyFile, certFile]) if (!(await fs.lstat(file)).isFile() || (await fs.lstat(file)).isSymbolicLink()) throw new Error('Identidad no canónica');
  await fs.chmod(keyFile, 0o600); await fs.chmod(certFile, 0o600);
  const [key, cert] = await Promise.all([fs.readFile(keyFile), fs.readFile(certFile)]);
  const x509 = new X509Certificate(cert), privateKey = createPrivateKey(key);
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails.namedCurve !== 'prime256v1'
    || !x509.publicKey.export({ type: 'spki', format: 'der' }).equals(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))
    || !x509.verify(x509.publicKey) || !x509.checkIP(address) || Date.parse(x509.validFrom) > Date.now() || Date.parse(x509.validTo) <= Date.now()) {
    throw new Error('Identidad inválida o caducada; regenera explícitamente desde escritorio y vuelve a vincular');
  }
  const fingerprint = createHash('sha256').update(x509.raw).digest('hex');
  return { key, cert, public: { hostId: fingerprint, fingerprint, certificate: cert.toString(), address, expiresAt: Date.parse(x509.validTo) } };
}
