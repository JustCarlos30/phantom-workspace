import { EFFORTS } from './chat-options.mjs';

export const ROUTING_DEFAULTS = {
  enabled: true,
  roles: {
    main: { model: 'opus', effort: 'medium' },
    orchestrator: { model: 'opus', effort: 'medium' },
    worker: { model: 'sonnet', effort: 'medium' },
  },
  agents: {
    buscador: { description: 'Localiza código con búsquedas amplias.', prompt: 'Localiza código relevante y resume las rutas y hallazgos.', model: 'haiku', effort: 'medium' },
    logs: { description: 'Lee y resume logs y salidas largas.', prompt: 'Resume los logs y destaca errores y evidencias relevantes.', model: 'haiku', effort: 'medium' },
    investigador: { description: 'Investiga en el repositorio o la web.', prompt: 'Investiga la consulta y presenta hallazgos con sus fuentes.', model: 'sonnet', effort: 'medium' },
    redactor: { description: 'Redacta documentación y textos.', prompt: 'Redacta textos claros y breves según el encargo.', model: 'sonnet', effort: 'medium' },
    revisor: { description: 'Revisa diffs de código.', prompt: 'Revisa el diff y señala errores concretos con evidencia.', model: 'sonnet', effort: 'high' },
    'revisor-nucleo': { description: 'Revisa gobernanza y seguridad.', prompt: 'Revisa el código de gobernanza o seguridad y señala riesgos concretos.', model: 'opus', effort: 'high' },
  },
};

function fields(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} debe ser un objeto`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key}: clave desconocida`);
}

function options(value, path, agent = false) {
  if (Object.hasOwn(value, 'model') && !(typeof value.model === 'string' &&
    (['haiku', 'sonnet', 'opus', 'fable', ...(agent ? ['inherit'] : [])].includes(value.model) || /^claude-[a-z0-9.-]+$/.test(value.model)))) throw new Error(`${path}.model inválido`);
  if (Object.hasOwn(value, 'effort') && !EFFORTS.claude.includes(value.effort)) throw new Error(`${path}.effort inválido`);
}

export function resolveRouting(settings) {
  const routing = settings?.routing;
  if (routing === undefined) return structuredClone(ROUTING_DEFAULTS);
  fields(routing, ['enabled', 'roles', 'agents'], 'routing');
  if (Object.hasOwn(routing, 'enabled') && typeof routing.enabled !== 'boolean') throw new Error('routing.enabled debe ser booleano');
  if (routing.enabled === false) return { enabled: false };
  const result = structuredClone(ROUTING_DEFAULTS);
  if (Object.hasOwn(routing, 'roles')) {
    fields(routing.roles, ['main', 'orchestrator', 'worker'], 'routing.roles');
    for (const [role, value] of Object.entries(routing.roles)) {
      const path = `routing.roles.${role}`;
      fields(value, ['model', 'effort', 'maxBudgetUsd'], path);
      options(value, path);
      if (Object.hasOwn(value, 'maxBudgetUsd') && !(Number.isFinite(value.maxBudgetUsd) && value.maxBudgetUsd > 0)) throw new Error(`${path}.maxBudgetUsd debe ser un número finito > 0`);
      result.roles[role] = { ...result.roles[role], ...value };
    }
  }
  if (Object.hasOwn(routing, 'agents')) {
    if (!routing.agents || typeof routing.agents !== 'object' || Array.isArray(routing.agents)) throw new Error('routing.agents debe ser un objeto');
    for (const [name, value] of Object.entries(routing.agents)) {
      const path = `routing.agents.${name}`;
      fields(value, ['description', 'prompt', 'model', 'effort'], path);
      options(value, path, true);
      const agent = { ...(Object.hasOwn(result.agents, name) ? result.agents[name] : {}), ...value };
      if (typeof agent.description !== 'string' || !agent.description.trim()) throw new Error(`${path}.description debe ser un string no vacío`);
      if (typeof agent.prompt !== 'string') throw new Error(`${path}.prompt debe ser un string`);
      Object.defineProperty(result.agents, name, { value: agent, enumerable: true, writable: true, configurable: true });
    }
  }
  return result;
}

export function roleOfChat(node) {
  return node?.data?.main ? 'main' : node?.data?.role === 'orchestrator' ? 'orchestrator' : 'worker';
}

export function claudeRoutingArgs(routing, role, { model, reasoning }) {
  if (!routing || routing.enabled === false) return { model, effort: reasoning, extra: [] };
  const config = routing.roles[role];
  return {
    model: model ?? config.model,
    effort: reasoning ?? config.effort,
    extra: ['--agents', JSON.stringify(routing.agents), ...(config.maxBudgetUsd === undefined ? [] : ['--max-budget-usd', String(config.maxBudgetUsd)])],
  };
}
