import React from 'react';
import { parseBlocks } from '../hooks/skills-model.mjs';
import MarkdownTable from './MarkdownTable';

// Small, dependency-free Markdown reader for skill instructions. It produces
// React elements only (no HTML injection) and covers the subset skills use:
// headings, paragraphs, lists, quotes, fenced code, tables and rules.

export function inline(text, keyBase = 'i') {
  const out = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0, match, index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0], key = `${keyBase}-${index++}`;
    if (match[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
    else if (match[3]) out.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      out.push(<span key={key} className="md-link" title={href}>{inline(label, key)}</span>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Block({ block, id }) {
  if (block.type === 'heading') { const Tag = `h${Math.min(6, block.level + 2)}`; return <Tag className={`md-h md-h${block.level}`}>{inline(block.text, id)}</Tag>; }
  if (block.type === 'code') return <figure className="md-code">{block.lang && <figcaption>{block.lang}</figcaption>}<pre><code>{block.text}</code></pre></figure>;
  if (block.type === 'rule') return <hr className="md-rule" />;
  if (block.type === 'quote') return <blockquote className="md-quote">{block.children.map((child, i) => <Block key={i} block={child} id={`${id}-${i}`} />)}</blockquote>;
  if (block.type === 'table') return <MarkdownTable block={block} inline={inline} id={id} />;
  if (block.type === 'list') { const Tag = block.ordered ? 'ol' : 'ul'; return <Tag className="md-list">{block.items.map((item, i) => <li key={i} style={item.depth ? { marginInlineStart: item.depth * 16 } : undefined}>{inline(item.text, `${id}-${i}`)}</li>)}</Tag>; }
  return <p className="md-p">{inline(block.text, id)}</p>;
}

export function Markdown({ source, className = '' }) {
  const blocks = parseBlocks(source);
  if (!blocks.length) return <p className="tw-muted">Sin instrucciones.</p>;
  return <div className={`md ${className}`}>{blocks.map((block, i) => <Block key={i} block={block} id={`b${i}`} />)}</div>;
}
