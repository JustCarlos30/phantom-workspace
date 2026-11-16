import React, { useEffect, useRef, useState } from 'react';
import { Group, Row, TextRow } from './PluginPrimitives.jsx';

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
  return <>
    <Group title="Navegador del teléfono">
    <Row label="Estado" hint="Abre el proyecto desde el navegador del teléfono, en la misma Wi-Fi."><span className="st-status" data-tone={error ? 'warn' : status?.enabled ? 'ok' : undefined}>{error ? 'Error' : !status ? 'Consultando' : status.enabled ? 'Activo' : 'Apagado'}</span></Row>
    {error && <p className="st-error" role="alert">{error}</p>}
    {!status ? <p role="status">Consultando…</p> : status.enabled ? <>
      <Row label="Proyecto" >{status.workspaceId === workspace?.id ? workspace.name : 'otro proyecto'}</Row>
      <TextRow label="Dirección móvil" readOnly mono value={status.url || ''}><button className="st-btn" disabled={busy} onClick={() => run(() => copy(status.url))}>Copiar dirección</button></TextRow>
      <TextRow label="Huella del certificado" hint="Debe coincidir con la que muestra el navegador." readOnly mono value={status.tls?.fingerprint || ''}><button className="st-btn" disabled={busy} onClick={() => run(() => copy(status.tls?.fingerprint || ''))}>Copiar huella</button></TextRow>
      {expiresAt && expiresAt > time ? <TextRow label="Código para vincular" hint={<span role="status">Caduca en {Math.ceil((expiresAt - time) / 1000)} s</span>} readOnly mono value={pairing.code}><button className="st-btn" disabled={busy} onClick={() => run(() => copy(pairing.code))}>Copiar código</button></TextRow> : <Row label="Introducir código" hint="Genera un código para vincular el teléfono." />}
      <Row label="Generar código"><button className="st-btn" disabled={busy} onClick={() => run(async () => setPairing(await api('mobile.pairing', {})))}>Generar código</button></Row>
    </> : <>
      <Row label="Red" hint={!status.interfaces.length && 'No se detecta una red local. Conecta el equipo a la Wi-Fi.'}><select className="st-select" aria-label="Red" value={address} onChange={e => setAddress(e.target.value)}><option value="">Elige una red</option>{status.interfaces.map(item => <option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}</select></Row>
      <Row label="Puerto (0 = automático)"><input className="st-input" aria-label="Puerto (0 = automático)" type="number" min="0" max="65535" value={port} onChange={e => setPort(e.target.value)} /></Row>
      <Row label="Activar"><button className="st-btn is-primary" disabled={busy || !workspace || !address} onClick={() => run(async () => { const result = await api('mobile.start', { workspaceId: workspace.id, address, port: Number(port) }); setPairing(result.pairing); })}>Activar para {workspace?.name || 'el proyecto actual'}</button></Row>
    </>}
    </Group>
    {status?.enabled && <>
      <Group title="Dispositivos vinculados">
        {!status.devices.length && <Row label="Ningún dispositivo vinculado." />}
        {status.devices.map(device => <Row key={device.id} label={device.name || 'Móvil'} hint={`Última conexión: ${new Date(device.lastSeenAt).toLocaleTimeString()} · Caduca: ${new Date(device.expiresAt).toLocaleString()}`}><button className="st-btn is-danger" disabled={busy} onClick={() => run(() => api('mobile.revoke', { id: device.id }))}>Revocar</button></Row>)}
      </Group>
      <Group><Row label="Desactivar"><button className="st-btn is-danger" disabled={busy} onClick={() => run(async () => { await api('mobile.stop', {}); setPairing(null); })}>Desactivar</button></Row></Group>
    </>}
    <details className="st-details"><summary>Cómo funciona</summary><Row label="Conecta el teléfono a la misma Wi-Fi, abre la dirección, compara la huella e introduce el código. El acceso se apaga al cerrar Phantom." /></details>
  </>;
}
