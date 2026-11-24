import React, { useEffect, useRef, useState } from 'react';

const LABELS = { read: 'Lectura', 'chat.send': 'Enviar chat', 'terminal.write': 'Escribir terminal', 'chat.stop': 'Detener chat', 'terminal.stop': 'Detener terminal', 'chat.permission.answer': 'Responder permisos', 'chat.question.answer': 'Responder preguntas' };
function DevicePermissions({ device, status, busy, run, api }) {
  const [grants, setGrants] = useState(device.grants || []), [ack, setAck] = useState(false);
  useEffect(() => { setGrants(device.grants || []); }, [device.permissionVersion]);
  const toggleNode = (id, enabled) => setGrants(old => enabled ? [...old, { nodeId: id, capabilities: ['read'] }] : old.filter(g => g.nodeId !== id));
  const toggleCap = (id, cap, enabled) => setGrants(old => old.map(g => g.nodeId === id ? { ...g, capabilities: enabled ? [...g.capabilities, cap] : g.capabilities.filter(c => c !== cap) } : g));
  return <fieldset disabled={busy}><legend>{device.name} · {device.state === 'approved' ? 'Autorizado' : device.state === 'pending' ? 'Pendiente de aprobación' : 'Esperando prueba de clave'}</legend>
    <label className="tw-field">Huella de clave del dispositivo<input readOnly value={device.fingerprint} /></label>
    <p className="tw-muted">Permisos efectivos: {device.grants?.length ? device.grants.map(g => `${status.nodes.find(n => n.id === g.nodeId)?.title || g.nodeId}: ${g.capabilities.map(c => LABELS[c]).join(', ')}`).join(' · ') : 'Ninguna sesión'}</p>
    {status.nodes.map(node => { const grant = grants.find(g => g.nodeId === node.id); return <div key={node.id} className="tw-section">
      <label><input type="checkbox" checked={!!grant} onChange={e => toggleNode(node.id, e.target.checked)} /> {node.title}{node.main ? ' · Chat principal / orquestador' : ''}</label>
      {grant && <div>{status.capabilities.map(cap => <label key={cap} className="tw-field"><span><input type="checkbox" checked={grant.capabilities.includes(cap)} disabled={cap === 'read'} onChange={e => toggleCap(node.id, cap, e.target.checked)} /> {LABELS[cap]}</span></label>)}</div>}
    </div>; })}
    {grants.some(g => status.nodes.some(n => n.id === g.nodeId && n.main)) && <label className="tw-field"><span><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> Entiendo que el chat principal / orquestador actúa con los permisos reales del agente.</span></label>}
    <div className="tw-row"><button className="tw-button tw-primary" disabled={device.state === 'proving'} onClick={() => run(() => api(device.state === 'pending' ? 'mobile.approve' : 'mobile.permissions', { id: device.id, grants, acknowledgeAgentAuthority: ack }))}>{device.state === 'pending' ? 'Aprobar dispositivo' : 'Guardar permisos'}</button>
      <button className="tw-button tw-danger" onClick={() => run(() => api('mobile.revoke', { id: device.id }))}>Revocar</button></div>
  </fieldset>;
}

export default function MobileSettings({ workspace, api }) {
  const [status, setStatus] = useState(null), [address, setAddress] = useState(''), [port, setPort] = useState('0');
  const [pairing, setPairing] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [time, setTime] = useState(Date.now());
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; let cancelled = false, timer;
    const read = async () => {
      try {
        const result = await api('mobile.status', {});
        if (!cancelled) { setStatus(result); setAddress(previous => previous || result.interfaces[0]?.address || ''); }
      } catch (e) { if (!cancelled) setError(e.message); }
      if (!cancelled) timer = setTimeout(read, 3000);
    };
    read(); const clock = setInterval(() => setTime(Date.now()), 1000);
    return () => { mounted.current = false; cancelled = true; clearTimeout(timer); clearInterval(clock); };
  }, [api]);
  const run = async action => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await action(); const result = await api('mobile.status', {}); if (mounted.current) setStatus(result); }
    catch (e) { if (mounted.current) setError(e.message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const copy = async value => { if (!navigator.clipboard) throw new Error('Copia el texto seleccionándolo.'); await navigator.clipboard.writeText(value); };
  const expiresAt = pairing?.expiresAt === status?.pairingExpiresAt ? pairing?.expiresAt : null;
  return <section className="tw-section">
    <h3>Conexión móvil local</h3>
    <p className="tw-muted">Base segura v2 para la futura app nativa, todavía no disponible. HTTPS obligatorio y certificado fijado tras verificar la huella desde este escritorio por un canal independiente. El acceso se apaga al reiniciar el host.</p>
    <p className="tw-muted">El control de terminal no es un sandbox: comandos y respuestas a permisos actúan con los permisos reales del proceso y del agente. El servidor comprueba firmas; sin attestation remota no acredita hardware ni huella de un cliente modificado.</p>
    {error && <p className="tw-error" role="alert">{error}</p>}
    {!status ? <p role="status">Consultando acceso móvil…</p> : status.enabled ? <>
      <p>Activo para {status.workspaceId === workspace?.id ? workspace.name : 'otro proyecto'}.</p>
      <label className="tw-field">Dirección móvil<input readOnly value={status.url || ''} /></label>
      <label className="tw-field">Identidad del host / SHA256 del certificado<input readOnly value={status.identity?.fingerprint || ''} /></label>
      <label className="tw-field">Certificado público<textarea readOnly value={status.identity?.certificate || ''} /></label>
      <button className="tw-button" disabled={busy} onClick={() => run(() => copy(JSON.stringify({ version: 2, url: status.url, ...status.identity })))}>Copiar bootstrap seguro</button>
      <div className="tw-row"><button className="tw-button" disabled={busy} onClick={() => run(() => copy(status.url))}>Copiar dirección</button><button className="tw-button tw-danger" disabled={busy} onClick={() => run(async () => { await api('mobile.stop', {}); setPairing(null); })}>Desactivar acceso móvil</button></div>
      <p className="tw-muted">Comparte identidad y certificado por un canal fuera de banda. La app oficial deberá verificar y fijar este certificado antes de enviar el código separado: 256 bits, un uso, 120 segundos. Un navegador no puede operar.</p>
      {expiresAt && expiresAt > time ? <><label className="tw-field">Código de emparejamiento<input readOnly value={pairing.code} /></label><p role="status">Caduca en {Math.ceil((expiresAt - time) / 1000)} s</p><button className="tw-button" disabled={busy} onClick={() => run(() => copy(pairing.code))}>Copiar código</button></> : <p>Código usado, caducado o no mostrado en este panel.</p>}
      <button className="tw-button" disabled={busy} onClick={() => run(async () => setPairing(await api('mobile.pairing', {})))}>Generar nuevo código</button>
      <h4>Dispositivos autorizados</h4>
      {!status.devices.length && <p className="tw-muted">Ningún dispositivo emparejado.</p>}
      {status.devices.map(device => <DevicePermissions key={device.id} {...{ device, status, busy, run, api }} />)}
      <h4>Actividad local</h4>
      {status.auditError && <p role="alert">{status.auditError}</p>}
      {!status.activity.length && <p className="tw-muted">Sin eventos.</p>}
      {status.activity.slice().reverse().map((event, index) => <p key={index}><small>{new Date(event.timestamp).toLocaleString()} · {event.deviceId || 'Escritorio'} · {event.nodeId || '—'} · {event.method} · {event.outcome} · {event.reason}</small></p>)}
    </> : <>
      <p className="tw-muted">Desactivado. Autoriza únicamente las sesiones del proyecto actual.</p>
      <label className="tw-field">Interfaz Wi-Fi / LAN<select value={address} onChange={e => setAddress(e.target.value)}><option value="">Elige una interfaz privada</option>{status.interfaces.map(item => <option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}</select></label>
      {!status.interfaces.length && <p>No hay una interfaz LAN IPv4 privada detectada. Conecta el equipo a la Wi-Fi y vuelve a consultar.</p>}
      <label className="tw-field">Puerto (0: automático)<input type="number" min="0" max="65535" value={port} onChange={e => setPort(e.target.value)} /></label>
      <button className="tw-button tw-primary" disabled={busy || !workspace || !address} onClick={() => run(async () => { const result = await api('mobile.start', { workspaceId: workspace.id, address, port: Number(port) }); setPairing(result.pairing); })}>Activar para {workspace?.name || 'el proyecto actual'}</button>
      <p className="tw-muted">Regenerar identidad invalida todos los dispositivos y exige volver a vincular. Un cambio de dirección usa otra identidad.</p>
      <button className="tw-button tw-danger" disabled={busy || !address} onClick={() => run(() => api('mobile.identity', { regenerate: true, address }))}>Regenerar identidad e invalidar dispositivos</button>
    </>}
  </section>;
}
