import { VIDEO_LOG_PLUGIN } from '../../shared/plugins.mjs';

export const videoLogPlugin = Object.freeze({
  ...VIDEO_LOG_PLUGIN, title: VIDEO_LOG_PLUGIN.name, firstParty: true,
  configuration: { ...VIDEO_LOG_PLUGIN.configuration, connection: 'host', refresh: 'manual' },
  commands: VIDEO_LOG_PLUGIN.actions.map(action => ({ ...action, title: action.name })),
});
