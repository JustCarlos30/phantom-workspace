import { matchCommand } from './workspace-commands.mjs';

export function overlayPolicy({ inspector, disconnected, ...blocking }) {
  const navigationBlocked = Object.values(blocking).some(Boolean);
  const inputBlocked = navigationBlocked || !!disconnected;
  return { inputBlocked, navigationBlocked, browserObscured: inputBlocked || !!inspector };
}
export const isEditingTarget = target => !!target?.isContentEditable || !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.xterm');

export function dispatchWorkspaceKey(event, bindings, context, onCommand) {
  const id = matchCommand(event, bindings, context);
  if (!id) return false;
  event.preventDefault();
  event.stopPropagation();
  onCommand(id);
  return true;
}
export function writeOwnedTerminalInput({ stream, active, element, focusedElement, sessionId, invoke, text, wheelOwned = false, blocked = false }) {
  if (blocked || !stream?.canWrite()) return null;
  if (!wheelOwned && (!active || !element?.contains(focusedElement))) return null;
  return invoke('terminal.write', { sessionId, data: text });
}
