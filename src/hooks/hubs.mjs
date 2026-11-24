// Five destinations instead of twenty-five panels. Each hub is an existing
// node type that hosts its neighbours as tabs, so saved canvases keep working
// and no new node type reaches the host.
// tab: [id, label, content type rendered inside the hub]
export const HUBS = {
  tasks: { name: 'Trabajo', hint: 'Tareas de Phantom, pendientes y misiones', tabs: [['cards', 'Tareas', 'phantom-cards'], ['tasks', 'Pendientes', 'tasks'], ['mission', 'Misiones', 'mission']] },
  repo: { name: 'Git', hint: 'Ramas, historial y cola de integración', tabs: [['branches', 'Ramas', 'branches'], ['repo', 'Historial', 'repo'], ['incorporaciones', 'Cola', 'incorporaciones']] },
  services: { name: 'Entorno', hint: 'Cómo arrancar, procesos, puertos y contenedores', tabs: [['services', 'Este proyecto', 'services'], ['docker', 'Docker', 'docker'], ['sites', 'Todos los proyectos', 'sites']] },
  context: { name: 'Contexto', hint: 'Documentos, memoria y skills', tabs: [['context', 'Documentos y memoria', 'context'], ['skills-catalog', 'Skills', 'skills-catalog']] },
  workflows: { name: 'Automatizar', hint: 'Pasos repetibles, navegador y código', tabs: [['workflows', 'Secuencias', 'workflows'], ['playwright', 'Navegador', 'playwright'], ['playground', 'Código', 'playground']] },
};
export const HUB_ORDER = ['tasks', 'repo', 'services', 'context', 'workflows'];
export const HUB_DOCK = ['tasks', 'repo', 'services'];
export const HUB_MORE = ['context', 'workflows'];

// Panel types that used to stand alone now open their hub on the right tab.
export const HUB_ALIAS = {
  'phantom-cards': ['tasks', 'cards'], 'command-center': ['tasks', 'cards'], mission: ['tasks', 'mission'],
  branches: ['repo', 'branches'], git: ['repo', 'branches'], incorporaciones: ['repo', 'incorporaciones'],
  docker: ['services', 'docker'], processes: ['services', 'services'], 'skills-catalog': ['context', 'skills-catalog'],
  playwright: ['workflows', 'playwright'], playground: ['workflows', 'playground'],
};

// Resolves what to open for a requested type. A request that carries its own
// target (a card, a reference, a node to focus) keeps its dedicated panel.
export function resolveHub(type, data = {}) {
  if (data.cardId || data.ref || data.focusNodeId) return { type, tab: null };
  const alias = HUB_ALIAS[type];
  if (alias) return { type: alias[0], tab: alias[1] };
  return { type, tab: null };
}

export function hubTab(type, wanted) {
  const tabs = HUBS[type]?.tabs || [];
  return tabs.find(tab => tab[0] === wanted) || tabs[0] || null;
}
