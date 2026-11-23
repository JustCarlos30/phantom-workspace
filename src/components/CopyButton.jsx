import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ text, value, label = 'Copiar', className = '', variant = 'icon', disabled, onClick, ...props }) {
  const [copied, setCopied] = useState(false), timer = useRef(), attempt = useRef(0);
  const source = text !== undefined ? text : value;
  useEffect(() => {
    setCopied(false);
    return () => { clearTimeout(timer.current); attempt.current++; };
  }, [source]);
  const copy = async event => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const current = ++attempt.current;
    clearTimeout(timer.current);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(String(typeof source === 'function' ? source() : source));
      if (current !== attempt.current) return;
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      if (current === attempt.current) setCopied(false);
    }
  };
  const Icon = copied ? Check : Copy;
  return <button type="button" title={label} aria-label={copied ? 'Copiado' : label} {...props} className={`${variant === 'text' ? 'st-btn' : 'md-copy'} ${copied ? 'is-copied' : ''} ${className}`} disabled={disabled || (variant === 'text' ? !source : source == null)} onClick={copy}>{variant === 'text' ? (copied ? 'Copiado' : label) : <Icon size={12} aria-hidden="true" />}</button>;
}
