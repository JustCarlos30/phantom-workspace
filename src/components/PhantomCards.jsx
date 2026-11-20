import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, GitBranch, Clock, Columns3, ExternalLink, FileText, Layers, LayoutDashboard, Pause, Play, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Square, X, XCircle } from 'lucide-react';
import { Button, Field, ErrorNotice, DataView, useResource, useOperation } from './PluginPrimitives';
import { itemsOf, contractOf, stateOf, refOf, goalOf, emptyCardForm, cardFormOf, buildCardInput, cardActions, executionFacts } from '../hooks/plugin-model.mjs';
import { ZONES, STATUS, buildDesk, changedStatuses, statusMap, statusLabel, statusTone, relative, duration, lastLine, budgetText, argvText, runsOf, parseCommand, commandOf, budgetFieldsOf, budgetJsonOf, checkResult, eventLabel, eventDetails, phaseOf, titleOf, sectionsOf, explainReason, runSummary, groupByCause, tailOf } from '../hooks/phantom-desk.mjs';
import { cardLocations } from '../hooks/branches-model.mjs';
const unavailableReason = reason => reason?.replace(/^Phantom unavailable: /, '') || 'sin motivo informado';

const POLL_MS = 4000;

function StatusPill({ status }) {
  return <span className={`pc-pill pc-${statusTone(status)}`}><i aria-hidden="true" />{statusLabel(status)}</span>;
}

function CardForm({ existing, workspace, api, notify, onSaved, onClose }) {
  // The UI edits commands and budget as plain fields; the contract model keeps JSON.
  const [form, setForm] = useState(() => {
    const base = existing ? cardFormOf(existing) : emptyCardForm();
    return { ...base, checks: base.checks.map(check => ({ ...check, argv: commandOf(check.argv) })), budget: budgetFieldsOf(base.budget) };
  });
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(null);
  const op = useOperation(notify);
  const patch = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const submit = event => {
    event.preventDefault();
    op.run(async () => {
      if (existing && !confirmed) throw new Error('Confirma explícitamente el reemplazo.');
      const checks = form.checks.map(check => {
        const argv = parseCommand(check.argv);
        if (!argv.length) throw new Error(`Check ${check.name || ''}: escribe el comando que Phantom debe ejecutar.`.replace('  ', ' '));
        return { ...check, argv: JSON.stringify(argv) };
      });
      const input = buildCardInput({ ...form, checks, budget: budgetJsonOf(form.budget) }, existing);
      const value = await api(existing ? 'phantom.update' : 'phantom.create', { workspaceId: workspace.id, pluginId: 'phantom', kind: 'card', ...(existing ? { id: existing.id, replace: true } : {}), input });
      setResult(value);
      onSaved?.(value);
    }, existing ? 'Reemplazo creado; original conservado' : 'Card creada');
  };
  const original = existing ? refOf(existing) || { id: existing.id, revision: existing.revision ?? 'desconocida' } : null;
  return <section className="plugin-card-form pc-sheet pc-form" aria-label={existing ? 'Crear reemplazo explícito' : 'Nueva Card'}>
    <header className="pc-form-head"><div><h3>{existing ? 'Crear reemplazo explícito' : 'Nueva Card'}</h3>
      <p>{existing ? `La Card ${existing.id} es inmutable. Guardar crea un reemplazo y conserva el original (revisión ${original.version ?? original.revision}).` : 'Un contrato con objetivo, rutas y checks reales. Guardar no inicia ninguna ejecución.'}</p></div>
      <button type="button" className="pc-icon" aria-label="Cerrar formulario de Card" onClick={onClose} disabled={op.busy}><X size={15} /></button></header>
    <form className="plugin-form tw-form" onSubmit={submit}><fieldset disabled={op.busy || Boolean(result)}>
      <Field label="Objetivo"><textarea rows={2} required value={form.goal} placeholder="Qué debe quedar hecho y verificable" onChange={e => patch('goal', e.target.value)} /></Field>
      <Field label="Alcance · una ruta por línea" hint="Rutas relativas del proyecto que la Card puede tocar. Phantom valida el contrato; aquí no se comprueba que existan."><textarea className="pc-mono" rows={3} required value={form.scope} onChange={e => patch('scope', e.target.value)} /></Field>
      <div className="pc-form-group"><h4>Checks de aceptación</h4><p className="tw-muted">Comandos reales tal como los escribirías en una terminal; las comillas agrupan palabras y no se expande nada. No se ejecutan al guardar.</p>
        {form.checks.map((check, index) => <div className="plugin-check pc-check-edit" key={index}>
          <Field label={`Nombre del check ${index + 1}`}><input required value={check.name} onChange={e => patch('checks', form.checks.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} /></Field>
          <Field label={`Comando del check ${index + 1}`}><input className="pc-mono" required value={check.argv} placeholder="npm test" onChange={e => patch('checks', form.checks.map((item, i) => i === index ? { ...item, argv: e.target.value } : item))} /></Field>
          <Button disabled={form.checks.length === 1} onClick={() => patch('checks', form.checks.filter((_, i) => i !== index))}>Quitar check {index + 1}</Button>
        </div>)}
        <Button icon={Plus} onClick={() => patch('checks', [...form.checks, { name: '', argv: '' }])}>Añadir check</Button></div>
      <Field label="Dependencias · un ID de Card por línea"><textarea className="pc-mono" rows={2} value={form.deps} onChange={e => patch('deps', e.target.value)} /></Field>
      <div className="pc-form-group"><h4>Presupuesto</h4><p className="tw-muted">Opcional. Los campos vacíos usan los límites nativos de Phantom.</p>
        <div className="pc-budget">{[['timeoutMin', 'Tiempo máximo (min)'], ['maxTurns', 'Turnos'], ['maxTools', 'Herramientas'], ['maxRepairs', 'Reparaciones']].map(([key, label]) => <Field key={key} label={label}><input type="number" min="0" step={key === 'timeoutMin' ? '1' : '1'} inputMode="numeric" value={form.budget[key]} onChange={e => patch('budget', { ...form.budget, [key]: e.target.value })} /></Field>)}</div></div>
      <details className="plugin-advanced pc-advanced"><summary>Coordinación avanzada</summary><Field label="Coordinación nativa JSON" hint="Solo si necesitas children u otras opciones de coordinación del contrato nativo."><textarea className="pc-mono" rows={5} value={form.coordination} onChange={e => patch('coordination', e.target.value)} /></Field></details>
      {existing && <label className="plugin-confirm pc-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Confirmo crear un reemplazo conservando el original.</label>}
    </fieldset>
      <div className="pc-form-actions"><Button type="submit" tone="primary" disabled={op.busy || Boolean(result) || (existing && !confirmed)}>{existing ? 'Crear reemplazo' : 'Guardar Card'}</Button><Button disabled={op.busy} onClick={onClose}>Cerrar formulario</Button></div>
    </form>
    <ErrorNotice error={op.error} clear={op.clear} />{op.busy && <p role="status" className="pc-status">Guardando…</p>}
    {result && <><p role="status" className="pc-status is-ok">Guardado en Phantom. No se ha iniciado una ejecución.</p><DataView value={result} label="Ver respuesta de Phantom" /></>}
  </section>;
}

const ACTIONS = [
  ['run', 'Ejecutar', Play], ['verify', 'Verificar', ShieldCheck], ['recover', 'Recuperar', RotateCcw], ['stop', 'Detener', Square], ['cancel', 'Cancelar', XCircle],
];

function CheckEvidence({ title, evidence }) {
  return <section className="pc-check-evidence"><h4>{title}</h4>{evidence?.available ? evidence.checks.length ? evidence.checks.map((check, index) => <div key={index} className="pc-check-result">
    <strong>{check.name || `Prueba ${index + 1}`} · {checkResult(check)}</strong><span> · {Number.isFinite(check.durationMs) ? `${check.durationMs} ms` : 'Duración desconocida'}</span>
    {check.reason && <p>{check.reason}</p>}
    <details><summary>Comando completo y contexto</summary><pre>{argvText(check.executedArgv || check.argv) || 'Comando no disponible'}</pre>{check.executedArgv && check.argv && <><p>Comando declarado</p><pre>{argvText(check.argv)}</pre></>}<p>Directorio: {check.cwd || 'No informado'} · Salida: {check.exitCode ?? 'No informada'} · Señal: {check.signal || 'Ninguna informada'}</p></details>
    {['stdout', 'stderr', 'error', 'tests'].map(key => check[key] != null && check[key] !== '' && <details key={key}><summary>{({ stdout: 'Salida estándar', stderr: 'Salida de errores', error: 'Error', tests: 'Detalle de pruebas' })[key]}</summary><pre>{typeof check[key] === 'string' ? check[key] : JSON.stringify(check[key], null, 2)}</pre></details>)}
  </div>) : <p className="pc-quiet">Sin resultados registrados; no acredita aprobación.</p> : <p className="pc-quiet">Evidencia no disponible · {evidence?.reason || 'Sin artefacto observado'}. No acredita aprobación ni que la prueba no se ejecutara.</p>}</section>;
}

const MESSAGE_LINES = 6;
const TABS = [['summary', 'Resumen'], ['changes', 'Cambios'], ['verification', 'Verificación'], ['activity', 'Actividad']];
const msText = value => value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;

function Tabs({ label, tabs, children }) {
  const [current, setCurrent] = useState(tabs[0][0]);
  const base = useId(), refs = useRef({});
  const move = (event, index) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : null;
    if (next == null) return;
    event.preventDefault(); setCurrent(tabs[next][0]); refs.current[tabs[next][0]]?.focus();
  };
  return <div className="pc-tabs">
    <div role="tablist" aria-label={label} className="pc-tablist">{tabs.map(([tab, text], index) => <button key={tab} ref={element => { refs.current[tab] = element; }} type="button" role="tab" id={`${base}-tab-${tab}`} aria-controls={`${base}-panel-${tab}`} aria-selected={current === tab} tabIndex={current === tab ? 0 : -1} onClick={() => setCurrent(tab)} onKeyDown={event => move(event, index)}>{text}</button>)}</div>
    <div role="tabpanel" id={`${base}-panel-${current}`} aria-labelledby={`${base}-tab-${current}`} tabIndex={0} className="pc-tabpanel">{children(current)}</div>
  </div>;
}

function CheckLine({ check, index }) {
  const failed = check.passed === false;
  const stdout = tailOf(check.stdout), stderr = tailOf(check.stderr), error = typeof check.error === 'string' ? check.error : '';
  return <li className={`pc-check-line${failed ? ' is-failed' : check.passed === true ? ' is-ok' : ''}`}>
    <span className="pc-check-mark" aria-hidden="true">{check.passed === true ? '✓' : failed ? '✗' : '·'}</span>
    <div><strong>{check.name || `Check ${index + 1}`}</strong> <span className="pc-check-meta">{checkResult(check)}{Number.isFinite(check.durationMs) ? ` · ${msText(check.durationMs)}` : ''}</span>
      {check.reason && <p>{check.reason}</p>}
      {(stdout || stderr || error) && <details className="pc-check-evidence" open={failed}><summary>Últimas líneas de salida</summary>{error && <pre>{error}</pre>}{stderr && <><p>Salida de errores</p><pre>{stderr}</pre></>}{stdout && <><p>Salida estándar</p><pre>{stdout}</pre></>}</details>}
    </div>
  </li>;
}

function CardDetail({ id, catalog, workspace, api, refresh, notify, plugin, onOpenPanel, onChanged, onClose }) {
  const payload = { workspaceId: workspace.id, pluginId: 'phantom' };
  const detail = useResource(api, 'phantom.detail', { workspaceId: workspace.id, topic: 'tasks', id });
  const events = useResource(api, 'phantom.events', { workspaceId: workspace.id, id });
  const controllers = useResource(api, 'phantom.controllers', { workspaceId: workspace.id });
  const models = useResource(api, 'plugins.models', { workspaceId: workspace.id, id: 'phantom' }, { enabled: false });
  const [model, setModel] = useState(''), [editing, setEditing] = useState(null), [output, setOutput] = useState(null), [fullMessage, setFullMessage] = useState(false);
  const modelList = useId();
  const op = useOperation(notify);
  const value = detail.data;
  const native = value?.task || value;
  const ready = native && value?.available !== false && native.available !== false && !detail.error;
  const contract = contractOf(native);
  const allControllers = itemsOf(controllers.data);
  const related = allControllers.filter(item => item.taskId === id);
  const actions = cardActions(value, allControllers);
  const facts = executionFacts({ contract, typedModel: model, pluginModel: plugin?.config?.model, recordedRequest: events.data?.model });
  const controlsBlocked = op.busy || detail.loading || Boolean(detail.error) || controllers.loading || Boolean(controllers.error) || controllers.data?.available === false || !Array.isArray(controllers.data?.items);
  const reload = () => { detail.reload(); events.reload(); controllers.reload(); onChanged?.(); };
  const control = action => op.run(async () => {
    if (action === 'run' && facts.blocked) throw new Error(facts.blocked);
    const result = await api('phantom.control', { ...payload, id, action, ...(action === 'run' && model.trim() ? { model: model.trim() } : {}) });
    setOutput(result); reload(); await refresh?.();
  }, 'Acción enviada a Phantom');
  const status = native ? stateOf(native) : catalog?.status || 'unknown';
  const available = ACTIONS.filter(([action]) => actions[action]);
  const runs = runsOf(value);
  const run = runs[0] || null;
  const summary = runSummary(run);
  const files = Array.isArray(run?.summary?.files) ? run.summary.files : [];
  const rounds = Array.isArray(run?.evidence?.verification) ? run.evidence.verification : [];
  const lastRound = rounds.filter(round => round?.available).at(-1) || null;
  const eventItems = itemsOf(events.data).slice().reverse();
  const depStatus = dep => catalog?.lookup?.get(dep);
  const goal = native ? goalOf(native) : catalog?.goal || id;
  const reason = native?.reason || catalog?.reason || '';
  const explain = reason ? explainReason(reason) : null;
  const message = typeof run?.summary?.message === 'string' ? run.summary.message.trim() : '';
  const shortMessage = message.split('\n').slice(0, MESSAGE_LINES).join('\n').slice(0, 600);
  const hour = at => at ? new Date(at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '··:··';
  return <article className="pc-sheet pc-contract" aria-label={`Detalle ${titleOf(goal) || id}`}>
    <header className="pc-contract-head">
      <button type="button" className="pc-icon pc-back" aria-label="Volver a la mesa" onClick={onClose}><ArrowLeft size={15} /></button>
      <div className="pc-contract-title">
        <div className="pc-contract-meta"><StatusPill status={status} /></div>
        <h2 className="pc-goal-summary">{titleOf(goal) || id}</h2>
      </div>
      <button type="button" className="pc-icon" aria-label="Actualizar detalle, eventos y controladores" title="Actualizar" onClick={reload}><RefreshCw size={14} className={detail.loading ? 'spinning' : ''} /></button>
      <button type="button" className="pc-icon pc-close" aria-label="Cerrar detalle" onClick={onClose}><X size={15} /></button>
    </header>
    {detail.loading && !value && <div className="pc-skeleton" role="status" aria-label="Leyendo contrato"><i /><i /><i /></div>}
    {detail.error && <ErrorNotice error={detail.error} retry={detail.reload} />}
    {value?.available === false && <p className="pc-notice">Phantom no está disponible: {unavailableReason(value.reason)}.</p>}
    {ready && <>
      <section className="pc-next" aria-label={explain ? 'Qué pasó' : 'Siguiente paso'}>
        <div className="pc-next-copy">
          {explain ? <><strong className="pc-what-label"><AlertTriangle size={14} aria-hidden="true" />{explain.label}{explain.child ? ` · subtarea ${explain.child}` : ''}</strong><span>{explain.meaning}</span><span className="pc-what-next">{explain.next}</span></>
            : <><strong>Siguiente paso</strong><span>{available.length ? 'Solo se muestran las acciones que Phantom admite ahora para esta Card.' : 'Phantom no admite acciones sobre esta Card en su estado actual.'}</span></>}
        </div>
        {message && <div className="pc-message"><span className="pc-label">Mensaje final del agente</span><p>{fullMessage ? message : shortMessage}</p>{message.length > shortMessage.length && <button type="button" className="pc-link" aria-expanded={fullMessage} onClick={() => setFullMessage(old => !old)}>{fullMessage ? 'Ver menos' : 'Ver completo'}</button>}</div>}
        {facts.blocked && <p className="pc-reason" role="alert"><AlertTriangle size={14} aria-hidden="true" />{facts.blocked}</p>}
        {(available.length > 0 || actions.run) && <div className="pc-next-actions">
          {available.map(([action, label, Icon], index) => <Button key={action} icon={Icon} tone={index === 0 ? 'primary' : undefined} disabled={controlsBlocked || (action === 'run' && Boolean(facts.blocked))} onClick={() => control(action)}>{label}</Button>)}
          {actions.run && <details className="pc-run-options"><summary>Opciones de ejecución</summary><div className="pc-model"><Field label="Modelo para ejecutar" hint={`Vacío: ${facts.requested} (${facts.requestedSource}). Solo Claude Code.`}><input list={modelList} value={model} onChange={e => setModel(e.target.value)} placeholder="claude-code/sonnet" /></Field><datalist id={modelList}>{models.data?.models?.map(item => <option key={item} value={item} />)}</datalist><Button disabled={models.loading} onClick={models.reload}>Ver modelos Claude Code</Button></div></details>}
        </div>}
      </section>
      <ErrorNotice error={op.error} clear={op.clear} />{op.busy && <p role="status" className="pc-status">Enviando acción…</p>}
      <dl className="pc-facts pc-summary" aria-label="Resumen de la última ejecución">
        <div><dt>Cambios</dt><dd className="pc-num">{summary.files ? `${summary.files} ${summary.files === 1 ? 'archivo' : 'archivos'} · +${summary.added} −${summary.removed}` : 'Sin cambios registrados'}</dd></div>
        <div><dt>Checks</dt><dd className="pc-num">{summary.checksTotal ? `${summary.checksPassed}/${summary.checksTotal}` : 'Sin resultados'}</dd></div>
        <div><dt>Duración</dt><dd className="pc-num">{run ? duration(run.startedAt, run.endedAt) || 'No informada' : 'Sin ejecuciones'}</dd></div>
        <div><dt>Intentos</dt><dd className="pc-num">{summary.attempts}</dd></div>
      </dl>
      <Tabs label="Secciones de la Card" tabs={TABS}>{tab => tab === 'summary' ? <>
        {sectionsOf(goal).filter(section => section.heading || section.body).map((section, index) => <section key={index} className="pc-goal-section">{section.heading && <h4 className="pc-label">{section.heading}</h4>}<p className="pc-prose">{section.body}</p></section>)}
        <h4 className="pc-label">Alcance · {contract.scope?.length || 0} archivos</h4>
        {contract.scope?.length ? <ul className="pc-list">{contract.scope.map(path => <li key={path}><FileText size={13} aria-hidden="true" className="pc-list-icon" /><code>{path}</code></li>)}</ul> : <EmptyState className="pc-quiet" size="compact" description="No declarado." />}
        <h4 className="pc-label">Dependencias</h4>
        {contract.dependencies?.length ? <div className="pc-deps">{contract.dependencies.map(dep => { const known = depStatus(dep); return <span key={dep} className={`pc-dep pc-${statusTone(known?.status)}`} title={known?.goal || dep}><i aria-hidden="true" />{known ? `${known.title || titleOf(known.goal)} · ${statusLabel(known.status)}` : dep}</span>; })}</div> : <EmptyState className="pc-quiet" size="compact" description="Ninguna." />}
      </> : tab === 'changes' ? <>
        {files.length ? <ul className="pc-list">{files.map(file => <li key={file.path}><FileText size={13} aria-hidden="true" className="pc-list-icon" /><code>{file.path}</code><span className="pc-diffstat pc-num"><span className="is-add">+{file.added ?? 0}</span> <span className="is-del">−{file.removed ?? 0}</span></span></li>)}</ul> : <EmptyState className="pc-quiet" size="compact" description="Sin cambios registrados" />}
        {run?.summary?.patch && <pre className="pc-output pc-patch" tabIndex={0} aria-label="Parche">{run.summary.patch}</pre>}
        {run?.summary?.patchTruncated && <p className="pc-quiet">Phantom recortó el parche; el completo está en el worktree de la tarea.</p>}
      </> : tab === 'verification' ? !run ? <EmptyState className="pc-quiet" size="compact" description="Sin ejecuciones registradas." /> : <>
        {lastRound ? <><p className="pc-quiet">Ronda {lastRound.round ?? rounds.length} · {summary.checksPassed}/{summary.checksTotal} pasaron</p>
          {lastRound.checks?.length ? <ul className="pc-checks">{lastRound.checks.map((check, index) => <CheckLine key={`${check.name}:${index}`} check={check} index={index} />)}</ul> : <p className="pc-quiet">Sin resultados registrados; no acredita aprobación.</p>}</>
          : <p className="pc-quiet">Sin verificación posterior disponible; no acredita aprobación.</p>}
        {rounds.some(round => round !== lastRound) && <details className="pc-check-evidence"><summary>Rondas anteriores · {rounds.filter(round => round !== lastRound).length}</summary>{rounds.filter(round => round !== lastRound).map((round, index) => <CheckEvidence key={round.round ?? index} title={`Pruebas posteriores · ronda ${round.round ?? index + 1}`} evidence={round} />)}</details>}
        <details className="pc-check-evidence"><summary>Pruebas iniciales (baseline)</summary><CheckEvidence title="Pruebas iniciales · baseline del worktree" evidence={run.evidence?.baseline} /></details>
      </> : events.error ? <ErrorNotice error={events.error} retry={events.reload} /> : eventItems.length ? <ol className="pc-events">{eventItems.map((event, index) => <li key={event.seq ?? event.id ?? index}><span className="pc-num">{hour(event.at)}</span><div><strong>{eventLabel(event.type)}</strong>{typeof event.data?.reason === 'string' && <p>{event.data.reason}</p>}</div></li>)}</ol> : events.loading ? <p className="pc-quiet" role="status">Leyendo eventos…</p> : events.data?.available === false ? <p className="pc-notice">{events.data.reason}</p> : <EmptyState className="pc-quiet" size="compact" description="Sin eventos observados." />}</Tabs>
      <details className="pc-tech"><summary>Detalles técnicos</summary><div className="pc-tech-body">
        <details className="pc-full-goal"><summary>Objetivo completo</summary><p>{goalOf(native)}</p></details>
        <p className="pc-quiet">{phaseOf(native)}</p>
        {reason && <p className="pc-reason"><AlertTriangle size={14} aria-hidden="true" />Motivo de tarea: {reason}</p>}
        <dl className="pc-facts pc-execution" aria-label="Ejecución efectiva">
          <div><dt>Cliente</dt><dd>{facts.client}</dd></div>
          <div><dt>Motor</dt><dd>{facts.engine}</dd></div>
          <div><dt>Modelo solicitado</dt><dd>{facts.requested} <span className="pc-quiet">· origen: {facts.requestedSource}</span></dd></div>
          <div><dt>Modelo observado</dt><dd>{facts.observedLabel}{facts.status === 'observed' ? <span className="pc-quiet"> · evidencia registrada</span> : <span className="pc-quiet"> · sin evidencia del runtime{facts.recordedRequest ? `; el historial solo registra la solicitud «${facts.recordedRequest}»` : ''}</span>}</dd></div>
        </dl>
        {facts.note && <p className="pc-quiet">{facts.note}</p>}
        {output && <DataView value={output} label="Ver respuesta real del control" />}
        <dl className="pc-facts">
        <div><dt>ID</dt><dd><code>{id}</code></dd></div>
        <div><dt>Tipo</dt><dd>{native?.kind === 'card' ? 'Card coordinada' : native?.kind || 'Card'}</dd></div>
        {(native.revision ?? refOf(native)?.version) != null && <div><dt>Revisión</dt><dd>{native.revision ?? refOf(native)?.version}</dd></div>}
        <div><dt>Creada</dt><dd>{relative(native.createdAt) || 'No informada'}</dd></div>
        <div><dt>Actualizada</dt><dd>{relative(native.updatedAt) || 'No informada'}</dd></div>
        {budgetText(contract.budget) && <div><dt>Presupuesto</dt><dd>{budgetText(contract.budget)}</dd></div>}
      </dl>
      <div className="pc-columns">
        <section><h3 className="pc-label">Checks declarados · {contract.checks?.length || 0}</h3>
          {contract.checks?.length ? <ul className="pc-list">{contract.checks.map((check, index) => <li key={`${check.name}:${index}`}><FileText size={13} aria-hidden="true" className="pc-list-icon" /><div><strong>{check.name || `Check ${index + 1}`}</strong><details className="pc-check-evidence"><summary>Comando declarado completo</summary><pre>{argvText(check.argv)}</pre></details></div></li>)}</ul> : <EmptyState className="pc-quiet" size="compact" description="No declarados." />}
          <p className="pc-quiet">El resultado de cada check lo registra Phantom en las ejecuciones; aquí se muestra el contrato.</p></section>
      </div>
      <section><h3 className="pc-label">Ejecuciones</h3>
        <p className="pc-quiet">Se muestran las ejecuciones devueltas por Phantom; show puede informar solo la última. Actualiza para observar cambios reales.</p>
        {runs.length ? <ul className="pc-runs">{runs.map((run, index) => <li key={run.id || index}><StatusPill status={run.status} /><code>{run.id}</code><span>{run.mode === 'verification' ? 'Verificación' : 'Ejecución'}</span><span className="pc-quiet">{relative(run.startedAt)}</span><span className="pc-num">{duration(run.startedAt, run.endedAt)}</span>{Number.isFinite(run.turns) && <span className="pc-quiet">{run.turns} turnos · {run.tools ?? 0} herramientas</span>}<div className="pc-run-evidence"><p>Motivo de ejecución: {run.reason || 'No informado'}</p><CheckEvidence title="Pruebas iniciales · baseline del worktree" evidence={run.evidence?.baseline} />{run.evidence?.verification?.map(round => <CheckEvidence key={round.round} title={`Pruebas posteriores · ronda ${round.round}`} evidence={round} />) || <CheckEvidence title="Pruebas posteriores" />}</div></li>)}</ul> : <EmptyState className="pc-quiet" size="compact" description="Sin ejecuciones registradas." />}
      </section>
      {related.length > 0 && <section><h3 className="pc-label">Procesos del controlador</h3>{related.map(item => <div key={item.id} className="pc-controller"><div className="pc-controller-head"><StatusPill status={item.status === 'running' ? 'running' : item.status === 'failed' ? 'blocked' : item.status} /><span>{item.action}</span><span className="pc-quiet">{relative(item.createdAt)}</span></div>{item.output && <pre className="pc-output">{item.output.slice(-4000)}</pre>}</div>)}<p className="pc-quiet">El fin del controlador no completa la Card; el estado lo decide Phantom.</p></section>}
      <section><h3 className="pc-label">Eventos recientes</h3>
        {events.data?.truncated && <p className="pc-quiet">Se muestran los últimos 100 eventos; historial completo en la fuente nativa.</p>}
        {events.error ? <ErrorNotice error={events.error} retry={events.reload} /> : eventItems.length ? <ol className="pc-events">{eventItems.map((event, index) => <li key={event.seq ?? event.id ?? index}><span className="pc-num">{event.at ? new Date(event.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '··:··'}</span><div><strong>{eventLabel(event.type)}</strong> <code>{event.type}</code>{typeof event.data?.reason === 'string' && <p>{event.data.reason}</p>}<details className="pc-check-evidence"><summary>Detalles del evento</summary><p>{event.at} · Tarea: {event.task_id} · Ejecución: {event.run_id || 'No informada'}</p><pre>{eventDetails(event)}</pre></details></div></li>)}</ol> : events.loading ? <p className="pc-quiet" role="status">Leyendo eventos…</p> : events.data?.available === false ? <p className="pc-notice">{events.data.reason}</p> : <EmptyState className="pc-quiet" size="compact" description="Sin eventos observados." />}
      </section>
      <div className="pc-sheet-actions">
        <Button disabled={op.busy} aria-expanded={Boolean(editing)} onClick={() => setEditing(old => old ? null : { ...native, id })}>{editing ? 'Ocultar reemplazo' : 'Preparar reemplazo'}</Button>
        {onOpenPanel && <Button icon={ExternalLink} onClick={() => onOpenPanel('phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId: id, ref: refOf(native) }, goalOf(native))}>Abrir referencia en otro panel</Button>}
      </div>
      <div className="pc-source"><DataView value={value} label="Ver fuente nativa" />{events.data && <DataView value={events.data} label="Ver historial de eventos" />}</div>
      </div></details>
    </>}
    {editing && <CardForm existing={editing} workspace={workspace} api={api} notify={notify} onSaved={reload} onClose={() => setEditing(null)} />}
  </article>;
}

function useVisible(ref) {
  const [visible, setVisible] = useState(true), [foreground, setForeground] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    observer.observe(ref.current); return () => observer.disconnect();
  }, [ref]);
  useEffect(() => {
    const change = () => setForeground(!document.hidden);
    document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return visible && foreground;
}

// Serialized catalog reader: keeps the last valid read on failure and marks it stale.
function useCatalog(api, workspaceId, reading) {
  const [state, setState] = useState({ data: null, error: null, loading: true, observedAt: null });
  const [fresh, setFresh] = useState(() => new Set());
  const flight = useRef(false), previous = useRef(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const read = useCallback(async () => {
    if (flight.current || !workspaceId) return;
    flight.current = true; setState(old => ({ ...old, loading: true }));
    try {
      const data = await api('phantom.list', { workspaceId, pluginId: 'phantom', topic: 'tasks' });
      if (!alive.current) return;
      if (data?.available !== false && Array.isArray(data?.items)) {
        const changed = changedStatuses(previous.current, data.items);
        previous.current = statusMap(data.items);
        if (changed.length) setFresh(old => new Set([...old, ...changed]));
      }
      setState({ data, error: null, loading: false, observedAt: Date.now() });
    } catch (error) { if (alive.current) setState(old => ({ ...old, error, loading: false })); }
    finally { flight.current = false; }
  }, [api, workspaceId]);
  useEffect(() => { previous.current = null; setFresh(new Set()); setState({ data: null, error: null, loading: true, observedAt: null }); read(); }, [workspaceId, read]);
  useEffect(() => { if (!reading) return undefined; const timer = setInterval(read, POLL_MS); return () => clearInterval(timer); }, [reading, read]);
  const seen = useCallback(id => setFresh(old => { if (!old.has(id)) return old; const next = new Set(old); next.delete(id); return next; }), []);
  return { ...state, reload: read, fresh, seen };
}

function DeskCard({ card, selected, fresh, onSelect, now, runModel, onRun, busy, where }) {
  const metaId = useId();
  const decide = card.zone === 'decide', live = card.zone === 'live';
  const line = live ? lastLine(card.controller?.output) : '';
  const className = `plugin-card pc-card pc-zone-${card.zone}${selected ? ' is-selected' : ''}${fresh ? ' is-fresh' : ''}`;
  const main = <>
    {live && <span className="pc-pulse" aria-hidden="true" />}
    <span className="pc-card-main">
      <span className="pc-card-goal">{card.title}</span>
      <span className="pc-card-meta" id={metaId}><StatusPill status={card.status} />{fresh && <span className="pc-new">Cambió de estado</span>}{card.updatedAt && <span>{relative(card.updatedAt, now)}</span>}{where && <span className="pc-where" title={where.branch || 'Carpeta del proyecto'}><GitBranch size={10} aria-hidden="true" />{where.label}</span>}</span>
      {card.resolutionText ? <span className="pc-card-reason">{card.resolutionText}</span> : card.explain && <span className="pc-card-reason">{card.explain.label}</span>}
      {live && <span className="pc-card-line">{line || (card.controller ? 'Sin salida recibida todavía.' : 'Ejecución registrada por Phantom fuera de este host.')}</span>}
    </span>
    {live && card.controller?.createdAt && <span className="pc-num pc-elapsed"><Clock size={12} aria-hidden="true" />{duration(card.controller.createdAt, null, now)}</span>}
  </>;
  if (!decide) return <button type="button" className={className} aria-pressed={selected} aria-label={card.title} aria-describedby={metaId} onClick={() => onSelect(card.id)}>{main}</button>;
  // Decision cards carry the one action Phantom admits that is safe from here;
  // cancelling and verifying stay inside the contract, next to their context.
  const canRun = Boolean(runModel) && cardActions(card.item.raw || card.item, card.controller ? [card.controller] : []).run;
  return <article className={className}>
    <button type="button" className="pc-card-hit" aria-pressed={selected} aria-label={card.title} aria-describedby={metaId} onClick={() => onSelect(card.id)}>{main}</button>
    <div className="pc-card-actions">
      {canRun && <Button tone="primary" icon={Play} disabled={busy} onClick={() => onRun(card)}>{card.status === 'failed' ? 'Reintentar' : 'Ejecutar'} con {runModel}</Button>}
      <Button tone={canRun ? undefined : 'primary'} onClick={() => onSelect(card.id)}>Ver detalle</Button>
    </div>
  </article>;
}

export function PhantomCards({ workspace, api, refresh, notify, onOpenPanel, node, plugin, active = true }) {
  const root = useRef(null);
  const [selected, setSelected] = useState(node?.data?.cardId || '');
  const [query, setQuery] = useState(''), [place, setPlace] = useState(''), [view, setView] = useState('desk'), [creating, setCreating] = useState(false), [paused, setPaused] = useState(false);
  const [wide, setWide] = useState(true), [now, setNow] = useState(Date.now());
  useEffect(() => { setSelected(node?.data?.cardId || ''); }, [workspace?.id, node?.data?.cardId]);
  const visible = useVisible(root);
  const reading = Boolean(workspace?.id) && active !== false && visible && !paused;
  const source = useCatalog(api, workspace?.id, reading);
  useEffect(() => { if (!reading) return undefined; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [reading]);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 860));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const items = itemsOf(source.data);
  const controllers = Array.isArray(source.data?.controllers) ? source.data.controllers : [];
  // Cards belong to the checkout they were created in: the project folder or a terminal's worktree.
  const places = useMemo(() => cardLocations(items, workspace?.nodes), [items, workspace?.nodes]);
  const scattered = places.length > 1 || places.some(item => !item.main);
  const placeOf = card => scattered ? places.find(item => item.key === card.location) : null;
  useEffect(() => { if (place && !places.some(item => item.key === place)) setPlace(''); }, [place, places]);
  const desk = useMemo(() => buildDesk(items, controllers, query, place), [items, controllers, query, place]);
  const lookup = useMemo(() => new Map(buildDesk(items, controllers).cards.map(card => [card.id, card])), [items, controllers]);
  const select = id => { setSelected(id); source.seen(id); setCreating(false); };
  const runOp = useOperation(notify);
  const runModel = plugin?.config?.model?.trim() || '';
  const runCard = card => runOp.run(async () => {
    await api('phantom.control', { workspaceId: workspace.id, pluginId: 'phantom', id: card.id, action: 'run' });
    source.seen(card.id); await source.reload(); await refresh?.();
  }, 'Ejecución solicitada a Phantom');
  const [historyLimit, setHistoryLimit] = useState(20);
  const [closing, setClosing] = useState({ confirm: false });
  // Cancels one by one; a failure is reported and the rest still run.
  const closeAll = async list => {
    const errors = [];
    setClosing({ confirm: false, running: true, done: 0, total: list.length, errors });
    for (const [index, card] of list.entries()) {
      try { await api('phantom.control', { workspaceId: workspace.id, pluginId: 'phantom', id: card.id, action: 'cancel' }); }
      catch (error) { errors.push({ id: card.id, title: card.title, message: error?.message || String(error) }); }
      setClosing({ confirm: false, running: true, done: index + 1, total: list.length, errors: [...errors] });
    }
    setClosing({ confirm: false, running: false, done: list.length, total: list.length, errors });
    await source.reload(); await refresh?.();
  };
  if (!workspace?.id) return <EmptyState className="plugin-empty tw-empty" description="Selecciona un proyecto." />;
  const unavailable = source.data?.available === false;
  const stale = source.error || unavailable || !reading;
  const showDesk = wide || (!selected && !creating);
  const states = Object.keys(STATUS).filter(key => desk.counts[key]).concat(desk.cards.some(card => !STATUS[card.status]) ? ['unknown'] : []);
  return <div ref={root} className={`plugin-cards pc-root${wide ? ' is-wide' : ''}${selected || creating ? ' has-side' : ''}`}>
    <header className="pc-head">
      <div className="pc-title"><Layers size={16} aria-hidden="true" /><div><h2>Cards</h2>
        <p className={stale ? 'is-stale' : ''}>{source.loading && !source.data ? 'Leyendo Phantom…' : paused ? 'Lectura en pausa' : source.error ? `Sin conexión · última lectura ${relative(source.observedAt, now) || 'ninguna'}` : !visible ? 'En pausa mientras el panel no se ve' : `Leído ${relative(source.observedAt, now)} · cada ${POLL_MS / 1000} s`}</p></div></div>
      <label className="pc-search"><Search size={13} aria-hidden="true" /><input type="search" aria-label="Buscar por objetivo o ID" placeholder="Buscar objetivo, ID o ruta" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} /></label>
      {scattered && <label className="pc-select pc-place"><GitBranch size={13} aria-hidden="true" /><select aria-label="Filtrar por rama o worktree" value={place} onChange={e => setPlace(e.target.value)}><option value="">Todas las ramas · {items.length}</option>{places.map(item => <option key={item.key} value={item.key}>{item.label} · {item.count}</option>)}</select></label>}
      <div className="pc-views" role="group" aria-label="Vista">
        <button type="button" aria-pressed={view === 'desk'} onClick={() => setView('desk')}><LayoutDashboard size={13} aria-hidden="true" />Mesa</button>
        <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}><Columns3 size={13} aria-hidden="true" />Tablero</button>
      </div>
      <button type="button" className="pc-icon" aria-label={paused ? 'Reanudar lectura' : 'Pausar lectura'} title={paused ? 'Reanudar lectura' : 'Pausar lectura'} onClick={() => setPaused(value => !value)}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>
      <button type="button" className="pc-icon" aria-label="Actualizar listado" title="Actualizar" disabled={source.loading} onClick={source.reload}><RefreshCw size={14} className={source.loading ? 'spinning' : ''} /></button>
      <Button tone="primary" icon={Plus} aria-expanded={creating} onClick={() => { setCreating(old => !old); setSelected(''); }}>Nueva Card</Button>
    </header>
    {plugin?.enabled === false && <p className="pc-notice">Activa Phantom en el Centro de Plugins para crear o controlar Cards.</p>}
    <div className="pc-body">
      {showDesk && <div className="pc-desk" aria-label="Mesa de Cards">
        {source.error && <ErrorNotice error={`No se pudo leer Phantom: ${source.error.message}. Se conserva la última lectura válida.`} retry={source.reload} />}
        <ErrorNotice error={runOp.error} clear={runOp.clear} />
        {unavailable && <p className="pc-notice">Phantom no está disponible: {unavailableReason(source.data.reason)}.</p>}
        {source.loading && !source.data && <div className="pc-skeleton is-desk" role="status" aria-label="Leyendo Cards"><i /><i /><i /></div>}
        {source.data && !source.loading && !source.error && !unavailable && !items.length && <EmptyState className="pc-empty" icon={Layers} title="No hay tareas ni Cards nativas para este proyecto." description="Una Card es un contrato con objetivo, rutas y checks. Crea la primera para que Phantom la ejecute y la verifique." actions={<Button tone="primary" icon={Plus} onClick={() => setCreating(true)}>Crear la primera Card</Button>} />}
        {items.length > 0 && !desk.total && <EmptyState className="pc-empty" icon={Search} title={query ? `Sin resultados para «${query}»` : 'Sin Cards en esta rama'} actions={<Button onClick={() => { setQuery(''); setPlace(''); }}>Limpiar filtros</Button>} />}
        {desk.total > 0 && view === 'desk' && ZONES.map(zone => {
          const list = desk.zones[zone.id];
          const render = card => <DeskCard key={card.id} card={card} now={now} selected={card.id === selected} fresh={source.fresh.has(card.id)} onSelect={select} runModel={runModel} onRun={runCard} busy={runOp.busy} where={placeOf(card)} />;
          const title = <><i aria-hidden="true" />{zone.title}<span>{list.length}</span></>;
          if (zone.id === 'resolved' || zone.id === 'history') {
            if (!list.length) return null;
            const shown = zone.id === 'history' ? list.slice(0, historyLimit) : list;
            return <section key={zone.id} className={`pc-zone pc-zone-${zone.id}`} aria-label={zone.title}><details className="pc-fold">
              <summary className="pc-zone-title">{title}</summary>
              {zone.id === 'resolved' && <div className="pc-close-all">
                <p className="pc-quiet">Phantom las tiene bloqueadas, pero otra tarea las sustituyó o sus archivos ya cambiaron en main.</p>
                {closing.confirm ? <div className="pc-card-actions" role="group" aria-label="Confirmar cierre">
                  <span>¿Cancelar {list.length} {list.length === 1 ? 'Card' : 'Cards'} en Phantom? No se puede deshacer.</span>
                  <Button tone="primary" onClick={() => closeAll(list)}>Sí, cerrar {list.length}</Button><Button onClick={() => setClosing({ confirm: false })}>Volver</Button>
                </div> : <Button disabled={closing.running} onClick={() => setClosing({ confirm: true })}>Cerrar todas</Button>}
                {Boolean(closing.running || closing.total) &&<p role="status" className="pc-status">{closing.running ? `Cerrando ${closing.done}/${closing.total}…` : `Cerradas ${closing.total - closing.errors.length} de ${closing.total}.`}</p>}
                {closing.errors?.length > 0 && <ul className="pc-close-errors" role="alert">{closing.errors.map(error => <li key={error.id}>{error.title}: {error.message}</li>)}</ul>}
              </div>}
              <div className="pc-zone-items">{shown.map(render)}</div>
              {zone.id === 'history' && list.length > shown.length && <Button onClick={() => setHistoryLimit(limit => limit + 20)}>Ver más · quedan {list.length - shown.length}</Button>}
            </details></section>;
          }
          return <section key={zone.id} className={`pc-zone pc-zone-${zone.id}`} aria-label={zone.title}>
            <h3 className="pc-zone-title">{title}</h3>
            {!list.length ? <EmptyState className="pc-zone-empty" size="compact" description={zone.empty} />
              : zone.id === 'decide' ? groupByCause(list).map(group => <div key={group.cause} className="pc-cause"><h4 className="pc-cause-title">{group.label} · {group.cards.length}</h4><div className="pc-zone-items">{group.cards.map(render)}</div></div>)
              : <div className="pc-zone-items">{list.map(render)}</div>}
          </section>;
        })}
        {desk.total > 0 && view === 'board' && <div className="plugin-board pc-board">{states.map(state => <section key={state} className="plugin-board-column pc-column" aria-label={statusLabel(state)}>
          <h3 className="pc-zone-title"><StatusPill status={state} /><span>{desk.cards.filter(card => card.status === state).length}</span></h3>
          {desk.cards.filter(card => card.status === state).map(card => <DeskCard key={card.id} card={{ ...card, zone: 'queue' }} now={now} selected={card.id === selected} fresh={source.fresh.has(card.id)} onSelect={select} where={placeOf(card)} />)}
        </section>)}</div>}
      </div>}
      {creating ? <div className="pc-side"><CardForm workspace={workspace} api={api} notify={notify} onSaved={() => { source.reload(); refresh?.(); }} onClose={() => setCreating(false)} /></div>
        : selected ? <div className="pc-side"><CardDetail key={`${workspace.id}:${selected}`} id={selected} catalog={{ ...(lookup.get(selected) || {}), lookup }} workspace={workspace} api={api} refresh={refresh} notify={notify} plugin={plugin} onOpenPanel={onOpenPanel} onChanged={source.reload} onClose={() => setSelected('')} /></div>
        : null}
    </div>
  </div>;
}
import EmptyState from './EmptyState.jsx';
