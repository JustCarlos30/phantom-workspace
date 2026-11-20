import React from 'react';
import Settings from '../components/Settings';
import { Appearance } from '../components/Appearance';
import MobileSettings from '../components/MobileSettings';
import AndroidGatewaySettings from '../components/AndroidGatewaySettings';
import MobileApp from '../components/MobileApp';
import PhoneQr from '../components/PhoneQr';
import { demo, Panel } from './decorators';
import { appearance } from './fixtures';

function SettingsPanel({ host, children }) {
  if (host === 'canvas') return <section className="canvas-node" style={{ position: 'relative', width: '100%', height: 720 }}><div className="node-body"><div className="tw-tool-panel">{children}</div></div></section>;
  if (host === 'sheet') return <div className="inspector-host settings-sheet"><aside className="tw-inspector is-settings" aria-label="Configuración">{children}</aside></div>;
  return <Panel>{children}</Panel>;
}
export default { title: 'Ajustes', args: { host: 'catalog' }, argTypes: { host: { control: 'select', options: ['catalog', 'canvas', 'sheet'] } } };
export const Configuracion = { render: args => <SettingsPanel {...args}><Settings {...demo} /></SettingsPanel> };
// Proveedores y motores: detección sintética (sin procesos ni cuentas reales).
const detection = {
  claude: { id: 'claude', label: 'Claude Code', engine: 'claude-code', status: 'available', binary: { path: 'claude', version: '2.1.328 (Claude Code)' }, session: { available: true, plan: 'max' } },
  opencode: { id: 'opencode', label: 'OpenCode', engine: 'opencode', status: 'available', binary: { path: 'opencode', version: '1.2.3' }, session: { available: true, credentials: [{ name: 'OpenRouter', source: 'environment' }] }, models: { available: true, count: 42 } },
  codex: { id: 'codex', label: 'Codex', engine: null, status: 'unavailable', reason: 'No se encontró «codex»', binary: { path: 'codex', version: null }, session: { available: false, reason: 'Sin sesión' } },
};
function providersDemo({ enabled = ['claude'], list = Object.values(detection), failure } = {}) {
  const settings = { providers: Object.fromEntries(['claude', 'opencode', 'codex'].map(id => [id, { enabled: enabled.includes(id) }])) };
  const api = (method, payload) => {
    if (method === 'providers.list') return failure ? Promise.reject(new Error(failure)) : Promise.resolve({ observedAt: '2026-11-20T10:00:00.000Z', providers: list.map(item => ({ ...item, enabled: enabled.includes(item.id) })) });
    if (method === 'providers.models') return Promise.resolve({ provider: payload.provider, available: true, items: payload.provider === 'opencode' ? [{ id: 'openai/gpt-5' }, { id: 'openrouter/qwen3-coder' }] : [{ id: 'claude-code/sonnet' }] });
    return demo.api(method, payload);
  };
  return { ...demo, api, state: { ...demo.state, settings } };
}
export const ProveedoresSoloClaude = { render: args => <SettingsPanel {...args}><Settings {...providersDemo()} category="agents" /></SettingsPanel> };
export const ProveedoresOpenCode = { render: args => <SettingsPanel {...args}><Settings {...providersDemo({ enabled: ['claude', 'opencode'] })} category="agents" /></SettingsPanel> };
export const ProveedorSinSesion = { render: args => <SettingsPanel {...args}><Settings {...providersDemo({ enabled: ['claude', 'opencode'], list: [detection.claude, { ...detection.opencode, session: { available: false, credentials: [], reason: 'Sin cuentas en OpenCode: ejecuta «opencode auth login»' } }, detection.codex] })} category="agents" /></SettingsPanel> };
export const ProveedoresErrorDeteccion = { render: args => <SettingsPanel {...args}><Settings {...providersDemo({ failure: 'La detección de proveedores no respondió' })} category="agents" /></SettingsPanel> };
export const Git ={ render: args => <SettingsPanel {...args}><Settings {...demo} category="git" /></SettingsPanel> };
export const Voz = { render: args => <SettingsPanel {...args}><Settings {...demo} category="voice" /></SettingsPanel> };
export const Conexiones = { render: args => <SettingsPanel {...args}><Settings {...demo} category="connections" /></SettingsPanel> };
export const Datos = { render: () => <Panel><Settings {...demo} category="data" /></Panel> };
export const Avanzado = { render: () => <Panel><Settings {...demo} category="advanced" /></Panel> };
export const Apariencia = { render: () => { const [value, setValue] = React.useState(appearance), [scale, setScale] = React.useState(115); return <Panel><Appearance appearance={value} update={patch => { setValue(v => ({ ...v, ...patch })); return true; }} reset={() => setValue(appearance)} interfaceScale={{ scale, update: setScale }} /></Panel>; } };
export const Movil = { render: () => <Panel><MobileSettings {...demo} embedded /></Panel> };
export const Android = { render: () => <Panel><AndroidGatewaySettings {...demo} /></Panel> };
export const ClienteMovil = { render: () => <MobileApp />, parameters: { docs: { description: { story: 'Formulario real de vinculación. Sin credenciales, sesión ni servidor móvil. Las peticiones /api están bloqueadas por el decorador.' } } } };
export const CodigoQr = { render: () => <div className="catalog-page"><PhoneQr text="https://example.invalid/synthetic-only" /><p>QR sintético; no contiene credenciales de emparejamiento.</p></div> };
