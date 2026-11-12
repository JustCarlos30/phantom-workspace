import { spawn } from 'node:child_process';

const MODEL = /^[A-Za-z0-9][\w./:@\[\]-]{0,199}$/;
const MAX_OUTPUT = 8 * 1024 * 1024, MAX_PAGES = 50;

// app-server speaks one JSON message per line over stdio. The deadline covers
// the entire exchange, including all pages, rather than restarting per page.
export function codexModels(bin, cwd, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let child, done = false, exited = false, timer, killTimer;
    let buffer = '', bytes = 0, stderr = '', phase = 'initialize', requestId = 1, pages = 0;
    const items = [], ids = new Set(), cursors = new Set();
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (child) {
        child.stdin.end();
        if (!exited && child.pid) {
          try { child.kill('SIGTERM'); } catch { /* Already gone. */ }
          killTimer = setTimeout(() => { if (!exited) { try { child.kill('SIGKILL'); } catch { /* Already gone. */ } } }, 500);
          killTimer.unref();
        }
      }
      if (error) reject(error); else resolve(value);
    };
    const fail = message => finish(new Error(`Codex no pudo listar sus modelos: ${message}`));
    const send = message => { if (!done) child.stdin.write(`${JSON.stringify(message)}\n`); };
    try { child = spawn(bin, ['app-server', '--listen', 'stdio://'], { cwd, env: { ...process.env, PWD: cwd }, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { fail(error.message); return; }
    child.on('error', error => fail(error.code === 'ENOENT' ? `No se encontró «${bin}». Comprueba settings.codexPath y la carpeta de trabajo.` : error.message));
    child.stdin.on('error', error => { if (!done) fail(`error de comunicación: ${error.message}`); });
    child.on('exit', (code, signal) => {
      exited = true; clearTimeout(killTimer);
    });
    child.on('close', (code, signal) => {
      if (!done) fail(`el proceso terminó antes de completar el catálogo (${signal || `código ${code}`})${stderr.trim() ? `: ${stderr.trim().slice(-1000)}` : ''}`);
    });
    child.stderr.on('data', chunk => { bytes += chunk.length; stderr = (stderr + chunk.toString()).slice(-2000); if (bytes > MAX_OUTPUT) fail('salida demasiado grande'); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_OUTPUT) { fail('salida demasiado grande'); return; }
      buffer += chunk;
      let index;
      while (!done && (index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message; try { message = JSON.parse(line); } catch { fail('respuesta de protocolo JSON inválida'); return; }
        if (!message || typeof message !== 'object' || Array.isArray(message)) { fail('respuesta de protocolo inválida'); return; }
        if (message.id === undefined || message.id === null) continue;
        if (message.id !== requestId) { fail('identificador de respuesta inesperado'); return; }
        if (message.error) { fail(`error RPC: ${String(message.error.message || JSON.stringify(message.error)).slice(0, 1000)}`); return; }
        if (!message.result || typeof message.result !== 'object' || Array.isArray(message.result)) { fail('resultado de protocolo inválido'); return; }
        if (phase === 'initialize') {
          phase = 'models'; send({ method: 'initialized', params: {} }); requestId = 2;
          send({ id: requestId, method: 'model/list', params: { limit: 100 } });
          continue;
        }
        const { data, nextCursor } = message.result;
        if (!Array.isArray(data) || !(nextCursor == null || typeof nextCursor === 'string' && nextCursor.length > 0 && nextCursor.length <= 4096)) { fail('página de modelos inválida'); return; }
        for (const entry of data) {
          const id = entry?.model;
          if (entry?.hidden === true || typeof id !== 'string' || !MODEL.test(id) || ids.has(id)) continue;
          ids.add(id); items.push({ id, group: 'Codex' });
          if (items.length > 2000) { fail('demasiados modelos'); return; }
        }
        pages++;
        if (nextCursor != null) {
          if (pages >= MAX_PAGES || cursors.has(nextCursor)) { fail('límite de paginación alcanzado'); return; }
          cursors.add(nextCursor); requestId++;
          send({ id: requestId, method: 'model/list', params: { limit: 100, cursor: nextCursor } });
        } else if (!items.length) fail('el catálogo está vacío');
        else finish(null, items);
      }
    });
    timer = setTimeout(() => fail('tiempo de espera agotado'), timeoutMs);
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'phantom-workspace', version: '0.1.0' } } });
  });
}
