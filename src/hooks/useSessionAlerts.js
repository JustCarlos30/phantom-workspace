import { useCallback, useEffect, useRef } from 'react';
import { pulseState } from './terminalBorderState.mjs';
import { chatAlertPulse, sessionAlert } from './sessionAlerts.mjs';

let audio;
const voices = new Map();

export function unlockSessionAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audio || audio.state === 'closed') audio = new AudioContext();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch { /* Audio is optional. */ }
}

export function silenceSessionAudio(id) {
  const voice = voices.get(id);
  if (voice) { try { voice.stop(); } catch { /* Already stopped. */ } voices.delete(id); }
}

function sound(id) {
  try {
    if (!audio || audio.state !== 'running') return;
    silenceSessionAudio(id);
    const oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    oscillator.connect(gain); gain.connect(audio.destination);
    voices.set(id, oscillator);
    oscillator.onended = () => { if (voices.get(id) === oscillator) voices.delete(id); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + 0.18);
  } catch { /* Visual alerts remain available. */ }
}

const labels = { 'pulse-attention': 'necesita tu atención', 'pulse-turn': 'espera tu turno', 'pulse-error': 'ha terminado con error', 'pulse-success': 'ha terminado correctamente' };

export function useSessionAlerts(nodes, activity, connected, notify, chat = null) {
  const previous = useRef(new Map());
  const notifyRef = useRef(notify); notifyRef.current = notify;
  useEffect(() => {
    const next = new Map();
    for (const node of nodes) {
      if (node.type !== 'terminal') continue;
      const isChat = !!node.data?.chat?.provider;
      if (isChat !== !!chat) continue;
      const session = activity[node.id];
      const identity = isChat ? `${node.data.chat.provider}:${chat.sessionId || ''}` : node.data?.sessionId;
      const ready = isChat ? !!chat : !!session && !!identity && session.id === identity;
      const pulse = isChat ? chatAlertPulse(node, chat) : pulseState(node, session);
      const result = sessionAlert(previous.current.get(node.id), { enabled: !!node.data?.watchAlerts, connected, identity, ready, pulse });
      if (result.state) next.set(node.id, result.state);
      if (result.alert) { notifyRef.current?.(`${node.title}: ${labels[result.alert]}.`, result.alert === 'pulse-error' ? 'error' : ''); sound(node.id); }
    }
    previous.current = next;
  }, [nodes, activity, connected, chat]);
  return useCallback(node => {
    if (node.data?.watchAlerts) silenceSessionAudio(node.id);
    else unlockSessionAudio();
  }, []);
}
