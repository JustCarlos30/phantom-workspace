import { useEffect, useState } from 'react';

export const BACKGROUNDS = [
  ['tide', 'Marea', 'Profundidad verde petróleo'],
  ['ember', 'Brasa', 'Luz cálida y grafito'],
  ['plain', 'Grafito', 'Sin atmósfera, solo espacio'],
];
export const ACCENTS = [['blue', 'Azul', '#5b9cff'], ['orange', 'Naranja', '#f3a45b'], ['green', 'Verde', '#65ba83'], ['red', 'Rojo', '#f27670'], ['ivory', 'Marfil', '#f2f0eb']];
const VERSION = 4;
const retiredAccents = { lilac: 'blue', iris: 'blue', mint: 'green', amber: 'orange', rose: 'red', cyan: 'blue' };
export const defaults = { background: 'plain', accent: 'blue', grid: true, intensity: 55, image: '', gengar: false, gengarIntensity: 55, pulse: false, concentration: false };
const keyFor = id => `phantom:studio:${id || 'default'}`;
export function accentColor(key) {
  return (ACCENTS.find(([accent]) => accent === key) || ACCENTS.find(([accent]) => accent === defaults.accent))[2];
}
export function normalizeAppearance(saved = {}) {
  if (!saved || typeof saved !== 'object') saved = {};
  const intensity = Number.isFinite(saved.intensity) ? Math.min(100, Math.max(0, saved.intensity)) : defaults.intensity;
  const legacy = !Number.isFinite(saved.v) || saved.v < VERSION;
  const accent = legacy ? retiredAccents[saved.accent] || saved.accent : saved.accent;
  return {
    ...saved,
    background: BACKGROUNDS.some(([key]) => key === saved.background) ? saved.background : defaults.background,
    accent: ACCENTS.some(([key]) => key === accent) ? accent : defaults.accent,
    grid: typeof saved.grid === 'boolean' ? saved.grid : defaults.grid,
    intensity,
    image: typeof saved.image === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(saved.image) && saved.image.length < 2800000 ? saved.image : '',
    // Only an explicit artwork choice survives the retired ambient defaults.
    gengar: typeof saved.gengar === 'boolean' ? saved.gengar : defaults.gengar,
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
    const accent = accentColor(appearance.accent);
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
