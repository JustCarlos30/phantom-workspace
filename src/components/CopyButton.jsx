import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ text, value, label = 'Copiar', className = '', variant = 'icon', disabled, onClick, ...props }) {
  // `value` es la prop canónica; `text` se mantiene como alias (value tiene prioridad).
  const [status, setStatus] = useState('idle'), timer = useRef(), attempt = useRef(0);
  const source = value !== undefined ? value : text;
  const copied = status === 'copied', failed = status === 'failed';
  useEffect(() => {
    setStatus('idle');
    return () => { clearTimeout(timer.current); attempt.current++; };
  }, [source]);
  const copy = async event => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const current = ++attempt.current;
    clearTimeout(timer.current);
    setStatus('idle');
    let next = 'failed';
    try {
      await navigator.clipboard.writeText(String(typeof source === 'function' ? source() : source));
      next = 'copied';
    } catch { /* portapapeles no disponible o rechazado */ }
    if (current !== attempt.current) return;
    setStatus(next);
    timer.current = setTimeout(() => setStatus('idle'), next === 'copied' ? 1600 : 2400);
  };
  const Icon = copied ? Check : Copy;
  const shown = copied ? 'Copiado' : failed ? 'No se pudo copiar' : label;
  return <button type="button" title={failed ? shown : label} aria-label={shown} {...props} className={`${variant === 'text' ? 'st-btn' : 'md-copy'} ${copied ? 'is-copied' : ''} ${failed ? 'is-failed' : ''} ${className}`} disabled={disabled || source == null || source === ''} onClick={copy}>{variant === 'text' ? shown : <Icon size={12} aria-hidden="true" />}</button>;
}
