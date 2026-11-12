import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

// Copies and confirms in place; the confirmation is the only feedback needed.
export function CopyButton({ text, label = 'Copiar', className = '' }) {
  const [copied, setCopied] = useState(false), timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(typeof text === 'function' ? text() : text); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1600); } catch { /* Clipboard denied: nothing was copied, so nothing is claimed. */ }
  };
  const Icon = copied ? Check : Copy;
  return <button type="button" className={`md-copy ${copied ? 'is-copied' : ''} ${className}`} title={label} aria-label={copied ? 'Copiado' : label} onClick={copy}><Icon size={12} aria-hidden="true" /></button>;
}
