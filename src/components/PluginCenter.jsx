import React from 'react';
import Settings from './Settings.jsx';

// The old plugin centre is now part of Configuración: project connections live
// under Conexiones, and Phantom under Agentes. A panel may ask for a category.
export function PluginCenter(props) {
  return <Settings {...props} category={props.node?.data?.category || 'connections'} />;
}
