import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCardInput, cardFormOf, emptyCardForm, validateScopePath,
  cardActions, contractOf, stateOf, refOf, filterCards, executionFacts, enabledProviders,
} from './plugin-model.mjs';

test('executionFacts distingue solicitado de observado y bloquea modelos no Claude sin fingir', () => {
  const none = executionFacts({});
  assert.deepEqual([none.client, none.engine, none.requested, none.requestedSource, none.status, none.observedLabel, none.blocked], ['claude', 'claude-code', 'claude-code/sonnet', 'predeterminado', 'unknown', 'Desconocido', null]);
  assert.equal(executionFacts({ contract: { model: 'claude-code/opus' }, pluginModel: 'claude-code/haiku' }).requestedSource, 'contrato');
  assert.equal(executionFacts({ pluginModel: 'claude-code/haiku' }).requestedSource, 'configuración del plugin');
  const fixed = executionFacts({ contract: { model: 'claude-code/haiku' }, typedModel: 'claude-code/sonnet' });
  assert.deepEqual([fixed.requested, fixed.requestedSource], ['claude-code/haiku', 'contrato']); assert.match(fixed.note, /se ignora/);
  assert.equal(executionFacts({ typedModel: 'sonnet' }).requested, 'sonnet');
  const hist = executionFacts({ contract: { model: 'openai/gpt-5' }, recordedRequest: 'openai/gpt-5' });
  assert.deepEqual([hist.client, hist.engine, hist.status, hist.observedLabel], ['desconocido', 'desconocido', 'unknown', 'Desconocido']); assert.ok(hist.blocked);
  const seen = executionFacts({ contract: { model: 'claude-code/opus' }, observedModel: 'claude-opus-5-5' });
  assert.deepEqual([seen.status, seen.observed, seen.requested], ['observed', 'claude-opus-5-5', 'claude-code/opus']);
  const legacy = executionFacts({ contract: { model: 'claude-code/sonnet', judge: { model: 'openai/gpt-5' } } });
  assert.match(legacy.blocked, /no es Claude Code \(juez del contrato\).*habilita OpenCode en Configuración > Agentes/); assert.equal(legacy.engine, 'claude-code');
  assert.match(executionFacts({ pluginModel: 'provider/legacy' }).blocked, /configuración del plugin/);
});

const withOpenCode = { providers: { claude: { enabled: true }, opencode: { enabled: true }, codex: { enabled: false } }, defaults: { chat: { client: 'claude', model: null }, handoff: { client: 'claude', model: null }, task: { client: 'claude', model: 'claude-code/sonnet' }, judge: { client: 'claude', model: 'claude-code/sonnet' } } };

test('executionFacts con OpenCode habilitado enruta por motor sin fallback ni Claude por OpenCode', () => {
  const open = executionFacts({ contract: { model: 'openai/gpt-5' }, policy: withOpenCode });
  assert.deepEqual([open.client, open.engine, open.requested, open.requestedSource, open.blocked], ['opencode', 'opencode', 'openai/gpt-5', 'contrato', null]);
  const child = executionFacts({ contract: { model: 'claude-code/sonnet', coordination: { children: [{ id: 'h1', model: 'openai/gpt-5', judge: { model: 'openai/gpt-5-mini' } }] } }, policy: withOpenCode });
  assert.deepEqual([child.engine, child.blocked], ['claude-code', null]);
  assert.match(executionFacts({ typedModel: 'anthropic/claude-sonnet', policy: withOpenCode }).blocked, /solo con Claude Code/);
  const area = executionFacts({ policy: { ...withOpenCode, defaults: { ...withOpenCode.defaults, task: { client: 'opencode', model: 'openai/gpt-5' } } } });
  assert.deepEqual([area.engine, area.requested, area.requestedSource], ['opencode', 'openai/gpt-5', 'predeterminado']);
  const disabledChild = executionFacts({ contract: { model: 'claude-code/sonnet', coordination: { children: [{ id: 'h1', model: 'openai/gpt-5' }] } } });
  assert.match(disabledChild.blocked, /hijo h1/);
  const noClaude = { ...withOpenCode, providers: { ...withOpenCode.providers, claude: { enabled: false } } };
  assert.match(executionFacts({ contract: { model: 'claude-code/opus' }, policy: noClaude }).blocked, /deshabilitado/);
});

test('enabledProviders: sin datos o con error solo Claude Code', () => {
  assert.deepEqual(enabledProviders(null), ['claude']);
  assert.deepEqual(enabledProviders({ policy: withOpenCode }), ['claude', 'opencode']);
});

function validForm(overrides = {}) {
  return {
    ...emptyCardForm(),
    goal: 'Actualizar el panel',
    scope: 'src/components/Panel.jsx',
    checks: [{ name: 'suite', argv: '["npm","test"]' }],
    ...overrides,
  };
}

test('el formulario conserva argumentos literales, metadatos de checks y límites del contrato', () => {
  const form = validForm({
    goal: '  Actualizar el panel  ',
    scope: ' src/components/Panel.jsx\r\n\r\n assets/icon.svg  ',
    deps: ' task-a\r\n\n task-b ',
    checks: [{ name: ' suite ', argv: '["node","--test","test/con espacios.test.mjs","$HOME; echo literal"]', kind: 'acceptance', cwd: '.', timeoutMs: 5000, protect: ['assets/icon.svg'] }],
    budget: '{"timeoutMs":60000,"maxTurns":12,"maxRepairs":0}',
    coordination: '{"strategy":"serial"}',
  });
  const before = structuredClone(form);
  assert.deepEqual(buildCardInput(form), {
    goal: 'Actualizar el panel', lane: 'coordinated',
    scope: ['src/components/Panel.jsx', 'assets/icon.svg'], dependencies: ['task-a', 'task-b'],
    checks: [{ name: 'suite', argv: ['node', '--test', 'test/con espacios.test.mjs', '$HOME; echo literal'], kind: 'acceptance', cwd: '.', timeoutMs: 5000, protect: ['assets/icon.svg'] }],
    budget: { timeoutMs: 60000, maxTurns: 12, maxRepairs: 0 },
    coordination: { strategy: 'serial' },
  });
  assert.deepEqual(form, before);
});

test('editar una Card preserva campos nativos y permite borrar opciones sin mutar el original', () => {
  const original = { raw: { contract: {
    goal: 'Original', lane: 'direct', scope: ['src/old.js'], dependencies: ['old-task'],
    checks: [{ name: 'suite', argv: ['npm', 'test'], cwd: 'frontend', timeoutMs: 9000 }],
    budget: { maxTurns: 10 }, coordination: { strategy: 'serial' }, custom: { owner: 'local' },
  } } };
  const before = structuredClone(original);
  const form = cardFormOf(original);
  assert.equal(form.deps, 'old-task');
  assert.deepEqual(form.checks[0], { name: 'suite', argv: '["npm","test"]', cwd: 'frontend', timeoutMs: 9000 });
  assert.deepEqual(buildCardInput(form, original), { ...original.raw.contract, lane: 'coordinated' });
  Object.assign(form, { goal: 'Reemplazo', scope: 'src/new.js', deps: '', budget: ' ', coordination: '' });
  const replacement = buildCardInput(form, original);
  assert.equal(replacement.goal, 'Reemplazo');
  assert.deepEqual(replacement.scope, ['src/new.js']);
  assert.deepEqual(replacement.dependencies, []);
  assert.equal(Object.hasOwn(replacement, 'deps'), false);
  assert.deepEqual(replacement.custom, { owner: 'local' });
  assert.equal(Object.hasOwn(replacement, 'budget'), false);
  assert.equal(Object.hasOwn(replacement, 'coordination'), false);
  assert.deepEqual(original, before);
});

test('el reemplazo elimina deps heredado y conserva dependencies nativo', () => {
  const original = { contract: { goal: 'Original', scope: ['src/a.js'], checks: [{ name: 'suite', argv: ['npm', 'test'] }], dependencies: ['native-task'], deps: ['legacy-task'] } };
  const result = buildCardInput(cardFormOf(original), original);
  assert.deepEqual(result.dependencies, ['native-task']);
  assert.equal(Object.hasOwn(result, 'deps'), false);
  assert.deepEqual(original.contract.deps, ['legacy-task']);
});

test('cada formulario nuevo tiene checks independientes', () => {
  const first = emptyCardForm();
  first.checks[0].name = 'editado';
  first.checks.push({ name: 'otro', argv: '[]' });
  assert.deepEqual(emptyCardForm().checks, [{ name: '', argv: '' }]);
});

test('scope rechaza escapes Unix y Windows y acepta rutas relativas con espacios', () => {
  for (const path of ['/etc/passwd', 'C:\\temp\\file', 'D:/temp/file', '../secret', 'src/../secret', 'src\\..\\secret', 'src/\u0000file', 'src/\tfile']) {
    assert.equal(validateScopePath(path), false, path);
    assert.throws(() => buildCardInput(validForm({ scope: path })), /Scope:.*rutas relativas/);
  }
  for (const path of ['src/a b.js', './src/file.js', 'src\\file.js', 'src/.../file.js']) {
    assert.equal(validateScopePath(path), true, path);
  }
});

test('objetivo, scope y checks vacíos producen errores accionables', () => {
  assert.throws(() => buildCardInput(validForm({ goal: ' \n ' })), /objetivo/);
  assert.throws(() => buildCardInput(validForm({ scope: ' \r\n ' })), /Scope:/);
  assert.throws(() => buildCardInput(validForm({ checks: [] })), /al menos un check real/);
  for (const checks of [
    [{ name: ' ', argv: '["node"]' }],
    [{ name: 'suite', argv: '["node"]' }, { name: ' suite ', argv: '["npm"]' }],
  ]) assert.throws(() => buildCardInput(validForm({ checks })), /nombre único/);
});

test('argv exige JSON de argumentos sin ejecutar ni interpretar texto de shell', () => {
  assert.throws(() => buildCardInput(validForm({ checks: [{ name: 'suite', argv: 'npm test' }] })), /Check suite: argv debe ser un array JSON de strings/);
  for (const argv of ['"npm test"', '{}', 'null', '[]', '["   "]', '["npm",12]', '["npm",null]', '["npm","line\\nfeed"]', '["npm","carriage\\rreturn"]', '["npm","nul\\u0000byte"]']) {
    assert.throws(() => buildCardInput(validForm({ checks: [{ name: 'suite', argv }] })), /Check suite: argv requiere un comando y argumentos strings válidos/, argv);
  }
});

test('budget rechaza JSON inválido, tipos incorrectos y límites no positivos', () => {
  assert.throws(() => buildCardInput(validForm({ budget: '{' })), /Budget: JSON inválido/);
  for (const budget of ['null', '[]', '1', '"limite"']) {
    assert.throws(() => buildCardInput(validForm({ budget })), /Budget: debe ser un objeto JSON/);
  }
  for (const budget of ['{"maxTurns":0}', '{"maxTurns":-1}', '{"maxRepairs":-1}', '{"maxTurns":"12"}', '{"maxTurns":null}', '{"maxTurns":true}', '{"timeoutMs":1e999}']) {
    assert.throws(() => buildCardInput(validForm({ budget })), /Budget: usa límites numéricos positivos/, budget);
  }
});

test('coordinación informa errores de sintaxis y de tipo por su campo', () => {
  assert.throws(() => buildCardInput(validForm({ coordination: '{' })), /Coordinación: JSON inválido/);
  for (const coordination of ['null', '[]', 'false', '"serial"']) {
    assert.throws(() => buildCardInput(validForm({ coordination })), /Coordinación: debe ser un objeto JSON/);
  }
});

test('los adaptadores respetan precedencia nativa de contrato, estado y referencia', () => {
  const contract = { goal: 'Contrato', scope: ['src'] };
  const spec = { goal: 'Spec' };
  assert.equal(contractOf({ contract, spec, raw: { contract: spec } }), contract);
  assert.equal(contractOf({ spec }), spec);
  assert.equal(contractOf({ raw: { contract } }), contract);
  assert.equal(contractOf(contract), contract);
  assert.equal(stateOf({ status: 'failed', state: 'completed' }), 'failed');
  assert.equal(stateOf({ status: {}, state: 'blocked' }), 'blocked');
  assert.equal(stateOf(null), 'unknown');
  const ref = { id: 'card-a', version: 3 };
  assert.equal(refOf({ ref, raw: { ref: { id: 'stale' } } }), ref);
  assert.equal(refOf({ raw: { ref } }), ref);
  assert.equal(refOf({ id: 'card-a', revision: 3 }), null);
});

test('un controlador activo de la misma Card determina stop e impide otra ejecución', () => {
  for (const status of ['starting', 'running']) {
    assert.deepEqual(cardActions({ id: 'a', status: 'blocked', runs: [{ status: 'interrupted', recovery: { state: 'reconciled' } }] }, [{ taskId: 'a', status }]), {
      run: false, stop: true, cancel: false, recover: false, verify: false,
    });
  }
  for (const controllers of [[{ taskId: 'other', status: 'running' }], [{ taskId: 'a', status: 'completed' }], []]) {
    assert.deepEqual(cardActions({ id: 'a', status: 'failed' }, controllers), {
      run: true, stop: false, cancel: true, recover: false, verify: false,
    });
  }
  assert.deepEqual(cardActions({ id: 'a', status: 'failed' }, [{ taskId: 'a', status: 'running' }]), { run: false, stop: true, cancel: false, recover: false, verify: false });
});

test('solo ready/blocked permiten run y cancel; recover requiere el último run activo', () => {
  for (const status of ['running', 'recovering']) {
    assert.deepEqual(cardActions({ task: { id: 'a', status: 'running' }, runs: [{ status }] }), { run: false, stop: false, cancel: false, recover: true, verify: false });
  }
  assert.equal(cardActions({ id: 'a', status: 'running', runs: [] }).recover, false);
  assert.equal(cardActions({ id: 'a', status: 'failed', runs: [{ status: 'running' }, { status: 'failed' }] }).recover, false);
  assert.deepEqual(cardActions({ id: 'a', status: 'completed' }), { run: false, stop: false, cancel: false, recover: false, verify: false });
  for (const status of ['ready', 'blocked', 'failed']) assert.deepEqual(cardActions({ status }), { run: true, stop: false, cancel: true, recover: false, verify: false });
  for (const status of ['created', 'pending', 'queued', 'running', 'stopped']) {
    assert.equal(cardActions({ status }).cancel, false);
    assert.equal(cardActions({ status }).run, false);
  }
  assert.deepEqual(cardActions({ id: 'a', status: 'unrecognized' }), { run: false, stop: false, cancel: false, recover: false, verify: false });
});

test('blocked verifica desde reconciliación y conserva la cadena nativa de verificaciones fallidas', () => {
  const reconciled = { id: 'run-origin', status: 'interrupted', recovery: { state: 'reconciled' } };
  const runs = [reconciled];
  const detail = { task: { id: 'a', status: 'blocked' }, runs };
  assert.deepEqual(cardActions(detail), { run: true, stop: false, cancel: true, recover: false, verify: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    runs.push({ id: `verify-${attempt}`, mode: 'verification', status: 'failed', recoveryOf: runs.at(-1).id });
    assert.equal(cardActions(detail).verify, true, `reverification ${attempt}`);
  }
  assert.equal(cardActions({ ...detail, task: { id: 'a', status: 'ready' } }).verify, false);
  assert.equal(cardActions(detail, [{ taskId: 'a', status: 'running' }]).verify, false);
  runs.push({ id: 'ordinary-failure', status: 'failed' });
  assert.deepEqual(cardActions(detail), { run: true, stop: false, cancel: true, recover: false, verify: false });
});

test('la procedencia del último run no se deduce de un fallo ordinario ni de campos parciales', () => {
  for (const run of [
    { status: 'failed' },
    { status: 'failed', recoveryOf: 'origin' },
    { mode: 'verification', status: 'failed' },
    { mode: 'verification', status: 'failed', recoveryOf: 42 },
    { mode: 'verification', status: 'completed', recoveryOf: 'origin' },
    { status: 'interrupted', recovery: { state: 'pending' } },
  ]) {
    assert.deepEqual(cardActions({ id: 'a', status: 'blocked', runs: [run] }), { run: true, stop: false, cancel: true, recover: false, verify: false });
  }
});

test('búsqueda combina objetivo del contrato, id y estado nativo sin modificar la lista', () => {
  const cards = [
    { id: 'a', status: 'blocked', contract: { goal: 'Reparar PANEL' } },
    { id: 'panel-b', state: 'completed', spec: { goal: 'Otro trabajo' } },
    { id: 'c', status: 'completed', contract: { goal: 'Sin coincidencia' } },
  ];
  assert.deepEqual(filterCards(cards, ' PANEL ', ''), cards.slice(0, 2));
  assert.deepEqual(filterCards(cards, 'panel', 'completed'), [cards[1]]);
  assert.deepEqual(filterCards(cards, '', 'blocked'), [cards[0]]);
  assert.equal(cards.length, 3);
});
