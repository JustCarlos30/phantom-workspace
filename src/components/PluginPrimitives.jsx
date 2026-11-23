import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import EmptyState from './EmptyState.jsx';
import { CopyButton as SharedCopyButton } from './CopyButton.jsx';

export function Button({ children, icon: Icon, tone, type = 'button', className = '', ...props }) {
  return <button {...props} type={type} className={`plugin-button tw-button ${tone ? `tw-${tone}` : ''} ${className}`}>{Icon && <Icon size={15} aria-hidden="true" />}{children}</button>;
}

export function Field({ label, children, hint }) {
  const generatedId = useId();
  const id = children.props.id || generatedId;
  const describedBy = [children.props['aria-describedby'], hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return <div className="plugin-field tw-field"><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id, 'aria-describedby': describedBy })}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}

const PHANTOM_MISSING = /Phantom unavailable|Phantom CLI not found/i;
const CHROMIUM_MISSING = /Chromium de Playwright no está descargado|Playwright no disponible/i;

export function DataView({ value, label = 'Datos de la fuente', open }) {
  return <details className="plugin-data tw-details" open={open}><summary>{label}</summary><pre className="tw-code">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></details>;
}

// Missing tools: one plain sentence, one action when useful; the raw reason stays in DataView.
export function Unavailable({ reason, onOpenPanel, retry, detailsLabel }) {
  const raw = typeof reason === 'string' ? reason.trim() : '';
  const phantom = PHANTOM_MISSING.test(raw);
  return <div className="plugin-unavailable tw-warning" role="status"><span>{phantom ? 'Phantom no está instalado o no se encuentra.' : 'No está disponible en este equipo.'}</span>
    <div className="tw-row">{phantom && onOpenPanel && <Button onClick={() => onOpenPanel('plugins', { category: 'agents' }, 'Configuración')}>Abrir Configuración</Button>}{retry && <Button icon={RefreshCw} onClick={retry}>Reintentar</Button>}</div>
    {raw && <DataView value={raw} label={detailsLabel} />}
  </div>;
}

export function ErrorNotice({ error, retry, clear, onOpenPanel, clearLabel = 'Descartar error', detailsLabel }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message || 'No se pudo completar la operación.';
  if (PHANTOM_MISSING.test(message)) return <Unavailable reason={message} onOpenPanel={onOpenPanel} retry={retry} detailsLabel={detailsLabel} />;
  if (CHROMIUM_MISSING.test(message)) return <div className="plugin-error tw-error" role="alert"><span>Falta instalar Chromium para el navegador automático. Ejecuta: <code>npx playwright install chromium</code></span><div className="tw-row">{clear && <Button onClick={clear}>{clearLabel}</Button>}</div><DataView value={message} label={detailsLabel} /></div>;
  return <div className="plugin-error tw-error" role="alert"><span>{message}</span><div className="tw-row">{retry && <Button icon={RefreshCw} onClick={retry}>Reintentar</Button>}{clear && <Button onClick={clear}>{clearLabel}</Button>}</div></div>;
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
      if (seq === sequence.current) setResult(old => ({ loading: false, data: old.data, error }));
    }
  }, [api, method, key]);
  useEffect(() => {
    setResult({ loading: enabled, data: null, error: null });
    if (enabled) reload();
    return () => { sequence.current++; };
  }, [reload, enabled]);
  return { ...result, reload };
}

export function OperationState({ op, onOpenPanel, clearLabel }) {
  return <><ErrorNotice error={op.error} retry={op.retry} clear={op.clear} onOpenPanel={onOpenPanel} clearLabel={clearLabel} />{op.busy && <p className="plugin-loading tw-muted" role="status">Procesando…</p>}</>;
}

// strict: the resource must be a list (array or {items}); any other shape is reported, never hidden.
export function ResourceState({ resource, empty = 'No hay elementos.', onOpenPanel, loadingLabel = 'Consultando la fuente…', strict }) {
  if (resource.loading) return <p className="plugin-loading tw-muted" role="status">{loadingLabel}</p>;
  if (resource.error) return <ErrorNotice error={resource.error} retry={resource.reload} onOpenPanel={onOpenPanel} />;
  if (resource.data?.available === false) return <Unavailable reason={resource.data.reason || 'Fuente no disponible.'} onOpenPanel={onOpenPanel} retry={resource.reload} />;
  const data = resource.data;
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (strict && data != null && !items) return <ErrorNotice error="No se pudo leer la lista. Vuelve a intentarlo." retry={resource.reload} />;
  if (empty && items && !items.length || strict && empty && data == null) return <EmptyState className="plugin-empty tw-empty" description={empty} />;
  return null;
}

// Flat settings groups; each row aligns its label and control to the same edges.
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
  return <div className="st-seg control-segmented" role="radiogroup" aria-label={label}>{options.map(([id, name]) => <button key={String(id)} type="button" role="radio" aria-checked={value === id} disabled={disabled} onClick={() => onChange(id)}>{name}</button>)}</div>;
}
export function TextRow({ label, hint, value, onChange, placeholder, type = 'text', mono, disabled, list, onFocus, readOnly, children }) {
  const id = useId();
  return <Row label={label} hint={hint} htmlFor={id}><input id={id} className={`st-input${mono ? ' is-mono' : ''}`} type={type} value={value} placeholder={placeholder} disabled={disabled} readOnly={readOnly} list={list} onFocus={onFocus} spellCheck={false} onChange={event => onChange?.(event.target.value)} />{children}</Row>;
}
export function CopyButton(props) {
  return <SharedCopyButton {...props} variant="text" />;
}
