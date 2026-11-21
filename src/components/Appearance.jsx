import React, { useEffect, useRef, useState } from 'react';
import { Check, Sun } from 'lucide-react';
import { ACCENTS, BACKGROUNDS } from '../hooks/useAppearance';
import { INTERFACE_SCALES } from '../hooks/interfaceScale';
import { Group, Row, Switch } from './PluginPrimitives';

// Apariencia, as a category of Configuración: every change applies at once.
export function Appearance({ appearance, update, reset, workspace, interfaceScale }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  async function upload(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Elige una imagen PNG, JPG o WebP de hasta 2 MB.'); return;
    }
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      const bitmap = await createImageBitmap(file); bitmap.close();
      const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      if (version === request.current && !update({ image })) setError('La imagen no se guardó. Prueba con una más pequeña.');
    } catch { if (version === request.current) setError('No se pudo leer la imagen. Prueba con otro archivo.'); }
    finally { if (version === request.current) setLoading(false); }
  }
  return <div className="st-appearance">
    {interfaceScale && <Group title="Interfaz">
      <Row label="Tamaño" hint="Toda la app y las terminales, en este equipo" htmlFor="interface-scale">
        <select id="interface-scale" className="st-select" value={interfaceScale.scale} disabled={interfaceScale.loading} aria-busy={interfaceScale.loading} onChange={event => interfaceScale.update(Number(event.target.value))}>
          {INTERFACE_SCALES.map(scale => <option key={scale} value={scale}>{scale}%{scale === 115 ? ' (predeterminado)' : ''}</option>)}
        </select>
      </Row>
      {interfaceScale.error && <p className="st-error" role="alert">{interfaceScale.error}</p>}
    </Group>}
    <Group title="Fondo">
      <div className="st-block"><div className="background-options" role="group" aria-label="Fondo del lienzo">{BACKGROUNDS.map(([key, name, description]) => <button type="button" key={key} className={`background-option ${key}`} aria-pressed={!appearance.image && appearance.background === key} title={description} onClick={() => update({ background: key, image: '' })}><span className="background-preview" aria-hidden="true" /><span>{name}</span>{!appearance.image && appearance.background === key && <Check size={13} />}</button>)}</div></div>
      <Row label="Tu imagen" hint="PNG, JPG o WebP · hasta 2 MB">
        {appearance.image && <><img className="st-thumb" src={appearance.image} alt="Fondo personal seleccionado" /><button type="button" className="st-btn" aria-label="Quitar imagen de fondo" onClick={() => update({ image: '' })}>Quitar</button></>}
        <label className="st-btn st-file">{loading ? 'Leyendo…' : 'Elegir…'}<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Elegir imagen de fondo" onChange={upload} disabled={loading} /></label>
      </Row>
      {error && <p className="st-error" role="alert">{error}</p>}
      <div className="st-row st-slider-row"><label htmlFor="background-intensity">Intensidad</label><output htmlFor="background-intensity">{appearance.intensity}%</output><div className="st-slider" style={{ '--range-value': `${appearance.intensity}%` }}><span className="st-slider-fill" /><Sun size={16} aria-hidden="true" /><input id="background-intensity" className="st-range" type="range" min="0" max="100" value={appearance.intensity} onChange={e => update({ intensity: Number(e.target.value) })} /></div></div>
    </Group>
    <Group title="Color de acento">
      <div className="st-block"><div className="accent-options" role="group" aria-label="Color de acento">{ACCENTS.map(([key, name, color]) => <button type="button" key={key} aria-label={`Acento ${name}`} aria-pressed={appearance.accent === key} style={{ '--swatch': color }} onClick={() => update({ accent: key })}><span>{appearance.accent === key && <Check size={14} />}</span>{name}</button>)}</div></div>
    </Group>
    <Group title="Titi">
      <Row label="Mostrar Titi"><Switch label="Mostrar Titi" checked={appearance.gengar} onChange={gengar => update({ gengar })} /></Row>
      <div className="st-row st-slider-row"><label htmlFor="gengar-intensity">Presencia</label><output htmlFor="gengar-intensity">{appearance.gengarIntensity}%</output><div className="st-slider" style={{ '--range-value': `${appearance.gengarIntensity}%` }}><span className="st-slider-fill" /><Sun size={16} aria-hidden="true" /><input id="gengar-intensity" className="st-range" type="range" min="0" max="100" disabled={!appearance.gengar} value={appearance.gengarIntensity} onChange={e => update({ gengarIntensity: Number(e.target.value) })} /></div></div>
    </Group>
    <Group title="Lienzo">
      <Row label="Pulso ambiental" hint="Animación lenta del fondo"><Switch label="Pulso ambiental" checked={appearance.pulse} onChange={pulse => update({ pulse })} /></Row>
      <Row label="Concentración" hint="Atenúa el fondo y a Titi"><Switch label="Concentración" checked={appearance.concentration} onChange={concentration => update({ concentration })} /></Row>
      <Row label="Retícula de puntos"><Switch label="Retícula de puntos" checked={appearance.grid} onChange={grid => update({ grid })} /></Row>
    </Group>
    <Group>
      <Row label="Restablecer apariencia" hint={workspace ? `Solo la de ${workspace.name}` : undefined}><button type="button" className="st-btn" onClick={() => { request.current++; setLoading(false); setError(''); reset(); }}>Restablecer</button></Row>
    </Group>
  </div>;
}
