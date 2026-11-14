import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';

const run = promisify(execFile);
function readPrivate(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600) throw new Error('Archivo TLS inseguro');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function exclusive(file, contents) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, contents); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function discard(file) { try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }

export async function mobileTLS(dataDir, address, openssl = 'openssl') {
  const dir = path.join(dataDir, 'mobile-tls');
  try {
    let stat;
    try { stat = fs.lstatSync(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) { fs.unlinkSync(dir); stat = null; }
    if (stat && (!stat.isDirectory() || stat.uid !== process.getuid())) throw new Error('Directorio TLS sin propietario válido');
    if (!stat) fs.mkdirSync(dir, { mode: 0o700 });
    const reset = stat && (stat.mode & 0o7777) !== 0o700;
    fs.chmodSync(dir, 0o700);
    const keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
    if (reset) { discard(keyFile); discard(certFile); }
    let key, cert;
    try {
      key = readPrivate(keyFile);
      const parsed = createPrivateKey(key);
      if (parsed.asymmetricKeyType !== 'ec' || parsed.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('Clave TLS no válida');
    } catch { discard(keyFile); discard(certFile); key = null; }
    if (!key) {
      const generated = await run(openssl, ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256'], { timeout: 10000, maxBuffer: 65536 });
      exclusive(keyFile, generated.stdout); key = readPrivate(keyFile);
    }
    try {
      cert = readPrivate(certFile);
      const parsed = new X509Certificate(cert);
      if (Date.parse(parsed.validTo) <= Date.now() || Date.parse(parsed.validFrom) > Date.now() || !parsed.checkIP(address) || !parsed.checkPrivateKey(createPrivateKey(key)) || !parsed.verify(createPublicKey(key))) throw new Error('Certificado TLS no válido');
    } catch { discard(certFile); cert = null; }
    if (!cert) {
      const generated = await run(openssl, ['req', '-new', '-x509', '-sha256', '-days', '365', '-key', keyFile, '-subj', '/CN=Phantom Workspace mobile', '-addext', `subjectAltName=IP:${address}`], { timeout: 10000, maxBuffer: 65536 });
      exclusive(certFile, generated.stdout); cert = readPrivate(certFile);
    }
    return { key, cert, minVersion: 'TLSv1.2', fingerprint: new X509Certificate(cert).fingerprint256 };
  } catch (error) {
    throw new Error(`No se pudo activar HTTPS móvil: comprueba openssl y los archivos TLS privados (${error.code || 'certificado no válido'}).`, { cause: error });
  }
}
