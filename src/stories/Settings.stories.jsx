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
export const Git = { render: args => <SettingsPanel {...args}><Settings {...demo} category="git" /></SettingsPanel> };
export const Voz = { render: args => <SettingsPanel {...args}><Settings {...demo} category="voice" /></SettingsPanel> };
export const Conexiones = { render: args => <SettingsPanel {...args}><Settings {...demo} category="connections" /></SettingsPanel> };
export const Datos = { render: () => <Panel><Settings {...demo} category="data" /></Panel> };
export const Avanzado = { render: () => <Panel><Settings {...demo} category="advanced" /></Panel> };
export const Apariencia = { render: () => { const [value, setValue] = React.useState(appearance), [scale, setScale] = React.useState(115); return <Panel><Appearance appearance={value} update={patch => { setValue(v => ({ ...v, ...patch })); return true; }} reset={() => setValue(appearance)} interfaceScale={{ scale, update: setScale }} /></Panel>; } };
export const Movil = { render: () => <Panel><MobileSettings {...demo} embedded /></Panel> };
export const Android = { render: () => <Panel><AndroidGatewaySettings {...demo} /></Panel> };
export const ClienteMovil = { render: () => <MobileApp />, parameters: { docs: { description: { story: 'Formulario real de vinculación. Sin credenciales, sesión ni servidor móvil. Las peticiones /api están bloqueadas por el decorador.' } } } };
export const CodigoQr = { render: () => <div className="catalog-page"><PhoneQr text="https://example.invalid/synthetic-only" /><p>QR sintético; no contiene credenciales de emparejamiento.</p></div> };
