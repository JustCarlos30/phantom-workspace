import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, MessageSquarePlus, ShieldAlert, ShieldCheck, ShieldOff, SquareTerminal } from 'lucide-react';
import { ProviderGlyph } from '../Glyphs';
import { executionPolicy } from '../../../shared/execution-policy.mjs';

export const AGENT_MODES = [
  { id: 'claude', key: 'claude', label: 'Claude', hint: 'Conversar con Claude Code en esta carpeta' },
  { id: 'opencode', key: 'opencode', label: 'OpenCode', hint: 'Conversar con OpenCode en esta carpeta' },
  { id: 'codex', key: 'codex', label: 'Codex', hint: 'Conversar con Codex en esta carpeta' },
];
const SHELL_MODE = { id: null, key: 'shell', label: 'Terminal', hint: 'Usar la sesión de terminal de esta card' };

// Enabled providers from the global policy (settings.providers). Without it, Claude Code only, as before.
let policyCache = { enabled: ['claude'], chat: 'claude' }, policyRead = null, policyAt = 0;
export function rememberPolicy(settings) {
  try { const policy = executionPolicy(settings); policyCache = { enabled: Object.keys(policy.providers).filter(id => policy.providers[id].enabled), chat: policy.defaults.chat.client, policy }; policyAt = Date.now(); }
  catch (error) { policyCache = { enabled: ['claude'], chat: 'claude', error }; }
  return policyCache;
}
export function useEnabledProviders(api) {
  const [value, setValue] = useState(policyCache);
  useEffect(() => {
    let live = true;
    if (Date.now() - policyAt > 3000) policyRead ||= Promise.resolve().then(() => api('state.get', {})).then(state => rememberPolicy(state?.settings), () => policyCache).finally(() => { policyRead = null; });
    Promise.resolve(policyRead || policyCache).then(next => { if (live) setValue(next); });
    return () => { live = false; };
  }, [api]);
  return value;
}
const MODE_KEY = 'phantom.cardMode';
// New cards open in the mode chosen last if it is still enabled; otherwise the chats default (Claude Code unless configured).
export function preferredCardMode() {
  let saved = null;
  try { saved = localStorage.getItem(MODE_KEY); } catch { /* per-viewer preference only */ }
  if (saved === 'terminal') return null;
  if (saved && saved !== 'claude' && policyCache.enabled.includes(saved)) return saved;
  return saved === 'claude' && policyCache.enabled.includes('claude') ? 'claude' : policyCache.enabled.includes(policyCache.chat) ? policyCache.chat : 'claude';
}
const FULL_LIST = 'sudo, borrar a la fuerza fuera de la carpeta, git push --force o --delete, escribir en ~/.ssh, /etc o los archivos de arranque de la shell, curl | sh y formatear discos';
const AUTO_APPROVE = {
  claude: { auto: 'Trabaja solo. Te pide permiso para borrar, publicar o salir de su carpeta.', ask: 'Te pide permiso antes de cada cambio.', full: `Hace todo sin preguntar. Solo te pide permiso para: ${FULL_LIST}.` },
  opencode: { auto: 'Trabaja solo, según la configuración de OpenCode.', ask: 'Te pide permiso antes de cada cambio.', full: 'Hace todo sin preguntar, según la configuración de OpenCode.' },
  codex: { auto: 'Edita dentro de su carpeta. No puede pedirte permiso: lo que lo requiera se rechaza.', ask: 'Solo lee. No edita ni pide permiso.', full: 'Hace todo sin preguntar, también fuera de su carpeta y en la red.' },
};
const PERMISSION_LABELS = { ask: { claude: 'Pregunta todo', other: 'Solo lectura' }, auto: { claude: 'Autónomo', other: 'Puede editar' }, full: { claude: 'Total', other: 'Total' } };
const NEXT_MODE = { ask: 'auto', auto: 'full', full: 'ask' };
export const permissionLabel = (mode, provider) => provider === 'opencode' && mode === 'ask' ? 'Con aprobación' : PERMISSION_LABELS[mode]?.[provider === 'claude' ? 'claude' : 'other'] || mode;

// The card's permission mode, cycled with one button: Pregunta todo → Autónomo → Total.
export function PermissionSwitch({ mode, provider, descriptions = AUTO_APPROVE, disabled, onChange, row = false }) {
  const Shield = mode === 'full' ? ShieldAlert : mode === 'auto' ? ShieldCheck : ShieldOff;
  const text = permissionLabel(mode, provider), next = NEXT_MODE[mode] || 'ask';
  return <button type="button" className={`pc-permission${row ? ' pc-session-row' : ''}`} data-mode={mode} aria-pressed={mode !== 'ask'} disabled={disabled}
    aria-label={`Permisos: ${text}. Cambiar a ${permissionLabel(next, provider)}`} title={`${descriptions[provider]?.[mode] || ''}\n\nPulsa para cambiar a «${permissionLabel(next, provider)}».`}
    onClick={() => onChange(next)}>{row ? <><span className="pc-session-badge is-permission"><Shield size={18} aria-hidden="true" /></span><span className="pc-session-label">Permisos</span><span className="pc-session-value">{text}</span><ChevronRight size={16} aria-hidden="true" /></> : <><Shield size={14} aria-hidden="true" /><span>{text}</span></>}</button>;
}
const PERMISSION_STATUS = { allowed: 'Aprobado', always: 'Aprobado siempre', denied: 'Rechazado', cancelled: 'Sin respuesta' };

// A permission the agent is waiting on, answered in place.
export function PermissionRow({ part, onAnswer }) {
  const [busy, setBusy] = useState(false);
  const pending = part.status === 'pending';
  const answer = async decision => { setBusy(true); try { await onAnswer?.(part.id, decision); } catch { setBusy(false); } };
  return <div className={`pc-ask is-${part.status}`} role={pending ? 'group' : undefined} aria-label={pending ? `${part.tool} pide permiso` : undefined}>
    <span className="pc-ask-icon" aria-hidden="true"><ShieldAlert size={14} /></span>
    <div className="pc-ask-body">
      <p><strong>{part.tool}</strong> <span>{part.reason}</span></p>
      {part.detail && <code title={part.detail}>{part.detail}</code>}
    </div>
    {pending
      ? <div className="pc-ask-actions">
        <button type="button" disabled={busy} onClick={() => answer('deny')}>Rechazar</button>
        <button type="button" disabled={busy} title={`No volver a preguntar en esta conversación: ${part.key}`} onClick={() => answer('always')}>Siempre</button>
        <button type="button" className="is-primary" disabled={busy} onClick={() => answer('allow')}>Aprobar</button>
      </div>
      : <span className="pc-ask-state">{PERMISSION_STATUS[part.status] || part.status}</span>}
  </div>;
}

// Who answers in this card: shared by the segmented switch and the compact one.
function useModeChoice({ node, workspace, api, notify, disabled }) {
  const current = node.data?.chat?.provider ?? null;
  const [pending, setPending] = useState(undefined);
  const choosing = useRef(false);
  const active = pending === undefined ? current : pending;
  const choose = async id => {
    if (id === active || choosing.current || disabled) return;
    choosing.current = true;
    setPending(id);
    try {
      await api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, provider: id });
      try { localStorage.setItem(MODE_KEY, id ?? 'terminal'); } catch { /* per-viewer preference only */ }
    } catch (e) { setPending(undefined); notify?.(e.message, 'error'); }
    finally { choosing.current = false; }
  };
  useEffect(() => { setPending(undefined); }, [current]);
  return { active, pending, choosing, choose };
}

export function ProviderChoices({ active, enabled, disabled, onChoose }) {
  const modes = AGENT_MODES.filter(mode => enabled.includes(mode.id));
  const navigate = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (disabled || !modes.length) return;
    const index = Math.max(0, modes.findIndex(mode => mode.id === active));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? modes.length - 1 : 1)) % modes.length;
    event.currentTarget.querySelectorAll('button')[next]?.focus();
    onChoose(modes[next].id);
  };
  return <section className="pc-session-section"><h3>Quién responde</h3><div className="pc-providers" role="radiogroup" aria-label="Quién responde" onKeyDown={navigate}>
    {modes.map((mode, i) => <button key={mode.id} type="button" className="pc-session-row" role="radio" aria-checked={active === mode.id} tabIndex={active === mode.id || !modes.some(item => item.id === active) && i === 0 ? 0 : -1} disabled={disabled} onClick={() => onChoose(mode.id)}>
      <span className="pc-session-badge" data-provider={mode.id}><ProviderGlyph provider={mode.id} size={18} /></span><span className="pc-provider-text"><strong>{mode.label}</strong><small>{mode.hint}</small></span><span className="pc-radio" aria-hidden="true" />
    </button>)}
  </div>{!modes.length && <p role="status">No hay proveedores habilitados.</p>}{active && !enabled.includes(active) && <p className="pc-provider-history">Historial de {AGENT_MODES.find(mode => mode.id === active)?.label || active} · proveedor no habilitado</p>}</section>;
}

export function AgentChoices(props) {
  const { active, pending, choose } = useModeChoice(props);
  const { enabled } = useEnabledProviders(props.api);
  return <ProviderChoices active={active} enabled={enabled} disabled={props.disabled || pending !== undefined} onChoose={choose} />;
}

export function ModeSwitch({ node, workspace, api, notify, disabled = false }) {
  const { active, pending, choosing, choose } = useModeChoice({ node, workspace, api, notify, disabled });
  const policy = useEnabledProviders(api);
  const chatProvider = active || (policy.enabled.includes(policy.chat) ? policy.chat : policy.enabled[0]);
  const modes = [{ id: chatProvider, key: 'chat', label: 'Chat', hint: 'Conversar con el agente elegido' }, SHELL_MODE];
  const navigate = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (disabled || choosing.current) return;
    const count = modes.length;
    const index = modes.findIndex(mode => mode.id === active);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? count - 1 : 1)) % count;
    event.currentTarget.querySelectorAll('button')[next]?.focus();
    if (modes[next].id !== undefined) choose(modes[next].id);
  };
  const activeMode = modes.find(mode => mode.id === active) || modes[0];
  return <div className="pc-modes control-segmented" data-active={activeMode.key} role="radiogroup" aria-label="Interfaz de la sesión" aria-busy={pending !== undefined} onKeyDown={navigate} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    {modes.map(mode => <button key={mode.key} type="button" role="radio" aria-label={mode.label} tabIndex={active === mode.id ? 0 : -1} aria-checked={active === mode.id} title={mode.hint} disabled={mode.id === undefined || (disabled || pending !== undefined) && active !== mode.id} onClick={() => choose(mode.id)}>{mode.key === 'chat' ? <MessageSquarePlus size={16} aria-hidden="true" /> : <SquareTerminal size={16} aria-hidden="true" />}<span>{mode.label}</span></button>)}
  </div>;
}
