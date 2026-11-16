import React, { useEffect, useRef, useState } from 'react';
import { Group, Row } from './PluginPrimitives.jsx';
import PhoneQr from './PhoneQr.jsx';
import { buildBrowserPairingUrl } from '../phone-pairing.mjs';

export default function MobileSettings({ embedded, ...props }) {
  return embedded ? <BrowserSettings {...props} /> : null;
}

function BrowserSettings({ workspace, api }) {
  const [status, setStatus] = useState(null), [address, setAddress] = useState(''), [port, setPort] = useState('0');
  const [pairing, setPairing] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [time, setTime] = useState(Date.now());
  const lock = useRef(false), mounted = useRef(true), generation = useRef(0);
  useEffect(() => {
    mounted.current = true; let cancelled = false, timer;
    const read = async () => {
      const current = generation.current;
      if (!lock.current) try {
        const result = await api('mobile.status', {});
        if (!cancelled && !lock.current && current === generation.current) { setStatus(result); setAddress(previous => result.interfaces.some(item => item.address === previous) ? previous : result.interfaces[0]?.address || ''); if (!result.enabled) setPairing(null); }
      } catch (e) { if (!cancelled && current === generation.current) setError(e.message); }
      if (!cancelled) timer = setTimeout(read, 3000);
    };
    const tick = () => setTime(Date.now());
    read(); const clock = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { mounted.current = false; cancelled = true; clearTimeout(timer); clearInterval(clock); document.removeEventListener('visibilitychange', tick); };
  }, [api]);
  const run = async action => {
    if (lock.current) return; lock.current = true; generation.current++; setBusy(true); setError('');
    try { await action(); const result = await api('mobile.status', {}); if (mounted.current) setStatus(result); }
    catch (e) { if (mounted.current) setError(e.message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const show = () => run(async () => {
    if (!status.enabled) {
      if (!address) throw new Error('No se detecta una red LAN. Conecta el equipo a una red local.');
      const result = await api('mobile.start', { workspaceId: workspace.id, address, port: Number(port) });
      if (mounted.current) setPairing(result.pairing);
    } else {
      if (status.workspaceId !== workspace.id) throw new Error('El navegador está activo para otro proyecto. Desactívalo primero.');
      const result = await api('mobile.pairing', {});
      if (mounted.current) setPairing(result);
    }
  });
  const expiresAt = pairing?.expiresAt === status?.pairingExpiresAt ? new Date(pairing?.expiresAt).getTime() : 0;
  useEffect(() => { if (pairing && status?.enabled && !document.hidden && !busy && expiresAt - time <= 10000) show(); }, [time]);
  return <>
    <Group title="Sin app: navegador del teléfono">
      {!status && <p role="status">Consultando…</p>}
      {error && <p className="st-error" role="alert">{error}</p>}
      {status && <>
        <Row label=""><button className="st-btn" disabled={busy || !workspace} onClick={show}>Mostrar QR</button></Row>
        {pairing && status.enabled && <><PhoneQr text={buildBrowserPairingUrl(status.url, pairing.code)} /><p role="status">Caduca en {Math.max(0, Math.ceil((expiresAt - time) / 1000))} s · {workspace?.name}</p><p>Escanéalo con la cámara. El navegador avisará del certificado: comprueba que la huella termina en {status.tls?.fingerprint?.slice(-8)}</p></>}
        {status.interfaces.length > 1 && <details className="st-details"><summary>Red y puerto</summary>
          <Row label="Red"><select className="st-select" aria-label="Red del navegador" disabled={busy || status.enabled} value={address} onChange={e => setAddress(e.target.value)}>{status.interfaces.map(item => <option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}</select></Row>
          <Row label="Puerto (0 = automático)"><input className="st-input" aria-label="Puerto del navegador" type="number" min="0" max="65535" step="1" disabled={busy || status.enabled} value={port} onChange={e => setPort(e.target.value)} /></Row>
        </details>}
      </>}
    </Group>
    {status?.enabled && <Group title="Dispositivos vinculados">
      {!status.devices.length && <Row label="Ningún dispositivo vinculado." />}
      {status.devices.map(device => <Row key={device.id} label={device.name || 'Móvil'}><button className="st-btn is-danger" disabled={busy} onClick={() => run(() => api('mobile.revoke', { id: device.id }))}>Revocar</button></Row>)}
      <Row label="Desactivar"><button className="st-btn is-danger" disabled={busy} onClick={() => run(async () => { await api('mobile.stop', {}); if (mounted.current) setPairing(null); })}>Desactivar</button></Row>
    </Group>}
  </>;
}
