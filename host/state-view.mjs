import { publicSettings } from './public-settings.mjs';

// View of the state for callers (IPC and in-process). Callers may mutate what they
// receive, so it is cloned, but never the terminal history and, for a partial read,
// never the workspaces that were not asked for.
export function stateView(state, { workspaceId } = {}) {
  const workspace = workspaceId ? state.workspaces.find(w => w.id === workspaceId) : null;
  const { terminalHistory, workspaces, settings, ...rest } = state;
  const view = structuredClone(rest);
  view.settings = publicSettings(structuredClone(settings));
  if (!workspace) { view.workspaces = structuredClone(workspaces); return view; }
  return { ...view, workspaces: [structuredClone(workspace)], partial: true, workspaceId };
}
