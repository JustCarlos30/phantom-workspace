import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ErrorNotice, useOperation } from './ToolPanels';
import { Plus, Trash2 } from 'lucide-react';
export { Button, Field, ErrorNotice, DataView, useOperation } from './ToolPanels';

export function usePluginResource(load, key, interval = 0) {
  const loader = useRef(load); loader.current = load;
  const seq = useRef(0);
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(async (quiet = false) => {
    const id = ++seq.current;
    if (!quiet) setState(old => ({ ...old, loading: true, error: null }));
    try { const data = await loader.current(); if (id === seq.current) setState({ loading: false, data, error: null }); }
    catch (error) { if (id === seq.current) setState(old => ({ ...old, loading: false, error })); }
  }, [key]);
  useEffect(() => { setState({ loading: true, data: null, error: null }); reload(); const timer = interval ? setInterval(() => reload(true), interval) : null; return () => { seq.current++; if (timer) clearInterval(timer); }; }, [reload, interval]);
  return { ...state, reload };
}
export function ResourceNotice({ resource, empty }) {
  if (resource.loading) return <p role="status">Consultando Phantom…</p>;
  if (resource.error) return <ErrorNotice error={resource.error} retry={() => resource.reload()} />;
  if (resource.data?.available === false) return <div className="tw-warning" role="status"><p>{resource.data.reason || 'Phantom no disponible.'}</p><Button onClick={() => resource.reload()}>Reintentar conexión</Button></div>;
  if (empty && resource.data?.items?.length === 0) return <p className="tw-empty">{empty}</p>;
  return null;
}
export function DisabledPlugin({ workspace, api, refresh }) {
  const op = useOperation();
  return <section className="plugin-disabled"><h3>Phantom desactivado en este proyecto</h3><p>Este panel y sus referencias se conservan. Reactiva el plugin para consultar Cards y Skills.</p><ErrorNotice error={op.error} /><Button disabled={op.busy} onClick={() => op.run(async () => { await api('plugins.update', { workspaceId: workspace.id, pluginId: 'phantom', patch: { enabled: true } }); await refresh(); })}>Reactivar Phantom</Button></section>;
}
export function TextList({ label, values = [], onChange, hint }) {
  // Keep a local text buffer so a trailing newline can be entered naturally.
  const [text, setText] = useState(values.join('\n'));
  return <div className="tw-field"><label>{label}<textarea rows={3} value={text} onChange={e => { setText(e.target.value); onChange(e.target.value.split('\n').map(v => v.trim()).filter(Boolean)); }} /></label>{hint && <small>{hint}</small>}</div>;
}
export function Arguments({ value, onChange }) {
  return <div className="plugin-arguments">{value.map((arg, index) => <div className="tw-row" key={index}><label>{index ? `Argumento ${index}` : 'Ejecutable'}<input value={arg} onChange={e => onChange(value.map((old, i) => i === index ? e.target.value : old))} required /></label><Button icon={Trash2} aria-label={`Eliminar argumento ${index}`} disabled={index === 0} onClick={() => onChange(value.filter((_, i) => i !== index))} /></div>)}<Button icon={Plus} onClick={() => onChange([...value, ''])}>Añadir argumento</Button><small>Cada campo es un argumento completo; los espacios se conservan. No se usa shell.</small></div>;
}
