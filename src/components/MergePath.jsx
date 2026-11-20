import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { ownerLabel } from '../hooks/incorporaciones-model.mjs';
import { checksExcerpt } from '../hooks/failure-help.mjs';
import '../incorporaciones.css';

const STATE = { done: 'hecho', now: 'siguiente', todo: 'pendiente', fail: 'falló' };

// The road from a branch to main, drawn the same way for every branch:
// what is done, where it stands, and what failed.
export function MergeSteps({ path }) {
  return <ol className="mp-steps" aria-label={`Camino a main: ${path.done} de ${path.total} pasos`}>
    {path.steps.map(step => <li key={step.id} className="mp-step" data-state={step.state}>
      <span className="mp-dot" aria-hidden="true">{step.state === 'done' ? <Check size={9} strokeWidth={3} /> : step.state === 'fail' ? <X size={9} strokeWidth={3} /> : null}</span>
      <span className="mp-label">{step.label}<span className="sr-only"> · {STATE[step.state]}</span></span>
    </li>)}
  </ol>;
}

// What is left, in the order it has to happen, and whose move it is.
export function MergeMissing({ path }) {
  if (!path.missing.length && !path.notes.length) return null;
  return <div className="mp-missing">
    {path.missing.length > 0 && <p className="mp-missing-line"><b>{path.missing.length === 1 ? 'Falta' : 'Faltan'}</b>{path.missing.length === 1
      ? <span>{path.missing[0]}</span>
      : <span className="mp-missing-list">{path.missing.map((text, index) => <span key={text}><i aria-hidden="true">{index + 1}</i>{text}</span>)}</span>}</p>}
    {(path.notes.length > 0 || ownerLabel(path.owner)) && <p className="mp-notes">{[ownerLabel(path.owner), ...path.notes].filter(Boolean).join(' · ')}</p>}
  </div>;
}

// «¿Qué pasó? / ¿Qué hago?»: the why on top, ONE main key, the rest as quiet keys,
// and the technical output folded. `onAction(id)` is the caller's; ids are failure-help's.
export function FailureCard({ help, entry, onAction, busy = false, confirmText = '¿Sacarla de la cola? Podrás enviarla otra vez desde su sesión.' }) {
  const [confirm, setConfirm] = useState(false), [copied, setCopied] = useState(false);
  if (!help) return null;
  const checks = help.kind === 'checks' ? entry?.checks : null;
  const excerpt = checks?.output ? checksExcerpt(checks.output, 40) : null;
  const files = help.kind === 'conflict' ? entry?.conflicts ?? [] : [];
  const press = id => id === 'withdraw' ? setConfirm(true) : onAction(id);
  const copy = () => navigator.clipboard?.writeText(excerpt.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => {});
  const others = help.acciones.filter(action => action.id !== help.accionPrincipal?.id);
  return <section className="fh" data-kind={help.kind} aria-label={help.titulo}>
    <h4 className="fh-title">{help.titulo}</h4>
    <p className="fh-line"><b>¿Qué pasó?</b> {help.queOcurrio}</p>
    {entry?.summary && <p className="fh-line"><b>Dijo el agente</b> {entry.summary}</p>}
    <p className="fh-line"><b>¿Qué hago?</b> {help.queHago}</p>
    {files.length > 0 && <ul className="fh-files" aria-label="Archivos en conflicto">{files.slice(0, 12).map(file => <li key={file}><code>{file}</code></li>)}{files.length > 12 && <li className="fh-more">y {files.length - 12} más</li>}</ul>}
    {excerpt?.text && <details className="inc-fold fh-output">
      <summary>Salida de los tests{excerpt.truncated ? ` · últimas ${excerpt.lines} líneas` : ''}</summary>
      <pre className="fh-pre" tabIndex={0}>{excerpt.text}</pre>
      <button type="button" className="fh-button is-quiet" onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</button>
    </details>}
    {confirm
      ? <div className="fh-actions" role="group" aria-label="Confirmar"><span className="fh-confirm">{confirmText}</span><button type="button" className="fh-button is-primary" disabled={busy} onClick={() => { setConfirm(false); onAction('withdraw'); }}>Sacar de la cola</button><button type="button" className="fh-button" onClick={() => setConfirm(false)}>Cancelar</button></div>
      : <div className="fh-actions">
        {help.accionPrincipal && <button type="button" className="fh-button is-primary" disabled={busy} onClick={() => press(help.accionPrincipal.id)}>{help.accionPrincipal.label}</button>}
        {others.map(action => <button key={action.id} type="button" className="fh-button" disabled={busy} onClick={() => press(action.id)}>{action.label}</button>)}
      </div>}
  </section>;
}

export default function MergePath({ path }) {
  return <div className="mp"><MergeSteps path={path} /><MergeMissing path={path} /></div>;
}
