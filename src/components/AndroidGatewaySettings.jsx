import React, { useEffect, useRef, useState } from 'react';
import { Group, Row, TextRow, Switch } from './PluginPrimitives.jsx';
import PhoneQr from './PhoneQr.jsx';
import MobileSettings from './MobileSettings.jsx';
import { buildAppPairingPayload } from '../phone-pairing.mjs';
import { standardGrants, grantsFromSelection, selectionFromGrants, needsAcknowledgement } from '../phone-permissions.mjs';

function DevicePermissions({ device, workspaces, workspacesAvailable, busy, run, api }) {
  const [selection, setSelection] = useState(() => selectionFromGrants(device, workspaces));
  const [dirty, setDirty] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(null);
  // El reconocimiento ya dado se conserva aunque el gateway no lo devuelva en el estado del dispositivo.
  useEffect(() => { if (!dirty) setSelection(prev => { const next = selectionFromGrants(device, workspaces); return { ...next, acknowledgeAgentAuthority: next.acknowledgeAgentAuthority || prev.acknowledgeAgentAuthority }; }); }, [device, workspaces, dirty]);
  const edit = next => { setSelection(next); setDirty(true); setSaved(null); setError(''); };
  const checkbox = (workspaceId, nodeId, capability, label) => {
    const capabilities = selection.grants.find(grant => grant.workspaceId === workspaceId && grant.nodeId === nodeId)?.capabilities ?? [];
    const read = nodeId === null ? 'workspace.read' : 'read';
    return <Row key={`${nodeId}:${capability}`} label={label}><Switch label={label} checked={capabilities.includes(capability)} disabled={busy || (capability !== read && !capabilities.includes(read))} onChange={value => {
      const next = value ? [...capabilities, capability] : capability === read ? [] : capabilities.filter(item => item !== capability);
      edit({ ...selection, grants: [...selection.grants.filter(grant => grant.workspaceId !== workspaceId || grant.nodeId !== nodeId), { workspaceId, nodeId, capabilities: next }] });
    }} /></Row>;
  };
  const blocked = needsAcknowledgement(selection, workspaces) && !selection.acknowledgeAgentAuthority;
  return <form onSubmit={async e => {
    e.preventDefault(); setError('');
    if (!workspacesAvailable) return;
    const result = await run(() => api('android.approve', { id: device.id, grants: grantsFromSelection(selection, workspaces), acknowledgeAgentAuthority: selection.acknowledgeAgentAuthority }));
    if (result?.error) setError(result.error.message);
    if (result?.status) {
      const updated = result.status.devices.find(item => item.id === device.id);
      if (updated) {
        const next = selectionFromGrants(updated, result.status.workspaces);
        next.acknowledgeAgentAuthority = next.acknowledgeAgentAuthority || selection.acknowledgeAgentAuthority;
        setSelection(next); setDirty(false); setSaved(new Set(next.grants.map(grant => grant.workspaceId)).size);
      } else setError('El dispositivo ya no está disponible.');
    }
  }}>
    <Group><Row label="Todos los proyectos" hint="Chat principal: leer, enviar mensajes y parar turnos; herramientas: leer."><button className="st-btn" type="button" disabled={busy} onClick={() => edit({ ...selection, grants: standardGrants(workspaces) })}>Aplicar estándar</button></Row></Group>
    {workspaces.map(workspace => <details className="st-details" key={workspace.id}><summary>{workspace.name}</summary><Group>
      {checkbox(workspace.id, `phantom:${workspace.id}`, 'read', 'Chat principal: leer')}
      {checkbox(workspace.id, `phantom:${workspace.id}`, 'chat.send', 'Chat principal: enviar mensajes')}
      {checkbox(workspace.id, `phantom:${workspace.id}`, 'chat.stop', 'Chat principal: parar turnos')}
      {checkbox(workspace.id, null, 'workspace.read', 'Herramientas del proyecto: leer')}
      {workspace.nodes.map(node => <React.Fragment key={node.id}>
        {checkbox(workspace.id, node.id, 'read', `${node.title || node.id}: leer`)}
        {checkbox(workspace.id, node.id, node.type === 'terminal' ? 'terminal.write' : 'chat.send', `${node.title || node.id}: escribir`)}
      </React.Fragment>)}
    </Group></details>)}
    <Group>
      {needsAcknowledgement(selection, workspaces) && <div className="st-row is-attention"><div className="st-row-text"><span>Entiendo que el teléfono actuará con la autoridad del agente</span><small>Obligatorio para el chat principal o un orquestador.</small></div><div className="st-row-control"><Switch label="Entiendo que el teléfono actuará con la autoridad del agente" checked={selection.acknowledgeAgentAuthority} disabled={busy} onChange={value => edit({ ...selection, acknowledgeAgentAuthority: value })} /></div></div>}
      <Row label="Permisos" hint={blocked ? 'Reconoce la autoridad del agente para aplicar estos permisos.' : 'Actualizar reemplaza todos los permisos anteriores.'}><button className="st-btn" disabled={busy || blocked || !workspacesAvailable} type="submit">{device.state === 'pending' ? 'Aprobar' : 'Actualizar permisos'}</button></Row>
    </Group>
    {dirty && <p className="st-note" role="status">Cambios sin aplicar</p>}
    {saved !== null && <p className="st-note" role="status">Permisos aplicados · {saved} proyectos</p>}
    {error && <p className="st-error" role="alert">{error}</p>}
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
    result = {
      ...result,
      workspacesAvailable: Array.isArray(result?.workspaces),
      workspaces: Array.isArray(result?.workspaces) ? result.workspaces.map(workspace => ({ ...workspace, nodes: Array.isArray(workspace.nodes) ? workspace.nodes : [] })) : [],
      devices: Array.isArray(result?.devices) ? result.devices : [],
      node: result?.node ?? { compatible: false },
      interfaces: Array.isArray(result?.interfaces) ? result.interfaces : [],
    };
    setStatus(result);
    if (!result.repoValid || !result.node.compatible) setAdvanced(true);
    if (result.devices.some(device => device.state === 'pending')) { setLinking(false); setPairing(null); }
    setAddress(previous => result.interfaces.some(item => item.address === previous) ? previous : result.interfaces[0]?.address || '');
    if (!repoEdited.current) setRepoPath(result.repoPath || '');
    if (!result.enabled) { setBootstrap(null); setPairing(null); setLinking(false); }
    return result;
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
      if (mounted.current) return { status: acceptStatus(result) };
    } catch (e) { if (mounted.current) setError(e.message); return { error: e }; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const link = () => run(async () => {
    const result = await api('android.link', { ...(networkEdited.current ? { address, port: Number(port) } : {}) });
    if (mounted.current) { const next = acceptStatus(result.status); setBootstrap(result.bootstrap); setPairing(result.pairing); setLinking(!next.devices.some(device => device.state === 'pending')); }
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
    <Row label="Estado" hint="Vincula Android con Phantom Workspace (todos tus proyectos) por la red local."><span className="st-status" data-tone={error || status?.lastError ? 'warn' : status?.enabled ? 'ok' : undefined}>{error || status?.lastError ? 'Error' : !status ? 'Consultando' : status.enabled ? 'Activo' : 'Apagado'}</span></Row>
    {error && <p className="st-error" role="alert">{error}</p>}
    {status && !status.workspacesAvailable && <p className="st-error" role="alert">El servicio de Phantom está desactualizado. Cierra y vuelve a abrir Phantom para vincular el teléfono.</p>}
    {status?.lastError && status.lastError !== error && <p className="st-error" role="alert">{status.lastError}</p>}
    {status && !linking && status.repoValid && status.node.compatible && !status.devices.some(device => device.state === 'pending') && <Row label="App Android"><button className="st-btn is-primary" disabled={changing || !validPort} onClick={link}>{status.devices.some(device => device.state === 'approved') ? 'Vincular otro teléfono' : 'Vincular teléfono'}</button></Row>}
    </Group>
    {linking && pairing && <div className="st-phone-link">{qrText && <><PhoneQr text={qrText} /><p className="st-note">Escanea el código con la app Phantom en tu Android. El teléfono debe estar en la misma red.</p><p className="st-note" role="status">Caduca en {Math.max(0, Math.ceil((expiresAt - time) / 1000))} s</p></>}{payloadError && <p className="st-error" role="alert">{payloadError}</p>}<div className="st-actions">{payloadError && <button className="st-btn" disabled={changing} onClick={link}>Reintentar</button>}<button className="st-btn" disabled={changing} onClick={() => { setLinking(false); setPairing(null); }}>Cancelar</button></div></div>}
    {status?.devices.filter(device => device.state === 'pending' || device.state === 'approved').sort((a, b) => Number(b.state === 'pending') - Number(a.state === 'pending')).map(device => <div className="st-device" key={device.id}><Group title={device.state === 'pending' ? `${device.name || 'Teléfono Android'} quiere conectarse` : `${device.name || 'Teléfono Android'} · ${device.connected ? 'Conectado' : 'Aprobado'}`}>
      <Row label="Huella del dispositivo"><span className="st-fingerprint" title={device.keyFingerprint}>{device.keyFingerprint?.slice(0, 8)}…{device.keyFingerprint?.slice(-8)}</span></Row>
      {device.state === 'pending' && <Row label="Permitir en todos tus proyectos" hint="Podrá leer el chat principal, enviar mensajes y parar turnos con la autoridad del agente, y leer las herramientas en todos tus proyectos." />}
      <Row label="Dispositivo"><div className="st-actions">{device.state === 'pending' && <button className="st-btn is-primary" disabled={changing || !status.workspacesAvailable} onClick={() => status.workspacesAvailable && run(() => api('android.approve', { id: device.id, grants: standardGrants(status.workspaces), acknowledgeAgentAuthority: true }))}>Permitir</button>}
      <button className="st-btn is-danger" disabled={changing} onClick={() => run(() => api('android.revoke', { id: device.id }))}>{device.state === 'pending' ? 'Rechazar' : 'Quitar'}</button></div></Row>
    </Group><details className="st-details"><summary>{device.state === 'pending' ? 'Personalizar permisos' : 'Permisos'}</summary><DevicePermissions device={device} workspaces={status.workspaces} workspacesAvailable={status.workspacesAvailable} busy={changing} run={run} api={api} /></details></div>)}
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
    {!status ? <p className="st-note" role="status">Consultando…</p> : <>
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
