import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_INTERFACE_SCALE, validateInterfaceScale } from './interfaceScale';
import { api } from './useWorkspace';

export function useInterfaceScale() {
  const [state, setState] = useState({ scale: DEFAULT_INTERFACE_SCALE, loading: true, error: '' });
  const mounted = useRef(false);
  const busy = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    api('desktop.interfaceScale.get').then(result => {
      if (active) setState({ scale: validateInterfaceScale(result.scale), error: result.error || '', loading: false });
    }).catch(() => {
      if (active) setState(s => ({ ...s, loading: false, error: 'No se pudo consultar la escala. Elige un valor para reintentar.' }));
    }).finally(() => { if (active) busy.current = false; });
    return () => { active = false; mounted.current = false; };
  }, []);
  const update = useCallback(async value => {
    if (busy.current) return;
    busy.current = true;
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      validateInterfaceScale(value);
      const result = await api('desktop.interfaceScale.set', { scale: value });
      const scale = validateInterfaceScale(result.scale);
      if (mounted.current) setState({ scale, loading: false, error: result.error || '' });
    } catch (error) {
      if (mounted.current) setState(s => ({ ...s, loading: false, error: error.message || 'No se pudo guardar la escala.' }));
    } finally { busy.current = false; }
  }, []);
  return { ...state, update };
}
