import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { markdownTarget } from '../hooks/markdownLinks.mjs';

// Small, dependency-free Markdown for agent replies: fenced code, headings,
// lists, quotes, and inline code/bold/italic/links. Everything is rendered as
// React text nodes, so reply content can never inject markup.
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(!?\[[^\]\n]+\]\([^)\s]+\))/g;

function inline(source, key) {
  const out = []; let last = 0, match, index = 0;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(source))) {
    if (match.index > last) out.push(source.slice(last, match.index));
    const token = match[0], k = `${key}-${index++}`;
    if (match[1]) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    else if (match[3]) out.push(<em key={k}>{token.slice(1, -1)}</em>);
    else { const [, image, label, url] = /^(!?)\[([^\]]+)\]\(([^)]+)\)$/.exec(token); out.push(<MarkdownLink key={k} label={label} url={url} embedded={!!image} />); }
    last = match.index + token.length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

function MarkdownLink({ label, url, embedded }) {
  const target = markdownTarget(url);
  const [open, setOpen] = useState(embedded && target?.kind === 'image');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPreview(null); setError(''); setOpen(embedded && markdownTarget(url)?.kind === 'image');
  }, [url, embedded]);
  useEffect(() => {
    if (!open || target?.kind !== 'image') return;
    let active = true;
    setBusy(true); setError('');
    Promise.resolve().then(() => {
      if (!window.phantom) throw new Error('La vista previa requiere Phantom Workspace');
      return window.phantom.invoke('desktop.previewImage', { path: target.path });
    }).then(result => { if (active) setPreview(result.dataUrl); })
      .catch(reason => { if (active) setError(`No se pudo abrir la imagen: ${reason.message}`); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, url]);
  if (!target) return <span title={url}>{label}</span>;
  const activate = async () => {
    if (target.kind === 'image') { setOpen(value => !value); return; }
    setError(''); setBusy(true);
    try {
      if (!window.phantom) throw new Error('Abre este enlace desde Phantom Workspace');
      await window.phantom.invoke(target.kind === 'web' ? 'desktop.openExternal' : 'desktop.openPath', target.kind === 'web' ? { url: target.url } : { path: target.path });
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  return <span className="md-attachment">
    <button type="button" className="md-link" title={url} onClick={activate} disabled={busy && target.kind !== 'image'} aria-expanded={target.kind === 'image' ? open : undefined}>{label}</button>
    {open && <span className="md-image-preview" aria-busy={busy}>
      <span className="md-image-heading"><span>{label}</span><button type="button" className="md-link" onClick={() => setOpen(false)}>Cerrar vista previa</button></span>
      {busy && <span role="status">Cargando imagen…</span>}
      {preview && !error && <img src={preview} alt={label} onError={() => setError('No se pudo decodificar la imagen. Comprueba que el archivo no esté dañado.')} />}
    </span>}
    {error && <span className="md-link-error" role="alert">{error}</span>}
  </span>;
}

export function parseMarkdown(source) {
  const blocks = [], lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let paragraph = [], list = null;
  const flush = () => {
    if (paragraph.length) { blocks.push({ type: 'p', text: paragraph.join('\n') }); paragraph = []; }
    if (list) { blocks.push(list); list = null; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], fence = /^\s*```\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush(); const code = [];
      // An unclosed fence is a reply still streaming: keep what has arrived.
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: 'code', lang: fence[1], text: code.join('\n') }); continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line), item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) { flush(); blocks.push({ type: 'h', level: heading[1].length, text: heading[2] }); }
    else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); blocks.push({ type: 'hr' }); }
    else if (item) {
      const ordered = !!item[2];
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      (list ??= { type: 'list', ordered, items: [] }).items.push(item[3]);
    }
    else if (list && /^\s{2,}\S/.test(line)) list.items[list.items.length - 1] += `\n${line.trim()}`;
    else if (/^\s*>\s?/.test(line)) { flush(); blocks.push({ type: 'quote', text: line.replace(/^\s*>\s?/, '') }); }
    else { if (list) flush(); paragraph.push(line); }
  }
  flush();
  return blocks;
}

// Copies and confirms in place; the confirmation is the only feedback needed.
export function CopyButton({ text, label = 'Copiar' }) {
  const [copied, setCopied] = useState(false), timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1600); } catch { /* Clipboard denied: nothing was copied, so nothing is claimed. */ }
  };
  const Icon = copied ? Check : Copy;
  return <button type="button" className={`md-copy ${copied ? 'is-copied' : ''}`} title={label} aria-label={copied ? 'Copiado' : label} onClick={copy}><Icon size={12} aria-hidden="true" /></button>;
}

export default function Markdown({ source }) {
  return <div className="md">{parseMarkdown(source).map((block, i) => {
    if (block.type === 'code') return <figure key={i} className="md-code"><figcaption><span>{block.lang || 'código'}</span><CopyButton text={block.text} label="Copiar código" /></figcaption><pre><code>{block.text}</code></pre></figure>;
    if (block.type === 'h') return React.createElement(`h${Math.min(6, block.level + 2)}`, { key: i }, inline(block.text, i));
    if (block.type === 'hr') return <hr key={i} />;
    if (block.type === 'quote') return <blockquote key={i}>{inline(block.text, i)}</blockquote>;
    if (block.type === 'list') return React.createElement(block.ordered ? 'ol' : 'ul', { key: i }, block.items.map((text, j) => <li key={j}>{inline(text, `${i}-${j}`)}</li>));
    return <p key={i}>{inline(block.text, i)}</p>;
  })}</div>;
}
