import fs from 'node:fs';
import path from 'node:path';

// Synchronous durable admission before an effect: no event-loop gap between
// permission/revocation checks, journal admission and invoking the operation.
export class MobileAudit {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'mobile-audit');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(this.dir).isSymbolicLink()) throw new Error('Auditoría no canónica');
    fs.chmodSync(this.dir, 0o700); this.file = path.join(this.dir, 'events.jsonl');
  }
  append(event) {
    const safe = {};
    for (const key of ['timestamp', 'deviceId', 'workspaceId', 'nodeId', 'method', 'outcome', 'reason', 'requestId']) {
      if (typeof event[key] === 'string') safe[key] = event[key].replace(/[\x00-\x1f\x7f]/g, '').slice(0, 128);
      else if (key === 'timestamp' && Number.isFinite(event[key])) safe[key] = event[key];
    }
    if (fs.existsSync(this.file) && fs.lstatSync(this.file).size >= 256 * 1024) {
      fs.rmSync(this.file + '.2', { force: true });
      if (fs.existsSync(this.file + '.1')) fs.renameSync(this.file + '.1', this.file + '.2');
      fs.renameSync(this.file, this.file + '.1');
    }
    const fd = fs.openSync(this.file, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    try {
      fs.fchmodSync(fd, 0o600);
      const size = fs.fstatSync(fd).size;
      if (size) {
        const tail = Buffer.alloc(1); fs.readSync(fd, tail, 0, 1, size - 1);
        if (tail[0] !== 10) throw new Error('Auditoría truncada; requiere revisión local');
      }
      const bytes = Buffer.from(JSON.stringify(safe) + '\n'); let offset = 0;
      while (offset < bytes.length) { const count = fs.writeSync(fd, bytes, offset, bytes.length - offset); if (!count) throw new Error('Auditoría incompleta'); offset += count; }
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  list() {
    if (!fs.existsSync(this.file)) return [];
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > 264 * 1024) throw new Error('Auditoría fuera de límite');
      return fs.readFileSync(fd, 'utf8').trim().split('\n').filter(Boolean).slice(-100).map(line => JSON.parse(line));
    } finally { fs.closeSync(fd); }
  }
}
