import { useEffect, useState } from 'react';

export const BACKGROUNDS = [
  ['gengar', 'Gengar', 'Arte oficial entre grafito y bruma violeta'],
  ['aurora', 'Aurora', 'Atmósfera azul y violeta'],
  ['tide', 'Marea', 'Profundidad verde petróleo'],
  ['ember', 'Brasa', 'Luz cálida y grafito'],
  ['plain', 'Grafito', 'Sin atmósfera, solo espacio'],
];
export const ACCENTS = [['lilac', 'Lila', '#b48cff'], ['iris', 'Iris', '#8fa2ff'], ['mint', 'Menta', '#6fdcb4'], ['amber', 'Arena', '#e8c48a'], ['rose', 'Rosa', '#f29ac4'], ['cyan', 'Cian', '#6fe3f2']];
// v2 (Fantasma violeta): Lila replaced Iris as the default accent.
const VERSION = 2;
const defaults = { background: 'gengar', accent: 'lilac', grid: true, intensity: 55, image: '' };
const keyFor = id => `phantom:studio:${id || 'default'}`;
function load(id) {
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(id))) || {};
    return {
      background: BACKGROUNDS.some(([key]) => key === saved.background) ? saved.background : defaults.background,
      // Pre-v2 'iris' was the untouched default, so it migrates to the new default.
      accent: saved.accent === 'iris' && saved.v !== VERSION ? defaults.accent : ACCENTS.some(([key]) => key === saved.accent) ? saved.accent : defaults.accent,
      grid: typeof saved.grid === 'boolean' ? saved.grid : defaults.grid,
      intensity: Number.isFinite(saved.intensity) ? Math.min(100, Math.max(0, saved.intensity)) : defaults.intensity,
      image: typeof saved.image === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(saved.image) && saved.image.length < 2800000 ? saved.image : '',
    };
  } catch { return { ...defaults }; }
}

export function useAppearance(workspaceId, notify) {
  const [entry, setEntry] = useState(() => ({ id: workspaceId, value: load(workspaceId) }));
  // Never copy the previous project's preferences across a workspace switch.
  const appearance = entry.id === workspaceId ? entry.value : load(workspaceId);
  useEffect(() => {
    const accent = ACCENTS.find(([key]) => key === appearance.accent)[2];
    document.documentElement.style.setProperty('--accent', accent);
    return () => document.documentElement.style.removeProperty('--accent');
  }, [appearance.accent]);
  const update = change => {
    const next = { ...appearance, ...change, v: VERSION };
    try { localStorage.setItem(keyFor(workspaceId), JSON.stringify(next)); }
    catch { notify('No se pudo guardar la apariencia local. Libera espacio y vuelve a intentarlo.', 'error'); return false; }
    setEntry({ id: workspaceId, value: next });
    return true;
  };
  return { appearance, update, reset: () => update(defaults) };
}
