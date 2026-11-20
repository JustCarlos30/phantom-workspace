import { pulseState } from './terminalBorderState.mjs';

const alerts = new Set(['pulse-attention', 'pulse-turn', 'pulse-error', 'pulse-success']);

export function sessionAlert(previous, { enabled, connected, identity, ready, pulse }) {
  if (!enabled || !connected || !ready || !identity) return { state: null, alert: '' };
  const state = { identity, pulse: pulse || '' };
  return { state, alert: previous && previous.identity === identity && previous.pulse !== state.pulse && alerts.has(state.pulse) ? state.pulse : '' };
}

export function chatAlertPulse(node, chat) {
  if (!chat) return '';
  const messages = chat.messages || [];
  const waiting = messages.some(message => (message.parts || []).some(part => (part.type === 'permission' || part.type === 'question') && part.status === 'pending'));
  const last = messages.at(-1);
  const pulse = waiting ? 'pulse-attention' : chat.running ? 'pulse-working' : last?.role === 'assistant' && last.status === 'error' ? 'pulse-error' : last?.role === 'assistant' && last.status === 'done' ? 'pulse-turn' : '';
  return pulseState(node, null, pulse);
}
