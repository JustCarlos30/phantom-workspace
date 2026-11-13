import { CONVENCIONS_PLUGIN } from '../../shared/plugins.mjs';

export const convencionsPlugin = Object.freeze({
  ...CONVENCIONS_PLUGIN, title: CONVENCIONS_PLUGIN.name, firstParty: true,
  configuration: { connection: 'host', refresh: 'manual' },
  commands: CONVENCIONS_PLUGIN.actions.map(action => ({ ...action, title: action.name })),
});
