import fs from 'node:fs';
import path from 'node:path';

export class MobileAudit {
  constructor(dataDir) { this.file = path.join(dataDir, 'mobile-audit.jsonl'); }
  append(event) {
    const line = Buffer.from(JSON.stringify(event) + '\n');
    const open = () => {
      const fd = fs.openSync(this.file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600) throw new Error('Auditoría móvil insegura');
        return fd;
      } catch (error) { fs.closeSync(fd); throw error; }
    };
    let fd = open();
    try {
      if (fs.fstatSync(fd).size + line.length > 1024 * 1024) {
        fs.closeSync(fd); fd = undefined;
        fs.renameSync(this.file, this.file + '.1');
        fd = open();
      }
      let offset = 0;
      while (offset < line.length) {
        const written = fs.writeSync(fd, line, offset, line.length - offset);
        if (!written) throw new Error('Escritura de auditoría incompleta');
        offset += written;
      }
      fs.fsyncSync(fd);
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  // Read-only view for the desktop: same ownership checks as append, bounded tail
  // reads and a fixed field projection, so nothing beyond the logged schema leaves.
  list(limit = 100) {
    const events = [];
    for (const file of [this.file, this.file + '.1']) {
      if (events.length >= limit) break;
      let fd;
      try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600) throw new Error('Auditoría móvil insegura');
        const size = Math.min(stat.size, TAIL), buffer = Buffer.alloc(size);
        let read = 0;
        while (read < size) { const count = fs.readSync(fd, buffer, read, size - read, stat.size - size + read); if (!count) break; read += count; }
        const lines = buffer.subarray(0, read).toString('utf8').split('\n');
        if (stat.size > size) lines.shift();
        const parsed = [];
        for (const line of lines) {
          if (!line) continue;
          let value; try { value = JSON.parse(line); } catch { continue; }
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          parsed.push(Object.fromEntries(FIELDS.filter(key => typeof value[key] === 'string').map(key => [key, value[key].slice(0, 256)])));
        }
        events.unshift(...parsed.slice(-(limit - events.length)));
      } finally { fs.closeSync(fd); }
    }
    return events;
  }
}

const TAIL = 256 * 1024;
const FIELDS = ['time', 'deviceId', 'deviceName', 'remoteAddress', 'method', 'nodeId', 'sessionId', 'result', 'phase'];
