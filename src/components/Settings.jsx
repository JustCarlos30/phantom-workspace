import React, { useEffect, useId, useRef, useState } from 'react';
import { Bot, Check, ChevronLeft, ChevronRight, Folder, GitBranch, Mic, Plug, Smartphone, Sun, Wrench, X } from 'lucide-react';
import '../settings.css';
import { Appearance } from './Appearance';
import MobileSettings from './MobileSettings.jsx';
import AndroidGatewaySettings from './AndroidGatewaySettings.jsx';
import { preferredCardMode } from './ChatCard';
import { suggestCorrections, parseCorrectionLines, addCorrectionLine } from '../hooks/voice-send.mjs';
import { CopyButton, Group, Row, Segmented, Switch, TextRow, useOperation, useResource } from './PluginPrimitives';

// Configuración: one screen, categories on the left, grouped rows on the right.
// Narrow hosts (the side inspector, a small panel) show the categories as a
// first-level list and drill into one, like a phone's settings.
const CATEGORIES = [
  ['agents', 'Agentes', Bot],
  ['git', 'Git e integración', GitBranch],
  ['appearance', 'Apariencia', Sun],
  ['voice', 'Voz', Mic],
  ['phone', 'Teléfono', Smartphone],
  ['connections', 'Conexiones', Plug],
  ['data', 'Datos y respaldo', Folder],
  ['advanced', 'Avanzado', Wrench],
];
const text = error => typeof error === 'string' ? error : error?.message || 'No se pudo completar la operación.';
const listOf = data => Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
const running = status => ['running', 'starting', 'queued', 'stopping'].includes(status);

// Text fields are edited as a draft and saved together by their group.
function useDraft(saved) {
  const key = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  useEffect(() => { setDraft(JSON.parse(key)); }, [key]);
  const dirty = Object.keys(saved).filter(name => (draft[name] ?? '') !== (saved[name] ?? ''));
  return { draft, dirty, set: name => value => setDraft(old => ({ ...old, [name]: value })), reset: () => setDraft(JSON.parse(key)) };
}
function Problem({ error }) { return error ? <p className="st-error" role="alert">{text(error)}</p> : null; }
function SaveBar({ form, busy }) {
  if (!form.dirty.length) return null;
  return <div className="st-save"><button type="button" className="st-btn" disabled={busy} onClick={form.reset}>Descartar</button><button type="submit" className="st-btn is-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>;
}
function Details({ children }) { return <details className="st-details"><summary>Detalles</summary>{children}</details>; }
function Status({ tone, children }) { return <span className="st-status" data-tone={tone}>{tone === 'ok' && <Check size={14} aria-hidden="true" />}{children}</span>; }

function NewSession({ settings, saveSettings, notify }) {
  const [agent, setAgent] = useState(() => preferredCardMode() ?? 'terminal');
  const form = useDraft({ shell: settings.shell || '' });
  const op = useOperation(notify);
  const pick = id => { try { localStorage.setItem('phantom.cardMode', id); setAgent(id); } catch { notify?.('No se pudo guardar la preferencia en este equipo.', 'error'); } };
  return <form onSubmit={event => { event.preventDefault(); op.run(() => saveSettings({ shell: form.draft.shell.trim() }), 'Guardado'); }}>
    <Group title="Al abrir una sesión nueva">
      <Row label="Agente"><Segmented label="Agente por defecto" value={agent} onChange={pick} options={[['claude', 'Claude'], ['codex', 'Codex'], ['opencode', 'OpenCode'], ['terminal', 'Terminal']]} /></Row>
      <TextRow label="Shell" value={form.draft.shell} onChange={form.set('shell')} placeholder="Automático" mono />
    </Group>
    <Problem error={op.error} /><SaveBar form={form} busy={op.busy} />
  </form>;
}

function PhantomGroup({ workspace, api, refresh, notify, settings, saveSettings }) {
  const id = workspace?.id, listId = useId();
  const registry = useResource(api, 'plugins.list', { workspaceId: id }, { enabled: Boolean(id) });
  const status = useResource(api, 'plugins.status', { workspaceId: id, id: 'phantom' }, { enabled: Boolean(id) });
  const models = useResource(api, 'plugins.models', { workspaceId: id, id: 'phantom' }, { enabled: false });
  const asked = useRef(false);
  const plugin = listOf(registry.data).find(item => item.id === 'phantom');
  const config = plugin?.config || {};
  // One field per value: the project's own value when it has one, the general one otherwise.
  const form = useDraft(Object.fromEntries(['model', 'phantomPath', 'phantomData'].map(key => [key, config[key] || settings[key] || ''])));
  const op = useOperation(notify);
  const toggle = enabled => op.run(async () => { await api('plugins.update', { workspaceId: id, id: 'phantom', patch: { enabled } }); await refresh?.(); await registry.reload(); status.reload(); });
  const save = () => op.run(async () => {
    const project = {}, general = {};
    for (const key of form.dirty) (config[key] ? project : general)[key] = form.draft[key].trim();
    if (Object.keys(project).length) await api('plugins.update', { workspaceId: id, id: 'phantom', patch: { config: { ...config, ...project } } });
    if (Object.keys(general).length) await saveSettings(general);
    if (id) { await registry.reload(); status.reload(); }
  }, 'Guardado');
  const connected = status.data?.available === true, missing = plugin?.enabled && !status.loading && !connected;
  return <form onSubmit={event => { event.preventDefault(); save(); }}>
    <Group title="Phantom">
      {id && <Row label="Tareas y memoria de Phantom" hint={missing ? 'Phantom no está instalado o no se encuentra.' : 'Tareas, decisiones y skills del proyecto'}>
        {plugin?.enabled && <Status tone={connected ? 'ok' : status.loading ? undefined : 'warn'}>{status.loading ? 'Comprobando…' : connected ? 'Conectado' : 'No conectado'}</Status>}
        <Switch label={`Tareas y memoria de Phantom en ${workspace.name}`} checked={plugin?.enabled} disabled={!plugin || op.busy} onChange={toggle} />
      </Row>}
      <TextRow label="Modelo para ejecutar tareas" value={form.draft.model} onChange={form.set('model')} placeholder="proveedor/modelo" list={listId} mono onFocus={() => { if (id && !asked.current) { asked.current = true; models.reload(); } }} />
      <datalist id={listId}>{models.data?.available && models.data.models.map(model => <option key={model} value={model} />)}</datalist>
      <Details>
        <TextRow label="Ejecutable" value={form.draft.phantomPath} onChange={form.set('phantomPath')} placeholder={status.data?.cli || 'Detectada automáticamente'} mono />
        <TextRow label="Carpeta de datos" value={form.draft.phantomData} onChange={form.set('phantomData')} placeholder="Detectada automáticamente" mono />
        {status.data?.version && <Row label="Versión"><span className="st-value">{status.data.version}</span></Row>}
        {missing && status.data?.reason && <pre className="st-code">{status.data.reason}</pre>}
      </Details>
    </Group>
    <Problem error={op.error || registry.error} /><SaveBar form={form} busy={op.busy} />
  </form>;
}

function Accounts({ api }) {
  const limits = useResource(api, 'limits.read', {});
  const providers = Array.isArray(limits.data?.providers) ? limits.data.providers : [];
  if (!providers.length) return null;
  return <Group title="Tus cuentas">{providers.map(provider => {
    const peak = (provider.windows || []).filter(item => Number.isFinite(item.percent)).sort((a, b) => b.percent - a.percent)[0];
    const signedOut = !provider.available && /No hay una sesión/.test(provider.reason || '');
    const hint = provider.available ? [provider.plan && `Plan ${provider.plan}`, peak && `${Math.round(peak.percent)} % usado · ${peak.label}`].filter(Boolean).join(' · ') : signedOut ? 'Sin sesión en este equipo' : undefined;
    return <Row key={provider.id} label={provider.label} hint={hint || undefined}><Status tone={provider.available ? 'ok' : undefined}>{provider.available ? 'Sesión iniciada' : signedOut ? 'Sin sesión' : 'Sin datos'}</Status></Row>;
  })}</Group>;
}

function GitSettings({ workspace, api, notify }) {
  const merge = useResource(api, 'merge.status', { workspaceId: workspace.id });
  const checks = merge.data?.checks;
  const form = useDraft({ checks: checks?.configured ? checks.command || '' : '' });
  const op = useOperation(notify);
  const configure = (patch, done) => op.run(async () => { await api('merge.configure', { workspaceId: workspace.id, ...patch }); await merge.reload(); }, done);
  return <form onSubmit={event => { event.preventDefault(); configure({ checks: form.draft.checks.trim() || null }, 'Guardado'); }}>
    <Group title={workspace.name}>
      <Row label="Integrar sola al terminar" hint="El orquestador prueba cada rama lista y la sube a main"><Switch label="Integrar sola al terminar" checked={merge.data?.enabled} disabled={!merge.data || op.busy} onChange={enabled => configure({ enabled })} /></Row>
      <TextRow label="Pruebas antes de integrar" value={form.draft.checks} onChange={form.set('checks')} placeholder={checks?.command || 'npm test'} disabled={!merge.data} mono />
    </Group>
    <Problem error={op.error || merge.error} /><SaveBar form={form} busy={op.busy} />
  </form>;
}

function VoiceSettings({ settings, saveSettings, notify }) {
  const command = typeof settings.localWhisperCommand === 'string' ? settings.localWhisperCommand : settings.localWhisperCommand ? JSON.stringify(settings.localWhisperCommand) : '';
  const form = useDraft({ voiceModel: settings.voiceModel || '', voiceBaseURL: settings.voiceBaseURL || '', localWhisperCommand: command, voiceVocabulary: settings.voiceVocabulary || '', voiceProfile: settings.voiceProfile || '', voiceCorrections: settings.voiceCorrections || '', voicePauseMs: String(settings.voicePauseMs ?? 500), voiceVadThreshold: String(settings.voiceVadThreshold ?? 0.5) });
  const op = useOperation(notify), commandId = useId();
  const [learn, setLearn] = useState({ dictated: '', edited: '' });
  const suggestions = suggestCorrections(learn.dictated, learn.edited, parseCorrectionLines(form.draft.voiceCorrections));
  const provider = ['auto', 'local', 'openai'].includes(settings.voiceProvider) ? settings.voiceProvider : 'auto';
  const save = () => op.run(async () => {
    const patch = Object.fromEntries(form.dirty.map(key => [key, form.draft[key].replace(/\r\n?/g, '\n').trim()]));
    if (patch.voiceProfile !== undefined && (patch.voiceProfile.length > 400 || /\p{Cc}/u.test(patch.voiceProfile))) throw new Error('Perfil inválido: máximo 400 caracteres sin controles');
    if (patch.voiceCorrections !== undefined) {
      if (patch.voiceCorrections.length > 4000 || /[^\P{Cc}\n]/u.test(patch.voiceCorrections)) throw new Error('Correcciones inválidas: máximo 4000 caracteres');
      const lines = parseCorrectionLines(patch.voiceCorrections);
      if (lines.length > 100) throw new Error('Máximo 100 correcciones');
      const bad = lines.findIndex(line => !line.heard || !line.meant || line.heard.length > 80 || line.meant.length > 200);
      if (bad >= 0) throw new Error(`Corrección ${bad + 1} inválida: usa «oído => intención»`);
    }
    if (patch.voiceVocabulary !== undefined && (patch.voiceVocabulary.length > 500 || /\p{Cc}/u.test(patch.voiceVocabulary))) throw new Error('Vocabulario inválido: máximo 500 caracteres sin controles');
    if (patch.voicePauseMs !== undefined) {
      patch.voicePauseMs = Number(patch.voicePauseMs);
      if (!Number.isInteger(patch.voicePauseMs) || patch.voicePauseMs < 300 || patch.voicePauseMs > 2000) throw new Error('La pausa debe estar entre 300 y 2000 ms');
    }
    if (patch.voiceVadThreshold !== undefined) {
      patch.voiceVadThreshold = Number(patch.voiceVadThreshold);
      if (!Number.isFinite(patch.voiceVadThreshold) || patch.voiceVadThreshold < 0.2 || patch.voiceVadThreshold > 0.8) throw new Error('La sensibilidad VAD debe estar entre 0.2 y 0.8');
    }
    if (patch.localWhisperCommand) {
      let argv; try { argv = JSON.parse(patch.localWhisperCommand); } catch { argv = null; }
      if (!Array.isArray(argv) || !argv.length || argv.some(arg => typeof arg !== 'string' || !arg) || !argv.slice(1).some(arg => arg.includes('{input}'))) throw new Error('El comando debe ser una lista JSON de argumentos que incluya {input}.');
    }
    await saveSettings(patch);
  }, 'Guardado');
  return <form onSubmit={event => { event.preventDefault(); save(); }}>
    <Group title="Dictado">
      <Row label="Idioma del dictado" htmlFor={`${commandId}-language`}><select id={`${commandId}-language`} className="st-select" value={settings.voiceLanguage ?? 'es'} disabled={op.busy} onChange={event => op.run(() => saveSettings({ voiceLanguage: event.target.value }))}><option value="es">Español</option><option value="en">Inglés</option><option value="auto">Automático</option></select></Row>
      <Row label="Vocabulario" htmlFor={`${commandId}-vocabulary`} hint={<span id={`${commandId}-vocabulary-hint`}>Nombres de proyectos y términos (máximo 500 caracteres)</span>}>
        <input id={`${commandId}-vocabulary`} aria-describedby={`${commandId}-vocabulary-hint`} className="st-input" type="text" spellCheck={false} value={form.draft.voiceVocabulary} onChange={event => form.set('voiceVocabulary')(event.target.value)} placeholder="Nombres y términos" />
      </Row>
      <Row label="Muletillas" htmlFor={`${commandId}-fillers`} hint="Corregir con Claude arregla por contexto las palabras mal oídas (divulgar → divagar) mientras dictas; envía el texto a Anthropic y necesita ANTHROPIC_API_KEY. Sin llave solo quita titubeos."><select id={`${commandId}-fillers`} className="st-select" value={settings.voiceFillers ?? 'clean'} disabled={op.busy} onChange={event => op.run(() => saveSettings({ voiceFillers: event.target.value }))}><option value="keep">Conservar</option><option value="remove">Quitar</option><option value="clean">Corregir con Claude</option></select></Row>
      <Row label="Perfil de habla" htmlFor={`${commandId}-profile`} hint={<span id={`${commandId}-profile-hint`}>Frase de ejemplo con tu forma de hablar; Whisper imita su estilo. Vacío usa el perfil mexicano integrado (máximo 400 caracteres).</span>} stack>
        <textarea id={`${commandId}-profile`} aria-describedby={`${commandId}-profile-hint`} className="st-input" rows={3} spellCheck={false} value={form.draft.voiceProfile} onChange={event => form.set('voiceProfile')(event.target.value)} placeholder="Pues, o sea, wey, neta, está chido… makeup, deploy, commit." />
      </Row>
      <Row label="Correcciones personales" htmlFor={`${commandId}-corrections`} hint={<span id={`${commandId}-corrections-hint`}>Una por línea: «lo que oye => lo que quise decir». Ejemplo: meikap => makeup</span>} stack>
        <textarea id={`${commandId}-corrections`} aria-describedby={`${commandId}-corrections-hint`} className="st-input is-mono" rows={5} spellCheck={false} value={form.draft.voiceCorrections} onChange={event => form.set('voiceCorrections')(event.target.value)} placeholder={'meikap => makeup\nguey => wey'} />
      </Row>
      <Details>
        <Row label="Aprender de una corrección" hint="Pega lo que dictaste y cómo lo dejaste; se proponen correcciones de palabras mal oídas." stack>
          <textarea aria-label="Texto dictado" className="st-input" rows={2} value={learn.dictated} onChange={event => setLearn(previous => ({ ...previous, dictated: event.target.value }))} placeholder="Texto tal como se dictó" />
          <textarea aria-label="Texto corregido" className="st-input" rows={2} value={learn.edited} onChange={event => setLearn(previous => ({ ...previous, edited: event.target.value }))} placeholder="Texto como lo corregiste" />
          {suggestions.map(item => <div key={item.heard}><code>{item.heard} =&gt; {item.meant}</code> <button type="button" className="st-btn" onClick={() => form.set('voiceCorrections')(addCorrectionLine(form.draft.voiceCorrections, item))}>Agregar</button></div>)}
        </Row>
      </Details>
      <Row label="Interpretar comandos con" htmlFor={`${commandId}-intent`}><select id={`${commandId}-intent`} className="st-select" value={settings.voiceIntentProvider ?? 'rules'} disabled={op.busy} onChange={event => op.run(() => saveSettings({ voiceIntentProvider: event.target.value }))}><option value="rules">Reglas locales</option><option value="claude">Claude</option></select></Row>
      <Row label="Proveedor" htmlFor={`${commandId}-provider`}><select id={`${commandId}-provider`} className="st-select" value={provider} disabled={op.busy} onChange={event => op.run(() => saveSettings({ voiceProvider: event.target.value }))}><option value="auto">Automático</option><option value="local">En este equipo</option><option value="openai">API compatible con OpenAI</option></select></Row>
      <TextRow label="Modelo" value={form.draft.voiceModel} onChange={form.set('voiceModel')} placeholder="Automático" mono />
      {provider !== 'local' && <TextRow label="URL de la API" type="url" value={form.draft.voiceBaseURL} onChange={form.set('voiceBaseURL')} placeholder="https://api.openai.com/v1" mono />}
      <Details>
        <Row label="Pausa para cerrar frase (ms)" htmlFor={`${commandId}-pause`}><input id={`${commandId}-pause`} className="st-input" type="number" min="300" max="2000" step="1" value={form.draft.voicePauseMs} onChange={event => form.set('voicePauseMs')(event.target.value)} /></Row>
        <Row label="Sensibilidad de voz (VAD)" htmlFor={`${commandId}-vad`}><input id={`${commandId}-vad`} className="st-input" type="number" min="0.2" max="0.8" step="0.01" value={form.draft.voiceVadThreshold} onChange={event => form.set('voiceVadThreshold')(event.target.value)} /></Row>
        <Row label="Comando local" hint="Lista JSON de argumentos; usa {input} y {outputDir}" htmlFor={commandId} stack><textarea id={commandId} className="st-input is-mono" rows={3} spellCheck={false} placeholder="Automático" value={form.draft.localWhisperCommand} onChange={event => form.set('localWhisperCommand')(event.target.value)} /></Row>
        <Row label="Salida del motor"><Segmented label="Salida del motor" value={settings.localWhisperOutput === 'stdout' ? 'stdout' : 'files'} disabled={op.busy} onChange={localWhisperOutput => op.run(() => saveSettings({ localWhisperOutput }))} options={[['files', 'Archivos'], ['stdout', 'Texto']]} /></Row>
      </Details>
    </Group>
    <Problem error={op.error} /><SaveBar form={form} busy={op.busy} />
    <Group title="Motor de voz en este equipo">
      <Row label="Instalar o actualizar" hint="Ejecútalo en la carpeta de Phantom Workspace. Para el español mexicano con jerga se recomienda large-v3-turbo en GPU."><code className="st-command">npm run setup:voice -- --model large-v3-turbo --device cuda --replace</code><CopyButton value="npm run setup:voice -- --model large-v3-turbo --device cuda --replace" /></Row>
    </Group>
  </form>;
}

function Connections({ workspace, api, refresh, notify, onOpenPanel }) {
  const registry = useResource(api, 'plugins.list', { workspaceId: workspace.id });
  const conventions = useResource(api, 'plugins.status', { workspaceId: workspace.id, id: 'convencions' });
  const items = listOf(registry.data), video = items.find(item => item.id === 'video-log'), rules = items.find(item => item.id === 'convencions');
  const form = useDraft({ sourcePath: video?.config?.sourcePath || '' });
  const op = useOperation(notify);
  const update = (id, patch, done) => op.run(async () => { await api('plugins.update', { workspaceId: workspace.id, id, patch }); await refresh?.(); await registry.reload(); if (id === 'convencions') conventions.reload(); }, done);
  return <>
    <form onSubmit={event => { event.preventDefault(); update('video-log', { config: { sourcePath: form.draft.sourcePath.trim() } }, 'Guardado'); }}>
      <Group title={workspace.name}>
        <Row label="Bitácora de videos" hint="Notas de tus videos desde un archivo Markdown">
          {video?.enabled && onOpenPanel && <button type="button" className="st-btn" onClick={() => onOpenPanel('video-log', { pluginId: 'video-log', panelId: 'insights' }, 'Bitácora de videos')}>Abrir</button>}
          <Switch label="Bitácora de videos" checked={video?.enabled} disabled={!video || op.busy} onChange={enabled => update('video-log', { enabled })} />
        </Row>
        <TextRow label="Archivo Markdown" value={form.draft.sourcePath} onChange={form.set('sourcePath')} placeholder="Ruta del archivo" disabled={!video} mono>
          <button type="button" className="st-btn" disabled={!video || op.busy} onClick={() => op.run(async () => { const file = await api('dialog.openFile', {}); if (typeof file === 'string' && file) form.set('sourcePath')(file); })}>Elegir…</button>
        </TextRow>
        {rules && conventions.data?.state === 'ready' && <Row label="Convenciones" hint="Reglas del proyecto y de su base"><Switch label="Convenciones" checked={rules.enabled} disabled={op.busy} onChange={enabled => update('convencions', { enabled })} /></Row>}
      </Group>
      <Problem error={op.error || registry.error} /><SaveBar form={form} busy={op.busy} />
    </form>
  </>;
}

function DataSettings({ api, refresh, notify }) {
  const info = useResource(api, 'system.info', {});
  const [history, setHistory] = useState(false), [incoming, setIncoming] = useState(null);
  const op = useOperation(notify);
  return <>
    <Group title="Respaldo">
      <Row label="Incluir historial al exportar"><Switch label="Incluir historial al exportar" checked={history} onChange={setHistory} /></Row>
      <Row label="Exportar todo a un archivo"><button type="button" className="st-btn" disabled={op.busy} onClick={() => op.run(async () => { const data = await api('storage.export', { includeHistory: history }); await api('desktop.export', { data }); }, 'Exportación lista')}>Exportar…</button></Row>
      <Row label="Importar desde un archivo" hint={incoming ? `${incoming.name} · listo para importar` : undefined}>
        {incoming ? <><button type="button" className="st-btn" disabled={op.busy} onClick={() => setIncoming(null)}>Descartar</button><button type="button" className="st-btn is-primary" disabled={op.busy} onClick={() => op.run(async () => { await api('storage.import', { data: incoming.data }); await refresh?.(); setIncoming(null); }, 'Datos importados')}>Importar</button></>
          : <label className="st-btn st-file">Elegir…<input type="file" accept="application/json,.json" aria-label="Elegir archivo para importar" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) op.run(async () => { if (file.size > 20 * 1024 * 1024) throw new Error('El archivo supera 20 MB.'); let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('El archivo no es una exportación válida.'); } setIncoming({ name: file.name, data }); }); }} /></label>}
      </Row>
    </Group>
    <Problem error={op.error} />
    <Group title="Almacenamiento">
      <Row label="Carpeta de datos" hint={info.data?.dataDir || (info.loading ? 'Consultando…' : 'Sin datos')}><CopyButton value={info.data?.dataDir} /></Row>
    </Group>
  </>;
}

function Advanced({ workspace, state, api, notify }) {
  const info = useResource(api, 'system.info', {}), desktop = useResource(api, 'desktop.info', {});
  const [confirm, setConfirm] = useState(null);
  const op = useOperation(notify);
  const quit = stopHost => api('desktop.quit', { stopHost });
  const stopAll = async () => {
    // Stopping affects every project, including when no folder is selected.
    const workspaces = state?.workspaces || (workspace ? [workspace] : []);
    const resources = await Promise.all(workspaces.flatMap(item => ['terminal.list', 'playground.list', 'automation.list'].map(method => api(method, { workspaceId: item.id }))));
    const count = resources.flatMap(listOf).filter(item => running(item.status) || item.browserOpen || item.viewer?.status === 'running').length + workspaces.flatMap(item => item.phantomControllers || []).filter(item => running(item.status)).length;
    if (count) setConfirm(count); else await quit(true);
  };
  return <>
    <Group title="Cierre y procesos">
      <Row label="Cerrar solo la ventana" hint="Las sesiones siguen en marcha"><button type="button" className="st-btn" disabled={op.busy} onClick={() => op.run(() => quit(false))}>Cerrar</button></Row>
      <Row label="Detener todo y salir" hint={confirm ? `Se detendrán ${confirm} sesiones o ejecuciones en marcha` : 'Termina las sesiones y los procesos de Phantom'}>
        {confirm ? <><button type="button" className="st-btn" onClick={() => setConfirm(null)}>Cancelar</button><button type="button" className="st-btn is-danger" disabled={op.busy} onClick={() => op.run(async () => { await quit(true); setConfirm(null); })}>Detener y salir</button></>
          : <button type="button" className="st-btn is-danger" disabled={op.busy} onClick={() => op.run(stopAll)}>Detener…</button>}
      </Row>
    </Group>
    <Problem error={op.error} />
    <Group title="Este equipo">
      {desktop.data?.version && <Row label="Versión"><span className="st-value">{desktop.data.version}</span></Row>}
      <Details><pre className="st-code">{JSON.stringify({ host: info.data ?? null, app: desktop.data ?? null }, null, 2)}</pre></Details>
    </Group>
  </>;
}

export default function Settings({ workspace, state, api, refresh, notify, onOpenPanel, onClose, category: wanted, appearance }) {
  const available = CATEGORIES.filter(([id]) => id !== 'appearance' || appearance);
  const known = available.some(([id]) => id === wanted);
  const [category, setCategory] = useState(known ? wanted : 'agents'), [drill, setDrill] = useState(known);
  useEffect(() => { if (known) { setCategory(wanted); setDrill(true); } }, [wanted, known]);
  // Panels on the canvas do not receive the app state: read the preferences once.
  const fetched = useResource(api, 'state.get', {}, { enabled: !state });
  const [saved, setSaved] = useState(null);
  useEffect(() => { setSaved(null); }, [state?.settings]);
  const settings = saved || state?.settings || fetched.data?.settings || {};
  const saveSettings = async patch => { const next = await api('settings.update', { patch }); setSaved(next); await refresh?.(); };
  const heading = useRef(null);
  const open = id => { setCategory(id); setDrill(true); requestAnimationFrame(() => heading.current?.focus()); };
  const shared = { workspace, state, api, refresh, notify, onOpenPanel, settings, saveSettings };
  const needsProject = <Group><Row label="Abre un proyecto" hint="Estos ajustes son de cada proyecto" /></Group>;
  return <div className="st" data-view={drill ? 'pane' : 'list'}>
    {onClose && <button type="button" className="st-close" aria-label="Cerrar configuración" onClick={onClose}><X size={16} /></button>}
    <div className="st-body">
      <nav className="st-nav" aria-label="Categorías de configuración">
        <h2>Configuración</h2>
        <ul>{available.map(([id, name, Icon]) => <li key={id}><button type="button" aria-current={category === id ? 'page' : undefined} onClick={() => open(id)}><span className="st-ico"><Icon size={16} aria-hidden="true" /></span><span>{name}</span><ChevronRight className="st-chev" size={15} aria-hidden="true" /></button></li>)}</ul>
      </nav>
      <section className="st-pane" aria-labelledby="st-pane-title">
        <button type="button" className="st-back" onClick={() => setDrill(false)}><ChevronLeft size={16} aria-hidden="true" />Configuración</button>
        <h2 id="st-pane-title" ref={heading} tabIndex={-1}>{available.find(([id]) => id === category)?.[1]}</h2>
        {category === 'agents' && <><NewSession {...shared} /><PhantomGroup key={workspace?.id || 'none'} {...shared} /><Accounts api={api} /></>}
        {category === 'git' && (workspace ? <GitSettings key={workspace.id} {...shared} /> : needsProject)}
        {category === 'appearance' && appearance && <Appearance key={workspace?.id || 'default'} {...appearance} workspace={workspace} />}
        {category === 'voice' && <VoiceSettings {...shared} />}
        {category === 'phone' && <div className="st-embed"><MobileSettings workspace={workspace} api={api} /><AndroidGatewaySettings workspace={workspace} api={api} /></div>}
        {category === 'connections' && (workspace ? <Connections key={workspace.id} {...shared} /> : needsProject)}
        {category === 'data' && <DataSettings {...shared} />}
        {category === 'advanced' && <Advanced {...shared} />}
      </section>
    </div>
  </div>;
}
