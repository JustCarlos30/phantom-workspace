export function overlayPolicy({ inspector, ...blocking }) {
  const inputBlocked = Object.values(blocking).some(Boolean);
  return { inputBlocked, browserObscured: inputBlocked || !!inspector };
}
export const isEditingTarget = target => !!target?.closest('input,textarea,select,[contenteditable="true"],.xterm');
export function writeOwnedTerminalInput({ stream, active, element, focusedElement, sessionId, invoke, text, wheelOwned = false, blocked = false }) {
  if (blocked || !stream?.canWrite()) return null;
  if (!wheelOwned && (!active || !element?.contains(focusedElement))) return null;
  return invoke('terminal.write', { sessionId, data: text });
}
