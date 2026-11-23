import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Cpu, FoldVertical, Lightbulb, MessageSquarePlus, X } from 'lucide-react';
import { BAND_RANK, CONTEXT_BANDS, CONTEXT_SIZE_CAPS, CONTEXT_TOKEN_BANDS, contextAdvice, contextNudge, contextUse, nudgeDismissal, formatCost, formatTokens } from '../../hooks/chatState';
import { ProviderGlyph } from '../Glyphs';
import EmptyState from '../EmptyState.jsx';
import { EFFORTS } from '../../../shared/chat-options.mjs';

// The model for this provider in this card. The list comes from the provider
// (OpenCode's catalog, Claude's aliases); any other model name can be typed.
export function ModelPicker({ node, workspace, api, notify, provider, label, observed, disabled, row = false }) {
  const selected = node.data.chat.models?.[provider] || null;
  const [open, setOpen] = useState(false), [catalog, setCatalog] = useState(null), [failure, setFailure] = useState(''), [query, setQuery] = useState('');
  const root = useRef(null), search = useRef(null);
  useEffect(() => { setOpen(false); setCatalog(null); }, [provider]);
  useEffect(() => {
    if (!open) return;
    setQuery(''); setFailure(''); search.current?.focus({ preventScroll: true });
    let stale = false;
    api('chat.models', { workspaceId: workspace.id, nodeId: node.id }).then(value => { if (!stale) setCatalog(value); }, e => { if (!stale) setFailure(e.message); });
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => { stale = true; document.removeEventListener('pointerdown', outside, true); };
  }, [open, api, workspace.id, node.id]);
  const choose = async model => {
    setOpen(false);
    if (model === selected) return;
    try { await api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, model }); } catch (e) { notify?.(e.message, 'error'); }
  };
  const needle = query.trim().toLowerCase(), items = (catalog?.items || []).filter(item => !needle || item.id.toLowerCase().includes(needle));
  const groups = []; for (const item of items) { const last = groups.at(-1); if (last?.name === item.group) last.items.push(item); else groups.push({ name: item.group, items: [item] }); }
  const custom = query.trim() && !catalog?.items.some(item => item.id === query.trim()) ? query.trim() : '';
  const shown = selected || observed;
  return <div ref={root} className="pc-model-picker" onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
    <button type="button" className={`pc-model ${shown ? '' : 'is-empty'}${row ? ' pc-session-row' : ''}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} title={selected ? `Modelo elegido para ${label}: ${selected}` : observed ? `Modelo predeterminado de ${label}: ${observed}` : `Se usa el modelo predeterminado de ${label}`} onClick={() => setOpen(value => !value)}>
      {row ? <><span className="pc-session-badge is-model"><Cpu size={18} aria-hidden="true" /></span><span className="pc-session-label">Modelo</span><span className="pc-session-value">{shown || 'Predeterminado'}</span><ChevronRight size={16} aria-hidden="true" /></> : <><ProviderGlyph provider={provider} size={14} /><span>{shown || 'modelo predeterminado'}</span><ChevronDown size={14} aria-hidden="true" /></>}
    </button>
    {open && <div className="pc-models" role="dialog" aria-label={`Modelo de ${label}`}>
      <input ref={search} type="text" value={query} placeholder="Buscar o escribir un modelo…" aria-label="Buscar modelo" spellCheck={false} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const first = custom || items[0]?.id; if (first) choose(first); } }} />
      <div className="pc-models-list" role="listbox" aria-label="Modelos disponibles">
        {!needle && <button type="button" role="option" aria-selected={!selected} onClick={() => choose(null)}><span>Predeterminado de {label}</span>{!selected && <Check size={14} aria-hidden="true" />}</button>}
        {groups.map(group => <React.Fragment key={group.name}><h4>{group.name}</h4>{group.items.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === selected} onClick={() => choose(item.id)}><span className="pc-mono">{item.id}</span>{item.id === selected && <Check size={14} aria-hidden="true" />}</button>)}</React.Fragment>)}
        {custom && <button type="button" role="option" aria-selected={false} onClick={() => choose(custom)}><span>Usar <span className="pc-mono">{custom}</span></span></button>}
        {!catalog && !failure && <p role="status">Leyendo modelos…</p>}
        {failure && <p role="alert">{failure}. Puedes escribir el nombre del modelo.</p>}
        {catalog && !items.length && !custom && <EmptyState size="compact" description="Ningún modelo coincide." />}
        {catalog?.note && <p>{catalog.note}</p>}
      </div>
    </div>}
  </div>;
}

// How much of the model's window the conversation occupies, as read from the
// provider. Without a known window only the occupied tokens are stated.
export function ReasoningPicker({ node, workspace, api, notify, provider, observed, disabled }) {
  const selected = node.data.chat.reasoning?.[provider] || '';
  const save = async next => {
    if (next === selected) return;
    try { await api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, reasoning: next || null }); }
    catch (error) { notify?.(error.message, 'error'); }
  };
  if (provider === 'opencode') return <VariantPicker key={provider} node={node} workspace={workspace} api={api} observed={observed} selected={selected} disabled={disabled} onChoose={save} />;
  return <EffortMenu key={provider} label="Effort" heading="Esfuerzo de razonamiento" ariaName={`Effort de ${provider}`} title="Esfuerzo de razonamiento; auto usa el predeterminado del proveedor" levels={EFFORTS[provider] || []} selected={selected} disabled={disabled} onChoose={save} />;
}

// OpenCode's variants belong to each model: the catalog (`opencode models
// --verbose`) names the ones the chosen model accepts.
export function VariantPicker({ node, workspace, api, observed, selected, disabled, onChoose }) {
  const model = node.data.chat.models?.opencode || observed || '';
  const [catalog, setCatalog] = useState(null), [failure, setFailure] = useState('');
  useEffect(() => {
    let stale = false; setFailure('');
    api('chat.models', { workspaceId: workspace.id, nodeId: node.id }).then(value => { if (!stale) setCatalog(value); }, e => { if (!stale) setFailure(e.message); });
    return () => { stale = true; };
  }, [workspace.id, node.id, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = model ? catalog?.items?.find(entry => entry.id === model) : null;
  const levels = item?.variants || [];
  const note = failure ? `${failure}.`
    : !catalog ? 'Leyendo las variantes del modelo…'
    : !model ? 'Elige un modelo para ver sus variantes.'
    : !item ? `OpenCode no informa variantes de ${model}.`
    : !levels.length ? `${model} no tiene variantes.` : '';
  return <EffortMenu label="Variant" heading={model ? `Variantes de ${model}` : 'Variant'} ariaName="Variant de OpenCode" title="Variant del modelo en OpenCode; auto usa el predeterminado" levels={levels} selected={selected} note={note} disabled={disabled} onChoose={onChoose} />;
}

// Levels as a short ascending meter: the pill reads at a glance, the menu
// lines every option up against the same scale.
export function EffortMeter({ level, total }) {
  const bars = Math.max(1, Math.min(total, 5)), filled = level < 0 ? 0 : Math.max(1, Math.round((level + 1) / Math.max(total, 1) * bars));
  return <span className="pc-effort-meter" aria-hidden="true">{Array.from({ length: bars }, (_, i) => <i key={i} className={i < filled ? 'is-on' : ''} style={{ height: `${4 + i * 2}px` }} />)}</span>;
}

export function EffortMenu({ label, heading, ariaName, title, levels, selected, note, disabled, onChoose }) {
  // A saved value the current model no longer offers stays visible so it can be cleared.
  const stray = selected && !levels.includes(selected) ? selected : '';
  const options = ['', ...levels, ...(stray ? [stray] : [])];
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const root = useRef(null), list = useRef(null), trigger = useRef(null);
  const id = React.useId();
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.indexOf(selected)));
    list.current?.focus({ preventScroll: true });
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const choose = value => { close(); onChoose(value); };
  const keys = e => {
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) { e.preventDefault(); setActive(i => (i + move + options.length) % options.length); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setActive(e.key === 'Home' ? 0 : options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  const level = levels.indexOf(selected);
  return <div ref={root} className="pc-effort">
    <button ref={trigger} type="button" className={`pc-reasoning ${selected ? '' : 'is-empty'} ${open ? 'is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={`${ariaName}: ${selected || 'auto'}`} title={title} disabled={disabled}
      onClick={() => setOpen(value => !value)} onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); } }}>
      <EffortMeter level={stray ? -1 : level} total={levels.length || 3} />
      <span className="pc-reasoning-label">{label}</span>
      <span className="pc-reasoning-value">{selected || 'auto'}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div ref={list} className="pc-effort-menu" role="listbox" tabIndex={-1} aria-label={ariaName} aria-activedescendant={`${id}-${active}`} onKeyDown={keys}>
      <h4>{heading}</h4>
      {options.map((option, i) => <div key={option || 'auto'} id={`${id}-${i}`} role="option" aria-selected={option === selected} className={i === active ? 'is-active' : ''} onPointerEnter={() => setActive(i)} onClick={() => choose(option)}>
        <EffortMeter level={option === stray && stray ? -1 : i - 1} total={levels.length || 3} />
        <span>{option || 'auto'}</span>
        {!option && <small>predeterminado</small>}
        {option && option === stray && <small>no disponible en este modelo</small>}
        {option === selected && <Check size={14} aria-hidden="true" />}
      </div>)}
      {note && <p className="pc-effort-note" role="status">{note}</p>}
    </div>}
  </div>;
}

const share = ratio => ratio < .01 ? '<1' : String(Math.round(ratio * 100));
// The meter opens a panel that reads the context against quality/cost bands and
// offers compaction. `onCompact` is optional: until a provider wires it the
// action stays visible but disabled, so the recommendation is never a dead end.
export function ContextMeter({ meta, running = false, onCompact, onNew, reveal = 0, blocked = '' }) {
  const use = contextUse(meta);
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null), panel = useRef(null);
  const id = React.useId();
  // A bumped `reveal` opens the panel from outside, e.g. from the context nudge.
  useEffect(() => { if (reveal) setOpen(true); }, [reveal]);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  if (!use) return null;
  const advice = contextAdvice(use);
  const level = use.ratio >= .9 ? 'is-full' : use.ratio >= .7 ? 'is-high' : '';
  const fill = Math.min(1, use.window ? use.ratio : use.tokens / (CONTEXT_TOKEN_BANDS.compact * 1.5)), ring = 2 * Math.PI * 8;
  const percent = Math.round(use.ratio * 100);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const perTurn = Number.isFinite(meta.costUsd) && meta.costUsd > 0 && meta.turns > 0 ? meta.costUsd / meta.turns : null;
  const bands = use.window
    ? [['ok', 'Óptima', `< ${CONTEXT_BANDS.watch * 100}%`], ['watch', 'Vigilar', `${CONTEXT_BANDS.watch * 100}–${CONTEXT_BANDS.compact * 100}%`], ['compact', 'Larga', `≥ ${CONTEXT_BANDS.compact * 100}%`]]
    : [['ok', 'Óptima', `< ${formatTokens(CONTEXT_TOKEN_BANDS.watch)}`], ['watch', 'Vigilar', `${formatTokens(CONTEXT_TOKEN_BANDS.watch)}–${formatTokens(CONTEXT_TOKEN_BANDS.compact)}`], ['compact', 'Larga', `≥ ${formatTokens(CONTEXT_TOKEN_BANDS.compact)}`]];
  // Without a window the scale ends at 1.5× the compaction size.
  const watchAt = use.window ? CONTEXT_BANDS.watch * 100 : 100 / 1.5 * CONTEXT_TOKEN_BANDS.watch / CONTEXT_TOKEN_BANDS.compact;
  const compactAt = use.window ? CONTEXT_BANDS.compact * 100 : 100 / 1.5;
  const compactBlocked = running ? 'Disponible cuando termine la respuesta' : blocked;
  return <span ref={root} className="pc-context-wrap">
    <button ref={trigger} type="button" className={`pc-context ${level} is-${advice.band} ${open ? 'is-open' : ''}`} data-danger={use.window && use.ratio >= .95 || undefined} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-label={use.window ? `Contexto: ${formatTokens(use.tokens)} de ${formatTokens(use.window)} tokens, ${percent} %` : `Contexto: ${formatTokens(use.tokens)} tokens`}
      title={use.window ? `${use.tokens.toLocaleString()} de ${use.window.toLocaleString()} tokens de contexto en uso · ${advice.title}` : `${use.tokens.toLocaleString()} tokens de contexto en uso · ${advice.title}`}
      onClick={() => setOpen(value => !value)}>
      <svg className="pc-context-ring" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle className="pc-context-ring-track" cx="10" cy="10" r="8" />
        <circle className="pc-context-ring-arc" cx="10" cy="10" r="8" strokeDasharray={`${ring * fill} ${ring}`} transform="rotate(-90 10 10)" />
      </svg>
      {use.window && use.ratio >= .7 && <span className="pc-context-share">{percent} %</span>}
      {use.window && use.ratio >= .9 && <span className="pc-context-low">Queda poco contexto</span>}
    </button>
    {open && <div ref={panel} id={id} className={`pc-context-panel is-${advice.band}`} role="dialog" aria-label="Ventana de contexto" tabIndex={-1}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <header>
        <h4>Ventana de contexto</h4>
        <p className="pc-context-reading"><strong>{formatTokens(use.tokens)}</strong>{use.window ? <> de {formatTokens(use.window)} · <span className="pc-context-share">{share(use.ratio)}%</span></> : ' tokens · ventana no informada'}</p>
      </header>
      <div className="pc-context-scale" aria-hidden="true">
        <span className="pc-context-track" style={{ '--watch': `${watchAt}%`, '--compact': `${compactAt}%` }}>
          {use.window
            ? <i style={{ width: `${Math.max(1, Math.min(100, use.ratio * 100))}%` }} />
            : <i style={{ width: `${Math.max(1, Math.min(100, use.tokens / (CONTEXT_TOKEN_BANDS.compact * 1.5) * 100))}%` }} />}
          <b style={{ left: `${watchAt}%` }} />
          <b style={{ left: `${compactAt}%` }} />
        </span>
      </div>
      <ol className="pc-context-bands">
        {bands.map(([band, name, range]) => <li key={band} className={`is-${band} ${band === advice.band ? 'is-current' : ''}`} aria-current={band === advice.band ? 'true' : undefined}>
          <i aria-hidden="true" /><span>{name}</span><small>{range}</small>
        </li>)}
      </ol>
      {use.window && (advice.cause === 'size' || use.window * CONTEXT_BANDS.watch > CONTEXT_SIZE_CAPS.watch) && <p className={`pc-context-cap ${advice.cause === 'size' ? 'is-active' : ''}`}>
        En ventanas grandes también cuenta el tamaño: vigilar desde {formatTokens(CONTEXT_SIZE_CAPS.watch)} y compactar desde {formatTokens(CONTEXT_SIZE_CAPS.compact)} tokens, aunque el porcentaje sea bajo.
      </p>}
      <div className="pc-context-advice" role="status">
        <strong>{advice.title}</strong>
        <p>{advice.hint}</p>
      </div>
      {perTurn != null && <dl className="pc-context-facts">
        <div><dt>Costo acumulado</dt><dd>{formatCost(meta.costUsd)}</dd></div>
        <div><dt>Promedio por turno</dt><dd>{formatCost(perTurn)}</dd></div>
      </dl>}
      {onCompact && <button type="button" className={`pc-context-compact ${advice.band === 'compact' && !compactBlocked ? 'is-primary' : ''}`} disabled={!!compactBlocked} title={compactBlocked || 'Resumir el historial y liberar la ventana'}
        onClick={() => { close(); onCompact(); }}>
        <FoldVertical size={14} aria-hidden="true" />Compactar…
      </button>}
      {onCompact && compactBlocked && <p className="pc-context-note">{compactBlocked}</p>}
      {onNew && advice.band !== 'ok' && <button type="button" className={`pc-context-compact ${advice.band === 'compact' && (!onCompact || compactBlocked) ? 'is-primary' : ''}`} disabled={running} title={running ? 'Disponible cuando termine la respuesta' : undefined}
        onClick={() => { close(); onNew(); }}>
        <MessageSquarePlus size={14} aria-hidden="true" />Empezar conversación nueva
      </button>}
    </div>}
  </span>;
}

// A friendly, dismissible heads-up when the context crosses into a costlier band.
// Dismissing silences the current band only; dropping back (after compacting or
// a new conversation) re-arms it.
export function ContextNudge({ meta, nodeId, firstMessageId, onReveal }) {
  const use = contextUse(meta);
  const key = `phantom.chatNudge.${nodeId}.${firstMessageId}`;
  const [dismissed, setDismissed] = useState(() => {
    try { const value = Number(localStorage.getItem(key)); return [0, 1, 2].includes(value) ? value : 0; } catch { return 0; }
  });
  const rank = use ? BAND_RANK[contextAdvice(use).band] : null;
  useEffect(() => { setDismissed(previous => nudgeDismissal(previous, rank)); }, [rank]);
  useEffect(() => { try { localStorage.setItem(key, String(dismissed)); } catch { /* Memory only. */ } }, [key, dismissed]);
  const nudge = contextNudge(use, dismissed);
  if (!nudge) return null;
  return <section className={`pc-nudge is-${nudge.band}`} role="status" aria-label="Aviso de contexto">
    <Lightbulb size={15} aria-hidden="true" />
    <div><strong>{nudge.title}</strong><p>{nudge.body}</p></div>
    <span className="pc-nudge-actions">
      <button type="button" onClick={onReveal}>Ver opciones</button>
      <button type="button" className="pc-icon" title="Entendido" aria-label="Ocultar este aviso" onClick={() => setDismissed(nudge.rank)}><X size={14} /></button>
    </span>
  </section>;
}
