// Process completion is authoritative; agent turn completion is only attention.
export function pulseState(node, session, chatPulse) {
  if (node.type === 'terminal' && node.data?.chat?.provider) return chatPulse || '';
  if (node.type !== 'terminal' || !session) return '';
  if (session.status === 'lost') return 'pulse-error';
  if (session.status === 'exited') {
    if (session.exitCode === 0) return 'pulse-success';
    return typeof session.exitCode === 'number' && Number.isFinite(session.exitCode) ? 'pulse-error' : '';
  }
  const agent = String(session.agentState || session.agent?.status || node.data?.agent?.status || '').toLowerCase();
  const screen = session.screen || session.screenState;
  const phase = node.data?.agent?.run?.phase;
  if (['failed', 'error'].includes(agent)) return 'pulse-error';
  if (screen === 'awaiting_approval' || phase === 'blocked' || ['blocked', 'needs_input', 'awaiting_input', 'waiting_for_input', 'awaiting_approval', 'needs_approval'].includes(agent)) return 'pulse-attention';
  if (screen === 'awaiting_input') return 'pulse-turn';
  const working = screen === 'working' || ['working', 'running', 'in_progress', 'busy', 'thinking'].includes(agent);
  if (!working && phase !== 'cancelled' && (phase === 'completed' || ['done', 'completed', 'finished'].includes(agent))) return 'pulse-success';
  if (session.needsYou || ['review', 'waiting'].includes(agent)) return 'pulse-turn';
  if (working) return 'pulse-working';
  return '';
}

export const PIXEL_KIND = { 'pulse-attention': 'call', 'pulse-turn': 'turn', 'pulse-error': 'error', 'pulse-success': 'success', 'pulse-working': 'work' };
