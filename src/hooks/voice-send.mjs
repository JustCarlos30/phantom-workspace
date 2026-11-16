export function sendAction({ status, draft, armed }) {
  if (armed) return 'none';
  if (status === 'recording') return 'stop-and-send';
  if (status === 'transcribing') return 'await-voice';
  return draft.trim() ? 'send' : 'none';
}
export function canSubmit({ status, draft, armed, sending, connected, ready = true }) {
  return !!(connected && ready && !sending && sendAction({ status, draft, armed }) !== 'none');
}
export function mergeDictation(draft, text) {
  return draft.trim() ? `${draft.trimEnd()} ${text}` : text;
}
