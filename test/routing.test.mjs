import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTING_DEFAULTS, resolveRouting, roleOfChat, claudeRoutingArgs } from '../shared/routing.mjs';
import { providerArgs } from '../host/chats.mjs';

const names = ['buscador', 'logs', 'investigador', 'redactor', 'revisor', 'revisor-nucleo'];
const args = (role, options = {}, config = resolveRouting()) => providerArgs('claude', { ...options, routing: { role, config } });
const flag = (argv, name) => argv[argv.indexOf(name) + 1];

test('defaults por rol y agentes por actividad', () => {
  assert.deepEqual(ROUTING_DEFAULTS.roles, {
    main: { model: 'opus', effort: 'medium' },
    orchestrator: { model: 'opus', effort: 'medium' },
    worker: { model: 'sonnet', effort: 'medium' },
  });
  assert.deepEqual(Object.keys(ROUTING_DEFAULTS.agents), names);
  for (const [index, agent] of Object.values(ROUTING_DEFAULTS.agents).entries()) {
    assert.ok(agent.description.trim());
    assert.equal(typeof agent.prompt, 'string');
    assert.equal(agent.model, ['haiku', 'haiku', 'sonnet', 'sonnet', 'sonnet', 'opus'][index]);
    assert.equal(agent.effort, index < 4 ? 'medium' : 'high');
  }
});

test('routing ausente entrega una copia independiente', () => {
  const config = resolveRouting({});
  assert.deepEqual(config, ROUTING_DEFAULTS);
  config.roles.main.model = 'haiku';
  config.agents.logs.prompt = 'Otro';
  assert.equal(ROUTING_DEFAULTS.roles.main.model, 'opus');
  assert.notEqual(ROUTING_DEFAULTS.agents.logs.prompt, 'Otro');
});

test('routing desactivado', () => {
  assert.deepEqual(resolveRouting({ routing: { enabled: false } }), { enabled: false });
});

test('overrides válidos fusionan roles y agentes', () => {
  const config = resolveRouting({ routing: {
    roles: { worker: { model: 'claude-sonnet-4.6', effort: 'max', maxBudgetUsd: 1.5 }, main: { model: 'fable' } },
    agents: { logs: { model: 'inherit' }, nuevo: { description: 'Nuevo agente', prompt: '' } },
  } });
  assert.deepEqual(config.roles.worker, { model: 'claude-sonnet-4.6', effort: 'max', maxBudgetUsd: 1.5 });
  assert.deepEqual(config.roles.main, { model: 'fable', effort: 'medium' });
  assert.equal(config.agents.logs.model, 'inherit');
  assert.equal(config.agents.logs.prompt, ROUTING_DEFAULTS.agents.logs.prompt);
  assert.equal(config.agents.nuevo.prompt, '');
});

for (const [name, routing] of [
  ['clave raíz', { other: true }],
  ['rol desconocido', { roles: { other: {} } }],
  ['campo de rol', { roles: { main: { other: true } } }],
  ['campo de agente', { agents: { logs: { other: true } } }],
  ['modelo', { roles: { main: { model: 'invalid' } } }],
  ['inherit en rol', { roles: { main: { model: 'inherit' } } }],
  ['modelo de agente', { agents: { logs: { model: 'invalid' } } }],
  ['effort', { roles: { main: { effort: 'invalid' } } }],
  ['effort de agente', { agents: { logs: { effort: 'invalid' } } }],
  ['enabled', { enabled: 'false' }],
  ['description vacía', { agents: { logs: { description: ' ' } } }],
  ['prompt inválido', { agents: { logs: { prompt: null } } }],
  ['agente sin description', { agents: { nuevo: { prompt: 'Texto' } } }],
  ['agente sin prompt', { agents: { nuevo: { description: 'Texto' } } }],
  ['roles no objeto', { roles: [] }],
  ['agents no objeto', { agents: null }],
  ...[0, -1, NaN, '1', Infinity].map(value => [`presupuesto ${String(value)} (${typeof value})`, { roles: { worker: { maxBudgetUsd: value } } }]),
]) test(`rechaza ${name}`, () => {
  assert.throws(() => resolveRouting({ routing }), /routing/);
});

test('card explícita conserva modelo, effort y posiciones; añade agentes al final', () => {
  const options = { model: 'haiku', reasoning: 'high', sessionId: 'session', instructions: 'Instrucciones' };
  const base = providerArgs('claude', options);
  const argv = args('main', options);
  assert.deepEqual(argv.slice(0, base.length), base);
  assert.equal(flag(argv, '--model'), 'haiku');
  assert.equal(flag(argv, '--effort'), 'high');
  assert.equal(argv.at(-2), '--agents');
});

for (const [role, model] of [['main', 'opus'], ['orchestrator', 'opus'], ['worker', 'sonnet']]) {
  test(`argv sin ajustes para ${role}`, () => {
    const argv = args(role);
    assert.equal(flag(argv, '--model'), model);
    assert.equal(flag(argv, '--effort'), 'medium');
    assert.deepEqual(Object.keys(JSON.parse(flag(argv, '--agents'))), names);
    assert.equal(argv.includes('--max-budget-usd'), false);
  });
}

test('routing apagado conserva argv exactamente', () => {
  for (const options of [{}, { model: 'sonnet', reasoning: 'low', sessionId: 'abc', mode: 'auto', instructions: 'Texto' }]) {
    assert.deepEqual(args('main', options, { enabled: false }), providerArgs('claude', options));
  }
});

test('presupuesto solo para el rol configurado y al final', () => {
  const config = resolveRouting({ routing: { roles: { main: { maxBudgetUsd: 2.5 } } } });
  assert.deepEqual(args('main', {}, config).slice(-2), ['--max-budget-usd', '2.5']);
  assert.equal(args('worker', {}, config).includes('--max-budget-usd'), false);
});

for (const provider of ['codex', 'opencode']) test(`${provider} ignora routing`, () => {
  const options = { model: 'modelo', sessionId: 'abc', instructions: 'Texto' };
  assert.deepEqual(providerArgs(provider, { ...options, routing: { role: 'main', config: resolveRouting() } }), providerArgs(provider, options));
});

test('roleOfChat prioriza main sobre orchestrator', () => {
  assert.equal(roleOfChat({ data: { main: true, role: 'orchestrator' } }), 'main');
  assert.equal(roleOfChat({ data: { role: 'orchestrator' } }), 'orchestrator');
  assert.equal(roleOfChat({ data: {} }), 'worker');
  assert.equal(roleOfChat(), 'worker');
});

test('helper sin routing conserva los ajustes explícitos', () => {
  assert.deepEqual(claudeRoutingArgs(undefined, 'main', { model: 'opus', reasoning: 'low' }), { model: 'opus', effort: 'low', extra: [] });
  assert.deepEqual(claudeRoutingArgs(undefined, 'main', {}), { model: undefined, effort: undefined, extra: [] });
});
