export function mergePartialState(previous, partial) {
  if (!partial?.partial || !previous) return null;
  const incoming = partial.workspaces?.[0];
  if (!incoming) return null;
  const index = previous.workspaces.findIndex(w => w.id === incoming.id);
  if (index < 0) return null;
  const { workspaces, partial: _p, workspaceId: _w, ...top } = partial;
  const next = previous.workspaces.slice(); next[index] = incoming;
  return { ...previous, ...top, workspaces: next };
}
