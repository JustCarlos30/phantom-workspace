#!/usr/bin/env node
import { requestBrowser, timeoutValue } from '../host/agent-browser.mjs';

const help = `Phantom Workspace Browser — usa el panel Electron de esta terminal.
Uso: node "$PHANTOM_BROWSER_CLI" <comando> [argumentos] [opciones]
  preview|open <http(s)://url>   Espera HTTP y abre/enfoca el mismo panel
  status                       Estado del panel y WebContents
  read [selector CSS]          Texto y controles (salida acotada)
  click <selector CSS>         Clic sobre un elemento visible y único
  fill <selector CSS> <valor>  Rellena input/textarea y emite input/change
  screenshot [nombre.png]     Guarda PNG nuevo en artifacts privados
  console                      Últimos 100 mensajes (cada uno hasta 2000 caracteres)
  context                      Identidad y disponibilidad; nunca muestra secretos
Opciones: --timeout-ms 100..30000 (predeterminado 10000)
          --key <clave>        Idempotencia dentro de esta terminal
          --id <UUID>          Panel previamente creado por esta terminal
Salida JSON; errores JSON en stderr y código de salida 1.
Solo HTTP(S) sin credenciales. Sin eval/JS arbitrario ni navegador externo.
Requiere una terminal nueva de Phantom con PHANTOM_BROWSER_SOCKET,
PHANTOM_BROWSER_TOKEN, PHANTOM_WORKSPACE_ID y PHANTOM_TERMINAL_ID.
El acceso es local al usuario del sistema y se revoca al terminar la sesión.`;

try {
  const args = process.argv.slice(2), command = args.shift() || 'help';
  if (['help', '--help', '-h'].includes(command)) console.log(help);
  else {
    const positional = [], payload = {};
    while (args.length) {
      const arg = args.shift();
      if (['--timeout-ms', '--key', '--id'].includes(arg)) {
        if (!args.length) throw new Error(`Falta valor para ${arg}`);
        const value = args.shift();
        payload[{ '--timeout-ms': 'timeoutMs', '--key': 'key', '--id': 'id' }[arg]] = arg === '--timeout-ms' ? timeoutValue(Number(value)) : value;
      } else if (arg.startsWith('--')) throw new Error(`Opción desconocida: ${arg}`);
      else positional.push(arg);
    }
    const shapes = { preview: ['url'], open: ['url'], status: [], read: ['selector'], click: ['selector'], fill: ['selector', 'value'], screenshot: ['name'], console: [], context: [] };
    if (!Object.hasOwn(shapes, command) || positional.length > shapes[command].length) throw new Error('Comando o argumentos no válidos; consulta help');
    shapes[command].forEach((name, index) => { if (positional[index] !== undefined) payload[name] = positional[index]; });
    const context = { socketPath: process.env.PHANTOM_BROWSER_SOCKET, token: process.env.PHANTOM_BROWSER_TOKEN, workspaceId: process.env.PHANTOM_WORKSPACE_ID, terminalId: process.env.PHANTOM_TERMINAL_ID };
    if (Object.values(context).some(value => !value)) throw Object.assign(new Error('Contexto ausente: usa una terminal nueva de Phantom Workspace'), { code: 'CONTEXT_REQUIRED' });
    console.log(JSON.stringify(await requestBrowser(context, command, payload)));
  }
} catch (error) {
  console.error(JSON.stringify({ error: { code: error.code || 'INVALID_INPUT', message: error.message } })); process.exitCode = 1;
}
