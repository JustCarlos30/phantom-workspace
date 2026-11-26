import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Context JSX bundles, defaults to null and passes the provider value to consumers', async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/components/ChangesCanvasContext.jsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['react'],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const { ChangesCanvasContext } = module.exports;
  assert.ok(ChangesCanvasContext, 'named Context export is required');
  let received = 'not rendered';
  const consumer = React.createElement(ChangesCanvasContext.Consumer, null, value => {
    received = value;
    return React.createElement('span', null, value?.activeId ?? 'no companion');
  });
  assert.equal(renderToStaticMarkup(consumer), '<span>no companion</span>');
  assert.equal(received, null);
  const value = {
    host: null, expandedHost: null, activeId: 'node-1', expandedId: null,
    placement: { left: 20, top: 40, width: 760, height: 600 },
    open() {}, close() {}, expand() {}, restore() {},
  };
  assert.equal(renderToStaticMarkup(React.createElement(ChangesCanvasContext.Provider, { value }, consumer)), '<span>node-1</span>');
  assert.equal(received, value);
  renderToStaticMarkup(consumer);
  assert.equal(received, null, 'provider value must not leak outside its tree');
});

test('Compose declares the offline browser review job and preserves the other services', async () => {
  const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
  assert.match(compose, /^services:\n/);
  const services = Object.fromEntries([...compose.matchAll(/^  ([\w-]+):\n((?:^    .*\n|^\n)*)/gm)].map(([, name, body]) => [name, body]));
  for (const name of ['composer-test', 'agent-observability-test', 'storybook', 'keyboard-e2e', 'changes-review-test']) {
    assert.ok(services[name], `missing Compose service: ${name}`);
    assert.match(services[name], /^    build:\n      context: \.\n      dockerfile: Dockerfile\./m);
    assert.match(services[name], /^    x-phantom:\n      lifecycle: ephemeral\n      purpose: \".+\"/m);
  }
  const review = services['changes-review-test'];
  assert.deepEqual(JSON.parse(review.match(/^    command: (.+)$/m)?.[1] ?? 'null'), [
    'node', '--test', 'test/touched-files-panel.test.mjs', 'test/changes-canvas.test.mjs',
  ]);
  assert.match(review, /^      dockerfile: Dockerfile\.composer-test$/m);
  assert.match(review, /^    network_mode: none$/m);
  assert.match(review, /^    working_dir: \/workspace$/m);
  assert.match(review, /^    volumes:\n      - \.:\/workspace\n      - \/workspace\/node_modules$/m);
  assert.match(review, /^      card: \"task_d4781a0a-baf0-4822-839a-7bd421feb6de\/changes-review\"$/m);
  assert.match(services.storybook, /^    healthcheck:/m);
  assert.match(services['keyboard-e2e'], /^    profiles: \[keyboard-test\]$/m);
});

test('Review documentation specifies ownership and explicitly leaves visual integration unverified', async () => {
  const document = await readFile(new URL('../docs/changes-canvas-review.md', import.meta.url), 'utf8');
  const sections = Object.fromEntries([...document.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(([, title, body]) => [title, body]));
  for (const title of ['Interfaz compartida', 'Antes', 'Propuesta', 'Pasos de verificación', 'Pendientes y límites']) {
    assert.ok(sections[title]?.trim(), `missing review section: ${title}`);
  }
  for (const field of ['ChangesCanvasContext', 'host', 'expandedHost', 'activeId', 'expandedId', 'placement', 'open(nodeId)', 'close(nodeId)', 'expand(nodeId)', 'restore(nodeId)']) {
    assert.ok(sections['Interfaz compartida'].includes('`' + field + '`'), `missing interface field: ${field}`);
  }
  assert.match(sections['Interfaz compartida'], /Ninguna operación envía mensajes a agentes/);
  assert.match(sections['Pasos de verificación'], /node --test test\/touched-files\.test\.mjs/);
  assert.match(sections['Pasos de verificación'], /`changes-review-test`/);
  assert.match(sections['Pendientes y límites'], /no implementa ni acredita la UI/);
  assert.match(sections['Pendientes y límites'], /no se afirma aquí que existan o hayan sido ejecutadas/);
  assert.match(sections['Pendientes y límites'], /No se usaron capturas sintéticas como prueba de datos reales/);
});
