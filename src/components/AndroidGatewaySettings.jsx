import React, { useEffect, useRef, useState } from 'react';
import { Group, Row, TextRow, Switch } from './PluginPrimitives.jsx';

function DevicePermissions({ device, workspaceId, busy, run, api }) {
  const mainId = `phantom:${workspaceId}`;
  const main = device.grants?.find(grant => grant.nodeId === mainId)?.capabilities || [];
  const [read, setRead] = useState(main.includes('read'));
  const [send, setSend] = useState(main.includes('chat.send'));
  const [stop, setStop] = useState(main.includes('chat.stop'));
  const [workspaceRead, setWorkspaceRead] = useState(false);
  const [ack, setAck] = useState(false);
  const checkbox = (label, checked, change, disabled = false) => <Row label={label}><Switch label={label} checked={checked} disabled={busy || disabled} onChange={change} /></Row>;
  return <form onSubmit={e => {
      e.preventDefault();
      run(() => api('android.approve', { id: device.id, nodes: read ? [mainId] : [],
        allow: read ? [...(send ? [`${mainId}=chat.send`] : []), ...(stop ? [`${mainId}=chat.stop`] : [])] : [],
        workspaceRead, workspaceAllow: [], acknowledgeAgentAuthority: ack }));
    }}>
      <Group title={`${device.name || 'Teléfono Android'} · ${device.state === 'pending' ? 'Pendiente' : 'Aprobado'}`}>
      <TextRow label="Huella del dispositivo" readOnly mono value={device.keyFingerprint || ''} />
      <Row label="Chat principal" />
      {checkbox('Leer chat principal', read, value => { setRead(value); if (!value) { setSend(false); setStop(false); } })}
      {checkbox('Enviar mensajes', send, setSend, !read)}
      {checkbox('Parar turnos', stop, setStop, !read)}
      <Row label="Herramientas del proyecto" hint="Actualizar reemplaza los permisos anteriores." />
      {checkbox('Leer herramientas del proyecto', workspaceRead, setWorkspaceRead)}
      <Row label={<span style={{ color: 'var(--attention)' }}>Autoridad del agente</span>} hint={<span style={{ color: 'var(--attention)' }}>Obligatorio para leer el chat, enviar mensajes o parar turnos.</span>} />
      <Row label={<span style={{ color: 'var(--attention)' }}>Entiendo que el teléfono actuará con la autoridad del agente</span>}><Switch label="Entiendo que el teléfono actuará con la autoridad del agente" checked={ack} disabled={busy} onChange={setAck} /></Row>
      <Row label="Permisos"><button className="st-btn is-primary" disabled={busy || (read && !ack)} type="submit">{device.state === 'pending' ? 'Aprobar' : 'Actualizar permisos'}</button>
        <button className="st-btn is-danger" type="button" disabled={busy} onClick={() => run(() => api('android.revoke', { id: device.id }))}>Revocar</button></Row>
      </Group>
    </form>;
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
  return <>
    <Group title="App Android">
    <Row label="Estado" hint="Vincula la app de Android con este proyecto por la red local."><span className="st-status" data-tone={error || status?.lastError ? 'warn' : status?.enabled ? 'ok' : undefined}>{error || status?.lastError ? 'Error' : !status ? 'Consultando' : status.enabled ? 'Activo' : 'Apagado'}</span></Row>
    {error && <p className="st-error" role="alert">{error}</p>}
    {status?.lastError && status.lastError !== error && <p className="st-error" role="alert">{status.lastError}</p>}
    </Group>
    <form onSubmit={e => { e.preventDefault(); run(async () => {
      const result = await api('android.configure', { repoPath });
      if (mounted.current) { repoEdited.current = false; acceptStatus(result); }
    }); }}>
      <Group><TextRow label="Carpeta de phantom-mobile" value={repoPath} disabled={changing || status?.processAlive} onChange={value => { repoEdited.current = true; setRepoPath(value); }}>
      <button className="st-btn" disabled={!status || changing || status.processAlive || !repoPath.trim()} type="submit">Guardar</button></TextRow>
      {status && (status.repoValid ? null : <p className="st-error" role="alert">{status.repoError}</p>)}
      </Group>
    </form>
    {!status ? <p role="status">Consultando…</p> : <>
      {status.node.error && <p className="st-error" role="alert">{status.node.error}</p>}
      {status.enabled ? <>
        <Group>
        <Row label="Proyecto">{status.workspaceId === workspace?.id ? workspace.name : 'otro proyecto'}</Row>
        <TextRow label="Dirección" readOnly mono value={status.url || ''}><button className="st-btn" disabled={changing} onClick={() => run(() => copy(status.url || ''))}>Copiar dirección</button></TextRow>
        <Row label="Datos de conexión" hint="Importa estos datos de conexión en la app." stack>
        <textarea className="st-input is-mono" aria-label="Datos de conexión" readOnly rows={6} value={bootstrap} placeholder="Pulsa Copiar datos de conexión" />
        <button className="st-btn" disabled={changing} onClick={() => run(async () => {
          const value = JSON.stringify(await api('android.bootstrap', {}), null, 2);
          if (mounted.current) setBootstrap(value);
          await copy(value);
        })}>Copiar datos de conexión</button>
        </Row>
        <TextRow label="Huella (compárala en el teléfono)" readOnly mono value={status.fingerprint || ''}><button className="st-btn" disabled={changing} onClick={() => run(() => copy(status.fingerprint || ''))}>Copiar huella</button></TextRow>
        <Row label="Generar código"><button className="st-btn" disabled={changing} onClick={() => run(async () => {
          const value = await api('android.pairing', {});
          if (mounted.current) setPairing(value);
        })}>Generar código</button></Row>
        {expiresAt > time ? <TextRow label="Código para vincular" readOnly mono value={pairing.code} hint={<span role="status">Caduca en {Math.max(0, Math.ceil((expiresAt - time) / 1000))} s · Un solo uso.</span>}>
          <button className="st-btn" disabled={changing} onClick={() => run(() => copy(pairing.code))}>Copiar código</button>
        </TextRow> : <Row label="Introducir código" hint="Cada código dura 120 segundos." />}
        <Row label="Dispositivos" hint="Después, aprueba aquí el dispositivo." />
        </Group>
        {!status.devices.length && <Group title="Dispositivos vinculados"><Row label="Ningún dispositivo vinculado." /></Group>}
        {status.devices.map(device => <DevicePermissions key={`${status.workspaceId}:${device.id}:${device.state}:${device.permissionVersion}`} device={device} workspaceId={status.workspaceId} busy={changing} run={run} api={api} />)}
        <Group><Row label="Desactivar"><button className="st-btn is-danger" disabled={changing} onClick={() => run(() => api('android.stop', {}))}>Desactivar</button></Row></Group>
      </> : <>
        <Group>
        <Row label="Red" hint={!status.interfaces.length && 'No se detecta una red local.'}><select className="st-select" aria-label="Red" value={address} disabled={changing} onChange={e => setAddress(e.target.value)}><option value="">Elige una red</option>{status.interfaces.map(item => <option key={`${item.name}:${item.address}`} value={item.address}>{item.name} · {item.address}</option>)}</select></Row>
        <Row label="Puerto (0 = automático)"><input className="st-input" aria-label="Puerto (0 = automático)" type="number" min="0" max="65535" step="1" value={port} disabled={changing} onChange={e => setPort(e.target.value)} /></Row>
        {!validPort && <p className="st-error" role="alert">El puerto debe ser 0 (automático) o un entero entre 1024 y 65535.</p>}
        <Row label="Activar"><button className="st-btn is-primary" disabled={changing || status.processAlive || !workspace || !address || !validPort || !status.repoValid || !status.node.compatible} onClick={() => run(() => api('android.start', { workspaceId: workspace.id, address, port: Number(port) }))}>Activar para {workspace?.name || 'el proyecto actual'}</button></Row>
        </Group>
      </>}
    </>}
    <details className="st-details"><summary>Cómo funciona</summary>
    <div className="st-block">
    <p>El teléfono debe poder ver al equipo en la red: las Wi-Fi que aíslan clientes no sirven; el hotspot del teléfono sí.</p>
    <ol className="st-note">
      <li>En la app, importa los datos de conexión copiados aquí.</li>
      <li>Compara la huella del teléfono con la de aquí.</li>
      <li>Introduce el código en el teléfono y aprueba aquí el dispositivo.</li>
      <li>Desbloquea en el teléfono con tu huella o rostro.</li>
    </ol>
    <p className="st-note">Al desactivar hay que vincular de nuevo. Se apaga al cerrar Phantom.</p>
    </div>
    </details>
  </>;
}
