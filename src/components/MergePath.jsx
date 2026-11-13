import React from 'react';
import { Check, X } from 'lucide-react';
import { ownerLabel } from '../hooks/incorporaciones-model.mjs';
import '../incorporaciones.css';

const STATE = { done: 'hecho', now: 'siguiente', todo: 'pendiente', fail: 'falló' };

// The road from a branch to the base, drawn the same way for every branch:
// what is done, where it stands, and what failed.
export function MergeSteps({ path }) {
  return <ol className="mp-steps" aria-label={`Camino al merge: ${path.done} de ${path.total} pasos`}>
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

export default function MergePath({ path }) {
  return <div className="mp"><MergeSteps path={path} /><MergeMissing path={path} /></div>;
}
