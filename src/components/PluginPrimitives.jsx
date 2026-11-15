import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import EmptyState from './EmptyState.jsx';

export function Button({ children, icon: Icon, tone, type = 'button', className = '', ...props }) {
  return <button {...props} type={type} className={`plugin-button tw-button ${tone ? `tw-${tone}` : ''} ${className}`}>{Icon && <Icon size={15} aria-hidden="true" />}{children}</button>;
}

export function Field({ label, children, hint }) {
  const generatedId = useId();
  const id = children.props.id || generatedId;
  const describedBy = [children.props['aria-describedby'], hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return <div className="plugin-field tw-field"><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id, 'aria-describedby': describedBy })}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}

export function ErrorNotice({ error, retry, clear }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message || 'No se pudo completar la operación.';
  return <div className="plugin-error tw-error" role="alert"><span>{message}</span><div className="tw-row">{retry && <Button icon={RefreshCw} onClick={retry}>Reintentar</Button>}{clear && <Button onClick={clear}>Descartar error</Button>}</div></div>;
}

export function DataView({ value, label = 'Datos de la fuente' }) {
  return <details className="plugin-data tw-details"><summary>{label}</summary><pre className="tw-code">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></details>;
}

export function useOperation(notify) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const lock = useRef(false), mounted = useRef(true), last = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (fn, success) => {
    if (lock.current) return;
    last.current = { fn, success };
    lock.current = true;
    setBusy(true); setError(null);
    try {
      const value = await fn();
      if (mounted.current && success) notify?.(success, 'success');
      return { ok: true, value };
    } catch (failure) {
      if (mounted.current) setError(failure);
      return { ok: false, error: failure };
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError(null), retry: () => last.current && run(last.current.fn, last.current.success) };
}

export function useResource(api, method, payload, { enabled = true } = {}) {
  const key = JSON.stringify(payload), sequence = useRef(0);
  const [result, setResult] = useState({ loading: enabled, data: null, error: null });
  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    setResult(old => ({ ...old, loading: true, error: null }));
    try {
      const data = await api(method, JSON.parse(key));
      if (seq === sequence.current) setResult({ loading: false, data, error: null });
      return data;
    } catch (error) {
      if (seq === sequence.current) setResult({ loading: false, data: null, error });
    }
  }, [api, method, key]);
  useEffect(() => {
    setResult({ loading: enabled, data: null, error: null });
    if (enabled) reload();
    return () => { sequence.current++; };
  }, [reload, enabled]);
  return { ...result, reload };
}

export function OperationState({ op }) {
  return <><ErrorNotice error={op.error} retry={op.retry} clear={op.clear} />{op.busy && <p className="plugin-loading tw-muted" role="status">Procesando…</p>}</>;
}

export function ResourceState({ resource, empty = 'No hay elementos.' }) {
  if (resource.loading) return <p className="plugin-loading tw-muted" role="status">Consultando la fuente…</p>;
  if (resource.error) return <ErrorNotice error={resource.error} retry={resource.reload} />;
  if (resource.data?.available === false) return <div className="plugin-unavailable tw-warning" role="status">{resource.data.reason || 'Fuente no disponible.'}<Button onClick={resource.reload}>Reintentar</Button></div>;
  if (empty && Array.isArray(resource.data?.items) && !resource.data.items.length) return <EmptyState className="plugin-empty tw-empty" description={empty} />;
  return null;
}

// Grouped-list primitives for Configuración (styles in settings.css): a group
// is one rounded object, a row is a label with its value or control on the right.
export function Group({ title, note, children }) {
  return <section className="st-group">{title && <h3>{title}</h3>}<div className="st-list">{children}</div>{note && <p className="st-note">{note}</p>}</section>;
}
export function Row({ label, hint, htmlFor, children, stack }) {
  return <div className={`st-row${stack ? ' is-stack' : ''}`}><div className="st-row-text">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}{hint && <small>{hint}</small>}</div>{children != null && children !== false && <div className="st-row-control">{children}</div>}</div>;
}
export function Switch({ checked, onChange, label, disabled }) {
  return <button type="button" role="switch" className="st-switch" aria-checked={!!checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><i aria-hidden="true" /></button>;
}
export function Segmented({ label, value, options, onChange, disabled }) {
  return <div className="st-seg" role="radiogroup" aria-label={label}>{options.map(([id, name]) => <button key={String(id)} type="button" role="radio" aria-checked={value === id} disabled={disabled} onClick={() => onChange(id)}>{name}</button>)}</div>;
}
export function TextRow({ label, hint, value, onChange, placeholder, type = 'text', mono, disabled, list, onFocus, readOnly, children }) {
  const id = useId();
  return <Row label={label} hint={hint} htmlFor={id}><input id={id} className={`st-input${mono ? ' is-mono' : ''}`} type={type} value={value} placeholder={placeholder} disabled={disabled} readOnly={readOnly} list={list} onFocus={onFocus} spellCheck={false} onChange={event => onChange?.(event.target.value)} />{children}</Row>;
}
export function CopyButton({ value, label = 'Copiar' }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="st-btn" disabled={!value} onClick={async () => { try { await navigator.clipboard.writeText(String(value)); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); } }}>{copied ? 'Copiado' : label}</button>;
}
