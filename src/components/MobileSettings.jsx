import React, { useEffect, useRef, useState } from 'react';

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
    <p className="tw-muted">Conecta el teléfono a la misma Wi-Fi. HTTP local requiere una red de confianza: quienes puedan observarla podrían leer el tráfico. El acceso se apaga al reiniciar el host.</p>
    {error && <p className="tw-error" role="alert">{error}</p>}
    {!status ? <p role="status">Consultando acceso móvil…</p> : status.enabled ? <>
      <p>Activo para {status.workspaceId === workspace?.id ? workspace.name : 'otro proyecto'}.</p>
      <label className="tw-field">Dirección móvil<input readOnly value={status.url || ''} /></label>
      <div className="tw-row"><button className="tw-button" disabled={busy} onClick={() => run(() => copy(status.url))}>Copiar dirección</button><button className="tw-button tw-danger" disabled={busy} onClick={() => run(async () => { await api('mobile.stop', {}); setPairing(null); })}>Desactivar acceso móvil</button></div>
      <p className="tw-muted">Abre la dirección en el navegador del teléfono e introduce el código, por separado. Cada código sirve una sola vez.</p>
      {expiresAt && expiresAt > time ? <><label className="tw-field">Código de emparejamiento<input readOnly value={pairing.code} /></label><p role="status">Caduca en {Math.ceil((expiresAt - time) / 1000)} s</p><button className="tw-button" disabled={busy} onClick={() => run(() => copy(pairing.code))}>Copiar código</button></> : <p>Código usado, caducado o no mostrado en este panel.</p>}
      <button className="tw-button" disabled={busy} onClick={() => run(async () => setPairing(await api('mobile.pairing', {})))}>Generar nuevo código</button>
      <h4>Dispositivos autorizados</h4>
      {!status.devices.length && <p className="tw-muted">Ningún dispositivo emparejado.</p>}
      {status.devices.map(device => <div className="tw-list-row" key={device.id}><div><strong>{device.name || 'Móvil'}</strong><small>Última conexión: {new Date(device.lastSeenAt).toLocaleTimeString()} · Caduca: {new Date(device.expiresAt).toLocaleString()}</small></div><button className="tw-button tw-danger" disabled={busy} onClick={() => run(() => api('mobile.revoke', { id: device.id }))}>Revocar</button></div>)}
    </> : <>
      <p className="tw-muted">Desactivado. Autoriza únicamente las sesiones del proyecto actual.</p>
      <label className="tw-field">Interfaz Wi-Fi / LAN<select value={address} onChange={e => setAddress(e.target.value)}><option value="">Elige una interfaz privada</option>{status.interfaces.map(item => <option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}</select></label>
      {!status.interfaces.length && <p>No hay una interfaz LAN IPv4 privada detectada. Conecta el equipo a la Wi-Fi y vuelve a consultar.</p>}
      <label className="tw-field">Puerto (0: automático)<input type="number" min="0" max="65535" value={port} onChange={e => setPort(e.target.value)} /></label>
      <button className="tw-button tw-primary" disabled={busy || !workspace || !address} onClick={() => run(async () => { const result = await api('mobile.start', { workspaceId: workspace.id, address, port: Number(port) }); setPairing(result.pairing); })}>Activar para {workspace?.name || 'el proyecto actual'}</button>
    </>}
  </section>;
}
