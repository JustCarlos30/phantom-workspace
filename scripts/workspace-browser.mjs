#!/usr/bin/env node
import { browserContext, requestBrowser } from '../host/agent-browser.mjs';

const help = `Phantom Workspace — navegador Electron del panel (sin navegador externo)
Uso: node "$PHANTOM_BROWSER_CLI" <comando> [argumentos] [opciones]
  help                        Este contexto de uso
  context                     Identidad local y disponibilidad real de Electron
  preview|open <http(s)://URL> Esperar HTTP, reutilizar panel y enfocarlo
  status                      Estado del mismo WebContentsView
  read [selector CSS]         Texto y controles DOM (salida acotada)
  click <selector CSS>        Activar un único elemento visible
  fill <selector CSS> <valor> Rellenar input/textarea y emitir input/change
  screenshot                 PNG en artifacts privados; devuelve ruta absoluta
  console                    Últimos mensajes (buffer acotado)
Opciones: --id <panel UUID>, --key <clave idempotencia>, --timeout <100..30000 ms>
Por defecto se reutiliza un panel por terminal; --key se limita a esa terminal.
Sin --id, los comandos usan ese panel o el asociado a --key.
Requiere una terminal nueva de la aplicación con PHANTOM_BROWSER_* e identidad
PHANTOM_WORKSPACE_ID / PHANTOM_TERMINAL_ID / PHANTOM_TERMINAL_SESSION_ID.
No admite JavaScript, eval, rutas de captura arbitrarias ni debugger público.
Todos los resultados y errores se imprimen como JSON; errores salen con código 1.`;

try {
  const [method = 'help', ...args] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(method)) console.log(help);
  else {
    const params = {}, positional = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (['--id', '--key', '--timeout'].includes(arg)) {
        if (++i >= args.length) throw new Error(`Falta valor para ${arg}`);
        params[{ '--id': 'id', '--key': 'key', '--timeout': 'timeoutMs' }[arg]] = arg === '--timeout' ? Number(args[i]) : args[i];
      } else if (arg.startsWith('--')) throw new Error(`Opción no permitida: ${arg}`);
      else positional.push(arg);
    }
    const fields = { preview: ['url'], open: ['url'], read: ['selector'], click: ['selector'], fill: ['selector', 'value'] }[method] || [];
    if (positional.length > fields.length) throw new Error('Demasiados argumentos');
    fields.forEach((key, i) => { if (positional[i] !== undefined) params[key] = positional[i]; });
    const result = await requestBrowser(method, params);
    console.log(JSON.stringify(method === 'context' ? { ...browserContext(), ...result } : result));
  }
} catch (error) { console.error(JSON.stringify({ error: { code: error.code || 'INVALID_INPUT', message: error.message } })); process.exitCode = 1; }
