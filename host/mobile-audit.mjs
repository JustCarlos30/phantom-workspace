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
}
