import React, { useEffect, useRef, useState } from 'react';
import { Group, Row, TextRow } from './PluginPrimitives.jsx';
import PhoneQr from './PhoneQr.jsx';
import { buildBrowserPairingUrl } from '../phone-pairing.mjs';

export default function MobileSettings({ embedded, ...props }) {
  return embedded ? <BrowserSettings {...props} /> : null;
}

function BrowserSettings({ workspace, api }) {
  const [status, setStatus] = useState(null), [address, setAddress] = useState(''), [port, setPort] = useState('0');
  const [pairing, setPairing] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [time, setTime] = useState(Date.now());
  const lock = useRef(false), mounted = useRef(true), generation = useRef(0);
  const pairingRef = useRef(null);
  pairingRef.current = pairing;
  useEffect(() => {
    mounted.current = true; let cancelled = false, timer, hasPending = false;
    const read = async () => {
      const current = generation.current;
      if (!lock.current) try {
        const result = await api('mobile.status', {});
        hasPending = !!result.pending?.length;
        if (!cancelled && !lock.current && current === generation.current) {
          setStatus(result); setAddress(previous => result.interfaces.some(item => item.address === previous) ? previous : result.interfaces[0]?.address || '');
          if (result.enabled && result.workspaceId === workspace?.id && (!pairingRef.current || pairingRef.current.expiresAt !== result.pairingExpiresAt || pairingRef.current.expiresAt <= Date.now())) {
            lock.current = true;
            try { const next = await api('mobile.pairing', {}); if (!cancelled && current === generation.current) { pairingRef.current = next; setPairing(next); } } finally { lock.current = false; }
          }
          if (!result.enabled) { pairingRef.current = null; setPairing(null); }
        }
      } catch (e) { if (!cancelled && current === generation.current) setError(e.message); }
      if (!cancelled) timer = setTimeout(read, pairingRef.current || hasPending ? 1000 : 3000);
    };
    const tick = () => setTime(Date.now());
    read(); const clock = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { mounted.current = false; cancelled = true; clearTimeout(timer); clearInterval(clock); document.removeEventListener('visibilitychange', tick); };
  }, [api, workspace?.id]);
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
  const copy = async value => { if (!navigator.clipboard) throw new Error('Copia el texto seleccionándolo.'); await navigator.clipboard.writeText(value); };
  const expiresAt = pairing?.expiresAt === status?.pairingExpiresAt ? pairing?.expiresAt : null;
  return <>
    {status?.pending?.map(request => <Group title={`¿Vincular “${request.name}” desde ${request.remoteAddress}?`} key={request.id}><Row label="Código de comparación" hint="Confirma que el teléfono muestra el mismo código"><strong className="st-fingerprint">{request.sas.slice(0, 3)} {request.sas.slice(3)}</strong></Row><Row label="Solicitud"><div className="st-actions"><button className="st-btn is-primary" disabled={busy} onClick={() => run(async () => { await api('mobile.approve', { id: request.id }); if (mounted.current) setPairing(await api('mobile.pairing', {})); })}>Vincular</button><button className="st-btn" disabled={busy} onClick={() => run(() => api('mobile.reject', { id: request.id }))}>Rechazar</button></div></Row></Group>)}
    <Group title="Sin app: navegador del teléfono">
      {!status && <p className="st-note" role="status">Consultando…</p>}
      {error && <p className="st-error" role="alert">{error}</p>}
      {status && <>
        <Row label="Vinculación del navegador"><button className="st-btn" disabled={busy || !workspace || !status} onClick={show}>Mostrar QR</button></Row>
        {status.enabled && <Row label="Huella del certificado"><span className="st-fingerprint" title={status.tls?.fingerprint}>{status.tls?.fingerprint?.slice(0, 8)}…{status.tls?.fingerprint?.slice(-8)}</span></Row>}
      </>}
    </Group>
    {pairing && status?.enabled && status.workspaceId === workspace?.id && expiresAt > time && <div className="st-phone-link"><PhoneQr text={buildBrowserPairingUrl(status.url, pairing.code)} /><p className="st-note" role="status">Caduca en {Math.max(0, Math.ceil((expiresAt - time) / 1000))} s</p><p className="st-note">Escanéalo con la cámara y compara el código de seis dígitos antes de pulsar Vincular en el escritorio. El navegador avisará del certificado: comprueba que la huella termina en {status.tls?.fingerprint?.slice(-8)}</p></div>}
    {status?.enabled && <details className="st-details"><summary>Sin cámara</summary><Group><TextRow label="Dirección móvil" readOnly mono value={status.url || ''}><button className="st-btn" disabled={busy} onClick={() => run(() => copy(status.url))}>Copiar dirección</button></TextRow>{status.workspaceId === workspace?.id && expiresAt > time && <TextRow label="Código para vincular" readOnly mono value={pairing.code}><button className="st-btn" disabled={busy} onClick={() => run(() => copy(pairing.code))}>Copiar código</button></TextRow>}</Group></details>}
    {status?.interfaces.length > 1 && <details className="st-details"><summary>Red y puerto</summary><Group>
          <Row label="Red"><select className="st-select" aria-label="Red del navegador" disabled={busy || status.enabled} value={address} onChange={e => setAddress(e.target.value)}>{status.interfaces.map(item => <option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}</select></Row>
          <Row label="Puerto (0 = automático)"><input className="st-input" aria-label="Puerto del navegador" type="number" min="0" max="65535" step="1" disabled={busy || status.enabled} value={port} onChange={e => setPort(e.target.value)} /></Row>
    </Group></details>}
    {status?.enabled && <Group title="Dispositivos vinculados">
      {!status.devices.length && <Row label="Ningún dispositivo vinculado." />}
      {status.devices.map(device => <Row key={device.id} label={device.name || 'Móvil'}><button className="st-btn is-danger" disabled={busy} onClick={() => run(() => api('mobile.revoke', { id: device.id }))}>Revocar</button></Row>)}
      <Row label="Desactivar"><button className="st-btn is-danger" disabled={busy} onClick={() => run(async () => { await api('mobile.stop', {}); if (mounted.current) setPairing(null); })}>Desactivar</button></Row>
    </Group>}
  </>;
}
