#!/usr/bin/env node
import { browserContext, requestBrowser } from '../host/agent-browser.mjs';
import { pathToFileURL } from 'node:url';

const help = `Phantom Workspace Browser — misma sesión del panel Electron
Uso: node "$PHANTOM_BROWSER_CLI" <comando> [argumentos] [opciones]
  help | context                 Ayuda / identidad y descubrimiento (sin secretos)
  preview <http(s)://url>         Espera HTTP y abre/enfoca el panel (alias: open)
  status                         URL, título, carga y panel visible
  read [selector CSS]            Texto del DOM (máximo 16000 caracteres)
  click <selector CSS>           Activa un elemento del DOM
  fill <selector CSS> <texto>    Rellena input/textarea y emite input/change
  screenshot [nombre.png]        Captura en artifacts privados; devuelve ruta
  console                        Hasta 100 mensajes (buffer máximo 64 KiB)
Opciones: --timeout <100..30000> (ms; defecto 10000), --key <clave>
          --id <panel UUID> (solo panel propiedad de esta terminal)
Preview reutiliza un panel por terminal y clave (defecto: default).
Requiere Electron abierto y entorno de una terminal nueva del workspace.
No ejecuta JavaScript recibido, no abre navegador externo ni cambia configuración global.
Respuestas JSON. Errores en stderr con salida 1; un timeout de acción no garantiza cancelación.
`;

export async function main(args = process.argv.slice(2)) {
  const command = args.shift() || 'help';
  if (['help', '--help', '-h'].includes(command)) { console.log(help); return; }
  if (command === 'context') { console.log(JSON.stringify(browserContext(), null, 2)); return; }
  const payload = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--timeout', '--key', '--id'].includes(arg)) {
      if (args[i + 1] === undefined) throw new Error(`Falta valor para ${arg}`);
      const key = { '--timeout': 'timeoutMs', '--key': 'key', '--id': 'id' }[arg];
      if (key in payload) throw new Error(`Opción repetida: ${arg}`);
      payload[key] = key === 'timeoutMs' ? Number(args[++i]) : args[++i];
    } else if (arg.startsWith('--')) throw new Error(`Opción desconocida: ${arg}`);
    else positional.push(arg);
  }
  const method = command === 'open' ? 'preview' : command;
  const fields = { preview: ['url'], status: [], read: ['selector'], click: ['selector'], fill: ['selector', 'value'], screenshot: ['name'], console: [] }[method];
  if (!Array.isArray(fields) || positional.length > fields.length || (['preview', 'click', 'fill'].includes(method) && positional.length !== fields.length)) throw new Error('Argumentos no válidos; consulta help');
  fields.forEach((key, i) => { if (positional[i] !== undefined) payload[key] = positional[i]; });
  console.log(JSON.stringify(await requestBrowser(method, payload), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
