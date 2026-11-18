import React from 'react';
import EmptyState from '../components/EmptyState.jsx';
import { CopyButton } from '../components/CopyButton';
import * as P from '../components/PluginPrimitives';
import { Button as ToolButton, Field as ToolField, ErrorNotice as ToolError, DataView as ToolData } from '../components/ToolPanels';
import { Presence, PresenceGroup } from '../components/Presence';

export default { title: 'Primitivas', component: EmptyState, parameters: { docs: { description: { component: 'Primitivas reales. ToolPanels y PluginPrimitives mantienen implementaciones distintas; su unificación es una propuesta pendiente.' } } } };

export const Panel = {
  args: { title: 'Sin resultados', description: 'Prueba con otra búsqueda.' },
};

export const Accion = {
  render: () => {
    const [count, setCount] = React.useState(0);
    return <EmptyState title="Sin resultados" description={`Intentos: ${count}`} actions={<button type="button" onClick={() => setCount(count + 1)}>Reintentar</button>} />;
  },
};

export const Controles = { render: () => {
  const [checked, setChecked] = React.useState(false), [value, setValue] = React.useState('uno');
  return <div className="catalog-page">
    <P.Group title="Controles de plugins">
      <P.Row label="Selección"><P.Switch label="Activar ejemplo" checked={checked} onChange={setChecked} /></P.Row>
      <P.Segmented label="Modo de ejemplo" value={value} options={[["uno", "Uno"], ["dos", "Dos"]]} onChange={setValue} />
      <P.TextRow label="Texto editable" value={value} onChange={setValue} />
      <P.Field label="Campo"><input defaultValue="Texto largo de ejemplo para revisar el comportamiento compacto" /></P.Field>
      <div className="catalog-row"><P.Button tone="primary">Guardar</P.Button><P.Button disabled>Deshabilitado</P.Button><P.CopyButton value="Dato sintético" /><CopyButton text="Dato sintético" /></div>
    </P.Group>
    <P.ErrorNotice error={new Error('Fallo sintético')} retry={() => setChecked(true)} /><P.DataView value={{ ejemplo: true }} /><P.OperationState op={{ busy: true }} /><P.ResourceState resource={{ loading: true }} /><P.ResourceState resource={{ loading: false, data: { items: [] } }} />
    <section><h2>Primitivas de herramientas</h2><ToolField label="Campo de herramienta"><input defaultValue="Ejemplo" /></ToolField><ToolButton tone="primary">Guardar</ToolButton><ToolError error={new Error('Error de herramienta sintético')} /><ToolData value={{ ejemplo: true }} /></section>
  </div>;
} };
export const Presencia = { render: () => { const [show, setShow] = React.useState(true); return <div className="catalog-page"><button className="button" onClick={() => setShow(!show)}>Alternar presencia</button><Presence show={show}><EmptyState title="Presencia animada" description="Prueba también prefers-reduced-motion." /></Presence><PresenceGroup>{show && <p key="visible">Grupo visible</p>}</PresenceGroup></div>; } };
export const TextoLargo = { args: { title: 'No hay resultados para esta consulta particularmente larga que debe conservar su legibilidad', description: 'Prueba los estados en una ventana compacta, con teclado y con movimiento reducido.', size: 'compact' } };
