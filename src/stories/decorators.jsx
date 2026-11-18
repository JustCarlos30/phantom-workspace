import React from 'react';
import { VoiceProvider } from '../components/VoiceProvider';
import { installHost, api } from './host-mock';
import { workspace, state, noop, done, plugin } from './fixtures';

export const demo = { workspace, state, api, notify: noop, refresh: done, flush: done, onClose: noop, onOpenPanel: noop, onChange: noop, onFocus: noop, onSelect: noop, onRelaunch: noop, connected: true, plugin };
export function Panel({ children }) { return <div className="catalog-panel">{children}</div>; }

export function catalogDecorator(Story, context) {
  return <VoiceProvider workspaceId={demo.workspace.id} api={demo.api} connected><div className={`catalog-stage${context.id === 'ajustes--cliente-movil' ? '' : ' app-shell'}${context.id === 'identidad--mascota' ? ' studio-character' : ''}`} data-story={context.id}><Story /></div></VoiceProvider>;
}

let generation = 0;
export function beforeStory(context) {
  document.documentElement.lang = 'es';
  delete document.documentElement.dataset.catalogRendered;
  localStorage.clear();
  sessionStorage.clear();
  const workspaceId = `${workspace.id}:${context.id}:${++generation}`;
  const host = installHost({ ...context.parameters.host, workspaceId });
  demo.workspace = structuredClone(host.model.workspaces[0]);
  demo.state = structuredClone(host.model);
  demo.api = host.invoke;
  const originalFetch = window.fetch;
  const originalOpen = window.open;
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let copied = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; }, readText: async () => copied } });
  const media = navigator.mediaDevices;
  const originalMedia = media?.getUserMedia;
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return Promise.reject(new Error('Red del host aislada en Storybook'));
    return originalFetch(input, init);
  };
  window.open = () => null;
  if (media) media.getUserMedia = () => Promise.reject(new DOMException('Micrófono aislado en Storybook', 'NotAllowedError'));
  return () => {
    host.dispose();
    window.fetch = originalFetch;
    window.open = originalOpen;
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else delete navigator.clipboard;
    if (media) media.getUserMedia = originalMedia;
  };
}
