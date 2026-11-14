export const INTERFACE_SCALES = Object.freeze([100, 115, 125, 150]);
export const DEFAULT_INTERFACE_SCALE = 115;

export function validateInterfaceScale(scale) {
  if (!INTERFACE_SCALES.includes(scale)) throw new Error('Escala no válida. Elige 100%, 115%, 125% o 150%.');
  return scale;
}

// One desktop-local preference, independent of workspace state and canvas camera.
// Injected storage keeps the model usable in main and testable without Electron.
export function createInterfaceScaleModel({ read, write, apply }) {
  let scale = DEFAULT_INTERFACE_SCALE, error = '', pending = Promise.resolve();
  const snapshot = () => ({ scale, error });
  const enqueue = operation => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  return {
    snapshot,
    load: () => enqueue(async () => {
      try {
        const saved = await read();
        scale = saved == null ? DEFAULT_INTERFACE_SCALE : validateInterfaceScale(saved.scale);
        error = '';
      } catch {
        scale = DEFAULT_INTERFACE_SCALE;
        error = 'No se pudo leer la escala guardada. Se usa 115%; elige una escala para volver a guardarla.';
      }
      return snapshot();
    }),
    get: () => pending.then(snapshot),
    set: value => enqueue(async () => {
      const next = validateInterfaceScale(value), previous = scale;
      try {
        await apply(next / 100);
        await write({ scale: next });
      } catch {
        await apply(previous / 100);
        throw new Error('No se pudo aplicar o guardar la escala. Se conserva la escala anterior; vuelve a intentarlo.');
      }
      scale = next;
      error = '';
      return snapshot();
    }),
  };
}
