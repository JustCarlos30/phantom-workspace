import React, { useEffect, useRef, useState } from 'react';
import { SHELL_ICONS } from '../components/ShellIcons';
import { Button, Field } from '../components/PluginPrimitives';
import { INTERFACE_SCALES } from '../hooks/interfaceScale';

const sheets = import.meta.glob('../*.css', { query: '?raw', import: 'default', eager: true });
const names = [...new Set(Object.values(sheets).flatMap(css => [...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1])))].sort();
function Tokens() {
  const [values, setValues] = useState([]), [query, setQuery] = useState('');
  useEffect(() => { const css = getComputedStyle(document.documentElement); setValues(names.map(name => ({ name, value: css.getPropertyValue(name).trim() })).filter(t => t.value)); }, []);
  return <main className="catalog-page"><h1>Fundamentos computados</h1><p>Valores leídos con getComputedStyle después de cargar CSS de producción. Estándar vigente: planos negros mate, marfil para selección y color para estados (DESIGN.md, 2026-11-16). Los textos históricos no son propuestas aprobadas nuevas.</p><label>Filtrar tokens <input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="catalog-grid">{values.filter(t => `${t.name} ${t.value}`.includes(query)).map(({ name, value }) => <section className="catalog-sample catalog-token" key={name}><strong>{name}</strong>{CSS.supports('color', value) && <span className="catalog-swatch" style={{ background: value }} />}{name.includes('shadow') && <span className="catalog-swatch" style={{ boxShadow: value, background: 'var(--surface-2)' }} />}{name.startsWith('--r-') && <span className="catalog-swatch" style={{ borderRadius: value, background: 'var(--surface-2)' }} />}{name.includes('type-') && <span style={{ font: value }}>Phantom · Aa 0123</span>}<code>{value}</code></section>)}</div><h2>Iconos reales: línea y sólido</h2><div className="catalog-grid">{Object.entries(SHELL_ICONS).map(([name, Icon]) => <div key={name}><Icon variant="line" /><Icon variant="solid" /> {name}</div>)}</div><h2>Escala y movimiento</h2><p>Usa Ajustes → Apariencia para comparar la escala de interfaz. El zoom del canvas tiene un contrato separado. Prefers-reduced-motion debe probarse con la emulación del navegador; no implica que toda animación esté auditada.</p><p>Espaciado de referencia vigente en DESIGN: 4, 5, 6, 8, 10, 12, 16, 20 y 24 px. Las medidas sin custom property permanecen valores declarados; no se presentan como tokens computados.</p><h2>Propuestas</h2><p>Unificar nombres de tipografía y espaciado después de comparar usos. Mantener superficies, estados y contratos vigentes durante esa migración.</p></main>;
}
export default { title: 'Fundamentos' };
export const TokensReales = { render: () => <Tokens /> };

function Measures({ width }) {
  const sample = useRef(null), [metrics, setMetrics] = useState([]);
  useEffect(() => {
    setMetrics([...sample.current.querySelectorAll('[data-measure]')].map(element => {
      const css = getComputedStyle(element);
      return { label: element.dataset.measure, font: css.font, padding: css.padding, gap: css.gap, radius: css.borderRadius, shadow: css.boxShadow, height: `${element.getBoundingClientRect().height}px`, transition: `${css.transitionDuration} ${css.transitionTimingFunction}` };
    }));
  }, [width]);
  const css = getComputedStyle(document.documentElement);
  return <main className="catalog-page"><h1>Tipos, espaciado y medidas</h1><div className="catalog-grid">{['display', 'title', 'headline', 'body', 'control', 'support', 'micro'].map(role => <section className="catalog-sample" key={role}><span style={{ font: `var(--t-${role})` }}>Phantom · Aa 012345</span><p><code>--t-{role}: {css.getPropertyValue(`--t-${role}`)}</code></p></section>)}</div><section><h2>Ritmo computado</h2><div className="catalog-row">{['--s-1', '--s-2', '--s-3', '--s-4', '--target', '--row-simple', '--row-detail'].map(name => <div key={name}><div style={{ width: 40, height: `var(${name})`, background: 'var(--fill-3)' }} /><code>{name}: {css.getPropertyValue(name)}</code></div>)}</div></section><section className="plugin-surface" ref={sample} style={{ maxWidth: width, height: 'auto' }}><Button tone="primary" data-measure="Button de plugin">Guardar ejemplo</Button><Field label="Campo real"><input data-measure="Input dentro de Field" defaultValue="Medición computada" /></Field></section><table className="catalog-table"><thead><tr><th>Componente</th><th>Tipografía / altura</th><th>Padding / gap / radio</th><th>Sombra / movimiento</th></tr></thead><tbody>{metrics.map(m => <tr key={m.label}><td>{m.label}</td><td>{m.font}<br />{m.height}</td><td>{m.padding} / {m.gap} / {m.radius}</td><td>{m.shadow}<br />{m.transition}</td></tr>)}</tbody></table><p>Escalas admitidas por producción: {INTERFACE_SCALES.join(' %, ')} %. El zoom nativo de Electron no se ejecuta aquí; las medidas anteriores son píxeles CSS del navegador.</p><p>Movimiento: <code>{css.getPropertyValue('--dur-spring')} · {css.getPropertyValue('--ease-spring')}</code>. La suite captura también con prefers-reduced-motion: reduce.</p></main>;
}
export const Medidas = { args: { width: 640 }, argTypes: { width: { control: { type: 'range', min: 280, max: 1000, step: 20 }, description: 'Ancho del contexto del control, en píxeles CSS' } }, render: args => <Measures {...args} /> };
