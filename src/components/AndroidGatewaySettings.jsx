import React, { useEffect, useRef, useState } from 'react';

function DevicePermissions({ device, workspaceId, busy, run, api }) {
  const mainId = `phantom:${workspaceId}`;
  const main = device.grants?.find(grant => grant.nodeId === mainId)?.capabilities || [];
  const [read, setRead] = useState(main.includes('read'));
  const [send, setSend] = useState(main.includes('chat.send'));
  const [stop, setStop] = useState(main.includes('chat.stop'));
  const [workspaceRead, setWorkspaceRead] = useState(false);
  const [ack, setAck] = useState(false);
  const checkbox = (label, checked, change, disabled = false) => <label className="tw-check"><input type="checkbox" checked={checked} disabled={busy || disabled} onChange={e => change(e.target.checked)} /> {label}</label>;
  return <div className="tw-section">
    <h4>{device.name || 'Teléfono Android'} · {device.state === 'pending' ? 'Pendiente' : 'Aprobado'}</h4>
    <label className="tw-field">Huella de clave del dispositivo<input readOnly value={device.keyFingerprint || ''} /></label>
    <form className="tw-form" onSubmit={e => {
      e.preventDefault();
      run(() => api('android.approve', { id: device.id, nodes: read ? [mainId] : [],
        allow: read ? [...(send ? [`${mainId}=chat.send`] : []), ...(stop ? [`${mainId}=chat.stop`] : [])] : [],
        workspaceRead, workspaceAllow: [], acknowledgeAgentAuthority: ack }));
    }}>
      {checkbox('Leer chat principal', read, value => { setRead(value); if (!value) { setSend(false); setStop(false); } })}
      {checkbox('Enviar mensajes', send, setSend, !read)}
      {checkbox('Parar turnos', stop, setStop, !read)}
      {checkbox('Leer herramientas del proyecto', workspaceRead, setWorkspaceRead)}
      {checkbox('Entiendo que el teléfono actuará con la autoridad del agente', ack, setAck)}
      <p className="tw-muted">Leer el chat principal, enviar mensajes o parar turnos exige reconocer la autoridad del agente. Actualizar permisos reemplaza todos los anteriores por las casillas seleccionadas; los permisos de herramientas del proyecto comienzan desmarcados.</p>
      <div className="tw-row"><button className="tw-button tw-primary" disabled={busy || (read && !ack)} type="submit">{device.state === 'pending' ? 'Aprobar' : 'Actualizar permisos'}</button>
        <button className="tw-button tw-danger" type="button" disabled={busy} onClick={() => run(() => api('android.revoke', { id: device.id }))}>Revocar</button></div>
    </form>
  </div>;
}

export default function AndroidGatewaySettings({ workspace, api }) {
  const [status, setStatus] = useState(null), [repoPath, setRepoPath] = useState('');
  const [address, setAddress] = useState(''), [port, setPort] = useState('0');
  const [bootstrap, setBootstrap] = useState(''), [pairing, setPairing] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [time, setTime] = useState(Date.now());
  const lock = useRef(false), mounted = useRef(true), repoEdited = useRef(false), generation = useRef(0);
  const acceptStatus = result => {
    setStatus(result);
    setAddress(previous => result.interfaces.some(item => item.address === previous) ? previous : result.interfaces[0]?.address || '');
    if (!repoEdited.current) setRepoPath(result.repoPath || '');
    if (!result.enabled) { setBootstrap(''); setPairing(null); }
  };
  useEffect(() => {
    mounted.current = true; let cancelled = false, timer;
    const read = async () => {
      const current = generation.current;
      if (!lock.current) {
        try { const result = await api('android.status', {}); if (!cancelled && !lock.current && current === generation.current) acceptStatus(result); }
        catch (e) { if (!cancelled && current === generation.current) setError(e.message); }
      }
      if (!cancelled) timer = setTimeout(read, 3000);
    };
    read(); const clock = setInterval(() => setTime(Date.now()), 1000);
    return () => { mounted.current = false; cancelled = true; clearTimeout(timer); clearInterval(clock); };
  }, [api]);
  const run = async action => {
    if (lock.current) return;
    lock.current = true; generation.current++; setBusy(true); setError('');
    try {
      await action();
      const result = await api('android.status', {});
      if (mounted.current) acceptStatus(result);
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const copy = async value => {
    if (!navigator.clipboard) throw new Error('Copia el texto seleccionándolo en el campo.');
    await navigator.clipboard.writeText(value);
  };
  const changing = busy || status?.starting || status?.stopping;
  const expiresAt = pairing && status?.enabled && pairing.expiresAt === status.pairingExpiresAt ? new Date(pairing.expiresAt).getTime() : 0;
  const validPort = port.trim() !== '' && Number.isInteger(Number(port)) && (Number(port) === 0 || (Number(port) >= 1024 && Number(port) <= 65535));
  return <section className="tw-section">
    <h3>App Android (gateway HTTPS)</h3>
    {error && <p className="tw-error" role="alert">{error}</p>}
    {status?.lastError && status.lastError !== error && <p className="tw-error" role="alert">{status.lastError}</p>}
    <form className="tw-form" onSubmit={e => { e.preventDefault(); run(async () => {
      const result = await api('android.configure', { repoPath });
      if (mounted.current) { repoEdited.current = false; acceptStatus(result); }
    }); }}>
      <label className="tw-field">Ruta del repo phantom-mobile<input value={repoPath} disabled={changing || status?.processAlive} onChange={e => { repoEdited.current = true; setRepoPath(e.target.value); }} /></label>
      <button className="tw-button" disabled={!status || changing || status.processAlive || !repoPath.trim()} type="submit">Guardar</button>
    </form>
    {!status ? <p role="status">Consultando gateway Android…</p> : <>
      {status.repoValid ? <p className="tw-muted">Repositorio phantom-mobile válido.</p> : <p className="tw-error" role="alert">{status.repoError}</p>}
      <p className="tw-muted">Node: {status.node.version || 'no disponible'} · {status.node.binary}</p>
      {status.node.error && <p className="tw-error" role="alert">{status.node.error}</p>}
      {status.enabled ? <>
        <p>Encendido para {status.workspaceId === workspace?.id ? workspace.name : 'otro proyecto'}.</p>
        <label className="tw-field">URL HTTPS<input readOnly value={status.url || ''} /></label>
        <label className="tw-field">Huella SHA256 (compárala en el teléfono)<input readOnly value={status.fingerprint || ''} /></label>
        <button className="tw-button" disabled={changing} onClick={() => run(async () => {
          const value = JSON.stringify(await api('android.bootstrap', {}), null, 2);
          if (mounted.current) setBootstrap(value);
          await copy(value);
        })}>Copiar bootstrap público</button>
        <label className="tw-field">Bootstrap público JSON<textarea readOnly rows={6} value={bootstrap} placeholder="Pulsa Copiar bootstrap público para obtener el JSON" /></label>
        <button className="tw-button" disabled={changing} onClick={() => run(async () => {
          const value = await api('android.pairing', {});
          if (mounted.current) setPairing(value);
        })}>Generar código de vinculación</button>
        {expiresAt > time ? <>
          <label className="tw-field">Código de vinculación<input readOnly value={pairing.code} /></label>
          <p role="status">Caduca en {Math.max(0, Math.ceil((expiresAt - time) / 1000))} s · Un solo uso.</p>
          <button className="tw-button" disabled={changing} onClick={() => run(() => copy(pairing.code))}>Copiar código</button>
        </> : <p className="tw-muted">Código usado, caducado o no generado en este panel. Cada código dura 120 segundos.</p>}
        <button className="tw-button tw-danger" disabled={changing} onClick={() => run(() => api('android.stop', {}))}>Detener gateway</button>
        <h4>Dispositivos</h4>
        {!status.devices.length && <p className="tw-muted">Ningún dispositivo vinculado.</p>}
        {status.devices.map(device => <DevicePermissions key={`${status.workspaceId}:${device.id}:${device.state}:${device.permissionVersion}`} device={device} workspaceId={status.workspaceId} busy={changing} run={run} api={api} />)}
      </> : <>
        <p className="tw-muted">Apagado. El teléfono debe poder ver al equipo en la red: las Wi-Fi que aíslan clientes no sirven; el hotspot del teléfono sí.</p>
        <label className="tw-field">Interfaz LAN<select value={address} disabled={changing} onChange={e => setAddress(e.target.value)}><option value="">Elige una interfaz privada</option>{status.interfaces.map(item => <option key={`${item.name}:${item.address}`} value={item.address}>{item.name} · {item.address}</option>)}</select></label>
        {!status.interfaces.length && <p>No hay interfaces LAN IPv4 privadas disponibles.</p>}
        <label className="tw-field">Puerto (0: automático)<input type="number" min="0" max="65535" step="1" value={port} disabled={changing} onChange={e => setPort(e.target.value)} /></label>
        {!validPort && <p className="tw-error" role="alert">El puerto debe ser 0 (automático) o un entero entre 1024 y 65535.</p>}
        <button className="tw-button tw-primary" disabled={changing || status.processAlive || !workspace || !address || !validPort || !status.repoValid || !status.node.compatible} onClick={() => run(() => api('android.start', { workspaceId: workspace.id, address, port: Number(port) }))}>Iniciar gateway para {workspace?.name || 'el proyecto actual'}</button>
      </>}
    </>}
    <ol className="tw-muted">
      <li>En la app Android, importa el bootstrap público JSON copiado desde este panel.</li>
      <li>Compara la huella SHA256 del teléfono con la mostrada aquí.</li>
      <li>Introduce en el teléfono el código temporal de vinculación y aprueba aquí el dispositivo con sus permisos.</li>
      <li>Tras aprobarlo, desbloquea en el teléfono la acción con la biometría del dispositivo.</li>
    </ol>
    <p className="tw-muted">Al reiniciar el gateway se pierden las vinculaciones; la identidad TLS se conserva. Al cerrar el host se detiene el gateway.</p>
  </section>;
}
