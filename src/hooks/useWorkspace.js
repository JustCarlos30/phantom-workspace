import { useCallback, useEffect, useRef, useState } from 'react';
import { createSaveQueue } from './saveQueue';
import { createCloseHandler } from './closeProtocol';
import { createDraftRegistry } from './inlineName';
import { structuralShare } from './structuralShare';
import { createEventHub } from './eventHub.js';

export const api = (method, payload = {}) => {
  if (!window.phantom?.invoke) return Promise.reject(new Error('Abre la aplicación de escritorio'));
  return window.phantom.invoke(method, payload);
};
const hub = createEventHub(listener => window.phantom?.onEvent?.(listener) || (() => {}));
export const subscribe = callback => hub.subscribe(callback);
export const subscribeSession = (sessionId, callback) => hub.subscribeSession(sessionId, callback);

export function useWorkspace(notify) {
  const [state, setState] = useState(null);
  const [stateReadAt, setStateReadAt] = useState(null);
  const [readError, setReadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState({ status: 'connecting', message: '' });
  const [closeRequest, setCloseRequest] = useState(null);
  const transport = useRef({ status: 'connecting', revision: 0 });
  const queue = useRef(null);
  const timer = useRef();
  const generation = useRef(0);
  const mounted = useRef(true);
  const beforeFlush = useRef(null);
  if (!beforeFlush.current) beforeFlush.current = createDraftRegistry();
  const registerBeforeFlush = useCallback(prepare => beforeFlush.current.register(prepare), []);
  const callbacks = useRef({});
  const overlay = useCallback(incoming => ({ ...incoming, workspaces: incoming.workspaces.map(w => ({
    ...w, ...queue.current?.entries.get(`workspace:${w.id}`)?.patch,
    nodes: (w.nodes || []).map(n => ({ ...n, ...queue.current?.entries.get(`${w.id}:${n.id}`)?.patch })),
  })) }), []);
  const refresh = useCallback(async () => {
    if (transport.current.revision && transport.current.status !== 'connected') throw new Error('Espera a recuperar la conexión para actualizar el proyecto.');
    const version = ++generation.current, transportRevision = transport.current.revision;
    try {
      const next = await api('state.get');
      if (transport.current.revision !== transportRevision) throw new Error('La conexión cambió durante la lectura. Espera a la reconexión.');
      if (mounted.current && version === generation.current) { setState(previous => structuralShare(previous, overlay(next))); setStateReadAt(Date.now()); setReadError(''); }
      // Bootstrap only: operation/read errors never define transport status.
      if (transport.current.status === 'connecting' && transportRevision === 0) {
        transport.current.status = 'connected';
        if (mounted.current) setConnection({ status: 'connected', message: '' });
      }
      return next;
    } catch (e) { if (mounted.current && version === generation.current) setReadError(e.message); throw e; }
  }, [overlay]);
  callbacks.current = { refresh, notify };
  if (!queue.current) queue.current = createSaveQueue({
    invoke: (method, payload) => transport.current.status === 'connected' ? api(method, payload) : Promise.reject(new Error('Conexión interrumpida; los cambios pendientes se conservan.')),
    refresh: () => callbacks.current.refresh(),
    onSaving: value => { if (mounted.current) setSaving(value); },
    onSaved: () => { if (mounted.current) setSaveError(''); },
    onError: e => {
      if (mounted.current) setSaveError(`Guardado pendiente: ${e.message}`);
      callbacks.current.notify(`No se guardó el cambio: ${e.message}`, 'error');
    },
  });
  const flush = useCallback(({ prepare = true } = {}) => {
    clearTimeout(timer.current);
    if (prepare) {
      try { beforeFlush.current.prepare(); }
      catch (error) { if (mounted.current) setSaveError(error.message); return Promise.reject(error); }
    }
    if (queue.current.draining) return queue.current.draining;
    if (queue.current.entries.size && transport.current.status !== 'connected') return Promise.reject(new Error('Espera a recuperar la conexión para guardar los cambios pendientes.'));
    return queue.current.flush().then(result => { if (mounted.current) setSaveError(''); return result; });
  }, []);
  const patch = useCallback((workspaceId, id, change) => {
    const key = id ? `${workspaceId}:${id}` : `workspace:${workspaceId}`;
    queue.current.enqueue(key, id ? 'node.update' : 'workspace.update', id ? { workspaceId, id } : { id: workspaceId }, change);
    setState(s => s ? structuralShare(s, overlay(s)) : s);
    clearTimeout(timer.current); timer.current = setTimeout(() => { if (transport.current.status === 'connected') flush({ prepare: false }).catch(() => {}); }, 350);
  }, [flush, overlay]);
  const closeHandler = useRef(null);
  if (!closeHandler.current) closeHandler.current = createCloseHandler({ flush, invoke: api,
    onStatus: value => { if (mounted.current) setCloseRequest(value); },
    onError: e => callbacks.current.notify(`No se cerró la ventana: ${e.message}. Reintenta guardar o elige descartar en el diálogo del escritorio.`, 'error'),
  });
  const finishClose = useCallback(requestId => closeHandler.current(requestId), []);
  useEffect(() => {
    mounted.current = true;
    let eventTimer;
    const off = subscribe(e => {
      if (e.type === 'desktop.beforeClose' && e.requestId) { finishClose(e.requestId); return; }
      if (e.type === 'desktop.closeCancelled' && e.requestId) { closeHandler.current.cancel(e.requestId); return; }
      if (e.type === 'connection') {
        const status = ['connected', 'disconnected', 'reconnecting', 'connecting', 'error'].includes(e.status) ? e.status : 'error';
        const previous = transport.current.status;
        if (status === 'connected' && previous === 'connected') return;
        transport.current = { status, revision: transport.current.revision + 1 };
        setConnection({ status, message: e.message || '' });
        clearTimeout(eventTimer); ++generation.current;
        if (status === 'connected' && previous !== 'connected') {
          // Retry acknowledged and pending writes before replacing the snapshot.
          const activeDrain = queue.current.draining;
          Promise.resolve(activeDrain).catch(() => {}).then(() => queue.current.entries.size ? flush() : refresh()).catch(() => {});
        }
        return;
      }
      if (transport.current.status === 'connected' && ['state.changed', 'attention.new', 'terminal.exit'].includes(e.type)) {
        clearTimeout(eventTimer); eventTimer = setTimeout(() => refresh().catch(() => {}), 100);
      }
    });
    refresh().catch(() => {});
    const save = () => { flush().catch(() => {}); };
    window.addEventListener('pagehide', save);
    return () => { mounted.current = false; off(); clearTimeout(eventTimer); save(); window.removeEventListener('pagehide', save); };
  }, [refresh, flush, finishClose]);
  const connectionError = connection.status !== 'connected' && connection.status !== 'connecting'
    ? connection.message || (connection.status === 'reconnecting' ? 'Reconectando con el host local…' : 'Host local desconectado. Tu disposición se conserva en esta ventana.') : '';
  return { state, stateReadAt, error: saveError || connectionError || readError, saveError, connection, saving, refresh, patch, flush, registerBeforeFlush, closeRequest, retryClose: () => closeRequest && finishClose(closeRequest.requestId) };
}
