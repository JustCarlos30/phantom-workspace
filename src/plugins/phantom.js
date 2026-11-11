export const phantomPlugin = Object.freeze({
  id: 'phantom', title: 'Phantom', version: '1.0.0', firstParty: true,
  description: 'Centro de mando de tareas y cards de la familia de worktrees.',
  configuration: { connection: 'host', refreshMs: { default: 4000, min: 3000, max: 5000 } },
  panels: [{ id: 'command-center', title: 'Centro de mando' }],
  commands: [{ id: 'phantom.command-center', title: 'Abrir Centro de mando', panelId: 'command-center' }],
});
