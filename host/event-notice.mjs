// Pure wording of agent notices from workspace bus events. Event text is untrusted data: sanitized, trimmed and quoted.
import { NOTICE_HEAD } from './run-watch.mjs';
import { blockerText } from './run-wake.mjs';
import { classifyBlocker } from '../integrations/run-blockers.mjs';

export const NOTICE_MAX = 1800;
const SENTENCE_MAX = 700;
const MORE_RESERVE = 70;

const text = (value, max) => String(value ?? '').replace(/\p{Cc}/gu, ' ').replace(/[`<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const quote = (value, max) => { const t = text(value, max); return t ? `«${t}»` : ''; };

const CLOSINGS = {
  worker: 'Cierre: actúa sobre tus tareas.',
  orchestrator: 'Cierre: coordina y destraba el proyecto.',
  assistant: 'Cierre: resume al usuario y pregunta solo lo que requiera su decisión.',
};

// Stable label for an event, used in the sentence.
export function noticeKind(event) {
  if (!event || typeof event !== 'object') return 'unknown';
  if (event.alert) return `alert-${text(event.alert, 30)}`;
  const kind = text(event.kind, 20) || 'unknown';
  if (kind === 'card' && event.status === 'working' && event.phase === 'repair') return 'card-repair';
  return `${kind}-${text(event.status, 30) || 'unknown'}`;
}

const CRITICAL = new Set(['card-blocked', 'card-failed', 'integration-conflict', 'integration-failed', 'integration-rejected', 'alert-stalled', 'alert-unattended']);
const priority = (event) => (CRITICAL.has(noticeKind(event)) || event?.escalated ? 0 : noticeKind(event) === 'integration-ready' || noticeKind(event) === 'card-review' ? 1 : 2);

function describe(event, lookup) {
  const id = text(event.entityId, 200) || 'desconocida';
  const info = (event.kind === 'card' && typeof lookup === 'function' ? (() => { try { return lookup(event.entityId) ?? {}; } catch { return {}; } })() : {});
  const label = quote(event.goal || info.goal || event.title, 160);
  const state = [text(event.status, 30), event.phase ? `fase ${text(event.phase, 30)}` : '', Number.isInteger(event.round) ? `ronda ${event.round}` : ''].filter(Boolean).join(', ');
  const reason = quote(event.reason, 200);
  const who = event.kind === 'terminal' ? `La terminal ${id}`
    : event.kind === 'integration' ? `La solicitud de integración ${id}${event.branch ? ` (rama ${text(event.branch, 120)})` : ''}`
      : `La tarea ${id}`;
  const parentId = text(event.parentId ?? info.parentId, 200);
  const head = event.alert
    ? `${who}${label ? ` ${label}` : ''} tiene la alerta ${text(event.alert, 30)}${event.minutesIdle != null ? ` (${Number(event.minutesIdle) || 0} min sin actividad)` : ''}${event.suggestedAction ? `, acción sugerida ${text(event.suggestedAction, 40)}` : ''}${reason ? `; motivo ${reason}` : ''}.`
    : `${who}${label ? ` ${label}` : ''} está en ${state}${reason ? `; motivo ${reason}` : ''}.`;
  return { id, head, parentId, info };
}

function action(event, role, d) {
  const kind = noticeKind(event), id = d.id;
  const worker = role === 'worker', orch = role === 'orchestrator';
  if (kind === 'card-blocked' || kind === 'card-failed') {
    const blocker = classifyBlocker(text(event.reason, 600), { id, goal: text(event.goal || d.info.goal, 240) });
    const directive = blocker.autonomy === 'orchestrator' || blocker.autonomy === 'auto'
      ? `Corrígelo ahora en esta misma terminal con un contrato nuevo y cancela el bloqueado ${id}; no abras otra terminal ni esperes al usuario.`
      : 'Informa al usuario y no lo destrabes tú.';
    return { directive, blocker: blockerText(blocker) };
  }
  if (kind === 'card-review' || kind === 'card-completed') {
    const parts = [];
    if (event.acceptance === 'accepted') parts.push(`Verifica el resultado, trae main${worker ? ` y pide la integración con agent.mjs submit ${id}` : ''}.`);
    else parts.push('Revisa el resultado antes de darlo por bueno.');
    if (kind === 'card-completed' && d.parentId) parts.push(`Hija completada: reanuda el padre ${d.parentId}.`);
    return { directive: parts.join(' ') };
  }
  if (kind === 'card-repair') return { directive: 'Está en reparación: es informativo, no actúes.' };
  if (kind === 'alert-stalled' || kind === 'alert-looping') return { directive: `Revisa phantom events ${id} y decide si detenerla y relanzarla con un contrato corregido.` };
  if (kind === 'alert-unattended') {
    const a = event.suggestedAction;
    const phrase = a === 'review-integration' ? 'Falta revisar su integración: revisa el resultado y pide o incorpora la integración.'
      : a === 'unblock' ? 'Sigue bloqueada sin atender: diagnostica y destrábala con un contrato nuevo si te corresponde.'
        : a === 'resume-parent' ? `La hija terminó y el padre${d.parentId ? ` ${d.parentId}` : ''} sigue quieto: reanúdalo.`
          : 'Sigue sin atender: revísala.';
    return { directive: phrase };
  }
  if (kind === 'integration-ready') return { directive: orch ? `Revísala e incorpórala con agent.mjs merge ${id}.` : 'Está lista; la incorpora el orquestador.' };
  if (['integration-conflict', 'integration-failed', 'integration-rejected'].includes(kind)) {
    return { directive: worker ? 'Trae main a tu rama, resuelve, vuelve a pasar los checks y reenvía con agent.mjs submit.' : 'Su terminal dueña debe resolverla; no actúes sobre su rama.' };
  }
  if (kind === 'integration-integrated') return { directive: 'Ya está integrada: informa y propón limpiar la rama y el worktree sin borrar nada todavía.' };
  return { directive: 'Informativo.' };
}

function sentence(event, role, lookup) {
  const d = describe(event, lookup);
  const a = action(event, role, d);
  const escalated = event.escalated ? `El dueño no pudo atenderlo${event.from ? ` (nodo de origen ${text(typeof event.from === 'object' ? event.from.nodeId ?? event.from.id : event.from, 120)})` : ''}. ` : '';
  const base = `${escalated}${d.head} ${a.directive}`;
  if (!a.blocker) return text(base, SENTENCE_MAX);
  const room = SENTENCE_MAX - base.length - 1;
  return room > 0 ? `${base} ${text(a.blocker, room)}` : text(base, SENTENCE_MAX);
}

export function renderNotice({ sub, events, lookup } = {}) {
  const role = CLOSINGS[sub?.role] ? sub.role : 'worker';
  const closing = CLOSINGS[role];
  const list = (Array.isArray(events) ? events : []).filter((e) => e && typeof e === 'object');
  const ordered = list.map((e, i) => ({ e, i })).sort((a, b) => priority(a.e) - priority(b.e) || a.i - b.i).map((x) => x.e);
  const budget = NOTICE_MAX - NOTICE_HEAD.length - closing.length - 2 - MORE_RESERVE;
  const parts = [];
  let used = 0;
  for (const event of ordered) {
    let s = sentence(event, role, lookup);
    if (!parts.length && s.length > budget) s = s.slice(0, budget);
    if (used + s.length + 1 > budget) break;
    parts.push(s); used += s.length + 1;
  }
  const more = ordered.length - parts.length;
  const out = [NOTICE_HEAD, ...parts, ...(more > 0 ? [`y ${more} más; léelos con agent.mjs events.`] : []), closing].join(' ');
  return out.replace(/\p{Cc}/gu, ' ').replace(/[`<>]/g, '').slice(0, NOTICE_MAX);
}
