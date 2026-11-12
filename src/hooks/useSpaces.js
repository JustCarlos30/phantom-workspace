import { useCallback, useMemo, useRef, useState } from 'react';

// Spaces are named views of one project (Dev, Review, Docs…). The list and
// each space's camera live in the host workspace; a panel belongs to a space
// through data.spaceId, and panels without one belong to the main space.
// Which space is open is a per-window preference, kept in localStorage.
const key = id => `phantom.space.${id}`;
const read = id => { try { return localStorage.getItem(key(id)) || null; } catch { return null; } };
const write = (id, value) => { try { value ? localStorage.setItem(key(id), value) : localStorage.removeItem(key(id)); } catch { /* preference only */ } };
export const spaceOf = node => node?.data?.spaceId || null;

export function useSpaces({ workspace, patch, onChange }) {
  const [, force] = useState(0);
  const spaces = useMemo(() => Array.isArray(workspace?.spaces) ? workspace.spaces : [], [workspace?.spaces]);
  const stored = workspace ? read(workspace.id) : null;
  const active = stored && spaces.some(s => s.id === stored) ? stored : null;
  const activeSpace = spaces.find(s => s.id === active) || null;
  const live = useRef({}); live.current = { workspace, spaces, active };

  const view = useMemo(() => workspace && {
    ...workspace,
    camera: activeSpace ? activeSpace.camera : workspace.camera,
    // Orphans (a deleted space) fall back to the main space instead of vanishing.
    nodes: (workspace.nodes || []).filter(n => {
      const s = spaceOf(n);
      return active ? s === active : !s || !spaces.some(sp => sp.id === s);
    }),
  }, [workspace, activeSpace, active, spaces]);

  const select = useCallback(id => {
    const w = live.current.workspace; if (!w) return;
    write(w.id, id && live.current.spaces.some(s => s.id === id) ? id : null);
    force(n => n + 1);
  }, []);
  const save = useCallback(next => { const w = live.current.workspace; if (w) patch(w.id, null, { spaces: next }); }, [patch]);
  const create = useCallback(name => {
    const w = live.current.workspace; if (!w) return null;
    const camera = w.camera || { x: 0, y: 0, zoom: 1 };
    const space = { id: crypto.randomUUID(), name: name.trim().slice(0, 80) || `Espacio ${live.current.spaces.length + 2}`, camera: { ...camera } };
    save([...live.current.spaces, space]);
    write(w.id, space.id); force(n => n + 1);
    return space;
  }, [save]);
  const rename = useCallback((id, name) => {
    const value = name.trim().slice(0, 80); if (!value) return;
    save(live.current.spaces.map(s => s.id === id ? { ...s, name: value } : s));
  }, [save]);
  const remove = useCallback(id => {
    const { workspace: w, spaces: list, active: current } = live.current; if (!w) return;
    // Panels of a removed space return to the main space; nothing is deleted.
    for (const n of w.nodes || []) if (spaceOf(n) === id) { const { spaceId, ...data } = n.data; onChange(n.id, { data }); }
    save(list.filter(s => s.id !== id));
    if (current === id) { write(w.id, null); force(n => n + 1); }
  }, [save, onChange]);
  const moveNodes = useCallback((ids, spaceId) => {
    const w = live.current.workspace; if (!w) return;
    for (const n of w.nodes || []) if (ids.includes(n.id)) {
      const { spaceId: _, ...data } = n.data || {};
      onChange(n.id, { data: spaceId ? { ...data, spaceId } : data });
    }
  }, [onChange]);
  const onCamera = useCallback((camera, workspaceId) => {
    const { workspace: w, spaces: list, active: current } = live.current;
    if (!w || (workspaceId && workspaceId !== w.id)) return;
    if (current) save(list.map(s => s.id === current ? { ...s, camera } : s));
    else patch(w.id, null, { camera });
  }, [save, patch]);
  // Opening a panel that lives in another space switches to that space first.
  const reveal = useCallback(id => {
    const n = live.current.workspace?.nodes?.find(node => node.id === id); if (!n) return;
    const s = spaceOf(n), target = s && live.current.spaces.some(sp => sp.id === s) ? s : null;
    if (target !== live.current.active) select(target);
  }, [select]);
  const withSpace = useCallback(data => live.current.active ? { ...data, spaceId: live.current.active } : data, []);

  return { spaces, active, activeSpace, view, select, create, rename, remove, moveNodes, onCamera, reveal, withSpace };
}
