import React, { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, RotateCcw, X } from 'lucide-react';
import { ACCENTS, BACKGROUNDS } from '../hooks/useAppearance';
import gengarArtwork from '../../assets/gengar.png';

export function Appearance({ appearance, update, reset, workspace }) {
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
  return <section className="appearance-panel" aria-label="Apariencia del workspace">
    <h2>Tu espacio, a tu manera</h2>
    <p>Un fondo propio para orientarte. Superficies nítidas para trabajar.</p>
    <fieldset><legend>Fondo del canvas</legend><div className="background-options">{BACKGROUNDS.map(([key, name, description]) => <button key={key} className={`background-option ${key}`} aria-pressed={!appearance.image && appearance.background === key} title={description} onClick={() => update({ background: key, image: '' })}><span className="background-preview" aria-hidden="true">{key === 'gengar' && <img src={gengarArtwork} alt="" />}</span><span>{name}</span>{!appearance.image && appearance.background === key && <Check size={13} />}</button>)}</div></fieldset>
    <label className="background-upload"><ImagePlus size={16} /><span>{loading ? 'Leyendo imagen…' : 'Elegir mi imagen'}<small>PNG, JPG o WebP · hasta 2 MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Elegir imagen de fondo" onChange={upload} disabled={loading} /></label>
    {appearance.image && <div className="uploaded-background"><img src={appearance.image} alt="Fondo personal seleccionado" /><span>Tu imagen local</span><button className="icon-button" aria-label="Quitar imagen de fondo" onClick={() => update({ image: '' })}><X size={15} /></button></div>}
    {error && <p className="appearance-error" role="alert">{error}</p>}
    <fieldset><legend>Color de acento</legend><div className="accent-options">{ACCENTS.map(([key, name, color]) => <button key={key} aria-label={`Acento ${name}`} aria-pressed={appearance.accent === key} style={{ '--swatch': color }} onClick={() => update({ accent: key })}><span>{appearance.accent === key && <Check size={14} />}</span>{name}</button>)}</div></fieldset>
    <label className="intensity-label" htmlFor="background-intensity">Intensidad del fondo <output>{appearance.intensity}%</output></label>
    <input id="background-intensity" className="intensity-range" type="range" min="0" max="100" value={appearance.intensity} onChange={e => update({ intensity: Number(e.target.value) })} />
    <label className="grid-toggle"><span>Retícula de puntos<small>Una referencia para organizar tus paneles</small></span><input type="checkbox" checked={appearance.grid} onChange={e => update({ grid: e.target.checked })} /></label>
    <div className="appearance-footer"><p>Se guarda en este equipo{workspace ? ` para ${workspace.name}` : ''}. Al enfocar un panel, el fondo se atenúa automáticamente.</p><button className="button" onClick={() => { request.current++; setLoading(false); setError(''); reset(); }}><RotateCcw size={14} /> Restablecer apariencia</button></div>
  </section>;
}
