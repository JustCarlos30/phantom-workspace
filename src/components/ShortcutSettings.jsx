import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Keyboard, X } from 'lucide-react';
import { COMMANDS, formatBinding, resolveBindings, validateBindings } from '../hooks/workspace-commands.mjs';
import { Button } from './ToolPanels.jsx';
import { Presence } from './Presence';
import '../tools.css';
import '../keyboard-navigation.css';

export default function ShortcutSettings({ open, onClose, bindings, onSetBinding, onReset, conflicts = [] }) {
  const [editing, setEditing] = useState(null), [draft, setDraft] = useState('');
  const [errors, setErrors] = useState([]), [status, setStatus] = useState('');
  const dialog = useRef(null), close = useRef(null), id = useId();
  const shortcuts = resolveBindings(bindings);
  const problems = errors.length ? errors : conflicts;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement, surface = dialog.current;
    setEditing(null); setErrors([]); setStatus('');
    const frame = requestAnimationFrame(() => close.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      if (previous?.isConnected && !previous.closest?.('[inert], [hidden]') && (document.activeElement === document.body || surface?.contains(document.activeElement))) previous.focus?.({ preventScroll: true });
    };
  }, [open]);
  const save = (commandId, value) => {
    const result = validateBindings({ ...shortcuts, [commandId]: value });
    setStatus('');
    if (result.conflicts.length) { setErrors(result.conflicts); return; }
    setErrors([]);
    if (onSetBinding(commandId, result.bindings[commandId]) !== false) {
      setEditing(null); setStatus(value === null ? 'Atajo desactivado.' : 'Atajo actualizado.');
      requestAnimationFrame(() => dialog.current?.querySelector(`[data-shortcut="${commandId}"]`)?.focus());
    }
  };
  const cancel = commandId => {
    setEditing(null); setErrors([]);
    requestAnimationFrame(() => dialog.current?.querySelector(`[data-shortcut="${commandId}"]`)?.focus());
  };
  return createPortal(<Presence show={open}>{open && <div className="tw-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialog} className="tw-palette tw-shortcuts" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onKeyDown={e => {
      e.stopPropagation();
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { e.preventDefault(); if (editing) cancel(editing); else onClose(); }
      if (e.key === 'Tab') {
        const focusable = [...dialog.current.querySelectorAll('input,button:not(:disabled)')];
        const first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="tw-inspector-header"><div><h2 id={`${id}-title`}><Keyboard size={17} aria-hidden="true" /> Atajos de teclado</h2><p>Preferencias locales para todos los proyectos</p></div><button ref={close} type="button" className="tw-button" aria-label="Cerrar atajos de teclado" onClick={onClose}><X size={15} aria-hidden="true" /></button></header>
      <div className="tw-shortcuts-content">
        <section className="tw-shortcut-help" aria-labelledby={`${id}-modes`}>
          <h3 id={`${id}-modes`}>Navegación e interacción</h3>
          <p id={`${id}-help`}>En modo navegación, las flechas eligen paneles y <kbd>{formatBinding(shortcuts['enter-panel'])}</kbd> entra al contenido. Al escribir, las teclas pertenecen al editor o la terminal. Usa <kbd>{formatBinding(shortcuts['leave-panel'])}</kbd> para salir al mapa, también desde xterm.</p>
          <p>En Wayland, Super/Meta suele estar reservado al escritorio; los atajos iniciales usan Ctrl. Las vistas web embebidas pueden retener combinaciones: usa los controles de la cabecera para volver al mapa y abrir los atajos.</p>
          <p id={`${id}-syntax`}>Pulsa Editar y escribe una combinación, por ejemplo <kbd>Ctrl+Alt+K</kbd>. Enter guarda y Esc cancela la edición. No se admiten duplicados ni reservas del menú nativo. Las reservas del compositor no se pueden detectar aquí. Salir al mapa y Configurar atajos conservan un modificador para que siempre puedas recuperarlos.</p>
        </section>
        {problems.length > 0 && <div id={`${id}-errors`} className="tw-error" role="alert"><ul>{problems.map((problem, index) => <li key={index}>{problem.ids?.length ? `${problem.ids.map(commandId => COMMANDS.find(command => command.id === commandId)?.title || commandId).join(', ')}: ` : ''}{problem.message}</li>)}</ul></div>}
        <section aria-labelledby={`${id}-list-title`}><h3 id={`${id}-list-title`}>Atajos del workspace</h3>
          {[...new Set(COMMANDS.map(command => command.group))].map((group, groupIndex) => <section key={group} className="tw-shortcut-group" aria-labelledby={`${id}-group-${groupIndex}`}><h4 id={`${id}-group-${groupIndex}`}>{group}</h4><ul>{COMMANDS.filter(command => command.group === group).map(command => {
            const required = ['leave-panel', 'shortcuts'].includes(command.id);
            const invalid = problems.some(problem => problem.ids?.includes(command.id));
            return <li key={command.id} className="tw-shortcut-row">
              <div className="tw-shortcut-label"><strong>{command.title}</strong><small>{command.scope === 'navigation' ? 'Solo en modo navegación' : command.scope === 'panel' ? 'Dentro del panel · Atajo de recuperación' : required ? 'Global · Atajo de recuperación' : 'Global'}</small></div>
              {editing === command.id ? <form className="tw-shortcut-editor" onSubmit={e => { e.preventDefault(); save(command.id, draft.trim()); }}>
                <label className="tw-field"><span>Atajo para {command.title}</span><input autoFocus aria-describedby={`${id}-syntax${invalid ? ` ${id}-errors` : ''}`} aria-invalid={invalid || undefined} value={draft} onChange={e => { setDraft(e.target.value); setErrors([]); }} autoComplete="off" spellCheck={false} /></label>
                <div className="tw-row"><button type="submit" className="tw-button tw-primary">Guardar</button><Button onClick={() => cancel(command.id)}>Cancelar</Button></div>
              </form> : <div className="tw-shortcut-actions"><kbd>{formatBinding(shortcuts[command.id])}</kbd><Button data-shortcut={command.id} aria-label={`Editar atajo: ${command.title}`} onClick={() => { setEditing(command.id); setDraft(shortcuts[command.id] || ''); setErrors([]); setStatus(''); }}>Editar</Button></div>}
              {!required && <Button aria-label={`Desactivar atajo: ${command.title}`} disabled={shortcuts[command.id] === null} onClick={() => save(command.id, null)}>Desactivar</Button>}
            </li>;
          })}</ul></section>)}
        </section>
      </div>
      <footer className="tw-keyboard-footer"><span role="status">{status}</span><Button onClick={() => { setErrors([]); setStatus(''); if (onReset() !== false) { setEditing(null); setStatus('Atajos iniciales restablecidos.'); } }}>Restablecer atajos</Button></footer>
    </div>
  </div>}</Presence>, document.body);
}
