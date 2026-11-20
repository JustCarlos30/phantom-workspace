import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY, DEFAULT_HARNESS_MODEL, ExecutionPolicyError, assertClientAllowed, assertClientModel, assertContractAllowed,
  assertModelAllowed, configurePolicy, describeExecution, engineOf, executionPolicy, isClaudeLike, resolveHarnessModel,
} from '../shared/execution-policy.mjs';
import { POLICY_HINTS, engineHint, setExecutionPolicy, terminalPolicy } from '../host/agent-policy.mjs';

const enabled = (extra = {}) => executionPolicy({ providers: { opencode: { enabled: true }, codex: { enabled: true } }, ...extra });

test('without settings the policy is exactly the previous Claude Code behavior', () => {
  assert.deepEqual(executionPolicy(undefined), DEFAULT_POLICY);
  assert.deepEqual(executionPolicy({ theme: 'dark' }), DEFAULT_POLICY);
  assert.deepEqual(DEFAULT_POLICY.providers, { claude: { enabled: true }, opencode: { enabled: false }, codex: { enabled: false } });
  assert.deepEqual(DEFAULT_POLICY.defaults.task, { client: 'claude', model: 'claude-code/sonnet' });
  assert.deepEqual(DEFAULT_POLICY.defaults.judge, { client: 'claude', model: 'claude-code/sonnet' });
  assert.deepEqual([DEFAULT_POLICY.defaults.chat.client, DEFAULT_POLICY.defaults.handoff.client], ['claude', 'claude']);
  assert.deepEqual(resolveHarnessModel(undefined, {}, undefined, executionPolicy({})), { model: DEFAULT_HARNESS_MODEL, source: 'default' });
  assert.throws(() => resolveHarnessModel('openai/gpt-5', {}, undefined, executionPolicy({})), /no es Claude Code.*habilita OpenCode en Configuración > Agentes/);
  assert.throws(() => assertClientAllowed('opencode'), /Habilita OpenCode en Configuración > Agentes/);
  assert.throws(() => assertClientAllowed('codex'), error => error instanceof ExecutionPolicyError && error.code === 'EXECUTION_POLICY' && /Habilita Codex/.test(error.message));
  assert.throws(() => assertClientAllowed('gemini'), /no es un proveedor conocido/);
});

test('engineOf routes claude-code/<m> and bare Claude names to Claude Code, anything else to OpenCode', () => {
  for (const model of ['claude-code/sonnet', 'sonnet', 'claude-opus-5-5', 'claude-code/claude-haiku-5-5']) assert.equal(engineOf(model), 'claude-code', model);
  for (const model of ['openai/gpt-5', 'opencode/free', 'openrouter/qwen/qwen3']) assert.equal(engineOf(model), 'opencode', model);
  for (const model of ['anthropic/claude-sonnet-4', 'openrouter/anthropic/claude-opus', 'claude-code/x', 'opus']) assert.equal(isClaudeLike(model), true, model);
  assert.equal(isClaudeLike('openai/gpt-5'), false);
});

test('enabling OpenCode admits provider/model, Claude never goes through OpenCode and disabling Claude blocks Claude', () => {
  const policy = enabled();
  assert.equal(assertModelAllowed('openai/gpt-5', policy), 'openai/gpt-5');
  assert.equal(assertModelAllowed('opus', policy), 'claude-code/opus');
  assert.throws(() => assertModelAllowed('anthropic/claude-sonnet-4', policy, 'payload'), /payload.*solo con Claude Code, nunca por OpenCode/);
  assert.throws(() => assertModelAllowed('gpt-5', policy), /no es válido.*proveedor\/modelo/);
  assert.throws(() => assertModelAllowed('--model', policy), /no es válido/);
  assert.throws(() => assertModelAllowed('claude-code/', policy), /no es Claude Code válido/);
  const noClaude = executionPolicy({ providers: { claude: { enabled: false }, opencode: { enabled: true } }, executionDefaults: { chat: { client: 'opencode' }, handoff: { client: 'opencode' }, task: { client: 'opencode', model: 'openai/gpt-5' }, judge: { client: 'opencode', model: 'openai/gpt-5' } } });
  assert.throws(() => assertModelAllowed('sonnet', noClaude), /Claude Code, que está deshabilitado.*Habilita Claude Code/);
  assert.deepEqual(resolveHarnessModel(undefined, {}, undefined, noClaude), { model: 'openai/gpt-5', source: 'default' });
  assert.equal(resolveHarnessModel(undefined, {}, undefined, noClaude, 'judge').model, 'openai/gpt-5');
  // Client models: Claude only for the claude client; OpenCode needs provider/model; Codex any id that is not Claude.
  assert.equal(assertClientModel('claude', 'opus', policy), 'claude-code/opus');
  assert.equal(assertClientModel('opencode', 'openai/gpt-5', policy), 'openai/gpt-5');
  assert.equal(assertClientModel('codex', 'gpt-5-codex', policy), 'gpt-5-codex');
  assert.throws(() => assertClientModel('codex', 'claude-sonnet-4', policy), /solo con Claude Code/);
  assert.throws(() => assertClientModel('opencode', 'gpt-5', policy), /proveedor\/modelo/);
  assert.throws(() => assertClientModel('claude', 'openai/gpt-5', policy), /no es Claude Code/);
});

test('same precedence as the harness: contract, payload, config, area default', () => {
  const policy = enabled({ executionDefaults: { task: { client: 'opencode', model: 'openai/gpt-5-mini' } } });
  assert.deepEqual(resolveHarnessModel('openai/gpt-5', { model: 'claude-code/haiku' }, 'opus', policy), { model: 'claude-code/haiku', source: 'contract' });
  assert.deepEqual(resolveHarnessModel('openai/gpt-5', {}, 'opus', policy), { model: 'openai/gpt-5', source: 'payload' });
  assert.deepEqual(resolveHarnessModel('', {}, 'opus', policy), { model: 'claude-code/opus', source: 'config' });
  assert.deepEqual(resolveHarnessModel(null, {}, '', policy), { model: 'openai/gpt-5-mini', source: 'default' });
  assert.throws(() => resolveHarnessModel('sonnet', { model: 'anthropic/claude-x' }, undefined, policy), /contract/);
});

test('contract, judge and recursive children are all checked against the policy', () => {
  const contract = { model: 'claude-code/sonnet', judge: { model: 'openai/gpt-5' }, coordination: { children: [{ id: 'a', model: 'openai/gpt-5-mini', coordination: { children: [{ id: 'g', judge: { model: 'claude-code/haiku' } }] } }] } };
  assert.equal(assertContractAllowed(contract, enabled()), contract);
  assert.throws(() => assertContractAllowed(contract), /juez del contrato/);
  const grandchild = structuredClone(contract); grandchild.coordination.children[0].coordination.children[0].judge.model = 'anthropic/claude-opus';
  assert.throws(() => assertContractAllowed(grandchild, enabled()), /juez del hijo a\/g.*solo con Claude Code/);
  const child = structuredClone(contract); child.coordination.children[0].model = 'gpt-4';
  assert.throws(() => assertContractAllowed(child, enabled()), /hijo a/);
  assert.equal(assertContractAllowed({ goal: 'sin modelos' }).goal, 'sin modelos');
});

test('configurePolicy validates shape and consistency and never stores an unusable default', () => {
  const next = configurePolicy({}, { providers: { opencode: { enabled: true } }, defaults: { task: { client: 'opencode', model: 'openai/gpt-5' } } });
  assert.deepEqual(next.providers, { claude: { enabled: true }, opencode: { enabled: true }, codex: { enabled: false } });
  assert.deepEqual(next.executionDefaults.task, { client: 'opencode', model: 'openai/gpt-5' });
  assert.deepEqual(executionPolicy(next).defaults.judge, DEFAULT_POLICY.defaults.judge);
  for (const [patch, error] of [
    [{ providers: { opencode: { enabled: 'yes' } } }, /enabled/],
    [{ providers: { gemini: { enabled: true } } }, /Proveedor desconocido/],
    [{ unknown: true }, /desconocido/],
    [{ defaults: { review: { client: 'claude' } } }, /Área desconocida/],
    [{ defaults: { task: { client: 'codex', model: 'gpt-5' } } }, /motores del harness/],
    [{ defaults: { task: { client: 'claude', model: 'openai/gpt-5' } } }, /no corresponde a Claude Code/],
    [{ defaults: { task: { model: '' } } }, /Modelo vacío/],
    [{ defaults: { chat: { client: 'codex' } } }, /Habilita Codex/],
    [{ providers: { claude: { enabled: false } } }, /Habilita Claude Code/],
  ]) assert.throws(() => configurePolicy({}, patch), error, JSON.stringify(patch));
  // Disabling OpenCode while it is a default is refused, in one call with the default change it is accepted.
  assert.throws(() => configurePolicy(next, { providers: { opencode: { enabled: false } } }), /Tareas.*Habilita OpenCode/);
  assert.deepEqual(executionPolicy(configurePolicy(next, { providers: { opencode: { enabled: false } }, defaults: { task: { client: 'claude', model: 'claude-code/opus' } } })).defaults.task, { client: 'claude', model: 'claude-code/opus' });
  assert.throws(() => executionPolicy({ providers: 'all' }), /proveedores inválidos/);
  assert.throws(() => executionPolicy({ providers: { opencode: { enabled: 1 } } }), /OpenCode/);
});

test('history stays readable: a recorded OpenCode run is labeled as recorded, an unknown one never as Claude', () => {
  assert.equal(describeExecution({ requested: 'openai/gpt-5' }).engine, 'desconocido');
  assert.deepEqual(describeExecution({ requested: 'openai/gpt-5', engine: 'opencode', requestedSource: 'payload' }), { client: 'opencode', engine: 'opencode', requested: 'openai/gpt-5', requestedSource: 'payload', observed: null, status: 'unknown' });
  assert.equal(describeExecution({ requested: 'anthropic/claude-x', engine: 'opencode' }).engine, 'desconocido');
  assert.equal(describeExecution({ requested: 'claude-code/opus' }).engine, 'claude-code');
});

test('the engine hint describes the effective policy dynamically', t => {
  t.after(() => setExecutionPolicy());
  assert.match(POLICY_HINTS.engine, /claude-code\/sonnet/);
  assert.doesNotMatch(terminalPolicy({ workspaceId: 'w', nodeId: 'n', sessionId: 's', cwd: '/tree', branch: 'b' }), /opencode/i);
  setExecutionPolicy(enabled({ executionDefaults: { task: { client: 'opencode', model: 'openai/gpt-5' } } }));
  assert.match(POLICY_HINTS.engine, /OpenCode \(client "opencode"/); assert.match(POLICY_HINTS.engine, /Codex/); assert.match(POLICY_HINTS.engine, /"openai\/gpt-5" by default/);
  assert.ok(terminalPolicy({ workspaceId: 'w', nodeId: 'n', cwd: '/tree' }).includes(POLICY_HINTS.engine));
  assert.deepEqual({ ...POLICY_HINTS }.engine, POLICY_HINTS.engine);
  setExecutionPolicy();
  assert.equal(POLICY_HINTS.engine, engineHint(DEFAULT_POLICY));
  assert.doesNotMatch(POLICY_HINTS.engine, /OpenCode|Codex/);
});
