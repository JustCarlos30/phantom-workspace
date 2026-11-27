import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/OrchestratorHub.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/orchestrator-hub.css', import.meta.url), 'utf8');

test('el envío no dispara notify con «Enviado al orquestador»', () => {
  assert.doesNotMatch(src, /notify\?*\.?\(\s*`?['"]?Enviado al orquestador/);
  assert.doesNotMatch(src, /Enviado al orquestador de/);
  assert.match(src, /export default function OrchestratorHub\([^)]*notify/);
});

test('existe el hilo role=log y se alimenta tras orchestrator.send', () => {
  assert.match(src, /role="log"/);
  assert.match(src, /aria-live="polite"/);
  const send = src.indexOf("api('orchestrator.send'");
  assert.ok(send > 0);
  assert.match(src.slice(send, send + 200), /patch\(\{ status: 'sent' \}\)/);
  assert.match(src, /setLog\(list => \[\.\.\.list, entry\]\)/);
  assert.match(css, /\.oh-thread\s*\{[^}]*max-height[^}]*overflow-y: auto/);
});
