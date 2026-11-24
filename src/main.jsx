import React from 'react';
import { createRoot } from 'react-dom/client';
import { installBrowserKeyBridge } from './hooks/browserKeyBridge.js';
installBrowserKeyBridge();
async function mount() {
  if (window.location.pathname === '/mobile' && !window.phantom) {
    const { default: MobileApp } = await import('./components/MobileApp.jsx');
    createRoot(document.getElementById('root')).render(<MobileApp />);
  } else {
    const [{ default: App }] = await Promise.all([import('./App.jsx'), import('./styles.css'), import('./tools.css'), import('./empty-state.css')]);
    createRoot(document.getElementById('root')).render(<App />);
  }
}
mount();
