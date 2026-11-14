import React from 'react';
import { FileText } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { asJson, basename, clean, diffLines, numberedLines, plural, searchResults } from './tool-output.mjs';

// What a tool call returned, drawn by what it is: an edit as a diff, a read
// with its line numbers, a search as the files it found, a command as a
// console. Everything is React text, so tool output never becomes markup.

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
function JsonView({ text }) {
  const nodes = []; let last = 0, key = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [whole, string, colon, literal, number] = match;
    if (string) nodes.push(<span key={key++} className={colon ? 'tv-key' : 'tv-str'}>{string}</span>, colon || '');
    else nodes.push(<span key={key++} className={literal ? 'tv-lit' : number ? 'tv-num' : undefined}>{whole}</span>);
    last = match.index + whole.length;
  }
  nodes.push(text.slice(last));
  return <pre className="tv-body tv-json">{nodes}</pre>;
}

function Frame({ variant, label, meta, copy, children }) {
  return <div className={`tv tv-${variant}`}>
    <header className="tv-head"><span className="tv-label">{label}</span>{meta && <span className="tv-meta">{meta}</span>}{copy && <CopyButton text={copy} label="Copiar" />}</header>
    <div className="tv-scroll">{children}</div>
  </div>;
}

function DiffView({ part }) {
  const rows = diffLines(part.change.before, part.change.after);
  let old = 0, now = 0;
  return <Frame variant="diff" label={<><FileText size={14} aria-hidden="true" /><span className="tv-path" title={part.detail}>{basename(part.detail || 'archivo')}</span></>} meta={<><b>+{part.diff?.added ?? rows.filter(r => r.op === '+').length}</b><i>−{part.diff?.removed ?? rows.filter(r => r.op === '-').length}</i></>} copy={part.change.after}>
    <table className="tv-lines" role="presentation"><tbody>
      {rows.map((row, i) => {
        if (row.op !== '+') old++;
        if (row.op !== '-') now++;
        return <tr key={i} className={row.op === '+' ? 'is-add' : row.op === '-' ? 'is-del' : undefined}>
          <td className="tv-n">{row.op === '+' ? '' : old}</td><td className="tv-n">{row.op === '-' ? '' : now}</td>
          <td className="tv-op" aria-label={row.op === '+' ? 'añadida' : row.op === '-' ? 'quitada' : undefined}>{row.op.trim()}</td>
          <td className="tv-code">{row.text || ' '}</td>
        </tr>;
      })}
    </tbody></table>
  </Frame>;
}

export default function ToolOutput({ part, kind }) {
  if (kind === 'edit' && part.change && part.status !== 'error') return <DiffView part={part} />;
  const text = clean(part.output);
  if (!text) return null;
  const lineCount = text.split('\n').length;
  if (part.status === 'error') return <Frame variant="error" label="Error" meta={plural(lineCount, 'línea', 'líneas')} copy={text}><pre className="tv-body">{text}</pre></Frame>;
  if (kind === 'shell') return <Frame variant="shell" label="Consola" meta={plural(lineCount, 'línea', 'líneas')} copy={text}>
    {part.detail && <p className="tv-prompt"><span aria-hidden="true">$</span>{part.detail}</p>}
    <pre className="tv-body">{text}</pre>
  </Frame>;
  if (kind === 'read') {
    const lines = numberedLines(text);
    if (lines) return <Frame variant="read" label={<><FileText size={14} aria-hidden="true" /><span className="tv-path" title={part.detail}>{basename(part.detail || 'archivo')}</span></>} meta={lines.length > 1 ? `líneas ${lines[0].n}–${lines.at(-1).n}` : plural(lines.length, 'línea', 'líneas')} copy={lines.map(line => line.text).join('\n')}>
      <table className="tv-lines" role="presentation"><tbody>{lines.map((line, i) => <tr key={i}><td className="tv-n">{line.n}</td><td className="tv-code">{line.text || ' '}</td></tr>)}</tbody></table>
    </Frame>;
  }
  if (kind === 'search') {
    const found = searchResults(text);
    if (found?.kind === 'files') return <Frame variant="search" label="Archivos" meta={plural(found.files.length, 'resultado', 'resultados')} copy={text}>
      <ul className="tv-files">{found.files.map(path => <li key={path} title={path}><FileText size={14} aria-hidden="true" /><strong>{basename(path)}</strong><span>{path}</span></li>)}</ul>
    </Frame>;
    if (found?.kind === 'matches') return <Frame variant="search" label="Coincidencias" meta={`${plural(found.files.reduce((n, f) => n + f.hits.length, 0), 'línea', 'líneas')} · ${plural(found.files.length, 'archivo', 'archivos')}`} copy={text}>
      {found.files.map(file => <section key={file.path} className="tv-group">
        <h5 title={file.path}><FileText size={14} aria-hidden="true" /><strong>{basename(file.path)}</strong><span>{file.path}</span></h5>
        <table className="tv-lines" role="presentation"><tbody>{file.hits.map((hit, i) => <tr key={i}><td className="tv-n">{hit.n}</td><td className="tv-code">{hit.text || ' '}</td></tr>)}</tbody></table>
      </section>)}
    </Frame>;
  }
  const json = asJson(text);
  if (json) return <Frame variant="json" label="JSON" meta={plural(json.split('\n').length, 'línea', 'líneas')} copy={json}><JsonView text={json} /></Frame>;
  return <Frame variant="text" label="Resultado" meta={plural(lineCount, 'línea', 'líneas')} copy={text}><pre className="tv-body">{text}</pre></Frame>;
}
