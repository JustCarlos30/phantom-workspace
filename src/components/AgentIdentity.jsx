import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Copy, Link2, RefreshCw, X } from 'lucide-react';
import './agent-identity.css';

export const AGENT_LABELS = { idle: 'Sin iniciar', working: 'Trabajando', blocked: 'Bloqueado', review: 'Listo para revisión' };

export function CardAgents({ cardId, workspace, onOpenPanel }) {
  const nodes = workspace.nodes.filter(n => n.type === 'terminal' && n.data.agent?.cardId === cardId);
  if (!nodes.length) return <p className="tw-muted">Sin terminal vinculada. Asígnala desde «Identidad y card» en una terminal.</p>;
  return <ul className="card-agents" aria-label="Terminales de esta card">{nodes.map(node => {
    const agent = node.data.agent;
    return <li key={node.id}><div><strong>{node.title}</strong><span className={`agent-state agent-${agent.status || 'idle'}`}>{AGENT_LABELS[agent.status || 'idle']}</span><p>{agent.step || 'Sin paso declarado'}</p><small>{agent.source === 'agent' ? 'Reportado por agente' : 'Declarado manualmente'}{agent.updatedAt ? ` · ${new Date(agent.updatedAt).toLocaleString()}` : ''}</small></div><button type="button" className="tw-button" onClick={() => onOpenPanel?.('terminal', { focusNodeId: node.id }, node.title)}><ArrowUpRight size={14} />Ver terminal</button></li>;
  })}</ul>;
}

export default function AgentIdentity({ node, workspace, api, refresh, flush, onOpenPanel, overview = false }) {
  const id = useId();
  const agent = node.data.agent || {};
  const [open, setOpen] = useState(false), [form, setForm] = useState(null);
  const [catalog, setCatalog] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [busy, setBusy] = useState(false);
  const request = useRef(0), lock = useRef(false), baseline = useRef(null), toggleRef = useRef(null);
  const nameRef = useRef(null);
  useEffect(() => { if (open && !overview) nameRef.current?.focus({ preventScroll: true }); }, [open, overview]);
  const close = () => { setOpen(false);toggleRef.current?.focus({ preventScroll: true }); };
  const load = async () => {
    const seq = ++request.current;setLoading(true);setError('');
    const results = await Promise.allSettled([api('phantom.list',{workspaceId:workspace.id,topic:'tasks'}),api('opencode.sessions',{workspaceId:workspace.id})]);
    if (seq !== request.current) return;
    const value = result => result.status === 'fulfilled' ? result.value : {available:false,items:[],reason:result.reason.message};
    setCatalog({cards:value(results[0]),sessions:value(results[1])});setLoading(false);
  };
  useEffect(() => () => {request.current++;}, []);
  const toggle = () => {
    if(open){close();return;}
    setFeedback('');
    baseline.current={name:node.title,cardId:agent.cardId||'',providerSessionId:agent.providerSessionId||'',step:agent.step||'',status:agent.status||'idle'};setForm(baseline.current);setOpen(true);load();
  };
  const run = async fn => {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setFeedback('');
    try {await flush?.();await fn();} catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}
  };
  const save = event => {event.preventDefault();run(async () => {
    const original=baseline.current;
    // Only edited fields: preserve reports arriving while the editor is open.
    const patch=Object.fromEntries(Object.entries(form).filter(([key,value])=>value!==original[key]));
    await api('terminal.agent.update',{workspaceId:workspace.id,nodeId:node.id,patch});await refresh();close();
  });};
  const copy = () => run(async () => {
    const context = node.data.sessionId ? await api('terminal.agent.context',{sessionId:node.data.sessionId}) : {name:node.title,...agent};
    const command='"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI"';
    await navigator.clipboard.writeText(`Tu identidad y asignación en Phantom Workspace:\n${JSON.stringify(context,null,2)}\n\nEn terminales nuevas de Phantom, consulta tu contexto vigente:\n${command} context\nReporta el paso real y el estado mientras trabajas:\n${command} report "Paso actual" working\nEstados: idle, working, blocked, review. review solicita revisión; no completa la card. Si faltan las variables PHANTOM_AGENT_*, esta terminal es anterior a la integración; usa una sesión nueva para reportar.`);
    setFeedback('Contexto guardado copiado. Los cambios de este formulario se conservan hasta que los guardes.');
  });
  const change = key => e => setForm(old=>({...old,[key]:e.target.value,...(key==='cardId'&&e.target.value!==old.cardId?{step:'',status:'idle'}:{})}));
  return <div className="agent-identity" hidden={overview} inert={overview ? true : undefined}>
    <div className="agent-identity-bar"><button ref={toggleRef} type="button" className="agent-identity-toggle" aria-expanded={open} aria-controls={`${id}-editor`} onClick={toggle}><Link2 size={14} /><span>{agent.cardTitle || 'Identidad y card'}</span></button>{agent.cardId && <button type="button" className="agent-card-link" title="Ver card vinculada" aria-label="Ver card vinculada" onClick={()=>onOpenPanel?.('tasks',{cardId:agent.cardId},agent.cardTitle)}><ArrowUpRight size={14}/></button>}{agent.status && <span className={`agent-state agent-${agent.status}`}>{AGENT_LABELS[agent.status]}</span>}</div>
    {!open && agent.step && <p className="agent-current-step" title={`${agent.step}\n${agent.source==='agent'?'Reportado por agente':'Declarado manualmente'}${agent.updatedAt?` · ${new Date(agent.updatedAt).toLocaleString()}`:''}`}><span>{agent.step}</span><small>{agent.source==='agent'?'Agente':'Manual'}</small></p>}
    {open && form && <section id={`${id}-editor`} className="agent-editor" aria-labelledby={`${id}-heading`} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}}}><header><strong id={`${id}-heading`}>Identidad y asignación</strong><button type="button" aria-label="Cerrar identidad" onClick={close}><X size={15}/></button></header><form onSubmit={save}>
      <div className="agent-field"><label htmlFor={`${id}-name`}>Nombre del agente</label><input ref={nameRef} id={`${id}-name`} required maxLength={512} value={form.name} onChange={change('name')}/></div>
      <div className="agent-field"><label htmlFor={`${id}-card`}>Card de Phantom</label><select id={`${id}-card`} value={form.cardId} onChange={change('cardId')} disabled={loading}><option value="">Sin card</option>{agent.cardId&&!catalog?.cards.items?.some(c=>c.id===agent.cardId)&&<option value={agent.cardId}>{agent.cardTitle || agent.cardId} · vínculo guardado</option>}{catalog?.cards.items?.filter(c=>c.kind==='card').map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></div>
      <div className="agent-field"><label htmlFor={`${id}-session`}>Sesión OpenCode</label><select id={`${id}-session`} value={form.providerSessionId} onChange={change('providerSessionId')} disabled={loading}><option value="">Sin sesión vinculada</option>{agent.providerSessionId&&!catalog?.sessions.items?.some(s=>s.id===agent.providerSessionId)&&<option value={agent.providerSessionId}>{agent.providerSessionId} · vínculo guardado</option>}{catalog?.sessions.items?.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
      <p className="agent-hint">Vincula una sesión de esta carpeta. El vínculo no indica que esté ejecutándose en esta terminal.</p>
      {loading&&<p role="status" className="agent-hint">Consultando cards y sesiones…</p>}{catalog&&['cards','sessions'].map(key=>catalog[key].available===false&&<p key={key} className="agent-catalog-error">{catalog[key].reason}</p>)}
      <div className="agent-field"><label htmlFor={`${id}-step`}>Paso actual</label><input id={`${id}-step`} maxLength={1000} value={form.step} onChange={change('step')} placeholder="Ej. Validando tokens"/></div><div className="agent-field"><label htmlFor={`${id}-status`}>Avance declarado</label><select id={`${id}-status`} value={form.status} onChange={change('status')}>{Object.entries(AGENT_LABELS).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></div>
      <p className="agent-hint">Este avance es manual. Los reportes del agente muestran su origen; el resultado de la card lo verifica Phantom.</p>
      <div className="agent-actions"><button type="submit" className="tw-button tw-primary" disabled={busy||loading}>{busy?'Procesando…':'Guardar identidad'}</button><button type="button" className="tw-button" disabled={busy||loading} onClick={load} aria-label="Actualizar cards y sesiones"><RefreshCw size={14}/></button><button type="button" className="tw-button" disabled={busy} onClick={copy}><Copy size={14}/>Copiar contexto guardado</button></div>
      {error&&<p className="agent-error" role="alert">{error}</p>}{feedback&&<p className="agent-hint" role="status">{feedback}</p>}
    </form></section>}
  </div>;
}
