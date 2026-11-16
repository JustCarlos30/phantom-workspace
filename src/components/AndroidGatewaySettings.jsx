import React, { useEffect, useRef, useState } from 'react';
import { Group, Row, TextRow, Switch } from './PluginPrimitives.jsx';
import PhoneQr from './PhoneQr.jsx';
import MobileSettings from './MobileSettings.jsx';
import { buildAppPairingPayload } from '../phone-pairing.mjs';

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
  const [bootstrap, setBootstrap] = useState(null), [pairing, setPairing] = useState(null);
  const [linking, setLinking] = useState(false), [advanced, setAdvanced] = useState(false);
  const networkEdited = useRef(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [time, setTime] = useState(Date.now());
  const lock = useRef(false), mounted = useRef(true), repoEdited = useRef(false), generation = useRef(0);
  const acceptStatus = result => {
    setStatus(result);
    if (!result.repoValid || !result.node.compatible) setAdvanced(true);
    if (result.devices.some(device => device.state === 'pending')) { setLinking(false); setPairing(null); }
    setAddress(previous => result.interfaces.some(item => item.address === previous) ? previous : result.interfaces[0]?.address || '');
    if (!repoEdited.current) setRepoPath(result.repoPath || '');
    if (!result.enabled) { setBootstrap(null); setPairing(null); setLinking(false); }
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
    const tick = () => setTime(Date.now());
    read(); const clock = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { mounted.current = false; cancelled = true; clearTimeout(timer); clearInterval(clock); document.removeEventListener('visibilitychange', tick); };
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
  const link = () => run(async () => {
    const result = await api('android.link', { workspaceId: workspace.id, ...(networkEdited.current ? { address, port: Number(port) } : {}) });
    if (mounted.current) { acceptStatus(result.status); setBootstrap(result.bootstrap); setPairing(result.pairing); setLinking(!result.status.devices.some(device => device.state === 'pending')); }
  });
  const changing = busy || status?.starting || status?.stopping;
  const expiry = value => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? (/^\d+$/.test(value) ? Number(value) : Date.parse(value)) : NaN;
  const expiresAt = pairing && status?.enabled && expiry(pairing.expiresAt) === expiry(status.pairingExpiresAt) ? expiry(pairing.expiresAt) : 0;
  let qrText = '', payloadError = '';
  if (linking && pairing) {
    try { qrText = buildAppPairingPayload({ bootstrap, code: pairing.code, expiresAt, now: Math.max(time, Date.now()) }); }
    catch (e) { payloadError = e.message; }
  }
  const validPort = port.trim() !== '' && Number.isInteger(Number(port)) && (Number(port) === 0 || (Number(port) >= 1024 && Number(port) <= 65535));
  useEffect(() => {
    if (linking && pairing && !document.hidden && !changing && (expiresAt - time <= 10000)) link();
  }, [time]);
  return <>
    <Group title="Vincular teléfono">
    <p>Escanea el código con la app Phantom en tu Android. El teléfono debe estar en la misma red.</p>
    <Row label="Estado" hint="Vincula la app de Android con este proyecto por la red local."><span className="st-status" data-tone={error || status?.lastError ? 'warn' : status?.enabled ? 'ok' : undefined}>{error || status?.lastError ? 'Error' : !status ? 'Consultando' : status.enabled ? 'Activo' : 'Apagado'}</span></Row>
    {error && <p className="st-error" role="alert">{error}</p>}
    {status?.lastError && status.lastError !== error && <p className="st-error" role="alert">{status.lastError}</p>}
    {status && !linking && status.repoValid && status.node.compatible && !status.devices.some(device => device.state === 'pending') && <Row label=""><button className="st-btn is-primary" disabled={changing || !workspace || !validPort} onClick={link}>{status.devices.some(device => device.state === 'approved') ? 'Vincular otro teléfono' : 'Vincular teléfono'}</button></Row>}
    {linking && pairing && <>{qrText && <><PhoneQr text={qrText} /><p role="status">Caduca en {Math.max(0, Math.ceil((expiresAt - time) / 1000))} s · {workspace?.name}</p></>}{payloadError && <><p className="st-error" role="alert">{payloadError}</p><button className="st-btn" disabled={changing} onClick={link}>Reintentar</button></>}<button className="st-btn" disabled={changing} onClick={() => { setLinking(false); setPairing(null); }}>Cancelar</button></>}
    </Group>
    {status?.devices.filter(device => device.state === 'pending' || device.state === 'approved').map(device => <Group key={device.id} title={device.state === 'pending' ? `${device.name || 'Teléfono Android'} quiere conectarse` : `${device.name || 'Teléfono Android'} · ${device.connected ? 'Conectado' : 'Aprobado'}`}>
      {device.state === 'pending' && <><p title={device.keyFingerprint}>{device.keyFingerprint?.slice(0, 8)}…{device.keyFingerprint?.slice(-8)}</p><p>Podrá leer el chat, enviar mensajes y parar turnos con la autoridad del agente, y ver las herramientas del proyecto.</p><button className="st-btn is-primary" disabled={changing} onClick={() => run(() => api('android.approve', { id: device.id, nodes: [`phantom:${status.workspaceId}`], allow: [`phantom:${status.workspaceId}=chat.send`, `phantom:${status.workspaceId}=chat.stop`], workspaceRead: true, workspaceAllow: [], acknowledgeAgentAuthority: true }))}>Permitir</button></>}
      <button className="st-btn is-danger" disabled={changing} onClick={() => run(() => api('android.revoke', { id: device.id }))}>{device.state === 'pending' ? 'Rechazar' : 'Quitar'}</button>
      <details className="st-details"><summary>{device.state === 'pending' ? 'Personalizar permisos' : 'Permisos'}</summary><DevicePermissions key={`${device.id}:${device.state}:${device.permissionVersion}`} device={device} workspaceId={status.workspaceId} busy={changing} run={run} api={api} /></details>
    </Group>)}
    <details className="st-details" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>Opciones avanzadas</summary>
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
        <Group>
        <Row label="Red" hint={!status.interfaces.length && 'No se detecta una red local.'}><select className="st-select" aria-label="Red" value={address} disabled={changing || status.processAlive} onChange={e => { networkEdited.current = true; setAddress(e.target.value); }}><option value="">Elige una red</option>{status.interfaces.map(item => <option key={`${item.name}:${item.address}`} value={item.address}>{item.name} · {item.address}</option>)}</select></Row>
        <Row label="Puerto (0 = automático)"><input className="st-input" aria-label="Puerto (0 = automático)" type="number" min="0" max="65535" step="1" value={port} disabled={changing || status.processAlive} onChange={e => { networkEdited.current = true; setPort(e.target.value); }} /></Row>
        {!validPort && <p className="st-error" role="alert">El puerto debe ser 0 (automático) o un entero entre 1024 y 65535.</p>}
        {status.processAlive && <Row label="Desactivar gateway"><button className="st-btn is-danger" disabled={changing} onClick={() => run(() => api('android.stop', {}))}>Desactivar gateway</button></Row>}
        </Group>
    </>}
    <MobileSettings workspace={workspace} api={api} embedded />
    </details>
    <p className="st-note">Al desactivar o cerrar Phantom habrá que escanear de nuevo.</p>
  </>;
}
