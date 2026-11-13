import { useEffect, useState } from 'react';

export const BACKGROUNDS = [
  ['gengar', 'Gengar', 'Ciruela casi negra y violeta profundo'],
  ['aurora', 'Aurora', 'Atmósfera azul y violeta'],
  ['tide', 'Marea', 'Profundidad verde petróleo'],
  ['ember', 'Brasa', 'Luz cálida y grafito'],
  ['plain', 'Grafito', 'Sin atmósfera, solo espacio'],
];
export const ACCENTS = [['lilac', 'Violeta', '#a78bda'], ['iris', 'Iris', '#8fa2ff'], ['mint', 'Menta', '#7cc9a0'], ['amber', 'Arena', '#e3bf86'], ['rose', 'Rosa', '#f29ac4'], ['cyan', 'Cian', '#6fe3f2']];
// v2 (Fantasma violeta): Lila replaced Iris as the default accent.
const VERSION = 3;
export const defaults = { background: 'gengar', accent: 'lilac', grid: true, intensity: 55, image: '', gengar: true, gengarIntensity: 55, pulse: false, concentration: false };
const keyFor = id => `phantom:studio:${id || 'default'}`;
export function normalizeAppearance(saved = {}) {
  if (!saved || typeof saved !== 'object') saved = {};
  const intensity = Number.isFinite(saved.intensity) ? Math.min(100, Math.max(0, saved.intensity)) : defaults.intensity;
  return {
    ...saved,
    background: BACKGROUNDS.some(([key]) => key === saved.background) ? saved.background : defaults.background,
    accent: saved.accent === 'iris' && (!Number.isFinite(saved.v) || saved.v < 2) ? defaults.accent : ACCENTS.some(([key]) => key === saved.accent) ? saved.accent : defaults.accent,
    grid: typeof saved.grid === 'boolean' ? saved.grid : defaults.grid,
    intensity,
    image: typeof saved.image === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(saved.image) && saved.image.length < 2800000 ? saved.image : '',
    // Legacy artwork shared the ambient slider and appeared only on Gengar.
    gengar: typeof saved.gengar === 'boolean' ? saved.gengar : (!saved.background || saved.background === 'gengar') && !saved.image,
    gengarIntensity: Number.isFinite(saved.gengarIntensity) ? Math.min(100, Math.max(0, saved.gengarIntensity)) : intensity,
    pulse: typeof saved.pulse === 'boolean' ? saved.pulse : false,
    concentration: typeof saved.concentration === 'boolean' ? saved.concentration : false,
    v: VERSION,
  };
}
export function loadAppearance(id) {
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(id))) || {};
    return normalizeAppearance(saved);
  } catch { return normalizeAppearance(); }
}

export function useAppearance(workspaceId, notify) {
  const [entry, setEntry] = useState(() => ({ id: workspaceId, value: loadAppearance(workspaceId) }));
  // Never copy the previous project's preferences across a workspace switch.
  const appearance = entry.id === workspaceId ? entry.value : loadAppearance(workspaceId);
  useEffect(() => {
    const accent = ACCENTS.find(([key]) => key === appearance.accent)[2];
    document.documentElement.style.setProperty('--accent', accent);
    return () => document.documentElement.style.removeProperty('--accent');
  }, [appearance.accent]);
  const update = change => {
    const next = normalizeAppearance({ ...appearance, ...change, v: VERSION });
    try { localStorage.setItem(keyFor(workspaceId), JSON.stringify(next)); }
    catch { notify('No se pudo guardar la apariencia local. Libera espacio y vuelve a intentarlo.', 'error'); return false; }
    setEntry({ id: workspaceId, value: next });
    return true;
  };
  return { appearance, update, reset: () => update(defaults) };
}
