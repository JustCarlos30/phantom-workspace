#!/usr/bin/env node
import { createBrowserClient } from '../host/agent-browser.mjs';

// Public CLI; JSON on stdout, actionable errors on stderr, nonzero on failure.
const help = `Phantom Workspace browser — controla el panel Electron visible de esta terminal.
Uso: node "$PHANTOM_BROWSER_CLI" <comando> [opciones]
  help | context | status
  preview <http(s)://url> [--key nombre] [--timeout-ms 15000]
  open <http(s)://url>    (mismo contrato de readiness que preview)
  read [--selector CSS] [--key nombre]
  click --selector CSS [--key nombre]
  fill --selector CSS --value texto [--key nombre]
  screenshot | console [--key nombre]
preview/open esperan HTTP antes de crear/enfocar el panel; reutilizan terminal/key.
read/click/fill/captura/consola operan sobre el MISMO WebContentsView y sesión.
Capturas privadas, nombres generados y retención acotada; no se acepta ruta destino.
Descubrimiento: PHANTOM_BROWSER_CLI, PHANTOM_BROWSER_ENDPOINT,
PHANTOM_BROWSER_SESSION, PHANTOM_BROWSER_WORKSPACE (terminales nuevas).
No hay JavaScript arbitrario, debugger público ni fallback a navegador externo.`;

try {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(command)) console.log(help);
  else {
    const payload = {};
    if (['preview', 'open'].includes(command)) payload.url = args.shift();
    const names = { '--key': 'key', '--selector': 'selector', '--value': 'value', '--timeout-ms': 'timeoutMs' };
    while (args.length) {
      const flag = args.shift(), name = names[flag];
      if (!name || !args.length || Object.hasOwn(payload, name)) throw new Error(`Opción no válida: ${flag}`);
      const value = args.shift(); payload[name] = name === 'timeoutMs' ? Number(value) : value;
    }
    console.log(JSON.stringify(await createBrowserClient().invoke(command, payload), null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
