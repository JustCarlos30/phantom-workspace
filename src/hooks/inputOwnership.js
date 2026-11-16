export function overlayPolicy({ inspector, disconnected, ...blocking }) {
  const navigationBlocked = Object.values(blocking).some(Boolean);
  const inputBlocked = navigationBlocked || !!disconnected;
  return { inputBlocked, navigationBlocked, browserObscured: inputBlocked || !!inspector };
}
export const isEditingTarget = target => !!target?.closest('input,textarea,select,[contenteditable="true"],.xterm');
export function writeOwnedTerminalInput({ stream, active, element, focusedElement, sessionId, invoke, text, wheelOwned = false, blocked = false }) {
  if (blocked || !stream?.canWrite()) return null;
  if (!wheelOwned && (!active || !element?.contains(focusedElement))) return null;
  return invoke('terminal.write', { sessionId, data: text });
}
