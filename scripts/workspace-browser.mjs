#!/usr/bin/env node
import { BROWSER_HELP, readBrowserContext, requestBrowser, timeoutValue } from '../host/agent-browser.mjs';

try {
  const args = process.argv.slice(2), command = args.shift();
  if (!command || ['help', '--help', '-h'].includes(command)) {
    process.stdout.write(BROWSER_HELP);
  } else {
    const payload = { command };
    if (['preview', 'open'].includes(command)) payload.url = args.shift();
    while (args.length) {
      const option = args.shift(), value = args.shift();
      const field = { '--timeout': 'timeoutMs', '--key': 'key', '--selector': 'selector', '--value': 'value', '--name': 'name' }[option];
      if (!field || value === undefined || Object.hasOwn(payload, field)) throw new Error(`Opción no válida: ${option}`);
      payload[field] = value;
    }
    payload.timeoutMs = timeoutValue(payload.timeoutMs);
    const context = readBrowserContext(process.env.PHANTOM_BROWSER_CONTEXT);
    const result = await requestBrowser(context, payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: error.code || 'BROWSER_ERROR', message: error.message } })}\n`);
  process.exitCode = 1;
}
