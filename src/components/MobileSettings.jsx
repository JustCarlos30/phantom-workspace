import React, { useEffect, useRef, useState } from 'react';
import '../mobile-settings.css';

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
  return <section className="tw-section mobile-settings">
    <header className="mobile-header"><div className="mobile-title"><h3>Navegador del teléfono</h3><span className="mobile-badge" data-state={error ? 'error' : status?.enabled ? 'active' : 'idle'}>{error ? 'Error' : !status ? 'Consultando' : status.enabled ? 'Activo' : 'Apagado'}</span></div>
      <p className="tw-muted">Abre el proyecto desde el navegador del teléfono, en la misma Wi-Fi.</p>
    {error && <p className="tw-error" role="alert">{error}</p>}
    </header>
    {!status ? <p role="status">Consultando…</p> : status.enabled ? <>
      <p className="tw-muted">Proyecto: <strong>{status.workspaceId === workspace?.id ? workspace.name : 'otro proyecto'}</strong></p>
      <ol className="mobile-steps">
      <li><h4>Abrir dirección</h4><div className="mobile-value"><label className="tw-field">Dirección móvil<input readOnly value={status.url || ''} /></label><button className="tw-button" disabled={busy} onClick={() => run(() => copy(status.url))}>Copiar dirección</button></div></li>
      <li><h4>Comparar huella</h4><div className="mobile-value"><label className="tw-field">Huella del certificado<input readOnly value={status.tls?.fingerprint || ''} /></label><button className="tw-button" disabled={busy} onClick={() => run(() => copy(status.tls?.fingerprint || ''))}>Copiar huella</button></div><p className="tw-muted">Debe coincidir con la que muestra el navegador.</p></li>
      <li><h4>Introducir código</h4>
      {expiresAt && expiresAt > time ? <><div className="mobile-value"><label className="tw-field">Código para vincular<input readOnly value={pairing.code} /></label><button className="tw-button" disabled={busy} onClick={() => run(() => copy(pairing.code))}>Copiar código</button></div><p className="mobile-countdown" role="status">Caduca en {Math.ceil((expiresAt - time) / 1000)} s</p></> : <p className="tw-muted">Genera un código para vincular el teléfono.</p>}
      <button className="tw-button" disabled={busy} onClick={() => run(async () => setPairing(await api('mobile.pairing', {})))}>Generar código</button>
      </li></ol>
      <div className="mobile-devices">
      <h4>Dispositivos vinculados</h4>
      {!status.devices.length && <p className="tw-muted">Ningún dispositivo vinculado.</p>}
      {status.devices.map(device => <div className="mobile-device mobile-device-row" key={device.id}><div><strong>{device.name || 'Móvil'}</strong><small>Última conexión: {new Date(device.lastSeenAt).toLocaleTimeString()} · Caduca: {new Date(device.expiresAt).toLocaleString()}</small></div><button className="tw-button tw-danger" disabled={busy} onClick={() => run(() => api('mobile.revoke', { id: device.id }))}>Revocar</button></div>)}
      </div>
      <footer className="mobile-stop"><button className="tw-button tw-danger" disabled={busy} onClick={() => run(async () => { await api('mobile.stop', {}); setPairing(null); })}>Desactivar</button></footer>
    </> : <>
      <div className="mobile-network">
      <label className="tw-field">Red<select value={address} onChange={e => setAddress(e.target.value)}><option value="">Elige una red</option>{status.interfaces.map(item => <option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}</select></label>
      <label className="tw-field">Puerto (0 = automático)<input type="number" min="0" max="65535" value={port} onChange={e => setPort(e.target.value)} /></label>
      </div>
      {!status.interfaces.length && <p>No se detecta una red local. Conecta el equipo a la Wi-Fi.</p>}
      <button className="tw-button tw-primary" disabled={busy || !workspace || !address} onClick={() => run(async () => { const result = await api('mobile.start', { workspaceId: workspace.id, address, port: Number(port) }); setPairing(result.pairing); })}>Activar para {workspace?.name || 'el proyecto actual'}</button>
    </>}
    <details className="mobile-help"><summary>Cómo funciona</summary><p>Conecta el teléfono a la misma Wi-Fi, abre la dirección, compara la huella e introduce el código. El acceso se apaga al cerrar Phantom.</p></details>
  </section>;
}
