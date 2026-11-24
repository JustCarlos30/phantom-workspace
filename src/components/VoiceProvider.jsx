import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mic } from 'lucide-react';
import { VoiceDictation } from './VoiceDictation';
import { VOICE_SURFACES } from './VoiceActivity';
import { cancelVoiceRecording } from '../hooks/useVoiceRecorder';

const VoiceContext = createContext(null);
export const useVoiceWorkspace = () => useContext(VoiceContext);

// Window-local drafts survive closing the dock and switching its tabs. Keys
// include workspace and conversation; no draft leaks into another destination.
const drafts = new Map(), draftListeners = new Set();
const subscribeDrafts = listener => { draftListeners.add(listener); return () => draftListeners.delete(listener); };
export function useVoiceDraft(key) {
  const draft = useSyncExternalStore(subscribeDrafts, () => drafts.get(key) || '');
  const setDraft = useCallback(value => {
    drafts.set(key, typeof value === 'function' ? value(drafts.get(key) || '') : value);
    draftListeners.forEach(listener => listener());
  }, [key]);
  return [draft, setDraft];
}

function editable(element) {
  if (!element?.isConnected || element.closest('.xterm,.voice-dialog,.tw-palette,[inert]') || element.matches(':disabled') || element.readOnly) return null;
  if (element.matches('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="url"],input[type="email"],input[type="tel"]')) return element;
  return element.isContentEditable ? element.closest('[contenteditable="true"]') : null;
}

function fieldTarget(element, workspaceId) {
  // React can reuse the same textarea while switching provider/tool. DOM
  // connectivity alone must never authorize delivery into that new context.
  const identity = () => JSON.stringify([
    element.getAttribute('aria-label'), element.getAttribute('name'), element.getAttribute('type'),
    element.closest('[data-node-id]')?.getAttribute('data-node-id'),
    element.closest('[data-provider]')?.getAttribute('data-provider'),
    element.closest('[role="dialog"]')?.getAttribute('aria-labelledby'),
    element.closest('.inspector-host')?.querySelector('.inspector-switcher select')?.value,
  ]);
  const originalIdentity = identity();
  const valid = () => editable(element) === element && identity() === originalIdentity;
  const contentEditable = element.isContentEditable;
  const original = contentEditable ? element.textContent : element.value;
  const selection = getSelection();
  const range = contentEditable && selection?.rangeCount && element.contains(selection.anchorNode) && element.contains(selection.focusNode) ? selection.getRangeAt(0).cloneRange() : null;
  const start = element.selectionStart ?? original.length, end = element.selectionEnd ?? start;
  return { workspaceId, kind: 'field', label: element.getAttribute('aria-label') || element.labels?.[0]?.textContent || element.getAttribute('placeholder') || 'Campo de texto',
    valid,
    insert: text => {
      if (!valid()) throw new Error('El campo de destino cambió o ya no está disponible. Cierra el dictado y vuelve a enfocarlo.');
      if ((contentEditable ? element.textContent : element.value) !== original) throw new Error('El borrador cambió durante el dictado. Se ha conservado: copia la transcripción o vuelve a dictar desde el campo.');
      if (contentEditable) {
        const destination = range || document.createRange();
        if (!range) { destination.selectNodeContents(element); destination.collapse(false); }
        destination.deleteContents(); const node = document.createTextNode(text); destination.insertNode(node);
        destination.setStartAfter(node); destination.collapse(true); selection.removeAllRanges(); selection.addRange(destination);
      } else {
        const value = original.slice(0, start) + text + original.slice(end);
        if (element.maxLength >= 0 && value.length > element.maxLength) throw new Error('La transcripción supera el límite del campo. Acórtala antes de insertar.');
        const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
        if (element.selectionStart !== null) element.setSelectionRange?.(start + text.length, start + text.length);
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.focus({ preventScroll: true });
    } };
}

export function VoiceProvider({ workspaceId, api, connected, children }) {
  const [target, setTarget] = useState(null);
  const terminals = useRef(new Map()), last = useRef(null);
  const registerTerminal = useCallback((element, destination) => {
    terminals.current.set(element, destination);
    return () => {
      terminals.current.delete(element); if (last.current === element) last.current = null;
      setTarget(current => current?.valid === destination.valid ? null : current);
    };
  }, []);
  useEffect(() => {
    last.current = null; setTarget(null);
    const focus = event => {
      if (event.target.closest?.('.voice-dialog')) return;
      const terminal = [...terminals.current.keys()].find(element => element.contains(event.target));
      const field = editable(event.target);
      if (terminal || field) last.current = terminal || field;
    };
    document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('focusin', focus); cancelVoiceRecording(); };
  }, [workspaceId]);
  const openDictation = useCallback(destination => {
    if (!workspaceId || !connected || target) return;
    const element = editable(document.activeElement) || last.current;
    const field = editable(element);
    const chosen = destination || terminals.current.get(element) || (field ? fieldTarget(field, workspaceId) : null);
    if (chosen && !chosen.valid()) return;
    // The card or terminal receiving the text lights up while it listens.
    const owner = destination ? [...terminals.current].find(([, value]) => value === destination)?.[0] : element;
    const surface = chosen ? owner?.closest?.(VOICE_SURFACES) || null : null;
    setTarget(chosen ? { ...chosen, workspaceId, surface } : { workspaceId, label: 'Sin campo seleccionado', kind: 'none' });
  }, [workspaceId, connected, target]);
  useEffect(() => {
    const shortcut = event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && !event.isComposing && event.key.toLowerCase() === 'm') {
        event.preventDefault(); event.stopPropagation(); if (!event.repeat) openDictation();
      }
    };
    window.addEventListener('keydown', shortcut, true);
    return () => window.removeEventListener('keydown', shortcut, true);
  }, [openDictation]);
  useEffect(() => { if (!connected) { cancelVoiceRecording(); setTarget(null); } }, [connected]);
  return <VoiceContext.Provider value={{ open: !!target, openDictation, registerTerminal }}>
    {children}
    {target && target.workspaceId === workspaceId && <VoiceDictation key={workspaceId} target={target} api={api} connected={connected} onClose={() => setTarget(null)} />}
  </VoiceContext.Provider>;
}

export function VoiceLauncher({ disabled }) {
  const voice = useVoiceWorkspace();
  return <button type="button" className="voice-launcher" aria-label="Dictado por voz" title="Dictado por voz · Ctrl/Cmd + Shift + M" aria-keyshortcuts="Control+Shift+M Meta+Shift+M" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => voice.openDictation()}><Mic size={15} /><span>Dictado por voz</span></button>;
}
